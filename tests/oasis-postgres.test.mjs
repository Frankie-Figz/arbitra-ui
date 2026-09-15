import assert from "node:assert/strict";
import test from "node:test";

import {
  OASIS_MIGRATIONS,
  OasisPostgresJobStore,
  canonicalJson,
  sha256Json,
} from "../scripts/oasis-postgres.mjs";

test("canonical JSON and request hashes ignore object key order", () => {
  assert.equal(canonicalJson({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
  assert.equal(sha256Json({ b: 2, a: 1 }), sha256Json({ a: 1, b: 2 }));
});

test("readiness requires the exact ordered Oasis migration set", async () => {
  const pool = {
    async query() {
      return { rows: OASIS_MIGRATIONS.map((migration_id) => ({ migration_id })) };
    },
  };
  const readiness = await new OasisPostgresJobStore({ pool }).readiness();
  assert.equal(readiness.ready, true);
  pool.query = async () => ({ rows: [{ migration_id: "001_foundation" }] });
  assert.equal((await new OasisPostgresJobStore({ pool }).readiness()).ready, false);
});

test("job creation binds caller idempotency and canonical request hash", async () => {
  const calls = [];
  const row = {
    ingestion_run_id: "massive-spy-2026-08-16T120000-000Z-aaaaaaaaaaaa",
    status: "queued",
    created_at: new Date("2026-08-16T12:00:00Z"),
    updated_at: new Date("2026-08-16T12:00:00Z"),
    request: { provider: "massive" },
    progress: {},
    checkpoint: {},
    summary: {},
    fencing_generation: 0,
  };
  const pool = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      if (sql.includes("ingestion_artifact")) return { rows: [] };
      return { rows: [row] };
    },
  };
  const store = new OasisPostgresJobStore({ pool });
  const job = await store.createJob(
    { id: row.ingestion_run_id, request: row.request },
    new Date("2026-08-16T12:00:00Z"),
    "caller-retry-key",
  );
  assert.equal(job.id, row.ingestion_run_id);
  assert.equal(calls[0].parameters[1], "caller-retry-key");
  assert.equal(calls[0].parameters[2], sha256Json(row.request));
  assert.match(calls[0].sql, /create_ingestion_run/);
});
