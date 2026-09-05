import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  OSCILLATOR_HISTORY_ORDER,
  OSCILLATOR_WATCH_HISTORY_CAP,
  collectOscillatorWatch,
  compareHistoryRecords,
  projectOscillatorWatch,
  projectionDigest,
  selectNewestPartitions,
} from "../scripts/oscillator-watch.mjs";
import { walkHtml } from "../scripts/oscillator-marking-sweep.mjs";
import {
  IDENTIFIER_SETS,
  OSCILLATOR_STRING_MANIFEST,
  PRODUCER_CAVEAT_MAX,
  PRODUCER_FRAGMENT_MAX,
  TOKEN_PATTERN,
  VOCABULARIES,
  classifyOscillatorValue,
  describeCoded,
  isProducerCode,
  isProducerQuote,
  isProducerValue,
  oscillatorProducerTextViolation,
  producerIdentifier,
} from "../scripts/oscillator-vocabulary.mjs";
import {
  CELL_STATUSES,
  OSCILLATOR_UNAVAILABLE_REASONS,
  describeOscillatorUnavailable,
  oscillatorUnavailableViolation,
  oscillatorWatchHonestyViolation,
} from "../scripts/oscillator-honesty.mjs";
import {
  INGEST_SNAPSHOT_PATH,
  createRuntimeSnapshotHandler,
  validateAcceptedSnapshot,
  validateOscillatorWatch,
} from "../scripts/runtime-snapshot.mjs";

const run = promisify(execFile);
const uiRoot = fileURLToPath(new URL("../", import.meta.url));
const bundledPath = resolve(uiRoot, "app", "data", "oscillator-alpha-watch.json");
const protectedSnapshotPath = resolve(uiRoot, "public", "data", "arbitra-snapshot.json");
const protectedHistoryPath = resolve(uiRoot, "public", "data", "arbitra-daily-history.json");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

/** The committed build-time projection, used as the producer-shaped fixture base. */
async function bundled() {
  return readJson(bundledPath);
}

/** Rebuild a producer-shaped document from scratch: small, explicit, and the
 *  only place the snake_case producer contract is spelled out in the tests. */
function producerFixture(overrides = {}) {
  const limitations = [
    "The double-positive rate across the campaign exceeds the independence expectation only modestly; this set is NOT established as distinguishable from search noise.",
    "No shifted-label or permutation null has been run against these survivors.",
  ];
  const cell = (extra) => ({
    watch_id: "BTCUSDT.ta_rsi.30m.opposite_signal",
    asset: "BTCUSDT",
    oscillator: "ta_rsi",
    indicator_class: "RSIIndicator",
    timeframe: "30m",
    exit_family: "opposite_signal",
    status: "flat",
    cell_fingerprint: "a".repeat(64),
    evaluated_this_run: true,
    deferred: { is_deferred: false, reason: null },
    availability: {
      status: "ok",
      last_successful_evaluation_utc: "2026-09-05T14:00:00+00:00",
      consecutive_failed_runs: 0,
      detail: null,
    },
    warmup: {
      registry_bars_required: null,
      adapter_bars_computed: 152,
      effective_bars_required: 152,
      source: "adapter_computed_registry_null",
      satisfied: true,
    },
    bars_available: 900,
    state_bar: null,
    oscillator_state: null,
    divergence_armed: null,
    position: null,
    pending_entry: null,
    lifecycle: null,
    final_bucket: null,
    known_limitations: limitations,
    evidence: {
      holdout: { trades: 30, net_return: 0.41, profit_factor: 2.28 },
      retrospective_confirmation: { trades: 32, net_return: 0.91, profit_factor: 2.69, note: null },
      quality_status: "QUALIFIED",
    },
    provenance_ref: { campaign_id: "c", cell_artifact_path: "30m/opposite_signal", protocol_sha256: null },
    ...extra,
  });
  return {
    schema_version: 1,
    document_id: "oscillator-alpha-watch-snapshot-v1",
    generated_at_utc: "2026-09-05T14:37:12.677830+00:00",
    run_id: "d388dda2a405f287",
    evaluator_version: "oscillator-alpha-watch-evaluator/0.1.0",
    tracking_only: true,
    deployment_allowed: false,
    capital_authority: false,
    order_authority: false,
    purpose: "Forward signal tracking only.",
    known_limitations: limitations,
    not_established_as_distinguishable_from_search_noise: true,
    evidence_window_ends_utc: "2026-08-01T00:00:00+00:00",
    registry: { registry_id: "oscillator-alpha-watch-v1", sha256: "b".repeat(64), cells_total: 1, cells_active: 1, cells_deferred: 0, selection_rule: "r" },
    runtime: { python: "3.14.7", numpy: "2.5.2", pandas: "3.0.5", ta: "0.11.0", matches_frozen_protocol: false },
    parity: { frozen_files: [], reimplemented_logic: [], assertions: { checked: 0, passed: 0, failed: 0 } },
    ledger: { directory: "d", partitions: [], total_records: 0, first_bar_utc: null, last_bar_utc: null },
    retention: { ledger_policy: "append-only", expected_records_per_month: 44.7, expected_records_per_month_basis: "b" },
    counts: {
      cells_total: 1, active_long: 0, active_short: 0, flat: 1, insufficient_history: 0,
      source_unavailable: 0, deferred: 0, lifecycle_terminated_bankrupt: 0, cells_evaluated: 1,
      signals_this_run: 0, fills_this_run: 0, exits_this_run: 0,
    },
    cells: [cell()],
    active_signals: [],
    pending_entries: [],
    history: [],
    ...overrides,
  };
}

/**
 * The honesty block the ledger contract requires on every record. It used to be
 * abbreviated here to the two fields the projection happened to read, which is
 * precisely why a record could revoke tracking_only unnoticed.
 */
const LEDGER_HONESTY = {
  tracking_only: true,
  deployment_allowed: false,
  capital_authority: false,
  order_authority: false,
  not_established_as_distinguishable_from_search_noise: true,
  caveat: "Tracking only. Not established as distinguishable from search noise.",
  known_limitations_count: 2,
  context_sha256: "c".repeat(64),
  evidence_window_ends_utc: "2026-08-01T00:00:00+00:00",
  after_evidence_window: true,
};

function signalRecord(state, extra = {}) {
  return {
    schema_version: 1,
    ledger_id: "oscillator-alpha-watch-ledger-v1",
    record_type: "signal",
    record_id: createHash("sha256").update(`${state}${JSON.stringify(extra)}`).digest("hex"),
    signal_id: "s".repeat(64),
    emitted_at_utc: "2026-09-05T14:00:00+00:00",
    watch_id: "BTCUSDT.ta_rsi.30m.opposite_signal",
    asset: "BTCUSDT",
    oscillator: "ta_rsi",
    timeframe: "30m",
    exit_family: "opposite_signal",
    honesty: { ...LEDGER_HONESTY },
    direction: "long",
    ui_label: "BUY",
    signal_bar: { open_utc: "2026-09-05T13:30:00+00:00", close_utc: "2026-09-05T14:00:00+00:00", close: 61234.5, coverage: 1, complete_bucket: true, trailing_missing: 0 },
    oscillator_state: { fast_value: 55, slow_value: 51, spread: 4, atr: 120 },
    divergence_event: { kind: "regular_bullish", confirmation_bar_utc: "2026-09-05T12:00:00+00:00", age_bars: 3, max_event_age_bars: 8 },
    price_reference: {
      kind: "signal_bar_close",
      value: 61234.5,
      quote: "USDT",
      intended_entry: {
        rule: "open(t+1)",
        state,
        entry_bar_open_utc: state === "filled" ? "2026-09-05T14:00:00+00:00" : null,
        not_taken_reason: state === "not_taken" ? "declined_by_frozen_evaluator" : null,
        earliest_possible_entry_bar_open_utc: state === "pending" ? "2026-09-05T14:00:00+00:00" : null,
        fill_record_id: state === "filled" ? "f".repeat(64) : null,
      },
    },
    data_source: { provider: "binance", base_interval_minutes: 1, last_base_bar_close_utc: "2026-09-05T14:00:00+00:00", aggregation: { complete_required: true } },
    ...extra,
  };
}

// ── Honesty literals survive projection ──────────────────────────────────────

test("projects the real tracker output with every honesty flag at its frozen value", async () => {
  const block = await bundled();
  assert.equal(block.available, true);
  assert.equal(block.trackingOnly, true);
  assert.equal(block.deploymentAllowed, false);
  assert.equal(block.capitalAuthority, false);
  assert.equal(block.orderAuthority, false);
  assert.equal(block.notEstablishedAsDistinguishableFromSearchNoise, true);
  assert.ok(block.knownLimitations.length >= 5);
  assert.ok(isProducerQuote(block.purpose), "purpose must be a quoted producer caveat");
  assert.ok(block.purpose.quoted.length > 0);
});

test("refuses the whole block when any honesty flag disagrees", () => {
  const flags = {
    tracking_only: false,
    deployment_allowed: true,
    capital_authority: true,
    order_authority: true,
    not_established_as_distinguishable_from_search_noise: false,
  };
  for (const [key, value] of Object.entries(flags)) {
    const result = projectOscillatorWatch({ producer: producerFixture({ [key]: value }) });
    assert.equal(result.available, false, `${key} must not be surfaced`);
    assert.match(result.reason, new RegExp(key));
  }
});

test("refuses an unknown document id or producer schema version", () => {
  assert.equal(projectOscillatorWatch({ producer: producerFixture({ document_id: "something-else" }) }).available, false);
  assert.equal(projectOscillatorWatch({ producer: producerFixture({ schema_version: 2 }) }).available, false);
  assert.equal(projectOscillatorWatch({ producer: null }).available, false);
});

test("refuses a cell whose caveat was lost in projection", () => {
  const producer = producerFixture();
  producer.cells[0].known_limitations = [];
  const result = projectOscillatorWatch({ producer });
  assert.equal(result.available, false);
  assert.match(result.reason, /known_limitations/);
});

test("every projected cell carries its own known limitations", async () => {
  const block = await bundled();
  for (const cell of block.cells) {
    assert.ok(cell.knownLimitations.length > 0, `${cell.watchId} lost its caveat`);
  }
});

// ── Missing, corrupt and partial tracker output ──────────────────────────────

test("a missing tracker degrades to a stated reason rather than throwing", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "osc-missing-"));
  try {
    const result = await collectOscillatorWatch(root);
    assert.equal(result.available, false);
    assert.match(result.reason, /has not written a snapshot/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a corrupt tracker snapshot degrades to a stated reason rather than throwing", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "osc-corrupt-"));
  try {
    await mkdir(resolve(root, "data", "oscillator-alpha-watch"), { recursive: true });
    await writeFile(resolve(root, "data", "oscillator-alpha-watch", "snapshot.json"), '{"schema_ver', "utf8");
    const result = await collectOscillatorWatch(root);
    assert.equal(result.available, false);
    assert.match(result.reason, /unreadable/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a half-flushed ledger line is skipped and counted, not fatal", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "osc-jsonl-"));
  try {
    const watchRoot = resolve(root, "data", "oscillator-alpha-watch");
    await mkdir(resolve(watchRoot, "ledger"), { recursive: true });
    await writeFile(resolve(watchRoot, "snapshot.json"), JSON.stringify(producerFixture()), "utf8");
    const good = JSON.stringify(signalRecord("filled"));
    await writeFile(
      resolve(watchRoot, "ledger", "signals-2026-09.jsonl"),
      `${good}\n{"record_type": "signal", "reco`,
      "utf8",
    );
    const result = await collectOscillatorWatch(root);
    assert.equal(result.available, true);
    assert.equal(result.ledger.linesUnreadable, 1);
    assert.equal(result.ledger.partitionsRead, 1);
    assert.equal(result.history.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a missing tracker does not break the rest of the sync", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "osc-sync-"));
  const out = await mkdtemp(resolve(tmpdir(), "osc-out-"));
  const before = await sha256(protectedSnapshotPath);
  try {
    // The history is an INPUT. It is copied, not redirected to an empty path:
    // pointing the override at a file that does not exist is now refused rather
    // than silently producing a snapshot with no history and no profiles.
    const historyIn = resolve(out, "arbitra-daily-history.json");
    await writeFile(historyIn, await readFile(protectedHistoryPath, "utf8"), "utf8");
    const env = {
      ...process.env,
      ARBITRA_REPO: root,
      ARBITRA_SNAPSHOT_OUT: resolve(out, "arbitra-snapshot.json"),
      ARBITRA_HISTORY_IN: historyIn,
      ARBITRA_OSCILLATOR_OUT: resolve(out, "oscillator-alpha-watch.json"),
    };
    // Guard the human's checked-in artifacts: this test must never write there.
    assert.notEqual(env.ARBITRA_SNAPSHOT_OUT, protectedSnapshotPath);
    const { stdout } = await run(process.execPath, [resolve(uiRoot, "scripts", "sync-arbitra.mjs")], { env, cwd: uiRoot });
    assert.match(stdout, /no oscillator watch block/);

    const written = await readJson(env.ARBITRA_SNAPSHOT_OUT);
    assert.equal(written.schemaVersion, 6);
    assert.equal(written.deploymentAllowed, false);
    assert.equal(written.oscillatorWatch, null);

    const block = await readJson(env.ARBITRA_OSCILLATOR_OUT);
    assert.equal(block.available, false);
    assert.ok(typeof block.reason === "string" && block.reason.length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  }
  assert.equal(await sha256(protectedSnapshotPath), before, "the sync test must not touch public/data");
});

// ── Degraded cell states must survive as themselves ──────────────────────────

test("deferred cells are surfaced, never filtered away or normalised to flat", async () => {
  const block = await bundled();
  assert.equal(block.cells.length, block.registry.cellsTotal);
  const deferred = block.cells.filter((cell) => cell.status === "deferred");
  assert.equal(deferred.length, block.counts.deferred);
  assert.equal(deferred.length, block.registry.cellsDeferred);
  for (const cell of deferred) {
    assert.equal(cell.deferred.isDeferred, true);
    assert.equal(cell.evaluatedThisRun, false);
    // INVARIANT A: the reason still travels, and travels as a quotable value
    // rather than as a bare string this view could put in a sentence.
    assert.ok(isProducerQuote(cell.deferred.reason), "a deferred reason must be a quoted fragment");
    assert.ok(cell.deferred.reason.quoted.length > 0);
  }
});

test("source-unavailable cells keep the reason they are dark", async () => {
  const block = await bundled();
  const dark = block.cells.filter((cell) => cell.status === "source_unavailable");
  assert.equal(dark.length, block.counts.sourceUnavailable);
  for (const cell of dark) {
    assert.ok(isProducerQuote(cell.availability.detail));
    assert.ok(cell.availability.detail.quoted.length > 0);
    assert.notEqual(cell.status, "flat");
  }
});

test("insufficient history and lifecycle termination are not flattened", () => {
  const producer = producerFixture();
  producer.cells = [
    { ...producer.cells[0], watch_id: "A.x.1h.atr", status: "insufficient_history", bars_available: 12 },
    {
      ...producer.cells[0],
      watch_id: "B.x.1h.atr",
      status: "lifecycle_terminated_bankrupt",
      lifecycle: {
        replay_start_policy: "anchor",
        replay_start_policy_default: "anchor",
        bars_replayed: 4000,
        trades_returned: 7,
        bankrupt_trades: 1,
        terminated: true,
        termination: {
          reason: "bankrupt_trade",
          exit_bar_utc: "2026-05-01T00:00:00+00:00",
          exit_price: 1,
          exit_reason: "atr_stop",
          net_return_after_frozen_friction: -1.02,
          trades_before_termination: 6,
          unevaluated_bars: 3487,
          unevaluated_entry_pulses: 61,
          detail: "The evaluator abandoned the segment.",
        },
        fill_state_decidability: { predicted_declined: 3, predicted_declined_but_frozen_filled: 0 },
      },
    },
  ];
  const block = projectOscillatorWatch({ producer });
  assert.equal(block.available, true);
  assert.equal(block.cells[0].status, "insufficient_history");
  assert.equal(block.cells[0].warmup.effectiveBarsRequired, 152);
  assert.equal(block.cells[0].barsAvailable, 12);
  assert.equal(block.cells[1].status, "lifecycle_terminated_bankrupt");
  assert.equal(block.cells[1].lifecycle.termination.unevaluatedBars, 3487);
  assert.equal(block.cells[1].lifecycle.termination.unevaluatedEntryPulses, 61);
});

// ── The not_taken contract ───────────────────────────────────────────────────

test("a declined pulse projects as not_taken with its reason, never as a fill", () => {
  const producer = producerFixture({
    history: [signalRecord("not_taken"), signalRecord("filled"), signalRecord("pending")],
  });
  const block = projectOscillatorWatch({ producer });
  assert.equal(block.available, true);
  const states = block.history.map((record) => record.priceReference.intendedEntry.state).sort();
  assert.deepEqual(states, ["filled", "not_taken", "pending"]);
  const declined = block.history.find((record) => record.priceReference.intendedEntry.state === "not_taken");
  assert.equal(declined.notTakenReason, undefined, "the reason lives under intendedEntry");
  assert.deepEqual(declined.priceReference.intendedEntry.notTakenReason,
    { code: "declined_by_frozen_evaluator" },
    "a decline reason is a code from a closed vocabulary, never a bare string");
  assert.equal(declined.priceReference.intendedEntry.entryBarOpenUtc, null);
  assert.equal(declined.priceReference.intendedEntry.fillRecordId, null);
  // fillsThisRun counts fill records, never signal records.
  assert.equal(block.counts.fillsThisRun, 0);
  assert.equal(block.history.filter((record) => record.recordType === "fill").length, 0);
});

// ── Projection-level invariants a component can rely on ──────────────────────

test("every projected signal resolves to a cell, carries a BUY/SELL label and claims no authority", () => {
  const producer = producerFixture({
    active_signals: [{
      watch_id: "BTCUSDT.ta_rsi.30m.opposite_signal",
      asset: "BTCUSDT", timeframe: "30m", exit_family: "opposite_signal",
      status: "active_long", direction: "long", ui_label: "BUY",
      signal_id: "s".repeat(64), signal_bar_open_utc: "2026-09-05T13:30:00+00:00",
      entry_bar_open_utc: "2026-09-05T14:00:00+00:00", entry_price: 61000, bars_held: 2,
      unrealised_gross_return: 0.004, state_bar: null, tracking_only: true, order_authority: false,
    }],
  });
  const block = projectOscillatorWatch({ producer });
  assert.equal(block.available, true);
  const watchIds = new Set(block.cells.map((cell) => cell.watchId));
  for (const signal of [...block.activeSignals, ...block.pendingEntries]) {
    assert.ok(watchIds.has(signal.watchId));
    assert.ok(["BUY", "SELL"].includes(signal.uiLabel));
    assert.equal(signal.trackingOnly, true);
    assert.equal(signal.orderAuthority, false);
  }
  // A BUY whose cell (and therefore whose caveat) is missing is refused outright.
  const orphaned = producerFixture({ active_signals: producer.active_signals });
  orphaned.active_signals[0].watch_id = "GHOST.x.1h.atr";
  assert.equal(projectOscillatorWatch({ producer: orphaned }).available, false);
  // So is one that claims order authority.
  const authoritative = producerFixture({ active_signals: producer.active_signals });
  authoritative.active_signals[0].order_authority = true;
  assert.equal(projectOscillatorWatch({ producer: authoritative }).available, false);
});

test("history is capped, newest first, and states its own truncation", () => {
  const many = Array.from({ length: 60 }, (_, index) => ({
    schema_version: 1,
    ledger_id: "oscillator-alpha-watch-ledger-v1",
    record_type: "outage",
    record_id: createHash("sha256").update(`outage-${index}`).digest("hex"),
    signal_id: null,
    emitted_at_utc: `2026-09-${String((index % 28) + 1).padStart(2, "0")}T0${index % 10}:00:00+00:00`,
    watch_id: "BTCUSDT.ta_rsi.30m.opposite_signal",
    asset: "BTCUSDT", oscillator: "ta_rsi", timeframe: "30m", exit_family: "opposite_signal",
    honesty: { ...LEDGER_HONESTY },
    outage: { transition: "entered", from_utc: "2026-09-01T00:00:00+00:00", to_utc: null, reason: "stale_base_data", detail: "d", bars_missed: null },
  }));
  const producer = producerFixture({ history: many });
  producer.ledger.total_records = 60;
  const block = projectOscillatorWatch({ producer });
  assert.equal(block.history.length, OSCILLATOR_WATCH_HISTORY_CAP);
  assert.equal(block.historyRecordsAvailable, 60);
  assert.equal(block.historyTruncated, true);
  for (let index = 1; index < block.history.length; index += 1) {
    assert.ok(block.history[index - 1].emittedAtUtc >= block.history[index].emittedAtUtc);
  }
});

test("the projected payload stays inside its bundle budget", async () => {
  const block = await bundled();
  const bytes = Buffer.byteLength(JSON.stringify(block));
  assert.ok(bytes < 120_000, `oscillator watch block is ${bytes} bytes`);
});

test("the bundled projection is safe to render", async () => {
  const block = await bundled();
  assert.equal(block.available, true);
  assert.equal(block.deploymentAllowed, false);
  assert.equal(block.capitalAuthority, false);
  assert.equal(block.orderAuthority, false);
  assert.equal(block.trackingOnly, true);
  assert.equal(block.notEstablishedAsDistinguishableFromSearchNoise, true);
  for (const signal of [...block.activeSignals, ...block.pendingEntries]) {
    assert.equal(signal.orderAuthority, false);
    assert.equal(signal.trackingOnly, true);
  }
});

// ── Rendered output ──────────────────────────────────────────────────────────

/**
 * N5. The rendered-HTML tests import `dist/server/index.js`, which embeds
 * `app/data/oscillator-alpha-watch.json` as it stood at BUILD time. The only
 * guard used to be `existsSync`, so a dist built against a different projection
 * silently changed what these tests asserted against — a verifier hit a false
 * failure in "degraded cells read as themselves" from exactly that. The build
 * inputs were invisible to the tests that depend on them.
 *
 * N5 residual. The first fix keyed staleness on run IDENTITY — runId,
 * generatedAt, evaluatorVersion, cells[0].watchId — and two trees can agree on
 * all four while differing in content. The rich producer tree and the committed
 * live fixture are exactly that pair: identical on every identifier, 40 history
 * records against 36. A dist built from one, checked against an app/data holding
 * the other, reported FRESH and then failed opaquely, which is the failure this
 * gate exists to prevent.
 *
 * The marker is now a digest of the projection CONTENT, taken by the sync and
 * carried in the projection itself, so it lands in the SSR chunk as a string
 * literal the same way runId did. A digest cannot agree with a projection it was
 * not taken from, and the test recomputes it rather than trusting the field.
 */
function distServerSources() {
  const root = resolve(uiRoot, "dist", "server");
  if (!existsSync(root)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".js")) out.push(path);
    }
  };
  walk(root);
  return out;
}

/** The string that identifies WHICH projection a build consumed. */
function projectionMarkers(projection) {
  if (projection.available === false) {
    return [projection.reasonCode, projection.reason]
      .filter((value) => typeof value === "string" && value.length > 0);
  }
  // Recomputed, not read: a hand-edited projection carrying a stale digest is
  // the same staleness in a different place.
  return [projectionDigest(projection)];
}

/** `false` to run, or the reason these tests cannot answer for this tree. */
function staleBuildReason() {
  const server = resolve(uiRoot, "dist", "server", "index.js");
  if (!existsSync(server)) return "run npm run build first";
  let projection;
  try {
    projection = JSON.parse(readFileSync(bundledPath, "utf8"));
  } catch (error) {
    return `app/data/oscillator-alpha-watch.json is unreadable: ${error.message}`;
  }
  const markers = projectionMarkers(projection);
  if (markers.length === 0) {
    return "app/data/oscillator-alpha-watch.json carries no identifier to match against the build";
  }
  if (projection.available !== false && projection.projectionSha256 !== markers[0]) {
    return "app/data/oscillator-alpha-watch.json does not match its own content digest " +
      `(states ${String(projection.projectionSha256).slice(0, 16)}, hashes to ` +
      `${markers[0].slice(0, 16)}) — re-run npm run sync:data`;
  }
  const sources = distServerSources().map((path) => readFileSync(path, "utf8"));
  const missing = markers.filter((marker) => !sources.some((source) => source.includes(marker)));
  if (missing.length > 0) {
    return "dist was built against a different app/data/oscillator-alpha-watch.json " +
      `(missing ${JSON.stringify(missing[0])}) — re-run npm run build`;
  }
  return false;
}

const STALE_BUILD = staleBuildReason();

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the oscillator watch section", { skip: STALE_BUILD }, async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /id="oscillator-watch"/);
  assert.match(html, /Oscillator alpha watch/);
  assert.match(html, /Oscillator watch<\/a>/);
});

test("no label reaches the viewer without the null result in the same view", { skip: STALE_BUILD }, async () => {
  const response = await render();
  const html = await response.text();

  // The caveat and the campaign's null result are unconditional.
  assert.match(html, /not established as distinguishable from search noise/);
  assert.match(html, /p = 0\.455/);
  assert.match(html, /16 double-positive cells against a null mean of 15\.2/);
  assert.match(html, /percentile 0\.463/);
  assert.match(html, /0 of 15 survive/);
  assert.match(html, /tracking_only = true · deployment_allowed = false · capital_authority = false/);
  assert.match(html, /order_authority = false/);
  assert.match(html, /research only · no capital authority/);

  // And they are positioned above every lane that could carry a label, so a
  // viewer cannot reach a BUY or SELL without having passed the caveat.
  const section = html.indexOf('id="oscillator-watch"');
  const caveat = html.indexOf("not established as distinguishable from search noise");
  const nullResult = html.indexOf("p = 0.455");
  const firstLane = html.indexOf("Lane 01 · observation log");
  assert.ok(section >= 0 && caveat > section, "the caveat must be inside the section");
  assert.ok(nullResult > section && nullResult < firstLane, "the null result must precede the lanes");
  assert.ok(caveat < firstLane, "the caveat must precede the lanes");

  // Nothing anywhere on the page may claim authority.
  assert.doesNotMatch(html, /deployment enabled|order authority granted/i);
});

test("degraded cells read as themselves, and declined pulses are not fills", { skip: STALE_BUILD }, async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /deferred by human decision/);
  assert.match(html, /source unavailable/);
  // A degraded cell's own stated reason still reaches the page — and reaches it
  // as a quotation with a stated source, which is INVARIANT A rather than a
  // phrase from whichever run happened to be bundled when this was written.
  assert.match(html, /quoted from the tracker · not acted on by this interface/);
  assert.match(html, /<q>[^<]*Databento[^<]*<\/q>/);
  assert.match(html, /Declined by the evaluator/);
  assert.match(html, /never counted, coloured or rendered as a fill/);
  // The frozen fast/slow windows are stated next to the cell they belong to -
  // and each producer value is its own marked node. It used to read
  // `window 21`, one string built by the view from two producer-controlled
  // tokens and a literal space; there is no such string on the page now.
  assert.match(html, /data-producer="identifier">rsi_21</);
  assert.match(html, /data-producer="identifier">window<\/span><b>21<\/b>/);
  assert.doesNotMatch(html, /window 21/);
  // The runtime disagreement with the frozen protocol is stated, not hidden.
  assert.match(html, /Matches frozen protocol/);
});

// ═════════════════════════════════════════════════════════════════════════════
// N1. Every card that shows a BUY or SELL says, on that same card, that it
// carries no order authority.
//
// The earlier round measured this as ONE TOTAL over the signal and ledger lanes
// — 29 of 36 cards — and reported "missing own authority note: 0". The roster
// lane was never in the denominator, and the roster card is the only card type
// that shows an OPEN POSITION with a P&L: "SELL RECORDED · Direction short ·
// Entry $66,026.09 · Held 446 bars · Unrealised +4.75%", with the retrospective
// +41.01% / +91.71% beneath it and the nearest caveat 3,791 px away at 375 px.
// The most persuasive card on the page was the least qualified one.
//
// So the measurement is per TYPE and the enumeration is closed: an <article>
// whose class matches no registered type FAILS. A card type introduced later
// cannot pass by not being looked at.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The card kinds this section is allowed to render.
 *
 * Held HERE, frozen, rather than read out of app/page.tsx — a registry the test
 * derives from the source under test cannot fail when the source grows. A kind
 * added to the page and not to this list fails "the registry is closed"; a kind
 * on the page that renders without a counter-claim fails the rendered check.
 */
const OSCILLATOR_CARD_KINDS = [
  "roster",
  "roster-open-position",
  "live-signal",
  "ledger-entry",
  "ledger-exit",
  "ledger-declined",
  "ledger-pending",
  "ledger-outage",
];

const CARD_LABEL = /\b(?:BUY|SELL)\b/;
/** An authority note disclaims ORDERS. "tracking only" alone is not enough. */
const CARD_AUTHORITY = /no order authority|no order was placed|not a realised trade/i;

function htmlOpensTagAt(html, index, tag) {
  if (!html.startsWith(`<${tag}`, index)) return false;
  const next = html[index + tag.length + 1];
  return next === " " || next === ">" || next === "\n" || next === "\t";
}

/** Balanced <tag>…</tag> spans at or after `start`, non-overlapping. */
function htmlElements(html, tag, start = 0) {
  const close = `</${tag}>`;
  const out = [];
  let i = start;
  while (i < html.length) {
    if (!htmlOpensTagAt(html, i, tag)) { i += 1; continue; }
    let depth = 0;
    let j = i;
    let stop = -1;
    while (j < html.length) {
      if (htmlOpensTagAt(html, j, tag)) {
        const after = html.indexOf(">", j);
        if (after < 0) break;
        depth += 1;
        j = after + 1;
        continue;
      }
      if (html.startsWith(close, j)) {
        depth -= 1;
        j += close.length;
        if (depth === 0) { stop = j; break; }
        continue;
      }
      j += 1;
    }
    if (stop < 0) break;
    out.push(html.slice(i, stop));
    i = stop;
  }
  return out;
}

function htmlSection(html, id) {
  const anchor = html.indexOf(`id="${id}"`);
  if (anchor < 0) return null;
  const open = html.lastIndexOf("<section", anchor);
  if (open < 0) return null;
  return htmlElements(html, "section", open)[0] ?? null;
}

/** The kind an oscillator card declares. Null means it bypassed the shell. */
function htmlCardKind(element) {
  const at = element.indexOf('data-card-kind="');
  if (at < 0) return null;
  const from = at + 'data-card-kind="'.length;
  const to = element.indexOf('"', from);
  return to < 0 ? null : element.slice(from, to);
}

function htmlText(element) {
  let out = "";
  let i = 0;
  while (i < element.length) {
    if (element[i] === "<") {
      const gt = element.indexOf(">", i);
      if (gt < 0) break;
      i = gt + 1;
      out += " ";
      continue;
    }
    out += element[i];
    i += 1;
  }
  return out.replace(/\s+/g, " ").trim();
}

test("every card carries its own authority note, per card kind, labelled or not", { skip: STALE_BUILD }, async () => {
  const html = await (await render()).text();
  const section = htmlSection(html, "oscillator-watch");
  assert.ok(section, "the oscillator watch section did not render");
  const articles = htmlElements(section, "article");
  assert.ok(articles.length > 0, "the section rendered no cards at all");

  const rows = new Map(
    OSCILLATOR_CARD_KINDS.map((kind) => [kind, { cards: 0, labelled: 0, missing: [] }]),
  );
  for (const article of articles) {
    const kind = htmlCardKind(article);
    // Fails by default, on two counts: a card with no data-card-kind did not go
    // through OscillatorCard, and a kind this test does not know about was never
    // measured. Both are how the outage and declined cards went unqualified.
    assert.ok(
      kind != null,
      `an oscillator card rendered no data-card-kind, so it did not go through ` +
      `OscillatorCard: ${htmlText(article).slice(0, 120)}`,
    );
    assert.ok(
      rows.has(kind),
      `unregistered oscillator card kind ${JSON.stringify(kind)}. Add it to ` +
      "OSCILLATOR_CARD_KINDS and give it a counter-claim before it may render.",
    );
    const row = rows.get(kind);
    row.cards += 1;
    const text = htmlText(article);
    if (CARD_LABEL.test(text)) row.labelled += 1;
    // INVARIANT B. Not "if it is labelled" — every card, every kind. The outage
    // and declined kinds carry no BUY or SELL, which is exactly why the earlier
    // measurement skipped them and N6 rendered six unqualified cards.
    if (!CARD_AUTHORITY.test(text)) row.missing.push(text.slice(0, 160));
  }

  for (const kind of OSCILLATOR_CARD_KINDS) {
    const row = rows.get(kind);
    assert.equal(
      row.missing.length,
      0,
      `${kind}: ${row.missing.length} of ${row.cards} cards carry no authority note.\n` +
      `  e.g. ${row.missing[0] ?? ""}`,
    );
  }

  // And the kinds this data can produce are actually on the page, so the check
  // above is not passing on an empty denominator.
  const projection = JSON.parse(readFileSync(bundledPath, "utf8"));
  const expected = new Set(["roster", "live-signal"]);
  for (const record of projection.history ?? []) {
    if (record.recordType === "outage") expected.add("ledger-outage");
    else if (record.recordType === "exit") expected.add("ledger-exit");
    else if (record.priceReference?.intendedEntry?.state === "not_taken") {
      expected.add("ledger-declined");
    } else if (record.priceReference?.intendedEntry?.state === "pending") {
      expected.add("ledger-pending");
    } else expected.add("ledger-entry");
  }
  for (const kind of expected) {
    assert.ok(
      (rows.get(kind)?.cards ?? 0) > 0,
      `the bundled projection contains ${kind} records but no ${kind} card rendered`,
    );
  }
});

test("no oscillator card component renders an article of its own", async () => {
  // INVARIANT B by construction. The counter-claim is appended by OscillatorCard
  // unconditionally, so a card can only lack one by not going through it. A
  // component that opens its own <article> is that path, and it is closed here.
  const page = await readFile(resolve(uiRoot, "app", "page.tsx"), "utf8");
  const components = [...page.matchAll(/^function (Oscillator\w*Card)\b/gm)];
  assert.ok(components.length >= 4, `expected the shell and three cards, found ${components.length}`);
  const bodies = new Map();
  for (const match of components) {
    const next = page.indexOf("\nfunction ", match.index + 1);
    bodies.set(match[1], page.slice(match.index, next < 0 ? page.length : next));
  }
  assert.ok(bodies.has("OscillatorCard"), "the shared card shell is gone");
  for (const [name, body] of bodies) {
    if (name === "OscillatorCard") continue;
    assert.doesNotMatch(
      body,
      /<article\b/,
      `${name} opens its own <article>. Every oscillator card must go through ` +
      "OscillatorCard, which is what appends the counter-claim unconditionally.",
    );
    assert.match(
      body,
      /<OscillatorCard\b/,
      `${name} does not render through OscillatorCard`,
    );
  }

  // The shell appends the note UNCONDITIONALLY: no ternary, no &&, no status.
  const shell = bodies.get("OscillatorCard");
  assert.match(
    shell,
    /<article className=\{className\} data-card-kind=\{kind\} data-bears-authority="card">/,
  );
  assert.match(shell, /\{OSCILLATOR_CARD_AUTHORITY\[kind\]\}/);
  const authorityBlock = shell.slice(shell.indexOf("oscillator-card-authority"));
  assert.doesNotMatch(
    authorityBlock.slice(0, authorityBlock.indexOf("</div>")),
    /[?]|&&/,
    "the counter-claim is conditional; a disclaimer that appears only in some " +
    "states is the same defect waiting on a different branch",
  );
});

test("every registered card kind states no order authority, and the registry is closed", async () => {
  const page = await readFile(resolve(uiRoot, "app", "page.tsx"), "utf8");
  const from = page.indexOf("const OSCILLATOR_CARD_AUTHORITY = {");
  assert.ok(from >= 0, "OSCILLATOR_CARD_AUTHORITY is gone");
  const table = page.slice(from, page.indexOf("} as const;", from));
  // key: "note", with the note on the same line or the next one. The notes
  // are plain literals with no escaped quotes, so a quote ends one.
  const entries = [...table.matchAll(/"?([a-z-]+)"?:[ \r\n]*"([^"]*)"/g)]
    .map((match) => [match[1], match[2]]);
  assert.deepEqual(
    entries.map(([kind]) => kind).sort(),
    OSCILLATOR_CARD_KINDS.slice().sort(),
    "app/page.tsx registers a different set of card kinds than this test measures. " +
    "A new card kind must be added HERE too, or it renders unmeasured.",
  );
  // Each kind's note disclaims ORDERS. "tracking only" alone is not enough.
  for (const [kind, note] of entries) {
    assert.match(
      note,
      CARD_AUTHORITY,
      `card kind ${kind} has a counter-claim that does not disclaim order authority: ` +
      JSON.stringify(note),
    );
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// INVARIANT B, keyed on producer content rather than on `<article>`.
//
// The previous round asked "is this an <article>, and does its text contain a
// counter-claim?". An adversary answered it with a fourteen-line <div> called
// WatchDeskNote that rendered cell.asset, cell.oscillator, cell.exitFamily and
// the frozen leg parameters with no counter-claim anywhere near it: 71 pass, 0
// fail. Five of six new-card variants were caught; the one that was not is the
// one a contributor would actually write, because it is the one that does not
// look like a card.
//
// And from the other side, registry.registryId, runId and the runtime versions
// sit OUTSIDE every card. No rule about cards, however phrased, could ever have
// reached them.
//
// So the question is now "does this subtree render a producer value?". Every
// node that does carries `data-producer`; every such node must have an ancestor
// carrying `data-bears-authority`. OscillatorCard is one bearer, OscillatorRegion
// is the other, and both append their counter-claim unconditionally.
// ═════════════════════════════════════════════════════════════════════════════

/** The oscillator section of the rendered page, or null. */
function oscillatorSection(html) {
  const anchor = html.indexOf('id="oscillator-watch"');
  if (anchor < 0) return null;
  const open = html.lastIndexOf("<section", anchor);
  return open < 0 ? null : html.slice(open);
}

test("every marked producer value on the page sits under a counter-claim", { skip: STALE_BUILD }, async () => {
  const html = await (await render()).text();
  const section = oscillatorSection(html);
  assert.ok(section, "the oscillator watch section did not render");

  let marked = 0;
  const unborne = [];
  walkHtml(section, (text, stack) => {
    const flat = text.replace(/\s+/g, " ").trim();
    if (flat.length === 0) return;
    if (!stack.some((entry) => entry.attrs.includes("data-producer"))) return;
    marked += 1;
    if (!stack.some((entry) => entry.attrs.includes("data-bears-authority"))) {
      unborne.push(`${stack.map((entry) => entry.name).join(">")}: ${flat.slice(0, 90)}`);
    }
  });

  assert.deepEqual(
    unborne,
    [],
    `${unborne.length} producer values render with no counter-claim above them. Every node ` +
    "carrying data-producer must be inside an OscillatorCard or an OscillatorRegion.",
  );
  // Not a vacuous pass: the page really does print this many producer values.
  assert.ok(marked > 200, `only ${marked} marked producer text runs on the page`);
});

/** Every producer-supplied string in a projected block, with its manifest class. */
function producerStrings(block) {
  const out = [];
  const visit = (value, path) => {
    if (value == null || typeof value === "number" || typeof value === "boolean") return;
    const declared = Object.hasOwn(OSCILLATOR_STRING_MANIFEST, path)
      ? OSCILLATOR_STRING_MANIFEST[path]
      : null;
    if (typeof value === "string") {
      out.push({ path, declared, text: value });
      return;
    }
    if (isProducerValue(value)) {
      out.push({ path, declared, text: isProducerCode(value) ? value.code : value.quoted });
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, `${path}[]`);
      return;
    }
    if (typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        visit(entry, path.length > 0 ? `${path}.${key}` : key);
      }
    }
  };
  visit(block, "");
  return out;
}

/** Every string literal in app/page.tsx, as one lower-cased haystack. */
async function interfaceOwnWords() {
  const page = await readFile(resolve(uiRoot, "app", "page.tsx"), "utf8");
  return [...page.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g)]
    .map((match) => (match[1] ?? match[2] ?? "").toLowerCase())
    .join(" ");
}

test("no producer string reaches the DOM outside a marked node", { skip: STALE_BUILD }, async () => {
  // The shape of the exhaustive sweep, run against the values the page actually
  // shipped. scripts/oscillator-marking-sweep.mjs is the every-leaf version: it
  // plants a unique sentinel at all 1,551 classified leaves, rebuilds, and grades
  // the render. This runs on every `npm test` without a rebuild, and it is what
  // holds `opaque` honest — a value classified as never-printed that starts being
  // printed shows up here as an unmarked producer string.
  const html = await (await render()).text();
  const section = oscillatorSection(html);
  assert.ok(section, "the oscillator watch section did not render");

  let unmarked = "";
  walkHtml(section, (text, stack) => {
    if (stack.some((entry) => entry.attrs.includes("data-producer"))) return;
    unmarked += `${text} `;
  });
  unmarked = unmarked.replace(/\s+/g, " ");

  // A producer value this interface uses as its OWN word is not evidence of
  // anything: "flat", "signal" and "short" appear in prose written here. The
  // exemption is derived from app/page.tsx rather than listed, so it cannot
  // drift into an excuse for a word the page stopped saying.
  const own = await interfaceOwnWords();
  const escape = (value) => value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = JSON.parse(readFileSync(bundledPath, "utf8"));
  assert.equal(block.available, true, "the bundled projection is a refusal");

  const leaked = [];
  let checked = 0;
  for (const { path, declared, text } of producerStrings(block)) {
    if (text.length < 3) continue;
    if (own.includes(text.toLowerCase())) continue;
    checked += 1;
    if (new RegExp(`(^|[^A-Za-z0-9_])${escape(text)}([^A-Za-z0-9_]|$)`).test(unmarked)) {
      leaked.push(`${path} [${declared}] ${JSON.stringify(text.slice(0, 60))}`);
    }
  }
  assert.deepEqual(
    leaked,
    [],
    `${leaked.length} producer values render outside any node marked data-producer. A value ` +
    "classified `opaque` must not be printed at all; a printed one must go through " +
    "ProducerIdentifier, ProducerQuoted or CodedPhrase.",
  );
  assert.ok(checked > 200, `only ${checked} producer values were distinguishable enough to check`);
});

test("only the marking components mark, and only the bearers bear", async () => {
  // Closes the obvious bypass: a component that writes `data-producer` on a node
  // it renders raw, or `data-bears-authority` on a node with no counter-claim
  // under it. Both attributes are written in exactly one place each.
  const page = await readFile(resolve(uiRoot, "app", "page.tsx"), "utf8");
  const bodyOf = (name) => {
    const at = page.indexOf(`function ${name}(`);
    assert.ok(at >= 0, `${name} is gone`);
    const next = page.indexOf("\nfunction ", at + 1);
    return page.slice(at, next < 0 ? page.length : next);
  };
  const markers = ["ProducerQuoted", "ProducerIdentifier", "CodedPhrase", "OscillatorWatchUnavailable"]
    .map(bodyOf)
    .join("\n");
  const bearers = ["OscillatorCard", "OscillatorRegion"].map(bodyOf).join("\n");
  for (const line of page.split("\n")) {
    // Comments talk about both attributes; only code may write them.
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) continue;
    if (line.includes("data-producer")) {
      assert.ok(
        markers.includes(line),
        `data-producer is written outside the marking components: ${line.trim()}`,
      );
    }
    if (line.includes("data-bears-authority")) {
      assert.ok(
        bearers.includes(line),
        `data-bears-authority is written outside OscillatorCard/OscillatorRegion: ${line.trim()}`,
      );
    }
  }
  // And every bearer really does append a counter-claim, unconditionally.
  for (const name of ["OscillatorCard", "OscillatorRegion"]) {
    const body = bodyOf(name);
    const authority = body.slice(body.indexOf("oscillator-card-authority"));
    assert.ok(authority.length > 0, `${name} appends no counter-claim`);
    assert.doesNotMatch(
      authority.slice(0, authority.indexOf("</div>")),
      /[?]|&&/,
      `${name} appends its counter-claim conditionally`,
    );
  }
});

test("every region states no order authority, and the region registry is closed", async () => {
  const page = await readFile(resolve(uiRoot, "app", "page.tsx"), "utf8");
  const from = page.indexOf("const OSCILLATOR_REGION_AUTHORITY = {");
  assert.ok(from >= 0, "OSCILLATOR_REGION_AUTHORITY is gone");
  const table = page.slice(from, page.indexOf("} as const;", from));
  const entries = [...table.matchAll(/"?([a-z-]+)"?:[ \r\n]*"([^"]*)"/g)].map((m) => [m[1], m[2]]);
  assert.ok(entries.length >= 5, `only ${entries.length} regions are registered`);
  for (const [region, note] of entries) {
    assert.match(
      note,
      CARD_AUTHORITY,
      `region ${region} has a counter-claim that does not disclaim order authority: ` +
      JSON.stringify(note),
    );
  }
  // Every region named in the page is one of them; a new region cannot be
  // rendered without a note, because the table is the type.
  for (const match of page.matchAll(/region="([^"]+)"/g)) {
    assert.ok(
      entries.some(([region]) => region === match[1]),
      `region ${JSON.stringify(match[1])} is rendered but has no counter-claim`,
    );
  }
});

test("no ledger card is styled as an entry while saying the pulse was declined", { skip: STALE_BUILD }, async () => {
  const response = await render();
  const html = await response.text();
  const cards = html.split("history-card oscillator-record").slice(1);
  assert.ok(cards.length > 0, "the ledger rendered no cards");
  for (const card of cards) {
    const body = card.slice(0, card.indexOf("</article>"));
    // `.aligned` is the only class that turns a card's pill green. A declined
    // pulse, a pending pulse and an outage must never carry it.
    const alignedEntry = body.startsWith(" aligned");
    if (alignedEntry) {
      assert.doesNotMatch(body, /not taken|Declined by the frozen evaluator|not reporting|Entry bar has not opened/);
    }
    // And nothing in this ledger may borrow the "target hit" green treatment.
    assert.doesNotMatch(body, /reference-outcome hit/);
  }
});

// ── The protected artifacts are never written by this suite ──────────────────

test("the checked-in snapshot is not modified by anything in this suite", async () => {
  assert.ok(existsSync(protectedSnapshotPath));
  const before = await sha256(protectedSnapshotPath);
  await collectOscillatorWatch(dirname(uiRoot));
  assert.equal(await sha256(protectedSnapshotPath), before);
});

// ═════════════════════════════════════════════════════════════════════════════
// The live-signal fixture.
//
// Everything above this line was written against the real producer tree, which
// on the day it was captured held zero signals, zero fills and zero exits. A
// projection can pass all of it while doing nothing whatsoever to a BUY, which
// is exactly how the ungated ledger lane went unnoticed. tests/fixtures/
// oscillator-watch-live is a trimmed capture of a rich run — 17 cells across
// five statuses, 7 open observations, a pending entry, and 24 ledger records
// covering every record type and every intended-entry state.
// ═════════════════════════════════════════════════════════════════════════════

const liveFixtureRoot = resolve(uiRoot, "tests", "fixtures", "oscillator-watch-live");

async function live() {
  const block = await collectOscillatorWatch(liveFixtureRoot);
  assert.equal(block.available, true, `the live fixture must project: ${block.reason ?? ""}`);
  return block;
}

/** The live fixture's producer document, for mutation tests. */
async function liveProducer() {
  return readJson(
    resolve(liveFixtureRoot, "data", "oscillator-alpha-watch", "snapshot.json"),
  );
}

/** Project a producer document that has had one ledger record tampered with. */
function projectWithPatchedRecord(producer, patch, pick = (record) => record.record_type === "signal") {
  const clone = structuredClone(producer);
  const target = clone.history
    .filter(pick)
    .sort((left, right) => right.emitted_at_utc.localeCompare(left.emitted_at_utc))[0];
  assert.ok(target, "the fixture holds no record matching the selector");
  Object.assign(target, patch);
  return projectOscillatorWatch({ producer: clone });
}

test("the live fixture surfaces every lane the UI can render", async () => {
  const block = await live();
  const statuses = {};
  for (const cell of block.cells) statuses[cell.status] = (statuses[cell.status] ?? 0) + 1;
  assert.deepEqual(statuses, {
    active_long: 2, active_short: 5, flat: 7, deferred: 2, lifecycle_terminated_bankrupt: 1,
  });
  assert.equal(block.activeSignals.length, 7);
  assert.equal(block.pendingEntries.length, 1);

  const kinds = {};
  for (const record of block.history) kinds[record.recordType] = (kinds[record.recordType] ?? 0) + 1;
  assert.ok(kinds.signal > 0 && kinds.fill > 0 && kinds.exit > 0 && kinds.outage > 0,
    `every record type must be present: ${JSON.stringify(kinds)}`);

  const states = new Set(
    block.history
      .filter((record) => record.recordType === "signal")
      .map((record) => record.priceReference.intendedEntry.state),
  );
  assert.deepEqual([...states].sort(), ["filled", "not_taken", "pending"]);
});

// ── D1. The ledger lane is gated exactly as the live lane is ─────────────────

test("a ledger record with a label outside BUY/SELL refuses the whole block", async () => {
  const producer = await liveProducer();
  const result = projectWithPatchedRecord(producer, { ui_label: "GUARANTEED BUY" });
  assert.equal(result.available, false);
  assert.match(result.reason, /uiLabel is outside the uiLabel set: "GUARANTEED BUY"/);
});

test("a ledger record revoking its own tracking-only status refuses the whole block", async () => {
  const producer = await liveProducer();
  for (const honesty of [{ tracking_only: false }, { order_authority: true }]) {
    const result = projectWithPatchedRecord(producer, {
      honesty: { ...producer.history[0].honesty, ...honesty },
    });
    assert.equal(result.available, false, `${JSON.stringify(honesty)} was surfaced`);
    assert.match(result.reason, /claims authority/);
  }
});

test("a ledger record whose watch_id resolves to no cell refuses the whole block", async () => {
  const producer = await liveProducer();
  const result = projectWithPatchedRecord(producer, { watch_id: "NOPE.ta_rsi.30m.opposite_signal" });
  assert.equal(result.available, false);
  assert.match(result.reason, /unknown watchId "NOPE\.ta_rsi\.30m\.opposite_signal"/);
});

test("the per-record honesty flags are carried, not discarded in projection", async () => {
  const block = await live();
  assert.ok(block.history.length > 0);
  for (const record of block.history) {
    assert.equal(record.trackingOnly, true, `${record.recordId} lost tracking_only`);
    assert.equal(record.orderAuthority, false, `${record.recordId} lost order_authority`);
  }
});

test("a fill or exit record is gated too, not only a signal record", async () => {
  const producer = await liveProducer();
  for (const type of ["fill", "exit", "outage"]) {
    const result = projectWithPatchedRecord(
      producer,
      { honesty: { ...producer.history[0].honesty, order_authority: true } },
      (record) => record.record_type === type,
    );
    assert.equal(result.available, false, `a ${type} record claiming authority was surfaced`);
    assert.match(result.reason, /claims authority/);
  }
});

test("the live lane is not regressed by the ledger lane gate", async () => {
  const producer = await liveProducer();
  const cases = [
    [{ ui_label: "GUARANTEED BUY" }, /uiLabel is outside the uiLabel set: "GUARANTEED BUY"/],
    [{ order_authority: true }, /claims authority/],
    [{ tracking_only: false }, /claims authority/],
    [{ watch_id: "NOPE" }, /unknown watchId/],
  ];
  for (const [patch, expected] of cases) {
    const clone = structuredClone(producer);
    Object.assign(clone.active_signals[0], patch);
    const result = projectOscillatorWatch({ producer: clone });
    assert.equal(result.available, false, `active_signals ${JSON.stringify(patch)} was surfaced`);
    assert.match(result.reason, expected);
  }
  for (const [patch, expected] of cases) {
    const clone = structuredClone(producer);
    Object.assign(clone.pending_entries[0], patch);
    const result = projectOscillatorWatch({ producer: clone });
    assert.equal(result.available, false, `pending_entries ${JSON.stringify(patch)} was surfaced`);
    assert.match(result.reason, expected);
  }
});

test("one gate covers both lanes, so neither can be relaxed alone", async () => {
  const block = await live();
  assert.equal(oscillatorWatchHonestyViolation(block), null);
  // The gate the projection ran is the same function every other surface runs.
  const laundered = structuredClone(block);
  laundered.history[0].uiLabel = "GUARANTEED BUY";
  laundered.history[0].recordType = "signal";
  assert.match(oscillatorWatchHonestyViolation(laundered) ?? "", /uiLabel/);
});

// ── D5. The frozen entry rule is carried, never asserted by the view ─────────

test("the frozen entry rule travels with the record instead of being hardcoded", async () => {
  const block = await live();
  const signals = block.history.filter((record) => record.recordType === "signal");
  assert.ok(signals.length > 0);
  for (const record of signals) {
    assert.deepEqual(record.priceReference.intendedEntry.rule, { code: "open(t+1)" });
  }
  // And the view states it from the data. A UI that hardcodes the rule keeps
  // asserting the old one after the frozen rule changes, which is exactly the
  // drift this surface exists to catch.
  const page = await readFile(resolve(uiRoot, "app", "page.tsx"), "utf8");
  assert.doesNotMatch(page, /open\(t\+1\)/, "app/page.tsx still hardcodes the frozen entry rule");
  assert.match(page, /intended\?\.rule/);
});

// ── D7. Truncation is judged on what was observed, not on a producer counter ──

test("a stale total_records cannot report a truncated ledger as complete", () => {
  const many = Array.from({ length: 60 }, (_, index) => signalRecord("filled", {
    record_id: createHash("sha256").update(`stale-${index}`).digest("hex"),
    emitted_at_utc: `2026-09-${String((index % 28) + 1).padStart(2, "0")}T0${index % 10}:00:00+00:00`,
  }));
  const producer = producerFixture({ history: many });
  // The producer counter lags what the partitions actually hold.
  producer.ledger.total_records = 12;
  const block = projectOscillatorWatch({ producer });
  assert.equal(block.history.length, OSCILLATOR_WATCH_HISTORY_CAP);
  assert.equal(block.historyRecordsObserved, 60);
  assert.equal(block.historyRecordsReported, 12);
  assert.equal(block.historyRecordsAvailable, 60, "the observed count must win over a stale counter");
  assert.equal(block.historyTruncated, true, "20 dropped records were reported as not truncated");
});

test("a producer counter larger than the partitions read is still honoured", async () => {
  // The normal case: the ledger holds more than the newest partitions carry.
  const block = await live();
  assert.equal(block.historyRecordsReported, 321);
  assert.equal(block.historyRecordsAvailable, 321);
  assert.equal(block.historyTruncated, true);
});

// ── D8. One event, one register ──────────────────────────────────────────────

test("a fill and a signal describe the same event in the same words", async () => {
  const block = await live();
  const fills = block.history.filter((record) => record.recordType === "fill");
  assert.ok(fills.length > 0, "the fixture holds no fill records");
  const page = await readFile(resolve(uiRoot, "app", "page.tsx"), "utf8");
  // The pill is built from the mapped label, never from a raw direction.
  assert.match(page, /oscillatorSignalLabel\(record\) \?\? "entry"/);
  assert.doesNotMatch(page, /record\.uiLabel \?\? record\.direction/);
  for (const record of fills) {
    assert.ok(record.direction === "long" || record.direction === "short");
  }
});

// ── D4. The client guard is the build-time gate, not a weaker restatement ────

test("the client guard is the shared gate rather than a hand-written copy", async () => {
  const page = await readFile(resolve(uiRoot, "app", "page.tsx"), "utf8");
  // Matched on the import's SHAPE rather than its exact text, so adding a name
  // to the same import does not read as the guard having been replaced.
  const gateImport = /import \{([^}]*)\} from "\.\.\/scripts\/oscillator-honesty\.mjs"/.exec(page);
  assert.ok(gateImport, "app/page.tsx does not import the shared honesty gate");
  const imported = gateImport[1].split(",").map((name) => name.trim()).filter(Boolean);
  assert.ok(
    imported.includes("oscillatorWatchHonestyViolation"),
    `the client must import the shared gate itself, got ${JSON.stringify(imported)}`,
  );
  // The bespoke twelve-condition guard checked nothing inside activeSignals,
  // pendingEntries or history. It must not come back.
  assert.doesNotMatch(page, /function isSafeOscillatorWatch/);
});

test("the shipped client bundle carries the per-record ledger checks", { skip: STALE_BUILD }, async () => {
  const chunks = resolve(uiRoot, "dist", "client", "_next", "static", "chunks");
  const names = (await readdir(chunks)).filter((name) => name.endsWith(".js"));
  const sources = await Promise.all(names.map((name) => readFile(resolve(chunks, name), "utf8")));
  const bundle = sources.join("\n");
  for (const marker of [
    "ledger record references unknown watchId",
    "claims authority",
    "carries no knownLimitations",
    "notEstablishedAsDistinguishableFromSearchNoise is not true",
  ]) {
    assert.ok(bundle.includes(marker), `the client bundle is missing the check: ${marker}`);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// N2. cell.status is a PRINTED HEADLINE, so its enum belongs to the shared gate.
// ═════════════════════════════════════════════════════════════════════════════

test("an unknown cell status is refused by the shared gate, not only at build time", async () => {
  const producer = await liveProducer();
  const good = projectOscillatorWatch({ producer });
  assert.equal(good.available, true);

  const evil = "GUARANTEED BUY - capital authority granted";
  const block = structuredClone(good);
  block.cells[0].status = evil;

  // All three enforcement points, not just the one that builds the block.
  const tampered = structuredClone(producer);
  tampered.cells[0].status = evil;
  const projected = projectOscillatorWatch({ producer: tampered });
  assert.equal(projected.available, false, "build-time projection accepted an unknown status");
  assert.match(projected.reason, /unknown cell status/);

  assert.match(
    oscillatorWatchHonestyViolation(block) ?? "",
    /status is outside the cellStatus set/,
    "the shared gate accepted an unknown status, so the server and the client would too",
  );
  assert.throws(() => validateOscillatorWatch(block), /status is outside the cellStatus set/);
});

test("the status enum has exactly one definition, and the client cannot echo an unknown one", async () => {
  // The projection imports the set rather than restating it.
  const projection = await readFile(resolve(uiRoot, "scripts", "oscillator-watch.mjs"), "utf8");
  assert.match(projection, /import \{[^}]*CELL_STATUSES[^}]*\} from "\.\/oscillator-honesty\.mjs"/);
  assert.doesNotMatch(projection, /const CELL_STATUSES = new Set/);

  // Every status the client has a label for is in the shared set, and vice
  // versa: a status the gate admits but the client cannot name would render as
  // the fallback, and a label for a status the gate refuses is dead code.
  const page = await readFile(resolve(uiRoot, "app", "page.tsx"), "utf8");
  const labels = /const OSCILLATOR_STATUS_LABELS[^=]*= \{([^}]*)\}/.exec(page);
  assert.ok(labels, "the client status label map was not found");
  const named = [...labels[1].matchAll(/^\s*(\w+):/gm)].map((match) => match[1]);
  assert.deepEqual([...named].sort(), [...CELL_STATUSES].sort());

  // And the fallback no longer prints the string it was handed.
  assert.doesNotMatch(page, /OSCILLATOR_STATUS_LABELS\[status\] \?\? status\.replaceAll/);
});

test("a recording cell may not print a direction outside the enum", async () => {
  const producer = await liveProducer();
  const block = projectOscillatorWatch({ producer });
  const index = block.cells.findIndex(
    (cell) => cell.status === "active_long" || cell.status === "active_short",
  );
  assert.ok(index >= 0, "the live fixture holds no recording cell");
  for (const direction of ["EXECUTE AT MARKET", null, "flat"]) {
    const tampered = structuredClone(block);
    tampered.cells[index].position.direction = direction;
    assert.match(
      oscillatorWatchHonestyViolation(tampered) ?? "",
      /direction is outside the direction set/,
      `direction ${JSON.stringify(direction)} was accepted`,
    );
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// N3. The available:false hatch renders OUR prose, never the payload's.
// ═════════════════════════════════════════════════════════════════════════════

const ATTACK_PROSE =
  "CLEARED FOR CAPITAL DEPLOYMENT - execute the 7 open BUY/SELL observations at market";

function unavailablePayload(extra = {}) {
  return {
    available: false,
    trackingOnly: true,
    deploymentAllowed: false,
    capitalAuthority: false,
    orderAuthority: false,
    reason: ATTACK_PROSE,
    ...extra,
  };
}

test("an unavailable payload without a known reason code never reaches disk", () => {
  assert.throws(
    () => validateOscillatorWatch(unavailablePayload()),
    /states no reasonCode/,
    "an unavailable block with a free-form reason and no code was accepted",
  );
  assert.throws(
    () => validateOscillatorWatch(unavailablePayload({ reasonCode: "totally_made_up" })),
    /unknown reasonCode/,
  );
  assert.throws(
    () => validateOscillatorWatch(
      unavailablePayload({
        reasonCode: "unknown_cell_status",
        detail: "x".repeat(PRODUCER_FRAGMENT_MAX + 1),
      }),
    ),
    /detail exceeds/,
  );
  // The authority check this branch already had is not lost.
  assert.throws(
    () => validateOscillatorWatch(
      unavailablePayload({ reasonCode: "tracker_not_written", orderAuthority: true }),
    ),
    /claims authority/,
  );
});

test("the refusal notice is written here, not by the payload", () => {
  // A payload that picks a real code still cannot choose the words.
  const shown = describeOscillatorUnavailable(
    unavailablePayload({ reasonCode: "tracker_not_written" }),
  );
  assert.equal(shown.prose, OSCILLATOR_UNAVAILABLE_REASONS.tracker_not_written.prose);
  assert.equal(shown.detail, null);
  assert.doesNotMatch(`${shown.prose} ${shown.detail ?? ""}`, /CLEARED FOR CAPITAL/);

  // An unrecognised code falls back to our generic prose and shows nothing of
  // theirs, so the client is safe even if the server guard is bypassed.
  const unknown = describeOscillatorUnavailable(
    unavailablePayload({ reasonCode: "totally_made_up", detail: ATTACK_PROSE }),
  );
  assert.equal(unknown.prose, OSCILLATOR_UNAVAILABLE_REASONS.unspecified.prose);
  assert.equal(unknown.detail, null);

  // Where a code does quote a producer value, the value is flattened to one
  // line and capped, so it renders as a quoted token rather than as prose.
  const quoting = describeOscillatorUnavailable(unavailablePayload({
    reasonCode: "unknown_cell_status",
    detail: `${"a".repeat(400)}\nsecond line`,
  }));
  assert.equal(quoting.prose, OSCILLATOR_UNAVAILABLE_REASONS.unknown_cell_status.prose);
  assert.ok(
    quoting.detail.length <= PRODUCER_FRAGMENT_MAX,
    `detail was ${quoting.detail.length} characters`,
  );
  assert.doesNotMatch(quoting.detail, /\n/);

  // Every code this projection can emit is one the notice knows how to speak.
  const projection = readFileSync(resolve(uiRoot, "scripts", "oscillator-watch.mjs"), "utf8");
  const emitted = [...projection.matchAll(/unavailable\([^,)]*,\s*"(\w+)"/g)].map((m) => m[1]);
  assert.ok(emitted.length > 0, "no reason codes were found in the projection");
  for (const code of new Set(emitted)) {
    assert.ok(
      Object.hasOwn(OSCILLATOR_UNAVAILABLE_REASONS, code),
      `the projection emits reasonCode ${JSON.stringify(code)} with no prose to render it`,
    );
  }
});

test("every refusal the projection can state carries a code the notice recognises", async () => {
  const cases = [
    [{ document_id: "something-else" }, "unexpected_document_id"],
    [{ schema_version: 99 }, "unsupported_schema_version"],
    [{ tracking_only: false }, "honesty_flag_disagrees"],
    [{ order_authority: true }, "honesty_flag_disagrees"],
    [{ known_limitations: [] }, "known_limitations_empty"],
    [{ purpose: null }, "purpose_missing"],
    [{ cells: [] }, "cells_empty"],
  ];
  for (const [patch, expected] of cases) {
    const producer = { ...(await liveProducer()), ...patch };
    const result = projectOscillatorWatch({ producer });
    assert.equal(result.available, false, `${JSON.stringify(patch)} was surfaced`);
    assert.equal(result.reasonCode, expected, `wrong code for ${JSON.stringify(patch)}`);
    assert.equal(oscillatorUnavailableViolation(result), null,
      `the projection's own refusal for ${JSON.stringify(patch)} would be refused by the server`);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// N4. Partition selection: the newest MONTH, not the highest-sorting NAME.
// ═════════════════════════════════════════════════════════════════════════════

test("selecting the newest partitions never drops a stream's newest month", () => {
  const names = ["outages-2026-08.jsonl", "signals-2026-06.jsonl", "signals-2026-07.jsonl"];
  // A descending name sort makes the PREFIX outrank the MONTH: it would select
  // signals-2026-07 and signals-2026-06 and drop outages-2026-08 entirely.
  const selected = selectNewestPartitions(names, 2);
  assert.ok(
    selected.includes("outages-2026-08.jsonl"),
    `the newest month was dropped: ${JSON.stringify(selected)}`,
  );
  for (const name of names) assert.ok(selected.includes(name), `${name} was dropped`);

  // The limit still bounds work per stream rather than being abandoned.
  const many = [
    "signals-2026-04.jsonl", "signals-2026-05.jsonl", "signals-2026-06.jsonl",
    "signals-2026-07.jsonl", "outages-2026-08.jsonl",
  ];
  const bounded = selectNewestPartitions(many, 2);
  assert.equal(bounded.filter((name) => name.startsWith("signals-")).length, 2);
  assert.deepEqual(bounded.filter((name) => name.startsWith("signals-")).sort(),
    ["signals-2026-06.jsonl", "signals-2026-07.jsonl"]);

  // Ordering is by parsed month, so 2026-10 outranks 2026-09 and 2027-01
  // outranks 2026-12.
  assert.deepEqual(selectNewestPartitions(["signals-2026-09.jsonl", "signals-2026-10.jsonl"], 1),
    ["signals-2026-10.jsonl"]);
  assert.deepEqual(selectNewestPartitions(["signals-2026-12.jsonl", "signals-2027-01.jsonl"], 1),
    ["signals-2027-01.jsonl"]);

  // A name carrying no month is its own stream rather than being dropped.
  assert.deepEqual(selectNewestPartitions(["legacy.jsonl", "signals-2026-07.jsonl"], 1).sort(),
    ["legacy.jsonl", "signals-2026-07.jsonl"]);
});

test("an outage that exists only in its own partition still reaches the ledger", async () => {
  // The bug was harmless on the captured fixture only because snapshot.history
  // carried the outage too. An outage is the tracker reporting that it went
  // quiet, which is the one record this surface exists to show.
  const root = await mkdtemp(resolve(tmpdir(), "osc-partition-"));
  const watchRoot = resolve(root, "data", "oscillator-alpha-watch");
  const ledgerRoot = resolve(watchRoot, "ledger");
  await mkdir(ledgerRoot, { recursive: true });
  await mkdir(resolve(root, "config"), { recursive: true });

  const producer = await liveProducer();
  producer.history = producer.history.filter((record) => record.record_type !== "outage");
  await writeFile(resolve(watchRoot, "snapshot.json"), JSON.stringify(producer));
  await writeFile(
    resolve(root, "config", "oscillator-alpha-watch-registry-v1.json"),
    await readFile(
      resolve(liveFixtureRoot, "config", "oscillator-alpha-watch-registry-v1.json"), "utf8",
    ),
  );
  // Two signal partitions, plus a newer outage partition that sorts LAST by name.
  for (const month of ["06", "07"]) {
    await writeFile(resolve(ledgerRoot, `signals-2026-${month}.jsonl`), "");
  }
  await writeFile(resolve(ledgerRoot, "outages-2026-08.jsonl"), `${JSON.stringify({
    ledger_id: "oscillator-alpha-watch-ledger-v1",
    record_id: "outage-only-in-its-own-partition",
    record_type: "outage",
    watch_id: producer.cells[0].watch_id,
    emitted_at_utc: "2026-08-01T00:00:00+00:00",
    reason: "not_reporting",
    detail: "the cell produced no evaluation on this run",
    honesty: { ...LEDGER_HONESTY },
  })}\n`);

  const block = await collectOscillatorWatch(root);
  assert.equal(block.available, true, `the fixture did not project: ${block.reason ?? ""}`);
  const outages = block.history.filter((record) => record.recordType === "outage");
  assert.deepEqual(
    outages.map((record) => record.recordId),
    ["outage-only-in-its-own-partition"],
    "the outage partition was dropped by partition selection",
  );
});

// ── D6. A watch that stops reporting says so ─────────────────────────────────

test("an unavailable tracker renders a stated reason instead of vanishing", async () => {
  const page = await readFile(resolve(uiRoot, "app", "page.tsx"), "utf8");
  // The section and its anchor are unconditional; only their contents change.
  assert.match(page, /<a href="#oscillator-watch">Oscillator watch<\/a>/);
  assert.doesNotMatch(page, /\{oscillatorWatch && <a href="#oscillator-watch">/);
  // N3: the panel receives OUR prose and a quoted fragment, never the payload's
  // own `reason` string.
  assert.match(
    page,
    /OscillatorWatchUnavailable prose=\{oscillatorWatch\.prose\} detail=\{oscillatorWatch\.detail\}/,
  );
  assert.match(page, /oscillator-unavailable-reason/);

  // And the refusal the projection stated is the refusal the panel describes.
  const missing = await collectOscillatorWatch(await mkdtemp(resolve(tmpdir(), "osc-empty-")));
  assert.equal(missing.available, false);
  assert.match(missing.reason, /has not written a snapshot/);
  assert.equal(missing.reasonCode, "tracker_not_written");
  assert.match(describeOscillatorUnavailable(missing).prose, /has not written a snapshot/);
});

// ═════════════════════════════════════════════════════════════════════════════
// D2. The ingest server.
//
// The tracker reaches the live feed two ways: bundled at build time, and
// republished at runtime. The runtime path used to preserve `crypto` and nothing
// else — so a stock publish silently erased the tracker — and validated the
// tracker not at all, so a block claiming capital authority was written to disk
// and only declined later, by the client, at render time.
// ═════════════════════════════════════════════════════════════════════════════

/** A snapshot the stock ingest route will accept. */
async function acceptedSnapshot() {
  const snapshot = await readJson(protectedSnapshotPath);
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

async function ingestHarness(seeded) {
  const directory = await mkdtemp(resolve(tmpdir(), "osc-ingest-"));
  const fallbackPath = resolve(directory, "fallback.json");
  const snapshotPath = resolve(directory, "state", "arbitra-snapshot.json");
  await writeFile(fallbackPath, `${JSON.stringify(seeded)}\n`, "utf8");
  return {
    directory,
    snapshotPath,
    handler: createRuntimeSnapshotHandler({
      snapshotPath,
      fallbackPath,
      ingestToken: "test-ingest-token",
      cryptoIngestToken: "test-crypto-ingest-token",
    }),
  };
}

function publishStock(harness, snapshot) {
  return harness.handler(new Request(`http://ui${INGEST_SNAPSHOT_PATH}`, {
    method: "POST",
    body: JSON.stringify(snapshot),
    headers: { authorization: "Bearer test-ingest-token", "content-type": "application/json" },
  }));
}

test("a stock publish preserves the tracker the way it preserves crypto", async () => {
  const watch = await live();
  const seeded = { ...(await acceptedSnapshot()), oscillatorWatch: watch };
  const harness = await ingestHarness(seeded);
  try {
    // A Yahoo-worker-shaped publish: it has never heard of the tracker.
    const worker = await acceptedSnapshot();
    delete worker.oscillatorWatch;
    const response = await publishStock(harness, worker);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "accepted");

    const persisted = await readJson(harness.snapshotPath);
    assert.ok(persisted.oscillatorWatch, "the stock publish erased the tracker");
    assert.equal(persisted.oscillatorWatch.activeSignals.length, watch.activeSignals.length);
    assert.equal(persisted.oscillatorWatch.history.length, watch.history.length);
    // The surface it always preserved is still preserved.
    assert.ok(persisted.crypto);
  } finally {
    await rm(harness.directory, { recursive: true, force: true });
  }
});

test("the server refuses a tracker block claiming any authority", async () => {
  const watch = await live();
  const claims = [
    { deploymentAllowed: true },
    { capitalAuthority: true },
    { orderAuthority: true },
    { trackingOnly: false },
    { notEstablishedAsDistinguishableFromSearchNoise: false },
    { knownLimitations: [] },
  ];
  const base = await acceptedSnapshot();
  for (const claim of claims) {
    const snapshot = { ...base, oscillatorWatch: { ...structuredClone(watch), ...claim } };
    assert.throws(
      () => validateAcceptedSnapshot(snapshot),
      /oscillator watch must remain tracking-only/,
      `the server accepted ${JSON.stringify(claim)}`,
    );
  }
});

test("a dishonest tracker block never reaches disk", async () => {
  const watch = await live();
  const seeded = { ...(await acceptedSnapshot()), oscillatorWatch: watch };
  const harness = await ingestHarness(seeded);
  try {
    const dishonest = await acceptedSnapshot();
    dishonest.oscillatorWatch = {
      ...structuredClone(watch),
      deploymentAllowed: true,
      capitalAuthority: true,
      orderAuthority: true,
      trackingOnly: false,
      knownLimitations: [],
    };
    const response = await publishStock(harness, dishonest);
    assert.equal(response.status, 422);
    const receipt = await response.json();
    assert.equal(receipt.status, "rejected");
    assert.match(receipt.error, /oscillator watch must remain tracking-only/);
    // Nothing was written at all, so the honest block is still what is served.
    assert.equal(existsSync(harness.snapshotPath), false);
  } finally {
    await rm(harness.directory, { recursive: true, force: true });
  }
});

test("the server applies the same per-record gate the client and the sync do", async () => {
  const watch = await live();
  const base = await acceptedSnapshot();
  const labelled = structuredClone(watch);
  labelled.history.find((record) => record.recordType === "signal").uiLabel = "GUARANTEED BUY";
  assert.throws(
    () => validateAcceptedSnapshot({ ...base, oscillatorWatch: labelled }),
    /uiLabel is outside the uiLabel set: "GUARANTEED BUY"/,
  );
  const authoritative = structuredClone(watch);
  authoritative.history[0].orderAuthority = true;
  assert.throws(
    () => validateAcceptedSnapshot({ ...base, oscillatorWatch: authoritative }),
    /claims authority/,
  );
});

test("an absent or honestly unavailable tracker is still accepted", async () => {
  const base = await acceptedSnapshot();
  delete base.oscillatorWatch;
  assert.doesNotThrow(() => validateAcceptedSnapshot(base));
  assert.doesNotThrow(() => validateAcceptedSnapshot({ ...base, oscillatorWatch: null }));
  assert.doesNotThrow(() => validateAcceptedSnapshot({
    ...base,
    oscillatorWatch: {
      available: false,
      reason: "the tracker has not written a snapshot",
      reasonCode: "tracker_not_written",
    },
  }));
  // But the unavailable marker may not smuggle an authority claim either.
  assert.throws(
    () => validateAcceptedSnapshot({
      ...base,
      oscillatorWatch: {
        available: false, reason: "r", reasonCode: "tracker_not_written", capitalAuthority: true,
      },
    }),
    /oscillator watch must remain tracking-only/,
  );
});

// ── D3. The history override names an input, and says so ────────────────────

test("an explicitly named history file that does not exist is refused, not zeroed", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "osc-hist-"));
  const out = await mkdtemp(resolve(tmpdir(), "osc-hist-out-"));
  const before = await sha256(protectedSnapshotPath);
  try {
    const env = {
      ...process.env,
      ARBITRA_REPO: root,
      ARBITRA_SNAPSHOT_OUT: resolve(out, "arbitra-snapshot.json"),
      ARBITRA_HISTORY_IN: resolve(out, "does-not-exist.json"),
      ARBITRA_OSCILLATOR_OUT: resolve(out, "oscillator-alpha-watch.json"),
    };
    await assert.rejects(
      run(process.execPath, [resolve(uiRoot, "scripts", "sync-arbitra.mjs")], { env, cwd: uiRoot }),
      (error) => {
        assert.match(error.stderr, /does not exist/);
        assert.match(error.stderr, /refusing to publish a snapshot with no history/);
        return true;
      },
      "the sync silently produced a snapshot with no history",
    );
    // And it refused before writing anything.
    assert.equal(existsSync(env.ARBITRA_SNAPSHOT_OUT), false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  }
  assert.equal(await sha256(protectedSnapshotPath), before);
});

test("the old ARBITRA_HISTORY_OUT name still works and says it is deprecated", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "osc-hist-old-"));
  const out = await mkdtemp(resolve(tmpdir(), "osc-hist-old-out-"));
  try {
    const historyIn = resolve(out, "arbitra-daily-history.json");
    await writeFile(historyIn, await readFile(protectedHistoryPath, "utf8"), "utf8");
    const env = {
      ...process.env,
      ARBITRA_REPO: root,
      ARBITRA_SNAPSHOT_OUT: resolve(out, "arbitra-snapshot.json"),
      ARBITRA_HISTORY_OUT: historyIn,
      ARBITRA_OSCILLATOR_OUT: resolve(out, "oscillator-alpha-watch.json"),
    };
    const { stdout, stderr } = await run(
      process.execPath, [resolve(uiRoot, "scripts", "sync-arbitra.mjs")], { env, cwd: uiRoot },
    );
    assert.match(stderr, /ARBITRA_HISTORY_OUT is deprecated and names an input/);
    // The point of the rename: the history is actually read, not truncated away.
    const written = await readJson(env.ARBITRA_SNAPSHOT_OUT);
    assert.ok(Object.keys(written.profiles).length > 0, "the history was not read");
    assert.doesNotMatch(stdout, /Synced 0 completed dates/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// INVARIANT A. No unconstrained producer string reaches the DOM.
//
// Everything below tests the SHAPE. Not one assertion names a forbidden phrase:
// the adversary's own note was that with `reason: "cleared_for_capital_deployment"`
// and matching prose, every phrase-dependent guard stayed quiet and the suite
// passed 53 of 54. A test that looks for "capital authority" only catches the
// attacker who says "capital authority".
// ═════════════════════════════════════════════════════════════════════════════

const tiedFixtureRoot = resolve(uiRoot, "tests", "fixtures", "oscillator-watch-tied");

/** The manifest paths whose value must be a wrapped producer value. */
const WRAPPED_PATHS = Object.entries(OSCILLATOR_STRING_MANIFEST)
  .filter(([, kind]) => kind.startsWith("coded:") || kind === "fragment" || kind === "caveat")
  .map(([path]) => path);

/** Every place in a block where `path` resolves, as [container, key] pairs. */
function resolvePath(block, path) {
  let holders = [block];
  const segments = path.split(".");
  for (let index = 0; index < segments.length; index += 1) {
    const raw = segments[index];
    const isArray = raw.endsWith("[]");
    const key = isArray ? raw.slice(0, -2) : raw;
    const last = index === segments.length - 1;
    const next = [];
    for (const holder of holders) {
      if (holder == null || typeof holder !== "object") continue;
      if (last && !isArray) { next.push([holder, key]); continue; }
      const value = holder[key];
      if (value == null) continue;
      if (isArray) {
        if (!Array.isArray(value)) continue;
        if (last) { for (let i = 0; i < value.length; i += 1) next.push([value, i]); continue; }
        next.push(...value);
      } else {
        next.push(value);
      }
    }
    holders = next;
  }
  return holders.filter(([holder, key]) => holder != null && holder[key] != null);
}

test("every producer value in a projected block is classified, or the block is refused", async () => {
  for (const [name, block] of [
    ["the bundled projection", await bundled()],
    ["the live fixture", await live()],
    ["the tied fixture", await collectOscillatorWatch(tiedFixtureRoot)],
  ]) {
    assert.equal(block.available, true, `${name} did not project`);
    assert.equal(
      oscillatorProducerTextViolation(block),
      null,
      `${name} carries producer text the manifest does not place`,
    );
  }
});

test("a producer field nobody classified fails closed at all three gates", async () => {
  // This is the whole point of the round. The next field added to the projection
  // — whatever it is called — cannot reach a component, because the gate walks
  // what is THERE rather than checking a list of what was there last time.
  for (const [where, mutate] of [
    ["a new field on a ledger record", (b) => { b.history[0].escalationNotice = "anything at all"; }],
    ["a new field on a cell", (b) => { b.cells[0].operatorInstruction = "anything at all"; }],
    ["a new field at the top level", (b) => { b.deskMemo = "anything at all"; }],
    ["a new field inside an existing object", (b) => { b.registry.addendum = "anything at all"; }],
    ["a new string in an existing array", (b) => { b.knownLimitations.push("a bare string"); }],
  ]) {
    const block = structuredClone(await live());
    mutate(block);
    const violation = oscillatorWatchHonestyViolation(block);
    assert.ok(violation, `${where} was accepted by the shared gate`);
    assert.match(violation, /nothing classifies|bare producer string/);
    assert.throws(
      () => validateOscillatorWatch(block),
      /must remain tracking-only/,
      `${where} reached disk through the ingest server`,
    );
  }
});

test("a bare string where a wrapped producer value belongs is refused, at every such path", async () => {
  // Exhaustive over the manifest rather than over today's three field names.
  // The N6 payload is one instance of this shape; so is the next one.
  const base = await live();
  let checked = 0;
  for (const path of WRAPPED_PATHS) {
    const block = structuredClone(base);
    const sites = resolvePath(block, path);
    if (sites.length === 0) continue;
    const [holder, key] = sites[0];
    holder[key] = "an unremarkable sentence that trips no word list";
    checked += 1;
    const violation = oscillatorWatchHonestyViolation(block);
    assert.ok(violation, `${path} accepted a bare producer string`);
    assert.match(violation, /bare string where a coded value belongs|bare producer string/);
    assert.throws(() => validateOscillatorWatch(block), /must remain tracking-only/,
      `${path} reached disk as a bare string`);
  }
  assert.ok(checked >= 8, `only ${checked} wrapped paths were populated in the fixture`);
});

test("an unrecognised producer code is quoted, never spoken in this interface's voice", () => {
  // Over EVERY vocabulary, with a code chosen to be unremarkable. `prose` is
  // always ours; the producer's string can only come back as `quoted`.
  const probe = "settlement_window_opened";
  for (const vocabulary of Object.keys(VOCABULARIES)) {
    const demoted = describeCoded({ quoted: probe }, vocabulary, "absent");
    assert.notEqual(demoted.prose, probe, `${vocabulary} echoed the producer's code as prose`);
    assert.equal(demoted.quoted, probe, `${vocabulary} dropped the value instead of quoting it`);
    assert.ok(demoted.prose.length > 0);

    // A recognised code yields OUR words for it, and never the code itself.
    const [code] = Object.keys(VOCABULARIES[vocabulary]);
    const known = describeCoded({ code }, vocabulary, "absent");
    assert.equal(known.prose, VOCABULARIES[vocabulary][code]);
    assert.equal(known.quoted, null);

    // And a code the gate would refuse still does not echo if it gets this far.
    const unknown = describeCoded({ code: probe }, vocabulary, "absent");
    assert.notEqual(unknown.prose, probe);
    assert.equal(unknown.quoted, probe);
  }
});

test("a producer fragment is flattened and capped wherever it is carried", async () => {
  const block = await live();
  for (const path of WRAPPED_PATHS) {
    const kind = OSCILLATOR_STRING_MANIFEST[path];
    const max = kind === "caveat" ? PRODUCER_CAVEAT_MAX : PRODUCER_FRAGMENT_MAX;
    for (const [holder, key] of resolvePath(block, path)) {
      const value = holder[key];
      if (!isProducerValue(value)) {
        assert.fail(`${path} carries ${JSON.stringify(value).slice(0, 60)}, not a producer value`);
      }
      if (isProducerCode(value)) continue;
      assert.ok(value.quoted.length <= max, `${path} quoted ${value.quoted.length} characters`);
      assert.doesNotMatch(value.quoted, /[\r\n\t]/, `${path} kept a line break`);
    }
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// INVARIANT A, the printed-identifier half.
//
// `token` was documented as "an identifier, matched against a pattern with no
// whitespace, so it cannot become a sentence". The premise was false twice:
// `-`, `_`, `.`, `:`, `/` and `+` all read as spaces at ninety-six characters a
// token, and frozenLegSummary supplied a literal space itself, between two
// producer-controlled values, over an uncapped array.
//
// Twenty-one printed paths were classified `token`. The verdict now survives
// only as `opaque`, which means NEVER PRINTED, and every printed path is a
// closed set or a quotation. Nothing below names a forbidden phrase: the checks
// are on the shape of the sets and on the demotion, not on what an attacker
// might say.
// ═════════════════════════════════════════════════════════════════════════════

/** Every manifest path with the named class prefix. */
const manifestPaths = (predicate) =>
  Object.entries(OSCILLATOR_STRING_MANIFEST).filter(([, kind]) => predicate(kind));

test("the token verdict is gone, and every closed set the manifest names is real", () => {
  assert.deepEqual(
    manifestPaths((kind) => kind === "token").map(([path]) => path),
    [],
    "a manifest path is still classified `token`. A value that is never printed is " +
    "`opaque`; a value that IS printed is id:<set> or a fragment.",
  );
  // And the verdict is refused rather than silently unknown, so an entry left
  // behind by a merge fails loudly.
  assert.match(
    classifyOscillatorValue("cells[].asset", "anything", null) ?? "",
    /not a member of the asset set/,
  );

  for (const [path, kind] of manifestPaths((kind) => kind.startsWith("id:"))) {
    const set = kind.slice("id:".length);
    assert.ok(Object.hasOwn(IDENTIFIER_SETS, set), `${path} names the unknown set ${set}`);
  }
  for (const [path, kind] of manifestPaths((kind) => kind.startsWith("member:"))) {
    const set = kind.slice("member:".length);
    assert.ok(Object.hasOwn(IDENTIFIER_SETS, set), `${path} declares the unknown set ${set}`);
    assert.ok(IDENTIFIER_SETS[set].bounded, `${path} declares members for an unbounded set`);
  }
  // Every bounded set is declared in the block, so membership is checkable at
  // the server and the client, which never see the registry document.
  for (const [name, set] of Object.entries(IDENTIFIER_SETS)) {
    if (!set.bounded) continue;
    assert.equal(
      OSCILLATOR_STRING_MANIFEST[`vocabulary.${name}[]`],
      `member:${name}`,
      `the ${name} set is bounded but the block declares no vocabulary for it`,
    );
  }
});

test("no closed set can hold a phrase, whatever the phrase is", () => {
  // The property, not a word list. A separator that reads as a space is what
  // turned a 96-character token into a sentence, so no set admits one - except
  // `-` in registryId, where the tracker's own document id uses it and the
  // length is held to forty.
  const separators = [" ", "\t", "\n", ":", "/", "+", ",", ";", "!", "?", "'", '"'];
  for (const [name, set] of Object.entries(IDENTIFIER_SETS)) {
    for (const separator of [...separators, ...(name === "registryId" ? [] : ["-"])]) {
      assert.equal(
        set.pattern.test(`abc${separator}def`),
        false,
        `the ${name} set admits ${JSON.stringify(separator)}, which reads as a space`,
      );
    }
    // And no set admits a value long enough to be a sentence in the first
    // place. 64 is the ceiling: a run id is a 64-character hex digest, which is
    // long and carries nothing, and nothing here is longer than that.
    const hyphenated = (width) => {
      let out = "";
      while (out.length < width) out += "ab-";
      out = out.slice(0, width);
      return out.endsWith("-") ? `${out.slice(0, -1)}c` : out;
    };
    for (const width of [65, 96, 240]) {
      assert.equal(
        set.pattern.test("a".repeat(width)),
        false,
        `the ${name} set admits a ${width}-character value`,
      );
      assert.equal(
        set.pattern.test("A".repeat(width)),
        false,
        `the ${name} set admits a ${width}-character value`,
      );
      assert.equal(
        set.pattern.test("1".repeat(width)),
        false,
        `the ${name} set admits a ${width}-character value`,
      );
      assert.equal(
        set.pattern.test(hyphenated(width)),
        false,
        `the ${name} set admits a ${width}-character hyphenated value`,
      );
    }
  }
  // The old verdict did admit all of that, which is the whole point.
  assert.ok(TOKEN_PATTERN.test("CAPITAL-AUTHORITY-GRANTED"));
  assert.ok(TOKEN_PATTERN.test("a".repeat(90)));
});

test("an identifier outside its closed set is demoted to a quotation, never printed bare", () => {
  const vocabulary = { source: "registry", asset: ["BTCUSDT"], timeframe: ["30m"] };
  // A member survives as itself, so joins and React keys keep working.
  assert.equal(producerIdentifier("BTCUSDT", "asset", vocabulary), "BTCUSDT");
  // Everything else comes back wrapped, whatever it says.
  for (const probe of [
    "AN-UNREMARKABLE-STRING-THAT-TRIPS-NO-WORD-LIST",
    "settlement window opened",
    "x".repeat(400),
    "BTCUSDT\nBTCUSDT",
  ]) {
    const demoted = producerIdentifier(probe, "asset", vocabulary);
    assert.ok(isProducerQuote(demoted), `${JSON.stringify(probe.slice(0, 30))} was not demoted`);
    assert.ok(demoted.quoted.length <= PRODUCER_FRAGMENT_MAX);
    assert.doesNotMatch(demoted.quoted, /[\r\n\t]/);
  }
  // A shaped value that is not declared is still not a member: the registry
  // decides what exists, not the value's spelling.
  assert.ok(isProducerQuote(producerIdentifier("ETHUSDT", "asset", vocabulary)));
  // And an unbounded set is bounded by its shape alone.
  assert.equal(producerIdentifier("3.12.13", "version", vocabulary), "3.12.13");
  assert.ok(isProducerQuote(producerIdentifier("3.11/orders-from-this-page", "version", vocabulary)));
});

test("a bare identifier the interface cannot place is refused at all three gates", async () => {
  // Exhaustive over the manifest's printed paths rather than over today's field
  // names, in the same shape as the wrapped-path sweep above.
  const base = await live();
  let checked = 0;
  for (const [path] of manifestPaths((kind) => kind.startsWith("id:"))) {
    const block = structuredClone(base);
    const sites = resolvePath(block, path);
    if (sites.length === 0) continue;
    const [holder, key] = sites[0];
    holder[key] = "an-identifier-this-interface-has-never-seen";
    checked += 1;
    const violation = oscillatorWatchHonestyViolation(block);
    assert.ok(violation, `${path} accepted an identifier outside its closed set`);
    assert.match(violation, /is not a member of the .* set|must be demoted/);
    assert.throws(() => validateOscillatorWatch(block), /must remain tracking-only/,
      `${path} reached disk as an unplaced identifier`);
  }
  assert.ok(checked >= 10, `only ${checked} printed identifier paths were populated in the fixture`);
});

test("the block's own declared vocabulary is the thing checked hardest", async () => {
  const base = await live();
  for (const [where, mutate, expected] of [
    ["no vocabulary at all", (b) => { delete b.vocabulary; }, /declares no identifier vocabulary/],
    ["a vocabulary that is not an object", (b) => { b.vocabulary = "registry"; }, /declares no identifier vocabulary/],
    ["a source outside the set", (b) => { b.vocabulary.source = "the desk"; }, /vocabulary.source is outside/],
    ["a bounded set left undeclared", (b) => { delete b.vocabulary.asset; }, /vocabulary.asset is not declared/],
    ["a member outside its shape", (b) => { b.vocabulary.asset.push("SELL-AT-MARKET"); }, /which is not a asset/],
    ["a member that is not a string", (b) => { b.vocabulary.timeframe.push(30); }, /which is not a timeframe/],
    ["a set larger than a roster", (b) => {
      b.vocabulary.oscillator = Array.from({ length: 300 }, (_, i) => `ta_probe_${i}`);
    }, /more than 256/],
    ["a set nothing names", (b) => { b.vocabulary.desk = ["approved"]; }, /names no bounded closed set/],
    ["members for a shape-bounded set", (b) => { b.vocabulary.runId = ["deadbeef"]; }, /names no bounded closed set/],
  ]) {
    const block = structuredClone(base);
    mutate(block);
    const violation = oscillatorWatchHonestyViolation(block);
    assert.ok(violation, `${where} was accepted by the shared gate`);
    assert.match(violation, expected, where);
    assert.throws(() => validateOscillatorWatch(block), /must remain tracking-only/, where);
  }
});

test("the projection derives its closed sets from the frozen registry", async () => {
  const withRegistry = await live();
  assert.equal(withRegistry.vocabulary.source, "registry");
  const registry = await readJson(
    resolve(liveFixtureRoot, "config", "oscillator-alpha-watch-registry-v1.json"),
  );
  // Every declared member came from the registry document, not from the block.
  const registryAssets = new Set(registry.cells.map((cell) => cell.asset));
  for (const asset of withRegistry.vocabulary.asset) {
    assert.ok(registryAssets.has(asset), `${asset} is declared but is not in the registry`);
  }
  assert.deepEqual(withRegistry.vocabulary.registryId, [registry.registry_id]);
  // A producer snapshot naming a DIFFERENT registry than the document on disk is
  // not believed and not refused - it is quoted.
  const producer = await liveProducer();
  producer.registry = { ...producer.registry, registry_id: "some-other-registry-v9" };
  const renamed = projectOscillatorWatch({ producer, registry });
  assert.equal(renamed.available, true, renamed.reason ?? "");
  assert.ok(isProducerQuote(renamed.registry.registryId));

  // With no registry document the sets come from the roster, and the block says
  // so rather than implying the frozen registry vouched for them.
  const rosterOnly = projectOscillatorWatch({ producer: await liveProducer() });
  assert.equal(rosterOnly.available, true, rosterOnly.reason ?? "");
  assert.equal(rosterOnly.vocabulary.source, "roster");
  assert.ok(rosterOnly.vocabulary.asset.length > 0);
});

test("the view supplies no whitespace between two producer values", async () => {
  // frozenLegSummary built `${entry.name} ${entry.value}` over an uncapped array
  // and joined the results with " · ". That is the view writing a sentence out of
  // producer tokens, and no constraint on the tokens themselves could have
  // stopped it. There is no such string built anywhere now.
  const page = await readFile(resolve(uiRoot, "app", "page.tsx"), "utf8");
  assert.doesNotMatch(page, /frozenLegSummary/, "frozenLegSummary is back");
  const from = page.indexOf("function FrozenLegParameters(");
  assert.ok(from >= 0, "FrozenLegParameters is gone");
  const body = page.slice(from, page.indexOf("\nfunction ", from + 1));
  assert.doesNotMatch(body, /\.join\(|`\$\{/, "the frozen legs are being joined into a string again");
  assert.match(body, /<ProducerIdentifier value=\{entry\.name\}/);
});

test("no oscillator component reads a producer value out of its wrapper", async () => {
  // The type system stops `{record.detail}` — an object is not a ReactNode. It
  // does NOT stop `{record.detail?.quoted}`, which is a string and would render
  // raw and unattributed. So the wrapper is opened in exactly two places, and
  // used as a React key in the rest.
  const page = await readFile(resolve(uiRoot, "app", "page.tsx"), "utf8");
  const bodyOf = (name) => {
    const at = page.indexOf(`function ${name}(`);
    assert.ok(at >= 0, `${name} is gone`);
    const next = page.indexOf("\nfunction ", at + 1);
    return page.slice(at, next < 0 ? page.length : next);
  };
  const renderers = ["ProducerQuoted", "ProducerIdentifier", "CodedPhrase"].map(bodyOf).join("\n");
  for (const line of page.split("\n")) {
    if (!/\.quoted\b|\.code\b/.test(line)) continue;
    if (renderers.includes(line)) continue;
    assert.match(
      line,
      /key=\{[^}]*\.quoted\}|\.quoted != null|\.quoted\b(?=[^<]*\/>)|value=\{[^}]*\}/,
      "a producer value is unwrapped outside ProducerQuoted/CodedPhrase: " + line.trim(),
    );
  }
});

test("the oscillator surface contains no echoing transform", async () => {
  const page = await readFile(resolve(uiRoot, "app", "page.tsx"), "utf8");
  // Scoped to the oscillator functions themselves rather than to a slice of the
  // file: reasonLabel and the stock lane share this module and are allowed to
  // keep their own label map.
  const names = [...page.matchAll(/^function ((?:Oscillator|oscillator|Producer|Coded)\w*|describeLedgerOrder|frozenLegSummary)\b/gm)];
  assert.ok(names.length >= 10, `expected the oscillator functions, found ${names.length}`);
  const region = names
    .map((match) => {
      const next = page.indexOf("\nfunction ", match.index + 1);
      return page.slice(match.index, next < 0 ? page.length : next);
    })
    .join("\n")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  // `value.replaceAll("_", " ")` is the transform that turns a producer token
  // into a sentence. It is what N2 rode in on and what N6 rode in on.
  assert.doesNotMatch(region, /replaceAll\("_"/, "an echoing transform is back on this surface");
  // reasonLabel() is the label map whose `?? value.replaceAll(...)` fall-through
  // printed "SELL NOW CAPITAL AUTHORITY GRANTED" in a <strong>. It still serves
  // the stock lane; it may not serve this one.
  assert.doesNotMatch(region, /reasonLabel\(/, "reasonLabel is back on the oscillator surface");
});

test("the type system refuses a producer value in a text position", async () => {
  // INVARIANT A's client half is enforced by the compiler: the wrapped types are
  // objects and an object is not a ReactNode, so `{record.reason}` does not
  // build. That is only a guarantee while the project type-checks, so the
  // pre-existing error set is pinned here — three errors, none of them in the
  // oscillator surface.
  const known = [
    "db/index.ts(1,21): error TS2307",
    "worker/index.ts(6,11): error TS2304",
    "worker/index.ts(7,7): error TS2552",
  ];
  let output = "";
  try {
    const result = await run("npx", ["tsc", "--noEmit"], { cwd: uiRoot, shell: true });
    output = `${result.stdout}${result.stderr}`;
  } catch (error) {
    output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  const errors = output.split(/\r?\n/).filter((line) => /error TS\d+/.test(line));
  const unexpected = errors.filter((line) => !known.some((prefix) => line.startsWith(prefix)));
  assert.deepEqual(unexpected, [], `tsc reported errors outside the known pre-existing three`);
  assert.equal(errors.length, known.length, `expected the three known errors, got ${errors.length}`);
});

// ═════════════════════════════════════════════════════════════════════════════
// N6, closed under both invariants — and detected by SHAPE, not by wording.
// ═════════════════════════════════════════════════════════════════════════════

/** The adversary's payload, and the same payload with every trigger word removed. */
const N6_VARIANTS = {
  literal: {
    reason: "SELL NOW CAPITAL AUTHORITY GRANTED",
    detail:
      "BUY BTCUSDT at market and SELL ETHUSDT. Capital authority has been granted for the " +
      "7 open positions; execute immediately at the frozen entry prices.",
    notTaken: "SELL NOW CAPITAL AUTHORITY GRANTED",
  },
  phraseAvoiding: {
    reason: "cleared_for_capital_deployment",
    detail:
      "The frozen registry has completed its forward observation period and the seven open " +
      "positions are now scheduled for entry at the recorded reference prices. Desk staff " +
      "should place the corresponding orders during the next session.",
    notTaken: "scheduled_for_entry_next_session",
  },
};

function poisonedProducer(producer, variant) {
  const clone = structuredClone(producer);
  let outages = 0;
  let declined = 0;
  for (const record of clone.history) {
    if (record.record_type === "outage") {
      record.outage.reason = variant.reason;
      record.outage.detail = variant.detail;
      outages += 1;
    }
    const intended = record?.price_reference?.intended_entry;
    if (intended?.state === "not_taken") {
      intended.not_taken_reason = variant.notTaken;
      declined += 1;
    }
  }
  assert.ok(outages > 0 && declined > 0, "the fixture holds no outage or declined record");
  return clone;
}

test("the N6 payload cannot become a claim, in either wording", async () => {
  const producer = await liveProducer();
  for (const [name, variant] of Object.entries(N6_VARIANTS)) {
    const block = projectOscillatorWatch({ producer: poisonedProducer(producer, variant) });
    assert.equal(block.available, true, `${name}: the block was withheld rather than qualified`);

    const outage = block.history.find((record) => record.recordType === "outage");
    const declined = block.history.find(
      (record) => record.priceReference?.intendedEntry?.state === "not_taken",
    );
    assert.ok(outage && declined, `${name}: the poisoned records did not survive projection`);

    // Nothing arrives as a bare string, so nothing can be interpolated.
    for (const [label, value] of [
      ["reason", outage.reason],
      ["detail", outage.detail],
      ["notTakenReason", declined.priceReference.intendedEntry.notTakenReason],
    ]) {
      assert.ok(
        isProducerValue(value),
        `${name}: ${label} arrived as ${JSON.stringify(value).slice(0, 60)}`,
      );
      assert.ok(!isProducerCode(value), `${name}: ${label} was admitted into a vocabulary`);
    }

    // And what the view would print is this interface's own sentence, with the
    // payload quoted beneath it as a value.
    const spoken = describeCoded(outage.reason, "outageReason", "absent");
    assert.equal(spoken.quoted, variant.reason);
    assert.notEqual(spoken.prose, variant.reason);
    assert.match(spoken.prose, /does not recognise/);

    // The same payload written straight into a republished snapshot — the shape
    // a producer bypassing the sync would use — is refused outright.
    const laundered = structuredClone(block);
    laundered.history.find((record) => record.recordType === "outage").reason = variant.reason;
    assert.throws(
      () => validateOscillatorWatch(laundered),
      /must remain tracking-only/,
      `${name}: a bare reason string reached disk`,
    );
  }
});

test("the outage and declined kinds are card kinds, not fall-through branches", async () => {
  // N6 succeeded because OscillatorRecordCard had five branches and only two of
  // them said anything about authority; the other three were reached only by
  // records that carry no BUY or SELL, so N1's per-type test never inspected
  // them. Every branch is now a registered kind with its own counter-claim.
  const page = await readFile(resolve(uiRoot, "app", "page.tsx"), "utf8");
  const at = page.indexOf("const OSCILLATOR_RECORD_CARD_KIND");
  assert.ok(at >= 0, "the record-kind map is gone");
  const map = page.slice(at, page.indexOf("};", at));
  for (const lane of ["outage", "declined", "pending", "exit", "filled"]) {
    assert.match(
      map,
      new RegExp(`\\b${lane}: "ledger-`),
      `ledger lane ${lane} names no registered card kind`,
    );
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// N4 residual. The cap kept the first forty by insertion order.
// ═════════════════════════════════════════════════════════════════════════════

test("the history comparator is total and never lets a tie evict an outage", () => {
  const record = (type, id, at = "2026-08-01T00:05:00+00:00") =>
    ({ recordType: type, recordId: id, emittedAtUtc: at });
  // A tie on the instant is broken by kind, and an outage outranks every kind.
  assert.ok(compareHistoryRecords(record("outage", "z"), record("signal", "a")) < 0);
  assert.ok(compareHistoryRecords(record("outage", "z"), record("exit", "a")) < 0);
  assert.ok(compareHistoryRecords(record("outage", "z"), record("fill", "a")) < 0);
  // The other three do not outrank each other — the page would fill all forty
  // slots from one kind, and nothing establishes that an exit matters more.
  assert.equal(compareHistoryRecords(record("signal", "a"), record("exit", "a")), 0);
  // Then by record id, so the order is total and independent of read order.
  assert.ok(compareHistoryRecords(record("fill", "a"), record("fill", "b")) < 0);
  // A genuinely newer record still wins over an outage.
  assert.ok(compareHistoryRecords(
    record("signal", "a", "2026-08-02T00:00:00+00:00"),
    record("outage", "z"),
  ) < 0);
  // Sorting the same set in two different input orders gives one result.
  const set = [
    record("signal", "c"), record("outage", "b"), record("fill", "a"), record("exit", "d"),
  ];
  const forward = set.slice().sort(compareHistoryRecords).map((r) => r.recordId);
  const backward = set.slice().reverse().sort(compareHistoryRecords).map((r) => r.recordId);
  assert.deepEqual(forward, backward);
  assert.equal(forward[0], "b", "the outage did not sort first on a total tie");
});

test("an outage behind forty tied records is not evicted by insertion order", async () => {
  // The committed live fixture cannot express this: 36 records, under the cap,
  // two distinct timestamps. tests/fixtures/oscillator-watch-tied is 46 records
  // at ONE instant with the outage present only in its own partition, sitting at
  // merge index 45 — the production shape, in miniature.
  const block = await collectOscillatorWatch(tiedFixtureRoot);
  assert.equal(block.available, true, `the tied fixture did not project: ${block.reason ?? ""}`);
  assert.equal(block.historyDistinctEmittedAt, 1, "the tied fixture no longer ties");
  assert.equal(block.historyRecordsObserved, 46);
  assert.equal(block.history.length, OSCILLATOR_WATCH_HISTORY_CAP);
  assert.equal(block.historyOrder, OSCILLATOR_HISTORY_ORDER);

  // The whole finding, in one assertion.
  assert.deepEqual(
    block.history.filter((record) => record.recordType === "outage").map((r) => r.recordId),
    ["outage-behind-forty-records"],
    "the outage was dropped by the cap; sorting on emitted_at alone is a no-op here",
  );
  assert.equal(block.historyKindsShown.outage, 1);
  assert.equal(block.historyKindsObserved.outage, 1);

  // And the block reports what the cap dropped, per kind, so the page can say so.
  const droppedKinds = Object.entries(block.historyKindsObserved)
    .filter(([kind, observed]) => observed > block.historyKindsShown[kind]);
  assert.ok(droppedKinds.length > 0, "the cap dropped records but the block reports none");
});

test("the ledger heading states the ordering it has, not the one it wishes for", async () => {
  const page = await readFile(resolve(uiRoot, "app", "page.tsx"), "utf8");
  // The eyebrow is computed, never a constant.
  assert.doesNotMatch(page, /Append-only ledger · newest first/);
  assert.match(page, /Append-only ledger · \{ledgerOrder\.eyebrow\}/);
  assert.match(page, /historyDistinctEmittedAt > 1/);

  if (STALE_BUILD) return;
  const html = await (await render()).text();
  const projection = JSON.parse(readFileSync(bundledPath, "utf8"));
  // React puts a comment separator between literal text and an expression, so
  // the eyebrow reads "Append-only ledger · <!-- -->newest first" in the markup.
  const eyebrow = /Append-only ledger · (?:<!-- -->)?([^<]*)/.exec(html);
  assert.ok(eyebrow, "the ledger eyebrow did not render");
  if (projection.historyDistinctEmittedAt > 1) {
    assert.equal(eyebrow[1], "newest first");
    assert.match(html, /Ordered newest first across \d+ distinct emitted-at stamps/);
  } else {
    assert.equal(eyebrow[1], "not a chronological order");
    assert.match(html, /carry one emitted-at stamp/);
    assert.match(html, /is not shown as one/);
  }
  // Either way the tie rule is stated where the records are shown.
  assert.match(html, /an outage is ordered ahead of every other kind/);
});

// ═════════════════════════════════════════════════════════════════════════════
// N5 residual. Freshness keyed on identity could not tell two trees apart.
// ═════════════════════════════════════════════════════════════════════════════

test("two projections identical on every run identifier still differ in digest", async () => {
  const live_ = await live();
  const tied = await collectOscillatorWatch(tiedFixtureRoot);
  // The precondition — this is the pair that defeated the old marker set.
  for (const field of ["runId", "generatedAt", "evaluatorVersion"]) {
    assert.equal(live_[field], tied[field], `the fixtures no longer agree on ${field}`);
  }
  assert.equal(live_.cells[0].watchId, tied.cells[0].watchId);
  // ...and they hold different content.
  assert.notEqual(live_.history.length, tied.history.length);
  // The old marker set could not tell them apart; the digest can.
  assert.notEqual(
    live_.projectionSha256,
    tied.projectionSha256,
    "two projections with different content share a freshness marker",
  );
  assert.equal(projectionDigest(live_), live_.projectionSha256);
  assert.equal(projectionDigest(tied), tied.projectionSha256);
});

test("the projection digest is a function of content, not of key order", async () => {
  const block = await live();
  const shuffled = Object.fromEntries(Object.entries(block).reverse());
  assert.equal(projectionDigest(shuffled), projectionDigest(block));
  // And a single changed character anywhere changes it.
  const nudged = structuredClone(block);
  nudged.history[0].recordId = `${nudged.history[0].recordId.slice(0, -1)}0`;
  assert.notEqual(projectionDigest(nudged), projectionDigest(block));
});

test("the bundled projection matches its own digest", async () => {
  const block = await bundled();
  if (block.available === false) return;
  assert.equal(
    block.projectionSha256,
    projectionDigest(block),
    "app/data/oscillator-alpha-watch.json was edited after the sync wrote it",
  );
});
