import assert from "node:assert/strict";
import test from "node:test";

import { createOasisCatalogHandler } from "../scripts/oasis-catalog.mjs";
import { createOasisDataJobsHandler } from "../scripts/oasis-data-jobs.mjs";

const ADMIN = "admin-test-token";
const WORKER = "worker-test-token";
const NOW = new Date("2026-08-16T12:00:00Z");

function request(path, { method = "GET", token, body, headers = {} } = {}) {
  return new Request(`https://platform.example${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function baseJob(overrides = {}) {
  return {
    schemaVersion: 2,
    id: "massive-spy-2026-08-16T120000-000Z-aaaaaaaaaaaa",
    status: "queued",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    request: {},
    progress: {
      symbolsTotal: 0, symbolsCompleted: 0, symbolsFailed: 0, pagesCompleted: 0,
      providerCalls: 0, rowsWritten: 0, bytesUploaded: 0, currentTicker: "",
    },
    artifacts: [],
    ...overrides,
  };
}

function publicationFixture() {
  const sha = "a".repeat(64);
  const recordId = `oasis.record.v1.${"b".repeat(64)}`;
  const locatorId = `oasis.locator.v1.${"c".repeat(64)}`;
  const at = "2026-08-16T12:00:00Z";
  return {
    schema_version: 1,
    publication_id: `oasis.publication.v1.${"d".repeat(64)}`,
    result_record_id: recordId,
    records: [{
      record: {
        schema_version: 1,
        dataset_version_id: "elijah.test.spy.1m.v1",
        origin_kind: "atomic",
        data_mode: "separate",
        identity: {
          scope_id: "stream.massive.spy.1m", asset_id: "asset.spy",
          venue_id: "venue.us", instrument_id: "instrument.spy",
          market_type: "us_listed_security", quote_asset: "USD", timeframe: "1m",
          calendar_id: "calendar.us-equities", source_id: "provider.massive",
        },
        lineage: {
          dataset_manifest_sha256: sha, implementation_sha256: sha,
          schema_id: "elijah-v1", schema_version: 1,
          transformation_id: null, transformation_parameters_sha256: null,
        },
        availability: {
          event_start: at, event_end: at, information_cutoff: at,
          observed_at: at, recorded_at: at,
          observed_at_status: "known", recorded_at_status: "known",
        },
        quality: {
          status: "quality_blocked", ruleset_id: "quality.elijah-v1",
          ruleset_sha256: sha, assessment_implementation_sha256: sha,
          report_sha256: sha, assessed_at: at, natural_coverage: 0,
          matched_coverage: 0, gap_count: 0, stale_count: 0,
          reason: "calendar completeness is unavailable",
        },
        payload: {
          store_id: "store.test", object_key: `objects/sha256/aa/${sha}`,
          sha256: sha, size_bytes: 100, payload_schema_id: "ticker-bundle-v1",
          row_clock_schema_id: "row-clocks-unavailable-v1",
        },
        members: [], supersedes_dataset_version_id: null,
        record_id: recordId, locator_id: locatorId,
      },
      quality_assessment_id: `oasis.quality.v1.${"e".repeat(64)}`,
      dataset_event_id: `oasis.dataset-event.v1.${"f".repeat(64)}`,
      dataset_event_sha256: sha,
      dataset_event_kind: "quarantined",
      dataset_event_details: { quality_status: "quality_blocked" },
    }],
    locator_events: [{
      schema_version: 1, record_id: recordId,
      dataset_version_id: "elijah.test.spy.1m.v1", locator_id: locatorId,
      store_id: "store.test", object_key: `objects/sha256/aa/${sha}`,
      payload_sha256: sha, size_bytes: 100, kind: "registered", recorded_at: at,
      supersedes_locator_event_id: null, reason: null,
      locator_event_id: `oasis.locator-event.v1.${"1".repeat(64)}`,
    }],
    catalog: {
      assets: [
        { asset_id: "currency.usd", definition_sha256: sha, definition: { code: "USD" }, recorded_at: at },
        { asset_id: "asset.spy", definition_sha256: sha, definition: { ticker: "SPY" }, recorded_at: at },
      ],
      venues: [{ venue_id: "venue.us", definition_sha256: sha, definition: { country: "US" }, recorded_at: at }],
      instruments: [{
        instrument_id: "instrument.spy", venue_id: "venue.us", base_asset_id: "asset.spy",
        quote_asset_id: "currency.usd", market_type: "us_listed_security",
        venue_symbol: "SPY", definition_sha256: sha, definition: { ticker: "SPY" }, recorded_at: at,
      }],
      market_streams: [{
        market_stream_id: "stream.massive.spy.1m", instrument_id: "instrument.spy",
        source_id: "provider.massive", timeframe: "1m", calendar_id: "calendar.us-equities",
        timestamp_convention: "utc_window_start", completion_rule: "closed_page",
        price_unit: "USD_per_security", volume_unit: "security_units",
        definition_sha256: sha, definition: { timeframe: "1m" }, recorded_at: at,
      }],
    },
    transformation_specs: [],
    artifacts: [{
      id: "manifest.json", kind: "manifest", label: "manifest.json",
      key: "massive/spy/test/manifest.json", sha256: sha, size: 100, ticker: null,
    }],
  };
}

test("PostgreSQL job handler preserves routes and requires worker fences", async () => {
  let job = baseJob();
  const calls = [];
  const store = {
    async listJobs() { return [job]; },
    async getJob() { return job; },
    async createJob(candidate, occurredAt, idempotencyKey) {
      calls.push({ kind: "create", candidate, occurredAt, idempotencyKey });
      job = baseJob({ id: candidate.id, request: candidate.request });
      return job;
    },
    async cancelJob() { return { ...job, status: "cancelled" }; },
    async claimJob(workerId) {
      job = { ...job, status: "running", workerId, fencingGeneration: 1 };
      return job;
    },
    async heartbeatJob(id, workerId, generation) {
      calls.push({ kind: "heartbeat", id, workerId, generation });
      return job;
    },
    async admitPublication(id, workerId, generation, publication) {
      calls.push({ kind: "admit", id, workerId, generation, publication });
      return { publicationId: publication.publication_id, resultRecordId: publication.result_record_id };
    },
    async completeManifestJob(id, workerId, generation, progress, resultRecordId, summary) {
      calls.push({ kind: "complete-manifest", id, workerId, generation, progress, resultRecordId, summary });
      return { ...job, status: "completed", completionKind: "manifest_backed" };
    },
    async completeLegacyJob() { return { ...job, status: "completed" }; },
    async finishJob() { return { ...job, status: "failed" }; },
  };
  const handler = createOasisDataJobsHandler({
    store, adminToken: ADMIN, workerToken: WORKER, now: () => NOW,
  });

  const created = await handler(request("/api/data-jobs", {
    method: "POST",
    token: ADMIN,
    headers: { "idempotency-key": "test-retry-key" },
    body: {
      rangeStart: "2026-08-15",
      rangeEnd: "2026-08-15",
      universe: { type: "symbols", symbols: ["SPY"] },
    },
  }));
  assert.equal(created.status, 201);
  assert.equal(calls[0].idempotencyKey, "test-retry-key");

  const claim = await handler(request("/internal/data-jobs/claim", {
    method: "POST", token: WORKER, body: { workerId: "worker-one" },
  }));
  assert.equal((await claim.json()).job.fencingGeneration, 1);

  const missingFence = await handler(request(`/internal/data-jobs/${job.id}/heartbeat`, {
    method: "POST", token: WORKER, body: { progress: {} },
  }));
  assert.equal(missingFence.status, 422);

  const booleanFence = await handler(request(`/internal/data-jobs/${job.id}/heartbeat`, {
    method: "POST",
    token: WORKER,
    body: { workerId: "worker-one", fencingGeneration: true, progress: {}, resume: {} },
  }));
  assert.equal(booleanFence.status, 422);

  const heartbeat = await handler(request(`/internal/data-jobs/${job.id}/heartbeat`, {
    method: "POST",
    token: WORKER,
    body: { workerId: "worker-one", fencingGeneration: 1, progress: {}, resume: {} },
  }));
  assert.equal(heartbeat.status, 200);
  assert.deepEqual(calls.at(-1), {
    kind: "heartbeat", id: job.id, workerId: "worker-one", generation: 1,
  });

  const publication = publicationFixture();
  const admission = await handler(request(`/internal/data-jobs/${job.id}/admit`, {
    method: "POST", token: WORKER,
    body: { workerId: "worker-one", fencingGeneration: 1, publication },
  }));
  assert.equal(admission.status, 200);
  assert.equal(calls.at(-1).kind, "admit");

  const secretBearing = structuredClone(publication);
  secretBearing.catalog.assets[0].definition.apiKey = "plaintext";
  const rejected = await handler(request(`/internal/data-jobs/${job.id}/admit`, {
    method: "POST", token: WORKER,
    body: { workerId: "worker-one", fencingGeneration: 1, publication: secretBearing },
  }));
  assert.equal(rejected.status, 422);
  assert.equal(calls.at(-1).kind, "admit");

  const completion = await handler(request(`/internal/data-jobs/${job.id}/complete-manifest`, {
    method: "POST", token: WORKER,
    body: {
      workerId: "worker-one", fencingGeneration: 1, progress: {},
      resultRecordId: publication.result_record_id, summary: { disposition: "quality_blocked" },
    },
  }));
  assert.equal(completion.status, 200);
  assert.equal(calls.at(-1).kind, "complete-manifest");
});

test("catalog API is read-only, paginated, authenticated, and never lists buckets", async () => {
  const calls = [];
  const recordId = `oasis.record.v1.${"a".repeat(64)}`;
  const store = {
    async readiness() { return { ready: true, expectedMigrations: [], actualMigrations: [] }; },
    async listDatasets(input) { calls.push(input); return [{ record_id: recordId }]; },
    async getDataset() { return { dataset: { record_id: recordId }, members: [] }; },
    async latestDownloadLocator() { return { object_key: "objects/sha256/aa/value", dataset_version_id: "dataset.v1" }; },
    async listExperimentReferences() { return []; },
    async listParameterLocks() { return []; },
    async listUpstreamEvidence(input) { calls.push({ evidence: input }); return []; },
  };
  const handler = createOasisCatalogHandler({
    store,
    adminToken: ADMIN,
    signArtifact: async (key) => `https://signed.example/${key}`,
  });
  assert.equal((await handler(request("/api/data-catalog/v1/health"))).status, 200);
  assert.equal((await handler(request("/api/data-catalog/v1/datasets"))).status, 401);
  assert.equal((await handler(request("/api/data-catalog/v1/datasets", {
    method: "POST", token: ADMIN,
  }))).status, 405);
  const listed = await handler(request("/api/data-catalog/v1/datasets?limit=1", { token: ADMIN }));
  assert.equal(listed.status, 200);
  assert.deepEqual(calls, [{ limit: 1, after: null }]);
  const evidence = await handler(request(
    "/api/data-catalog/v1/upstream-evidence?limit=2", { token: ADMIN },
  ));
  assert.equal(evidence.status, 200);
  assert.deepEqual(calls.at(-1), { evidence: { limit: 2, after: null } });
  const download = await handler(request(
    `/api/data-catalog/v1/datasets/${recordId}/download`, { token: ADMIN },
  ));
  assert.match((await download.json()).url, /^https:\/\/signed\.example\//);
});
