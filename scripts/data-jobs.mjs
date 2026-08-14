import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const DATA_JOBS_PATH = "/api/data-jobs";
export const INTERNAL_DATA_JOBS_PATH = "/internal/data-jobs";

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};
const JOB_ID_PATTERN = /^massive-spy-[0-9TZ-]+-[0-9a-f]{12}$/;
const TICKER_PATTERN = /^[A-Z][A-Z0-9.]{0,7}$/;
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const ACTIVE_STATUSES = new Set(["running", "cancel_requested"]);
const MAXIMUM_BODY_BYTES = 256 * 1024;
const MAXIMUM_INTERNAL_BODY_BYTES = 2 * 1024 * 1024;
const DEFAULT_LEASE_SECONDS = 180;
const STALE_LOCK_MILLISECONDS = 30_000;

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(`${JSON.stringify(payload)}\n`, {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function constantTimeEqual(left, right) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function bearerAuthorized(request, token) {
  if (!token) return false;
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") &&
    constantTimeEqual(authorization.slice("Bearer ".length), token);
}

function parseIsoDate(value, field) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${field} must be an ISO date`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} is not a calendar date`);
  }
  return value;
}

function dateInNewYork(now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftUtcDate(isoDate, { days = 0, years = 0 }) {
  const value = new Date(`${isoDate}T00:00:00Z`);
  if (years) value.setUTCFullYear(value.getUTCFullYear() + years);
  if (days) value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function normalizeUniverse(value, confirmation) {
  if (!isObject(value)) throw new Error("universe is required");
  if (value.type === "top_weighted") {
    const limit = Number(value.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 503) {
      throw new Error("top-weighted limit must be between 1 and 503");
    }
    return { type: value.type, limit };
  }
  if (value.type === "symbols") {
    if (!Array.isArray(value.symbols) || value.symbols.length < 1 || value.symbols.length > 503) {
      throw new Error("explicit symbols must contain between 1 and 503 tickers");
    }
    const symbols = [...new Set(value.symbols.map((ticker) => String(ticker).toUpperCase()))];
    if (!symbols.every((ticker) => TICKER_PATTERN.test(ticker))) {
      throw new Error("explicit symbols contain an invalid ticker");
    }
    return { type: value.type, symbols };
  }
  if (value.type === "all_constituents") {
    if (confirmation !== "DOWNLOAD ALL CURRENT SPY CONSTITUENTS") {
      throw new Error("full-universe confirmation phrase is missing");
    }
    return { type: value.type };
  }
  throw new Error("universe type is unsupported");
}

function normalizeJobRequest(value, now) {
  if (!isObject(value)) throw new Error("job request must be a JSON object");
  const rangeStart = parseIsoDate(value.rangeStart, "rangeStart");
  const rangeEnd = parseIsoDate(value.rangeEnd, "rangeEnd");
  const today = dateInNewYork(now);
  const earliest = shiftUtcDate(today, { years: -2 });
  const latestCompleted = shiftUtcDate(today, { days: -1 });
  if (rangeStart < earliest) {
    throw new Error(`rangeStart precedes the current Massive Basic boundary ${earliest}`);
  }
  if (rangeEnd > latestCompleted) {
    throw new Error(`rangeEnd exceeds the latest eligible calendar date ${latestCompleted}`);
  }
  if (rangeEnd < rangeStart) throw new Error("rangeEnd precedes rangeStart");
  const universe = normalizeUniverse(value.universe, value.confirmation);
  return {
    provider: "massive",
    market: "us_equities",
    fundTicker: "SPY",
    canonicalInterval: "1m",
    adjusted: false,
    rangeStart,
    rangeEnd,
    universe,
    includeRaw: value.includeRaw !== false,
    createTickerBundles: value.createTickerBundles !== false,
    requestsPerMinute: 4,
    authority: "research_only",
  };
}

async function readJsonBody(request, maximumBytes = MAXIMUM_BODY_BYTES) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maximumBytes) throw new Error("request body exceeds the limit");
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error("request body exceeds the limit");
    }
    chunks.push(Buffer.from(value));
  }
  return JSON.parse(Buffer.concat(chunks, total).toString("utf8") || "{}");
}

async function atomicJsonWrite(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, filePath);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

async function delay(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withLedgerLock(root, operation) {
  await mkdir(root, { recursive: true });
  const lockPath = path.join(root, ".ledger.lock");
  const deadline = Date.now() + 5_000;
  let handle;
  while (!handle) {
    try {
      handle = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if (error?.code !== "EEXIST" || Date.now() >= deadline) {
        throw new Error("data-job ledger is busy");
      }
      const metadata = await stat(lockPath).catch(() => null);
      if (metadata && Date.now() - metadata.mtimeMs > STALE_LOCK_MILLISECONDS) {
        await unlink(lockPath).catch((unlinkError) => {
          if (unlinkError?.code !== "ENOENT") throw unlinkError;
        });
        continue;
      }
      await delay(25);
    }
  }
  try {
    return await operation();
  } finally {
    await handle.close();
    await unlink(lockPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

function jobPath(root, id) {
  if (!JOB_ID_PATTERN.test(id)) throw new Error("invalid job id");
  return path.join(root, `${id}.json`);
}

async function readJob(root, id) {
  return JSON.parse(await readFile(jobPath(root, id), "utf8"));
}

async function writeJob(root, job) {
  await atomicJsonWrite(jobPath(root, job.id), job);
}

async function listJobs(root) {
  await mkdir(root, { recursive: true });
  const names = await readdir(root);
  const jobs = [];
  for (const name of names.filter((item) => JOB_ID_PATTERN.test(item.replace(/\.json$/, "")) && item.endsWith(".json"))) {
    try {
      jobs.push(JSON.parse(await readFile(path.join(root, name), "utf8")));
    } catch {
      // A malformed file is unavailable rather than allowed to break the complete ledger.
    }
  }
  return jobs.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function publicJob(job) {
  const visible = { ...job };
  delete visible.workerId;
  delete visible.leaseUntil;
  delete visible.resume;
  return visible;
}

function leaseTimestamp(now, leaseSeconds) {
  return new Date(now.getTime() + leaseSeconds * 1000).toISOString();
}

function normalizeProgress(value, current) {
  if (!isObject(value)) return current;
  const next = { ...current };
  for (const field of ["symbolsTotal", "symbolsCompleted", "symbolsFailed", "pagesCompleted", "providerCalls", "rowsWritten", "bytesUploaded"]) {
    if (value[field] !== undefined) {
      const number = Number(value[field]);
      if (!Number.isSafeInteger(number) || number < 0) throw new Error(`progress.${field} is invalid`);
      next[field] = number;
    }
  }
  if (next.symbolsTotal > 0 && next.symbolsCompleted + next.symbolsFailed > next.symbolsTotal) {
    throw new Error("progress symbol counts exceed the denominator");
  }
  if (typeof value.currentTicker === "string" && (value.currentTicker === "" || TICKER_PATTERN.test(value.currentTicker))) {
    next.currentTicker = value.currentTicker;
  }
  return next;
}

function normalizeArtifacts(value, job) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 510) {
    throw new Error("completed job must declare between 1 and 510 artifacts");
  }
  const prefix = `massive/spy/${job.id}/`;
  const seen = new Set();
  return value.map((artifact) => {
    if (!isObject(artifact) || typeof artifact.id !== "string" || !/^[a-z0-9.-]{1,80}$/.test(artifact.id)) {
      throw new Error("artifact id is invalid");
    }
    if (seen.has(artifact.id)) throw new Error("artifact id is duplicated");
    seen.add(artifact.id);
    if (typeof artifact.key !== "string" || !artifact.key.startsWith(prefix) || artifact.key.includes("..")) {
      throw new Error("artifact key is outside the job prefix");
    }
    if (typeof artifact.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(artifact.sha256)) {
      throw new Error("artifact sha256 is invalid");
    }
    const size = Number(artifact.size);
    if (!Number.isSafeInteger(size) || size < 1) throw new Error("artifact size is invalid");
    const ticker = artifact.ticker == null ? null : String(artifact.ticker).toUpperCase();
    if (ticker !== null && !TICKER_PATTERN.test(ticker)) throw new Error("artifact ticker is invalid");
    return {
      id: artifact.id,
      kind: String(artifact.kind ?? "artifact").slice(0, 40),
      label: String(artifact.label ?? artifact.id).slice(0, 120),
      key: artifact.key,
      sha256: artifact.sha256,
      size,
      ticker,
    };
  });
}

function routeParts(pathname, prefix) {
  if (pathname === prefix) return [];
  if (!pathname.startsWith(`${prefix}/`)) return null;
  return pathname.slice(prefix.length + 1).split("/").map(decodeURIComponent);
}

export function createDataJobsHandler({
  jobsRoot,
  adminToken,
  workerToken,
  signArtifact,
  now = () => new Date(),
  leaseSeconds = DEFAULT_LEASE_SECONDS,
}) {
  if (!jobsRoot) throw new Error("jobsRoot is required");

  async function adminResponse(request, parts) {
    if (!bearerAuthorized(request, adminToken)) {
      return jsonResponse({ status: "unauthorized" }, 401, { "www-authenticate": "Bearer" });
    }
    if (parts.length === 0 && request.method === "GET") {
      return jsonResponse({ jobs: (await listJobs(jobsRoot)).slice(0, 100).map(publicJob) });
    }
    if (parts.length === 0 && request.method === "POST") {
      const timestamp = now();
      const requestBody = normalizeJobRequest(await readJsonBody(request), timestamp);
      const id = `massive-spy-${timestamp.toISOString().replaceAll(":", "").replaceAll(".", "-")}-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const job = {
        schemaVersion: 1,
        id,
        status: "queued",
        createdAt: timestamp.toISOString(),
        updatedAt: timestamp.toISOString(),
        request: requestBody,
        progress: {
          symbolsTotal: 0,
          symbolsCompleted: 0,
          symbolsFailed: 0,
          pagesCompleted: 0,
          providerCalls: 0,
          rowsWritten: 0,
          bytesUploaded: 0,
          currentTicker: "",
        },
        artifacts: [],
        error: null,
      };
      await withLedgerLock(jobsRoot, async () => writeJob(jobsRoot, job));
      return jsonResponse({ job: publicJob(job) }, 201, { location: `${DATA_JOBS_PATH}/${id}` });
    }
    if (parts.length < 1 || !JOB_ID_PATTERN.test(parts[0])) return jsonResponse({ status: "not_found" }, 404);
    let job;
    try {
      job = await readJob(jobsRoot, parts[0]);
    } catch (error) {
      if (error?.code === "ENOENT") return jsonResponse({ status: "not_found" }, 404);
      throw error;
    }
    if (parts.length === 1 && request.method === "GET") return jsonResponse({ job: publicJob(job) });
    if (parts.length === 2 && parts[1] === "cancel" && request.method === "POST") {
      const updated = await withLedgerLock(jobsRoot, async () => {
        const latest = await readJob(jobsRoot, job.id);
        if (TERMINAL_STATUSES.has(latest.status)) return latest;
        const timestamp = now().toISOString();
        latest.status = latest.status === "queued" ? "cancelled" : "cancel_requested";
        latest.updatedAt = timestamp;
        latest.finishedAt = latest.status === "cancelled" ? timestamp : undefined;
        await writeJob(jobsRoot, latest);
        return latest;
      });
      return jsonResponse({ job: publicJob(updated) });
    }
    if (parts.length === 3 && parts[1] === "artifacts" && request.method === "GET") {
      if (job.status !== "completed") return jsonResponse({ status: "not_ready" }, 409);
      const artifact = job.artifacts.find((item) => item.id === parts[2]);
      if (!artifact) return jsonResponse({ status: "not_found" }, 404);
      if (typeof signArtifact !== "function") return jsonResponse({ status: "storage_unavailable" }, 503);
      const url = await signArtifact(artifact.key, artifact.label);
      if ((request.headers.get("accept") ?? "").includes("application/json")) {
        return jsonResponse({ url, expiresInSeconds: 15 * 60 });
      }
      return new Response(null, { status: 303, headers: { location: url, "cache-control": "no-store" } });
    }
    return jsonResponse({ status: "method_not_allowed" }, 405);
  }

  async function internalResponse(request, parts) {
    if (!bearerAuthorized(request, workerToken)) {
      return jsonResponse({ status: "unauthorized" }, 401, { "www-authenticate": "Bearer" });
    }
    if (parts.length === 1 && parts[0] === "claim" && request.method === "POST") {
      const body = await readJsonBody(request);
      const workerId = String(body.workerId ?? "").slice(0, 120);
      if (!workerId) return jsonResponse({ status: "rejected", error: "workerId is required" }, 422);
      const timestamp = now();
      const claimed = await withLedgerLock(jobsRoot, async () => {
        const jobs = (await listJobs(jobsRoot)).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
        const candidate = jobs.find((job) => job.status === "queued" ||
          (ACTIVE_STATUSES.has(job.status) && job.status !== "cancel_requested" && job.leaseUntil && job.leaseUntil < timestamp.toISOString()));
        if (!candidate) return null;
        candidate.status = "running";
        candidate.workerId = workerId;
        candidate.startedAt ??= timestamp.toISOString();
        candidate.updatedAt = timestamp.toISOString();
        candidate.leaseUntil = leaseTimestamp(timestamp, leaseSeconds);
        await writeJob(jobsRoot, candidate);
        return candidate;
      });
      return jsonResponse({ job: claimed });
    }
    if (parts.length < 1 || !JOB_ID_PATTERN.test(parts[0])) return jsonResponse({ status: "not_found" }, 404);
    let job;
    try {
      job = await readJob(jobsRoot, parts[0]);
    } catch (error) {
      if (error?.code === "ENOENT") return jsonResponse({ status: "not_found" }, 404);
      throw error;
    }
    if (parts.length === 1 && request.method === "GET") return jsonResponse({ job });
    if (parts.length !== 2 || request.method !== "POST") return jsonResponse({ status: "method_not_allowed" }, 405);
    const action = parts[1];
    const body = await readJsonBody(request, MAXIMUM_INTERNAL_BODY_BYTES);
    if (action === "heartbeat") {
      const updated = await withLedgerLock(jobsRoot, async () => {
        const latest = await readJob(jobsRoot, job.id);
        if (!ACTIVE_STATUSES.has(latest.status)) return null;
        const timestamp = now();
        latest.progress = normalizeProgress(body.progress, latest.progress);
        if (isObject(body.resume)) latest.resume = body.resume;
        latest.updatedAt = timestamp.toISOString();
        latest.leaseUntil = leaseTimestamp(timestamp, leaseSeconds);
        await writeJob(jobsRoot, latest);
        return latest;
      });
      return updated ? jsonResponse({ job: updated }) : jsonResponse({ status: "not_running" }, 409);
    }
    if (action === "complete") {
      const updated = await withLedgerLock(jobsRoot, async () => {
        const latest = await readJob(jobsRoot, job.id);
        if (latest.status !== "running") return null;
        const timestamp = now().toISOString();
        latest.progress = normalizeProgress(body.progress, latest.progress);
        latest.artifacts = normalizeArtifacts(body.artifacts, latest);
        latest.summary = isObject(body.summary) ? body.summary : {};
        latest.status = "completed";
        latest.updatedAt = timestamp;
        latest.finishedAt = timestamp;
        delete latest.leaseUntil;
        delete latest.resume;
        await writeJob(jobsRoot, latest);
        return latest;
      });
      return updated ? jsonResponse({ job: updated }) : jsonResponse({ status: "not_running" }, 409);
    }
    if (action === "fail" || action === "cancelled") {
      const updated = await withLedgerLock(jobsRoot, async () => {
        const latest = await readJob(jobsRoot, job.id);
        if (TERMINAL_STATUSES.has(latest.status)) return latest;
        const timestamp = now().toISOString();
        latest.progress = normalizeProgress(body.progress, latest.progress);
        latest.status = action === "cancelled" ? "cancelled" : "failed";
        latest.error = action === "fail" ? String(body.error ?? "worker failed").slice(0, 1000) : null;
        latest.updatedAt = timestamp;
        latest.finishedAt = timestamp;
        delete latest.leaseUntil;
        await writeJob(jobsRoot, latest);
        return latest;
      });
      return jsonResponse({ job: updated });
    }
    return jsonResponse({ status: "not_found" }, 404);
  }

  return async function dataJobsResponse(request) {
    const pathname = new URL(request.url).pathname;
    const adminParts = routeParts(pathname, DATA_JOBS_PATH);
    const internalParts = routeParts(pathname, INTERNAL_DATA_JOBS_PATH);
    if (adminParts === null && internalParts === null) return null;
    try {
      return adminParts !== null
        ? await adminResponse(request, adminParts)
        : await internalResponse(request, internalParts);
    } catch (error) {
      if (error instanceof SyntaxError) return jsonResponse({ status: "rejected", error: "request JSON is invalid" }, 422);
      if (String(error?.message ?? error).includes("must") || String(error?.message ?? error).includes("invalid") ||
          String(error?.message ?? error).includes("unsupported") || String(error?.message ?? error).includes("exceed") ||
          String(error?.message ?? error).includes("precedes") || String(error?.message ?? error).includes("required") ||
          String(error?.message ?? error).includes("confirmation")) {
        return jsonResponse({ status: "rejected", error: String(error.message ?? error) }, 422);
      }
      throw error;
    }
  };
}
