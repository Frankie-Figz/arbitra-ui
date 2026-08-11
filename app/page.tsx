"use client";

import { useMemo, useState } from "react";
import snapshotJson from "../public/data/arbitra-snapshot.json";

type Methodology = {
  id: string;
  name: string;
  shortName: string;
  description: string;
  gate: string;
  confirmationSignals: number;
};

type RealizedOutcome = {
  pullbackPercent: number;
  targetPercent: number;
  filled: boolean;
  targetHit: boolean;
  fillDate: string | null;
  entryPrice: number | null;
  targetPrice: number | null;
  targetDate: string | null;
};

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
  methodologies: string[];
  evaluationMature: boolean;
  evaluationThrough: string | null;
  realizedOutcomes: RealizedOutcome[];
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

type MatrixCell = {
  pullbackPercent: number;
  targetPercent: number;
  conditionalHitRate: number;
  successPerSignal: number;
};

type Snapshot = {
  schemaVersion: number;
  generatedAt: string;
  source: string;
  deploymentAllowed: boolean;
  methodologies: Methodology[];
  datasets: Dataset[];
  matrices: Array<{ methodologyId: string; cells: MatrixCell[] }>;
  profiles: Record<string, CompanyProfile>;
  history: {
    startDate: string | null;
    endDate: string | null;
    entryWindowCompletedCandles: number;
    targetWindowCompletedCandlesAfterFill: number;
  };
};

type MatrixMetric = "conditionalHitRate" | "successPerSignal";

const snapshot = snapshotJson as Snapshot;

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

function compactNumber(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
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

function percentage(value: number | null | undefined, digits = 1) {
  return value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
}

function points(value: number | null | undefined, digits = 2) {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function heatStyle(value: number) {
  const normalized = Math.max(0, Math.min(1, (value - 0.25) / 0.7));
  const hue = 28 + normalized * 128;
  const lightness = 95 - normalized * 53;
  return {
    backgroundColor: `hsl(${hue} 58% ${lightness}%)`,
    color: normalized > 0.58 ? "#f8fbf8" : "#152019",
  };
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

function Heatmap({
  cells,
  outcomes,
  metric,
  selectedPullback,
  selectedTarget,
  onSelect,
}: {
  cells: MatrixCell[];
  outcomes: RealizedOutcome[];
  metric: MatrixMetric;
  selectedPullback: number;
  selectedTarget: number;
  onSelect: (pullback: number, target: number) => void;
}) {
  const pullbacks = [...new Set(cells.map((cell) => cell.pullbackPercent))].sort((a, b) => a - b);
  const targets = [...new Set(cells.map((cell) => cell.targetPercent))].sort((a, b) => a - b);
  const lookup = new Map(cells.map((cell) => [`${cell.pullbackPercent}|${cell.targetPercent}`, cell]));
  const outcomeLookup = new Map(
    outcomes.map((outcome) => [`${outcome.pullbackPercent}|${outcome.targetPercent}`, outcome]),
  );
  const realized = outcomes.length > 0;

  return (
    <div className="heatmap-scroll">
      <div
        className="heatmap"
        role="grid"
        aria-label={`${realized ? "Forecast probability and realized result" : metric === "conditionalHitRate" ? "Hit rate after fill" : "Success per qualifying signal"} by pullback and target`}
      >
        <div className="heat-corner" aria-hidden="true">PB \ TGT</div>
        {targets.map((target) => <div className="heat-axis target-axis" key={`target-${target}`}>+{target}%</div>)}
        {pullbacks.map((pullback) => (
          <div className="heat-row" key={`pullback-${pullback}`}>
            <div className="heat-axis pullback-axis">−{pullback}%</div>
            {targets.map((target) => {
              const cell = lookup.get(`${pullback}|${target}`);
              const outcome = outcomeLookup.get(`${pullback}|${target}`);
              const value = cell?.[metric] ?? 0;
              const selected = pullback === selectedPullback && target === selectedTarget;
              const result = outcome
                ? outcome.targetHit
                  ? "target achieved"
                  : outcome.filled
                    ? "target not achieved"
                    : "pullback not filled"
                : null;
              return (
                <button
                  className={`heat-cell ${outcome ? `realized ${outcome.targetHit ? "achieved" : "missed"}` : ""} ${selected ? "selected" : ""}`}
                  key={`${pullback}-${target}`}
                  style={outcome ? undefined : heatStyle(value)}
                  onClick={() => onSelect(pullback, target)}
                  role="gridcell"
                  aria-selected={selected}
                  aria-label={`${pullback}% pullback, ${target}% target, ${percentage(value)} historical probability${result ? `, ${result}` : ""}`}
                  title={`${pullback}% pullback → ${target}% target: ${percentage(value, 2)}${result ? ` · ${result}` : ""}`}
                >
                  {outcome && <span className="heat-result" aria-hidden="true" />}
                  <span className="heat-probability">{(value * 100).toFixed(0)}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const [selectedDate, setSelectedDate] = useState(snapshot.datasets[0]?.date ?? "");
  const [methodologyId, setMethodologyId] = useState(snapshot.methodologies[0]?.id ?? "");
  const [assetSymbol, setAssetSymbol] = useState("");
  const [matrixMetric, setMatrixMetric] = useState<MatrixMetric>("conditionalHitRate");
  const [pullbackPercent, setPullbackPercent] = useState(1);
  const [targetPercent, setTargetPercent] = useState(5);
  const [assetQuery, setAssetQuery] = useState("");

  const dataset = snapshot.datasets.find((item) => item.date === selectedDate);
  const methodology = snapshot.methodologies.find((item) => item.id === methodologyId) ?? snapshot.methodologies[0];
  const matrix = snapshot.matrices.find((item) => item.methodologyId === methodologyId)?.cells ?? [];
  const methodAssets = useMemo(
    () => dataset?.assets.filter((asset) => asset.methodologies.includes(methodologyId)) ?? [],
    [dataset, methodologyId],
  );
  const filteredAssets = useMemo(() => {
    const query = assetQuery.trim().toLowerCase();
    if (!query) return methodAssets;
    return methodAssets.filter(
      (asset) => asset.symbol.toLowerCase().includes(query) || asset.name.toLowerCase().includes(query),
    );
  }, [methodAssets, assetQuery]);
  const asset = methodAssets.find((item) => item.symbol === assetSymbol) ?? methodAssets[0] ?? null;
  const selectedCell = matrix.find(
    (cell) => cell.pullbackPercent === pullbackPercent && cell.targetPercent === targetPercent,
  );
  const selectedOutcome = asset?.realizedOutcomes.find(
    (outcome) => outcome.pullbackPercent === pullbackPercent && outcome.targetPercent === targetPercent,
  );
  const profile = asset ? snapshot.profiles[asset.symbol] : null;
  const entryPrice = asset?.close == null ? null : asset.close * (1 - pullbackPercent / 100);
  const targetPrice = entryPrice == null ? null : entryPrice * (1 + targetPercent / 100);
  const latestDate = snapshot.datasets[0]?.date ?? "";
  const earliestDate = snapshot.datasets.at(-1)?.date ?? latestDate;
  const exactCoverage = dataset ? dataset.exactDateAnalyzed / dataset.universe : 0;
  const dataGaps = dataset
    ? dataset.staleAnalyzed + dataset.historyMissing + dataset.analysisFailed
    : 0;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">A</span>
          <div><strong>ARBITRA</strong><small>Daily Longs</small></div>
        </div>
        <div className="market-state"><i /> completed candles only</div>
        <label className="date-picker">
          <span>Signal date</span>
          <input
            type="date"
            value={selectedDate}
            min={earliestDate}
            max={latestDate}
            onChange={(event) => {
              setSelectedDate(event.target.value);
              setAssetSymbol("");
            }}
          />
        </label>
      </header>

      <div className="authority-strip">
        <strong>Daily long research</strong>
        <span>Eligibility is causal. Matrices are historical. No order routing.</span>
      </div>

      <main>
        <section className="hero">
          <div>
            <p className="eyebrow">{dataset ? formatDate(dataset.date) : "Unavailable scan date"}</p>
            <h1>Long setups,<br />without the noise.</h1>
          </div>
          <div className="hero-copy">
            <p>Choose a completed daily scan, move through the nested methodologies, then inspect the eligible assets against the matching pullback and target evidence.</p>
            <div className="coverage-line">
              <span className={exactCoverage >= 0.95 ? "coverage-good" : "coverage-partial"} />
              {dataset
                ? `${dataset.exactDateAnalyzed.toLocaleString()} of ${dataset.universe.toLocaleString()} assets exact to this date`
                : "No saved scan snapshot for this date"}
            </div>
            {!dataset && <button className="text-button" onClick={() => setSelectedDate(latestDate)}>Return to latest scan</button>}
          </div>
        </section>

        <section className="summary-strip" aria-label="Daily scan summary">
          <div><span>Exact-date coverage</span><strong>{dataset ? percentage(exactCoverage) : "—"}</strong></div>
          <div><span>Parent long setups</span><strong>{dataset?.assets.length ?? 0}</strong></div>
          <div><span>Selected methodology</span><strong>{methodAssets.length}</strong></div>
          <div><span>Stale / unavailable</span><strong>{dataset ? compactNumber(dataGaps) : "—"}</strong></div>
        </section>

        <section className="methodology-section">
          <div className="section-title">
            <div><p className="eyebrow">Eligibility ladder</p><h2>Pick a methodology</h2></div>
            <p>Each step inherits every gate to its left. A BB or EMA state never creates a signal by itself.</p>
          </div>
          <div className="methodology-tabs" role="tablist" aria-label="Long methodologies">
            {snapshot.methodologies.map((item, index) => {
              const count = dataset?.assets.filter((assetItem) => assetItem.methodologies.includes(item.id)).length ?? 0;
              return (
                <button
                  key={item.id}
                  role="tab"
                  aria-selected={item.id === methodologyId}
                  className={item.id === methodologyId ? "active" : ""}
                  onClick={() => {
                    setMethodologyId(item.id);
                    setAssetSymbol("");
                    setAssetQuery("");
                  }}
                >
                  <span className="method-index">0{index + 1}</span>
                  <strong>{item.shortName}</strong>
                  <small>{item.gate}</small>
                  <b>{count}</b>
                </button>
              );
            })}
          </div>
        </section>

        <section className="workspace">
          <aside className="asset-panel">
            <div className="panel-heading">
              <div><p className="eyebrow">Eligible now</p><h2>{methodAssets.length} assets</h2></div>
              <span className="long-pill">LONG</span>
            </div>
            {methodAssets.length > 5 && (
              <label className="asset-search">
                <span className="sr-only">Search eligible assets</span>
                <input value={assetQuery} onChange={(event) => setAssetQuery(event.target.value)} placeholder="Search ticker or name" />
              </label>
            )}
            <div className="asset-list">
              {filteredAssets.map((item) => (
                <button
                  key={item.symbol}
                  className={asset?.symbol === item.symbol ? "selected" : ""}
                  onClick={() => setAssetSymbol(item.symbol)}
                >
                  <div><strong>{item.symbol}</strong><span>{item.name}</span></div>
                  <div><b>{price(item.close)}</b><small>{item.instrumentFamily}</small></div>
                </button>
              ))}
              {methodAssets.length === 0 && (
                <div className="empty-assets">
                  <span>0</span>
                  <strong>No assets cleared this gate.</strong>
                  <p>The matrix remains visible as historical context; it does not manufacture a setup.</p>
                </div>
              )}
              {methodAssets.length > 0 && filteredAssets.length === 0 && (
                <div className="empty-search">No eligible asset matches “{assetQuery}”.</div>
              )}
            </div>
            {dataset && (
              <div className="data-note">
                <span>Data quality</span>
                <p>{dataset.qualityRejected} quality rejected · {dataset.analysisFailed} analysis failed · {dataset.historyMissing} missing</p>
              </div>
            )}
            <section className="company-profile" aria-label="Company profile">
              <div className="company-profile-heading">
                <div><p className="eyebrow">Company profile</p><h2>{profile?.longName ?? asset?.name ?? "Select an asset"}</h2></div>
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
                  <p>Yahoo does not currently provide company details for this asset.</p>
                  {profile && <a href={profile.sourceUrl} target="_blank" rel="noreferrer">Open Yahoo Finance ↗</a>}
                </div>
              ) : (
                <div className="company-empty"><p>Choose an eligible stock to see what the company does, its industry, employees, and headquarters.</p></div>
              )}
            </section>
          </aside>

          <div className="evidence-panel">
            <section className="asset-detail">
              <div className="asset-identity">
                <p className="eyebrow">Selected setup</p>
                {asset ? (
                  <>
                    <div className="symbol-row"><h2>{asset.symbol}</h2><span>{price(asset.close)}</span></div>
                    <p>{asset.name} · {asset.exchange || asset.instrumentFamily}</p>
                  </>
                ) : (
                  <><h2>No current asset</h2><p>{methodology.description}</p></>
                )}
              </div>
              <div className="plan-card">
                <div><span>Pullback entry</span><strong>{price(entryPrice)}</strong><small>−{pullbackPercent}% from signal close</small></div>
                <i>→</i>
                <div><span>Target at limit fill</span><strong>{price(targetPrice)}</strong><small>+{targetPercent}% from actual fill</small></div>
              </div>
            </section>

            {asset ? (
              <section className="gate-grid" aria-label="Selected asset indicator gates">
                <Gate label="ATR(10) / close" value={`${points(asset.atr10Percent)}%`} threshold={`${points(asset.atr10ThresholdPercent)}% q70`} pass={asset.atr10Pass} />
                <Gate label="BB width(40)" value={points(asset.bb40Width)} threshold={`${points(asset.bb40Threshold)} q80`} pass={asset.bb40Pass} />
                <Gate label="EMA20 extension" value={`${points(asset.ema20DistancePercent)}%`} threshold={`${points(asset.ema20ThresholdPercent)}% q90`} pass={asset.ema20Pass} />
                <div className={`gate ${asset.emaBullStack ? "pass" : "miss"}`}>
                  <span>EMA structure</span>
                  <strong>{asset.emaBullStack ? "5 > 10 > 20 > 50" : "mixed"}</strong>
                  <small>{asset.launchWatch ? "launch watch · research only" : "no launch watch"}</small>
                </div>
              </section>
            ) : (
              <section className="method-note">
                <span>{methodology.name}</span>
                <p>{methodology.description}</p>
              </section>
            )}

            <section className="matrix-section">
              <div className="matrix-heading">
                <div>
                  <p className="eyebrow">{asset?.evaluationMature ? `${asset.symbol} · realized path` : "2024+ confirmation evidence"}</p>
                  <h2>{asset?.evaluationMature ? "Forecast vs achieved" : "Pullback / target matrix"}</h2>
                  <p>
                    {methodology.name} · n={methodology.confirmationSignals.toLocaleString()} qualifying signals
                    {asset?.evaluationMature && asset.evaluationThrough ? ` · observed through ${formatDate(asset.evaluationThrough)}` : ""}
                  </p>
                </div>
                <div className="metric-toggle" role="group" aria-label="Matrix denominator">
                  <button className={matrixMetric === "conditionalHitRate" ? "active" : ""} onClick={() => setMatrixMetric("conditionalHitRate")}>After fill</button>
                  <button className={matrixMetric === "successPerSignal" ? "active" : ""} onClick={() => setMatrixMetric("successPerSignal")}>Per signal</button>
                </div>
              </div>

              <Heatmap
                cells={matrix}
                outcomes={asset?.evaluationMature ? asset.realizedOutcomes : []}
                metric={matrixMetric}
                selectedPullback={pullbackPercent}
                selectedTarget={targetPercent}
                onSelect={(pullback, target) => {
                  setPullbackPercent(pullback);
                  setTargetPercent(target);
                }}
              />

              <div className="matrix-readout">
                <div><span>Selected cell</span><strong>−{pullbackPercent}% → +{targetPercent}%</strong></div>
                {selectedOutcome ? (
                  <>
                    <div><span>{matrixMetric === "conditionalHitRate" ? "Forecast after fill" : "Forecast per signal"}</span><strong>{percentage(selectedCell?.[matrixMetric], 2)}</strong></div>
                    <div><span>Realized result</span><strong className={selectedOutcome.targetHit ? "result-hit" : "result-miss"}>{selectedOutcome.targetHit ? "Achieved" : selectedOutcome.filled ? "Not achieved" : "Not filled"}</strong></div>
                  </>
                ) : (
                  <>
                    <div><span>Hits after fill</span><strong>{percentage(selectedCell?.conditionalHitRate, 2)}</strong></div>
                    <div><span>Success per signal</span><strong>{percentage(selectedCell?.successPerSignal, 2)}</strong></div>
                  </>
                )}
                <div><span>Measurement</span><strong>5 + 20 candles</strong></div>
              </div>
              <div className="matrix-footnote">
                {asset?.evaluationMature ? (
                  <div className="outcome-legend">
                    <span><i className="legend-hit" /> achieved</span>
                    <span><i className="legend-miss" /> not achieved</span>
                    <span><i className="legend-probability" /> probability</span>
                  </div>
                ) : (
                  <div className="probability-legend">
                    <span className="legend-gradient" aria-hidden="true" />
                    <span>lower</span><span>higher</span>
                  </div>
                )}
                <p>Entry is eligible for five completed candles. Target measurement begins after fill and runs for twenty completed candles. No stop, costs, slippage, or order authority is included.</p>
              </div>
            </section>
          </div>
        </section>
      </main>

      <footer>
        <span>Arbitra Daily Longs</span>
        <span>Snapshot v{snapshot.schemaVersion} · {snapshot.deploymentAllowed ? "deployment enabled" : "research only"}</span>
      </footer>
    </div>
  );
}
