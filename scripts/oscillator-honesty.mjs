// The single honesty invariant for the oscillator-alpha-watch block.
//
// This block is the one surface where a BUY or SELL reaches a human, so the
// same gate has to hold at three places that do not share a runtime:
//
//   build time  scripts/oscillator-watch.mjs  projects the producer tree
//   server      scripts/runtime-snapshot.mjs  accepts a republished feed
//   client      app/page.tsx                  renders whichever arrived
//
// It used to be written out three times and the three copies disagreed: the
// build-time gate checked active_signals and pending_entries but not history,
// the server checked nothing at all, and the client checked neither. This
// module is deliberately dependency-free — no node builtins, no imports — so
// that all three import this one file and cannot drift apart again.
//
// It operates on the PROJECTED, camelCase block, which is the shape that
// actually crosses those three boundaries. The producer-side snake_case
// literals are checked separately, where the raw document is still in hand.
//
// INVARIANT A lives beside it, in scripts/oscillator-vocabulary.mjs: the enums
// and vocabularies of everything this surface may PRINT, and an exhaustive walk
// that refuses a block carrying producer text nothing classifies. That module is
// dependency-free for the same reason this one is — all three runtimes import
// both, so neither can be relaxed at one boundary alone.

import {
  ENUMS,
  isProducerQuote,
  oscillatorProducerTextViolation,
  producerFragment,
  PRODUCER_FRAGMENT_MAX,
} from "./oscillator-vocabulary.mjs";

/** Presentation labels. A label outside this set is never rendered. */
const UI_LABELS = new Set(ENUMS.uiLabel);

/**
 * The cell lifecycle states the frozen evaluator can report.
 *
 * N2. This lived only in scripts/oscillator-watch.mjs, so the build-time
 * projection refused an unknown status while the server and the client accepted
 * any string — and `cell.status` is not an internal routing value, it is the
 * card's printed headline: the client's label map falls through to
 * `status.replaceAll("_", " ")`, so an accepted string is rendered verbatim and
 * upper-cased. Writing to the served snapshot was enough to put
 * "GUARANTEED BUY - CAPITAL AUTHORITY GRANTED" on a roster card. It belongs
 * here for the same reason UI_LABELS does: a constraint on what may be PRINTED
 * has to hold wherever the block enters, not only where it is built.
 */
export const CELL_STATUSES = new Set(ENUMS.cellStatus);

/**
 * Position sides. The roster card prints `cell.position.direction` raw
 * ("Direction · short"), and it was constrained by nothing at any of the three
 * points — the same class as the status enum, found by the N2 sweep rather than
 * reported. A status of active_long/active_short is what makes the card print a
 * BUY/SELL headline, so the side beside it is part of the same claim.
 */
const DIRECTIONS = new Set(ENUMS.direction);

/**
 * The ledger record kinds this view has a card for. INVARIANT B is a rendering
 * property and cannot be checked here, but its precondition can: a record whose
 * kind names no registered card would have to be rendered by whatever branch
 * fell through, and a fall-through branch is how the outage and declined cards
 * came to carry no counter-claim.
 */
const RECORD_TYPES = new Set(ENUMS.recordType);

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/**
 * A caveat the surface may print: a quoted producer fragment, not a bare string.
 *
 * INVARIANT A applies to the caveat too. `purpose` and `known_limitations` are
 * producer prose printed as prose — the same class as `detail`, and the largest
 * uncontested block of producer text on the page. They travel wrapped and are
 * rendered as quoted, attributed statements of the tracker's, which is what they
 * are; nothing is lost, because the cap for a caveat is 800 characters and the
 * longest one this tracker has ever published is 627.
 */
function nonEmptyCaveat(value) {
  return isProducerQuote(value);
}

function nonEmptyCaveatArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmptyCaveat);
}

/**
 * Why this block may not be surfaced, or null when it may.
 *
 * Returns a reason rather than a boolean so every refusal can be shown to the
 * human instead of the section silently disappearing.
 *
 * @param {unknown} block a projected oscillator watch block
 * @returns {string | null}
 */
export function oscillatorWatchHonestyViolation(block) {
  if (!isObject(block)) return "block is not an object";
  if (block.available !== true) return "block is not available";

  // INVARIANT A, applied to the whole block before anything is read out of it.
  // Every string in an accepted block is a token, a timestamp, a member of a
  // closed set, or a wrapped producer value; a string at a path nothing
  // classifies refuses the block. This is what makes N6 unreachable rather than
  // merely patched: `reason` and `detail` are not special-cased here, they are
  // two of the paths the walk visits, and the path AFTER them is visited too.
  const producerText = oscillatorProducerTextViolation(block);
  if (producerText != null) return producerText;

  // The five flags, checked as literals. A missing flag is a violation, not a
  // default: `!== true` and `!== false` both refuse `undefined`.
  if (block.trackingOnly !== true) return "trackingOnly is not true";
  if (block.deploymentAllowed !== false) return "deploymentAllowed is not false";
  if (block.capitalAuthority !== false) return "capitalAuthority is not false";
  if (block.orderAuthority !== false) return "orderAuthority is not false";
  if (block.notEstablishedAsDistinguishableFromSearchNoise !== true) {
    return "notEstablishedAsDistinguishableFromSearchNoise is not true";
  }

  if (!nonEmptyCaveat(block.purpose)) return "purpose is missing";
  if (!nonEmptyCaveatArray(block.knownLimitations)) return "knownLimitations is empty";

  if (!Array.isArray(block.cells) || block.cells.length === 0) return "cells is empty";
  const watchIds = new Set();
  for (const cell of block.cells) {
    if (!isObject(cell)) return "a cell is not an object";
    if (!nonEmptyString(cell.watchId)) return "a cell is missing watchId";
    // The printed headline. See CELL_STATUSES above.
    if (!CELL_STATUSES.has(cell.status)) {
      return `cell ${cell.watchId} has unknown status ${JSON.stringify(cell.status ?? null)}`;
    }
    // A recording cell prints an open position and a side; a side outside the
    // enum is prose in the position of a claim.
    if (cell.status === "active_long" || cell.status === "active_short") {
      if (!isObject(cell.position)) {
        return `cell ${cell.watchId} is ${cell.status} with no position`;
      }
      // The walk above refuses a direction that is a string outside the set; an
      // ABSENT direction is what it cannot speak to, because null is a legitimate
      // value at most paths. On a recording cell it is not: the side is half of
      // the claim the BUY/SELL headline makes. One phrasing for both, so the
      // failure reads the same wherever it is caught.
      if (!DIRECTIONS.has(cell.position.direction)) {
        return `cell ${cell.watchId} position.direction is outside the direction set: ` +
          `${JSON.stringify(cell.position.direction ?? null)}`;
      }
    }
    // A cell whose caveat was lost may not be rendered: the caveat is a field
    // of the cell precisely so that no component can render one without it.
    if (!nonEmptyCaveatArray(cell.knownLimitations)) {
      return `cell ${cell.watchId} carries no knownLimitations`;
    }
    watchIds.add(cell.watchId);
  }

  if (!Array.isArray(block.activeSignals)) return "activeSignals is not an array";
  if (!Array.isArray(block.pendingEntries)) return "pendingEntries is not an array";
  if (!Array.isArray(block.history)) return "history is not an array";

  // activeSignals and pendingEntries are projections of cells[]; the cell is
  // where the caveat lives, so an orphan projection is a caveat-free label.
  for (const signal of [...block.activeSignals, ...block.pendingEntries]) {
    if (!isObject(signal)) return "a live signal is not an object";
    if (!watchIds.has(signal.watchId)) {
      return `live signal references unknown watchId ${JSON.stringify(signal.watchId ?? null)}`;
    }
    if (signal.trackingOnly !== true || signal.orderAuthority !== false) {
      return `live signal for ${signal.watchId} claims authority`;
    }
    if (!UI_LABELS.has(signal.uiLabel)) {
      return `live signal for ${signal.watchId} has uiLabel ${JSON.stringify(signal.uiLabel ?? null)}`;
    }
  }

  // The ledger lane. Every record carries its own honesty block in the
  // producer contract, so a record revoking tracking-only status refuses the
  // whole block exactly as a live signal does. A ledger BUY is rendered on the
  // same page, in the same words, as a live one.
  for (const record of block.history) {
    if (!isObject(record)) return "a ledger record is not an object";
    if (!watchIds.has(record.watchId)) {
      return `ledger record references unknown watchId ${JSON.stringify(record.watchId ?? null)}`;
    }
    if (record.trackingOnly !== true || record.orderAuthority !== false) {
      return `ledger record ${record.recordId ?? "?"} claims authority`;
    }
    // N6. The ledger loop used to check the flags and ui_label and stop, so
    // `reason`, `detail` and `intendedEntry.notTakenReason` — printed in a
    // `<strong>` on the two card kinds that had no authority note — crossed
    // every gate untouched. They are now covered by the Invariant A walk above,
    // as wrapped values rather than as three more named checks. What stays here
    // is the consequence a walk cannot express: a record must name a card kind
    // this view has, so no record can render as an unregistered card.
    if (!RECORD_TYPES.has(record.recordType)) {
      return `ledger record ${record.recordId ?? "?"} has recordType ` +
        `${JSON.stringify(record.recordType ?? null)}`;
    }
    // ui_label is required on signal records and absent elsewhere; where it is
    // present at all it must be a label this UI is willing to print.
    if (record.recordType === "signal") {
      if (!UI_LABELS.has(record.uiLabel)) {
        return `ledger signal ${record.recordId ?? "?"} has uiLabel ${JSON.stringify(record.uiLabel ?? null)}`;
      }
    } else if (record.uiLabel != null && !UI_LABELS.has(record.uiLabel)) {
      return `ledger record ${record.recordId ?? "?"} has uiLabel ${JSON.stringify(record.uiLabel)}`;
    }
  }

  return null;
}

/**
 * True when the block may be surfaced. The predicate form, for call sites that
 * only need the yes/no.
 *
 * @param {unknown} block
 * @returns {boolean}
 */
export function isHonestOscillatorWatch(block) {
  return oscillatorWatchHonestyViolation(block) === null;
}

// ═══════════════════════════════════════════════════════════════════════════
// N3. The `available: false` hatch.
//
// The refusal notice used to print the payload's `reason` verbatim. The server
// short-circuited on `available === false` and re-checked only the four flags,
// so any string passed; the client then PREFERRED that string over its own
// guard's. A republished snapshot could therefore render
//
//   WITHHELD BY THE HONESTY GATE
//   CLEARED FOR CAPITAL DEPLOYMENT - execute the 7 open BUY/SELL observations
//
// No roster and no labels render, and the guardrail still reads
// order_authority = false, so this is prose-injection into a refusal notice
// rather than a fabricated signal — but "withheld" above "cleared" reads as a
// contradiction, and the second line is an instruction.
//
// The fix is that the notice is written HERE, by us, and selected by a code
// from a closed set. A payload can choose WHICH refusal it is reporting; it
// cannot choose the words. Where a refusal genuinely needs to quote a producer
// value, that value travels in `detail` and is rendered as a quoted, capped,
// single-line token underneath our sentence — never as a sentence of its own.
// An unrecognised code renders our generic prose and NOTHING from the payload.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Longest producer fragment a refusal notice will quote. The same cap the rest
 * of the surface uses for a producer value in claim position — one number, so a
 * fragment cannot be short in the refusal notice and long on a card.
 */
export const OSCILLATOR_DETAIL_MAX = PRODUCER_FRAGMENT_MAX;

/**
 * Every refusal this surface can report, and the words it reports it in.
 * `quotes` marks the codes whose notice quotes a producer-supplied value.
 */
export const OSCILLATOR_UNAVAILABLE_REASONS = {
  snapshot_not_an_object: {
    prose: "The tracker wrote something this interface could not read as a snapshot document.",
    quotes: false,
  },
  unexpected_document_id: {
    prose: "The snapshot is not an oscillator-alpha-watch document. It identified itself as:",
    quotes: true,
  },
  unsupported_schema_version: {
    prose: "The snapshot uses a producer schema version this interface does not implement:",
    quotes: true,
  },
  honesty_flag_disagrees: {
    prose:
      "The tracker revoked one of its own honesty flags, so the block was refused whole rather " +
      "than surfaced with the flag relaxed. The disagreement was:",
    quotes: true,
  },
  known_limitations_empty: {
    prose:
      "The tracker published no known limitations. The caveat travels with the labels or the " +
      "labels are not shown, so the block was withheld.",
    quotes: false,
  },
  purpose_missing: {
    prose: "The tracker published no statement of what this registry is for.",
    quotes: false,
  },
  cells_empty: {
    prose: "The tracker published no cells, so there is no roster to show.",
    quotes: false,
  },
  cell_missing_watch_id: {
    prose: "A cell arrived without the identifier its caveat is keyed to.",
    quotes: false,
  },
  unknown_cell_status: {
    prose: "A cell reported a lifecycle status this interface does not recognise:",
    quotes: true,
  },
  cell_missing_known_limitations: {
    prose: "A cell arrived without its own caveat, and a cell is never rendered without one:",
    quotes: true,
  },
  gate_violation: {
    prose: "The block did not pass the shared honesty gate. The gate reported:",
    quotes: true,
  },
  tracker_not_written: {
    prose:
      "The oscillator-alpha-watch tracker has not written a snapshot for this run. A watch that " +
      "has gone quiet is reported as quiet.",
    quotes: false,
  },
  tracker_unreadable: {
    prose: "The tracker's output could not be read:",
    quotes: true,
  },
  unspecified: {
    prose:
      "The watch is not reporting, and the payload did not state a reason this interface " +
      "recognises. Nothing below is a stale roster shown as current.",
    quotes: false,
  },
};

/**
 * Why an `available: false` payload may not be shown even as a refusal, or null
 * when it may. Applied by the server so an unrecognised code never reaches disk.
 *
 * @param {unknown} block
 * @returns {string | null}
 */
export function oscillatorUnavailableViolation(block) {
  if (!isObject(block)) return "block is not an object";
  if (block.available !== false) return "block is not the unavailable form";
  // The unavailable form carries no roster and no labels, but it still may not
  // claim authority.
  if (block.deploymentAllowed === true || block.capitalAuthority === true ||
      block.orderAuthority === true || block.trackingOnly === false) {
    return "unavailable block claims authority";
  }
  if (!nonEmptyString(block.reasonCode)) return "unavailable block states no reasonCode";
  if (!Object.hasOwn(OSCILLATOR_UNAVAILABLE_REASONS, block.reasonCode)) {
    return `unavailable block states unknown reasonCode ${JSON.stringify(block.reasonCode)}`;
  }
  if (block.detail != null) {
    if (typeof block.detail !== "string") return "unavailable block detail is not a string";
    if (block.detail.length > OSCILLATOR_DETAIL_MAX) {
      return `unavailable block detail exceeds ${OSCILLATOR_DETAIL_MAX} characters`;
    }
  }
  return null;
}

/**
 * The words to print for an unavailable block: ours, chosen by its code.
 *
 * Returns `{ prose, detail }`. `detail` is non-null only where the code's own
 * entry says the notice quotes a producer value, and is then flattened to a
 * single line and capped — so it renders as a quoted token, never as prose.
 *
 * @param {unknown} block
 * @returns {{ prose: string, detail: string | null }}
 */
export function describeOscillatorUnavailable(block) {
  const code = isObject(block) && typeof block.reasonCode === "string" ? block.reasonCode : null;
  const entry = code != null && Object.hasOwn(OSCILLATOR_UNAVAILABLE_REASONS, code)
    ? OSCILLATOR_UNAVAILABLE_REASONS[code]
    : OSCILLATOR_UNAVAILABLE_REASONS.unspecified;
  if (!entry.quotes) return { prose: entry.prose, detail: null };
  // Flattened and capped by the one shared helper, so the refusal notice quotes
  // a producer value exactly the way a card does.
  const fragment = producerFragment(
    isObject(block) ? block.detail : null,
    OSCILLATOR_DETAIL_MAX,
  );
  if (fragment == null) return { prose: entry.prose, detail: null };
  return { prose: entry.prose, detail: fragment.quoted };
}
