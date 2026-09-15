import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import {
  OasisPostgresJobStore,
  OasisPostgresCatalogStore,
  createOasisPool,
} from "../scripts/oasis-postgres.mjs";
import { oasisPublicationFixture } from "./oasis-publication-fixture.mjs";

const databaseUrl = process.env.OASIS_TEST_DATABASE_URL;
const ingestDatabaseUrl = process.env.OASIS_TEST_INGEST_DATABASE_URL ?? databaseUrl;

test("PostgreSQL job lifecycle is idempotent and stale-worker fenced", {
  skip: !databaseUrl,
}, async () => {
  const pool = createOasisPool(databaseUrl, { max: 2 });
  try {
    const store = new OasisPostgresJobStore({ pool, leaseSeconds: 30 });
    assert.equal((await store.readiness()).ready, true);
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const id = `massive-spy-2026-08-16T120000-000Z-${suffix}`;
    const request = { provider: "massive", rangeStart: "2026-08-15", rangeEnd: "2026-08-15" };
    const created = await store.createJob(
      { id, request }, new Date("2026-08-16T12:00:00Z"), `integration:${suffix}`,
    );
    assert.equal(created.status, "queued");
    const duplicate = await store.createJob(
      { id: `${id.slice(0, -12)}bbbbbbbbbbbb`, request },
      new Date("2026-08-16T12:00:01Z"),
      `integration:${suffix}`,
    );
    assert.equal(duplicate.id, id);

    const first = await store.claimJob("worker-one", new Date("2026-08-16T12:00:02Z"));
    assert.equal(first.fencingGeneration, 1);
    await store.heartbeatJob(
      id, "worker-one", 1, { rowsWritten: 1 }, { page: 1 },
      new Date("2026-08-16T12:00:03Z"),
    );
    const reclaimed = await store.claimJob("worker-two", new Date("2026-08-16T12:01:00Z"));
    assert.equal(reclaimed.fencingGeneration, 2);
    await assert.rejects(
      store.heartbeatJob(
        id, "worker-one", 1, {}, {}, new Date("2026-08-16T12:01:01Z"),
      ),
      (error) => error?.code === "55000",
    );
    const completed = await store.completeLegacyJob(
      id,
      "worker-two",
      2,
      { rowsWritten: 1 },
      [{
        id: "manifest.json",
        kind: "manifest",
        label: "manifest.json",
        key: `massive/spy/${id}/manifest.json`,
        sha256: "a".repeat(64),
        size: 100,
        ticker: null,
      }],
      { symbolsAccepted: 1 },
      new Date("2026-08-16T12:01:02Z"),
    );
    assert.equal(completed.status, "completed");
    assert.equal(completed.completionKind, "legacy_unadmitted");
    assert.equal(completed.artifacts.length, 1);
  } finally {
    await pool.end();
  }
});

test("PostgreSQL upstream evidence is append-only and catalog-queryable", {
  skip: !databaseUrl,
}, async () => {
  const pool = createOasisPool(databaseUrl, { max: 2 });
  const suffix = randomUUID();
  const digest = createHash("sha256").update(suffix).digest("hex");
  const evidenceId = `oasis.upstream-evidence.v1.${digest}`;
  const client = await pool.connect();
  try {
    await client.query("SET ROLE oasis_ingest");
    await client.query(
      `INSERT INTO lake.upstream_evidence (
         evidence_id, upstream_id, increment_id, schema_id, adapter_id, status,
         repository_relative_path, manifest_sha256, limitations
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [
        evidenceId,
        `integration-${suffix}`,
        "0.0.3-the-academia-increment",
        "upstream.integration.v1",
        "oasis.adapter.integration.v1",
        "manifest_only",
        "config/integration.json",
        digest,
        JSON.stringify(["integration_only"]),
      ],
    );
    await assert.rejects(
      client.query(
        "UPDATE lake.upstream_evidence SET status = 'unavailable' WHERE evidence_id = $1",
        [evidenceId],
      ),
      (error) => error?.code === "42501" || error?.code === "55000",
    );
    await client.query("RESET ROLE");
    const rows = await new OasisPostgresCatalogStore({ pool }).listUpstreamEvidence({
      limit: 100,
      after: null,
    });
    assert.ok(rows.some((row) => row.evidence_id === evidenceId));
  } finally {
    client.release();
    await pool.end();
  }
});

test("PostgreSQL admits and retries a manifest-backed Elijah publication", {
  skip: !databaseUrl,
}, async () => {
  const pool = createOasisPool(databaseUrl, { max: 2 });
  const ingestPool = createOasisPool(ingestDatabaseUrl, { max: 2 });
  try {
    const adminStore = new OasisPostgresJobStore({ pool, leaseSeconds: 60 });
    const store = new OasisPostgresJobStore({ pool: ingestPool, leaseSeconds: 60 });
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const id = `massive-spy-2026-08-16T120000-000Z-${suffix}`;
    const request = {
      provider: "massive", rangeStart: "2026-08-15", rangeEnd: "2026-08-15",
      universe: { type: "symbols", symbols: ["SPY"] },
    };
    await adminStore.createJob(
      { id, request }, new Date("2026-08-16T12:00:00Z"), `manifest:${suffix}`,
    );
    const claimed = await store.claimJob("manifest-worker", new Date("2026-08-16T12:00:01Z"));
    assert.equal(claimed.id, id);
    const publication = oasisPublicationFixture(suffix);
    const first = await store.admitPublication(
      id, "manifest-worker", 1, publication, new Date("2026-08-16T12:00:02Z"),
    );
    assert.equal(first.resultRecordId, publication.result_record_id);
    assert.equal(first.recordsAdmitted, 2);
    const retry = await store.admitPublication(
      id, "manifest-worker", 1, publication, new Date("2026-08-16T12:00:03Z"),
    );
    assert.deepEqual(retry, first);

    const before = await new OasisPostgresCatalogStore({ pool }).getDataset(
      publication.result_record_id,
    );
    assert.equal(before.dataset.origin_kind, "derived");
    assert.equal(before.members.length, 1);
    assert.equal(before.qualityAssessments[0].status, "quality_blocked");

    const completed = await store.completeManifestJob(
      id,
      "manifest-worker",
      1,
      { rowsWritten: 2 },
      publication.result_record_id,
      { disposition: "quality_blocked" },
      new Date("2026-08-16T12:00:04Z"),
    );
    assert.equal(completed.status, "completed");
    assert.equal(completed.completionKind, "manifest_backed");
    assert.equal(completed.resultRecordId, publication.result_record_id);
    assert.equal(completed.summary.disposition, "quality_blocked");
    assert.equal(completed.artifacts.length, 1);

    const counts = await pool.query(
      `SELECT
         (SELECT count(*) FROM lake.dataset_version
           WHERE record_id = ANY($1::text[]))::integer AS datasets,
         (SELECT count(*) FROM operations.ingestion_object
           WHERE ingestion_run_id = $2)::integer AS acknowledged_objects`,
      [publication.records.map((entry) => entry.record.record_id), id],
    );
    assert.deepEqual(counts.rows[0], { datasets: 2, acknowledged_objects: 2 });

    const secondSuffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const secondId = `massive-spy-2026-08-16T130000-000Z-${secondSuffix}`;
    await adminStore.createJob(
      { id: secondId, request }, new Date("2026-08-16T13:00:00Z"),
      `manifest:${secondSuffix}`,
    );
    const secondClaim = await store.claimJob(
      "manifest-worker", new Date("2026-08-16T13:00:01Z"),
    );
    assert.equal(secondClaim.id, secondId);
    const secondPublication = oasisPublicationFixture(secondSuffix);
    for (const group of Object.values(secondPublication.catalog)) {
      for (const entry of group) entry.recorded_at = "2026-08-16T13:00:00Z";
    }
    const secondAdmission = await store.admitPublication(
      secondId,
      "manifest-worker",
      1,
      secondPublication,
      new Date("2026-08-16T13:00:02Z"),
    );
    assert.equal(secondAdmission.recordsAdmitted, 2);
  } finally {
    await ingestPool.end();
    await pool.end();
  }
});
