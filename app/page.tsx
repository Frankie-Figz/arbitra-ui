"use client";

import { useState } from "react";
import snapshotJson from "../public/data/arbitra-snapshot.json";

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
  xgbShowcase: XgbShowcaseSnapshot;
  etf: EtfSnapshot | null;
  crypto: CryptoSnapshot | null;
  history: {
    startDate: string | null;
    endDate: string | null;
    entryWindowCompletedCandles: number;
    targetWindowCompletedCandlesAfterFill: number;
    unfilledTargetMarkWindowCompletedCandles: number;
  };
};

const snapshot = snapshotJson as Snapshot;
const validTradeDatasets = snapshot.datasets.filter((dataset) => dataset.assets.length > 0).slice(0, 30);
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

export default function Home() {
  const [selectedDate, setSelectedDate] = useState(validTradeDatasets[0]?.date ?? "");
  const [assetSymbol, setAssetSymbol] = useState("");

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
          <nav aria-label="Market sections"><a href="#xgb-models">XGB champions</a><a href="#daily-longs">Stock daily</a><a href="#etf-opportunities">ETF daily</a><a href="#crypto-opportunities">Crypto hourly</a></nav>
          <div className="market-state"><i /> completed candles only</div>
          <span>Indicator states are causal · setups are research references · no order routing</span>
        </div>

      </header>

      <main>
        <XgbShowcase showcase={snapshot.xgbShowcase} />
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
        {snapshot.etf && <EtfOpportunities etf={snapshot.etf} />}
        {snapshot.crypto && <CryptoOpportunities crypto={snapshot.crypto} />}
      </main>

      <footer>
        <span>Arbitra Market Signals</span>
        <span>Snapshot v{snapshot.schemaVersion} · {snapshot.deploymentAllowed ? "deployment enabled" : "research only"}</span>
      </footer>
    </div>
  );
}
