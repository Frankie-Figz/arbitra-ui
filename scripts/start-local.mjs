import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createRuntimeSnapshotHandler } from "./runtime-snapshot.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const clientRoot = path.join(projectRoot, "dist", "client");
const workerUrl = new URL("../dist/server/index.js", import.meta.url);
const runtimeSnapshotPath = process.env.ARBITRA_RUNTIME_SNAPSHOT_PATH ??
  "/data/arbitra-snapshot.json";

const contentTypes = new Map([
  [".avif", "image/avif"],
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function clientPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const relativePath = decoded.replace(/^\/+/, "").replaceAll("/", path.sep);
  const resolvedPath = path.resolve(clientRoot, relativePath);
  const clientPrefix = `${path.resolve(clientRoot)}${path.sep}`;
  return resolvedPath.startsWith(clientPrefix) ? resolvedPath : null;
}

async function fileMetadata(requestUrl) {
  const pathname = new URL(requestUrl).pathname;
  if (pathname === "/") return null;

  const filePath = clientPath(pathname);
  if (!filePath) return null;

  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile() ? { filePath, fileStat } : null;
  } catch {
    return null;
  }
}

function cacheControl(filePath) {
  return filePath.includes(`${path.sep}assets${path.sep}`)
    ? "public, max-age=31536000, immutable"
    : "public, max-age=0, must-revalidate";
}

async function staticResponse(request) {
  const metadata = await fileMetadata(request.url);
  if (!metadata) return null;

  const headers = new Headers({
    "cache-control": cacheControl(metadata.filePath),
    "content-length": String(metadata.fileStat.size),
    "content-type": contentTypes.get(path.extname(metadata.filePath).toLowerCase()) ??
      "application/octet-stream",
  });

  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(Readable.toWeb(createReadStream(metadata.filePath)), { status: 200, headers });
}

function toWebRequest(request, hostname, port) {
  const forwardedProto = request.headers["x-forwarded-proto"] ?? "http";
  const host = request.headers.host ?? `${hostname}:${port}`;
  const method = request.method ?? "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : Readable.toWeb(request);

  return new Request(`${forwardedProto}://${host}${request.url}`, {
    method,
    headers: request.headers,
    body,
    ...(body ? { duplex: "half" } : {}),
  });
}

async function writeResponse(nodeResponse, webResponse, method) {
  nodeResponse.statusCode = webResponse.status;
  nodeResponse.statusMessage = webResponse.statusText;

  for (const [name, value] of webResponse.headers) {
    if (name !== "set-cookie") nodeResponse.setHeader(name, value);
  }
  const cookies = webResponse.headers.getSetCookie?.() ?? [];
  if (cookies.length) nodeResponse.setHeader("set-cookie", cookies);

  if (method === "HEAD" || !webResponse.body) {
    nodeResponse.end();
    return;
  }
  Readable.fromWeb(webResponse.body).pipe(nodeResponse);
}

const hostname = option("hostname", process.env.HOST ?? "127.0.0.1");
const port = Number(option("port", process.env.PORT ?? "3001"));
const { default: worker } = await import(workerUrl.href);
const executionContext = { waitUntil() {}, passThroughOnException() {} };
const assets = {
  async fetch(request) {
    return (await staticResponse(request)) ?? new Response("Not found", { status: 404 });
  },
};
const runtimeSnapshotResponse = createRuntimeSnapshotHandler({
  snapshotPath: runtimeSnapshotPath,
  fallbackPath: path.join(clientRoot, "data", "arbitra-snapshot.json"),
  ingestToken: process.env.ARBITRA_UI_INGEST_TOKEN ?? "",
});

const server = createServer(async (request, response) => {
  try {
    const webRequest = toWebRequest(request, hostname, port);
    const result = (await runtimeSnapshotResponse(webRequest)) ??
      (await staticResponse(webRequest)) ??
      (await worker.fetch(webRequest, { ASSETS: assets }, executionContext));
    await writeResponse(response, result, webRequest.method);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("Internal server error");
  }
});

server.listen(port, hostname, () => {
  console.log(`Arbitra Daily Longs: http://${hostname}:${port}`);
});
