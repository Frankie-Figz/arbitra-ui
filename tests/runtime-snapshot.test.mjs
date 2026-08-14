import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createRuntimeSnapshotHandler,
  INGEST_SNAPSHOT_PATH,
  PUBLIC_SNAPSHOT_PATH,
} from "../scripts/runtime-snapshot.mjs";

const root = new URL("../", import.meta.url);

async function fixture() {
  const snapshot = JSON.parse(
    await readFile(new URL("public/data/arbitra-snapshot.json", root), "utf8"),
  );
  const latest = snapshot.datasets.find((dataset) => dataset.assets.length > 0);
  snapshot.stockSelector = {
    ...snapshot.stockSelector,
    status: "accepted",
    dataThrough: latest.date,
    universe: latest.universe,
    analyzed: latest.exactDateAnalyzed + latest.staleAnalyzed,
    stale: latest.staleAnalyzed,
    historyMissing: latest.historyMissing,
    analysisFailed: latest.analysisFailed,
    qualityRejected: latest.qualityRejected,
    opportunities: latest.assets.length,
    deploymentAllowed: false,
    ordersSubmitted: 0,
  };
  return snapshot;
}

async function harness() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "arbitra-ui-runtime-"));
  const fallbackPath = path.join(directory, "fallback.json");
  const snapshotPath = path.join(directory, "state", "arbitra-snapshot.json");
  const snapshot = await fixture();
  await writeFile(fallbackPath, `${JSON.stringify(snapshot)}\n`, "utf8");
  const handler = createRuntimeSnapshotHandler({
    snapshotPath,
    fallbackPath,
    ingestToken: "test-ingest-token",
  });
  return { directory, fallbackPath, handler, snapshot, snapshotPath };
}

test("serves the bundled snapshot until a runtime snapshot is accepted", async (context) => {
  const state = await harness();
  context.after(() => rm(state.directory, { recursive: true, force: true }));
  const response = await state.handler(new Request(`http://ui${PUBLIC_SNAPSHOT_PATH}`));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).stockSelector.status, "accepted");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("rejects unauthenticated publication without changing state", async (context) => {
  const state = await harness();
  context.after(() => rm(state.directory, { recursive: true, force: true }));
  const response = await state.handler(new Request(`http://ui${INGEST_SNAPSHOT_PATH}`, {
    method: "POST",
    body: JSON.stringify(state.snapshot),
    headers: { "content-type": "application/json" },
  }));
  assert.equal(response.status, 401);
  await assert.rejects(readFile(state.snapshotPath), { code: "ENOENT" });
});

test("atomically accepts a research-only whole-market snapshot", async (context) => {
  const state = await harness();
  context.after(() => rm(state.directory, { recursive: true, force: true }));
  const response = await state.handler(new Request(`http://ui${INGEST_SNAPSHOT_PATH}`, {
    method: "POST",
    body: JSON.stringify(state.snapshot),
    headers: {
      authorization: "Bearer test-ingest-token",
      "content-type": "application/json",
    },
  }));
  assert.equal(response.status, 200);
  const receipt = await response.json();
  assert.equal(receipt.status, "accepted");
  assert.match(receipt.sha256, /^[0-9a-f]{64}$/);
  const stored = JSON.parse(await readFile(state.snapshotPath, "utf8"));
  assert.equal(stored.stockSelector.dataThrough, state.snapshot.stockSelector.dataThrough);
  assert.equal(stored.deploymentAllowed, false);
});

test("rejects rollback and capital-authority payloads", async (context) => {
  const state = await harness();
  context.after(() => rm(state.directory, { recursive: true, force: true }));
  const publish = (snapshot) => state.handler(new Request(`http://ui${INGEST_SNAPSHOT_PATH}`, {
    method: "POST",
    body: JSON.stringify(snapshot),
    headers: {
      authorization: "Bearer test-ingest-token",
      "content-type": "application/json",
    },
  }));

  assert.equal((await publish(state.snapshot)).status, 200);
  const unsafe = structuredClone(state.snapshot);
  unsafe.deploymentAllowed = true;
  assert.equal((await publish(unsafe)).status, 422);

  const older = structuredClone(state.snapshot);
  const acceptedDataset = older.datasets.find(
    (dataset) => dataset.date === older.stockSelector.dataThrough,
  );
  older.stockSelector.dataThrough = "2026-01-01";
  acceptedDataset.date = "2026-01-01";
  for (const asset of acceptedDataset.assets) asset.signalDate = "2026-01-01";
  assert.equal((await publish(older)).status, 409);
  const stored = JSON.parse(await readFile(state.snapshotPath, "utf8"));
  assert.equal(stored.stockSelector.dataThrough, state.snapshot.stockSelector.dataThrough);
});
