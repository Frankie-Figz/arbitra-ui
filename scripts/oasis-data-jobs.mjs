import { randomUUID } from "node:crypto";

import {
  DATA_JOBS_PATH,
  INTERNAL_DATA_JOBS_PATH,
  MAXIMUM_INTERNAL_BODY_BYTES,
  bearerAuthorized,
  jsonResponse,
  normalizeArtifacts,
  normalizeJobRequest,
  normalizeProgress,
  publicJob,
  readJsonBody,
  routeParts,
} from "./data-jobs.mjs";

const JOB_ID_PATTERN = /^massive-spy-[0-9TZ-]+-[0-9a-f]{12}$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,160}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RECORD_ID_PATTERN = /^oasis[.]record[.]v1[.][0-9a-f]{64}$/;
const LOCATOR_ID_PATTERN = /^oasis[.]locator[.]v1[.][0-9a-f]{64}$/;
const LOCATOR_EVENT_ID_PATTERN = /^oasis[.]locator-event[.]v1[.][0-9a-f]{64}$/;
const QUALITY_ID_PATTERN = /^oasis[.]quality[.]v1[.][0-9a-f]{64}$/;
const DATASET_EVENT_ID_PATTERN = /^oasis[.]dataset-event[.]v1[.][0-9a-f]{64}$/;
const PUBLICATION_ID_PATTERN = /^oasis[.]publication[.]v1[.][0-9a-f]{64}$/;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;
const OBJECT_KEY_PATTERN = /^(?!\/)(?![A-Za-z]:)(?!.*[?%#\\])(?!.*\/\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*:\/\/)[\x21-\x7e]+$/;
const SECRET_KEY_PATTERN = /(api.?key|access.?key|secret|password|credential|authorization|bearer|private.?key)/i;
const MAXIMUM_PUBLICATION_BODY_BYTES = 16 * 1024 * 1024;

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function exactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has unknown or missing fields`);
  }
}

function array(value, label, maximum, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new Error(`${label} must contain ${minimum}..${maximum} items`);
  }
  return value;
}

function string(value, label, pattern = SAFE_IDENTIFIER_PATTERN) {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function nullableString(value, label, pattern = SAFE_IDENTIFIER_PATTERN) {
  return value === null ? null : string(value, label, pattern);
}

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${label} is invalid`);
  return value;
}

function finiteNumber(value, label, minimum = 0, maximum = 1) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function timestamp(value, label) {
  if (typeof value !== "string" || !/(?:Z|[+]00:00)$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be a UTC timestamp`);
  }
  return value;
}

function rejectSecrets(value, path = "publication") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSecrets(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) throw new Error(`${path}.${key} is a secret-shaped field`);
    rejectSecrets(item, `${path}.${key}`);
  }
}

function validateCatalogDefinition(entry, kind) {
  const common = [`${kind}_id`, "definition_sha256", "definition", "recorded_at"];
  const extras = kind === "instrument"
    ? ["venue_id", "base_asset_id", "quote_asset_id", "market_type", "venue_symbol"]
    : kind === "market_stream"
      ? ["instrument_id", "source_id", "timeframe", "calendar_id", "timestamp_convention", "completion_rule", "price_unit", "volume_unit"]
      : [];
  exactKeys(entry, [...common, ...extras], `catalog.${kind}`);
  string(entry[`${kind}_id`], `catalog.${kind}.${kind}_id`);
  string(entry.definition_sha256, `catalog.${kind}.definition_sha256`, SHA256_PATTERN);
  object(entry.definition, `catalog.${kind}.definition`);
  timestamp(entry.recorded_at, `catalog.${kind}.recorded_at`);
  for (const field of extras) {
    if (field === "quote_asset_id") nullableString(entry[field], `catalog.${kind}.${field}`);
    else string(entry[field], `catalog.${kind}.${field}`);
  }
}

function validateRecordEntry(entry) {
  exactKeys(entry, [
    "record", "quality_assessment_id", "dataset_event_id", "dataset_event_sha256",
    "dataset_event_kind", "dataset_event_details",
  ], "publication record");
  string(entry.quality_assessment_id, "quality_assessment_id", QUALITY_ID_PATTERN);
  string(entry.dataset_event_id, "dataset_event_id", DATASET_EVENT_ID_PATTERN);
  string(entry.dataset_event_sha256, "dataset_event_sha256", SHA256_PATTERN);
  if (!["admitted", "quarantined", "unavailable", "superseded"].includes(entry.dataset_event_kind)) {
    throw new Error("dataset_event_kind is invalid");
  }
  object(entry.dataset_event_details, "dataset_event_details");

  const record = object(entry.record, "record");
  exactKeys(record, [
    "schema_version", "dataset_version_id", "origin_kind", "data_mode", "identity",
    "lineage", "availability", "quality", "payload", "members",
    "supersedes_dataset_version_id", "record_id", "locator_id",
  ], "record");
  if (record.schema_version !== 1) throw new Error("record schema_version is unsupported");
  string(record.dataset_version_id, "dataset_version_id");
  string(record.record_id, "record_id", RECORD_ID_PATTERN);
  string(record.locator_id, "locator_id", LOCATOR_ID_PATTERN);
  if (!["atomic", "derived"].includes(record.origin_kind)) throw new Error("origin_kind is invalid");
  if (!["separate", "pooled", "feature_blend", "candle_blend", "history_stitch"].includes(record.data_mode)) {
    throw new Error("data_mode is invalid");
  }
  nullableString(record.supersedes_dataset_version_id, "supersedes_dataset_version_id");

  const identity = object(record.identity, "record.identity");
  exactKeys(identity, [
    "scope_id", "asset_id", "venue_id", "instrument_id", "market_type", "quote_asset",
    "timeframe", "calendar_id", "source_id",
  ], "record.identity");
  string(identity.scope_id, "identity.scope_id");
  string(identity.timeframe, "identity.timeframe");
  string(identity.calendar_id, "identity.calendar_id");
  for (const field of ["asset_id", "venue_id", "instrument_id", "market_type", "quote_asset", "source_id"]) {
    nullableString(identity[field], `identity.${field}`);
  }

  const lineage = object(record.lineage, "record.lineage");
  exactKeys(lineage, [
    "dataset_manifest_sha256", "implementation_sha256", "schema_id", "schema_version",
    "transformation_id", "transformation_parameters_sha256",
  ], "record.lineage");
  string(lineage.dataset_manifest_sha256, "lineage.dataset_manifest_sha256", SHA256_PATTERN);
  string(lineage.implementation_sha256, "lineage.implementation_sha256", SHA256_PATTERN);
  string(lineage.schema_id, "lineage.schema_id");
  integer(lineage.schema_version, "lineage.schema_version", 1);
  nullableString(lineage.transformation_id, "lineage.transformation_id");
  nullableString(lineage.transformation_parameters_sha256, "lineage.transformation_parameters_sha256", SHA256_PATTERN);

  const availability = object(record.availability, "record.availability");
  exactKeys(availability, [
    "event_start", "event_end", "information_cutoff", "observed_at", "recorded_at",
    "observed_at_status", "recorded_at_status",
  ], "record.availability");
  timestamp(availability.event_start, "availability.event_start");
  timestamp(availability.event_end, "availability.event_end");
  timestamp(availability.information_cutoff, "availability.information_cutoff");
  if (availability.observed_at !== null) timestamp(availability.observed_at, "availability.observed_at");
  if (availability.recorded_at !== null) timestamp(availability.recorded_at, "availability.recorded_at");
  string(availability.observed_at_status, "availability.observed_at_status");
  string(availability.recorded_at_status, "availability.recorded_at_status");

  const quality = object(record.quality, "record.quality");
  exactKeys(quality, [
    "status", "ruleset_id", "ruleset_sha256", "assessment_implementation_sha256",
    "report_sha256", "assessed_at", "natural_coverage", "matched_coverage", "gap_count",
    "stale_count", "reason",
  ], "record.quality");
  if (!["accepted", "quality_blocked", "unavailable"].includes(quality.status)) throw new Error("quality status is invalid");
  string(quality.ruleset_id, "quality.ruleset_id");
  string(quality.ruleset_sha256, "quality.ruleset_sha256", SHA256_PATTERN);
  string(quality.assessment_implementation_sha256, "quality.assessment_implementation_sha256", SHA256_PATTERN);
  string(quality.report_sha256, "quality.report_sha256", SHA256_PATTERN);
  timestamp(quality.assessed_at, "quality.assessed_at");
  finiteNumber(quality.natural_coverage, "quality.natural_coverage");
  finiteNumber(quality.matched_coverage, "quality.matched_coverage");
  integer(quality.gap_count, "quality.gap_count");
  integer(quality.stale_count, "quality.stale_count");
  nullableString(quality.reason, "quality.reason", /^.{1,2000}$/s);

  const payload = object(record.payload, "record.payload");
  exactKeys(payload, ["store_id", "object_key", "sha256", "size_bytes", "payload_schema_id", "row_clock_schema_id"], "record.payload");
  string(payload.store_id, "payload.store_id");
  string(payload.object_key, "payload.object_key", OBJECT_KEY_PATTERN);
  string(payload.sha256, "payload.sha256", SHA256_PATTERN);
  integer(payload.size_bytes, "payload.size_bytes");
  string(payload.payload_schema_id, "payload.payload_schema_id");
  string(payload.row_clock_schema_id, "payload.row_clock_schema_id");

  array(record.members, "record.members", 600).forEach((member) => {
    exactKeys(object(member, "record member"), ["dataset_version_id", "dataset_record_id", "role", "weight", "priority"], "record member");
    string(member.dataset_version_id, "member.dataset_version_id");
    string(member.dataset_record_id, "member.dataset_record_id", RECORD_ID_PATTERN);
    string(member.role, "member.role");
    if (member.weight !== null) finiteNumber(member.weight, "member.weight", 0, Number.MAX_VALUE);
    if (member.priority !== null) integer(member.priority, "member.priority");
  });
  return record;
}

export function normalizeOasisPublication(value) {
  const publication = object(value, "publication");
  rejectSecrets(publication);
  exactKeys(publication, [
    "schema_version", "publication_id", "result_record_id", "records", "locator_events",
    "catalog", "transformation_specs", "artifacts",
  ], "publication");
  if (publication.schema_version !== 1) throw new Error("publication schema_version is unsupported");
  string(publication.publication_id, "publication_id", PUBLICATION_ID_PATTERN);
  string(publication.result_record_id, "result_record_id", RECORD_ID_PATTERN);
  const records = array(publication.records, "publication.records", 600, 1).map((entry) => {
    validateRecordEntry(object(entry, "publication record"));
    return entry;
  });
  const recordIds = new Set(records.map((entry) => entry.record.record_id));
  if (recordIds.size !== records.length || !recordIds.has(publication.result_record_id)) {
    throw new Error("publication record identities are invalid");
  }
  const versionIds = new Set(records.map((entry) => entry.record.dataset_version_id));
  if (versionIds.size !== records.length) throw new Error("publication dataset versions must be unique");
  for (const entry of records) {
    for (const member of entry.record.members) {
      if (!recordIds.has(member.dataset_record_id) || !versionIds.has(member.dataset_version_id)) {
        throw new Error("publication member is not recoverable within this bundle");
      }
    }
  }

  const locators = array(publication.locator_events, "publication.locator_events", 600, 1);
  const locatorIds = new Set();
  for (const event of locators) {
    exactKeys(object(event, "locator event"), [
      "schema_version", "record_id", "dataset_version_id", "locator_id", "store_id",
      "object_key", "payload_sha256", "size_bytes", "kind", "recorded_at",
      "supersedes_locator_event_id", "reason", "locator_event_id",
    ], "locator event");
    if (event.schema_version !== 1) throw new Error("locator schema_version is unsupported");
    string(event.locator_event_id, "locator_event_id", LOCATOR_EVENT_ID_PATTERN);
    string(event.record_id, "locator record_id", RECORD_ID_PATTERN);
    string(event.dataset_version_id, "locator dataset_version_id");
    string(event.locator_id, "locator_id", LOCATOR_ID_PATTERN);
    string(event.store_id, "locator store_id");
    string(event.object_key, "locator object_key", OBJECT_KEY_PATTERN);
    string(event.payload_sha256, "locator payload_sha256", SHA256_PATTERN);
    integer(event.size_bytes, "locator size_bytes");
    if (!["registered", "relocated", "unavailable"].includes(event.kind)) throw new Error("locator kind is invalid");
    timestamp(event.recorded_at, "locator recorded_at");
    nullableString(event.supersedes_locator_event_id, "locator supersedes_locator_event_id", LOCATOR_EVENT_ID_PATTERN);
    nullableString(event.reason, "locator reason", /^.{1,2000}$/s);
    if (locatorIds.has(event.locator_event_id)) throw new Error("locator events must be unique");
    locatorIds.add(event.locator_event_id);
    const record = records.find((item) => item.record.record_id === event.record_id)?.record;
    if (!record || record.dataset_version_id !== event.dataset_version_id ||
        record.locator_id !== event.locator_id || record.payload.sha256 !== event.payload_sha256 ||
        record.payload.store_id !== event.store_id || record.payload.object_key !== event.object_key ||
        record.payload.size_bytes !== event.size_bytes) {
      throw new Error("locator does not match its dataset record");
    }
  }
  if (locators.length !== records.length) throw new Error("every publication record requires one locator event");

  const catalog = object(publication.catalog, "publication.catalog");
  exactKeys(catalog, ["assets", "venues", "instruments", "market_streams"], "publication.catalog");
  array(catalog.assets, "catalog.assets", 600, 1).forEach((entry) => validateCatalogDefinition(object(entry, "catalog asset"), "asset"));
  array(catalog.venues, "catalog.venues", 100, 1).forEach((entry) => validateCatalogDefinition(object(entry, "catalog venue"), "venue"));
  array(catalog.instruments, "catalog.instruments", 600, 1).forEach((entry) => validateCatalogDefinition(object(entry, "catalog instrument"), "instrument"));
  array(catalog.market_streams, "catalog.market_streams", 600, 1).forEach((entry) => validateCatalogDefinition(object(entry, "catalog market stream"), "market_stream"));

  array(publication.transformation_specs, "publication.transformation_specs", 100).forEach((spec) => {
    exactKeys(object(spec, "transformation spec"), [
      "transformation_spec_id", "transformation_id", "implementation_sha256",
      "parameter_sha256", "parameters", "recorded_at",
    ], "transformation spec");
    string(spec.transformation_spec_id, "transformation_spec_id");
    string(spec.transformation_id, "transformation_id");
    string(spec.implementation_sha256, "transformation implementation_sha256", SHA256_PATTERN);
    string(spec.parameter_sha256, "transformation parameter_sha256", SHA256_PATTERN);
    object(spec.parameters, "transformation parameters");
    timestamp(spec.recorded_at, "transformation recorded_at");
  });
  const artifactIds = new Set();
  array(publication.artifacts, "publication.artifacts", 1200, 1).forEach((artifact) => {
    exactKeys(object(artifact, "artifact"), ["id", "kind", "label", "key", "sha256", "size", "ticker"], "artifact");
    string(artifact.id, "artifact.id");
    string(artifact.kind, "artifact.kind");
    string(artifact.label, "artifact.label", /^.{1,240}$/s);
    string(artifact.key, "artifact.key", OBJECT_KEY_PATTERN);
    string(artifact.sha256, "artifact.sha256", SHA256_PATTERN);
    integer(artifact.size, "artifact.size", 1);
    nullableString(artifact.ticker, "artifact.ticker");
    if (artifactIds.has(artifact.id)) throw new Error("artifact IDs must be unique");
    artifactIds.add(artifact.id);
  });
  return publication;
}

function newJobId(timestamp) {
  return `massive-spy-${timestamp.toISOString().replaceAll(":", "").replaceAll(".", "-")}-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function errorResponse(error) {
  if (error?.code === "P0002") return jsonResponse({ status: "not_found" }, 404);
  if (error?.code === "23505") {
    return jsonResponse({ status: "idempotency_conflict" }, 409);
  }
  if (error?.code === "55000") return jsonResponse({ status: "stale_fence" }, 409);
  const message = String(error?.message ?? error);
  if (error instanceof SyntaxError || /must|required|invalid|unsupported|exceed|precedes|confirmation|secret-shaped/i.test(message)) {
    return jsonResponse({ status: "rejected", error: message.slice(0, 1000) }, 422);
  }
  throw error;
}

export function createOasisDataJobsHandler({
  store,
  workerStore = store,
  adminToken,
  workerToken,
  signArtifact,
  now = () => new Date(),
}) {
  if (!store) throw new Error("Oasis PostgreSQL job store is required");
  if (!workerStore) throw new Error("Oasis PostgreSQL worker store is required");

  async function adminResponse(request, parts) {
    if (!bearerAuthorized(request, adminToken)) {
      return jsonResponse({ status: "unauthorized" }, 401, { "www-authenticate": "Bearer" });
    }
    if (parts.length === 0 && request.method === "GET") {
      return jsonResponse({ jobs: (await store.listJobs(100)).map(publicJob) });
    }
    if (parts.length === 0 && request.method === "POST") {
      const timestamp = now();
      const requestBody = normalizeJobRequest(await readJsonBody(request), timestamp);
      const suppliedKey = request.headers.get("idempotency-key");
      if (suppliedKey !== null && !IDEMPOTENCY_PATTERN.test(suppliedKey)) {
        return jsonResponse({ status: "rejected", error: "Idempotency-Key is invalid" }, 422);
      }
      const id = newJobId(timestamp);
      const job = await store.createJob(
        { id, request: requestBody },
        timestamp,
        suppliedKey ?? `data-job:${id}`,
      );
      return jsonResponse({ job: publicJob(job) }, 201, {
        location: `${DATA_JOBS_PATH}/${job.id}`,
      });
    }
    if (parts.length < 1 || !JOB_ID_PATTERN.test(parts[0])) {
      return jsonResponse({ status: "not_found" }, 404);
    }
    const job = await store.getJob(parts[0]);
    if (!job) return jsonResponse({ status: "not_found" }, 404);
    if (parts.length === 1 && request.method === "GET") {
      return jsonResponse({ job: publicJob(job) });
    }
    if (parts.length === 2 && parts[1] === "cancel" && request.method === "POST") {
      return jsonResponse({ job: publicJob(await store.cancelJob(job.id, now())) });
    }
    if (parts.length === 3 && parts[1] === "artifacts" && request.method === "GET") {
      if (job.status !== "completed") return jsonResponse({ status: "not_ready" }, 409);
      const artifact = job.artifacts.find((item) => item.id === parts[2]);
      if (!artifact) return jsonResponse({ status: "not_found" }, 404);
      if (typeof signArtifact !== "function") {
        return jsonResponse({ status: "storage_unavailable" }, 503);
      }
      const url = await signArtifact(artifact.key, artifact.label);
      if ((request.headers.get("accept") ?? "").includes("application/json")) {
        return jsonResponse({ url, expiresInSeconds: 15 * 60 });
      }
      return new Response(null, {
        status: 303,
        headers: { location: url, "cache-control": "no-store" },
      });
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
      return jsonResponse({ job: await workerStore.claimJob(workerId, now()) });
    }
    if (parts.length < 1 || !JOB_ID_PATTERN.test(parts[0])) {
      return jsonResponse({ status: "not_found" }, 404);
    }
    const job = await workerStore.getJob(parts[0]);
    if (!job) return jsonResponse({ status: "not_found" }, 404);
    if (parts.length === 1 && request.method === "GET") return jsonResponse({ job });
    if (parts.length !== 2 || request.method !== "POST") {
      return jsonResponse({ status: "method_not_allowed" }, 405);
    }
    const bodyLimit = parts[1] === "admit"
      ? MAXIMUM_PUBLICATION_BODY_BYTES
      : MAXIMUM_INTERNAL_BODY_BYTES;
    const body = await readJsonBody(request, bodyLimit);
    const workerId = String(body.workerId ?? "");
    const generation = body.fencingGeneration;
    if (!workerId || !Number.isSafeInteger(generation) || generation < 1) {
      return jsonResponse({ status: "rejected", error: "worker fence is required" }, 422);
    }
    if (parts[1] === "heartbeat") {
      const progress = normalizeProgress(body.progress, job.progress);
      const resume = body.resume && typeof body.resume === "object" && !Array.isArray(body.resume)
        ? body.resume
        : (job.resume ?? {});
      return jsonResponse({
        job: await workerStore.heartbeatJob(job.id, workerId, generation, progress, resume, now()),
      });
    }
    if (parts[1] === "complete") {
      const progress = normalizeProgress(body.progress, job.progress);
      const artifacts = normalizeArtifacts(body.artifacts, job);
      const summary = body.summary && typeof body.summary === "object" && !Array.isArray(body.summary)
        ? body.summary
        : {};
      return jsonResponse({
        job: await workerStore.completeLegacyJob(
          job.id, workerId, generation, progress, artifacts, summary, now(),
        ),
      });
    }
    if (parts[1] === "admit") {
      const publication = normalizeOasisPublication(body.publication);
      return jsonResponse({
        publication: await workerStore.admitPublication(
          job.id, workerId, generation, publication, now(),
        ),
      });
    }
    if (parts[1] === "complete-manifest") {
      const progress = normalizeProgress(body.progress, job.progress);
      string(body.resultRecordId, "resultRecordId", RECORD_ID_PATTERN);
      const summary = body.summary && typeof body.summary === "object" && !Array.isArray(body.summary)
        ? body.summary
        : {};
      rejectSecrets(summary, "summary");
      return jsonResponse({
        job: await workerStore.completeManifestJob(
          job.id, workerId, generation, progress, body.resultRecordId, summary, now(),
        ),
      });
    }
    if (parts[1] === "fail" || parts[1] === "cancelled") {
      const status = parts[1] === "cancelled" ? "cancelled" : "failed";
      const error = status === "failed" ? String(body.error ?? "worker failed").slice(0, 1000) : "";
      return jsonResponse({
        job: await workerStore.finishJob(
          job.id,
          workerId,
          generation,
          status,
          status === "failed" ? "provider_or_worker_failure" : null,
          error,
          now(),
        ),
      });
    }
    return jsonResponse({ status: "not_found" }, 404);
  }

  return async function oasisDataJobsResponse(request) {
    const pathname = new URL(request.url).pathname;
    const adminParts = routeParts(pathname, DATA_JOBS_PATH);
    const internalParts = routeParts(pathname, INTERNAL_DATA_JOBS_PATH);
    if (adminParts === null && internalParts === null) return null;
    try {
      return adminParts !== null
        ? await adminResponse(request, adminParts)
        : await internalResponse(request, internalParts);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
