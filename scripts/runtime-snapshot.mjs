import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

export const PUBLIC_SNAPSHOT_PATH = "/data/arbitra-snapshot.json";
export const INGEST_SNAPSHOT_PATH = "/internal/stock-selector-snapshot";
export const CRYPTO_INGEST_SNAPSHOT_PATH = "/internal/crypto-selector-snapshot";

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(`${JSON.stringify(payload)}\n`, {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isIsoTimestamp(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function isHourAlignedTimestamp(value) {
  if (!isIsoTimestamp(value)) return false;
  const timestamp = new Date(value);
  return timestamp.getUTCMinutes() === 0 && timestamp.getUTCSeconds() === 0 &&
    timestamp.getUTCMilliseconds() === 0;
}

function constantTimeEqual(left, right) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function authorized(request, token) {
  if (!token) return false;
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") &&
    constantTimeEqual(authorization.slice("Bearer ".length), token);
}

function validateBaseSnapshot(snapshot) {
  if (!isObject(snapshot)) throw new Error("snapshot must be a JSON object");
  if (!Number.isInteger(snapshot.schemaVersion) || snapshot.schemaVersion < 6) {
    throw new Error("snapshot schema is unsupported");
  }
  if (snapshot.deploymentAllowed !== false) {
    throw new Error("snapshot must remain research-only");
  }
  if (!Array.isArray(snapshot.datasets)) throw new Error("snapshot datasets are missing");
  if (!isObject(snapshot.profiles)) throw new Error("snapshot profiles are missing");
  if (!isObject(snapshot.history)) throw new Error("snapshot history is missing");
  if (!isObject(snapshot.xgbShowcase)) throw new Error("snapshot model evidence is missing");
  if (snapshot.xgbShowcase.deploymentAllowed !== false ||
      snapshot.xgbShowcase.capitalAuthority !== false) {
    throw new Error("model evidence must remain research-only");
  }
  for (const surface of [snapshot.etf, snapshot.crypto]) {
    if (surface != null && (!isObject(surface) || surface.deploymentAllowed !== false ||
        surface.capitalAuthority !== false)) {
      throw new Error("market evidence must remain research-only");
    }
  }
  return snapshot;
}

export function validateAcceptedSnapshot(snapshot) {
  validateBaseSnapshot(snapshot);
  const selector = snapshot.stockSelector;
  if (!isObject(selector) || selector.status !== "accepted") {
    throw new Error("stock selector is not accepted");
  }
  if (selector.deploymentAllowed !== false || selector.ordersSubmitted !== 0) {
    throw new Error("stock selector must remain research-only");
  }
  if (!isIsoDate(selector.dataThrough)) throw new Error("selector date is invalid");
  if (!Number.isInteger(selector.universe) || selector.universe < 5_000) {
    throw new Error("selector universe is below the whole-market gate");
  }
  if (!Number.isInteger(selector.analyzed) || selector.analyzed < 0) {
    throw new Error("selector analyzed count is invalid");
  }
  if (!Number.isInteger(selector.opportunities) || selector.opportunities < 0) {
    throw new Error("selector opportunity count is invalid");
  }
  const matching = snapshot.datasets.filter((dataset) =>
    isObject(dataset) && dataset.date === selector.dataThrough
  );
  if (matching.length !== 1 || !Array.isArray(matching[0].assets)) {
    throw new Error("accepted selector dataset is missing or ambiguous");
  }
  if (matching[0].universe !== selector.universe ||
      matching[0].assets.length !== selector.opportunities) {
    throw new Error("accepted selector counts do not reconcile");
  }
  const dataset = matching[0];
  const exact = dataset.exactDateAnalyzed;
  const stale = dataset.staleAnalyzed;
  const missing = dataset.historyMissing;
  const failed = dataset.analysisFailed;
  if (![exact, stale, missing, failed].every(Number.isInteger) ||
      exact + stale + missing + failed !== selector.universe ||
      exact + stale !== selector.analyzed ||
      stale !== selector.stale ||
      missing !== selector.historyMissing ||
      failed !== selector.analysisFailed) {
    throw new Error("accepted selector denominator does not reconcile");
  }
  if (!dataset.assets.every((asset) =>
    isObject(asset) && asset.signalDate === selector.dataThrough
  )) {
    throw new Error("accepted selector contains an off-date opportunity");
  }
  return snapshot;
}

export function validateCryptoSnapshot(crypto) {
  if (!isObject(crypto)) throw new Error("crypto snapshot must be a JSON object");
  if (!Number.isInteger(crypto.schemaVersion) || crypto.schemaVersion < 3) {
    throw new Error("crypto snapshot schema is unsupported");
  }
  if (!isIsoTimestamp(crypto.generatedAt)) {
    throw new Error("crypto snapshot generation time is invalid");
  }
  if (!isHourAlignedTimestamp(crypto.completedHourOpen)) {
    throw new Error("crypto snapshot completed hour is invalid");
  }
  if (typeof crypto.sourceRun !== "string" || !crypto.sourceRun.trim()) {
    throw new Error("crypto snapshot source run is missing");
  }
  if (crypto.venue !== "okx" || crypto.marketType !== "spot") {
    throw new Error("crypto snapshot market identity is unsupported");
  }
  if (crypto.deploymentAllowed !== false || crypto.capitalAuthority !== false) {
    throw new Error("crypto snapshot must remain research-only");
  }
  if (!isObject(crypto.universe) || !Number.isInteger(crypto.universe.considered) ||
      crypto.universe.considered < 250) {
    throw new Error("crypto snapshot universe is below the production gate");
  }
  if (!isObject(crypto.rsi) || !Array.isArray(crypto.rsi.activeSignals) ||
      !Array.isArray(crypto.rsi.history)) {
    throw new Error("crypto RSI evidence is incomplete");
  }
  if (!isObject(crypto.suggestedTradeSetup) ||
      crypto.suggestedTradeSetup.orderAuthority !== false) {
    throw new Error("crypto setup must not grant order authority");
  }
  if (!isObject(crypto.godmode) || !Array.isArray(crypto.godmode.current) ||
      !Array.isArray(crypto.godmode.recent) ||
      crypto.godmode.current.some((item) => !isObject(item) || item.deploymentAllowed !== false) ||
      crypto.godmode.recent.some((item) => !isObject(item) || item.deploymentAllowed !== false)) {
    throw new Error("crypto Godmode evidence is invalid");
  }
  return crypto;
}

async function readLimitedBody(request, maximumBytes) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > maximumBytes) throw new Error("snapshot exceeds the upload limit");
  if (!request.body) throw new Error("snapshot request body is missing");

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error("snapshot exceeds the upload limit");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

async function atomicWrite(filePath, content) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, filePath);
  } finally {
    await handle?.close();
    await unlink(temporary).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

export function createRuntimeSnapshotHandler({
  snapshotPath,
  fallbackPath,
  ingestToken,
  cryptoIngestToken,
  maximumBytes = 8 * 1024 * 1024,
}) {
  let mutationTail = Promise.resolve();

  async function serializeMutation(task) {
    const predecessor = mutationTail.catch(() => undefined);
    let release;
    mutationTail = new Promise((resolve) => { release = resolve; });
    await predecessor;
    try {
      return await task();
    } finally {
      release();
    }
  }

  async function currentSnapshotText() {
    try {
      return await readFile(snapshotPath, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      return readFile(fallbackPath, "utf8");
    }
  }

  async function currentSnapshot() {
    const text = await currentSnapshotText();
    return { snapshot: validateBaseSnapshot(JSON.parse(text)), text };
  }

  return async function runtimeSnapshotResponse(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname === PUBLIC_SNAPSHOT_PATH && (request.method === "GET" || request.method === "HEAD")) {
      const { text } = await currentSnapshot();
      return new Response(request.method === "HEAD" ? null : text, {
        status: 200,
        headers: { ...JSON_HEADERS, "content-length": String(Buffer.byteLength(text)) },
      });
    }

    const isStockIngest = pathname === INGEST_SNAPSHOT_PATH;
    const isCryptoIngest = pathname === CRYPTO_INGEST_SNAPSHOT_PATH;
    if (!isStockIngest && !isCryptoIngest) return null;
    const routeToken = isCryptoIngest ? cryptoIngestToken : ingestToken;
    if (!authorized(request, routeToken)) {
      return jsonResponse(
        { status: "unauthorized" },
        401,
        { "www-authenticate": "Bearer" },
      );
    }
    if (request.method === "GET" || request.method === "HEAD") {
      const { snapshot, text } = await currentSnapshot();
      const responseText = isCryptoIngest ?
        `${JSON.stringify(snapshot.crypto ?? null, null, 2)}\n` : text;
      return new Response(request.method === "HEAD" ? null : responseText, {
        status: 200,
        headers: { ...JSON_HEADERS, "content-length": String(Buffer.byteLength(responseText)) },
      });
    }
    if (request.method !== "POST") {
      return jsonResponse({ status: "method_not_allowed" }, 405, { allow: "GET, HEAD, POST" });
    }

    try {
      const incomingText = await readLimitedBody(request, maximumBytes);
      const parsed = JSON.parse(incomingText);
      if (isCryptoIngest) validateCryptoSnapshot(parsed);
      else validateAcceptedSnapshot(parsed);
      return await serializeMutation(async () => {
        const { snapshot: current, text: currentText } = await currentSnapshot();
        let incoming;
        let identity;
        if (isCryptoIngest) {
          const currentGeneratedAt = current.crypto?.generatedAt;
          const currentCompletedHour = current.crypto?.completedHourOpen;
          const generatedRollback = isIsoTimestamp(currentGeneratedAt) &&
            Date.parse(parsed.generatedAt) < Date.parse(currentGeneratedAt);
          const completedHourRollback = isIsoTimestamp(currentCompletedHour) &&
            Date.parse(parsed.completedHourOpen) < Date.parse(currentCompletedHour);
          if (completedHourRollback ||
              (!isIsoTimestamp(currentCompletedHour) && generatedRollback) ||
              (isIsoTimestamp(currentCompletedHour) &&
                Date.parse(parsed.completedHourOpen) === Date.parse(currentCompletedHour) &&
                generatedRollback)) {
            return jsonResponse(
              { status: "rejected", error: "crypto snapshot would move backwards" },
              409,
            );
          }
          incoming = validateBaseSnapshot({ ...current, crypto: parsed });
          identity = {
            completedHourOpen: parsed.completedHourOpen,
            generatedAt: parsed.generatedAt,
            sourceRun: parsed.sourceRun,
          };
        } else {
          const currentDate = current.stockSelector?.dataThrough;
          if (isIsoDate(currentDate) && parsed.stockSelector.dataThrough < currentDate) {
            return jsonResponse(
              { status: "rejected", error: "snapshot would move backwards" },
              409,
            );
          }
          incoming = validateAcceptedSnapshot({ ...parsed, crypto: current.crypto ?? null });
          identity = { dataThrough: parsed.stockSelector.dataThrough };
        }
        const normalized = `${JSON.stringify(incoming, null, 2)}\n`;
        const digest = sha256(normalized);
        const disposition = sha256(currentText) === digest ? "reused" : "published";
        if (disposition === "published") await atomicWrite(snapshotPath, normalized);
        return jsonResponse({
          status: "accepted",
          disposition,
          ...identity,
          sha256: digest,
        });
      });
    } catch (error) {
      return jsonResponse({ status: "rejected", error: String(error?.message ?? error) }, 422);
    }
  };
}
