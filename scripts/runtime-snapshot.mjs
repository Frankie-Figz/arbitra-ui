import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

export const PUBLIC_SNAPSHOT_PATH = "/data/arbitra-snapshot.json";
export const INGEST_SNAPSHOT_PATH = "/internal/stock-selector-snapshot";

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
  maximumBytes = 8 * 1024 * 1024,
}) {
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

    if (pathname !== INGEST_SNAPSHOT_PATH) return null;
    if (!authorized(request, ingestToken)) {
      return jsonResponse(
        { status: "unauthorized" },
        401,
        { "www-authenticate": "Bearer" },
      );
    }
    if (request.method === "GET" || request.method === "HEAD") {
      const { text } = await currentSnapshot();
      return new Response(request.method === "HEAD" ? null : text, {
        status: 200,
        headers: { ...JSON_HEADERS, "content-length": String(Buffer.byteLength(text)) },
      });
    }
    if (request.method !== "POST") {
      return jsonResponse({ status: "method_not_allowed" }, 405, { allow: "GET, HEAD, POST" });
    }

    try {
      const incomingText = await readLimitedBody(request, maximumBytes);
      const incoming = validateAcceptedSnapshot(JSON.parse(incomingText));
      const { snapshot: current, text: currentText } = await currentSnapshot();
      const currentDate = current.stockSelector?.dataThrough;
      if (isIsoDate(currentDate) && incoming.stockSelector.dataThrough < currentDate) {
        return jsonResponse({ status: "rejected", error: "snapshot would move backwards" }, 409);
      }
      const normalized = `${JSON.stringify(incoming, null, 2)}\n`;
      const digest = sha256(normalized);
      const disposition = sha256(currentText) === digest ? "reused" : "published";
      if (disposition === "published") await atomicWrite(snapshotPath, normalized);
      return jsonResponse({
        status: "accepted",
        disposition,
        dataThrough: incoming.stockSelector.dataThrough,
        sha256: digest,
      });
    } catch (error) {
      return jsonResponse({ status: "rejected", error: String(error?.message ?? error) }, 422);
    }
  };
}
