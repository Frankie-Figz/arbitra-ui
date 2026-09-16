// Projection of the Arbitra oscillator-alpha-watch tracker into the UI snapshot.
//
// Producer: arbitra_oscillator_watch.py
//   data/oscillator-alpha-watch/snapshot.json   (oscillator-alpha-watch-snapshot-v1)
//   data/oscillator-alpha-watch/ledger/*.jsonl  (oscillator-alpha-watch-ledger-v1)
//   data/oscillator-alpha-watch/ledger/context/<sha>.json
//   config/oscillator-alpha-watch-registry-v1.json
//
// The tracked cells are candidates, not established alpha. Every projection path
// here either carries the honesty flags and the per-cell known_limitations
// verbatim, or refuses to surface the block at all. There is no partial state in
// which a BUY reaches the UI without the caveat attached to the same object.
//
// The refusal itself lives in scripts/oscillator-honesty.mjs and is applied to
// the finished block, so the live lane (active_signals, pending_entries) and the
// ledger lane (history) are held to one gate rather than two.

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { CELL_STATUSES, oscillatorWatchHonestyViolation } from "./oscillator-honesty.mjs";
import {
  ENUMS,
  IDENTIFIER_SETS,
  PRODUCER_CAVEAT_MAX,
  producerCoded,
  producerFragment,
  producerIdentifier,
} from "./oscillator-vocabulary.mjs";

export const OSCILLATOR_WATCH_BLOCK_SCHEMA_VERSION = 1;
export const OSCILLATOR_WATCH_HISTORY_CAP = 40;
export const OSCILLATOR_WATCH_RELATIVE_ROOT = "data/oscillator-alpha-watch";
export const OSCILLATOR_WATCH_REGISTRY_RELATIVE_PATH =
  "config/oscillator-alpha-watch-registry-v1.json";

const PRODUCER_DOCUMENT_ID = "oscillator-alpha-watch-snapshot-v1";
const PRODUCER_SCHEMA_VERSION = 1;
const LEDGER_ID = "oscillator-alpha-watch-ledger-v1";

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numeric(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integer(value) {
  return Number.isInteger(value) ? value : null;
}

function strings(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

// INVARIANT A, producer side. Free producer prose leaves this module WRAPPED,
// never as a bare string, so there is no value in the projected block that a
// component could interpolate into a sentence of its own. `caveat` is the same
// wrapper with the larger cap, for the tracker's own stated limitations.
function caveat(value) {
  return producerFragment(value, PRODUCER_CAVEAT_MAX);
}

function caveats(value) {
  return strings(value)
    .map((entry) => producerFragment(entry, PRODUCER_CAVEAT_MAX))
    .filter((entry) => entry != null);
}

// A producer code, carried as a code when this interface has words for it and
// demoted to a quoted fragment when it does not. Never echoed.
function coded(value, vocabulary) {
  return producerCoded(value, vocabulary);
}

// ── INVARIANT A, the printed-identifier half ─────────────────────────────────
//
// Every identifier this surface PRINTS leaves here as a member of a closed set
// or as a quoted fragment, and the sets are derived from the frozen REGISTRY
// rather than written down in the UI. The registry is what decides which assets,
// timeframes, oscillators, exit families, frozen windows and frozen parameters
// exist; a UI-side list of them would be a second definition, and a second
// definition drifts.
//
// A member that does not match its set's shape is DROPPED from the declared
// vocabulary rather than declared, so a registry entry this interface cannot
// place demotes the values that use it to quotations instead of refusing the
// page. What may never happen is the reverse: a declared member outside its
// shape refuses the whole block at every gate, because the declaration is how a
// bare producer string earns the right to be printed.

/**
 * The block's closed sets, derived from the registry document when there is one
 * and from the producer's own roster when there is not.
 *
 * @returns {{ source: string } & Record<string, string[]>}
 */
function buildIdentifierVocabulary(registry, producer) {
  const registryCells =
    isObject(registry) && Array.isArray(registry.cells) ? registry.cells.filter(isObject) : [];
  const producerCells = Array.isArray(producer?.cells) ? producer.cells.filter(isObject) : [];
  const fromRegistry = registryCells.length > 0;
  const cells = fromRegistry ? registryCells : producerCells;

  const sets = new Map();
  for (const [name, set] of Object.entries(IDENTIFIER_SETS)) {
    if (set.bounded) sets.set(name, new Set());
  }
  const add = (name, value) => {
    if (typeof value !== "string") return;
    if (!IDENTIFIER_SETS[name].pattern.test(value)) return;
    sets.get(name).add(value);
  };

  for (const cell of cells) {
    add("asset", cell.asset);
    add("timeframe", cell.timeframe);
    add("oscillator", cell.oscillator);
    add("exitFamily", cell.exit_family);
    const divergence = isObject(cell.divergence) ? cell.divergence : {};
    add("divergenceInput", divergence.computed_on);
    for (const side of [cell.fast, cell.slow]) {
      if (!isObject(side)) continue;
      add("frozenLabel", side.label);
      const parameters = isObject(side.parameters) ? side.parameters : {};
      for (const [name, value] of Object.entries(parameters)) {
        add("frozenParameter", name);
        if (typeof value === "string") add("frozenValue", value);
      }
    }
    if (!fromRegistry) {
      // No registry document beside the tracker: the frozen legs are not
      // carried at all, and the only labels in play are the ones the producer
      // reports for the live oscillator state. Seeding them from the roster is
      // a cross-lane consistency check rather than a check against the frozen
      // registry, which is exactly what `source: "roster"` says on the page.
      const state = isObject(cell.oscillator_state) ? cell.oscillator_state : {};
      add("frozenLabel", state.fast_label);
      add("frozenLabel", state.slow_label);
    }
  }
  // The registry names itself. Where a registry document is present its id is
  // the only member, so a producer snapshot claiming a DIFFERENT registry is
  // not refused and not believed - it is quoted.
  add("registryId", fromRegistry && isObject(registry) ? registry.registry_id : null);
  if (!fromRegistry) {
    add("registryId", isObject(producer?.registry) ? producer.registry.registry_id : null);
  }

  const vocabulary = { source: fromRegistry ? "registry" : "roster" };
  for (const [name, members] of sets) vocabulary[name] = [...members].sort();
  return vocabulary;
}

/**
 * N4 residual. Every record in a backfill is stamped with the RUN's time, so a
 * 321-record ledger can hold exactly one distinct `emitted_at_utc` and a sort on
 * that field alone is a no-op — the cap then kept the first 40 by MERGE
 * INSERTION ORDER, which put the single outage at index 199 and dropped it. An
 * outage is the tracker reporting that it went quiet; it is the last record that
 * may be evicted by an accident of iteration order.
 *
 * Ties are broken by record kind and then by record id, so the order is total
 * and deterministic regardless of which order the partitions were read in.
 *
 * The kind priority is deliberately COARSE: an outage outranks everything, and
 * signals, fills and exits share a rank. Ranking those three against each other
 * would be this interface asserting that an exit matters more than a signal,
 * which nothing establishes — and on a ledger where every record shares one
 * instant it would fill all forty slots from one kind. An outage is different in
 * kind, not in importance: it is the tracker reporting that it went quiet, and a
 * page that drops it says nothing where it should say something.
 */
const RECORD_TYPE_PRIORITY = { outage: 0, signal: 1, fill: 1, exit: 1 };

/** One definition, shared with the gate's closed set and the view's prose. */
export const [OSCILLATOR_HISTORY_ORDER] = ENUMS.historyOrder;

export function compareHistoryRecords(left, right) {
  const byTime = right.emittedAtUtc.localeCompare(left.emittedAtUtc);
  if (byTime !== 0) return byTime;
  const byKind = (RECORD_TYPE_PRIORITY[left.recordType] ?? 9) -
    (RECORD_TYPE_PRIORITY[right.recordType] ?? 9);
  if (byKind !== 0) return byKind;
  return (left.recordId ?? "").localeCompare(right.recordId ?? "");
}

// N3. A refusal carries three things: the diagnostic sentence this module has
// always produced (kept byte-identical, for logs and tests), a CODE from the
// closed set in scripts/oscillator-honesty.mjs, and at most one producer-supplied
// fragment. The UI renders the code's own prose and quotes the fragment; it never
// renders `reason`, because a republished payload can put anything there.
function unavailable(reason, reasonCode = "unspecified", detail = null) {
  return { available: false, reason, reasonCode, detail };
}

function stateBar(value) {
  if (!isObject(value)) return null;
  return {
    openUtc: text(value.open_utc),
    closeUtc: text(value.close_utc),
    close: numeric(value.close),
    completeBucket: typeof value.complete_bucket === "boolean" ? value.complete_bucket : null,
    coverage: numeric(value.coverage),
    trailingMissing: integer(value.trailing_missing),
  };
}

function divergenceLeg(value) {
  if (!isObject(value)) return { armed: false, confirmationBarUtc: null, ageBars: null, expiresAfterBars: null };
  return {
    armed: value.armed === true,
    confirmationBarUtc: text(value.confirmation_bar_utc),
    ageBars: integer(value.age_bars),
    expiresAfterBars: integer(value.expires_after_bars),
  };
}

function evidenceLeg(value) {
  if (!isObject(value)) return null;
  return {
    trades: integer(value.trades),
    netReturn: numeric(value.net_return),
    profitFactor: numeric(value.profit_factor),
    note: caveat(value.note),
  };
}

// The frozen fast/slow windows and the divergence gate live in the registry, not
// in the producer snapshot. Carried per cell so the roster can state what was
// frozen alongside what it is currently doing.
function frozenParameters(registryCell, vocabulary) {
  const id = (value, set) => producerIdentifier(value, set, vocabulary);
  if (!isObject(registryCell)) return null;
  const leg = (side) => {
    if (!isObject(side)) return null;
    const parameters = isObject(side.parameters) ? side.parameters : {};
    return {
      label: id(side.label, "frozenLabel"),
      rank: integer(side.rank),
      parameters: Object.entries(parameters)
        .filter(([, entry]) => typeof entry === "number" || typeof entry === "string")
        .map(([name, entry]) => ({
          name: id(name, "frozenParameter"),
          value: typeof entry === "number" ? entry : id(entry, "frozenValue"),
        }))
        .sort((left, right) => String(left.name?.quoted ?? left.name).localeCompare(
          String(right.name?.quoted ?? right.name))),
    };
  };
  const divergence = isObject(registryCell.divergence) ? registryCell.divergence : {};
  return {
    fast: leg(registryCell.fast),
    slow: leg(registryCell.slow),
    polarity: text(registryCell.polarity),
    primaryOutput: text(registryCell.primary_output),
    divergence: {
      computedOn: id(divergence.computed_on, "divergenceInput"),
      maxEventAgeBars: integer(divergence.lookback_bars_max_event_age),
      pivotLeft: integer(divergence.pivot_left),
      pivotRight: integer(divergence.pivot_right),
      maxDivergenceBars: integer(divergence.max_divergence_bars),
      note: caveat(divergence.note),
    },
    candidatesSearchedInCell: isObject(registryCell.provenance)
      ? integer(registryCell.provenance.candidates_searched_in_cell)
      : null,
  };
}

function projectCell(cell, registryByWatchId, vocabulary) {
  const id = (value, set) => producerIdentifier(value, set, vocabulary);
  const watchId = text(cell.watch_id);
  const deferredBlock = isObject(cell.deferred) ? cell.deferred : {};
  const availability = isObject(cell.availability) ? cell.availability : {};
  const warmup = isObject(cell.warmup) ? cell.warmup : {};
  const oscillatorState = isObject(cell.oscillator_state) ? cell.oscillator_state : null;
  const divergence = isObject(cell.divergence_armed) ? cell.divergence_armed : null;
  const position = isObject(cell.position) ? cell.position : null;
  const pendingEntry = isObject(cell.pending_entry) ? cell.pending_entry : null;
  const lifecycle = isObject(cell.lifecycle) ? cell.lifecycle : null;
  const finalBucket = isObject(cell.final_bucket) ? cell.final_bucket : null;
  const termination = lifecycle && isObject(lifecycle.termination) ? lifecycle.termination : null;
  const decidability =
    lifecycle && isObject(lifecycle.fill_state_decidability) ? lifecycle.fill_state_decidability : null;
  const evidence = isObject(cell.evidence) ? cell.evidence : {};
  const provenance = isObject(cell.provenance_ref) ? cell.provenance_ref : {};

  return {
    watchId,
    asset: id(cell.asset, "asset"),
    oscillator: id(cell.oscillator, "oscillator"),
    indicatorClass: text(cell.indicator_class),
    timeframe: id(cell.timeframe, "timeframe"),
    exitFamily: id(cell.exit_family, "exitFamily"),
    status: text(cell.status),
    cellFingerprint: text(cell.cell_fingerprint),
    evaluatedThisRun: cell.evaluated_this_run === true,
    deferred: {
      isDeferred: deferredBlock.is_deferred === true,
      reason: caveat(deferredBlock.reason),
    },
    availability: {
      status: text(availability.status),
      lastSuccessfulEvaluationUtc: text(availability.last_successful_evaluation_utc),
      consecutiveFailedRuns: integer(availability.consecutive_failed_runs) ?? 0,
      detail: caveat(availability.detail),
    },
    warmup: {
      effectiveBarsRequired: integer(warmup.effective_bars_required),
      registryBarsRequired: integer(warmup.registry_bars_required),
      adapterBarsComputed: integer(warmup.adapter_bars_computed),
      source: text(warmup.source),
      satisfied: warmup.satisfied === true,
    },
    barsAvailable: integer(cell.bars_available),
    stateBar: stateBar(cell.state_bar),
    oscillatorState: oscillatorState
      ? {
          fastLabel: id(oscillatorState.fast_label, "frozenLabel"),
          slowLabel: id(oscillatorState.slow_label, "frozenLabel"),
          fastValue: numeric(oscillatorState.fast_value),
          slowValue: numeric(oscillatorState.slow_value),
          spread: numeric(oscillatorState.spread),
          relation: text(oscillatorState.relation),
          atr: numeric(oscillatorState.atr),
        }
      : null,
    divergenceArmed: divergence
      ? {
          bullish: divergenceLeg(divergence.bullish),
          bearish: divergenceLeg(divergence.bearish),
          parityAssertionPassed: isObject(divergence.parity_assertion)
            ? divergence.parity_assertion.passed === true
            : null,
        }
      : null,
    position: position
      ? {
          direction: text(position.direction),
          signalId: text(position.signal_id),
          signalBarOpenUtc: text(position.signal_bar_open_utc),
          entryBarOpenUtc: text(position.entry_bar_open_utc),
          entryPrice: numeric(position.entry_price),
          barsHeld: integer(position.bars_held),
          evaluatorClass: text(position.evaluator_class),
          atrAtSignal: numeric(position.atr_at_signal),
          stopPrice: numeric(position.stop_price),
          targetPrice: numeric(position.target_price),
          maximumHoldingBars: integer(position.maximum_holding_bars),
          unrealisedGrossReturn: numeric(position.unrealised_gross_return),
        }
      : null,
    pendingEntry: pendingEntry
      ? {
          direction: text(pendingEntry.direction),
          signalId: text(pendingEntry.signal_id),
          signalBarOpenUtc: text(pendingEntry.signal_bar_open_utc),
          earliestPossibleEntryBarOpenUtc: text(pendingEntry.earliest_possible_entry_bar_open_utc),
        }
      : null,
    lifecycle: lifecycle
      ? {
          replayStartPolicy: text(lifecycle.replay_start_policy),
          replayStartPolicyDefault: text(lifecycle.replay_start_policy_default),
          barsReplayed: integer(lifecycle.bars_replayed),
          tradesReturned: integer(lifecycle.trades_returned),
          bankruptTrades: integer(lifecycle.bankrupt_trades),
          terminated: lifecycle.terminated === true,
          termination: termination
            ? {
                reason: coded(termination.reason, "terminationReason"),
                exitBarUtc: text(termination.exit_bar_utc),
                exitPrice: numeric(termination.exit_price),
                exitReason: coded(termination.exit_reason, "exitReason"),
                netReturnAfterFrozenFriction: numeric(termination.net_return_after_frozen_friction),
                tradesBeforeTermination: integer(termination.trades_before_termination),
                unevaluatedBars: integer(termination.unevaluated_bars),
                unevaluatedEntryPulses: integer(termination.unevaluated_entry_pulses),
                detail: caveat(termination.detail),
              }
            : null,
          predictedDeclined: decidability ? integer(decidability.predicted_declined) : null,
          predictedDeclinedButFrozenFilled: decidability
            ? integer(decidability.predicted_declined_but_frozen_filled)
            : null,
        }
      : null,
    finalBucket: finalBucket
      ? {
          bucketOpenUtc: text(finalBucket.bucket_open_utc),
          bucketCloseUtc: text(finalBucket.bucket_close_utc),
          truncated: finalBucket.truncated === true,
          trailingMissing: integer(finalBucket.trailing_missing),
          historicallyComplete: finalBucket.historically_complete === true,
          provisional: finalBucket.provisional === true,
          signalsWithheld: integer(finalBucket.signals_withheld) ?? 0,
          directionsWithheld: strings(finalBucket.directions_withheld),
          bucketOfWeekCompleteRate: numeric(finalBucket.bucket_of_week_complete_rate),
        }
      : null,
    // Verbatim per-cell echo. A component cannot render this cell's status
    // without the caveat, because the caveat is a field of the cell.
    knownLimitations: caveats(cell.known_limitations),
    evidence: {
      holdout: evidenceLeg(evidence.holdout),
      retrospectiveConfirmation: evidenceLeg(evidence.retrospective_confirmation),
      qualityStatus: text(evidence.quality_status),
    },
    frozen: frozenParameters(registryByWatchId.get(watchId), vocabulary),
    provenance: {
      campaignId: text(provenance.campaign_id),
      cellArtifactPath: text(provenance.cell_artifact_path),
    },
  };
}

function projectActiveSignal(signal, vocabulary, oscillatorByWatchId) {
  const id = (value, set) => producerIdentifier(value, set, vocabulary);
  return {
    watchId: text(signal.watch_id),
    asset: id(signal.asset, "asset"),
    oscillator: oscillatorByWatchId.get(text(signal.watch_id)) ?? null,
    timeframe: id(signal.timeframe, "timeframe"),
    exitFamily: id(signal.exit_family, "exitFamily"),
    status: text(signal.status),
    direction: text(signal.direction),
    uiLabel: text(signal.ui_label),
    signalId: text(signal.signal_id),
    signalBarOpenUtc: text(signal.signal_bar_open_utc),
    entryBarOpenUtc: text(signal.entry_bar_open_utc),
    entryPrice: numeric(signal.entry_price),
    barsHeld: integer(signal.bars_held),
    unrealisedGrossReturn: numeric(signal.unrealised_gross_return),
    stateBar: stateBar(signal.state_bar),
    trackingOnly: signal.tracking_only === true,
    orderAuthority: signal.order_authority === true,
  };
}

function projectPendingEntry(entry, vocabulary, oscillatorByWatchId) {
  const id = (value, set) => producerIdentifier(value, set, vocabulary);
  return {
    watchId: text(entry.watch_id),
    asset: id(entry.asset, "asset"),
    oscillator: oscillatorByWatchId.get(text(entry.watch_id)) ?? null,
    timeframe: id(entry.timeframe, "timeframe"),
    exitFamily: id(entry.exit_family, "exitFamily"),
    direction: text(entry.direction),
    uiLabel: text(entry.ui_label),
    signalId: text(entry.signal_id),
    signalBarOpenUtc: text(entry.signal_bar_open_utc),
    entryBarOpenUtc: text(entry.entry_bar_open_utc),
    trackingOnly: entry.tracking_only === true,
    orderAuthority: entry.order_authority === true,
  };
}

function projectRecord(record, vocabulary) {
  const id = (value, set) => producerIdentifier(value, set, vocabulary);
  const honesty = isObject(record.honesty) ? record.honesty : {};
  const base = {
    recordId: text(record.record_id),
    recordType: text(record.record_type),
    signalId: text(record.signal_id),
    watchId: text(record.watch_id),
    asset: id(record.asset, "asset"),
    oscillator: id(record.oscillator, "oscillator"),
    timeframe: id(record.timeframe, "timeframe"),
    exitFamily: id(record.exit_family, "exitFamily"),
    emittedAtUtc: text(record.emitted_at_utc),
    afterEvidenceWindow: honesty.after_evidence_window === true,
    contextSha256: text(honesty.context_sha256),
    // Every ledger record carries its own honesty block. Carried through rather
    // than discarded, so a record revoking its tracking-only status refuses the
    // whole block instead of being surfaced with the revocation dropped.
    trackingOnly: honesty.tracking_only === true,
    orderAuthority: honesty.order_authority === true,
  };

  if (base.recordType === "signal") {
    const signalBar = isObject(record.signal_bar) ? record.signal_bar : {};
    const oscillatorState = isObject(record.oscillator_state) ? record.oscillator_state : {};
    const divergenceEvent = isObject(record.divergence_event) ? record.divergence_event : {};
    const priceReference = isObject(record.price_reference) ? record.price_reference : {};
    const intendedEntry = isObject(priceReference.intended_entry) ? priceReference.intended_entry : {};
    const dataSource = isObject(record.data_source) ? record.data_source : {};
    const aggregation = isObject(dataSource.aggregation) ? dataSource.aggregation : {};
    return {
      ...base,
      direction: text(record.direction),
      uiLabel: text(record.ui_label),
      signalBar: {
        openUtc: text(signalBar.open_utc),
        closeUtc: text(signalBar.close_utc),
        close: numeric(signalBar.close),
        coverage: numeric(signalBar.coverage),
        completeBucket:
          typeof signalBar.complete_bucket === "boolean" ? signalBar.complete_bucket : null,
        trailingMissing: integer(signalBar.trailing_missing),
      },
      oscillatorState: {
        fastValue: numeric(oscillatorState.fast_value),
        slowValue: numeric(oscillatorState.slow_value),
        spread: numeric(oscillatorState.spread),
        atr: numeric(oscillatorState.atr),
      },
      divergenceEvent: {
        kind: text(divergenceEvent.kind),
        confirmationBarUtc: text(divergenceEvent.confirmation_bar_utc),
        ageBars: integer(divergenceEvent.age_bars),
        maxEventAgeBars: integer(divergenceEvent.max_event_age_bars),
      },
      priceReference: {
        value: numeric(priceReference.value),
        quote: text(priceReference.quote),
        intendedEntry: {
          // The frozen rule itself, carried rather than restated in the view: a
          // UI that hardcodes "open(t+1)" would go on asserting it after the
          // frozen rule changed, which is the drift this surface exists to catch.
          rule: coded(intendedEntry.rule, "entryRule"),
          // The honesty field. "not_taken" is a pulse the frozen evaluator
          // declined; it is never a fill and must never be counted as one.
          state: text(intendedEntry.state),
          entryBarOpenUtc: text(intendedEntry.entry_bar_open_utc),
          notTakenReason: coded(intendedEntry.not_taken_reason, "notTakenReason"),
          earliestPossibleEntryBarOpenUtc: text(intendedEntry.earliest_possible_entry_bar_open_utc),
          fillRecordId: text(intendedEntry.fill_record_id),
        },
      },
      dataSource: {
        provider: caveat(dataSource.provider),
        baseIntervalMinutes: integer(dataSource.base_interval_minutes),
        lastBaseBarCloseUtc: text(dataSource.last_base_bar_close_utc),
        completeRequired: aggregation.complete_required === true,
      },
    };
  }

  if (base.recordType === "fill") {
    const fill = isObject(record.fill) ? record.fill : {};
    return {
      ...base,
      direction: text(record.direction),
      entryBarOpenUtc: text(fill.entry_bar_open_utc),
      entryPrice: numeric(fill.entry_price),
    };
  }

  if (base.recordType === "exit") {
    const exit = isObject(record.exit) ? record.exit : {};
    return {
      ...base,
      direction: text(record.direction),
      exitBarUtc: text(exit.exit_bar_utc),
      exitPrice: numeric(exit.exit_price),
      exitReason: coded(exit.exit_reason, "exitReason"),
      barsHeld: integer(exit.bars_held),
      grossReturn: numeric(exit.gross_return),
      netReturnAfterFrozenFriction: numeric(exit.net_return_after_frozen_friction),
      evaluatorClass: text(exit.evaluator_class),
    };
  }

  const outage = isObject(record.outage) ? record.outage : {};
  return {
    ...base,
    recordType: "outage",
    signalId: null,
    // N6 landed here: `reason` was echoed into a `<strong>` by a label map's
    // fall-through and `detail` was printed raw, uncapped and unquoted, on the
    // one card kind that carried no counter-claim. Neither leaves this function
    // as a bare string any more.
    transition: coded(outage.transition, "outageTransition"),
    fromUtc: text(outage.from_utc),
    toUtc: text(outage.to_utc),
    reason: coded(outage.reason, "outageReason"),
    detail: caveat(outage.detail),
    barsMissed: integer(outage.bars_missed),
  };
}

function projectProtocol(context) {
  if (!isObject(context)) return null;
  const exits = isObject(context.exits) ? context.exits : {};
  const atr = isObject(exits.atr) ? exits.atr : {};
  const friction = isObject(context.friction) ? context.friction : {};
  const chronology = isObject(context.chronology) ? context.chronology : {};
  return {
    exits: {
      atr: {
        atrPeriod: numeric(atr.atr_period),
        maximumHoldingBars: integer(atr.maximum_holding_bars),
        stopAtr: numeric(atr.stop_atr),
        targetAtr: numeric(atr.target_atr),
      },
      oppositeSignal: caveat(exits.opposite_signal),
    },
    friction: {
      feeBpsRoundTrip: numeric(friction.fee_bps_round_trip),
      slippageBpsRoundTrip: numeric(friction.slippage_bps_round_trip),
      totalBpsRoundTrip: numeric(friction.total_bps_round_trip),
      appliedToRecordedPrices: friction.applied_to_recorded_prices === true,
    },
    retrospectiveConfirmation: caveat(chronology.retrospective_confirmation),
    selection: caveat(chronology.selection),
  };
}

/**
 * Pure projection. Returns either the surfaced block or `{available:false, reason}`.
 * Never throws on shape; refuses rather than degrades on an honesty mismatch.
 */
export function projectOscillatorWatch({
  producer,
  registry = null,
  context = null,
  ledgerRecords = [],
  ledgerLinesUnreadable = 0,
  ledgerPartitionsRead = 0,
} = {}) {
  if (!isObject(producer)) return unavailable("tracker snapshot is not an object", "snapshot_not_an_object");
  if (producer.document_id !== PRODUCER_DOCUMENT_ID) {
    return unavailable(
      `unexpected document_id ${JSON.stringify(producer.document_id ?? null)}`,
      "unexpected_document_id",
      JSON.stringify(producer.document_id ?? null),
    );
  }
  if (producer.schema_version !== PRODUCER_SCHEMA_VERSION) {
    return unavailable(
      `unsupported producer schema_version ${JSON.stringify(producer.schema_version ?? null)}`,
      "unsupported_schema_version",
      JSON.stringify(producer.schema_version ?? null),
    );
  }

  // The producer-document half of the honesty gate: the top-level literals, read
  // off the raw snapshot while it is still in hand. Any disagreement refuses the
  // whole document rather than relaxing the literal, matching how
  // collectEtfOpportunities discards a whole run. The per-entry half — live
  // signals AND ledger records — is applied to the finished block below.
  if (producer.tracking_only !== true) {
    return unavailable("tracking_only is not true", "honesty_flag_disagrees", "tracking_only is not true");
  }
  if (producer.deployment_allowed !== false) {
    return unavailable("deployment_allowed is not false", "honesty_flag_disagrees", "deployment_allowed is not false");
  }
  if (producer.capital_authority !== false) {
    return unavailable("capital_authority is not false", "honesty_flag_disagrees", "capital_authority is not false");
  }
  if (producer.order_authority !== false) {
    return unavailable("order_authority is not false", "honesty_flag_disagrees", "order_authority is not false");
  }
  if (producer.not_established_as_distinguishable_from_search_noise !== true) {
    return unavailable(
      "not_established_as_distinguishable_from_search_noise is not true",
      "honesty_flag_disagrees",
      "not_established_as_distinguishable_from_search_noise is not true",
    );
  }

  const knownLimitations = caveats(producer.known_limitations);
  if (knownLimitations.length === 0) {
    return unavailable("known_limitations is empty", "known_limitations_empty");
  }
  const purpose = caveat(producer.purpose);
  if (purpose == null) return unavailable("purpose is missing", "purpose_missing");

  const cellsInput = Array.isArray(producer.cells) ? producer.cells.filter(isObject) : [];
  if (cellsInput.length === 0) return unavailable("cells is empty", "cells_empty");

  const registryCells = isObject(registry) && Array.isArray(registry.cells) ? registry.cells : [];
  const registryByWatchId = new Map(
    registryCells.filter(isObject).map((cell) => [text(cell.watch_id), cell]),
  );

  // Built before anything is projected: every printed identifier below is
  // checked against it, and it travels in the block so the server and the
  // client - neither of which ever sees the registry document - check
  // membership against the same set this projection did.
  const vocabulary = buildIdentifierVocabulary(registry, producer);

  const cells = cellsInput.map((cell) => projectCell(cell, registryByWatchId, vocabulary));
  for (const cell of cells) {
    if (cell.watchId == null) return unavailable("a cell is missing watch_id", "cell_missing_watch_id");
    // N2: the SAME set the shared gate enforces, imported rather than restated,
    // so this producer-side message can stay specific without the enum having a
    // second definition that can drift. The gate below re-checks it on behalf of
    // the server and the client, which never run this function.
    if (!CELL_STATUSES.has(cell.status)) {
      return unavailable(
        `unknown cell status ${JSON.stringify(cell.status)}`,
        "unknown_cell_status",
        JSON.stringify(cell.status),
      );
    }
    // A cell whose caveat was lost in projection may not be rendered at all.
    if (cell.knownLimitations.length === 0) {
      return unavailable(
        `cell ${cell.watchId} carries no known_limitations`,
        "cell_missing_known_limitations",
        cell.watchId,
      );
    }
  }

  // The producer does not carry the oscillator on a live signal. It used to be
  // read off the printed watch id; the watch id is a join key now and is not
  // printed, so the card takes the oscillator from the roster cell the signal
  // already has to reference.
  const oscillatorByWatchId = new Map(cells.map((cell) => [cell.watchId, cell.oscillator]));
  const activeSignals = (Array.isArray(producer.active_signals) ? producer.active_signals : [])
    .filter(isObject)
    .map((signal) => projectActiveSignal(signal, vocabulary, oscillatorByWatchId));
  const pendingEntries = (Array.isArray(producer.pending_entries) ? producer.pending_entries : [])
    .filter(isObject)
    .map((entry) => projectPendingEntry(entry, vocabulary, oscillatorByWatchId));

  const producerHistory = (Array.isArray(producer.history) ? producer.history : []).filter(isObject);
  const merged = new Map();
  for (const record of [...producerHistory, ...ledgerRecords]) {
    if (!isObject(record)) continue;
    if (record.ledger_id != null && record.ledger_id !== LEDGER_ID) continue;
    const recordId = text(record.record_id);
    if (recordId == null) continue;
    if (!merged.has(recordId)) merged.set(recordId, record);
  }
  const projected = [...merged.values()]
    .map((record) => projectRecord(record, vocabulary))
    .filter((record) => record.recordType != null && record.emittedAtUtc != null)
    .sort(compareHistoryRecords);
  const history = projected.slice(0, OSCILLATOR_WATCH_HISTORY_CAP);
  // How many DISTINCT instants the whole observed ledger carries. One means the
  // ordering is not chronological at all, whatever the header says, and the view
  // is required to say so rather than print "newest first" over an arbitrary 40.
  const distinctEmittedAt = new Set(projected.map((record) => record.emittedAtUtc)).size;
  // Per kind, observed against shown, so an eviction is visible on the page
  // instead of being a silent difference between two totals.
  const countKinds = (records) => {
    const counts = { signal: 0, fill: 0, exit: 0, outage: 0 };
    for (const record of records) {
      if (Object.hasOwn(counts, record.recordType)) counts[record.recordType] += 1;
    }
    return counts;
  };

  const registryBlock = isObject(producer.registry) ? producer.registry : {};
  const runtime = isObject(producer.runtime) ? producer.runtime : {};
  const parity = isObject(producer.parity) ? producer.parity : {};
  const assertions = isObject(parity.assertions) ? parity.assertions : {};
  const ledger = isObject(producer.ledger) ? producer.ledger : {};
  const retention = isObject(producer.retention) ? producer.retention : {};
  const counts = isObject(producer.counts) ? producer.counts : {};
  // D7: total_records is a producer counter and can lag what the partitions
  // actually hold. Taking the larger of the counter and the count observed here
  // means a record dropped by the cap is never reported as "not truncated".
  const reportedRecords = integer(ledger.total_records);
  const observedRecords = merged.size;
  const totalRecords =
    reportedRecords == null ? observedRecords : Math.max(reportedRecords, observedRecords);

  const block = {
    available: true,
    schemaVersion: OSCILLATOR_WATCH_BLOCK_SCHEMA_VERSION,
    producerSchemaVersion: PRODUCER_SCHEMA_VERSION,
    generatedAt: text(producer.generated_at_utc),
    runId: producerIdentifier(producer.run_id, "runId", vocabulary),
    evaluatorVersion: text(producer.evaluator_version),

    trackingOnly: true,
    deploymentAllowed: false,
    capitalAuthority: false,
    orderAuthority: false,
    notEstablishedAsDistinguishableFromSearchNoise: true,
    purpose,
    knownLimitations,
    evidenceWindowEndsUtc: text(producer.evidence_window_ends_utc),
    vocabulary,

    registry: {
      registryId: producerIdentifier(registryBlock.registry_id, "registryId", vocabulary),
      sha256: text(registryBlock.sha256),
      selectionRule: caveat(registryBlock.selection_rule),
      cellsTotal: integer(registryBlock.cells_total) ?? cells.length,
      cellsActive: integer(registryBlock.cells_active) ?? 0,
      cellsDeferred: integer(registryBlock.cells_deferred) ?? 0,
    },
    runtime: {
      python: producerIdentifier(runtime.python, "version", vocabulary),
      numpy: producerIdentifier(runtime.numpy, "version", vocabulary),
      pandas: producerIdentifier(runtime.pandas, "version", vocabulary),
      ta: producerIdentifier(runtime.ta, "version", vocabulary),
      matchesFrozenProtocol: runtime.matches_frozen_protocol === true,
      frozenProtocolRuntime: isObject(runtime.frozen_protocol_runtime)
        ? {
            python: producerIdentifier(runtime.frozen_protocol_runtime.python, "version", vocabulary),
            numpy: producerIdentifier(runtime.frozen_protocol_runtime.numpy, "version", vocabulary),
            pandas: producerIdentifier(runtime.frozen_protocol_runtime.pandas, "version", vocabulary),
            ta: producerIdentifier(runtime.frozen_protocol_runtime.ta, "version", vocabulary),
          }
        : null,
    },
    parity: {
      frozenFiles: Array.isArray(parity.frozen_files) ? parity.frozen_files.length : 0,
      reimplementedLogic: Array.isArray(parity.reimplemented_logic)
        ? parity.reimplemented_logic.length
        : 0,
      assertionsChecked: integer(assertions.checked) ?? 0,
      assertionsPassed: integer(assertions.passed) ?? 0,
      assertionsFailed: integer(assertions.failed) ?? 0,
    },
    protocol: projectProtocol(context),

    ledger: {
      directory: text(ledger.directory),
      totalRecords,
      partitions: Array.isArray(ledger.partitions) ? ledger.partitions.length : 0,
      partitionsRead: ledgerPartitionsRead,
      linesUnreadable: ledgerLinesUnreadable,
      firstBarUtc: text(ledger.first_bar_utc),
      lastBarUtc: text(ledger.last_bar_utc),
      policy: caveat(retention.ledger_policy),
      expectedRecordsPerMonth: numeric(retention.expected_records_per_month),
      expectedRecordsPerMonthBasis: caveat(retention.expected_records_per_month_basis),
    },

    counts: {
      cellsTotal: integer(counts.cells_total) ?? cells.length,
      activeLong: integer(counts.active_long) ?? 0,
      activeShort: integer(counts.active_short) ?? 0,
      flat: integer(counts.flat) ?? 0,
      insufficientHistory: integer(counts.insufficient_history) ?? 0,
      sourceUnavailable: integer(counts.source_unavailable) ?? 0,
      deferred: integer(counts.deferred) ?? 0,
      lifecycleTerminatedBankrupt: integer(counts.lifecycle_terminated_bankrupt) ?? 0,
      cellsEvaluated: integer(counts.cells_evaluated) ?? 0,
      signalsThisRun: integer(counts.signals_this_run) ?? 0,
      fillsThisRun: integer(counts.fills_this_run) ?? 0,
      exitsThisRun: integer(counts.exits_this_run) ?? 0,
    },

    cells,
    activeSignals,
    pendingEntries,

    history,
    historyCap: OSCILLATOR_WATCH_HISTORY_CAP,
    historyTruncated: history.length < totalRecords,
    historyRecordsAvailable: totalRecords,
    historyRecordsObserved: observedRecords,
    historyRecordsReported: reportedRecords,
    // N4 residual. The ordering is stated rather than assumed by the view, and
    // the two counts below let the view say WHICH records the cap dropped.
    historyOrder: OSCILLATOR_HISTORY_ORDER,
    historyDistinctEmittedAt: distinctEmittedAt,
    historyKindsObserved: countKinds(projected),
    historyKindsShown: countKinds(history),
  };

  // The per-entry half of the honesty gate, over both lanes at once. The block
  // is either surfaced whole or refused with a stated reason; there is no path
  // that renders a label the gate would not accept.
  const violation = oscillatorWatchHonestyViolation(block);
  if (violation != null) return unavailable(violation, "gate_violation", violation);
  block.projectionSha256 = projectionDigest(block);
  return block;
}

/**
 * A digest of the projection's own CONTENT.
 *
 * N5 residual. Freshness used to be keyed on identity — runId, generatedAt,
 * evaluatorVersion, cells[0].watchId — and the rich producer tree and the
 * committed fixture are identical on all four while differing in content (40
 * history records against 36). A dist built from one, checked against an
 * app/data holding the other, reported FRESH and then failed opaquely, which is
 * the exact failure the freshness gate exists to prevent. A digest cannot agree
 * with a projection it was not taken from.
 *
 * Serialised with sorted keys so the digest is a function of the content and not
 * of the order the block happened to be built in.
 */
export function projectionDigest(block) {
  const canonical = (value) => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value != null && typeof value === "object") {
      return `{${Object.keys(value)
        .filter((key) => key !== "projectionSha256")
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
        .join(",")}}`;
    }
    return JSON.stringify(value ?? null);
  };
  return createHash("sha256").update(canonical(block)).digest("hex");
}

async function readJsonIfPresent(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf8"));
}

/**
 * The newest `limit` partitions OF EACH STREAM.
 *
 * N4. This used to sort every filename descending and slice the first `limit`,
 * which makes the PREFIX outrank the MONTH:
 *
 *   outages-2026-08, signals-2026-06, signals-2026-07
 *   descending  ->  signals-2026-07 > signals-2026-06 > outages-2026-08
 *   limit=2     ->  signals-2026-07, signals-2026-06
 *   dropped     ->  outages-2026-08, the newest month by date
 *
 * The same class as F8 on the producer side, fixed there and reintroduced here.
 * It was harmless only because snapshot.history happened to carry the outage
 * too; an outage that existed only in its own partition would have vanished,
 * and an outage is the tracker reporting that it went quiet — the one record
 * this surface exists to show.
 *
 * Selecting per stream, ordered by the PARSED month, means adding a stream can
 * never evict another stream's newest month. A name that does not carry a month
 * is its own stream, ordered by name, so nothing is silently dropped for being
 * unparseable.
 */
export function selectNewestPartitions(names, limit) {
  const streams = new Map();
  for (const name of names) {
    const match = /^(.*)-(\d{4})-(\d{2})\.jsonl$/.exec(name);
    const stream = match ? match[1] : name;
    const order = match ? Number(match[2]) * 12 + Number(match[3]) : Number.NEGATIVE_INFINITY;
    if (!streams.has(stream)) streams.set(stream, []);
    streams.get(stream).push({ name, order });
  }
  const selected = [];
  for (const entries of streams.values()) {
    entries.sort((left, right) =>
      right.order - left.order || right.name.localeCompare(left.name));
    for (const entry of entries.slice(0, limit)) selected.push(entry);
  }
  // Newest first overall, so a downstream cap keeps the most recent records.
  selected.sort((left, right) => right.order - left.order || right.name.localeCompare(left.name));
  return selected.map((entry) => entry.name);
}

// Newest ledger partitions, read defensively: a half-flushed JSONL line is
// skipped and counted rather than allowed to reject the sync.
async function readNewestLedgerPartitions(ledgerRoot, limit = 2) {
  if (!existsSync(ledgerRoot)) return { records: [], unreadable: 0, partitionsRead: 0 };
  const names = selectNewestPartitions(
    (await readdir(ledgerRoot, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => entry.name),
    limit,
  );
  const records = [];
  let unreadable = 0;
  let partitionsRead = 0;
  for (const name of names) {
    let contents;
    try {
      contents = await readFile(resolve(ledgerRoot, name), "utf8");
    } catch {
      unreadable += 1;
      continue;
    }
    partitionsRead += 1;
    for (const line of contents.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        records.push(JSON.parse(trimmed));
      } catch {
        unreadable += 1;
      }
    }
  }
  return { records, unreadable, partitionsRead };
}

/**
 * I/O wrapper. Never throws and never rejects: a missing, partial or corrupt
 * tracker degrades to `{available:false, reason}` so the rest of the sync runs.
 */
export async function collectOscillatorWatch(arbitraRoot) {
  try {
    const watchRoot = resolve(arbitraRoot, ...OSCILLATOR_WATCH_RELATIVE_ROOT.split("/"));
    const snapshotPath = resolve(watchRoot, "snapshot.json");
    if (!existsSync(snapshotPath)) {
      return unavailable(
        "the oscillator-alpha-watch tracker has not written a snapshot",
        "tracker_not_written",
      );
    }
    const producer = JSON.parse(await readFile(snapshotPath, "utf8"));

    const registry = await readJsonIfPresent(
      resolve(arbitraRoot, ...OSCILLATOR_WATCH_REGISTRY_RELATIVE_PATH.split("/")),
    ).catch(() => null);

    const ledgerRoot = resolve(watchRoot, "ledger");
    let ledger = { records: [], unreadable: 0, partitionsRead: 0 };
    try {
      ledger = await readNewestLedgerPartitions(ledgerRoot);
    } catch {
      ledger = { records: [], unreadable: 0, partitionsRead: 0 };
    }

    let context = null;
    const contextSha = producer?.history?.find?.((record) => record?.honesty?.context_sha256)?.honesty
      ?.context_sha256;
    if (typeof contextSha === "string" && /^[0-9a-f]{64}$/.test(contextSha)) {
      context = await readJsonIfPresent(resolve(ledgerRoot, "context", `${contextSha}.json`)).catch(
        () => null,
      );
    }

    return projectOscillatorWatch({
      producer,
      registry,
      context,
      ledgerRecords: ledger.records,
      ledgerLinesUnreadable: ledger.unreadable,
      ledgerPartitionsRead: ledger.partitionsRead,
    });
  } catch (error) {
    return unavailable(
      `oscillator-alpha-watch tracker output is unreadable: ${error.message}`,
      "tracker_unreadable",
      error.message,
    );
  }
}
