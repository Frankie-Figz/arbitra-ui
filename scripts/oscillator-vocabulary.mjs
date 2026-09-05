// INVARIANT A. No unconstrained producer string reaches the DOM.
//
// Three rounds closed this surface FIELD BY FIELD. `cell.status` got a closed
// set (N2); `position.direction` got one; the refusal notice got one (N3).
// `reason`, `exitReason` and `notTakenReason` kept the identical echoing
// fall-through and produced N6 — a `<strong>` reading
// "SELL NOW CAPITAL AUTHORITY GRANTED" with an uncapped instruction beneath it,
// through the normal producer -> sync -> build -> SSR path, with all three
// gates accepting. Patching `reason` would have produced a fourth round on
// `detail`, then on `purpose`, then on `availability.detail`.
//
// So the constraint is stated over the SHAPE OF THE BLOCK rather than over a
// list of today's fields. Every string that can exist in an accepted block is
// one of four things, and there is no fifth:
//
//   opaque      an identifier that is NEVER PRINTED - a digest, an artifact
//               path, a join key. This is all that is left of `token`: the
//               claim that a pattern with no whitespace cannot become a
//               sentence was false, so the verdict survives only where nothing
//               renders the value at all, and the rendered sentinel sweep is
//               what holds that to account.
//   id:<set>    a PRINTED identifier: a member of a closed set the block
//               declares and the frozen registry supplies, or - for anything
//               outside it - a quoted fragment. Never a bare string this
//               interface has not placed.
//   member:<set> a member of the block's own declared vocabulary. The one place
//               a bare producer string is legal, and the one checked hardest:
//               a member outside its set's shape refuses the block.
//   timestamp   an instant, matched against a pattern. Printed through the
//               date formatter.
//   enum:<set>  a member of a named closed set. Outside it the whole block is
//               refused — these are the values that pick a lane or a headline.
//   coded/      NOT a bare string at all. A producer value in claim position
//   fragment/   arrives WRAPPED: `{ code }` (a member of a closed vocabulary,
//   caveat      for which WE supply the prose) or `{ quoted }` (a flattened,
//               capped fragment the interface renders as a quoted, attributed,
//               non-authoritative value).
//
// The gate then WALKS the projected block and classifies every string leaf
// against the manifest below. A string at a path nobody classified is a
// violation, so a field added to the projection fails closed until someone
// decides what may be printed for it. That is what makes this a closed class
// rather than a longer list: the enumeration is of PATHS THAT EXIST, produced
// by walking, not of fields somebody remembered.
//
// Dependency-free on purpose — no node builtins, no imports. The build-time
// projection, the ingest server and the client all import it, exactly as they
// all import scripts/oscillator-honesty.mjs, so the three cannot drift.

// ── The wrapper ──────────────────────────────────────────────────────────────

/** Longest producer fragment rendered beside a label. */
export const PRODUCER_FRAGMENT_MAX = 240;

/**
 * Longest producer fragment rendered as a stated caveat. Longer than a
 * claim-position fragment because the tracker's own known_limitations,
 * availability detail and lifecycle-termination detail ARE the caveat:
 * truncating them to 240 characters would delete the thing this surface exists
 * to carry. Length is hygiene here, not the protection — the protection is that
 * a fragment renders quoted and attributed, never as a sentence in this
 * interface's own voice.
 */
export const PRODUCER_CAVEAT_MAX = 800;

/**
 * Flatten and cap a producer string into the quoted-fragment wrapper.
 *
 * Flatten first, then cap: a newline is how a quoted token stops looking like a
 * quoted token. Returns null for a missing or empty value so a caller drops the
 * field rather than emitting an empty quotation.
 *
 * @param {unknown} value
 * @param {number} max
 * @returns {{ quoted: string, truncated?: true } | null}
 */
export function producerFragment(value, max = PRODUCER_FRAGMENT_MAX) {
  if (typeof value !== "string") return null;
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return null;
  if (flat.length <= max) return { quoted: flat };
  // Truncation is declared rather than hidden: a fragment ending in an ellipsis
  // with no note reads as the producer's own wording.
  return { quoted: `${flat.slice(0, max - 1)}…`, truncated: true };
}

/**
 * A producer value carried as a code from a closed vocabulary, or — where the
 * producer used a code this interface has never seen — demoted to a quoted
 * fragment. It is never carried as a bare string, because a bare string in this
 * position is exactly what a label map echoes.
 *
 * @param {unknown} value
 * @param {string} vocabulary a key of VOCABULARIES
 * @returns {{ code: string } | { quoted: string, truncated?: true } | null}
 */
export function producerCoded(value, vocabulary) {
  if (typeof value !== "string" || value.length === 0) return null;
  const entries = VOCABULARIES[vocabulary];
  if (entries != null && Object.hasOwn(entries, value)) return { code: value };
  return producerFragment(value, PRODUCER_FRAGMENT_MAX);
}

/** True for `{ quoted }` / `{ quoted, truncated }` and nothing else. */
export function isProducerQuote(value, max = PRODUCER_CAVEAT_MAX) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length > 2) return false;
  if (!keys.every((key) => key === "quoted" || key === "truncated")) return false;
  if (typeof value.quoted !== "string" || value.quoted.length === 0) return false;
  if (value.quoted.length > max) return false;
  if (Object.hasOwn(value, "truncated") && value.truncated !== true) return false;
  // A fragment still carrying a line break is not a quoted token.
  return !/[\r\n\t]/.test(value.quoted);
}

/** True for `{ code }` and nothing else. */
export function isProducerCode(value) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === "code" && typeof value.code === "string" &&
    value.code.length > 0;
}

/** True for anything shaped like a wrapped producer value. */
export function isProducerValue(value) {
  return isProducerCode(value) || isProducerQuote(value);
}

// ── Printed identifiers: closed sets, and the shape their members must take ───
//
// The `token` verdict is gone. It was documented as "an identifier, matched
// against a pattern with no whitespace, so it cannot become a sentence", and
// that premise was false twice.
//
// It was false in the PATTERN: `[A-Za-z0-9._:+/-]{0,95}` reads as prose at
// ninety-six characters a token, because `-`, `_`, `.`, `:`, `/` and `+` all
// read as spaces. CAPITAL-AUTHORITY-GRANTED is a token. So is
// oscillator-alpha-watch:CLEARED-FOR-CAPITAL-DEPLOYMENT.
//
// And it was false in the VIEW, which supplied the whitespace itself:
// frozenLegSummary joined `${entry.name} ${entry.value}` with a literal space,
// over an uncapped array, and joined the results with " · ". Two producer
// tokens and one space is a sentence with extra steps.
//
// So a printed identifier is no longer "a string with no spaces". It is a
// member of a CLOSED SET, and there are only two things it can be:
//
//   a member    the value is in the set the block declares for it, and every
//               declared member matches that set's own shape — an alphabet and
//               a length narrow enough that the set cannot hold a sentence.
//               Printed as the identifier it is.
//   a quotation anything else. The projection demotes it with producerFragment
//               and the view renders it quoted and attributed, exactly as it
//               renders `detail`. A value this interface cannot place is not
//               refused and not printed bare: it is shown as the tracker's
//               words, marked as such.
//
// `opaque` is what is left of `token`, and it means ONE thing: a value that is
// never printed. Digests, artifact paths, join keys. The rendered sweep in
// tests/oscillator-watch.test.mjs plants a sentinel at every classified leaf and
// greps the SSR output, so an `opaque` path that starts being printed fails
// there — the classification is held to account by the DOM rather than by a
// list someone has to remember to update.

/**
 * The closed sets a printed identifier may come from.
 *
 * `pattern` is this module's own bound on what a member may look like, and it
 * is deliberately narrower than the values it describes strictly need: no `-`,
 * no `:`, no `/`, no `+` and no spaces in the sets that name things, because
 * those are the characters that turn an identifier into a phrase. `-` survives
 * only in `registryId`, where the tracker's own document id uses it, and there
 * it is held to lower case, four segments and sixty-four characters.
 *
 * `bounded` says whether membership is also checked against the set the block
 * declares. The bounded sets are the ones the REGISTRY enumerates — it is the
 * registry that decides which assets, timeframes, oscillators, exit families,
 * frozen windows and frozen parameters exist — so the vocabulary is derived from
 * the frozen registry rather than written down here, where it would drift.
 * `runId` and `version` are bounded by shape alone: nothing enumerates the run
 * ids a tracker will emit, and a hex digest or a version number has no room for
 * a sentence in the first place.
 */
export const IDENTIFIER_SETS = {
  asset: { pattern: /^[A-Z0-9][A-Z0-9.]{1,15}$/, bounded: true },
  timeframe: { pattern: /^[1-9][0-9]{0,3}[smhdw]$/, bounded: true },
  oscillator: { pattern: /^[a-z][a-z0-9_]{1,39}$/, bounded: true },
  exitFamily: { pattern: /^[a-z][a-z0-9_]{1,31}$/, bounded: true },
  frozenLabel: { pattern: /^[a-z][a-z0-9_]{1,31}$/, bounded: true },
  frozenParameter: { pattern: /^[a-z][a-z0-9_]{1,31}$/, bounded: true },
  // Every frozen parameter in this registry is a NUMBER; a string one is a mode
  // name (`ema`, `close`, `hlc3`). Numbers are not producer text and never reach
  // the walk, so this set exists for the mode names alone, and is held to the
  // shape a mode name has: lower case, sixteen characters.
  frozenValue: { pattern: /^[a-z][a-z0-9_]{0,15}$/, bounded: true },
  divergenceInput: { pattern: /^[a-z][a-z0-9_]{1,31}$/, bounded: true },
  registryId: { pattern: /^[a-z][a-z0-9]{0,15}(?:-[a-z0-9]{1,15}){0,3}$/, bounded: true },
  runId: { pattern: /^[0-9a-f]{8,64}$/, bounded: false },
  version: {
    pattern: /^[0-9]{1,4}(?:\.[0-9]{1,6}){0,3}(?:(?:a|b|rc|\.post|\.dev)[0-9]{1,6})?$/,
    bounded: false,
  },
};

/**
 * Largest closed set a block may declare. The registry this surface projects
 * holds seventeen cells; a vocabulary an order of magnitude larger than the
 * roster it came from is not a vocabulary.
 */
export const IDENTIFIER_SET_MAX = 256;

/**
 * True when `value` may be printed as a member of the named set.
 *
 * @param {string} name a key of IDENTIFIER_SETS
 * @param {unknown} value
 * @param {unknown} vocabulary the block's own `vocabulary`, or null
 */
export function isIdentifierMember(name, value, vocabulary = null) {
  const set = Object.hasOwn(IDENTIFIER_SETS, name) ? IDENTIFIER_SETS[name] : null;
  if (set == null) return false;
  if (typeof value !== "string" || !set.pattern.test(value)) return false;
  if (!set.bounded) return true;
  const members =
    vocabulary != null && typeof vocabulary === "object" && !Array.isArray(vocabulary)
      ? vocabulary[name]
      : null;
  return Array.isArray(members) && members.includes(value);
}

/**
 * A producer identifier, carried as itself when it is a member of the closed
 * set and demoted to a quoted fragment when it is not.
 *
 * The member case stays a BARE STRING on purpose. A bare string is safe at
 * exactly the places the gate has checked it against a closed set — which is
 * what `enum:` has always done for `status` and `direction` — and keeping it
 * bare is what lets a watch id go on being a join key and a React key.
 *
 * @param {unknown} value
 * @param {string} name a key of IDENTIFIER_SETS
 * @param {unknown} vocabulary
 * @returns {string | { quoted: string, truncated?: true } | null}
 */
export function producerIdentifier(value, name, vocabulary = null) {
  if (typeof value !== "string" || value.length === 0) return null;
  if (isIdentifierMember(name, value, vocabulary)) return value;
  return producerFragment(value, PRODUCER_FRAGMENT_MAX);
}

/**
 * How to render a projected identifier: as itself, or as a quotation.
 *
 * The view has no third branch, and no branch that prints `quoted` as prose.
 *
 * @param {unknown} value
 * @returns {{ id: string | null, quoted: string | null, truncated: boolean }}
 */
export function describeIdentifier(value) {
  if (typeof value === "string" && value.length > 0) {
    return { id: value, quoted: null, truncated: false };
  }
  if (isProducerQuote(value, PRODUCER_FRAGMENT_MAX)) {
    return { id: null, quoted: value.quoted, truncated: value.truncated === true };
  }
  return { id: null, quoted: null, truncated: false };
}

/**
 * Why the block's declared vocabulary may not be trusted, or null when it may.
 *
 * The vocabulary is the block's own statement of which identifiers it may print
 * bare, so it is the one place a bare producer string is legal — and therefore
 * the one place that has to be checked hardest. A declared member that does not
 * match its set's shape REFUSES the block rather than being dropped: a
 * declaration is not a value, and there is nothing honest to demote it to.
 *
 * @param {unknown} vocabulary
 * @returns {string | null}
 */
export function identifierVocabularyViolation(vocabulary) {
  if (vocabulary == null || typeof vocabulary !== "object" || Array.isArray(vocabulary)) {
    return "the block declares no identifier vocabulary, so no printed identifier can be placed";
  }
  if (!inEnum("vocabularySource", vocabulary.source)) {
    return `vocabulary.source is outside the vocabularySource set: ${JSON.stringify(
      typeof vocabulary.source === "string"
        ? vocabulary.source.slice(0, 60)
        : (vocabulary.source ?? null),
    )}`;
  }
  for (const key of Object.keys(vocabulary)) {
    if (key === "source") continue;
    if (!Object.hasOwn(IDENTIFIER_SETS, key) || !IDENTIFIER_SETS[key].bounded) {
      return `vocabulary declares ${JSON.stringify(key)}, which names no bounded closed set`;
    }
  }
  for (const [name, set] of Object.entries(IDENTIFIER_SETS)) {
    if (!set.bounded) continue;
    const members = vocabulary[name];
    if (!Array.isArray(members)) return `vocabulary.${name} is not declared`;
    if (members.length > IDENTIFIER_SET_MAX) {
      return `vocabulary.${name} declares ${members.length} members, more than ${IDENTIFIER_SET_MAX}`;
    }
    for (const member of members) {
      if (typeof member !== "string" || !set.pattern.test(member)) {
        return `vocabulary.${name} declares ${JSON.stringify(
          typeof member === "string" ? member.slice(0, 60) : (member ?? null),
        )}, which is not a ${name}`;
      }
    }
  }
  return null;
}

// ── The closed sets whose members pick a lane or a headline ──────────────────
//
// A value outside one of these refuses the WHOLE BLOCK. They are here rather
// than demoted to a quotation because each one routes: an unknown `status`
// would still have to render as some card, an unknown `direction` sits beside a
// BUY, an unknown `state` decides whether a pulse counts as a fill.

export const ENUMS = {
  cellStatus: [
    "active_long",
    "active_short",
    "flat",
    "insufficient_history",
    "source_unavailable",
    "deferred",
    "lifecycle_terminated_bankrupt",
  ],
  direction: ["long", "short"],
  uiLabel: ["BUY", "SELL"],
  recordType: ["signal", "fill", "exit", "outage"],
  intendedEntryState: ["filled", "not_taken", "pending"],
  /**
   * How `history` was ordered. N4 residual: the projection used to sort on
   * `emittedAtUtc` alone and then slice, and every record in a backfill carries
   * the RUN's timestamp — so the sort was a no-op and the cap kept the first 40
   * by merge insertion order. The order is now stated in the block, as one of
   * these keys, and the view prints this interface's prose for it instead of
   * asserting "newest first" over an arbitrary 40.
   */
  historyOrder: ["emitted_at_desc_then_record_type_then_record_id"],
  /**
   * Where the block's printed-identifier vocabulary came from. `registry` is
   * the frozen registry document, which is what actually decides which assets,
   * timeframes, oscillators, exit families and frozen windows exist. `roster`
   * is the fallback for a producer tree with no registry beside it, where the
   * set is derived from the block's own cells - membership is then a
   * cross-lane consistency check rather than a check against the frozen
   * registry, and the view says which of the two it got.
   */
  vocabularySource: ["registry", "roster"],
};

/** @param {string} name @param {unknown} value */
export function inEnum(name, value) {
  const members = ENUMS[name];
  return Array.isArray(members) && typeof value === "string" && members.includes(value);
}

// ── The vocabularies: producer codes, and OUR words for them ─────────────────
//
// The producer chooses WHICH of these it is reporting. It does not choose the
// words. A code outside a vocabulary is not an error and does not hide the
// record — the projection demotes it to a quoted fragment and the view renders
// it as one, under this interface's own sentence saying it was not recognised.

export const VOCABULARIES = {
  outageReason: {
    not_reporting: "the cell produced no evaluation on this run",
    source_unavailable: "the cell's price source was unavailable",
    source_fetch_failed: "the price source could not be fetched",
    stale_base_data: "the base data was stale, so the cell was not evaluated live",
    adapter_unavailable: "the frozen adapter was unavailable",
    parity_assertion_failed: "a parity assertion against the frozen implementation failed",
    incomplete_bucket_required: "the final bucket was incomplete and was withheld",
    insufficient_history: "the cell is short of the warmup the frozen adapter requires",
    lifecycle_terminated_bankrupt:
      "the frozen evaluator abandoned the segment after a bankrupt trade",
    deferred: "the cell is deferred by human decision",
    recovered: "the cell resumed reporting",
  },
  exitReason: {
    atr_target: "ATR target",
    atr_stop: "ATR stop",
    maximum_holding_bars: "maximum holding bars reached",
    opposite_signal: "opposite signal",
    end_of_data: "end of available data",
    lifecycle_terminated_bankrupt: "lifecycle terminated on a bankrupt trade",
    unspecified: "no exit reason recorded",
  },
  notTakenReason: {
    position_already_open: "a position was already open on this cell",
    declined_by_frozen_evaluator: "the frozen lifecycle evaluator declined the pulse",
    entry_bar_missing: "the intended entry bar is missing from the data",
    insufficient_history: "the cell was short of warmup at this pulse",
    incomplete_bucket_required: "the entry bucket was incomplete and was withheld",
    after_evidence_window: "the pulse falls after the evidence window",
  },
  terminationReason: {
    bankrupt_trade: "a bankrupt trade",
    end_of_data: "the end of available data",
    evaluator_error: "an error inside the frozen evaluator",
  },
  outageTransition: {
    entered: "the cell entered this state",
    cleared: "the cell left this state",
  },
  entryRule: {
    "open(t+1)": "the open of the bar after the signal bar",
    "close(t)": "the close of the signal bar",
  },
};

/**
 * This interface's own sentence for a code it does not recognise. Printed
 * INSTEAD of the code, with the code quoted beneath it as a value.
 */
export const UNRECOGNISED_PROSE = {
  outageReason: "a reason this interface does not recognise",
  exitReason: "an exit reason this interface does not recognise",
  notTakenReason: "a decline reason this interface does not recognise",
  terminationReason: "a termination reason this interface does not recognise",
  outageTransition: "a transition this interface does not recognise",
  entryRule: "an entry rule this interface does not recognise",
};

/**
 * The words to print for a wrapped producer value.
 *
 * Returns `{ prose, quoted, truncated }`. `prose` is ALWAYS ours. `quoted` is
 * non-null only where the producer used a code we have never seen, and is then
 * the capped fragment, to be rendered as a quoted value rather than as a
 * sentence. There is no arrangement of a payload that makes `prose` the
 * producer's words.
 *
 * @param {unknown} value
 * @param {string} vocabulary
 * @param {string} absent prose to use when the field is absent
 */
export function describeCoded(value, vocabulary, absent) {
  const unrecognised = UNRECOGNISED_PROSE[vocabulary] ??
    "a value this interface does not recognise";
  if (isProducerCode(value)) {
    const entries = VOCABULARIES[vocabulary];
    const prose = entries != null && Object.hasOwn(entries, value.code) ? entries[value.code] : null;
    // A code the gate admitted but this table has no words for still never
    // echoes: the code is quoted, not narrated.
    if (prose != null) return { prose, quoted: null, truncated: false };
    return {
      prose: unrecognised,
      quoted: value.code.slice(0, PRODUCER_FRAGMENT_MAX),
      truncated: false,
    };
  }
  if (isProducerQuote(value)) {
    return { prose: unrecognised, quoted: value.quoted, truncated: value.truncated === true };
  }
  return { prose: absent, quoted: null, truncated: false };
}

// ── The manifest ─────────────────────────────────────────────────────────────
//
// Every path at which a string may appear in an accepted block, and what it may
// be. Paths are the projected camelCase shape with `[]` for array elements. The
// gate walks the block and looks every string leaf up here; a leaf with no entry
// refuses the block.

export const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,95}$/;
export const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/;

/** Never printed. See IDENTIFIER_SETS for why this is all `token` became. */
const OPAQUE = "opaque";
const TS = "timestamp";
const CAVEAT = "caveat";

/** A printed identifier from the named closed set. */
const id = (set) => `id:${set}`;

const stateBarPaths = (prefix) => ({
  [`${prefix}.openUtc`]: TS,
  [`${prefix}.closeUtc`]: TS,
});

const frozenLegPaths = (prefix) => ({
  [`${prefix}.label`]: id("frozenLabel"),
  [`${prefix}.parameters[].name`]: id("frozenParameter"),
  [`${prefix}.parameters[].value`]: id("frozenValue"),
});

/** The block's own declaration of every bounded set, as manifest paths. */
const vocabularyPaths = () => {
  const paths = { "vocabulary.source": "enum:vocabularySource" };
  for (const [name, set] of Object.entries(IDENTIFIER_SETS)) {
    if (set.bounded) paths[`vocabulary.${name}[]`] = `member:${name}`;
  }
  return paths;
};

export const OSCILLATOR_STRING_MANIFEST = {
  // ── run identity ──
  generatedAt: TS,
  runId: id("runId"),
  evaluatorVersion: OPAQUE,
  evidenceWindowEndsUtc: TS,
  /** N5 residual: the digest of this projection's own content. */
  projectionSha256: OPAQUE,
  historyOrder: "enum:historyOrder",

  // ── the block's own declaration of every printed closed set ──
  //
  // Derived from the frozen registry by the projection, carried in the block
  // so the server and the client - which never see the registry document -
  // check membership against the same set the build-time projection did.
  ...vocabularyPaths(),

  // ── the caveat, verbatim from the tracker ──
  purpose: CAVEAT,
  "knownLimitations[]": CAVEAT,

  // ── registry, runtime, protocol, ledger ──
  "registry.registryId": id("registryId"),
  "registry.sha256": OPAQUE,
  "registry.selectionRule": CAVEAT,
  "runtime.python": id("version"),
  "runtime.numpy": id("version"),
  "runtime.pandas": id("version"),
  "runtime.ta": id("version"),
  "runtime.frozenProtocolRuntime.python": id("version"),
  "runtime.frozenProtocolRuntime.numpy": id("version"),
  "runtime.frozenProtocolRuntime.pandas": id("version"),
  "runtime.frozenProtocolRuntime.ta": id("version"),
  "protocol.exits.oppositeSignal": CAVEAT,
  "protocol.retrospectiveConfirmation": CAVEAT,
  "protocol.selection": CAVEAT,
  "ledger.directory": OPAQUE,
  "ledger.firstBarUtc": TS,
  "ledger.lastBarUtc": TS,
  "ledger.policy": CAVEAT,
  "ledger.expectedRecordsPerMonthBasis": CAVEAT,

  // ── the roster ──
  "cells[].watchId": OPAQUE,
  "cells[].asset": id("asset"),
  "cells[].oscillator": id("oscillator"),
  "cells[].indicatorClass": OPAQUE,
  "cells[].timeframe": id("timeframe"),
  "cells[].exitFamily": id("exitFamily"),
  "cells[].status": "enum:cellStatus",
  "cells[].cellFingerprint": OPAQUE,
  "cells[].deferred.reason": CAVEAT,
  "cells[].availability.status": OPAQUE,
  "cells[].availability.lastSuccessfulEvaluationUtc": TS,
  "cells[].availability.detail": CAVEAT,
  "cells[].warmup.source": OPAQUE,
  ...stateBarPaths("cells[].stateBar"),
  "cells[].oscillatorState.fastLabel": id("frozenLabel"),
  "cells[].oscillatorState.slowLabel": id("frozenLabel"),
  "cells[].oscillatorState.relation": OPAQUE,
  "cells[].divergenceArmed.bullish.confirmationBarUtc": TS,
  "cells[].divergenceArmed.bearish.confirmationBarUtc": TS,
  "cells[].position.direction": "enum:direction",
  "cells[].position.signalId": OPAQUE,
  "cells[].position.signalBarOpenUtc": TS,
  "cells[].position.entryBarOpenUtc": TS,
  "cells[].position.evaluatorClass": OPAQUE,
  "cells[].pendingEntry.direction": "enum:direction",
  "cells[].pendingEntry.signalId": OPAQUE,
  "cells[].pendingEntry.signalBarOpenUtc": TS,
  "cells[].pendingEntry.earliestPossibleEntryBarOpenUtc": TS,
  "cells[].lifecycle.replayStartPolicy": OPAQUE,
  "cells[].lifecycle.replayStartPolicyDefault": OPAQUE,
  "cells[].lifecycle.termination.reason": "coded:terminationReason",
  "cells[].lifecycle.termination.exitBarUtc": TS,
  "cells[].lifecycle.termination.exitReason": "coded:exitReason",
  "cells[].lifecycle.termination.detail": CAVEAT,
  "cells[].finalBucket.bucketOpenUtc": TS,
  "cells[].finalBucket.bucketCloseUtc": TS,
  "cells[].finalBucket.directionsWithheld[]": "enum:direction",
  "cells[].knownLimitations[]": CAVEAT,
  "cells[].evidence.holdout.note": CAVEAT,
  "cells[].evidence.retrospectiveConfirmation.note": CAVEAT,
  "cells[].evidence.qualityStatus": OPAQUE,
  ...frozenLegPaths("cells[].frozen.fast"),
  ...frozenLegPaths("cells[].frozen.slow"),
  "cells[].frozen.polarity": OPAQUE,
  "cells[].frozen.primaryOutput": OPAQUE,
  "cells[].frozen.divergence.computedOn": id("divergenceInput"),
  "cells[].frozen.divergence.note": CAVEAT,
  "cells[].provenance.campaignId": OPAQUE,
  "cells[].provenance.cellArtifactPath": OPAQUE,

  // ── the live lane ──
  "activeSignals[].watchId": OPAQUE,
  "activeSignals[].asset": id("asset"),
  "activeSignals[].oscillator": id("oscillator"),
  "activeSignals[].timeframe": id("timeframe"),
  "activeSignals[].exitFamily": id("exitFamily"),
  "activeSignals[].status": "enum:cellStatus",
  "activeSignals[].direction": "enum:direction",
  "activeSignals[].uiLabel": "enum:uiLabel",
  "activeSignals[].signalId": OPAQUE,
  "activeSignals[].signalBarOpenUtc": TS,
  "activeSignals[].entryBarOpenUtc": TS,
  ...stateBarPaths("activeSignals[].stateBar"),
  "pendingEntries[].watchId": OPAQUE,
  "pendingEntries[].asset": id("asset"),
  "pendingEntries[].oscillator": id("oscillator"),
  "pendingEntries[].timeframe": id("timeframe"),
  "pendingEntries[].exitFamily": id("exitFamily"),
  "pendingEntries[].direction": "enum:direction",
  "pendingEntries[].uiLabel": "enum:uiLabel",
  "pendingEntries[].signalId": OPAQUE,
  "pendingEntries[].signalBarOpenUtc": TS,
  "pendingEntries[].entryBarOpenUtc": TS,

  // ── the ledger lane ──
  "history[].recordId": OPAQUE,
  "history[].recordType": "enum:recordType",
  "history[].signalId": OPAQUE,
  "history[].watchId": OPAQUE,
  "history[].asset": id("asset"),
  "history[].oscillator": id("oscillator"),
  "history[].timeframe": id("timeframe"),
  "history[].exitFamily": id("exitFamily"),
  "history[].emittedAtUtc": TS,
  "history[].contextSha256": OPAQUE,
  "history[].direction": "enum:direction",
  "history[].uiLabel": "enum:uiLabel",
  ...stateBarPaths("history[].signalBar"),
  "history[].divergenceEvent.kind": OPAQUE,
  "history[].divergenceEvent.confirmationBarUtc": TS,
  "history[].priceReference.quote": OPAQUE,
  "history[].priceReference.intendedEntry.rule": "coded:entryRule",
  "history[].priceReference.intendedEntry.state": "enum:intendedEntryState",
  "history[].priceReference.intendedEntry.entryBarOpenUtc": TS,
  "history[].priceReference.intendedEntry.notTakenReason": "coded:notTakenReason",
  "history[].priceReference.intendedEntry.earliestPossibleEntryBarOpenUtc": TS,
  "history[].priceReference.intendedEntry.fillRecordId": OPAQUE,
  "history[].dataSource.provider": CAVEAT,
  "history[].dataSource.lastBaseBarCloseUtc": TS,
  "history[].entryBarOpenUtc": TS,
  "history[].exitBarUtc": TS,
  "history[].exitReason": "coded:exitReason",
  "history[].evaluatorClass": OPAQUE,
  "history[].transition": "coded:outageTransition",
  "history[].fromUtc": TS,
  "history[].toUtc": TS,
  "history[].reason": "coded:outageReason",
  "history[].detail": CAVEAT,
};

/**
 * Why this value may not appear at this path, or null when it may.
 *
 * @param {string} path normalised, `[]` for array elements
 * @param {unknown} value
 * @param {unknown} vocabulary the block's own `vocabulary`, for `id:` paths
 * @returns {string | null}
 */
export function classifyOscillatorValue(path, value, vocabulary = null) {
  const declared = Object.hasOwn(OSCILLATOR_STRING_MANIFEST, path)
    ? OSCILLATOR_STRING_MANIFEST[path]
    : null;
  if (declared == null) {
    return `${path} carries producer text that nothing classifies — add it to ` +
      "OSCILLATOR_STRING_MANIFEST as an opaque identifier, a printed id:<set>, a " +
      "timestamp, an enum, a coded value or a fragment";
  }
  if (declared === "token") {
    // The verdict itself was the defect. It is refused rather than deleted so a
    // manifest entry left behind by a merge fails loudly instead of falling
    // through to "unknown manifest class".
    return `${path} is classified "token", which is no longer a verdict — a value that ` +
      "is never printed is `opaque`, and a value that IS printed is id:<set> or a fragment";
  }
  if (declared === "opaque") {
    if (typeof value !== "string") {
      return `${path} must be a bare opaque identifier, not ${typeof value}`;
    }
    if (!TOKEN_PATTERN.test(value)) {
      return `${path} is not an identifier: ${JSON.stringify(value.slice(0, 60))}`;
    }
    return null;
  }
  if (declared.startsWith("id:")) {
    const name = declared.slice("id:".length);
    if (typeof value === "string") {
      if (isIdentifierMember(name, value, vocabulary)) return null;
      // The N7 shape: a printed identifier the interface cannot place, arriving
      // bare. The projection demotes one of these to a quotation before the
      // block is built, so reaching here means a republished feed skipped that
      // step - and a bare string in a printed position is exactly what this
      // manifest exists to refuse.
      const set = Object.hasOwn(IDENTIFIER_SETS, name) ? IDENTIFIER_SETS[name] : null;
      if (set == null) return `${path} names the unknown closed set ${JSON.stringify(name)}`;
      return `${path} states ${JSON.stringify(value.slice(0, 60))}, which is not a member of ` +
        `the ${name} set — an identifier this interface cannot place must be demoted to a ` +
        "quoted fragment with producerIdentifier(), never printed bare";
    }
    if (isProducerQuote(value, PRODUCER_FRAGMENT_MAX)) return null;
    return `${path} is neither a ${name} identifier nor a quoted fragment`;
  }
  if (declared.startsWith("member:")) {
    const name = declared.slice("member:".length);
    const set = Object.hasOwn(IDENTIFIER_SETS, name) ? IDENTIFIER_SETS[name] : null;
    if (set == null) return `${path} declares the unknown closed set ${JSON.stringify(name)}`;
    if (typeof value !== "string") {
      return `${path} declares a ${name} that is not a string`;
    }
    if (!set.pattern.test(value)) {
      return `${path} declares ${JSON.stringify(value.slice(0, 60))}, which is not a ${name}`;
    }
    return null;
  }
  if (declared === "timestamp") {
    if (typeof value !== "string") return `${path} must be a bare timestamp, not ${typeof value}`;
    if (!TIMESTAMP_PATTERN.test(value)) {
      return `${path} is not a timestamp: ${JSON.stringify(value.slice(0, 60))}`;
    }
    return null;
  }
  if (declared.startsWith("enum:")) {
    const name = declared.slice("enum:".length);
    if (!inEnum(name, value)) {
      return `${path} is outside the ${name} set: ${JSON.stringify(
        typeof value === "string" ? value.slice(0, 60) : (value ?? null),
      )}`;
    }
    return null;
  }
  if (declared.startsWith("coded:")) {
    const name = declared.slice("coded:".length);
    if (typeof value === "string") {
      // The N6 shape exactly: prose arriving where a code belongs.
      return `${path} is a bare string where a coded value belongs — ` +
        `wrap it with producerCoded(value, ${JSON.stringify(name)})`;
    }
    if (isProducerCode(value)) {
      const entries = VOCABULARIES[name];
      if (entries == null || !Object.hasOwn(entries, value.code)) {
        return `${path} states code ${JSON.stringify(value.code)}, which is not in the ` +
          `${name} vocabulary — an unknown code must be demoted to a quoted fragment`;
      }
      return null;
    }
    if (isProducerQuote(value, PRODUCER_FRAGMENT_MAX)) return null;
    return `${path} is neither a ${name} code nor a quoted fragment`;
  }
  if (declared === "fragment" || declared === "caveat") {
    if (typeof value === "string") {
      return `${path} is a bare producer string — wrap it with producerFragment(value)`;
    }
    const max = declared === "caveat" ? PRODUCER_CAVEAT_MAX : PRODUCER_FRAGMENT_MAX;
    if (!isProducerQuote(value, max)) {
      return `${path} is not a quoted producer fragment of at most ${max} characters`;
    }
    return null;
  }
  return `${path} has an unknown manifest class ${JSON.stringify(declared)}`;
}

/**
 * Walk a projected block and classify every producer value in it.
 *
 * This is the whole of Invariant A. It does not look for a list of fields; it
 * looks at WHAT IS THERE. A string the manifest does not place, at any depth,
 * refuses the block — so the next field added to the projection, and the one
 * after that, fail closed rather than reaching a `<strong>`.
 *
 * @param {unknown} block
 * @returns {string | null}
 */
export function oscillatorProducerTextViolation(block) {
  // The declared vocabulary is read FIRST, because every printed identifier in
  // the walk below is checked against it. A block that declares no vocabulary,
  // or one whose declared members are not identifiers, is refused here rather
  // than walked: there is nothing to check membership against.
  const vocabulary =
    block != null && typeof block === "object" && !Array.isArray(block)
      ? block.vocabulary
      : null;
  const declaration = identifierVocabularyViolation(vocabulary);
  if (declaration != null) return declaration;

  let violation = null;
  const visit = (value, path) => {
    if (violation != null) return;
    if (value == null || typeof value === "number" || typeof value === "boolean") return;
    if (typeof value === "string" || isProducerValue(value)) {
      violation = classifyOscillatorValue(path, value, vocabulary);
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
      return;
    }
    violation = `${path} holds a ${typeof value}, which this block may not carry`;
  };
  visit(block, "");
  return violation;
}
