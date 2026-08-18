import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createDataJobsHandler,
  DATA_JOBS_PATH,
  INTERNAL_DATA_JOBS_PATH,
} from "../scripts/data-jobs.mjs";

const ADMIN_HEADERS = {
  authorization: "Bearer test-admin-token",
  "content-type": "application/json",
};
const WORKER_HEADERS = {
  authorization: "Bearer test-worker-token",
  "content-type": "application/json",
};

async function harness() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "arbitra-data-jobs-"));
  let instant = new Date("2026-08-14T12:00:00Z");
  const handler = createDataJobsHandler({
    jobsRoot: directory,
    adminToken: "test-admin-token",
    workerToken: "test-worker-token",
    signArtifact: async (key) => `https://bucket.example/download?key=${encodeURIComponent(key)}`,
    now: () => new Date(instant),
    leaseSeconds: 60,
  });
  return {
    directory,
    handler,
    setNow(value) {
      instant = new Date(value);
    },
  };
}

function request(pathname, { method = "GET", headers = ADMIN_HEADERS, body } = {}) {
  return new Request(`http://platform${pathname}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function topTenRequest(overrides = {}) {
  return {
    rangeStart: "2024-08-14",
    rangeEnd: "2026-08-13",
    universe: { type: "top_weighted", limit: 10 },
    includeRaw: true,
    createTickerBundles: true,
    ...overrides,
  };
}

async function createJob(state, payload = topTenRequest()) {
  const response = await state.handler(request(DATA_JOBS_PATH, {
    method: "POST",
    body: payload,
  }));
  assert.equal(response.status, 201);
  return (await response.json()).job;
}

test("fails closed without the platform token", async (context) => {
  const state = await harness();
  context.after(() => rm(state.directory, { recursive: true, force: true }));

  const response = await state.handler(request(DATA_JOBS_PATH, {
    headers: { "content-type": "application/json" },
  }));

  assert.equal(response.status, 401);
  assert.equal((await response.json()).status, "unauthorized");
});

test("creates and lists a bounded research-only historical job", async (context) => {
  const state = await harness();
  context.after(() => rm(state.directory, { recursive: true, force: true }));

  const job = await createJob(state);
  assert.match(job.id, /^massive-spy-/);
  assert.equal(job.status, "queued");
  assert.equal(job.request.canonicalInterval, "1m");
  assert.equal(job.request.adjusted, false);
  assert.equal(job.request.authority, "research_only");
  assert.deepEqual(job.request.universe, { type: "top_weighted", limit: 10 });

  const list = await state.handler(request(DATA_JOBS_PATH));
  assert.equal(list.status, 200);
  assert.equal((await list.json()).jobs.length, 1);
  const stored = JSON.parse(await readFile(path.join(state.directory, `${job.id}.json`), "utf8"));
  assert.equal(stored.request.requestsPerMinute, 4);
});

test("rejects dates outside the live Basic boundary and unconfirmed full scope", async (context) => {
  const state = await harness();
  context.after(() => rm(state.directory, { recursive: true, force: true }));

  const tooEarly = await state.handler(request(DATA_JOBS_PATH, {
    method: "POST",
    body: topTenRequest({ rangeStart: "2024-08-13" }),
  }));
  assert.equal(tooEarly.status, 422);
  assert.match((await tooEarly.json()).error, /2024-08-14/);

  const full = await state.handler(request(DATA_JOBS_PATH, {
    method: "POST",
    body: topTenRequest({ universe: { type: "all_constituents" } }),
  }));
  assert.equal(full.status, 422);
  assert.match((await full.json()).error, /confirmation phrase/);
});

test("worker claims, checkpoints, and completes a downloadable job", async (context) => {
  const state = await harness();
  context.after(() => rm(state.directory, { recursive: true, force: true }));
  const created = await createJob(state);

  const claim = await state.handler(request(`${INTERNAL_DATA_JOBS_PATH}/claim`, {
    method: "POST",
    headers: WORKER_HEADERS,
    body: { workerId: "worker-one" },
  }));
  assert.equal(claim.status, 200);
  const claimed = (await claim.json()).job;
  assert.equal(claimed.id, created.id);
  assert.equal(claimed.status, "running");
  assert.equal(claimed.fencingGeneration, 1);

  const progress = {
    symbolsTotal: 10,
    symbolsCompleted: 1,
    symbolsFailed: 0,
    pagesCompleted: 9,
    providerCalls: 9,
    rowsWritten: 410000,
    bytesUploaded: 1234567,
    currentTicker: "AAPL",
  };
  const heartbeat = await state.handler(request(`${INTERNAL_DATA_JOBS_PATH}/${created.id}/heartbeat`, {
    method: "POST",
    headers: WORKER_HEADERS,
    body: {
      workerId: claimed.workerId,
      fencingGeneration: claimed.fencingGeneration,
      progress,
      resume: { completedSymbols: ["NVDA"], currentTicker: "AAPL", page: 1 },
    },
  }));
  assert.equal(heartbeat.status, 200);
  assert.equal((await heartbeat.json()).job.progress.rowsWritten, 410000);

  const manifestKey = `massive/spy/${created.id}/manifest.json`;
  const complete = await state.handler(request(`${INTERNAL_DATA_JOBS_PATH}/${created.id}/complete`, {
    method: "POST",
    headers: WORKER_HEADERS,
    body: {
      workerId: claimed.workerId,
      fencingGeneration: claimed.fencingGeneration,
      progress: { ...progress, symbolsCompleted: 10, currentTicker: "" },
      artifacts: [{
        id: "manifest.json",
        kind: "manifest",
        label: "manifest.json",
        key: manifestKey,
        sha256: "a".repeat(64),
        size: 2048,
        ticker: null,
      }],
      summary: { symbolsAccepted: 10, symbolsFailed: 0 },
    },
  }));
  assert.equal(complete.status, 200);
  assert.equal((await complete.json()).job.status, "completed");

  const download = await state.handler(request(
    `${DATA_JOBS_PATH}/${created.id}/artifacts/manifest.json`,
  ));
  assert.equal(download.status, 303);
  assert.match(download.headers.get("location") ?? "", /^https:\/\/bucket\.example\/download/);
});

test("running jobs can be cancelled without being reported complete", async (context) => {
  const state = await harness();
  context.after(() => rm(state.directory, { recursive: true, force: true }));
  const created = await createJob(state);
  const claim = await state.handler(request(`${INTERNAL_DATA_JOBS_PATH}/claim`, {
    method: "POST",
    headers: WORKER_HEADERS,
    body: { workerId: "worker-one" },
  }));
  const claimed = (await claim.json()).job;

  const cancel = await state.handler(request(`${DATA_JOBS_PATH}/${created.id}/cancel`, {
    method: "POST",
    body: {},
  }));
  assert.equal((await cancel.json()).job.status, "cancel_requested");

  const workerView = await state.handler(request(`${INTERNAL_DATA_JOBS_PATH}/${created.id}`, {
    headers: WORKER_HEADERS,
  }));
  assert.equal((await workerView.json()).job.status, "cancel_requested");

  const completionAfterCancel = await state.handler(request(`${INTERNAL_DATA_JOBS_PATH}/${created.id}/complete`, {
    method: "POST",
    headers: WORKER_HEADERS,
    body: {
      workerId: claimed.workerId,
      fencingGeneration: claimed.fencingGeneration,
      progress: { symbolsTotal: 10, symbolsCompleted: 10 },
      artifacts: [{
        id: "manifest.json",
        kind: "manifest",
        label: "manifest.json",
        key: `massive/spy/${created.id}/manifest.json`,
        sha256: "a".repeat(64),
        size: 10,
        ticker: null,
      }],
    },
  }));
  assert.equal(completionAfterCancel.status, 409);

  const cancelled = await state.handler(request(`${INTERNAL_DATA_JOBS_PATH}/${created.id}/cancelled`, {
    method: "POST",
    headers: WORKER_HEADERS,
    body: {
      workerId: claimed.workerId,
      fencingGeneration: claimed.fencingGeneration,
      progress: { symbolsTotal: 10, symbolsCompleted: 1 },
    },
  }));
  assert.equal((await cancelled.json()).job.status, "cancelled");
});

test("worker checkpoints can carry a bounded full-universe resume ledger", async (context) => {
  const state = await harness();
  context.after(() => rm(state.directory, { recursive: true, force: true }));
  const created = await createJob(state);
  const claim = await state.handler(request(`${INTERNAL_DATA_JOBS_PATH}/claim`, {
    method: "POST",
    headers: WORKER_HEADERS,
    body: { workerId: "worker-one" },
  }));
  const claimed = (await claim.json()).job;

  const heartbeat = await state.handler(request(`${INTERNAL_DATA_JOBS_PATH}/${created.id}/heartbeat`, {
    method: "POST",
    headers: WORKER_HEADERS,
    body: {
      workerId: claimed.workerId,
      fencingGeneration: claimed.fencingGeneration,
      progress: { symbolsTotal: 503, symbolsCompleted: 400 },
      resume: { checkpointEvidence: "x".repeat(300 * 1024) },
    },
  }));

  assert.equal(heartbeat.status, 200);
  assert.equal((await heartbeat.json()).job.resume.checkpointEvidence.length, 300 * 1024);
});

test("expired running leases are reclaimed with checkpoint state intact", async (context) => {
  const state = await harness();
  context.after(() => rm(state.directory, { recursive: true, force: true }));
  const created = await createJob(state);
  const firstClaim = await state.handler(request(`${INTERNAL_DATA_JOBS_PATH}/claim`, {
    method: "POST",
    headers: WORKER_HEADERS,
    body: { workerId: "worker-one" },
  }));
  const firstWorker = (await firstClaim.json()).job;
  await state.handler(request(`${INTERNAL_DATA_JOBS_PATH}/${created.id}/heartbeat`, {
    method: "POST",
    headers: WORKER_HEADERS,
    body: {
      workerId: firstWorker.workerId,
      fencingGeneration: firstWorker.fencingGeneration,
      progress: { symbolsTotal: 10, symbolsCompleted: 2 },
      resume: { completedSymbols: ["NVDA", "AAPL"] },
    },
  }));
  state.setNow("2026-08-14T12:02:00Z");

  const reclaimed = await state.handler(request(`${INTERNAL_DATA_JOBS_PATH}/claim`, {
    method: "POST",
    headers: WORKER_HEADERS,
    body: { workerId: "worker-two" },
  }));
  const job = (await reclaimed.json()).job;
  assert.equal(job.id, created.id);
  assert.equal(job.workerId, "worker-two");
  assert.equal(job.fencingGeneration, 2);
  assert.deepEqual(job.resume.completedSymbols, ["NVDA", "AAPL"]);

  const stale = await state.handler(request(`${INTERNAL_DATA_JOBS_PATH}/${created.id}/heartbeat`, {
    method: "POST",
    headers: WORKER_HEADERS,
    body: {
      workerId: firstWorker.workerId,
      fencingGeneration: firstWorker.fencingGeneration,
      progress: { symbolsTotal: 10, symbolsCompleted: 3 },
      resume: {},
    },
  }));
  assert.equal(stale.status, 409);
});

test("a process-crash lock is recovered without abandoning the ledger", async (context) => {
  const state = await harness();
  context.after(() => rm(state.directory, { recursive: true, force: true }));
  const lockPath = path.join(state.directory, ".ledger.lock");
  await writeFile(lockPath, "abandoned", "utf8");
  await utimes(lockPath, new Date(0), new Date(0));

  const created = await createJob(state);

  assert.equal(created.status, "queued");
});
