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

const [scanDatasets, matrices, historical] = await Promise.all([
  collectDailyScans(),
  collectMatrices(),
  existsSync(historyPath) ? readJson(historyPath) : Promise.resolve(null),
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
  schemaVersion: 3,
  generatedAt: new Date().toISOString(),
  source: historicalDatasets.length
    ? "Arbitra causal daily history plus completed-daily scan artifacts"
    : "Arbitra completed-daily long artifacts",
  deploymentAllowed: false,
  methodologies,
  datasets,
  matrices,
  profiles: historical?.profiles ?? {},
  history: {
    startDate: historical?.startDate ?? datasets.at(-1)?.date ?? null,
    endDate: datasets[0]?.date ?? null,
    entryWindowCompletedCandles: historical?.evaluation?.entryWindowCompletedCandles ?? 5,
    targetWindowCompletedCandlesAfterFill:
      historical?.evaluation?.targetWindowCompletedCandlesAfterFill ?? 20,
  },
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(
  `Synced ${datasets.length} completed dates, ${methodologies.length} long methodologies, ${Object.keys(snapshot.profiles).length} profiles, and ${matrices.reduce((total, matrix) => total + matrix.cells.length, 0)} matrix cells.`,
);
