import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const uiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arbitraRoot = resolve(
  process.env.ARBITRA_REPO ?? resolve(uiRoot, "..", "Arbitra"),
);
const outputPath = resolve(uiRoot, "public", "data", "arbitra-snapshot.json");
const historyPath = resolve(uiRoot, "public", "data", "arbitra-daily-history.json");

const methodologies = [
  {
    id: "smc-ppo",
    name: "SMC + PPO",
    shortName: "Parent",
    description: "Liquidity accepted above resistance while PPO(21,38,7) sits below its strictly prior median.",
    gate: "Parent signal + tradability",
    confirmationSignals: 2452,
  },
  {
    id: "smc-ppo-atr10",
    name: "SMC + PPO + ATR(10)",
    shortName: "ATR pace",
    description: "The parent long plus ATR(10)/close at or above the asset's strictly prior 70th percentile.",
    gate: "Parent + ATR q70",
    confirmationSignals: 370,
  },
  {
    id: "smc-ppo-atr10-bb40",
    name: "SMC + PPO + ATR(10) + BB(40)",
    shortName: "ATR + BB",
    description: "The ATR-qualified long plus Bollinger width(40) at or above its strictly prior 80th percentile.",
    gate: "Parent + ATR q70 + BB q80",
    confirmationSignals: 180,
  },
  {
    id: "smc-ppo-atr10-ema20",
    name: "SMC + PPO + ATR(10) + EMA(20)",
    shortName: "ATR + EMA",
    description: "The ATR-qualified long plus close/EMA(20)-1 at or above its strictly prior 90th percentile.",
    gate: "Parent + ATR q70 + EMA extension q90",
    confirmationSignals: 332,
  },
];

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (character !== "\r") {
      cell += character;
    }
  }

  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [headers = [], ...body] = rows;
  return body
    .filter((values) => values.some((value) => value !== ""))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

async function readCsv(path) {
  return parseCsv(await readFile(path, "utf8"));
}

function numeric(value) {
  const parsed = Number(value);
  return value === "" || !Number.isFinite(parsed) ? null : parsed;
}

function truthy(value) {
  return String(value).toLowerCase() === "true";
}

function datePart(value) {
  return String(value ?? "").slice(0, 10);
}

function normalizeAsset(row) {
  const methodIds = ["smc-ppo"];
  if (truthy(row.actionable_ppo_atr10)) methodIds.push("smc-ppo-atr10");
  if (truthy(row.actionable_ppo_atr10_bb40)) methodIds.push("smc-ppo-atr10-bb40");
  if (truthy(row.actionable_ppo_atr10_ema20)) methodIds.push("smc-ppo-atr10-ema20");
  return {
    symbol: row.symbol,
    name: row.name,
    instrumentFamily: row.instrument_family,
    exchange: row.exchange,
    signalDate: datePart(row.signal_timestamp),
    close: numeric(row.close),
    ppo: numeric(row.ppo_histogram_21_38_7),
    ppoPriorMedian: numeric(row.ppo_prior_expanding_median),
    atr10Percent: numeric(row.atr10_percent),
    atr10ThresholdPercent: numeric(row.atr10_prior_q70_percent),
    atr10Pass: truthy(row.atr10_pass),
    bb40Width: numeric(row.bollinger_width_40),
    bb40Threshold: numeric(row.bollinger_width_40_prior_q80),
    bb40Pass: truthy(row.bollinger_width_40_pass),
    ema20DistancePercent: numeric(row.ema20_distance_percent),
    ema20ThresholdPercent: numeric(row.ema20_distance_prior_q90_percent),
    ema20Pass: truthy(row.ema20_distance_pass),
    ema5: numeric(row.ema5),
    ema10: numeric(row.ema10),
    ema20: numeric(row.ema20),
    ema50: numeric(row.ema50),
    emaBullStack: truthy(row.ema_bull_stack_5_10_20_50),
    launchWatch: truthy(row.launch_discontinuity_watch),
    methodologies: methodIds,
    evaluationMature: false,
    evaluationThrough: null,
    realizedOutcomes: [],
  };
}

async function collectDailyScans() {
  const root = resolve(arbitraRoot, "artifacts", "yahoo-liquidity-sniper");
  if (!existsSync(root)) return [];
  const directories = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  const newestByDate = new Map();

  for (const directory of directories) {
    const reportPath = resolve(root, directory.name, "report.json");
    const scanPath = resolve(root, directory.name, "latest-ppo-scan.csv");
    if (!existsSync(reportPath) || !existsSync(scanPath)) continue;
    const report = await readJson(reportPath);
    const date = String(report.completed_through ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const generatedAt = String(report.generated_utc ?? "");
    const prior = newestByDate.get(date);
    if (!prior || generatedAt.localeCompare(prior.generatedAt) > 0) {
      newestByDate.set(date, { date, generatedAt, report, scanPath, run: directory.name });
    }
  }

  const datasets = [];
  for (const candidate of newestByDate.values()) {
    const rows = await readCsv(candidate.scanPath);
    const analyzedStatuses = new Set(["green", "quality_rejected", "not_green"]);
    const exactRows = rows.filter(
      (row) => analyzedStatuses.has(row.status) && datePart(row.signal_timestamp) === candidate.date,
    );
    const assets = exactRows
      .filter((row) => row.status === "green")
      .map(normalizeAsset)
      .sort(
        (left, right) =>
          right.methodologies.length - left.methodologies.length ||
          Number(right.launchWatch) - Number(left.launchWatch) ||
          left.symbol.localeCompare(right.symbol),
      );
    const staleAnalyzed = rows.filter(
      (row) => analyzedStatuses.has(row.status) && datePart(row.signal_timestamp) !== candidate.date,
    ).length;
    datasets.push({
      date: candidate.date,
      generatedAt: candidate.generatedAt,
      sourceRun: candidate.run,
      universe: Number(candidate.report.universe_symbols ?? rows.length),
      exactDateAnalyzed: exactRows.length,
      staleAnalyzed,
      historyMissing: Number(candidate.report.history_missing ?? 0),
      analysisFailed: Number(candidate.report.analysis_failed ?? 0),
      qualityRejected: exactRows.filter((row) => row.status === "quality_rejected").length,
      assets,
    });
  }
  return datasets.sort((left, right) => right.date.localeCompare(left.date));
}

async function readWideMatrix(path) {
  const rows = await readCsv(path);
  const values = new Map();
  for (const row of rows) {
    const pullbackPercent = Number(String(row.pullback).replace("%", ""));
    for (const [target, value] of Object.entries(row)) {
      if (target === "pullback") continue;
      const targetPercent = Number(target.replace("%", ""));
      values.set(`${pullbackPercent}|${targetPercent}`, Number(value));
    }
  }
  return values;
}

async function collectMatrices() {
  const playbook = resolve(arbitraRoot, "docs", "ppo-pullback-playbook", "data");
  const parent = resolve(
    arbitraRoot,
    "artifacts",
    "liquidity-ppo-atr-pullback-target-grid-v1",
    "platform-full-20260810",
  );
  const sources = [
    {
      methodologyId: "smc-ppo",
      conditional: resolve(parent, "confirmation-unfiltered-conditional-hit-rate.csv"),
      perSignal: resolve(parent, "confirmation-unfiltered-success-per-signal.csv"),
    },
    {
      methodologyId: "smc-ppo-atr10",
      conditional: resolve(playbook, "atr10-conditional-hit-rate.csv"),
      perSignal: resolve(playbook, "atr10-success-per-signal.csv"),
    },
    {
      methodologyId: "smc-ppo-atr10-bb40",
      conditional: resolve(playbook, "atr10-bb40-conditional-hit-rate.csv"),
      perSignal: resolve(playbook, "atr10-bb40-success-per-signal.csv"),
    },
    {
      methodologyId: "smc-ppo-atr10-ema20",
      conditional: resolve(playbook, "atr10-ema20-conditional-hit-rate.csv"),
      perSignal: resolve(playbook, "atr10-ema20-success-per-signal.csv"),
    },
  ];

  const matrices = [];
  for (const source of sources) {
    const [conditional, perSignal] = await Promise.all([
      readWideMatrix(source.conditional),
      readWideMatrix(source.perSignal),
    ]);
    const cells = [...conditional.entries()]
      .map(([key, conditionalHitRate]) => {
        const [pullbackPercent, targetPercent] = key.split("|").map(Number);
        return {
          pullbackPercent,
          targetPercent,
          conditionalHitRate,
          successPerSignal: perSignal.get(key),
        };
      })
      .sort(
        (left, right) =>
          left.pullbackPercent - right.pullbackPercent || left.targetPercent - right.targetPercent,
      );
    matrices.push({ methodologyId: source.methodologyId, cells });
  }
  return matrices;
}

function normalizeCryptoOrder(row) {
  return {
    pushPercent: numeric(row.push_percent),
    targetPercent: numeric(row.target_percent),
    limitPrice: numeric(row.limit_price),
    plannedEntryPrice: numeric(row.planned_entry_price || row.limit_price),
    plannedExitPrice: numeric(row.planned_exit_price),
    orderState: row.order_state,
    barsRemainingToFill: numeric(row.bars_remaining_to_fill),
    entryPrice: numeric(row.entry_price),
    targetPrice: numeric(row.target_price),
    barsRemainingToTarget: numeric(row.bars_remaining_to_target),
  };
}

function normalizeRsiCandidate(rows) {
  const row = rows[0];
  return {
    setupId: row.setup_id,
    researchStatus: row.research_status,
    eligibleForActiveOutput: truthy(row.eligible_for_active_output),
    instrumentId: row.instrument_id,
    baseAsset: row.base_asset,
    quoteCurrency: row.quote_currency,
    insideOriginalSevenAssets: truthy(row.inside_original_seven_assets),
    timeframe: row.timeframe,
    rsiPeriod: numeric(row.rsi_period),
    emaFast: numeric(row.ema_fast),
    emaSlow: numeric(row.ema_slow),
    signalAvailableAt: row.signal_available_at,
    signalClose: numeric(row.signal_close),
    latestClose: numeric(row.latest_close),
    barsSinceSignal: numeric(row.bars_since_signal),
    rsiAtConfirmation: numeric(row.rsi_at_confirmation),
    emaFastValue: numeric(row.ema_fast_value),
    emaSlowValue: numeric(row.ema_slow_value),
    emaSpreadChange: numeric(row.ema_spread_change),
    divergencePriorRsi: numeric(row.divergence_prior_rsi),
    divergenceCurrentRsi: numeric(row.divergence_current_rsi),
    divergenceBarsBetweenPivots: numeric(row.divergence_bars_between_pivots),
    godmodeAddOnMet: truthy(row.godmode_add_on_met),
    godmodeAddOnRule: row.godmode_add_on_rule || "confirmed_short_transition_within_prior_6h",
    godmodeAddOnLookbackHours: numeric(row.godmode_add_on_lookback_hours),
    godmodeAddOnSignalAvailableAt: row.godmode_add_on_signal_available_at || null,
    godmodeAddOnWt0: numeric(row.godmode_add_on_wt0),
    godmodeAddOnWt1: numeric(row.godmode_add_on_wt1),
    godmodeAddOnPreviousWt1: numeric(row.godmode_add_on_previous_wt1),
    godmodeAddOnSlope: numeric(row.godmode_add_on_slope),
    suggestedSetupEligible: truthy(row.suggested_setup_eligible),
    tradabilityReady: truthy(row.tradability_ready),
    tradabilityPass: truthy(row.tradability_pass),
    tradabilityReasons: String(row.tradability_reasons ?? "").split("|").filter(Boolean),
    priorMedianDollarVolume20: numeric(row.prior_median_dollar_volume_20),
    priorZeroVolumeBars20: numeric(row.prior_zero_volume_bars_20),
    signalRangeFraction: numeric(row.signal_range_fraction),
    signalVolumeMultiple20: numeric(row.signal_volume_multiple_20),
    orders: rows.map(normalizeCryptoOrder),
  };
}

function normalizeGodmode(row, direction = row.direction) {
  return {
    instrumentId: row.instrument_id,
    baseAsset: row.base_asset,
    quoteCurrency: row.quote_currency,
    timeframe: row.timeframe,
    researchStatus: row.research_status,
    deploymentAllowed: truthy(row.deployment_allowed),
    direction,
    signalAvailableAt: row.signal_available_at || row.state_available_at,
    barsSinceSignal: numeric(row.bars_since_signal),
    close: numeric(row.signal_close || row.latest_close),
    wt0: numeric(row.wt0),
    wt1: numeric(row.wt1),
    previousWt1: numeric(row.previous_wt1),
    wt2: numeric(row.wt2),
    slope: numeric(row.slope),
    regimeCode: numeric(row.regime_code),
    extremityLevel: numeric(row.extremity_level),
    extremeCurrentOrPrior: truthy(row.extreme_current_or_prior),
  };
}

async function collectCryptoOpportunities() {
  const root = resolve(arbitraRoot, "artifacts", "rsi-ema-godmode-hourly");
  if (!existsSync(root)) return null;
  const requiredFiles = [
    "report.json",
    "recent-signal-orders.csv",
    "active-setup-orders.csv",
    "recent-godmode-events.csv",
    "godmode-latest-state.csv",
    "universe-audit.csv",
  ];
  const directories = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  const completed = [];
  for (const directory of directories) {
    const runRoot = resolve(root, directory.name);
    if (!requiredFiles.every((name) => existsSync(resolve(runRoot, name)))) continue;
    const report = await readJson(resolve(runRoot, "report.json"));
    const generatedAt = String(report.generated_utc ?? "");
    if (generatedAt) completed.push({ runRoot, run: directory.name, report, generatedAt });
  }
  completed.sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
  const latest = completed[0];
  if (!latest) return null;

  const [recentOrderRows, activeOrderRows, recentGodmodeRows, latestGodmodeRows, universeRows] =
    await Promise.all([
      readCsv(resolve(latest.runRoot, "recent-signal-orders.csv")),
      readCsv(resolve(latest.runRoot, "active-setup-orders.csv")),
      readCsv(resolve(latest.runRoot, "recent-godmode-events.csv")),
      readCsv(resolve(latest.runRoot, "godmode-latest-state.csv")),
      readCsv(resolve(latest.runRoot, "universe-audit.csv")),
    ]);

  const groupCandidates = (rows) => {
    const grouped = new Map();
    for (const row of rows) {
      const key = `${row.setup_id}|${row.instrument_id}|${row.signal_available_at}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    }
    return [...grouped.values()]
      .map(normalizeRsiCandidate)
      .sort((left, right) => right.signalAvailableAt.localeCompare(left.signalAvailableAt));
  };
  const activeConfiguration = latest.report.configurations?.find(
    (configuration) => configuration.eligible_for_active_output,
  );
  const currentGodmode = latestGodmodeRows.flatMap((row) => {
    if (truthy(row.confirmed_long_transition)) return [normalizeGodmode(row, "long")];
    if (truthy(row.confirmed_short_transition)) return [normalizeGodmode(row, "short")];
    return [];
  });
  const retainedHistory = groupCandidates(recentOrderRows).filter(
    (candidate) => candidate.eligibleForActiveOutput,
  );

  return {
    schemaVersion: 3,
    generatedAt: latest.generatedAt,
    sourceRun: latest.run,
    venue: latest.report.venue,
    marketType: latest.report.market_type,
    universeRule: latest.report.universe_rule,
    deploymentAllowed: Boolean(latest.report.deployment_allowed),
    capitalAuthority: Boolean(latest.report.capital_authority),
    cryptoTradabilityGateEnabled: Boolean(
      latest.report.crypto_tradability_gate_enabled,
    ),
    historyWindowHours: Number(latest.report.history_window_hours ?? 168),
    universe: {
      live: Number(latest.report.full_live_universe_size ?? universeRows.length),
      considered: Number(latest.report.instruments_considered ?? universeRows.length),
      usableHistory: Number(latest.report.instruments_with_usable_history ?? 0),
      usableGodmode: Number(latest.report.instruments_with_usable_godmode ?? 0),
      qualityRejected: universeRows.filter((row) => !truthy(row.quality_pass)).length,
      godmodeRejected: universeRows.filter((row) => !truthy(row.godmode_pass)).length,
    },
    rsi: {
      setup: activeConfiguration
        ? {
            setupId: activeConfiguration.setup_id,
            timeframe: activeConfiguration.timeframe,
            rsiPeriod: Number(activeConfiguration.rsi_period),
            emaFast: Number(activeConfiguration.ema_fast),
            emaSlow: Number(activeConfiguration.ema_slow),
            researchStatus: activeConfiguration.research_status,
          }
        : null,
      activeSignals: groupCandidates(activeOrderRows),
      recentCandidates: [],
      history: retainedHistory,
    },
    godmodeAddOn: {
      direction: latest.report.godmode_add_on?.direction ?? "short",
      rule: latest.report.godmode_add_on?.rule ?? "confirmed_extreme_cross",
      lookbackCompletedHours: Number(
        latest.report.godmode_add_on?.lookback_completed_hours ?? 6,
      ),
      requiredForParentRsiSetup: Boolean(
        latest.report.godmode_add_on?.required_for_parent_rsi_setup,
      ),
      suggestedSetupRequiresAddOn: Boolean(
        latest.report.godmode_add_on?.suggested_setup_requires_add_on ?? true,
      ),
    },
    suggestedTradeSetup: {
      direction: latest.report.suggested_trade_setup?.direction ?? "short",
      pushPercent: Number(latest.report.suggested_trade_setup?.push_percent ?? 1),
      targetPercentBelowFill: Number(
        latest.report.suggested_trade_setup?.target_percent_below_fill ?? 2,
      ),
      entryWindowCompletedSetupBars: Number(
        latest.report.suggested_trade_setup?.entry_window_completed_setup_bars ?? 5,
      ),
      targetWindowCompletedSetupBarsAfterFill: Number(
        latest.report.suggested_trade_setup?.target_window_completed_setup_bars_after_fill ?? 20,
      ),
      stop: latest.report.suggested_trade_setup?.stop ?? "not_modeled",
      orderAuthority: Boolean(latest.report.suggested_trade_setup?.order_authority),
      tradabilityQualityGateRequired: Boolean(
        latest.report.suggested_trade_setup?.tradability_quality_gate_required,
      ),
    },
    godmode: {
      timeframe: latest.report.godmode?.interval ?? "1h",
      rule: latest.report.godmode?.rule ?? "confirmed_extreme_cross",
      researchStatus: latest.report.godmode?.research_status ?? "unvalidated_intraday_crypto_transfer",
      warning: latest.report.godmode?.warning ?? "Godmode crypto states are observational only.",
      current: currentGodmode,
      recent: recentGodmodeRows
        .map((row) => normalizeGodmode(row))
        .sort((left, right) => right.signalAvailableAt.localeCompare(left.signalAvailableAt))
        .slice(0, 48),
    },
  };
}

function normalizeEtfOpportunity(row) {
  return {
    symbol: row.symbol,
    name: row.name,
    evidenceRole: row.evidence_role,
    signalTime: row.signal_time,
    signalClose: numeric(row.signal_close),
    wt0: numeric(row.wt0),
    wt1: numeric(row.wt1),
    previousWt1: numeric(row.previous_wt1),
    slope: numeric(row.slope),
    extremity: numeric(row.extremity),
    mfi14: numeric(row.mfi14),
    previousMfi14: numeric(row.previous_mfi14),
    mfiAddOnAvailable: truthy(row.mfi_add_on_available),
    mfiAddOnMet: truthy(row.mfi_add_on_met),
    orderState: row.order_state,
    active: truthy(row.active),
    entryPrice: numeric(row.entry_price),
    targetPrice: numeric(row.target_price),
    actualExitPrice: numeric(row.actual_exit_price),
    entryTime: row.entry_time || null,
    exitTime: row.exit_time || null,
    barsRemaining: numeric(row.bars_remaining),
    targetHit: truthy(row.target_hit),
  };
}

function normalizeEtfState(row) {
  return {
    symbol: row.symbol,
    name: row.name,
    evidenceRole: row.evidence_role,
    candleTime: row.candle_time,
    close: numeric(row.close),
    wt0: numeric(row.wt0),
    wt1: numeric(row.wt1),
    previousWt1: numeric(row.previous_wt1),
    slope: numeric(row.slope),
    extremity: numeric(row.extremity),
    mfi14: numeric(row.mfi14),
    previousMfi14: numeric(row.previous_mfi14),
    mfiAddOnAvailable: truthy(row.mfi_add_on_available),
    mfi14Rising: truthy(row.mfi14_rising),
    confirmedLongTransition: truthy(row.confirmed_long_transition),
  };
}

async function collectEtfOpportunities() {
  const root = resolve(arbitraRoot, "artifacts", "etf-godmode-daily");
  if (!existsSync(root)) return null;
  const requiredFiles = [
    "report.json",
    "manifest.json",
    "recent-opportunities.csv",
    "active-orders.csv",
    "latest-states.csv",
    "universe-audit.csv",
  ];
  const directories = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  const completed = [];
  for (const directory of directories) {
    const runRoot = resolve(root, directory.name);
    if (!requiredFiles.every((name) => existsSync(resolve(runRoot, name)))) continue;
    const report = await readJson(resolve(runRoot, "report.json"));
    if (
      report.status !== "complete" ||
      Number(report.schema_version ?? 0) < 1 ||
      Boolean(report.etf_prospective_tradability_gate_enabled) ||
      Boolean(report.deployment_allowed) ||
      Boolean(report.capital_authority)
    ) continue;
    const generatedAt = String(report.generated_utc ?? "");
    if (generatedAt) completed.push({ runRoot, run: directory.name, report, generatedAt });
  }
  completed.sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
  const latest = completed[0];
  if (!latest) return null;
  const [recentRows, activeRows, stateRows, auditRows] = await Promise.all([
    readCsv(resolve(latest.runRoot, "recent-opportunities.csv")),
    readCsv(resolve(latest.runRoot, "active-orders.csv")),
    readCsv(resolve(latest.runRoot, "latest-states.csv")),
    readCsv(resolve(latest.runRoot, "universe-audit.csv")),
  ]);
  const opportunities = recentRows.map(normalizeEtfOpportunity);
  const active = activeRows.map(normalizeEtfOpportunity);
  return {
    schemaVersion: Number(latest.report.schema_version),
    generatedAt: latest.generatedAt,
    sourceRun: latest.run,
    completedCandleDates: latest.report.completed_candle_dates ?? [],
    universeId: latest.report.universe_id,
    universeSymbols: Number(latest.report.universe_symbols ?? auditRows.length),
    usableHistory: Number(latest.report.usable_history ?? 0),
    basicDataIntegrityFailures: Number(latest.report.basic_data_integrity_failures ?? 0),
    downloadOrAnalysisFailures: Number(latest.report.download_or_analysis_failures ?? 0),
    historyWindowSessions: Number(latest.report.history_window_sessions ?? 252),
    etfProspectiveTradabilityGateEnabled: Boolean(
      latest.report.etf_prospective_tradability_gate_enabled,
    ),
    basicCandleIntegrityGateEnabled: Boolean(
      latest.report.basic_candle_integrity_gate_enabled,
    ),
    mfiAddOnRequiredForParentSignal: Boolean(
      latest.report.mfi_add_on_required_for_parent_signal,
    ),
    deploymentAllowed: Boolean(latest.report.deployment_allowed),
    capitalAuthority: Boolean(latest.report.capital_authority),
    opportunities,
    active,
    latestStates: stateRows.map(normalizeEtfState),
    totals: {
      recent: Number(latest.report.recent_opportunities ?? opportunities.length),
      mfiAddOnMet: Number(latest.report.mfi_add_on_met ?? 0),
      mfiAddOnNotMet: Number(latest.report.mfi_add_on_not_met ?? 0),
      active: Number(latest.report.active_orders ?? active.length),
      targetHits: Number(latest.report.historical_target_hits ?? 0),
    },
    referenceOutcome: {
      entry: latest.report.reference_outcome?.entry ?? "next completed-session open",
      horizonCandles: Number(latest.report.reference_outcome?.horizon_candles ?? 2),
      barrierBps: Number(latest.report.reference_outcome?.barrier_bps ?? 100),
      modeledStop: latest.report.reference_outcome?.modeled_stop ?? null,
      interpretation:
        latest.report.reference_outcome?.evidence_interpretation ??
        "upside opportunity, not autonomous execution",
    },
    evidence: {
      parentBarrierEdgePercentagePoints: Number(
        latest.report.evidence?.parent_etf_h2_barrier_edge_percentage_points ?? 17.1,
      ),
      parentMeanNetReturn: Number(
        latest.report.evidence?.parent_etf_h2_mean_net_return ?? -0.0003,
      ),
      mfiBarrierChangePercentagePoints: Number(
        latest.report.evidence?.mfi14_etf_barrier_rate_change_percentage_points ?? 3.14,
      ),
      mfiMeanNetReturnChangePercentagePoints: Number(
        latest.report.evidence?.mfi14_etf_mean_net_return_change_percentage_points ?? 0.08,
      ),
      warning: latest.report.evidence?.warning ?? "Retrospective ETF evidence only.",
    },
    suggestedTradeSetup: latest.report.suggested_trade_setup
      ? {
          symbol: latest.report.suggested_trade_setup.symbol,
          signalTime: latest.report.suggested_trade_setup.signal_time,
          state: latest.report.suggested_trade_setup.state,
          entryPrice: numeric(latest.report.suggested_trade_setup.entry_price),
          exitPrice: numeric(latest.report.suggested_trade_setup.exit_price),
          entryRule: latest.report.suggested_trade_setup.entry_rule,
          exitRule: latest.report.suggested_trade_setup.exit_rule,
          modeledStop: latest.report.suggested_trade_setup.modeled_stop ?? null,
          orderAuthority: Boolean(latest.report.suggested_trade_setup.order_authority),
        }
      : null,
  };
}

const [scanDatasets, matrices, historical, etf, crypto] = await Promise.all([
  collectDailyScans(),
  collectMatrices(),
  existsSync(historyPath) ? readJson(historyPath) : Promise.resolve(null),
  collectEtfOpportunities(),
  collectCryptoOpportunities(),
]);
const historicalDatasets = historical?.datasets ?? [];
const historicalLatest = historicalDatasets[0]?.date ?? "";
const datasets = historicalDatasets.length
  ? [
      ...scanDatasets.filter((dataset) => dataset.date > historicalLatest),
      ...historicalDatasets,
    ]
  : scanDatasets;
const snapshot = {
  schemaVersion: 6,
  generatedAt: new Date().toISOString(),
  source: historicalDatasets.length
    ? "Arbitra causal daily history plus completed-daily scan artifacts"
    : "Arbitra completed-daily long artifacts",
  deploymentAllowed: false,
  methodologies,
  datasets,
  matrices,
  profiles: historical?.profiles ?? {},
  etf,
  crypto,
  history: {
    startDate: historical?.startDate ?? datasets.at(-1)?.date ?? null,
    endDate: datasets[0]?.date ?? null,
    entryWindowCompletedCandles: historical?.evaluation?.entryWindowCompletedCandles ?? 5,
    targetWindowCompletedCandlesAfterFill:
      historical?.evaluation?.targetWindowCompletedCandlesAfterFill ?? 20,
    unfilledTargetMarkWindowCompletedCandles:
      historical?.evaluation?.unfilledTargetMarkWindowCompletedCandles ?? 25,
  },
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(
  `Synced ${datasets.length} completed dates, ${methodologies.length} long methodologies, ${Object.keys(snapshot.profiles).length} profiles, ${matrices.reduce((total, matrix) => total + matrix.cells.length, 0)} matrix cells, ${etf ? `${etf.universeSymbols} ETFs from ${etf.sourceRun}` : "no ETF run"}, and ${crypto ? `${crypto.universe.considered} crypto markets from ${crypto.sourceRun}` : "no crypto run"}.`,
);
