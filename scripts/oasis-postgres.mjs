import { createHash } from "node:crypto";

import pg from "pg";

const { Pool } = pg;

export const OASIS_MIGRATIONS = Object.freeze([
  "001_foundation",
  "002_invariants",
  "003_roles",
  "004_ingestion_ledger",
  "005_upstream_evidence",
]);

// Worker-path functions granted to oasis_ingest by 004_ingestion_ledger. The
// migration readiness check cannot see these, so a connection holding only
// oasis_api passes readiness and then fails every claim at runtime.
export const OASIS_INGEST_FUNCTIONS = Object.freeze([
  "operations.claim_next_ingestion_run(text, integer, timestamptz)",
  "operations.heartbeat_ingestion_run(text, text, bigint, jsonb, jsonb, integer, timestamptz)",
  "operations.acknowledge_ingestion_object(text, text, bigint, text, text, text, timestamptz)",
  "operations.complete_ingestion_run(text, text, bigint, text, jsonb, timestamptz)",
  "operations.complete_legacy_ingestion_run(text, text, bigint, jsonb, jsonb, jsonb, timestamptz)",
  "operations.finish_ingestion_run(text, text, bigint, text, text, text, timestamptz)",
]);

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256Json(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function iso(value) {
  if (value == null) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function artifactFromRow(row) {
  return {
    id: row.artifact_id,
    kind: row.kind,
    label: row.label,
    key: row.object_key,
    sha256: row.payload_sha256,
    size: Number(row.size_bytes),
    ticker: row.ticker,
  };
}

function jobFromRow(row, artifacts = []) {
  const job = {
    schemaVersion: 2,
    id: row.ingestion_run_id,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    request: row.request,
    progress: row.progress ?? {},
    artifacts,
    error: row.error_summary ?? null,
    summary: row.summary ?? {},
    completionKind: row.completion_kind ?? null,
  };
  if (row.worker_id) job.workerId = row.worker_id;
  if (row.fencing_generation != null) job.fencingGeneration = Number(row.fencing_generation);
  if (row.lease_until) job.leaseUntil = iso(row.lease_until);
  if (row.checkpoint && Object.keys(row.checkpoint).length) job.resume = row.checkpoint;
  if (row.result_record_id) job.resultRecordId = row.result_record_id;
  if (row.finished_at) job.finishedAt = iso(row.finished_at);
  return job;
}

function conflict(message) {
  const error = new Error(message);
  error.code = "23505";
  return error;
}

async function ensureJsonRows(client, {
  table,
  idColumn,
  columns,
  compareColumns = columns,
  rows,
  label,
}) {
  if (!rows.length) return;
  const idColumns = Array.isArray(idColumn) ? idColumn : [idColumn];
  const projections = columns.map(({ column, key = column, cast = "text" }) =>
    cast === "jsonb"
      ? `(item->'${key}')::jsonb AS ${column}`
      : `(item->>'${key}')::${cast} AS ${column}`
  ).join(", ");
  const names = columns.map(({ column }) => column).join(", ");
  await client.query(
    `WITH input AS (
       SELECT ${projections} FROM jsonb_array_elements($1::jsonb) AS item
     )
     INSERT INTO ${table} (${names}) SELECT ${names} FROM input
     ON CONFLICT DO NOTHING`,
    [JSON.stringify(rows)],
  );
  const comparisons = compareColumns.map(({ column }) =>
    `actual.${column} IS NOT DISTINCT FROM input.${column}`
  ).join(" AND ");
  const checked = await client.query(
    `WITH input AS (
       SELECT ${projections} FROM jsonb_array_elements($1::jsonb) AS item
     )
     SELECT count(*)::integer AS mismatch_count
       FROM input LEFT JOIN ${table} actual USING (${idColumns.join(", ")})
      WHERE actual.${idColumns[0]} IS NULL OR NOT (${comparisons})`,
    [JSON.stringify(rows)],
  );
  if (checked.rows[0].mismatch_count !== 0) {
    throw conflict(`${label} identity is already bound to different content`);
  }
}

export function createOasisPool(connectionString, options = {}) {
  if (typeof connectionString !== "string" || !connectionString.startsWith("postgres")) {
    throw new Error("DATABASE_URL must be a PostgreSQL URL");
  }
  return new Pool({
    connectionString,
    max: options.max ?? 5,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
    application_name: "arbitra-ui-great-data-oasis",
  });
}

export class OasisPostgresJobStore {
  constructor({ pool, leaseSeconds = 180 }) {
    if (!pool || typeof pool.query !== "function") throw new Error("PostgreSQL pool is required");
    this.pool = pool;
    this.leaseSeconds = leaseSeconds;
  }

  async readiness() {
    const result = await this.pool.query(
      "SELECT migration_id FROM operations.schema_migration ORDER BY migration_id",
    );
    const actual = result.rows.map((row) => row.migration_id);
    const ready = actual.length === OASIS_MIGRATIONS.length &&
      actual.every((item, index) => item === OASIS_MIGRATIONS[index]);
    return { ready, expectedMigrations: OASIS_MIGRATIONS, actualMigrations: actual };
  }

  async ingestReadiness() {
    const result = await this.pool.query(
      `SELECT name, has_function_privilege(name, 'EXECUTE') AS granted
       FROM unnest($1::text[]) AS name`,
      [[...OASIS_INGEST_FUNCTIONS]],
    );
    const missingExecute = result.rows
      .filter((row) => !row.granted)
      .map((row) => row.name);
    return { ready: missingExecute.length === 0, missingExecute };
  }

  async listJobs(limit = 100) {
    const result = await this.pool.query(
      `SELECT * FROM operations.ingestion_run
       ORDER BY created_at DESC, ingestion_run_id DESC LIMIT $1`,
      [limit],
    );
    return Promise.all(result.rows.map((row) => this.#hydrate(row)));
  }

  async getJob(id) {
    const result = await this.pool.query(
      "SELECT * FROM operations.ingestion_run WHERE ingestion_run_id = $1",
      [id],
    );
    return result.rows[0] ? this.#hydrate(result.rows[0]) : null;
  }

  async createJob(job, occurredAt, idempotencyKey) {
    const requestDigest = sha256Json(job.request);
    const result = await this.pool.query(
      `SELECT * FROM operations.create_ingestion_run(
         $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::timestamptz
       )`,
      [
        job.id,
        idempotencyKey,
        requestDigest,
        "connector.massive.spy.v1",
        "secret-ref.massive.production",
        "scope.us-equities.spy.intraday",
        null,
        JSON.stringify(job.request),
        occurredAt.toISOString(),
      ],
    );
    return this.#hydrate(result.rows[0]);
  }

  async cancelJob(id, occurredAt) {
    const result = await this.pool.query(
      "SELECT * FROM operations.request_ingestion_cancellation($1,$2::timestamptz)",
      [id, occurredAt.toISOString()],
    );
    return result.rows[0] ? this.#hydrate(result.rows[0]) : null;
  }

  async claimJob(workerId, occurredAt) {
    const result = await this.pool.query(
      "SELECT * FROM operations.claim_next_ingestion_run($1,$2,$3::timestamptz)",
      [workerId, this.leaseSeconds, occurredAt.toISOString()],
    );
    return result.rows[0] ? this.#hydrate(result.rows[0]) : null;
  }

  async heartbeatJob(id, workerId, generation, progress, resume, occurredAt) {
    const result = await this.pool.query(
      `SELECT * FROM operations.heartbeat_ingestion_run(
         $1,$2,$3,$4::jsonb,$5::jsonb,$6,$7::timestamptz
       )`,
      [
        id,
        workerId,
        generation,
        JSON.stringify(resume),
        JSON.stringify(progress),
        this.leaseSeconds,
        occurredAt.toISOString(),
      ],
    );
    return this.#hydrate(result.rows[0]);
  }

  async admitPublication(id, workerId, generation, publication, occurredAt) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const records = publication.records.map((entry) => entry.record);
      const dataObjects = [...new Map(records.map((record) => [record.payload.sha256, {
        payload_sha256: record.payload.sha256,
        size_bytes: record.payload.size_bytes,
        payload_schema_id: record.payload.payload_schema_id,
        row_clock_schema_id: record.payload.row_clock_schema_id,
        first_recorded_at: record.availability.recorded_at ?? occurredAt.toISOString(),
      }])).values()];
      await ensureJsonRows(client, {
        table: "lake.data_object",
        idColumn: "payload_sha256",
        columns: [
          { column: "payload_sha256" },
          { column: "size_bytes", cast: "bigint" },
          { column: "payload_schema_id" },
          { column: "row_clock_schema_id" },
          { column: "first_recorded_at", cast: "timestamptz" },
        ],
        rows: dataObjects,
        compareColumns: [
          { column: "payload_sha256" },
          { column: "size_bytes" },
          { column: "payload_schema_id" },
          { column: "row_clock_schema_id" },
        ],
        label: "data object",
      });
      await ensureJsonRows(client, {
        table: "lake.object_locator",
        idColumn: "locator_event_id",
        columns: [
          { column: "locator_event_id" },
          { column: "locator_id" },
          { column: "payload_sha256" },
          { column: "store_id" },
          { column: "object_key" },
          { column: "event_kind", key: "kind" },
          { column: "recorded_at", cast: "timestamptz" },
          { column: "supersedes_locator_event_id" },
          { column: "reason" },
        ],
        rows: publication.locator_events,
        label: "object locator",
      });
      await client.query(
        `SELECT operations.acknowledge_ingestion_object(
           $1,$2,$3,item->>'record_id',item->>'payload_sha256',
           item->>'locator_event_id',$4::timestamptz
         )
           FROM jsonb_array_elements($5::jsonb) AS item`,
        [id, workerId, generation, occurredAt.toISOString(), JSON.stringify(publication.locator_events)],
      );

      const catalog = publication.catalog;
      for (const [kind, table, idColumn, extraColumns] of [
        ["assets", "catalog.asset", "asset_id", []],
        ["venues", "catalog.venue", "venue_id", []],
        ["instruments", "catalog.instrument", "instrument_id", [
          { column: "venue_id" }, { column: "base_asset_id" }, { column: "quote_asset_id" },
          { column: "market_type" }, { column: "venue_symbol" },
        ]],
        ["market_streams", "catalog.market_stream", "market_stream_id", [
          { column: "instrument_id" }, { column: "source_id" }, { column: "timeframe" },
          { column: "calendar_id" }, { column: "timestamp_convention" },
          { column: "completion_rule" }, { column: "price_unit" }, { column: "volume_unit" },
        ]],
      ]) {
        await ensureJsonRows(client, {
          table,
          idColumn,
          columns: [
            { column: idColumn }, ...extraColumns, { column: "definition_sha256" },
            { column: "definition", cast: "jsonb" }, { column: "recorded_at", cast: "timestamptz" },
          ],
          compareColumns: [
            { column: idColumn }, ...extraColumns, { column: "definition_sha256" },
            { column: "definition" },
          ],
          rows: catalog[kind],
          label: kind,
        });
      }
      await ensureJsonRows(client, {
        table: "lake.transformation_spec",
        idColumn: "transformation_spec_id",
        columns: [
          { column: "transformation_spec_id" }, { column: "transformation_id" },
          { column: "implementation_sha256" }, { column: "parameter_sha256" },
          { column: "parameters", cast: "jsonb" }, { column: "recorded_at", cast: "timestamptz" },
        ],
        rows: publication.transformation_specs,
        label: "transformation spec",
      });

      const datasetRows = records.map((record) => ({
        record_id: record.record_id,
        dataset_version_id: record.dataset_version_id,
        scope_id: record.identity.scope_id,
        origin_kind: record.origin_kind,
        data_mode: record.data_mode,
        asset_id: record.identity.asset_id,
        venue_id: record.identity.venue_id,
        instrument_id: record.identity.instrument_id,
        market_type: record.identity.market_type,
        quote_asset: record.identity.quote_asset,
        timeframe: record.identity.timeframe,
        calendar_id: record.identity.calendar_id,
        source_id: record.identity.source_id,
        dataset_manifest_sha256: record.lineage.dataset_manifest_sha256,
        implementation_sha256: record.lineage.implementation_sha256,
        schema_id: record.lineage.schema_id,
        schema_version: record.lineage.schema_version,
        transformation_id: record.lineage.transformation_id,
        transformation_parameters_sha256: record.lineage.transformation_parameters_sha256,
        event_start: record.availability.event_start,
        event_end: record.availability.event_end,
        information_cutoff: record.availability.information_cutoff,
        observed_at: record.availability.observed_at,
        recorded_at: record.availability.recorded_at,
        observed_at_status: record.availability.observed_at_status,
        recorded_at_status: record.availability.recorded_at_status,
        payload_sha256: record.payload.sha256,
        admitted_at: record.quality.assessed_at,
      }));
      await ensureJsonRows(client, {
        table: "lake.dataset_version",
        idColumn: "record_id",
        columns: [
          { column: "record_id" }, { column: "dataset_version_id" }, { column: "scope_id" },
          { column: "origin_kind" }, { column: "data_mode" }, { column: "asset_id" },
          { column: "venue_id" }, { column: "instrument_id" }, { column: "market_type" },
          { column: "quote_asset" }, { column: "timeframe" }, { column: "calendar_id" },
          { column: "source_id" }, { column: "dataset_manifest_sha256" },
          { column: "implementation_sha256" }, { column: "schema_id" },
          { column: "schema_version", cast: "integer" }, { column: "transformation_id" },
          { column: "transformation_parameters_sha256" },
          { column: "event_start", cast: "timestamptz" },
          { column: "event_end", cast: "timestamptz" },
          { column: "information_cutoff", cast: "timestamptz" },
          { column: "observed_at", cast: "timestamptz" },
          { column: "recorded_at", cast: "timestamptz" },
          { column: "observed_at_status" }, { column: "recorded_at_status" },
          { column: "payload_sha256" }, { column: "admitted_at", cast: "timestamptz" },
        ],
        rows: datasetRows,
        label: "dataset version",
      });
      const members = records.flatMap((record) => record.members.map((member) => ({
        child_record_id: record.record_id,
        parent_record_id: member.dataset_record_id,
        parent_dataset_version_id: member.dataset_version_id,
        role: member.role,
        weight: member.weight,
        priority: member.priority,
      })));
      await ensureJsonRows(client, {
        table: "lake.dataset_member",
        idColumn: ["child_record_id", "parent_record_id"],
        columns: [
          { column: "child_record_id" }, { column: "parent_record_id" },
          { column: "parent_dataset_version_id" }, { column: "role" },
          { column: "weight", cast: "double precision" }, { column: "priority", cast: "integer" },
        ],
        rows: members,
        label: "dataset member",
      });
      const qualityRows = publication.records.map((entry) => ({
        quality_assessment_id: entry.quality_assessment_id,
        record_id: entry.record.record_id,
        is_admission: true,
        ...entry.record.quality,
      }));
      await ensureJsonRows(client, {
        table: "lake.quality_assessment",
        idColumn: "quality_assessment_id",
        columns: [
          { column: "quality_assessment_id" }, { column: "record_id" },
          { column: "is_admission", cast: "boolean" }, { column: "status" },
          { column: "ruleset_id" }, { column: "ruleset_sha256" },
          { column: "assessment_implementation_sha256" }, { column: "report_sha256" },
          { column: "assessed_at", cast: "timestamptz" },
          { column: "natural_coverage", cast: "double precision" },
          { column: "matched_coverage", cast: "double precision" },
          { column: "gap_count", cast: "bigint" }, { column: "stale_count", cast: "bigint" },
          { column: "reason" },
        ],
        rows: qualityRows,
        label: "quality assessment",
      });
      const datasetEvents = publication.records.map((entry) => ({
        dataset_event_id: entry.dataset_event_id,
        record_id: entry.record.record_id,
        event_kind: entry.dataset_event_kind,
        event_sha256: entry.dataset_event_sha256,
        details: entry.dataset_event_details,
        recorded_at: entry.record.quality.assessed_at,
      }));
      await ensureJsonRows(client, {
        table: "lake.dataset_event",
        idColumn: "dataset_event_id",
        columns: [
          { column: "dataset_event_id" }, { column: "record_id" }, { column: "event_kind" },
          { column: "event_sha256" }, { column: "details", cast: "jsonb" },
          { column: "recorded_at", cast: "timestamptz" },
        ],
        rows: datasetEvents,
        label: "dataset event",
      });
      const artifacts = publication.artifacts.map((artifact) => ({
        ingestion_run_id: id,
        artifact_id: artifact.id,
        kind: artifact.kind,
        label: artifact.label,
        object_key: artifact.key,
        payload_sha256: artifact.sha256,
        size_bytes: artifact.size,
        ticker: artifact.ticker,
        recorded_at: records.find((record) => record.record_id === publication.result_record_id).quality.assessed_at,
      }));
      await ensureJsonRows(client, {
        table: "operations.ingestion_artifact",
        idColumn: ["ingestion_run_id", "artifact_id"],
        columns: [
          { column: "ingestion_run_id" }, { column: "artifact_id" }, { column: "kind" },
          { column: "label" }, { column: "object_key" }, { column: "payload_sha256" },
          { column: "size_bytes", cast: "bigint" }, { column: "ticker" },
          { column: "recorded_at", cast: "timestamptz" },
        ],
        rows: artifacts,
        label: "ingestion artifact",
      });
      await client.query("COMMIT");
      return {
        publicationId: publication.publication_id,
        resultRecordId: publication.result_record_id,
        recordsAdmitted: records.length,
        disposition: "quality_blocked",
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async completeManifestJob(id, workerId, generation, progress, resultRecordId, summary, occurredAt) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const completed = await client.query(
        `SELECT * FROM operations.complete_ingestion_run(
           $1,$2,$3,$4,$5::jsonb,$6::timestamptz
         )`,
        [
          id, workerId, generation, resultRecordId, JSON.stringify(progress),
          occurredAt.toISOString(),
        ],
      );
      if (completed.rows.length !== 1) throw new Error("manifest completion returned no job");
      const updated = await client.query(
        `UPDATE operations.ingestion_run SET summary = $2::jsonb
          WHERE ingestion_run_id = $1 RETURNING *`,
        [id, JSON.stringify(summary)],
      );
      await client.query("COMMIT");
      return this.#hydrate(updated.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async completeLegacyJob(id, workerId, generation, progress, artifacts, summary, occurredAt) {
    const result = await this.pool.query(
      `SELECT * FROM operations.complete_legacy_ingestion_run(
         $1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::timestamptz
       )`,
      [
        id,
        workerId,
        generation,
        JSON.stringify(progress),
        JSON.stringify(artifacts),
        JSON.stringify(summary),
        occurredAt.toISOString(),
      ],
    );
    return this.#hydrate(result.rows[0]);
  }

  async finishJob(id, workerId, generation, status, errorCode, errorSummary, occurredAt) {
    const result = await this.pool.query(
      `SELECT * FROM operations.finish_ingestion_run(
         $1,$2,$3,$4,$5,$6,$7::timestamptz
       )`,
      [id, workerId, generation, status, errorCode, errorSummary, occurredAt.toISOString()],
    );
    return this.#hydrate(result.rows[0]);
  }

  async #hydrate(row) {
    const artifacts = await this.pool.query(
      `SELECT * FROM operations.ingestion_artifact
       WHERE ingestion_run_id = $1 ORDER BY artifact_id`,
      [row.ingestion_run_id],
    );
    return jobFromRow(row, artifacts.rows.map(artifactFromRow));
  }
}

export class OasisPostgresCatalogStore {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== "function") throw new Error("PostgreSQL pool is required");
    this.pool = pool;
  }

  async readiness() {
    const result = await this.pool.query(
      "SELECT migration_id FROM operations.schema_migration ORDER BY migration_id",
    );
    const actual = result.rows.map((row) => row.migration_id);
    return {
      ready: actual.length === OASIS_MIGRATIONS.length &&
        actual.every((item, index) => item === OASIS_MIGRATIONS[index]),
      expectedMigrations: OASIS_MIGRATIONS,
      actualMigrations: actual,
    };
  }

  async listDatasets({ limit, after }) {
    const result = await this.pool.query(
      `SELECT record_id, dataset_version_id, scope_id, origin_kind, data_mode,
              asset_id, venue_id, instrument_id, timeframe, calendar_id, source_id,
              event_start, event_end, information_cutoff, admitted_at
         FROM lake.dataset_version
        WHERE ($1::text IS NULL OR record_id > $1)
        ORDER BY record_id LIMIT $2`,
      [after ?? null, limit],
    );
    return result.rows;
  }

  async getDataset(recordId) {
    const dataset = await this.pool.query(
      "SELECT * FROM lake.dataset_version WHERE record_id = $1",
      [recordId],
    );
    if (!dataset.rows[0]) return null;
    const [members, quality, locators, supersession] = await Promise.all([
      this.pool.query(
        `SELECT parent_record_id, parent_dataset_version_id, role, weight, priority
           FROM lake.dataset_member WHERE child_record_id = $1
          ORDER BY COALESCE(priority, 2147483647), parent_record_id`,
        [recordId],
      ),
      this.pool.query(
        `SELECT * FROM lake.quality_assessment WHERE record_id = $1
          ORDER BY assessed_at, quality_assessment_id`,
        [recordId],
      ),
      this.pool.query(
        `SELECT locator_event_id, locator_id, store_id, object_key, event_kind,
                recorded_at, supersedes_locator_event_id, reason
           FROM lake.object_locator
          WHERE payload_sha256 = $1 ORDER BY recorded_at, locator_event_id`,
        [dataset.rows[0].payload_sha256],
      ),
      this.pool.query(
        `SELECT successor_record_id, predecessor_record_id, reason, recorded_at
           FROM lake.dataset_supersession
          WHERE successor_record_id = $1 OR predecessor_record_id = $1`,
        [recordId],
      ),
    ]);
    return {
      dataset: dataset.rows[0],
      members: members.rows,
      qualityAssessments: quality.rows,
      locators: locators.rows,
      supersession: supersession.rows,
    };
  }

  async latestDownloadLocator(recordId) {
    const result = await this.pool.query(
      `SELECT locator.object_key, dataset.dataset_version_id
         FROM lake.dataset_version dataset
         JOIN lake.object_locator locator
           ON locator.payload_sha256 = dataset.payload_sha256
        WHERE dataset.record_id = $1
          AND locator.event_kind IN ('registered', 'relocated')
        ORDER BY locator.recorded_at DESC, locator.locator_event_id DESC
        LIMIT 1`,
      [recordId],
    );
    return result.rows[0] ?? null;
  }

  async listExperimentReferences(limit = 100) {
    const result = await this.pool.query(
      `SELECT * FROM research_references.experiment_reference
       ORDER BY recorded_at DESC, experiment_reference_id LIMIT $1`,
      [limit],
    );
    return result.rows;
  }

  async listParameterLocks(limit = 100) {
    const result = await this.pool.query(
      `SELECT * FROM research_references.parameter_lock
       ORDER BY recorded_at DESC, parameter_lock_id LIMIT $1`,
      [limit],
    );
    return result.rows;
  }

  async listUpstreamEvidence({ limit, after }) {
    const result = await this.pool.query(
      `SELECT evidence_id, upstream_id, increment_id, schema_id, adapter_id,
              status, repository_relative_path, manifest_sha256, limitations, admitted_at
         FROM lake.upstream_evidence
        WHERE ($1::text IS NULL OR evidence_id > $1)
        ORDER BY evidence_id LIMIT $2`,
      [after ?? null, limit],
    );
    return result.rows;
  }
}
