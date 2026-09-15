import { createHash } from "node:crypto";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function recordEntry({ suffix, kind, version, payload, parent = null }) {
  const at = "2026-08-16T12:00:00Z";
  const recordId = `oasis.record.v1.${digest(`record:${suffix}:${kind}`)}`;
  const locatorId = `oasis.locator.v1.${digest(`locator:${suffix}:${kind}`)}`;
  const derived = parent !== null;
  const quality = {
    status: "quality_blocked",
    ruleset_id: "quality.elijahs-ravens-structural-v1",
    ruleset_sha256: digest("ruleset"),
    assessment_implementation_sha256: digest("implementation"),
    report_sha256: digest(`report:${suffix}:${kind}`),
    assessed_at: at,
    natural_coverage: 0,
    matched_coverage: 0,
    gap_count: 0,
    stale_count: 0,
    reason: "calendar completeness and point-in-time membership are unavailable",
  };
  const record = {
    schema_version: 1,
    dataset_version_id: version,
    origin_kind: derived ? "derived" : "atomic",
    data_mode: "separate",
    identity: derived
      ? {
          scope_id: `collection.elijah.${suffix}`,
          asset_id: null,
          venue_id: null,
          instrument_id: null,
          market_type: "us_equity_collection",
          quote_asset: "USD",
          timeframe: "1m",
          calendar_id: "calendar.us-equities.unverified-v1",
          source_id: null,
        }
      : {
          scope_id: `stream.massive.spy-${suffix}.1m`,
          asset_id: `asset.spy-${suffix}`,
          venue_id: "venue.us-consolidated-market",
          instrument_id: `instrument.spy-${suffix}`,
          market_type: "us_listed_security",
          quote_asset: "USD",
          timeframe: "1m",
          calendar_id: "calendar.us-equities.unverified-v1",
          source_id: "provider.massive.aggregates",
        },
    lineage: {
      dataset_manifest_sha256: digest(`manifest:${suffix}:${kind}`),
      implementation_sha256: digest("implementation"),
      schema_id: derived ? "elijah-run-manifest-v1" : "elijah-ticker-manifest-v1",
      schema_version: 1,
      transformation_id: derived ? "transform.elijah-run-collection-v1" : null,
      transformation_parameters_sha256: derived ? digest(`parameters:${suffix}`) : null,
    },
    availability: {
      event_start: "2026-08-15T13:30:00Z",
      event_end: "2026-08-15T13:31:00Z",
      information_cutoff: at,
      observed_at: at,
      recorded_at: at,
      observed_at_status: "known",
      recorded_at_status: "known",
    },
    quality,
    payload: {
      store_id: "store.railway.bucket.test-v1",
      object_key: `objects/sha256/${payload.slice(0, 2)}/${payload}`,
      sha256: payload,
      size_bytes: 100,
      payload_schema_id: derived ? "elijah-run-manifest-v1" : "elijah-ticker-bundle-v1",
      row_clock_schema_id: derived ? "manifest-only-v1" : "row-clocks-unavailable-v1",
    },
    members: parent
      ? [{
          dataset_version_id: parent.record.dataset_version_id,
          dataset_record_id: parent.record.record_id,
          role: "series",
          weight: null,
          priority: null,
        }]
      : [],
    supersedes_dataset_version_id: null,
    record_id: recordId,
    locator_id: locatorId,
  };
  return {
    record,
    quality_assessment_id: `oasis.quality.v1.${digest(`quality:${suffix}:${kind}`)}`,
    dataset_event_id: `oasis.dataset-event.v1.${digest(`event:${suffix}:${kind}`)}`,
    dataset_event_sha256: digest(`event-content:${suffix}:${kind}`),
    dataset_event_kind: "quarantined",
    dataset_event_details: { quality_status: "quality_blocked" },
  };
}

export function oasisPublicationFixture(suffix) {
  const at = "2026-08-16T12:00:00Z";
  const atomic = recordEntry({
    suffix,
    kind: "ticker",
    version: `elijah.${suffix}.spy.1m.v1`,
    payload: digest(`payload:${suffix}:ticker`),
  });
  const collection = recordEntry({
    suffix,
    kind: "collection",
    version: `elijah.${suffix}.collection.v1`,
    payload: digest(`payload:${suffix}:collection`),
    parent: atomic,
  });
  const records = [atomic, collection];
  const locatorEvents = records.map((entry) => ({
    schema_version: 1,
    record_id: entry.record.record_id,
    dataset_version_id: entry.record.dataset_version_id,
    locator_id: entry.record.locator_id,
    store_id: entry.record.payload.store_id,
    object_key: entry.record.payload.object_key,
    payload_sha256: entry.record.payload.sha256,
    size_bytes: entry.record.payload.size_bytes,
    kind: "registered",
    recorded_at: at,
    supersedes_locator_event_id: null,
    reason: null,
    locator_event_id: `oasis.locator-event.v1.${digest(`locator-event:${entry.record.record_id}`)}`,
  }));
  const definition = (value) => digest(JSON.stringify(value));
  const quote = { schema_version: 1, asset_id: "currency.usd", kind: "currency", code: "USD" };
  const asset = { schema_version: 1, asset_id: `asset.spy-${suffix}`, kind: "us_listed_security", ticker: "SPY" };
  const venue = { schema_version: 1, venue_id: "venue.us-consolidated-market", kind: "consolidated_market_view", country: "US" };
  const instrument = {
    schema_version: 1, instrument_id: `instrument.spy-${suffix}`,
    venue_id: venue.venue_id, base_asset_id: asset.asset_id, quote_asset_id: quote.asset_id,
    market_type: "us_listed_security", venue_symbol: `SPY-${suffix}`,
  };
  const stream = {
    schema_version: 1, market_stream_id: `stream.massive.spy-${suffix}.1m`,
    instrument_id: instrument.instrument_id, source_id: "provider.massive.aggregates",
    timeframe: "1m", calendar_id: "calendar.us-equities.unverified-v1",
    timestamp_convention: "utc_window_start", completion_rule: "provider_closed_page",
    price_unit: "USD_per_security", volume_unit: "security_units",
  };
  const { schema_version: instrumentSchemaVersion, ...instrumentFields } = instrument;
  const { schema_version: streamSchemaVersion, ...streamFields } = stream;
  void instrumentSchemaVersion;
  void streamSchemaVersion;
  return {
    schema_version: 1,
    publication_id: `oasis.publication.v1.${digest(`publication:${suffix}`)}`,
    result_record_id: collection.record.record_id,
    records,
    locator_events: locatorEvents,
    catalog: {
      assets: [quote, asset].map((item) => ({
        asset_id: item.asset_id, definition_sha256: definition(item), definition: item, recorded_at: at,
      })),
      venues: [{ venue_id: venue.venue_id, definition_sha256: definition(venue), definition: venue, recorded_at: at }],
      instruments: [{ ...instrumentFields, definition_sha256: definition(instrument), definition: instrument, recorded_at: at }],
      market_streams: [{ ...streamFields, definition_sha256: definition(stream), definition: stream, recorded_at: at }],
    },
    transformation_specs: [{
      transformation_spec_id: `oasis.transformation.v1.${digest(`parameters:${suffix}`)}`,
      transformation_id: "transform.elijah-run-collection-v1",
      implementation_sha256: digest("implementation"),
      parameter_sha256: digest(`parameters:${suffix}`),
      parameters: { source: atomic.record.record_id },
      recorded_at: at,
    }],
    artifacts: [{
      id: "manifest.json", kind: "manifest", label: "manifest.json",
      key: `massive/spy/${suffix}/manifest.json`, sha256: collection.record.payload.sha256,
      size: 100, ticker: null,
    }],
  };
}
