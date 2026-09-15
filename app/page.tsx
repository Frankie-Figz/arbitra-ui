"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import snapshotJson from "../public/data/arbitra-snapshot.json";
import {
  describeOscillatorUnavailable,
  oscillatorWatchHonestyViolation,
} from "../scripts/oscillator-honesty.mjs";
import { describeCoded, describeIdentifier } from "../scripts/oscillator-vocabulary.mjs";

type CompanyProfile = {
  symbol: string;
  longName: string;
  description: string;
  employees: number | null;
  city: string | null;
  state: string | null;
  country: string | null;
  sector: string | null;
  industry: string | null;
  website: string | null;
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  available: boolean;
};

type Asset = {
  symbol: string;
  name: string;
  instrumentFamily: string;
  exchange: string;
  signalDate: string;
  close: number | null;
  ppo: number | null;
  ppoPriorMedian: number | null;
  atr10Percent: number | null;
  atr10ThresholdPercent: number | null;
  atr10Pass: boolean;
  bb40Width: number | null;
  bb40Threshold: number | null;
  bb40Pass: boolean;
  ema20DistancePercent: number | null;
  ema20ThresholdPercent: number | null;
  ema20Pass: boolean;
  ema5: number | null;
  ema10: number | null;
  ema20: number | null;
  ema50: number | null;
  emaBullStack: boolean;
  launchWatch: boolean;
};

type Dataset = {
  date: string;
  generatedAt: string;
  sourceRun: string;
  universe: number;
  exactDateAnalyzed: number;
  staleAnalyzed: number;
  historyMissing: number;
  analysisFailed: number;
  qualityRejected: number;
  assets: Asset[];
};

type CryptoOrder = {
  pushPercent: number | null;
  targetPercent: number | null;
  limitPrice: number | null;
  plannedEntryPrice: number | null;
  plannedExitPrice: number | null;
  orderState: string;
  barsRemainingToFill: number | null;
  entryPrice: number | null;
  targetPrice: number | null;
  barsRemainingToTarget: number | null;
};

type RsiCandidate = {
  setupId: string;
  researchStatus: string;
  eligibleForActiveOutput: boolean;
  instrumentId: string;
  baseAsset: string;
  quoteCurrency: string;
  insideOriginalSevenAssets: boolean;
  timeframe: string;
  rsiPeriod: number | null;
  emaFast: number | null;
  emaSlow: number | null;
  signalAvailableAt: string;
  signalClose: number | null;
  latestClose: number | null;
  barsSinceSignal: number | null;
  rsiAtConfirmation: number | null;
  emaFastValue: number | null;
  emaSlowValue: number | null;
  emaSpreadChange: number | null;
  divergencePriorRsi: number | null;
  divergenceCurrentRsi: number | null;
  divergenceBarsBetweenPivots: number | null;
  godmodeAddOnMet: boolean;
  godmodeAddOnRule: string;
  godmodeAddOnLookbackHours: number | null;
  godmodeAddOnSignalAvailableAt: string | null;
  godmodeAddOnWt0: number | null;
  godmodeAddOnWt1: number | null;
  godmodeAddOnPreviousWt1: number | null;
  godmodeAddOnSlope: number | null;
  suggestedSetupEligible: boolean;
  tradabilityReady: boolean;
  tradabilityPass: boolean;
  tradabilityReasons: string[];
  priorMedianDollarVolume20: number | null;
  priorZeroVolumeBars20: number | null;
  signalRangeFraction: number | null;
  signalVolumeMultiple20: number | null;
  orders: CryptoOrder[];
};

type GodmodeOpportunity = {
  instrumentId: string;
  baseAsset: string;
  quoteCurrency: string;
  timeframe: string;
  researchStatus: string;
  deploymentAllowed: boolean;
  direction: "long" | "short";
  signalAvailableAt: string;
  barsSinceSignal: number | null;
  close: number | null;
  wt0: number | null;
  wt1: number | null;
  previousWt1: number | null;
  wt2: number | null;
  slope: number | null;
  regimeCode: number | null;
  extremityLevel: number | null;
  extremeCurrentOrPrior: boolean;
};

type CryptoSnapshot = {
  schemaVersion: number;
  generatedAt: string;
  sourceRun: string;
  venue: string;
  marketType: string;
  universeRule: string;
  deploymentAllowed: boolean;
  capitalAuthority: boolean;
  cryptoTradabilityGateEnabled: boolean;
  historyWindowHours: number;
  universe: {
    live: number;
    considered: number;
    usableHistory: number;
    usableGodmode: number;
    qualityRejected: number;
    godmodeRejected: number;
  };
  rsi: {
    setup: {
      setupId: string;
      timeframe: string;
      rsiPeriod: number;
      emaFast: number;
      emaSlow: number;
      researchStatus: string;
    } | null;
    activeSignals: RsiCandidate[];
    recentCandidates: RsiCandidate[];
    history: RsiCandidate[];
  };
  godmodeAddOn: {
    direction: string;
    rule: string;
    lookbackCompletedHours: number;
    requiredForParentRsiSetup: boolean;
    suggestedSetupRequiresAddOn: boolean;
  };
  suggestedTradeSetup: {
    direction: string;
    pushPercent: number;
    targetPercentBelowFill: number;
    entryWindowCompletedSetupBars: number;
    targetWindowCompletedSetupBarsAfterFill: number;
    stop: string;
    orderAuthority: boolean;
    tradabilityQualityGateRequired: boolean;
  };
  godmode: {
    timeframe: string;
    rule: string;
    researchStatus: string;
    warning: string;
    current: GodmodeOpportunity[];
    recent: GodmodeOpportunity[];
  };
};

type EtfOpportunity = {
  symbol: string;
  name: string;
  evidenceRole: string;
  signalTime: string;
  signalClose: number | null;
  wt0: number | null;
  wt1: number | null;
  previousWt1: number | null;
  slope: number | null;
  extremity: number | null;
  mfi14: number | null;
  previousMfi14: number | null;
  mfiAddOnAvailable: boolean;
  mfiAddOnMet: boolean;
  orderState: string;
  active: boolean;
  entryPrice: number | null;
  targetPrice: number | null;
  actualExitPrice: number | null;
  entryTime: string | null;
  exitTime: string | null;
  barsRemaining: number | null;
  targetHit: boolean;
};

type EtfLatestState = {
  symbol: string;
  name: string;
  evidenceRole: string;
  candleTime: string;
  close: number | null;
  wt0: number | null;
  wt1: number | null;
  previousWt1: number | null;
  slope: number | null;
  extremity: number | null;
  mfi14: number | null;
  previousMfi14: number | null;
  mfiAddOnAvailable: boolean;
  mfi14Rising: boolean;
  confirmedLongTransition: boolean;
};

type EtfSnapshot = {
  schemaVersion: number;
  generatedAt: string;
  sourceRun: string;
  completedCandleDates: string[];
  universeId: string;
  universeSymbols: number;
  usableHistory: number;
  basicDataIntegrityFailures: number;
  downloadOrAnalysisFailures: number;
  historyWindowSessions: number;
  etfProspectiveTradabilityGateEnabled: boolean;
  basicCandleIntegrityGateEnabled: boolean;
  mfiAddOnRequiredForParentSignal: boolean;
  deploymentAllowed: boolean;
  capitalAuthority: boolean;
  opportunities: EtfOpportunity[];
  active: EtfOpportunity[];
  latestStates: EtfLatestState[];
  totals: {
    recent: number;
    mfiAddOnMet: number;
    mfiAddOnNotMet: number;
    active: number;
    targetHits: number;
  };
  referenceOutcome: {
    entry: string;
    horizonCandles: number;
    barrierBps: number;
    modeledStop: string | null;
    interpretation: string;
  };
  evidence: {
    parentBarrierEdgePercentagePoints: number;
    parentMeanNetReturn: number;
    mfiBarrierChangePercentagePoints: number;
    mfiMeanNetReturnChangePercentagePoints: number;
    warning: string;
  };
  suggestedTradeSetup: {
    symbol: string;
    signalTime: string;
    state: string;
    entryPrice: number | null;
    exitPrice: number | null;
    entryRule: string;
    exitRule: string;
    modeledStop: string | null;
    orderAuthority: boolean;
  } | null;
};

type XgbModel = {
  id: string;
  name: string;
  title: string;
  status: string;
  crown: string;
  evidenceClass: string;
  objective: string;
  macroF1: number | null;
  balancedAccuracy: number | null;
  accuracy: number | null;
  innerBalancedAccuracy: number | null;
  candidatePolicy: string;
  trainingRows?: number;
  trainingCutoff?: string;
  composition: string[];
  runId: string | null;
  registeredVersion: number | null;
  caution: string;
  evidencePath: string;
};

type XgbShowcaseSnapshot = {
  schemaVersion: number;
  evidenceAsOf: string;
  deploymentAllowed: boolean;
  capitalAuthority: boolean;
  comparisonHoldout: {
    rows: number;
    start: string;
    end: string;
    longLabels: number;
    shortLabels: number;
  };
  models: XgbModel[];
  futureWatch: XgbModel;
  exclusions: string[];
};

// ── Oscillator alpha watch ────────────────────────────────────────────────────
// Projection of the Arbitra oscillator-alpha-watch tracker (scripts/oscillator-watch.mjs).
// Enum-like fields stay `string`: the shared gate in scripts/oscillator-honesty.mjs
// is the enforcement point, and a degraded status must reach the roster as itself
// rather than be normalised into "flat" by the type. What the gate will not admit
// is a status OUTSIDE the enum — that refuses the whole block, because the status
// is a printed headline rather than an internal routing value (N2).
/**
 * INVARIANT A, stated in the type system.
 *
 * A producer value in claim position is NOT a string on this side of the wire.
 * It is one of these two objects, and an object is not a ReactNode - so
 * {record.reason} and {record.detail} are COMPILE ERRORS rather than the
 * echoing fall-through that produced N6. The only way to put one of these on the
 * page is to pass it through <ProducerQuoted> or <CodedPhrase> below, both of
 * which write this interface own prose and quote the producer value as a value.
 * There is no third path, and adding a field cannot create one: an unwrapped
 * producer string never reaches here, because the shared gate refuses a block
 * that carries one (scripts/oscillator-vocabulary.mjs).
 */
type ProducerQuote = { quoted: string; truncated?: true };
type ProducerCoded = { code: string } | ProducerQuote;
/**
 * A PRINTED identifier. Either a member of a closed set the block declares and
 * the frozen registry supplied, or - for anything outside it - a quoted
 * fragment. There is no third case, and in particular there is no case in which
 * an identifier this interface cannot place is printed bare.
 *
 * The member case is a plain string because the gate has already checked it
 * against that set, which is what `enum:` has always done for `status` and
 * `direction`. `token` used to be the third case, and it was the hole:
 * `[A-Za-z0-9._:+/-]{0,95}` holds CAPITAL-AUTHORITY-GRANTED comfortably.
 */
type ProducerIdentifierValue = string | ProducerQuote;

type OscillatorFrozenLeg = {
  label: ProducerIdentifierValue | null;
  rank: number | null;
  parameters: { name: ProducerIdentifierValue; value: number | ProducerIdentifierValue }[];
};

type OscillatorFrozen = {
  fast: OscillatorFrozenLeg | null;
  slow: OscillatorFrozenLeg | null;
  polarity: string | null;
  primaryOutput: string | null;
  divergence: {
    computedOn: ProducerIdentifierValue | null;
    maxEventAgeBars: number | null;
    pivotLeft: number | null;
    pivotRight: number | null;
    maxDivergenceBars: number | null;
    note: ProducerQuote | null;
  };
  candidatesSearchedInCell: number | null;
};

type OscillatorStateBar = {
  openUtc: string | null;
  closeUtc: string | null;
  close: number | null;
  completeBucket: boolean | null;
  coverage: number | null;
  trailingMissing: number | null;
};

type OscillatorDivergenceLeg = {
  armed: boolean;
  confirmationBarUtc: string | null;
  ageBars: number | null;
  expiresAfterBars: number | null;
};

type OscillatorEvidenceLeg = {
  trades: number | null;
  netReturn: number | null;
  profitFactor: number | null;
  note: ProducerQuote | null;
};

type OscillatorCell = {
  watchId: string;
  asset: ProducerIdentifierValue | null;
  oscillator: ProducerIdentifierValue | null;
  indicatorClass: string | null;
  timeframe: ProducerIdentifierValue | null;
  exitFamily: ProducerIdentifierValue | null;
  status: string;
  cellFingerprint: string | null;
  evaluatedThisRun: boolean;
  deferred: { isDeferred: boolean; reason: ProducerQuote | null };
  availability: {
    status: string | null;
    lastSuccessfulEvaluationUtc: string | null;
    consecutiveFailedRuns: number;
    detail: ProducerQuote | null;
  };
  warmup: {
    effectiveBarsRequired: number | null;
    registryBarsRequired: number | null;
    adapterBarsComputed: number | null;
    source: string | null;
    satisfied: boolean;
  };
  barsAvailable: number | null;
  stateBar: OscillatorStateBar | null;
  oscillatorState: {
    fastLabel: ProducerIdentifierValue | null;
    slowLabel: ProducerIdentifierValue | null;
    fastValue: number | null;
    slowValue: number | null;
    spread: number | null;
    relation: string | null;
    atr: number | null;
  } | null;
  divergenceArmed: {
    bullish: OscillatorDivergenceLeg;
    bearish: OscillatorDivergenceLeg;
    parityAssertionPassed: boolean | null;
  } | null;
  position: {
    direction: string | null;
    signalId: string | null;
    signalBarOpenUtc: string | null;
    entryBarOpenUtc: string | null;
    entryPrice: number | null;
    barsHeld: number | null;
    evaluatorClass: string | null;
    atrAtSignal: number | null;
    stopPrice: number | null;
    targetPrice: number | null;
    maximumHoldingBars: number | null;
    unrealisedGrossReturn: number | null;
  } | null;
  pendingEntry: {
    direction: string | null;
    signalId: string | null;
    signalBarOpenUtc: string | null;
    earliestPossibleEntryBarOpenUtc: string | null;
  } | null;
  lifecycle: {
    replayStartPolicy: string | null;
    replayStartPolicyDefault: string | null;
    barsReplayed: number | null;
    tradesReturned: number | null;
    bankruptTrades: number | null;
    terminated: boolean;
    termination: {
      reason: ProducerCoded | null;
      exitBarUtc: string | null;
      exitPrice: number | null;
      exitReason: ProducerCoded | null;
      netReturnAfterFrozenFriction: number | null;
      tradesBeforeTermination: number | null;
      unevaluatedBars: number | null;
      unevaluatedEntryPulses: number | null;
      detail: ProducerQuote | null;
    } | null;
    predictedDeclined: number | null;
    predictedDeclinedButFrozenFilled: number | null;
  } | null;
  finalBucket: {
    bucketOpenUtc: string | null;
    bucketCloseUtc: string | null;
    truncated: boolean;
    trailingMissing: number | null;
    historicallyComplete: boolean;
    provisional: boolean;
    signalsWithheld: number;
    directionsWithheld: string[];
    bucketOfWeekCompleteRate: number | null;
  } | null;
  /** Verbatim per-cell echo of the registry caveat. Never empty: the projection
   *  refuses the whole block rather than surface a cell without it. */
  knownLimitations: ProducerQuote[];
  evidence: {
    holdout: OscillatorEvidenceLeg | null;
    retrospectiveConfirmation: OscillatorEvidenceLeg | null;
    qualityStatus: string | null;
  };
  frozen: OscillatorFrozen | null;
  provenance: { campaignId: string | null; cellArtifactPath: string | null };
};

type OscillatorActiveSignal = {
  watchId: string;
  asset: ProducerIdentifierValue | null;
  /** Joined from the roster cell. The watch id is a join key, not a caption. */
  oscillator: ProducerIdentifierValue | null;
  timeframe: ProducerIdentifierValue | null;
  exitFamily: ProducerIdentifierValue | null;
  status: string | null;
  direction: string | null;
  /** Presentation label only. Carries no instruction. */
  uiLabel: string | null;
  signalId: string | null;
  signalBarOpenUtc: string | null;
  entryBarOpenUtc: string | null;
  entryPrice: number | null;
  barsHeld: number | null;
  unrealisedGrossReturn: number | null;
  stateBar: OscillatorStateBar | null;
  trackingOnly: boolean;
  orderAuthority: boolean;
};

type OscillatorPendingEntry = {
  watchId: string;
  asset: ProducerIdentifierValue | null;
  oscillator: ProducerIdentifierValue | null;
  timeframe: ProducerIdentifierValue | null;
  exitFamily: ProducerIdentifierValue | null;
  direction: string | null;
  uiLabel: string | null;
  signalId: string | null;
  signalBarOpenUtc: string | null;
  entryBarOpenUtc: string | null;
  trackingOnly: boolean;
  orderAuthority: boolean;
};

type OscillatorRecord = {
  recordId: string;
  recordType: string;
  signalId: string | null;
  watchId: string;
  asset: ProducerIdentifierValue | null;
  oscillator: ProducerIdentifierValue | null;
  timeframe: ProducerIdentifierValue | null;
  exitFamily: ProducerIdentifierValue | null;
  emittedAtUtc: string;
  afterEvidenceWindow: boolean;
  contextSha256: string | null;
  /** From the record's own honesty block. A record revoking either refuses the whole block. */
  trackingOnly: boolean;
  orderAuthority: boolean;
  direction?: string | null;
  uiLabel?: string | null;
  signalBar?: {
    openUtc: string | null;
    closeUtc: string | null;
    close: number | null;
    coverage: number | null;
    completeBucket: boolean | null;
    trailingMissing: number | null;
  } | null;
  oscillatorState?: {
    fastValue: number | null;
    slowValue: number | null;
    spread: number | null;
    atr: number | null;
  } | null;
  divergenceEvent?: {
    kind: string | null;
    confirmationBarUtc: string | null;
    ageBars: number | null;
    maxEventAgeBars: number | null;
  } | null;
  priceReference?: {
    value: number | null;
    quote: string | null;
    intendedEntry: {
      /** The frozen entry rule, carried from the producer rather than asserted here. */
      rule: ProducerCoded | null;
      /** "not_taken" is a pulse the frozen evaluator declined. It is never a fill. */
      state: string | null;
      entryBarOpenUtc: string | null;
      notTakenReason: ProducerCoded | null;
      earliestPossibleEntryBarOpenUtc: string | null;
      fillRecordId: string | null;
    };
  } | null;
  dataSource?: {
    provider: ProducerQuote | null;
    baseIntervalMinutes: number | null;
    lastBaseBarCloseUtc: string | null;
    completeRequired: boolean;
  } | null;
  entryBarOpenUtc?: string | null;
  entryPrice?: number | null;
  exitBarUtc?: string | null;
  exitPrice?: number | null;
  exitReason?: ProducerCoded | null;
  barsHeld?: number | null;
  grossReturn?: number | null;
  netReturnAfterFrozenFriction?: number | null;
  evaluatorClass?: string | null;
  transition?: ProducerCoded | null;
  fromUtc?: string | null;
  toUtc?: string | null;
  reason?: ProducerCoded | null;
  detail?: ProducerQuote | null;
  barsMissed?: number | null;
};

type OscillatorWatchSnapshot = {
  available: true;
  schemaVersion: number;
  producerSchemaVersion: number;
  generatedAt: string | null;
  runId: ProducerIdentifierValue | null;
  evaluatorVersion: string | null;
  trackingOnly: boolean;
  deploymentAllowed: boolean;
  capitalAuthority: boolean;
  orderAuthority: boolean;
  notEstablishedAsDistinguishableFromSearchNoise: boolean;
  purpose: ProducerQuote;
  knownLimitations: ProducerQuote[];
  evidenceWindowEndsUtc: string | null;
  /**
   * The closed sets this block may print an identifier from, derived by the
   * projection from the frozen registry (or, with no registry document beside
   * the tracker, from the block's own roster - which is what `source` says).
   * Carried in the block because the ingest server and this client never see
   * the registry document and still have to check membership against the set
   * the build-time projection used.
   */
  vocabulary: {
    source: string;
    asset: string[];
    timeframe: string[];
    oscillator: string[];
    exitFamily: string[];
    frozenLabel: string[];
    frozenParameter: string[];
    frozenValue: string[];
    divergenceInput: string[];
    registryId: string[];
  };
  registry: {
    registryId: ProducerIdentifierValue | null;
    sha256: string | null;
    selectionRule: ProducerQuote | null;
    cellsTotal: number;
    cellsActive: number;
    cellsDeferred: number;
  };
  runtime: {
    python: ProducerIdentifierValue | null;
    numpy: ProducerIdentifierValue | null;
    pandas: ProducerIdentifierValue | null;
    ta: ProducerIdentifierValue | null;
    matchesFrozenProtocol: boolean;
    frozenProtocolRuntime: {
      python: ProducerIdentifierValue | null;
      numpy: ProducerIdentifierValue | null;
      pandas: ProducerIdentifierValue | null;
      ta: ProducerIdentifierValue | null;
    } | null;
  };
  parity: {
    frozenFiles: number;
    reimplementedLogic: number;
    assertionsChecked: number;
    assertionsPassed: number;
    assertionsFailed: number;
  };
  protocol: {
    exits: {
      atr: {
        atrPeriod: number | null;
        maximumHoldingBars: number | null;
        stopAtr: number | null;
        targetAtr: number | null;
      };
      oppositeSignal: ProducerQuote | null;
    };
    friction: {
      feeBpsRoundTrip: number | null;
      slippageBpsRoundTrip: number | null;
      totalBpsRoundTrip: number | null;
      appliedToRecordedPrices: boolean;
    };
    retrospectiveConfirmation: ProducerQuote | null;
    selection: ProducerQuote | null;
  } | null;
  ledger: {
    directory: string | null;
    totalRecords: number;
    partitions: number;
    partitionsRead: number;
    linesUnreadable: number;
    firstBarUtc: string | null;
    lastBarUtc: string | null;
    policy: ProducerQuote | null;
    expectedRecordsPerMonth: number | null;
    expectedRecordsPerMonthBasis: ProducerQuote | null;
  };
  counts: {
    cellsTotal: number;
    activeLong: number;
    activeShort: number;
    flat: number;
    insufficientHistory: number;
    sourceUnavailable: number;
    deferred: number;
    lifecycleTerminatedBankrupt: number;
    cellsEvaluated: number;
    signalsThisRun: number;
    fillsThisRun: number;
    exitsThisRun: number;
  };
  cells: OscillatorCell[];
  activeSignals: OscillatorActiveSignal[];
  pendingEntries: OscillatorPendingEntry[];
  history: OscillatorRecord[];
  historyCap: number;
  historyTruncated: boolean;
  historyRecordsAvailable: number;
  /** Records actually merged from the snapshot and the ledger partitions. */
  historyRecordsObserved: number;
  /** The producer own counter, which can lag what the partitions hold. */
  historyRecordsReported: number | null;
  /**
   * N4 residual. The order history is actually in, and the two facts the view
   * needs in order to describe it honestly: how many DISTINCT instants the whole
   * observed ledger carries - one means the ordering is not chronological at all
   * - and how many records of each kind were observed against how many are
   * shown, so a record the cap dropped is visible rather than implied.
   */
  historyOrder: string;
  historyDistinctEmittedAt: number;
  historyKindsObserved: Record<string, number>;
  historyKindsShown: Record<string, number>;
  /** Digest of this projection content. See scripts/check-oscillator-bundle.mjs. */
  projectionSha256?: string;
};

type OscillatorWatchBundle = OscillatorWatchSnapshot | { available: false; reason: string };

type Snapshot = {
  schemaVersion: number;
  generatedAt: string;
  source: string;
  deploymentAllowed: boolean;
  datasets: Dataset[];
  profiles: Record<string, CompanyProfile>;
  stockSelector: {
    schemaVersion: number;
    status: string;
    provider: string;
    dataThrough: string;
    generatedAt: string;
    sourceRun: string;
    ruleId: string;
    universe: number;
    analyzed: number;
    stale: number;
    historyMissing: number;
    analysisFailed: number;
    qualityRejected: number;
    opportunities: number;
    deploymentAllowed: boolean;
    ordersSubmitted: number;
  } | null;
  etf: EtfSnapshot | null;
  crypto: CryptoSnapshot | null;
  /** Optional: absent from snapshots produced before the tracker existed. */
  oscillatorWatch?: OscillatorWatchSnapshot | null;
  history: {
    startDate: string | null;
    endDate: string | null;
    entryWindowCompletedCandles: number;
    targetWindowCompletedCandlesAfterFill: number;
    unfilledTargetMarkWindowCompletedCandles: number;
  };
};

type DataJobArtifact = {
  id: string;
  kind: string;
  label: string;
  sha256: string;
  size: number;
  ticker: string | null;
};

type DataJob = {
  id: string;
  status: "queued" | "running" | "cancel_requested" | "cancelled" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  request: {
    rangeStart: string;
    rangeEnd: string;
    universe: { type: "top_weighted"; limit: number } | { type: "symbols"; symbols: string[] } | { type: "all_constituents" };
  };
  progress: {
    symbolsTotal: number;
    symbolsCompleted: number;
    symbolsFailed: number;
    pagesCompleted: number;
    providerCalls: number;
    rowsWritten: number;
    bytesUploaded: number;
    currentTicker: string;
  };
  artifacts: DataJobArtifact[];
  error: string | null;
};

const bundledSnapshot = snapshotJson as Snapshot;
const bundledTradeDatasets = bundledSnapshot.datasets
  .filter((dataset) => dataset.assets.length > 0)
  .slice(0, 30);

function isSafeRuntimeSnapshot(value: unknown): value is Snapshot {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<Snapshot>;
  return Number.isInteger(candidate.schemaVersion) &&
    (candidate.schemaVersion ?? 0) >= 6 &&
    candidate.deploymentAllowed === false &&
    Array.isArray(candidate.datasets) &&
    candidate.profiles != null && typeof candidate.profiles === "object";
}

/**
 * Either the block, or the reason it may not be shown. Never simply absent: a
 * watch that stopped reporting has to look different from a page that never had
 * the section.
 */
type OscillatorWatchState =
  | { available: true; watch: OscillatorWatchSnapshot }
  | { available: false; prose: string; detail: string | null };

// Refuse rather than degrade. A tracker payload that has lost an honesty flag, a
// cell that has lost its caveat, or a record labelled something other than BUY or
// SELL is not rendered at all: an unlabelled BUY is the one failure mode worth
// failing closed for.
//
// The gate itself is scripts/oscillator-honesty.mjs, the same module the sync and
// the ingest server import. This used to be a hand-written restatement that
// checked twelve top-level fields and nothing inside activeSignals, pendingEntries
// or history, so a runtime publish could put an arbitrary string in the label
// position of a rendered card. Sharing the module is what makes "the client
// re-checks the same set" a fact rather than a claim.
function readOscillatorWatch(value: unknown): OscillatorWatchState {
  const violation = oscillatorWatchHonestyViolation(value);
  if (violation === null) return { available: true, watch: value as OscillatorWatchSnapshot };
  // N3. This used to PREFER the payload's own `reason` string over the guard's,
  // and render it verbatim under "Withheld by the honesty gate" — so a
  // republished snapshot could print "CLEARED FOR CAPITAL DEPLOYMENT · execute
  // the 7 open BUY/SELL observations at market" inside a refusal notice.
  //
  // The words now come from the closed set in the shared gate, chosen by the
  // payload's `reasonCode`; a producer fragment is quoted, never narrated. An
  // unrecognised code yields the generic prose and nothing from the payload.
  // Where the block failed the gate here rather than at build time, the gate's
  // own violation is the detail, because that string is ours.
  const isObjectLike = value != null && typeof value === "object" && !Array.isArray(value);
  const described = describeOscillatorUnavailable(
    isObjectLike && (value as { available?: unknown }).available === false
      ? value
      : { available: false, reasonCode: "gate_violation", detail: violation },
  );
  return { available: false, prose: described.prose, detail: described.detail };
}

const STOCK_ENTRY_PULLBACK_PERCENT = 1;
const STOCK_TARGET_PERCENT = 5;

function formatDate(value: string) {
  if (!value) return "No date selected";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function companyLocation(profile: CompanyProfile) {
  return [profile.city, profile.state, profile.country].filter(Boolean).join(", ") || "Not reported";
}

function price(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  const digits = value < 10 ? 3 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function cryptoPrice(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  const digits = absolute >= 1000 ? 2 : absolute >= 100 ? 3 : absolute >= 1 ? 4 : absolute >= 0.01 ? 6 : absolute >= 0.0001 ? 8 : 10;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Math.min(2, digits),
    maximumFractionDigits: digits,
  }).format(value);
}

function percentage(value: number | null | undefined, digits = 1) {
  return value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
}

function points(value: number | null | undefined, digits = 2) {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function modelMetric(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(4);
}

function formatTimestamp(value: string) {
  if (!value) return "Unavailable";
  const date = new Date(value.replace(" ", "T"));
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function reasonLabel(value: string) {
  const labels: Record<string, string> = {
    low_prior_dollar_volume: "low prior dollar volume",
    prior_zero_volume: "zero-volume bar in lookback",
    signal_range_too_large: "signal candle too large",
    signal_volume_too_low: "signal volume too low",
    reverse_split_within_60_bars: "recent reverse split",
    stale_base_data: "stale base data · not evaluated live",
    source_fetch_failed: "source fetch failed",
    incomplete_bucket_required: "incomplete bucket withheld",
    adapter_unavailable: "adapter unavailable",
    parity_assertion_failed: "parity assertion failed",
    lifecycle_terminated_bankrupt: "lifecycle terminated · bankrupt trade",
    position_already_open: "position already open",
    declined_by_frozen_evaluator: "declined by frozen evaluator",
    not_reporting: "cell is not reporting",
  };
  return labels[value] ?? value.replaceAll("_", " ");
}

function matchingOrder(candidate: RsiCandidate, pushPercent: number, targetPercent: number) {
  return candidate.orders.find(
    (order) =>
      Math.abs((order.pushPercent ?? -1) - pushPercent) < 0.0001 &&
      Math.abs((order.targetPercent ?? -1) - targetPercent) < 0.0001,
  );
}

function orderOutcome(value: string | undefined) {
  const labels: Record<string, string> = {
    waiting_for_upward_limit: "Entry waiting",
    entry_window_expired: "No fill",
    filled_target_pending: "Filled · target pending",
    target_already_hit: "Target hit",
    target_window_expired: "Target not reached",
  };
  return labels[value ?? ""] ?? reasonLabel(value ?? "not available");
}

function etfOrderOutcome(value: string | undefined) {
  const labels: Record<string, string> = {
    awaiting_next_open: "Awaiting next open",
    target_pending: "Entered · target pending",
    target_hit: "Strict +1% target hit",
    horizon_exit: "Two-session horizon exit",
  };
  return labels[value ?? ""] ?? reasonLabel(value ?? "not available");
}
function Gate({
  label,
  value,
  threshold,
  pass,
}: {
  label: string;
  value: string;
  threshold: string;
  pass: boolean;
}) {
  return (
    <div className={`gate ${pass ? "pass" : "miss"}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{pass ? "passes" : "below"} {threshold}</small>
    </div>
  );
}

function stockIndicatorCount(asset: Asset) {
  return 1 + Number(asset.atr10Pass) + Number(asset.bb40Pass) + Number(asset.ema20Pass);
}

function stockSetupLabel(asset: Asset) {
  const confirmations = [
    asset.atr10Pass ? "ATR" : null,
    asset.bb40Pass ? "BB" : null,
    asset.ema20Pass ? "EMA" : null,
  ].filter(Boolean);
  return confirmations.length ? `Parent + ${confirmations.join(" + ")}` : "Parent signal";
}

function StockOpportunityCard({
  asset,
  selected,
  onSelect,
}: {
  asset: Asset;
  selected: boolean;
  onSelect: () => void;
}) {
  const entryPrice = asset.close == null ? null : asset.close * (1 - STOCK_ENTRY_PULLBACK_PERCENT / 100);
  const targetPrice = entryPrice == null ? null : entryPrice * (1 + STOCK_TARGET_PERCENT / 100);
  const lights = [
    { label: "SMC + PPO", lit: true },
    { label: "ATR q70", lit: asset.atr10Pass },
    { label: "BB q80", lit: asset.bb40Pass },
    { label: "EMA q90", lit: asset.ema20Pass },
  ];

  return (
    <button
      className={`stock-opportunity-card ${selected ? "selected" : ""}`}
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${asset.symbol}, ${stockIndicatorCount(asset)} of 4 indicators lit, open company detail`}
    >
      <div className="stock-card-head">
        <div><strong>{asset.symbol}</strong><span>{asset.name}</span></div>
        <b>{stockIndicatorCount(asset)}/4 lit</b>
      </div>
      <div className="stock-signal-lights" aria-label={`${asset.symbol} indicator states`}>
        {lights.map((light) => (
          <span className={light.lit ? "lit" : "off"} key={light.label}><i />{light.label}</span>
        ))}
      </div>
      <div className="stock-card-prices">
        <div><span>Signal close</span><strong>{price(asset.close)}</strong></div>
        <div><span>Entry · −{STOCK_ENTRY_PULLBACK_PERCENT}%</span><strong>{price(entryPrice)}</strong></div>
        <div><span>Exit · +{STOCK_TARGET_PERCENT}%</span><strong>{price(targetPrice)}</strong></div>
      </div>
      <footer>
        <strong>{stockSetupLabel(asset)}</strong>
        <span>{asset.emaBullStack ? "Bullish EMA stack" : "Mixed EMA stack"}{asset.launchWatch ? " · launch watch" : ""}</span>
      </footer>
    </button>
  );
}

function RsiOpportunityCard({ candidate, muted = false }: { candidate: RsiCandidate; muted?: boolean }) {
  return (
    <article className={`crypto-opportunity ${muted ? "blocked" : "active"}`}>
      <div className="crypto-opportunity-head">
        <div>
          <strong>{candidate.instrumentId}</strong>
          <span>{formatTimestamp(candidate.signalAvailableAt)} · {candidate.barsSinceSignal ?? 0} bars ago</span>
        </div>
        <b>{muted ? "historical signal" : "active signal"}</b>
      </div>
      <div className="crypto-metrics">
        <div><span>Signal close</span><strong>{cryptoPrice(candidate.signalClose)}</strong></div>
        <div><span>RSI confirmation</span><strong>{points(candidate.rsiAtConfirmation, 1)}</strong></div>
        <div><span>EMA spread Δ</span><strong>{points(candidate.emaSpreadChange, 5)}</strong></div>
      </div>
      <div className={`add-on-state ${candidate.godmodeAddOnMet ? "aligned" : "parent-only"}`}>
        <span>Godmode add-on</span>
        <strong>{candidate.godmodeAddOnMet ? "SHORT transition aligned" : "not present · RSI/EMA only"}</strong>
      </div>
      {!muted && candidate.orders.length > 0 && (
        <div className="order-grid" aria-label={`${candidate.instrumentId} limit order grid`}>
          {candidate.orders.map((order) => (
            <div key={`${order.pushPercent}-${order.targetPercent}`}>
              <span>+{order.pushPercent}% / −{order.targetPercent}%</span>
              <small>Entry</small><strong>{cryptoPrice(order.entryPrice ?? order.plannedEntryPrice)}</strong>
              <small>Exit</small><strong>{cryptoPrice(order.targetPrice ?? order.plannedExitPrice)}</strong>
              <small>{reasonLabel(order.orderState)}</small>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function HistoryOpportunityCard({
  candidate,
  pushPercent,
  targetPercent,
}: {
  candidate: RsiCandidate;
  pushPercent: number;
  targetPercent: number;
}) {
  const referenceOrder = matchingOrder(candidate, pushPercent, targetPercent);
  const isHit = referenceOrder?.orderState === "target_already_hit";
  return (
    <article className={`history-card ${candidate.godmodeAddOnMet ? "aligned" : "parent-only"}`}>
      <div className="history-card-head">
        <div><strong>{candidate.instrumentId}</strong><span>{formatTimestamp(candidate.signalAvailableAt)}</span></div>
        <b>{candidate.godmodeAddOnMet ? "Godmode aligned" : "RSI / EMA only"}</b>
      </div>
      <div className="history-card-body">
        <div className="history-indicators">
          <span>RSI <strong>{points(candidate.rsiAtConfirmation, 1)}</strong></span>
          <span>Close <strong>{cryptoPrice(candidate.signalClose)}</strong></span>
          <span>Age <strong>{candidate.barsSinceSignal ?? 0} bars</strong></span>
        </div>
        <div className={`reference-outcome ${isHit ? "hit" : ""}`}>
          <div><span>Reference +{pushPercent}% / −{targetPercent}%</span><strong>{orderOutcome(referenceOrder?.orderState)}</strong></div>
          <div className="history-prices"><span>Entry <strong>{cryptoPrice(referenceOrder?.entryPrice ?? referenceOrder?.plannedEntryPrice)}</strong></span><span>Exit <strong>{cryptoPrice(referenceOrder?.targetPrice ?? referenceOrder?.plannedExitPrice)}</strong></span></div>
          <small>{candidate.suggestedSetupEligible ? "RSI / EMA + Godmode add-on confirmed" : "RSI / EMA signal · add-on absent"}</small>
        </div>
      </div>
    </article>
  );
}

function EtfOpportunityCard({ opportunity }: { opportunity: EtfOpportunity }) {
  return (
    <article className={`history-card etf-history-card ${opportunity.mfiAddOnMet ? "aligned" : "parent-only"}`}>
      <div className="history-card-head">
        <div><strong>{opportunity.symbol}</strong><span>{formatDate(opportunity.signalTime)} · {opportunity.name}</span></div>
        <b>{opportunity.mfiAddOnMet ? "MFI-14 rising" : "Godmode only"}</b>
      </div>
      <div className="history-card-body">
        <div className="history-indicators">
          <span>WT1 <strong>{points(opportunity.wt1, 1)}</strong></span>
          <span>Slope <strong>{points(opportunity.slope, 2)}</strong></span>
          <span>MFI-14 <strong>{points(opportunity.mfi14, 1)}</strong></span>
        </div>
        <div className={`reference-outcome ${opportunity.targetHit ? "hit" : ""}`}>
          <div><span>Next open · strict +1% · 2 sessions</span><strong>{etfOrderOutcome(opportunity.orderState)}</strong></div>
          <div className="history-prices">
            <span>Entry <strong>{opportunity.entryPrice == null ? "Next open" : price(opportunity.entryPrice)}</strong></span>
            <span>Target <strong>{opportunity.targetPrice == null ? "+1% after fill" : price(opportunity.targetPrice)}</strong></span>
          </div>
          <small>{opportunity.mfiAddOnMet ? "Godmode LONG + volume participation confirmation" : "Parent Godmode LONG retained without the optional add-on"}</small>
        </div>
      </div>
    </article>
  );
}

function EtfOpportunities({ etf }: { etf: EtfSnapshot }) {
  const [historyFilter, setHistoryFilter] = useState<"all" | "aligned" | "parent-only">("all");
  const aligned = etf.opportunities.filter((opportunity) => opportunity.mfiAddOnMet);
  const parentOnly = etf.opportunities.filter((opportunity) => !opportunity.mfiAddOnMet);
  const filtered = etf.opportunities.filter((opportunity) =>
    historyFilter === "all"
      ? true
      : historyFilter === "aligned"
        ? opportunity.mfiAddOnMet
        : !opportunity.mfiAddOnMet,
  );
  const suggested = etf.suggestedTradeSetup;
  const latestCandle = etf.completedCandleDates.at(-1) ?? "";

  return (
    <section className="crypto-section etf-section" id="etf-opportunities">
      <div className="crypto-hero">
        <div>
          <p className="eyebrow">Daily · registered ETF transfer universe</p>
          <h2>ETF opportunities</h2>
          <p>Completed-candle Godmode oversold LONG transitions, with rising MFI-14 shown as a complementary participation add-on—not an eligibility requirement.</p>
        </div>
        <div className="crypto-scan-meta">
          <span><i /> daily scan complete</span>
          <strong>{latestCandle ? formatDate(latestCandle) : "No completed candle"}</strong>
          <small>{formatTimestamp(etf.generatedAt)}</small>
        </div>
      </div>

      <div className="crypto-stat-strip" aria-label="ETF scan summary">
        <div><span>Active opportunities</span><strong>{etf.active.length}</strong><small>inside the two-session outcome window</small></div>
        <div><span>One-year signals</span><strong>{etf.opportunities.length}</strong><small>{etf.historyWindowSessions} completed sessions</small></div>
        <div><span>MFI confirmed</span><strong>{aligned.length}</strong><small>{parentOnly.length} shown without add-on</small></div>
        <div><span>Strict +1% hits</span><strong>{etf.totals.targetHits}</strong><small>next-open, two-session reference</small></div>
        <div><span>ETFs analyzed</span><strong>{etf.universeSymbols}</strong><small>{etf.usableHistory} usable · {etf.basicDataIntegrityFailures} integrity failures</small></div>
      </div>

      <div className="etf-evidence-bar">
        <div><span>Parent opportunity edge</span><strong>+{points(etf.evidence.parentBarrierEdgePercentagePoints, 1)} pp</strong><small>ETF h2 +1% excursion vs same-row base</small></div>
        <div><span>MFI-14 add-on change</span><strong>+{points(etf.evidence.mfiBarrierChangePercentagePoints, 2)} pp</strong><small>retrospective barrier-rate change</small></div>
        <div><span>Standalone expectancy</span><strong>{percentage(etf.evidence.parentMeanNetReturn, 2)}</strong><small>did not establish a profitable strategy</small></div>
      </div>

      <section className="suggested-setup" aria-label="ETF confirmation-only reference plan">
        <div className="suggested-copy">
          <p className="eyebrow">Confirmation-only reference plan</p>
          <h3>Suggested setup after Godmode + MFI agree</h3>
          <p>Entry remains the next session open from the frozen study. The target is a strict +1% excursion during the next two completed sessions.</p>
          <div className="confirmation-chain"><span>Godmode LONG</span><i>→</i><span>MFI-14 rising</span></div>
        </div>
        {suggested ? (
          <div className="live-plan">
            <div className="live-plan-head"><strong>{suggested.symbol}</strong><b>confirmed research setup</b></div>
            <div className="live-plan-prices">
              <div><span>Entry · next open</span><strong>{suggested.entryPrice == null ? "Pending" : price(suggested.entryPrice)}</strong><small>{suggested.entryRule}</small></div>
              <i>→</i>
              <div><span>Exit · strict target</span><strong>{suggested.exitPrice == null ? "+1% after fill" : price(suggested.exitPrice)}</strong><small>within two completed sessions</small></div>
            </div>
            <footer><span>{etfOrderOutcome(suggested.state)}</span><span>No modeled stop</span><span>No order authority</span></footer>
          </div>
        ) : (
          <div className="no-live-plan">
            <span>—</span>
            <div><strong>No add-on-confirmed plan now</strong><p>The latest completed ETF candle has no active Godmode LONG transition with rising MFI-14.</p></div>
          </div>
        )}
      </section>

      <div className="crypto-lanes etf-lanes">
        <section className="crypto-lane">
          <div className="crypto-lane-heading">
            <div><p className="eyebrow">Current research orders</p><h3>Next-open / +1% reference</h3></div>
            <span className="lane-pill long">long only</span>
          </div>
          <div className="strategy-formula">
            <strong>1d</strong><span>WT0 crosses above WT1 in oversold zone</span><i>+</i><span>slope &gt; 0</span><i>+</i><span>MFI optional</span>
          </div>
          {etf.active.length ? (
            <div className="crypto-opportunity-list">
              {etf.active.map((opportunity) => <EtfOpportunityCard opportunity={opportunity} key={`${opportunity.symbol}-${opportunity.signalTime}`} />)}
            </div>
          ) : (
            <div className="crypto-empty"><span>0</span><div><strong>No active ETF setup</strong><p>No registered ETF is currently awaiting its next open or target inside the two-session reference window.</p></div></div>
          )}
        </section>

        <section className="crypto-lane">
          <div className="crypto-lane-heading">
            <div><p className="eyebrow">Latest completed state</p><h3>Registered ETF tape</h3></div>
            <span className="lane-pill observe">10-symbol evidence set</span>
          </div>
          <div className="etf-state-grid">
            {etf.latestStates.map((state) => (
              <article className={`etf-state-card ${state.confirmedLongTransition ? "transition" : ""}`} key={state.symbol}>
                <div><strong>{state.symbol}</strong><span>{price(state.close)}</span></div>
                <p>WT0 {points(state.wt0, 1)} · WT1 {points(state.wt1, 1)}</p>
                <footer><span>Slope {points(state.slope, 2)}</span><b>{state.mfi14Rising ? "MFI ↑" : "MFI ↓"}</b></footer>
              </article>
            ))}
          </div>
        </section>
      </div>

      <section className="opportunity-history etf-history">
        <div className="history-heading">
          <div>
            <p className="eyebrow">Rolling {etf.historyWindowSessions}-session ledger</p>
            <h3>Past Godmode ETF opportunities</h3>
            <p>{aligned.length} with rising MFI-14 · {parentOnly.length} without it · {etf.totals.targetHits} strict reference target hits.</p>
          </div>
          <div className="history-filters" role="group" aria-label="ETF historical opportunity filter">
            <button className={historyFilter === "all" ? "active" : ""} onClick={() => setHistoryFilter("all")}>All <b>{etf.opportunities.length}</b></button>
            <button className={historyFilter === "aligned" ? "active" : ""} onClick={() => setHistoryFilter("aligned")}>MFI add-on <b>{aligned.length}</b></button>
            <button className={historyFilter === "parent-only" ? "active" : ""} onClick={() => setHistoryFilter("parent-only")}>Without add-on <b>{parentOnly.length}</b></button>
          </div>
        </div>
        <div className="add-on-definition"><strong>Complementary add-on</strong><span>MFI-14 on the completed Godmode signal candle is above MFI-14 on the immediately preceding completed candle.</span></div>
        {filtered.length ? (
          <div className="history-grid">{filtered.map((opportunity) => <EtfOpportunityCard opportunity={opportunity} key={`${opportunity.symbol}-${opportunity.signalTime}`} />)}</div>
        ) : (
          <div className="history-empty"><strong>No opportunities in this lane</strong><span>The filter remains visible even when the current ledger has zero rows.</span></div>
        )}
      </section>

      <div className="crypto-guardrail">
        <div><span>Universe</span><strong>{etf.universeId} · frozen ten-ETF evidence set</strong></div>
        <div><span>Authority</span><strong>{etf.deploymentAllowed || etf.capitalAuthority ? "enabled" : "research only · no capital authority"}</strong></div>
        <p>Prospective tradability screening is not an ETF eligibility gate. Only completed-candle integrity and freshness can suppress a row; rising MFI-14 is displayed, never required for the parent opportunity.</p>
      </div>
    </section>
  );
}

function CryptoOpportunities({ crypto }: { crypto: CryptoSnapshot }) {
  const [historyFilter, setHistoryFilter] = useState<"all" | "aligned" | "parent-only">("all");
  const currentLongs = crypto.godmode.current.filter((item) => item.direction === "long");
  const currentShorts = crypto.godmode.current.filter((item) => item.direction === "short");
  const setup = crypto.rsi.setup;
  const alignedHistory = crypto.rsi.history.filter((candidate) => candidate.godmodeAddOnMet);
  const parentOnlyHistory = crypto.rsi.history.filter((candidate) => !candidate.godmodeAddOnMet);
  const filteredHistory = crypto.rsi.history.filter((candidate) =>
    historyFilter === "all"
      ? true
      : historyFilter === "aligned"
        ? candidate.godmodeAddOnMet
        : !candidate.godmodeAddOnMet,
  );
  const referencePush = crypto.suggestedTradeSetup.pushPercent;
  const referenceTarget = crypto.suggestedTradeSetup.targetPercentBelowFill;
  const historicalTargetHits = crypto.rsi.history.filter(
    (candidate) => matchingOrder(candidate, referencePush, referenceTarget)?.orderState === "target_already_hit",
  ).length;
  const confirmedNow = crypto.rsi.activeSignals.find(
    (candidate) => candidate.suggestedSetupEligible && candidate.godmodeAddOnMet,
  );
  const confirmedOrder = confirmedNow
    ? matchingOrder(confirmedNow, referencePush, referenceTarget) ?? confirmedNow.orders[0]
    : undefined;
  const confirmedPush = confirmedOrder?.pushPercent ?? referencePush;
  const confirmedTargetPercent = confirmedOrder?.targetPercent ?? referenceTarget;
  const confirmedTarget = confirmedOrder?.targetPrice ?? confirmedOrder?.plannedExitPrice ?? null;

  return (
    <section className="crypto-section" id="crypto-opportunities">
      <div className="crypto-hero">
        <div>
          <p className="eyebrow">Hourly · native crypto universe</p>
          <h2>Crypto opportunities</h2>
          <p>Two independent research lanes from completed candles: retained RSI divergence shorts and Godmode confirmed transitions.</p>
        </div>
        <div className="crypto-scan-meta">
          <span><i /> latest scan complete</span>
          <strong>{crypto.venue.toUpperCase()} · {crypto.marketType}</strong>
          <small>{formatTimestamp(crypto.generatedAt)}</small>
        </div>
      </div>

      <div className="crypto-stat-strip" aria-label="Crypto scan summary">
        <div><span>Active RSI shorts</span><strong>{crypto.rsi.activeSignals.length}</strong><small>inside the five-bar entry window</small></div>
        <div><span>Seven-day hits</span><strong>{crypto.rsi.history.length}</strong><small>retained RSI / EMA opportunities</small></div>
        <div><span>Add-on aligned</span><strong>{alignedHistory.length}</strong><small>Godmode SHORT within prior 6h</small></div>
        <div><span>Godmode now</span><strong>{currentLongs.length}L / {currentShorts.length}S</strong><small>current confirmed transitions</small></div>
        <div><span>Markets analyzed</span><strong>{crypto.universe.considered}</strong><small>{crypto.universe.usableHistory} with usable history</small></div>
      </div>

      <section className="suggested-setup" aria-label="Confirmation-only research trade setup">
        <div className="suggested-copy">
          <p className="eyebrow">Confirmation-only reference plan</p>
          <h3>Suggested setup after both signals agree</h3>
          <p>Shown when the RSI/EMA parent signal and causal Godmode SHORT add-on agree. Crypto quality screening does not block it.</p>
          <div className="confirmation-chain">
            <span>RSI / EMA</span><i>→</i><span>Godmode SHORT ≤ 6h</span>
          </div>
        </div>
        {confirmedNow && confirmedOrder ? (
          <div className="live-plan">
            <div className="live-plan-head"><strong>{confirmedNow.instrumentId}</strong><b>confirmed research setup</b></div>
            <div className="live-plan-prices">
              <div><span>Entry · limit short</span><strong>{cryptoPrice(confirmedOrder.entryPrice ?? confirmedOrder.plannedEntryPrice)}</strong><small>+{confirmedPush}% from signal close</small></div>
              <i>→</i>
              <div><span>Exit · target</span><strong>{cryptoPrice(confirmedTarget)}</strong><small>−{confirmedTargetPercent}% from entry</small></div>
            </div>
            <footer><span>{orderOutcome(confirmedOrder.orderState)}</span><span>{crypto.suggestedTradeSetup.entryWindowCompletedSetupBars} setup bars to enter</span><span>{crypto.suggestedTradeSetup.targetWindowCompletedSetupBarsAfterFill} after fill</span><span>No modeled stop</span></footer>
          </div>
        ) : (
          <div className="no-live-plan">
            <span>—</span>
            <div><strong>No add-on-confirmed plan now</strong><p>No live retained RSI/EMA setup currently has the complementary Godmode SHORT signal.</p></div>
          </div>
        )}
      </section>

      <div className="crypto-lanes">
        <section className="crypto-lane rsi-lane">
          <div className="crypto-lane-heading">
            <div><p className="eyebrow">Lane 01 · short only</p><h3>RSI divergence + EMA contraction</h3></div>
            <span className="lane-pill short">retained candidate</span>
          </div>
          {setup && (
            <div className="strategy-formula">
              <strong>{setup.timeframe}</strong>
              <span>RSI({setup.rsiPeriod}) bearish divergence</span>
              <i>+</i>
              <span>EMA({setup.emaFast}) &gt; EMA({setup.emaSlow})</span>
              <i>+</i>
              <span>spread contracting</span>
            </div>
          )}

          {crypto.rsi.activeSignals.length > 0 ? (
            <div className="crypto-opportunity-list">
              {crypto.rsi.activeSignals.map((candidate) => (
                <RsiOpportunityCard key={`${candidate.instrumentId}-${candidate.signalAvailableAt}`} candidate={candidate} />
              ))}
            </div>
          ) : (
            <div className="crypto-empty">
              <span>0</span>
              <div><strong>No active short right now</strong><p>The latest run found no retained RSI/EMA signal inside its five-bar entry window.</p></div>
            </div>
          )}

        </section>

        <section className="crypto-lane godmode-lane">
          <div className="crypto-lane-heading">
            <div><p className="eyebrow">Lane 02 · directional</p><h3>Godmode confirmed transitions</h3></div>
            <span className="lane-pill observe">observational</span>
          </div>
          <div className="godmode-rule">
            <strong>{crypto.godmode.timeframe}</strong>
            <span>extreme zone</span><i>→</i><span>WT cross</span><i>→</i><span>slope confirms direction</span>
          </div>

          {crypto.godmode.current.length > 0 ? (
            <div className="godmode-grid">
              {crypto.godmode.current.map((opportunity) => (
                <article className={`godmode-card ${opportunity.direction}`} key={`${opportunity.instrumentId}-${opportunity.direction}`}>
                  <div className="godmode-card-head">
                    <div><strong>{opportunity.instrumentId}</strong><span>{cryptoPrice(opportunity.close)}</span></div>
                    <b>{opportunity.direction}</b>
                  </div>
                  <div className="wave-readout">
                    <span>WT0 <strong>{points(opportunity.wt0, 1)}</strong></span>
                    <i>{opportunity.direction === "long" ? "↗" : "↘"}</i>
                    <span>WT1 <strong>{points(opportunity.wt1, 1)}</strong></span>
                  </div>
                  <footer><span>Slope {points(opportunity.slope, 2)}</span><span>Extreme L{opportunity.extremityLevel ?? 0}</span></footer>
                </article>
              ))}
            </div>
          ) : (
            <div className="crypto-empty compact"><span>0</span><div><strong>No current transition</strong><p>The latest completed hour did not confirm a Godmode cross.</p></div></div>
          )}
          <div className="godmode-warning"><strong>Transfer warning</strong><p>{crypto.godmode.warning}</p></div>
        </section>
      </div>

      <section className="opportunity-history">
        <div className="history-heading">
          <div>
            <p className="eyebrow">Rolling {crypto.historyWindowHours / 24}-day ledger</p>
            <h3>Past RSI / EMA opportunities</h3>
            <p>{alignedHistory.length} with the add-on · {parentOnlyHistory.length} without it · {historicalTargetHits} reference target hits.</p>
          </div>
          <div className="history-filters" role="group" aria-label="Historical opportunity filter">
            <button className={historyFilter === "all" ? "active" : ""} onClick={() => setHistoryFilter("all")}>All <b>{crypto.rsi.history.length}</b></button>
            <button className={historyFilter === "aligned" ? "active" : ""} onClick={() => setHistoryFilter("aligned")}>Add-on met <b>{alignedHistory.length}</b></button>
            <button className={historyFilter === "parent-only" ? "active" : ""} onClick={() => setHistoryFilter("parent-only")}>Without add-on <b>{parentOnlyHistory.length}</b></button>
          </div>
        </div>
        <div className="add-on-definition">
          <strong>Complementary add-on</strong>
          <span>A confirmed 1h Godmode SHORT transition available at or within the six completed hours before the 3h RSI/EMA signal became actionable.</span>
        </div>
        <div className="history-grid">
          {filteredHistory.map((candidate) => (
            <HistoryOpportunityCard
              candidate={candidate}
              key={`${candidate.instrumentId}-${candidate.signalAvailableAt}`}
              pushPercent={referencePush}
              targetPercent={referenceTarget}
            />
          ))}
        </div>
      </section>

      <div className="crypto-guardrail">
        <div><span>Universe</span><strong>{crypto.universeRule}</strong></div>
        <div><span>Authority</span><strong>{crypto.deploymentAllowed || crypto.capitalAuthority ? "enabled" : "research only · no capital authority"}</strong></div>
        <p>Crypto quality screening is not an eligibility gate. Godmode remains optional for the parent history comparison and is required only for the highlighted suggested plan.</p>
      </div>
    </section>
  );
}

// The campaign's own null result. Rendered unconditionally at the top of the
// section, above every lane, so no recorded BUY or SELL can reach a viewer
// without it in the same view.
const OSCILLATOR_NULL_RESULT = [
  {
    label: "Dependence-preserving permutation null",
    value: "p = 0.455",
    detail: "16 double-positive cells against a null mean of 15.2",
  },
  {
    label: "Frozen rank-1 candidate",
    value: "percentile 0.463",
    detail: "of its own 396-point grid, evaluated out of sample",
  },
  {
    label: "Benjamini-Hochberg q < 0.10",
    value: "0 of 15 survive",
    detail: "no cell clears the family-wise correction",
  },
];

const OSCILLATOR_STATUS_LABELS: Record<string, string> = {
  active_long: "BUY recorded",
  active_short: "SELL recorded",
  flat: "flat · no open position",
  insufficient_history: "insufficient history",
  source_unavailable: "source unavailable",
  deferred: "deferred by human decision",
  lifecycle_terminated_bankrupt: "evaluator abandoned the segment",
};

/**
 * N2. This used to fall through to `status.replaceAll("_", " ")`, which printed
 * an unrecognised status verbatim as the card headline — and the enum that would
 * have stopped one was enforced only in the build-time projection, so a
 * republished snapshot could put arbitrary prose there. The enum now lives in
 * the shared gate, so a block carrying an unknown status is refused whole and
 * this branch is unreachable. It stays non-echoing anyway: a label map is the
 * last place that should invent text it has never seen.
 */
function oscillatorStatusLabel(status: string) {
  return OSCILLATOR_STATUS_LABELS[status] ?? "unrecognised status";
}

// ═════════════════════════════════════════════════════════════════════════════
// INVARIANT A, the rendering half.
//
// Two components, and no other way to put producer text on this page.
//
// <ProducerQuoted> renders a `{ quoted }` fragment: this interface says whose
// words these are and that it is not acting on them, and the words themselves
// sit inside a <q> in a monospace face that reads as a quoted value rather than
// as a sentence. <CodedPhrase> renders a `{ code }` from a closed vocabulary as
// OUR prose; where the code is one this interface has never seen the projection
// has already demoted it to a fragment, and the fragment renders quoted beneath
// our own sentence saying it was not recognised.
//
// Neither component can be made to echo. `describeCoded` is in the shared
// vocabulary module and always returns OUR `prose`; the producer chooses which
// entry it selects, never the words.
// ═════════════════════════════════════════════════════════════════════════════

/** How a quoted producer fragment is attributed, by where it sits. */
const QUOTED_BY_TRACKER = "quoted from the tracker · not acted on by this interface";

function ProducerQuoted({
  value,
  attribution,
}: {
  value: ProducerQuote | null | undefined;
  attribution: string;
}) {
  if (value == null) return null;
  return (
    <span className="producer-quote" data-producer="quotation">
      <i>{attribution}</i>
      <q>{value.quoted}</q>
      {value.truncated ? <small>quoted fragment truncated by this interface</small> : null}
    </span>
  );
}

/**
 * A printed identifier: the member, or the quotation. Nothing else.
 *
 * Both branches carry `data-producer`, which is what the rendered check keys the
 * counter-claim on. The member branch is marked even though it is a closed-set
 * value, because "this came from the producer" is the fact the check is about,
 * and a rule that only marked the values we could not place would go quiet on
 * exactly the ones an attacker made placeable.
 */
function ProducerIdentifier({
  value,
  absent = "—",
}: {
  value: ProducerIdentifierValue | null | undefined;
  absent?: string;
}) {
  const described = describeIdentifier(value ?? null);
  if (described.id != null) {
    return (
      <span className="producer-id" data-producer="identifier">
        {described.id}
      </span>
    );
  }
  if (described.quoted == null) return <>{absent}</>;
  return (
    <span className="producer-quote inline" data-producer="quotation">
      <i>{QUOTED_BY_TRACKER}</i>
      <q>{described.quoted}</q>
      {described.truncated ? <small>quoted fragment truncated by this interface</small> : null}
    </span>
  );
}

function CodedPhrase({
  value,
  vocabulary,
  absent,
}: {
  value: ProducerCoded | null | undefined;
  vocabulary: string;
  absent: string;
}) {
  const described = describeCoded(value ?? null, vocabulary, absent);
  // `prose` is always ours, so the recognised branch carries no marker: there is
  // no producer text in it to attribute.
  if (described.quoted == null) return <>{described.prose}</>;
  return (
    <span className="producer-quote inline" data-producer="quotation">
      <i>{described.prose}</i>
      <q>{described.quoted}</q>
      {described.truncated ? <small>quoted fragment truncated by this interface</small> : null}
    </span>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// INVARIANT B. No card bearing producer content lacks a counter-claim.
//
// N1 measured this per card TYPE, and per type it held — but the measurement
// only inspected a card IF IT WAS LABELLED, and the outage and declined ledger
// kinds carry no BUY or SELL. They were unmeasured, and they were also the two
// branches of OscillatorRecordCard with no authority text: the entry branch says
// "no order was placed" and the exit branch says "not a realised trade", while
// the outage, declined and pending branches said nothing at all. So N6 put six
// unqualified cards on the page through a branch nobody had looked at.
//
// Label-dependence was the defect. Every card now goes through this one shell,
// which appends its counter-claim UNCONDITIONALLY — not per branch, not per
// label, not per status. A card kind is a key of this table; a component cannot
// render an <article> of its own, and a kind with no entry here cannot be named,
// so a new card kind fails at the type level and again in the rendered test.
// ═════════════════════════════════════════════════════════════════════════════

const OSCILLATOR_CARD_AUTHORITY = {
  roster:
    "tracking only · no order authority · this cell is a candidate, not established alpha",
  "roster-open-position":
    "tracking only · no order authority · unrealised, gross of the frozen 18 bps round-trip friction",
  "live-signal":
    "tracking only · no order authority · gross of the frozen 18 bps round-trip friction",
  "ledger-entry":
    "tracking only · no order authority · a recorded observation of the frozen rule; no order was placed",
  "ledger-exit":
    "tracking only · no order authority · an observation, not a realised trade",
  "ledger-declined":
    "tracking only · no order authority · the frozen evaluator declined this pulse; nothing was entered",
  "ledger-pending":
    "tracking only · no order authority · no entry bar has opened; nothing here is an instruction",
  "ledger-outage":
    "tracking only · no order authority · this record is the tracker reporting that it went quiet",
} as const;

type OscillatorCardKind = keyof typeof OSCILLATOR_CARD_AUTHORITY;

/**
 * The only <article> this section renders.
 *
 * `data-card-kind` is not decoration: it is how the rendered test counts cards
 * per kind without inferring the kind from a class token, so an outage card and
 * a declined card are in the denominator whether or not they carry a label.
 */
function OscillatorCard({
  kind,
  className,
  children,
}: {
  kind: OscillatorCardKind;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <article className={className} data-card-kind={kind} data-bears-authority="card">
      {children}
      <div className="oscillator-card-authority">
        <span>Authority</span>
        <strong>{OSCILLATOR_CARD_AUTHORITY[kind]}</strong>
      </div>
    </article>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// INVARIANT B, the half a card-shaped rule could never reach.
//
// The rendered check asked "is this an <article>?". An adversary answered it
// with a fourteen-line <div> called WatchDeskNote that rendered cell.asset,
// cell.oscillator, cell.exitFamily and the frozen leg parameters with no
// counter-claim anywhere on it: 71 pass, 0 fail. And from the other direction,
// registry.registryId, runId and the runtime versions sit OUTSIDE every card, so
// no rule about cards could have covered them however it was written.
//
// So the counter-claim is keyed on producer CONTENT. Every node that renders a
// producer value carries `data-producer`; every such node must have an ancestor
// carrying `data-bears-authority`; and the rendered test asserts exactly that
// over the whole section. OscillatorCard is one bearer. A region is the other,
// and it appends its counter-claim the same unconditional way.
// ══════════════════════════════════════════════════════════════════════════════

const OSCILLATOR_REGION_AUTHORITY = {
  "run-identity":
    "tracking only · no order authority · the run and registry identifiers name a research artifact, not an approval",
  "observation-log":
    "tracking only · no order authority · the tracker's own statement of purpose, quoted; no order was placed on any of it",
  "frozen-protocol":
    "tracking only · no order authority · what was frozen and which runtime ran it; neither is a permission to trade",
  "frozen-limitations":
    "tracking only · no order authority · the tracker's own limitations, quoted and not argued with",
  "selection-rule":
    "tracking only · no order authority · how these cells were picked out of the campaign, in the tracker's words",
  "ledger-basis":
    "tracking only · no order authority · the tracker's stated basis for its own record rate",
  guardrail:
    "tracking only · no order authority · no capital authority · nothing on this page is an instruction",
  withheld:
    "tracking only · no order authority · the block was withheld; the value below is the tracker's, quoted and not acted on",
} as const;

type OscillatorRegionKind = keyof typeof OSCILLATOR_REGION_AUTHORITY;

/**
 * A bearer of the counter-claim that is not a card.
 *
 * Same contract as OscillatorCard: the note is appended unconditionally, there
 * is no branch that omits it, and a region kind with no entry in the table
 * cannot be named.
 */
function OscillatorRegion({
  region,
  className,
  children,
}: {
  region: OscillatorRegionKind;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`${className} oscillator-region`} data-bears-authority={region}>
      {children}
      <div className="oscillator-card-authority">
        <span>Authority</span>
        <strong>{OSCILLATOR_REGION_AUTHORITY[region]}</strong>
      </div>
    </div>
  );
}

function signedPercentage(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

/**
 * Frozen window parameters, one marked node per producer value.
 *
 * This used to de-underscore the parameter names, and that was fixed. What was
 * not fixed was worse: it then built
 *
 *   leg.parameters.map((entry) => `${entry.name} ${entry.value}`).join(" · ")
 *
 * over an UNCAPPED array. The pattern behind `token` was defended as "no
 * whitespace, so it cannot become a sentence" while the view supplied the
 * whitespace itself, one literal space between two producer-controlled values,
 * as many times as the producer liked. There is no string built here any more:
 * the name and the value are separate nodes, each marked as a producer value and
 * each individually a closed-set member or a quotation.
 */
function FrozenLegParameters({ leg }: { leg: OscillatorFrozenLeg | null | undefined }) {
  if (leg == null) return <i>not recorded</i>;
  if (leg.parameters.length === 0) return <i>no parameters recorded</i>;
  return (
    <i className="oscillator-frozen-parameters">
      {leg.parameters.map((entry, index) => (
        <span className="oscillator-frozen-parameter" key={index}>
          <ProducerIdentifier value={entry.name} />
          {typeof entry.value === "number" ? (
            <b>{entry.value}</b>
          ) : (
            <ProducerIdentifier value={entry.value} />
          )}
        </span>
      ))}
    </i>
  );
}

/**
 * The presentation label for a record, in one register across both lanes.
 *
 * ui_label is required only on signal records, so a fill used to read "long
 * recorded" beside a signal reading "BUY recorded" for the same event. The
 * direction is mapped rather than printed raw. Returns null rather than guessing
 * when the record carries neither, so nothing is invented.
 */
function oscillatorSignalLabel(record: OscillatorRecord) {
  if (record.uiLabel === "BUY" || record.uiLabel === "SELL") return record.uiLabel;
  if (record.direction === "long") return "BUY";
  if (record.direction === "short") return "SELL";
  return null;
}

/** Which lane a ledger record belongs in. A declined pulse is never a fill. */
function oscillatorRecordKind(record: OscillatorRecord) {
  if (record.recordType === "outage") return "outage";
  if (record.recordType === "fill") return "filled";
  if (record.recordType === "exit") return "exit";
  const state = record.priceReference?.intendedEntry.state ?? null;
  if (state === "filled") return "filled";
  if (state === "not_taken") return "declined";
  return "pending";
}

/** The card kind a ledger record renders as. One record, one registered kind. */
const OSCILLATOR_RECORD_CARD_KIND: Record<string, OscillatorCardKind> = {
  outage: "ledger-outage",
  declined: "ledger-declined",
  pending: "ledger-pending",
  exit: "ledger-exit",
  filled: "ledger-entry",
};

/**
 * What the roster card says about this cell, as OUR sentence plus at most one
 * quoted producer fragment.
 *
 * This used to concatenate `termination.detail` into a sentence of its own
 * making — "{producer prose} 3487 later bars and 61 entry pulses are
 * unevaluated." — which is precisely a producer string in claim position, on the
 * card that also shows an open position and a P&L. The two are now separate
 * fields, so the producer prose can only render quoted.
 */
function oscillatorCellDetail(cell: OscillatorCell): {
  prose: string | null;
  quoted: ProducerQuote | null;
} {
  if (cell.status === "deferred") {
    return { prose: null, quoted: cell.deferred.reason ?? cell.availability.detail };
  }
  if (cell.status === "lifecycle_terminated_bankrupt") {
    const termination = cell.lifecycle?.termination;
    if (termination == null) return { prose: null, quoted: cell.availability.detail };
    return {
      prose:
        `The frozen evaluator terminated on a bankrupt trade. ` +
        `${termination.unevaluatedBars ?? 0} later bars and ` +
        `${termination.unevaluatedEntryPulses ?? 0} entry pulses are unevaluated.`,
      quoted: termination.detail,
    };
  }
  if (cell.status === "insufficient_history") {
    return {
      prose:
        `${cell.barsAvailable ?? 0} bars available against ` +
        `${cell.warmup.effectiveBarsRequired ?? "an unknown number of"} required by the frozen ` +
        "adapter. No signal is produced until warmup is satisfied.",
      quoted: null,
    };
  }
  return { prose: null, quoted: cell.availability.detail };
}

function OscillatorCellCard({ cell }: { cell: OscillatorCell }) {
  const recording = cell.status === "active_long" || cell.status === "active_short";
  // Deferred, unavailable, short of warmup and lifecycle-terminated are not "flat":
  // they are states in which the frozen rule produced no evaluation at all.
  const degraded = !recording && cell.status !== "flat";
  const bullish = cell.divergenceArmed?.bullish;
  const bearish = cell.divergenceArmed?.bearish;
  const armed = [
    bullish?.armed ? `bullish · ${bullish.ageBars ?? "?"} bars old` : null,
    bearish?.armed ? `bearish · ${bearish.ageBars ?? "?"} bars old` : null,
  ].filter((entry): entry is string => entry != null);
  const detail = oscillatorCellDetail(cell);
  return (
    <OscillatorCard
      kind={recording && cell.position ? "roster-open-position" : "roster"}
      className={`etf-state-card oscillator-cell ${recording ? "transition" : ""}`}
    >
      <div>
        <strong>
          <ProducerIdentifier value={cell.asset} /> · <ProducerIdentifier value={cell.timeframe} />
        </strong>
        <span>
          <ProducerIdentifier value={cell.oscillator} /> ·{" "}
          <ProducerIdentifier value={cell.exitFamily} /> exit
        </span>
      </div>
      <p className={`oscillator-cell-status ${recording ? "recording" : degraded ? "degraded" : ""}`}>
        {oscillatorStatusLabel(cell.status)}
      </p>
      <div className="oscillator-frozen">
        <span>
          Fast<b><ProducerIdentifier value={cell.frozen?.fast?.label} /></b>
          <FrozenLegParameters leg={cell.frozen?.fast} />
        </span>
        <span>
          Slow<b><ProducerIdentifier value={cell.frozen?.slow?.label} /></b>
          <FrozenLegParameters leg={cell.frozen?.slow} />
        </span>
        <span>
          Divergence gate<b><ProducerIdentifier value={cell.frozen?.divergence.computedOn} /></b>
          <i>max event age {cell.frozen?.divergence.maxEventAgeBars ?? "—"} bars · pivots {cell.frozen?.divergence.pivotLeft ?? "—"}/{cell.frozen?.divergence.pivotRight ?? "—"}</i>
        </span>
      </div>
      {recording && cell.position ? (
        <div className="oscillator-cell-state recording">
          <span>Direction<b>{cell.position.direction ?? "—"}</b></span>
          <span>Entry<b>{cryptoPrice(cell.position.entryPrice)}</b></span>
          <span>Held<b>{cell.position.barsHeld ?? 0} bars</b></span>
          <span>Unrealised<b>{signedPercentage(cell.position.unrealisedGrossReturn)}</b></span>
        </div>
      ) : (
        <div className="oscillator-cell-state">
          <span>
            Divergence
            <b>{armed.length > 0 ? armed.join(" · ") : cell.divergenceArmed ? "none armed" : "not evaluated"}</b>
          </span>
          <span>
            State bar
            <b>{cell.stateBar?.openUtc ? formatTimestamp(cell.stateBar.openUtc) : "no evaluated bar"}</b>
          </span>
        </div>
      )}
      {(detail.prose != null || detail.quoted != null) && (
        <p className="oscillator-cell-detail">
          {detail.prose}
          <ProducerQuoted value={detail.quoted} attribution={QUOTED_BY_TRACKER} />
        </p>
      )}
      <footer>
        <span>Holdout {cell.evidence.holdout?.trades ?? 0} trades · {signedPercentage(cell.evidence.holdout?.netReturn)}</span>
        <span>Confirmation {cell.evidence.retrospectiveConfirmation?.trades ?? 0} · {signedPercentage(cell.evidence.retrospectiveConfirmation?.netReturn)}</span>
        <span>retrospective, before the evidence window closed</span>
      </footer>
    </OscillatorCard>
  );
}

function OscillatorSignalCard({
  asset,
  oscillator,
  timeframe,
  exitFamily,
  uiLabel,
  direction,
  signalBarOpenUtc,
  entryBarOpenUtc,
  entryPrice,
  barsHeld,
  unrealisedGrossReturn,
  pending,
}: {
  asset: ProducerIdentifierValue | null;
  oscillator: ProducerIdentifierValue | null;
  timeframe: ProducerIdentifierValue | null;
  exitFamily: ProducerIdentifierValue | null;
  uiLabel: string | null;
  direction: string | null;
  signalBarOpenUtc: string | null;
  entryBarOpenUtc: string | null;
  entryPrice: number | null;
  barsHeld: number | null;
  unrealisedGrossReturn: number | null;
  pending: boolean;
}) {
  return (
    <OscillatorCard
      kind="live-signal"
      className={`crypto-opportunity ${pending ? "blocked" : "active"}`}
    >
      <div className="crypto-opportunity-head">
        <div>
          <strong>
            <ProducerIdentifier value={asset} /> · <ProducerIdentifier value={timeframe} />
          </strong>
          {/* This printed the watch id, which is an identity built by joining
              four producer identifiers with dots and was constrained by nothing.
              The watch id is a join key now and is not printed; the card states
              the two identifiers the id carried that the heading did not. */}
          <span>
            <ProducerIdentifier value={oscillator} /> ·{" "}
            <ProducerIdentifier value={exitFamily} /> exit · signal bar{" "}
            {signalBarOpenUtc ? formatTimestamp(signalBarOpenUtc) : "—"}
          </span>
        </div>
        <b>{uiLabel ?? direction ?? "observation"}{pending ? " · not yet entered" : " · observation"}</b>
      </div>
      <div className="crypto-metrics">
        <div>
          <span>Entry bar</span>
          <strong>{entryBarOpenUtc ? formatTimestamp(entryBarOpenUtc) : "bar has not opened"}</strong>
        </div>
        <div><span>Entry price</span><strong>{cryptoPrice(entryPrice)}</strong></div>
        <div>
          <span>{pending ? "Bars held" : "Unrealised gross"}</span>
          <strong>{pending ? `${barsHeld ?? 0}` : signedPercentage(unrealisedGrossReturn)}</strong>
        </div>
      </div>
    </OscillatorCard>
  );
}

function OscillatorRecordCard({ record }: { record: OscillatorRecord }) {
  const kind = oscillatorRecordKind(record);
  const declined = kind === "declined";
  const intended = record.priceReference?.intendedEntry;
  const when = record.signalBar?.openUtc ?? record.fromUtc ?? record.exitBarUtc ?? record.emittedAtUtc;
  const pill =
    kind === "outage"
      ? "not reporting"
      : kind === "declined"
        ? "not taken"
        : kind === "pending"
          ? "awaiting entry bar"
          : record.recordType === "exit"
            ? "exit recorded"
            : `${oscillatorSignalLabel(record) ?? "entry"} recorded`;
  return (
    <OscillatorCard
      kind={OSCILLATOR_RECORD_CARD_KIND[kind]}
      className={`history-card oscillator-record ${kind === "filled" ? "aligned" : "quality-blocked"}`}
    >
      <div className="history-card-head">
        <div>
          <strong>
            <ProducerIdentifier value={record.asset} /> ·{" "}
            <ProducerIdentifier value={record.timeframe} />
          </strong>
          <span>
            <ProducerIdentifier value={record.oscillator} /> · {formatTimestamp(when)}
          </span>
        </div>
        <b>{pill}</b>
      </div>
      <div className="history-card-body">
        <div className="history-indicators">
          <span>Bar close <strong>{cryptoPrice(record.signalBar?.close ?? record.exitPrice ?? record.entryPrice ?? null)}</strong></span>
          <span>Spread <strong>{points(record.oscillatorState?.spread, 4)}</strong></span>
          <span>
            Divergence age
            <strong>{record.divergenceEvent?.ageBars == null ? "—" : `${record.divergenceEvent.ageBars} bars`}</strong>
          </span>
        </div>
        {kind === "outage" ? (
          // N6 landed in this branch. The headline was
          // `reasonLabel(record.reason ?? "not_reporting")`, whose label map fell
          // through to `value.replaceAll("_", " ")`, and beneath it
          // `{record.detail ?? "…"}` printed a producer string raw, uncapped and
          // unquoted. Both are wrapped values now, and neither component below
          // can render one as a sentence of this interface own.
          <div className="history-blocked">
            <strong>The cell is not reporting</strong>
            <span>
              <CodedPhrase
                value={record.reason}
                vocabulary="outageReason"
                absent="The cell produced no evaluation on this run."
              />
            </span>
            <ProducerQuoted value={record.detail} attribution={QUOTED_BY_TRACKER} />
          </div>
        ) : declined ? (
          <div className="history-blocked">
            <strong>Declined by the frozen evaluator · not a fill</strong>
            <span>
              The rule pulsed and the frozen lifecycle evaluator did not take it. No entry exists for this record.
            </span>
          </div>
        ) : kind === "pending" ? (
          <div className="history-blocked">
            <strong>Entry bar has not opened</strong>
            <span>
              The frozen rule enters at{" "}
              <CodedPhrase
                value={intended?.rule}
                vocabulary="entryRule"
                absent="the frozen entry bar"
              />
              . Earliest possible entry{" "}
              {intended?.earliestPossibleEntryBarOpenUtc
                ? formatTimestamp(intended.earliestPossibleEntryBarOpenUtc)
                : "is not yet determined"}
              .
            </span>
          </div>
        ) : record.recordType === "exit" ? (
          <div className="reference-outcome">
            <div>
              <span>
                Exit ·{" "}
                <CodedPhrase
                  value={record.exitReason}
                  vocabulary="exitReason"
                  absent="no exit reason recorded"
                />
              </span>
              <strong>{signedPercentage(record.netReturnAfterFrozenFriction)}</strong>
            </div>
            <small>net of the frozen 18 bps round-trip friction · {record.barsHeld ?? 0} bars held · observation, not a realised trade</small>
          </div>
        ) : (
          <div className="reference-outcome">
            <div>
              <span>
                Intended entry
                {intended?.rule ? (
                  <>
                    {" · "}
                    <CodedPhrase
                      value={intended.rule}
                      vocabulary="entryRule"
                      absent="the frozen entry bar"
                    />
                  </>
                ) : null}
              </span>
              <strong>
                {intended?.entryBarOpenUtc
                  ? formatTimestamp(intended.entryBarOpenUtc)
                  : record.entryBarOpenUtc
                    ? formatTimestamp(record.entryBarOpenUtc)
                    : "—"}
              </strong>
            </div>
            <small>recorded observation of the frozen rule · no order was placed</small>
          </div>
        )}
        {declined && intended?.notTakenReason && (
          <div className="reason-list">
            <span>
              <CodedPhrase
                value={intended.notTakenReason}
                vocabulary="notTakenReason"
                absent="no reason recorded"
              />
            </span>
          </div>
        )}
      </div>
    </OscillatorCard>
  );
}

/**
 * What a *watch* surface owes the human when it has nothing to show.
 *
 * The section and its nav anchor used to vanish together, and the projection's
 * stated reason rendered nowhere, so "the tracker stopped reporting" was
 * indistinguishable from "this page never had that section". For a surface whose
 * entire purpose is forward tracking, the silence is itself the finding.
 *
 * N3. `prose` is ours, selected by the payload's reason code; `detail` is at most
 * one producer fragment, already flattened and capped by the shared gate, and is
 * rendered as a QUOTED VALUE beneath our sentence rather than as a sentence of
 * its own. The component takes no free-form string from the payload, so there is
 * no arrangement of a republished snapshot that writes prose into this notice.
 */
function OscillatorWatchUnavailable({ prose, detail }: { prose: string; detail: string | null }) {
  return (
    <section className="crypto-section oscillator-section oscillator-unavailable" id="oscillator-watch">
      <div className="crypto-hero">
        <div>
          <p className="eyebrow">Forward tracking · frozen oscillator registry</p>
          <h2>Oscillator alpha watch</h2>
          <p>
            The watch is not reporting. No BUY or SELL observation is available for this
            run, and nothing below is a stale roster shown as current — the whole block was
            withheld rather than partly surfaced, and this interface states why in its own
            words.
          </p>
        </div>
        <div className="crypto-scan-meta">
          <span><i /> not reporting</span>
          <strong>oscillator-alpha-watch</strong>
          <small>the surface is present and empty, not absent</small>
        </div>
      </div>

      <OscillatorRegion
        region="withheld"
        className="history-blocked oscillator-unavailable-reason"
      >
        <strong>Withheld by the honesty gate</strong>
        <span>{prose}</span>
        {detail && (
          <span className="oscillator-unavailable-detail" data-producer="quotation">
            <i>value reported by the tracker, quoted and not acted on</i>
            <code>{detail}</code>
          </span>
        )}
      </OscillatorRegion>

      <div className="crypto-guardrail">
        <div><span>Registry</span><strong>not loaded</strong></div>
        <div><span>Authority</span><strong>research only · no capital authority</strong></div>
        <p>
          tracking_only = true · deployment_allowed = false · capital_authority = false ·
          order_authority = false. A tracker block is surfaced whole or not at all: where any
          honesty flag, per-cell caveat or record label fails the gate, the block is withheld
          and this notice takes its place. A watch that has gone quiet is reported as quiet.
        </p>
      </div>
    </section>
  );
}

/**
 * How this ledger is ordered, in words the data supports.
 *
 * N4 residual. The heading claimed a newest-first order over "40 of 321 records
 * shown", and both halves were wrong at once: every record in a backfill
 * carries the RUN timestamp, so all 321 shared one `emitted_at_utc`, the sort was
 * a no-op, and the 40 were the first 40 by merge insertion order — which
 * evicted the only outage. The sort is deterministic now, and an outage outranks
 * every other kind on a tie, but "newest first" is still a claim about the DATA
 * rather than about the comparator. So it is asserted only where the data
 * carries more than one instant, and where it does not, the view says what the
 * ordering actually is.
 *
 * `dropped` names the kinds the cap kept out, per kind, so a record that did not
 * make the page is visible as an absence rather than inferable from two totals.
 */
function describeLedgerOrder(watch: OscillatorWatchSnapshot) {
  const chronological = watch.historyDistinctEmittedAt > 1;
  const tieBreak =
    "Where records share an instant, an outage is ordered ahead of every other kind " +
    "and the rest by record id, so nothing is kept or dropped by the order the ledger " +
    "partitions happened to be read in.";
  const dropped = Object.entries(watch.historyKindsObserved)
    .map(([kind, observed]) => {
      const shown = watch.historyKindsShown[kind] ?? 0;
      return observed > shown ? `${observed - shown} of ${observed} ${kind}` : null;
    })
    .filter((entry): entry is string => entry != null);
  if (chronological) {
    return {
      eyebrow: "newest first",
      sentence:
        `Ordered newest first across ${watch.historyDistinctEmittedAt} distinct emitted-at ` +
        `stamps. ${tieBreak}`,
      dropped,
    };
  }
  return {
    eyebrow: "not a chronological order",
    sentence:
      `All ${watch.historyRecordsObserved} observed records carry one emitted-at stamp — the ` +
      "tracker stamps a backfill with the time of the run — so this is not a newest-first " +
      `ordering and is not shown as one. ${tieBreak}`,
    dropped,
  };
}

function OscillatorWatch({ watch }: { watch: OscillatorWatchSnapshot }) {
  const [recordFilter, setRecordFilter] = useState<
    "all" | "filled" | "pending" | "declined" | "outage"
  >("all");
  const declined = watch.history.filter((record) => oscillatorRecordKind(record) === "declined");
  const filled = watch.history.filter((record) => oscillatorRecordKind(record) === "filled");
  const pending = watch.history.filter((record) => oscillatorRecordKind(record) === "pending");
  const outages = watch.history.filter((record) => oscillatorRecordKind(record) === "outage");
  const exits = watch.history.filter((record) => record.recordType === "exit");
  const filteredRecords = watch.history.filter((record) =>
    recordFilter === "all" ? true : oscillatorRecordKind(record) === recordFilter,
  );
  const notEvaluated = watch.cells.filter(
    (cell) => !["active_long", "active_short", "flat"].includes(cell.status),
  ).length;
  const authority =
    watch.deploymentAllowed || watch.capitalAuthority || watch.orderAuthority
      ? "enabled"
      : "research only · no capital authority";
  const ledgerOrder = describeLedgerOrder(watch);

  return (
    <section className="crypto-section oscillator-section" id="oscillator-watch">
      <OscillatorRegion region="run-identity" className="crypto-hero">
        <div>
          <p className="eyebrow">Forward tracking · frozen oscillator registry</p>
          <h2>Oscillator alpha watch</h2>
          <p>
            {watch.registry.cellsActive} frozen oscillator cells are tracked forward from{" "}
            {watch.evidenceWindowEndsUtc ? formatTimestamp(watch.evidenceWindowEndsUtc) : "the close of the evidence window"}.
            A recorded BUY or SELL is an observation of what the frozen rule did — it is not a
            recommendation, and this set is not established as distinguishable from search noise.
          </p>
        </div>
        <div className="crypto-scan-meta">
          <span><i /> {watch.counts.cellsEvaluated} of {watch.registry.cellsActive} active cells evaluated</span>
          <strong>
            <ProducerIdentifier value={watch.registry.registryId} absent="oscillator-alpha-watch" />
          </strong>
          <small>
            {watch.generatedAt ? formatTimestamp(watch.generatedAt) : "no run recorded"} · run{" "}
            <ProducerIdentifier value={watch.runId} />
          </small>
        </div>
      </OscillatorRegion>

      <div className="crypto-stat-strip" aria-label="Oscillator watch summary">
        <div>
          <span>Recorded now</span>
          <strong>{watch.counts.activeLong}L / {watch.counts.activeShort}S</strong>
          <small>open BUY / SELL observations</small>
        </div>
        <div>
          <span>Pulses declined</span>
          <strong>{declined.length}</strong>
          <small>the frozen evaluator did not take them</small>
        </div>
        <div>
          <span>Cells reporting</span>
          <strong>{watch.counts.cellsEvaluated} / {watch.counts.cellsTotal}</strong>
          <small>{watch.counts.sourceUnavailable} source unavailable · {watch.counts.deferred} deferred</small>
        </div>
        <div>
          <span>Ledger records</span>
          <strong>{watch.historyRecordsAvailable}</strong>
          <small>{watch.history.length} shown · append-only, never rewritten</small>
        </div>
        <div>
          <span>Evidence ends</span>
          <strong>{watch.evidenceWindowEndsUtc ? formatDate(watch.evidenceWindowEndsUtc.slice(0, 10)) : "—"}</strong>
          <small>records after this date are genuinely unseen</small>
        </div>
      </div>

      <div className="etf-evidence-bar" aria-label="Null result for this registry">
        {OSCILLATOR_NULL_RESULT.map((entry) => (
          <div key={entry.label}>
            <span>{entry.label}</span>
            <strong>{entry.value}</strong>
            <small>{entry.detail}</small>
          </div>
        ))}
      </div>

      <div className="crypto-lanes">
        <section className="crypto-lane">
          <div className="crypto-lane-heading">
            <div><p className="eyebrow">Lane 01 · observation log</p><h3>Recorded BUY / SELL</h3></div>
            <span className="lane-pill observe">tracking only</span>
          </div>
          {watch.activeSignals.length > 0 || watch.pendingEntries.length > 0 ? (
            <div className="crypto-opportunity-list">
              {watch.activeSignals.map((signal) => (
                <OscillatorSignalCard
                  key={signal.signalId ?? signal.watchId}
                  asset={signal.asset}
                  oscillator={signal.oscillator}
                  timeframe={signal.timeframe}
                  exitFamily={signal.exitFamily}
                  uiLabel={signal.uiLabel}
                  direction={signal.direction}
                  signalBarOpenUtc={signal.signalBarOpenUtc}
                  entryBarOpenUtc={signal.entryBarOpenUtc}
                  entryPrice={signal.entryPrice}
                  barsHeld={signal.barsHeld}
                  unrealisedGrossReturn={signal.unrealisedGrossReturn}
                  pending={false}
                />
              ))}
              {watch.pendingEntries.map((entry) => (
                <OscillatorSignalCard
                  key={entry.signalId ?? entry.watchId}
                  asset={entry.asset}
                  oscillator={entry.oscillator}
                  timeframe={entry.timeframe}
                  exitFamily={entry.exitFamily}
                  uiLabel={entry.uiLabel}
                  direction={entry.direction}
                  signalBarOpenUtc={entry.signalBarOpenUtc}
                  entryBarOpenUtc={entry.entryBarOpenUtc}
                  entryPrice={null}
                  barsHeld={0}
                  unrealisedGrossReturn={null}
                  pending
                />
              ))}
            </div>
          ) : (
            <div className="crypto-empty">
              <span>0</span>
              <div>
                <strong>No cell is recording a BUY or SELL</strong>
                <p>
                  {notEvaluated} of {watch.counts.cellsTotal} cells produced no evaluation on this
                  run — {watch.counts.sourceUnavailable} source unavailable,{" "}
                  {watch.counts.deferred} deferred, {watch.counts.insufficientHistory} short of
                  warmup, {watch.counts.lifecycleTerminatedBankrupt} lifecycle-terminated. An empty
                  lane here is not the same as a quiet market; the roster below states each
                  cell&apos;s reason.
                </p>
              </div>
            </div>
          )}
          <OscillatorRegion region="observation-log" className="godmode-warning">
            <strong>Tracking only</strong>
            <p>
              <ProducerQuoted value={watch.purpose} attribution={QUOTED_BY_TRACKER} />
            </p>
          </OscillatorRegion>
        </section>

        <section className="crypto-lane">
          <div className="crypto-lane-heading">
            <div><p className="eyebrow">Lane 02 · what was frozen</p><h3>Protocol, friction and runtime</h3></div>
            <span className="lane-pill observe">no capital authority</span>
          </div>
          <div className="crypto-metrics">
            <div>
              <span>ATR bracket</span>
              <strong>
                {watch.protocol
                  ? `stop ${watch.protocol.exits.atr.stopAtr ?? "—"} · target ${watch.protocol.exits.atr.targetAtr ?? "—"} · hold ${watch.protocol.exits.atr.maximumHoldingBars ?? "—"}`
                  : "not recorded"}
              </strong>
            </div>
            <div>
              <span>Round-trip friction</span>
              <strong>{watch.protocol ? `${watch.protocol.friction.totalBpsRoundTrip ?? "—"} bps` : "not recorded"}</strong>
            </div>
            <div>
              <span>Applied to prices</span>
              <strong>{watch.protocol?.friction.appliedToRecordedPrices ? "yes" : "no · recorded prices are gross"}</strong>
            </div>
          </div>
          <OscillatorRegion region="frozen-protocol" className="crypto-metrics">
            <div>
              <span>Runtime</span>
              <strong>
                python <ProducerIdentifier value={watch.runtime.python} /> · pandas{" "}
                <ProducerIdentifier value={watch.runtime.pandas} />
              </strong>
            </div>
            <div>
              <span>Matches frozen protocol</span>
              {/* A template literal, so two producer version strings were
                  interpolated into a sentence of this interface's own. Each is
                  its own marked node now. */}
              <strong>
                {watch.runtime.matchesFrozenProtocol ? (
                  "yes"
                ) : (
                  <>
                    no · frozen at python{" "}
                    <ProducerIdentifier value={watch.runtime.frozenProtocolRuntime?.python} /> /
                    pandas{" "}
                    <ProducerIdentifier value={watch.runtime.frozenProtocolRuntime?.pandas} />
                  </>
                )}
              </strong>
            </div>
            <div>
              <span>Parity assertions</span>
              <strong>{watch.parity.assertionsPassed} passed · {watch.parity.assertionsFailed} failed · {watch.parity.assertionsChecked} checked</strong>
            </div>
          </OscillatorRegion>
          <OscillatorRegion region="frozen-limitations" className="godmode-warning">
            <strong>Known limitations</strong>
            <ul>
              {watch.knownLimitations.map((limitation) => (
                <li key={limitation.quoted}>
                  <ProducerQuoted value={limitation} attribution={QUOTED_BY_TRACKER} />
                </li>
              ))}
            </ul>
          </OscillatorRegion>
        </section>
      </div>

      <section className="opportunity-history">
        <div className="history-heading">
          <div>
            <p className="eyebrow">Registry roster · every cell, deferred included</p>
            <h3>The {watch.counts.cellsTotal} frozen cells</h3>
            <p>
              {watch.counts.sourceUnavailable} source unavailable · {watch.counts.deferred} deferred ·{" "}
              {watch.counts.insufficientHistory} insufficient history ·{" "}
              {watch.counts.lifecycleTerminatedBankrupt} lifecycle terminated · {watch.counts.flat} flat.
            </p>
          </div>
        </div>
        <OscillatorRegion region="selection-rule" className="add-on-definition">
          <strong>Selection rule</strong>
          <span>
            {watch.registry.selectionRule == null ? (
              "not recorded"
            ) : (
              <ProducerQuoted
                value={watch.registry.selectionRule}
                attribution={QUOTED_BY_TRACKER}
              />
            )}
          </span>
        </OscillatorRegion>
        <div className="etf-state-grid">
          {watch.cells.map((cell) => (
            <OscillatorCellCard cell={cell} key={cell.watchId} />
          ))}
        </div>
      </section>

      <section className="opportunity-history">
        <div className="history-heading">
          <div>
            <p className="eyebrow">Append-only ledger · {ledgerOrder.eyebrow}</p>
            <h3>Recent records</h3>
            <p>
              {watch.history.length} of {watch.historyRecordsAvailable} records shown
              {watch.historyTruncated ? `, capped at ${watch.historyCap}` : ""}. {filled.length} entries ·{" "}
              {exits.length} exits · {declined.length} declined · {pending.length} awaiting an entry bar ·{" "}
              {outages.length} not reporting.
            </p>
            <p className="oscillator-ledger-order">{ledgerOrder.sentence}</p>
            {ledgerOrder.dropped.length > 0 && (
              <p className="oscillator-ledger-order dropped">
                Kept out by the {watch.historyCap}-record cap: {ledgerOrder.dropped.join(" · ")}.
              </p>
            )}
          </div>
          <div className="history-filters" role="group" aria-label="Ledger record filter">
            <button className={recordFilter === "all" ? "active" : ""} onClick={() => setRecordFilter("all")}>All <b>{watch.history.length}</b></button>
            <button className={recordFilter === "filled" ? "active" : ""} onClick={() => setRecordFilter("filled")}>Entered <b>{filled.length}</b></button>
            <button className={recordFilter === "pending" ? "active" : ""} onClick={() => setRecordFilter("pending")}>Awaiting entry <b>{pending.length}</b></button>
            <button className={recordFilter === "declined" ? "active" : ""} onClick={() => setRecordFilter("declined")}>Declined by the evaluator <b>{declined.length}</b></button>
            <button className={recordFilter === "outage" ? "active" : ""} onClick={() => setRecordFilter("outage")}>Not reporting <b>{outages.length}</b></button>
          </div>
        </div>
        <div className="add-on-definition">
          <strong>Not taken</strong>
          <span>
            A pulse the frozen lifecycle evaluator declined. It is kept in the ledger and shown in
            its own lane; it is never counted, coloured or rendered as a fill.
          </span>
        </div>
        <OscillatorRegion region="ledger-basis" className="add-on-definition">
          <strong>Base rate</strong>
          <span>
            {watch.ledger.expectedRecordsPerMonthBasis == null ? (
              "not recorded"
            ) : (
              <ProducerQuoted
                value={watch.ledger.expectedRecordsPerMonthBasis}
                attribution={QUOTED_BY_TRACKER}
              />
            )}
          </span>
        </OscillatorRegion>
        {filteredRecords.length > 0 ? (
          <div className="history-grid">
            {filteredRecords.map((record) => (
              <OscillatorRecordCard key={record.recordId} record={record} />
            ))}
          </div>
        ) : (
          <div className="history-empty">
            <strong>No records in this lane</strong>
            <span>The ledger holds {watch.historyRecordsAvailable} records in total.</span>
          </div>
        )}
      </section>

      <OscillatorRegion region="guardrail" className="crypto-guardrail">
        <div>
          <span>Registry</span>
          <strong>
            <ProducerIdentifier value={watch.registry.registryId} /> ·{" "}
            {watch.registry.cellsActive} active · {watch.registry.cellsDeferred} deferred
          </strong>
        </div>
        <div><span>Authority</span><strong>{authority}</strong></div>
        <p>
          tracking_only = true · deployment_allowed = false · capital_authority = false ·
          order_authority = false. Records after the evidence window are genuinely unseen data. The
          append-only ledger is the system of record and this view is a projection of it; where a
          cell is deferred, unavailable, short of warmup or lifecycle-terminated it is labelled as
          such and never as flat.
        </p>
      </OscillatorRegion>
    </section>
  );
}

function XgbShowcase({ showcase }: { showcase: XgbShowcaseSnapshot }) {
  const models = [...showcase.models, showcase.futureWatch];
  const defaultModel = showcase.models.find((model) => model.id === "chatty-pruned") ?? showcase.futureWatch;
  const [selectedId, setSelectedId] = useState(defaultModel.id);
  const selected = models.find((model) => model.id === selectedId) ?? defaultModel;
  const holdout = showcase.comparisonHoldout;

  return (
    <section className="xgb-showcase" id="xgb-models">
      <div className="xgb-hero">
        <div>
          <p className="eyebrow">Arbitra model lineage · evidence first</p>
          <h1>Call the champions<br />forth from the shadows.</h1>
          <p>Four XGBoost lineages have earned a place in the light—each for a different, explicitly labeled kind of evidence. Select a model to inspect its crown, basket, and burden of proof.</p>
        </div>
        <div className="xgb-seal" aria-label="Research-only model status">
          <span>MODELS</span>
          <strong>{models.length}</strong>
          <small>deployment locked</small>
        </div>
      </div>

      <div className="xgb-ledger" aria-label="XGBoost evidence summary">
        <div><span>Frozen holdout</span><strong>{holdout.rows}</strong><small>{holdout.start} → {holdout.end}</small></div>
        <div><span>Class balance</span><strong>{holdout.longLabels} / {holdout.shortLabels}</strong><small>LONG / SHORT labels</small></div>
        <div><span>Research crowns</span><strong>{showcase.models.length}</strong><small>raw, balance, and composite</small></div>
        <div><span>Future watch</span><strong>01</strong><small>no historical holdout claim</small></div>
      </div>

      <div className="xgb-stage">
        <div className="xgb-model-grid" role="list" aria-label="XGBoost model champions">
          {models.map((model, index) => (
            <button
              type="button"
              className={`xgb-model-card ${model.id === selected.id ? "selected" : ""} ${model.id === showcase.futureWatch.id ? "future" : ""}`}
              onClick={() => setSelectedId(model.id)}
              aria-pressed={model.id === selected.id}
              aria-label={`${model.name}, ${model.title}; open model evidence`}
              key={model.id}
            >
              <div className="xgb-card-index"><span>0{index + 1}</span><b>{model.id === showcase.futureWatch.id ? "WATCH" : "CROWN"}</b></div>
              <div className="xgb-card-name"><small>{model.title}</small><strong>{model.name}</strong></div>
              <p>{model.crown}</p>
              <div className="xgb-card-score">
                <span>{model.innerBalancedAccuracy != null ? "Inner WF BA" : "Macro F1"}</span>
                <strong>{modelMetric(model.innerBalancedAccuracy ?? model.macroF1)}</strong>
              </div>
            </button>
          ))}
        </div>

        <article className="xgb-model-detail" aria-live="polite">
          <div className="xgb-detail-head">
            <div><p className="eyebrow">Selected lineage</p><h2>{selected.name}</h2><span>{selected.title}</span></div>
            <b>{selected.status}</b>
          </div>

          <div className="xgb-metric-grid">
            <div><span>Macro F1</span><strong>{modelMetric(selected.macroF1)}</strong></div>
            <div><span>Balanced accuracy</span><strong>{modelMetric(selected.balancedAccuracy)}</strong></div>
            <div><span>Accuracy</span><strong>{modelMetric(selected.accuracy)}</strong></div>
            <div><span>Inner WF BA</span><strong>{modelMetric(selected.innerBalancedAccuracy)}</strong></div>
          </div>

          <div className="xgb-detail-body">
            <div>
              <span className="xgb-label">Why it stands here</span>
              <h3>{selected.crown}</h3>
              <p>{selected.evidenceClass} · {selected.objective}</p>
              <dl className="xgb-facts">
                <div><dt>Basket</dt><dd>{selected.candidatePolicy}</dd></div>
                {selected.trainingRows && <div><dt>Training rows</dt><dd>{selected.trainingRows.toLocaleString()}</dd></div>}
                {selected.trainingCutoff && <div><dt>Frozen cutoff</dt><dd>{selected.trainingCutoff}</dd></div>}
                {selected.runId && <div><dt>Evidence run</dt><dd>{selected.runId}</dd></div>}
                {selected.registeredVersion && <div><dt>Registered</dt><dd>Version {selected.registeredVersion}</dd></div>}
              </dl>
            </div>
            <div>
              <span className="xgb-label">Surviving basket</span>
              <ul className="xgb-feature-list">
                {selected.composition.map((feature) => <li key={feature}>{feature}</li>)}
              </ul>
            </div>
          </div>

          <div className="xgb-caution">
            <div><span>Burden of proof</span><p>{selected.caution}</p></div>
            <small>Evidence ledger · {selected.evidencePath}</small>
          </div>
        </article>
      </div>

      <div className="xgb-exclusions">
        <span>Kept out of the spotlight</span>
        {showcase.exclusions.map((exclusion) => <p key={exclusion}>{exclusion}</p>)}
      </div>

      <div className="xgb-guardrail">
        <span>Research only · frozen evidence, not live trade authority</span>
        <strong>{showcase.deploymentAllowed || showcase.capitalAuthority ? "AUTHORITY ENABLED" : "deployment_allowed = false · capital_authority = false"}</strong>
      </div>
    </section>
  );
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function universeLabel(job: DataJob) {
  if (job.request.universe.type === "top_weighted") return `Top ${job.request.universe.limit} by SPY weight`;
  if (job.request.universe.type === "symbols") return `${job.request.universe.symbols.length} explicit ticker${job.request.universe.symbols.length === 1 ? "" : "s"}`;
  return "All current SPY constituents";
}

function jobStatusLabel(status: DataJob["status"]) {
  const labels: Record<DataJob["status"], string> = {
    queued: "Queued",
    running: "Running",
    cancel_requested: "Stopping",
    cancelled: "Cancelled",
    completed: "Complete",
    failed: "Failed",
  };
  return labels[status];
}

function DataAcquisitionConsole() {
  const [token, setToken] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [scope, setScope] = useState<"top10" | "top50" | "symbols" | "all">("top10");
  const [symbols, setSymbols] = useState("");
  const [confirmAll, setConfirmAll] = useState(false);
  const [jobs, setJobs] = useState<DataJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Enter the platform access token to load the private job ledger.");

  useEffect(() => {
    const dateInNewYork = (value: Date) => new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(value);
    const timeout = window.setTimeout(() => {
      const now = new Date();
      const latest = new Date(now);
      latest.setUTCDate(latest.getUTCDate() - 1);
      const earliest = new Date(now);
      earliest.setUTCFullYear(earliest.getUTCFullYear() - 2);
      setRangeStart(dateInNewYork(earliest));
      setRangeEnd(dateInNewYork(latest));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const authorizedFetch = useCallback(async (pathname: string, init: RequestInit = {}) => {
    if (!token) throw new Error("Enter the platform access token first.");
    const response = await fetch(pathname, {
      ...init,
      cache: "no-store",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? payload.status ?? `Request failed (${response.status})`);
    return payload;
  }, [token]);

  const refreshJobs = useCallback(async (quiet = false) => {
    if (!token) return;
    if (!quiet) setBusy(true);
    try {
      const payload = await authorizedFetch("/api/data-jobs");
      setJobs(payload.jobs ?? []);
      setMessage(payload.jobs?.length ? "Private acquisition ledger loaded." : "No acquisition jobs yet.");
    } catch (error) {
      setMessage(String((error as Error).message ?? error));
    } finally {
      if (!quiet) setBusy(false);
    }
  }, [authorizedFetch, token]);

  useEffect(() => {
    if (!token || !jobs.some((job) => ["queued", "running", "cancel_requested"].includes(job.status))) return;
    const interval = window.setInterval(() => void refreshJobs(true), 5_000);
    return () => window.clearInterval(interval);
  }, [token, jobs, refreshJobs]);

  const createJob = async () => {
    setBusy(true);
    try {
      const universe = scope === "top10"
        ? { type: "top_weighted", limit: 10 }
        : scope === "top50"
          ? { type: "top_weighted", limit: 50 }
          : scope === "symbols"
            ? { type: "symbols", symbols: symbols.split(/[\s,]+/).filter(Boolean) }
            : { type: "all_constituents" };
      const payload = await authorizedFetch("/api/data-jobs", {
        method: "POST",
        body: JSON.stringify({
          rangeStart,
          rangeEnd,
          universe,
          includeRaw: true,
          createTickerBundles: true,
          ...(scope === "all" && confirmAll ? { confirmation: "DOWNLOAD ALL CURRENT SPY CONSTITUENTS" } : {}),
        }),
      });
      setJobs((current) => [payload.job, ...current]);
      setMessage(`${universeLabel(payload.job)} acquisition queued.`);
    } catch (error) {
      setMessage(String((error as Error).message ?? error));
    } finally {
      setBusy(false);
    }
  };

  const cancelJob = async (job: DataJob) => {
    setBusy(true);
    try {
      const payload = await authorizedFetch(`/api/data-jobs/${encodeURIComponent(job.id)}/cancel`, {
        method: "POST",
        body: "{}",
      });
      setJobs((current) => current.map((item) => item.id === job.id ? payload.job : item));
      setMessage(`${universeLabel(job)} job is stopping safely.`);
    } catch (error) {
      setMessage(String((error as Error).message ?? error));
    } finally {
      setBusy(false);
    }
  };

  const downloadArtifact = async (job: DataJob, artifact: DataJobArtifact) => {
    setBusy(true);
    try {
      const payload = await authorizedFetch(
        `/api/data-jobs/${encodeURIComponent(job.id)}/artifacts/${encodeURIComponent(artifact.id)}`,
      );
      window.location.assign(payload.url);
      setMessage(`${artifact.label} download authorized for 15 minutes.`);
    } catch (error) {
      setMessage(String((error as Error).message ?? error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="data-console" id="data-acquisition">
      <div className="data-console-hero">
        <div>
          <p className="eyebrow">Elijah&apos;s Ravens · Massive stock history</p>
          <h2>Historical data acquisition</h2>
          <p>Queue resumable, oldest-first one-minute SPY constituent downloads. The platform tracks every provider page; the private bucket keeps the immutable evidence and downloadable ticker bundles.</p>
        </div>
        <div className="data-console-lock">
          <label><span>Platform access token</span><input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Required to manage jobs" /></label>
          <button type="button" disabled={!token || busy} onClick={() => void refreshJobs()}>{busy ? "Working…" : "Unlock ledger"}</button>
        </div>
      </div>

      <div className="data-job-builder">
        <label><span>Oldest session</span><input type="date" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} /></label>
        <label><span>Completed through</span><input type="date" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} /></label>
        <label><span>SPY universe</span><select value={scope} onChange={(event) => { setScope(event.target.value as typeof scope); setConfirmAll(false); }}><option value="top10">Top 10 pilot</option><option value="top50">Top 50</option><option value="symbols">Explicit tickers</option><option value="all">All current constituents</option></select></label>
        {scope === "symbols" && <label className="data-symbols"><span>Tickers</span><input value={symbols} onChange={(event) => setSymbols(event.target.value.toUpperCase())} placeholder="NVDA, AAPL, MSFT" /></label>}
        {scope === "all" && <label className="data-confirm"><input type="checkbox" checked={confirmAll} onChange={(event) => setConfirmAll(event.target.checked)} /><span>I confirm the full current SPY universe. Estimated runtime may exceed eight hours.</span></label>}
        <button className="data-queue-button" type="button" disabled={!token || busy || !rangeStart || !rangeEnd || (scope === "all" && !confirmAll) || (scope === "symbols" && !symbols.trim())} onClick={() => void createJob()}>Queue acquisition</button>
      </div>

      <div className="data-console-message" role="status"><i />{message}</div>
      <div className="data-job-list" aria-live="polite">
        {jobs.map((job) => {
          const denominator = job.progress.symbolsTotal || (job.request.universe.type === "top_weighted" ? job.request.universe.limit : job.request.universe.type === "symbols" ? job.request.universe.symbols.length : 503);
          const done = job.progress.symbolsCompleted + job.progress.symbolsFailed;
          const percent = denominator ? Math.min(100, (done / denominator) * 100) : 0;
          return (
            <article className={`data-job ${job.status}`} key={job.id}>
              <div className="data-job-head"><div><strong>{universeLabel(job)}</strong><span>{job.request.rangeStart} → {job.request.rangeEnd}</span></div><b>{jobStatusLabel(job.status)}</b></div>
              <div className="data-progress"><span style={{ width: `${percent}%` }} /></div>
              <div className="data-job-metrics"><span><b>{done}</b> / {denominator} tickers</span><span><b>{job.progress.pagesCompleted}</b> pages</span><span><b>{job.progress.providerCalls}</b> calls</span><span><b>{job.progress.rowsWritten.toLocaleString()}</b> rows</span><span><b>{formatBytes(job.progress.bytesUploaded)}</b> uploaded</span></div>
              {job.progress.currentTicker && <p>Now acquiring <strong>{job.progress.currentTicker}</strong></p>}
              {job.error && <p className="data-job-error">{job.error}</p>}
              <footer>
                <span>{formatTimestamp(job.updatedAt)} · research-only unadjusted 1m lineage</span>
                <div>
                  {["queued", "running"].includes(job.status) && <button type="button" disabled={busy} onClick={() => void cancelJob(job)}>Stop safely</button>}
                  {job.status === "completed" && job.artifacts.map((artifact) => <button type="button" disabled={busy} onClick={() => void downloadArtifact(job, artifact)} key={artifact.id}>{artifact.ticker ?? artifact.kind} · {formatBytes(artifact.size)}</button>)}
                </div>
              </footer>
            </article>
          );
        })}
        {token && jobs.length === 0 && <div className="data-jobs-empty"><strong>No historical jobs yet</strong><span>The top-ten two-year pilot is the recommended first run.</span></div>}
      </div>
      <div className="data-console-guardrail"><span>Canonical</span><strong>Unadjusted 1m · no missing-minute fill · pre / regular / post labelled separately</strong><p>Current constituents applied retrospectively are survivorship-biased until historical membership evidence is added.</p></div>
    </section>
  );
}

export default function Home() {
  const [snapshot, setSnapshot] = useState<Snapshot>(bundledSnapshot);
  const [selectedDate, setSelectedDate] = useState(bundledTradeDatasets[0]?.date ?? "");
  const [assetSymbol, setAssetSymbol] = useState("");
  const dateWasSelected = useRef(false);
  const validTradeDatasets = useMemo(
    () => snapshot.datasets.filter((dataset) => dataset.assets.length > 0).slice(0, 30),
    [snapshot],
  );

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/data/arbitra-snapshot.json", {
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        if (!response.ok) return;
        const next: unknown = await response.json();
        if (!active || !isSafeRuntimeSnapshot(next)) return;
        setSnapshot(next);
        if (!dateWasSelected.current) {
          const latest = next.datasets.find((dataset) => dataset.assets.length > 0)?.date ?? "";
          setSelectedDate(latest);
          setAssetSymbol("");
        }
      } catch {
        // Preserve the bundled or last accepted snapshot when the runtime feed is unavailable.
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 5 * 60 * 1000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  const dataset = snapshot.datasets.find((item) => item.date === selectedDate);
  const stockAssets = dataset?.assets ?? [];
  const asset = stockAssets.find((item) => item.symbol === assetSymbol) ?? stockAssets[0] ?? null;
  const profile = asset ? snapshot.profiles[asset.symbol] : null;
  const entryPrice = asset?.close == null ? null : asset.close * (1 - STOCK_ENTRY_PULLBACK_PERCENT / 100);
  const targetPrice = entryPrice == null ? null : entryPrice * (1 + STOCK_TARGET_PERCENT / 100);
  const fullyConfirmed = stockAssets.filter((item) => stockIndicatorCount(item) === 4).length;
  const parentOnly = stockAssets.filter((item) => stockIndicatorCount(item) === 1).length;
  const selector = snapshot.stockSelector;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="topbar">
          <div className="brand-lockup">
            <div className="brand">
              <span className="brand-mark">A</span>
              <div><strong>ARBITRA</strong><small>Market Signals</small></div>
            </div>
            <p className="brand-tagline">Setups,<br />without the noise.</p>
          </div>

          <div className="header-asset" aria-live="polite">
            <div className="header-asset-context">
              <span>Selected stock setup</span>
              <small>Daily scan · {stockAssets.length} opportunities</small>
            </div>
            <div className="header-asset-identity">
              <strong>{asset?.symbol ?? "No setup"}</strong>
              {asset && <b>{price(asset.close)}</b>}
            </div>
            <label className="header-asset-picker">
              <span className="sr-only">Eligible asset</span>
              <select
                aria-label="Eligible asset"
                value={asset?.symbol ?? ""}
                disabled={stockAssets.length === 0}
                onChange={(event) => setAssetSymbol(event.target.value)}
              >
                {stockAssets.length === 0 ? (
                  <option value="">No eligible assets</option>
                ) : stockAssets.map((item) => (
                  <option key={item.symbol} value={item.symbol}>{item.symbol} — {item.name}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="date-picker">
            <span>Signal date</span>
            <select
              aria-label="Signal date"
              value={selectedDate}
              onChange={(event) => {
                dateWasSelected.current = true;
                setSelectedDate(event.target.value);
                setAssetSymbol("");
              }}
            >
              {validTradeDatasets.map((item) => (
                <option key={item.date} value={item.date}>
                  {formatDate(item.date)} — {item.assets.length} setup{item.assets.length === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="authority-strip">
          <nav aria-label="Market sections"><a href="/" aria-current="page">Stock Picker</a><a href="/oscillators">Crypto Scanner</a></nav>
          <div className="market-state"><i /> completed candles only</div>
          <span>Indicator states are causal · setups are research references · no order routing</span>
        </div>

      </header>

      <main>
        <section className="crypto-section stock-section" id="daily-longs">
          <div className="crypto-hero">
            <div>
              <p className="eyebrow">Daily · completed stock candles</p>
              <h2>Daily stock opportunities</h2>
              <p>Each card shows the parent signal, the complementary indicators currently lit, and a concrete reference entry and exit. Click any card to open its company detail.</p>
            </div>
            <div className="crypto-scan-meta">
              <span><i /> {selector?.status === "accepted" ? "latest market scan accepted" : selector ? "latest local market scan" : "daily scan complete"}</span>
              <strong>{formatDate(selector?.dataThrough ?? dataset?.date ?? "")}</strong>
              <small>{selector ? `${selector.opportunities} setup${selector.opportunities === 1 ? "" : "s"} · ${selector.analyzed.toLocaleString()} analyzed · ${selector.provider}` : formatTimestamp(dataset?.generatedAt ?? "")}</small>
            </div>
          </div>

          <div className="crypto-stat-strip" aria-label="Daily stock scan summary">
            <div><span>Current setups</span><strong>{stockAssets.length}</strong><small>parent SMC + PPO signals</small></div>
            <div><span>Full confirmation</span><strong>{fullyConfirmed}</strong><small>all four strategy lights on</small></div>
            <div><span>Parent only</span><strong>{parentOnly}</strong><small>no complementary gate lit</small></div>
            <div><span>Universe scanned</span><strong>{dataset?.universe.toLocaleString() ?? "—"}</strong><small>{dataset?.exactDateAnalyzed.toLocaleString() ?? 0} exact-date rows</small></div>
            <div><span>Integrity rejects</span><strong>{(dataset?.qualityRejected ?? 0) + (dataset?.analysisFailed ?? 0) + (dataset?.historyMissing ?? 0)}</strong><small>quality, analysis, or history</small></div>
          </div>

          <section className="suggested-setup stock-suggested-setup" aria-label="Selected stock reference trade setup">
            <div className="suggested-copy">
              <p className="eyebrow">Indicator-led research plan</p>
              <h3>Reference trade setup</h3>
              <p>The setup tier follows the lights on the selected card. Price geometry is fixed and descriptive; the signal label is driven by confirmations, not a score.</p>
              {asset && (
                <div className="confirmation-chain">
                  <span>SMC + PPO</span><i>+</i>
                  <span>{asset.atr10Pass ? "ATR lit" : "ATR off"}</span><i>+</i>
                  <span>{asset.bb40Pass ? "BB lit" : "BB off"}</span><i>+</i>
                  <span>{asset.ema20Pass ? "EMA lit" : "EMA off"}</span>
                </div>
              )}
            </div>
            {asset ? (
              <article className="live-plan">
                <div className="live-plan-head">
                  <strong>{asset.symbol}</strong>
                  <b>{stockSetupLabel(asset)} · {stockIndicatorCount(asset)}/4 lit</b>
                </div>
                <div className="live-plan-prices">
                  <div><span>Entry · limit buy</span><strong>{price(entryPrice)}</strong><small>−{STOCK_ENTRY_PULLBACK_PERCENT}% from signal close</small></div>
                  <i>→</i>
                  <div><span>Exit · target</span><strong>{price(targetPrice)}</strong><small>+{STOCK_TARGET_PERCENT}% from entry</small></div>
                </div>
                <footer><span>5 daily candles to enter</span><span>20 after fill</span><span>No modeled stop</span><span>No order authority</span></footer>
              </article>
            ) : (
              <div className="no-live-plan"><span>0</span><div><strong>No stock setup on this date</strong><p>Select another completed signal date to review its opportunities.</p></div></div>
            )}
          </section>

          <div className="stock-lanes">
            <section className="crypto-lane stock-list-lane">
              <div className="crypto-lane-heading">
                <div><p className="eyebrow">Signal cards</p><h3>Indicator-lit setups</h3></div>
                <span className="lane-pill long">{stockAssets.length} long</span>
              </div>
              <p className="stock-lane-note">Green lights passed their causal threshold. An unlit add-on never removes the parent opportunity.</p>
              {stockAssets.length ? (
                <div className="stock-opportunity-grid">
                  {stockAssets.map((item) => (
                    <StockOpportunityCard
                      asset={item}
                      selected={item.symbol === asset?.symbol}
                      onSelect={() => setAssetSymbol(item.symbol)}
                      key={item.symbol}
                    />
                  ))}
                </div>
              ) : (
                <div className="crypto-empty"><span>0</span><div><strong>No daily stock signal</strong><p>No parent setup survived the completed-candle scan on this date.</p></div></div>
              )}
            </section>

            <aside className="crypto-lane stock-company-lane" aria-live="polite">
              <section className="company-profile" aria-label="Company profile">
                <div className="company-profile-heading">
                  <div><p className="eyebrow">Company detail</p><h2>{profile?.longName ?? asset?.name ?? "Select a stock card"}</h2></div>
                  {profile && <span>Yahoo</span>}
                </div>
                {asset && profile?.available ? (
                  <>
                    <dl className="company-facts">
                      <div><dt>Industry</dt><dd>{profile.industry || "Not reported"}</dd></div>
                      <div><dt>Sector</dt><dd>{profile.sector || "Not reported"}</dd></div>
                      <div><dt>Employees</dt><dd>{profile.employees?.toLocaleString("en-US") ?? "Not reported"}</dd></div>
                      <div><dt>Headquarters</dt><dd>{companyLocation(profile)}</dd></div>
                    </dl>
                    <div className="company-summary">
                      <span>What they do</span>
                      <p>{profile.description || "Yahoo does not currently provide a business summary for this asset."}</p>
                    </div>
                    <div className="company-links">
                      <a href={profile.sourceUrl} target="_blank" rel="noreferrer">Yahoo Finance ↗</a>
                      {profile.website && <a href={profile.website} target="_blank" rel="noreferrer">Company site ↗</a>}
                    </div>
                  </>
                ) : asset ? (
                  <div className="company-empty">
                    <p>Company details are not currently available for this stock.</p>
                    {profile && <a href={profile.sourceUrl} target="_blank" rel="noreferrer">Open Yahoo Finance ↗</a>}
                  </div>
                ) : (
                  <div className="company-empty"><p>Choose a stock card to see company details and exact indicator readings.</p></div>
                )}
              </section>

              {asset && (
                <section className="stock-detail-gates" aria-label="Selected stock indicator readings">
                  <div className="stock-detail-heading"><span>Selected signal</span><strong>{asset.symbol} · {price(asset.close)}</strong></div>
                  <div className="stock-gate-grid">
                    <Gate label="ATR(10) / close" value={`${points(asset.atr10Percent)}%`} threshold={`${points(asset.atr10ThresholdPercent)}% q70`} pass={asset.atr10Pass} />
                    <Gate label="BB width(40)" value={points(asset.bb40Width)} threshold={`${points(asset.bb40Threshold)} q80`} pass={asset.bb40Pass} />
                    <Gate label="EMA20 extension" value={`${points(asset.ema20DistancePercent)}%`} threshold={`${points(asset.ema20ThresholdPercent)}% q90`} pass={asset.ema20Pass} />
                    <div className={`gate ${asset.emaBullStack ? "pass" : "miss"}`}>
                      <span>EMA structure</span>
                      <strong>{asset.emaBullStack ? "5 > 10 > 20 > 50" : "mixed"}</strong>
                      <small>{asset.launchWatch ? "launch watch · research only" : "supporting context"}</small>
                    </div>
                  </div>
                </section>
              )}
            </aside>
          </div>

          <div className="crypto-guardrail">
            <div><span>Signal basis</span><strong>SMC liquidity acceptance + PPO below its prior median</strong></div>
            <div><span>Authority</span><strong>research only · no capital authority</strong></div>
            <p>ATR, Bollinger width, and EMA extension are displayed as complementary lights. They strengthen the label but are not permitted to create a stock signal independently. Entries and exits are research references, not routed orders.</p>
          </div>
        </section>
      </main>

      <footer>
        <span>Arbitra Market Signals</span>
        <span>Snapshot v{snapshot.schemaVersion} · {snapshot.deploymentAllowed ? "deployment enabled" : "research only"}</span>
      </footer>
    </div>
  );
}
