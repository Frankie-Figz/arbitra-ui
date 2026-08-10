import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const uiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arbitraRoot = resolve(
  process.env.ARBITRA_REPO ?? resolve(uiRoot, "..", "Arbitra"),
);
const outputPath = resolve(uiRoot, "public", "data", "arbitra-snapshot.json");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function displayName(id) {
  if (id === "eve-evolved") return "Eve Evolved";
  return id.replace(/(^|-)([a-z])/g, (_, separator, letter) =>
    `${separator ? " " : ""}${letter.toUpperCase()}`,
  );
}

function normalizeReferences(raw) {
  if (Array.isArray(raw)) {
    return raw.map((featureId) => ({ featureId, parameters: {} }));
  }
  return (raw?.features ?? []).map((feature) => ({
    featureId: feature.feature_id,
    parameters: feature.parameters ?? {},
  }));
}

function cellKey(family, direction, bps, horizon) {
  return `${family}|${direction}|${bps}|${horizon}`;
}

async function collectFamilies() {
  const configDir = resolve(arbitraRoot, "config", "models");
  const names = (await readdir(configDir)).filter((name) => name.endsWith(".json"));
  const families = [];

  for (const filename of names.sort()) {
    const definition = await readJson(resolve(configDir, filename));
    const id = definition.name;
    families.push({
      id,
      name: displayName(id),
      description: definition.description,
      mode: id === "jacob" ? "hazard" : "binary",
      candidates: (definition.basket ?? []).map((feature) => ({
        category: feature.category,
        featureId: feature.feature_id,
        parameters: feature.parameters ?? {},
      })),
      references: normalizeReferences(definition.references),
    });
  }

  return families;
}

async function collectCells() {
  const cells = new Map();
  const governmentPath = resolve(
    arbitraRoot,
    "artifacts",
    "all-generation-governments",
    "governments.json",
  );

  if (existsSync(governmentPath)) {
    const government = await readJson(governmentPath);
    for (const [identity, rankings] of Object.entries(
      government.family_lineage_rankings ?? {},
    )) {
      const [targetIdentity, family] = identity.split("::");
      const match = targetIdentity.match(
        /^barrier__(long|short)__(\d+)bps__h(\d+)__(.+)$/,
      );
      const top = rankings[0];
      if (!match || !top) continue;
      const [, direction, rawBps, rawHorizon, candleInterval] = match;
      const bps = Number(rawBps);
      const horizon = Number(rawHorizon);
      cells.set(cellKey(family, direction, bps, horizon), {
        family,
        direction,
        bps,
        horizon,
        candleInterval,
        macroF1: top.selection_metrics?.macro_f1 ?? null,
        balancedAccuracy: top.selection_metrics?.balanced_accuracy ?? null,
        validationRows: null,
        positiveRows: null,
        negativeRows: null,
        finalFeatureCount: top.surviving_features?.length ?? null,
        protectedReferencesSurvived: true,
        survivingFeatures: top.surviving_features ?? [],
        source: government.ticket ?? "ARB-063",
        evidenceKind: "selection",
        runId: top.run_id ?? null,
      });
    }
  }

  const matrixPaths = [
    resolve(arbitraRoot, "artifacts", "requested-daily-governments", "summary.json"),
    resolve(arbitraRoot, "artifacts", "parameterized-retraining", "summary.json"),
  ];

  for (const path of matrixPaths) {
    if (!existsSync(path)) continue;
    const matrix = await readJson(path);
    for (const row of matrix.completed_rows ?? []) {
      const target = row.target;
      const direction = target.direction.toLowerCase();
      const bps = Number(target.threshold_bps);
      const horizon = Number(target.horizon_candles);
      cells.set(cellKey(row.model, direction, bps, horizon), {
        family: row.model,
        direction,
        bps,
        horizon,
        candleInterval: target.candle_interval,
        macroF1: row.macro_f1,
        balancedAccuracy: row.balanced_accuracy,
        validationRows: row.validation_row_count,
        positiveRows: row.positive_class_count,
        negativeRows: row.negative_class_count,
        finalFeatureCount: row.final_feature_count,
        protectedReferencesSurvived: row.protected_references_survived,
        survivingFeatures: [],
        source: matrix.ticket,
        evidenceKind: "validation",
        runId: row.mlflow_run_id ?? null,
      });
    }
  }

  return [...cells.values()].sort(
    (left, right) =>
      left.family.localeCompare(right.family) ||
      left.direction.localeCompare(right.direction) ||
      left.horizon - right.horizon ||
      left.bps - right.bps,
  );
}

async function collectJacob() {
  const results = [];
  for (const direction of ["long", "short"]) {
    for (const horizon of [1, 2]) {
      const path = resolve(
        arbitraRoot,
        "artifacts",
        "jacob",
        "registered-ablation",
        `${direction}-h${horizon}`,
        "ablation.json",
      );
      if (!existsSync(path)) continue;
      const ablation = await readJson(path);
      results.push({
        direction,
        horizon,
        candleInterval: "1d",
        ladderBps: ablation.ladder_bps,
        baseRates: ablation.ladder_bps.map(
          (bps) => ablation.base_rates_by_rung[String(bps)],
        ),
        rows: ablation.scores.rows,
        baselineLoss: ablation.scores.baseline_loss,
        boostedLoss: ablation.scores.boosted_loss,
        boostedSkill: ablation.scores.boosted_skill,
        improvement: ablation.paired_brier_improvement.estimate,
        confidenceInterval: ablation.paired_brier_improvement.interval,
      });
    }
  }
  return results;
}

const scanner = {
  updatedAt: "2026-08-10T04:52:00Z",
  universe: 6207,
  analyzed: 6162,
  signalLabel: "Liquidity acceptance + PPO prior-median filter",
  candidates: [
    { symbol: "ATAI", name: "AtaiBeckley Inc.", close: 7.25, direction: "LONG", signalBar: "2026-08-07", ppo: -0.4287, priorMedian: -0.0125 },
    { symbol: "GBTG", name: "Global Business Travel Group", close: 9.46, direction: "LONG", signalBar: "2026-08-07", ppo: -0.1774, priorMedian: -0.0286 },
    { symbol: "HCI", name: "HCI Group", close: 188.69, direction: "LONG", signalBar: "2026-08-07", ppo: -0.0236, priorMedian: -0.0107 },
    { symbol: "OGN", name: "Organon & Co.", close: 13.6, direction: "LONG", signalBar: "2026-08-07", ppo: -0.1603, priorMedian: -0.0013 },
    { symbol: "RGA", name: "Reinsurance Group of America", close: 246.33, direction: "LONG", signalBar: "2026-08-07", ppo: -0.0872, priorMedian: 0.0021 },
  ],
};

const indicators = {
  refined: [
    ["Absolute Strength Rank", 11, "rank, tails, crossings and divergence events"],
    ["Volume DNA", 5, "volume, spread, body and location state"],
    ["Hurst Adaptive Supertrend", 6, "causal Hurst, normalized trend and flips"],
    ["Balanced Volume Profile", 5, "POC distance, balance, entropy and migration"],
    ["Liquidity Sweeps", 10, "confirmed pools, sweeps and acceptance events"],
    ["Inversion Order Blocks", 14, "block state, invalidation and retest events"],
    ["RSI Analog", 7, "neighbor vote, agreement, distance and bias"],
  ].map(([name, outputs, role]) => ({ name, outputs, role })),
  pine: [
    "absolute-strength-rank", "volume-spread-dna", "hurst-adaptive-supertrend",
    "balanced-candle-volume-profile", "liquidity-sweep-detector", "inversion-order-blocks",
    "ml-rsi-analog", "adaptive-kalman-filter", "adaptive-kalman-trend-filter",
    "adaptive-volatility-regime-oscillator", "inversion-block-rsi-source-alias",
    "kinetic-efficiency-index", "knn-point-forecast-with-sr",
    "rolling-vwap-dispersion-bands", "supertrend-exit-context",
  ],
};

const schedule = [
  { cadence: "After completed daily candles", jobs: ["Universe scanner", "Jacob evidence update"], consequence: "Refresh research candidates and matured daily outcomes" },
  { cadence: "Every four hours", jobs: ["Fourth Watch", "Evening Watch"], consequence: "Refresh intraday shadow distributions" },
  { cadence: "When artifacts change", jobs: ["Basket index", "Indicator inventory"], consequence: "Rebuild feature identities, metrics and provenance" },
];

const [families, cells, jacob] = await Promise.all([
  collectFamilies(), collectCells(), collectJacob(),
]);

const familyCellCounts = new Map();
for (const cell of cells) {
  familyCellCounts.set(cell.family, (familyCellCounts.get(cell.family) ?? 0) + 1);
}
for (const family of families) {
  const count = familyCellCounts.get(family.id) ?? 0;
  family.coverage = family.id === "jacob" ? "ladder" : count >= 24 ? "full" : count > 0 ? "historical" : "registry";
  family.cellCount = family.id === "jacob" ? jacob.length * 6 : count;
}

const snapshot = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: "Arbitra artifact index",
  families,
  cells,
  jacob,
  scanner,
  indicators,
  schedule,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`Synced ${families.length} baskets, ${cells.length} binary cells, and ${jacob.length} Jacob fits.`);
