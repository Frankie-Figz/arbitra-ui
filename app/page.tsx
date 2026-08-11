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
  targetMarkHit: boolean;
  targetMarkPrice: number | null;
  targetMarkDate: string | null;
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
    unfilledTargetMarkWindowCompletedCandles: number;
  };
};

type MatrixMetric = "conditionalHitRate" | "successPerSignal";

const snapshot = snapshotJson as Snapshot;
const validTradeDatasets = snapshot.datasets.filter((dataset) => dataset.assets.length > 0).slice(0, 30);

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
              const targetMarkHit = outcome?.targetMarkHit ?? outcome?.targetHit ?? false;
              const result = outcome
                ? `${outcome.filled ? "pullback filled" : "pullback not filled"}, ${targetMarkHit ? "target mark reached" : "target mark not reached"}`
                : null;
              return (
                <button
                  className={`heat-cell ${outcome ? "realized" : ""} ${selected ? "selected" : ""}`}
                  key={`${pullback}-${target}`}
                  style={outcome ? undefined : heatStyle(value)}
                  onClick={() => onSelect(pullback, target)}
                  role="gridcell"
                  aria-selected={selected}
                  aria-label={`${pullback}% pullback, ${target}% target, ${percentage(value)} historical probability${result ? `, ${result}` : ""}`}
                  title={`${pullback}% pullback → ${target}% target: ${percentage(value, 2)}${result ? ` · ${result}` : ""}`}
                >
                  {outcome && (
                    <>
                      <span className={`heat-triangle heat-pullback ${outcome.filled ? "hit" : "miss"}`} aria-hidden="true" />
                      <span className={`heat-triangle heat-target ${targetMarkHit ? "hit" : "miss"}`} aria-hidden="true" />
                    </>
                  )}
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
  const [selectedDate, setSelectedDate] = useState(validTradeDatasets[0]?.date ?? "");
  const [methodologyId, setMethodologyId] = useState(snapshot.methodologies[0]?.id ?? "");
  const [assetSymbol, setAssetSymbol] = useState("");
  const [matrixMetric, setMatrixMetric] = useState<MatrixMetric>("conditionalHitRate");
  const [pullbackPercent, setPullbackPercent] = useState(1);
  const [targetPercent, setTargetPercent] = useState(5);

  const dataset = snapshot.datasets.find((item) => item.date === selectedDate);
  const methodology = snapshot.methodologies.find((item) => item.id === methodologyId) ?? snapshot.methodologies[0];
  const matrix = snapshot.matrices.find((item) => item.methodologyId === methodologyId)?.cells ?? [];
  const methodAssets = useMemo(
    () => dataset?.assets.filter((asset) => asset.methodologies.includes(methodologyId)) ?? [],
    [dataset, methodologyId],
  );
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

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="topbar">
          <div className="brand-lockup">
            <div className="brand">
              <span className="brand-mark">A</span>
              <div><strong>ARBITRA</strong><small>Daily Longs</small></div>
            </div>
            <p className="brand-tagline">Long setups,<br />without the noise.</p>
          </div>

          <div className="header-asset" aria-live="polite">
            <div className="header-asset-context">
              <span>Selected long</span>
              <small>{methodology.shortName} · {methodAssets.length} eligible</small>
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
                disabled={methodAssets.length === 0}
                onChange={(event) => setAssetSymbol(event.target.value)}
              >
                {methodAssets.length === 0 ? (
                  <option value="">No eligible assets</option>
                ) : methodAssets.map((item) => (
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
          <div className="market-state"><i /> completed candles only</div>
          <span>Eligibility is causal · matrices are historical · no order routing</span>
        </div>

      </header>

      <main>

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
            {dataset && (
              <div className="data-note">
                <span>Data quality</span>
                <p>{dataset.qualityRejected} quality rejected · {dataset.analysisFailed} analysis failed · {dataset.historyMissing} missing</p>
              </div>
            )}
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
                    <div><span>Pullback</span><strong className={selectedOutcome.filled ? "result-hit" : "result-miss"}>{selectedOutcome.filled ? "Filled" : "Not filled"}</strong></div>
                    <div><span>Target mark</span><strong className={selectedOutcome.targetMarkHit ? "result-hit" : "result-miss"}>{selectedOutcome.targetMarkHit ? "Reached" : "Not reached"}</strong></div>
                  </>
                ) : (
                  <>
                    <div><span>Hits after fill</span><strong>{percentage(selectedCell?.conditionalHitRate, 2)}</strong></div>
                    <div><span>Success per signal</span><strong>{percentage(selectedCell?.successPerSignal, 2)}</strong></div>
                  </>
                )}
                {!selectedOutcome && <div><span>Measurement</span><strong>5 + 20 candles</strong></div>}
              </div>
              <div className="matrix-footnote">
                {asset?.evaluationMature ? (
                  <div className="outcome-legend">
                    <span><i className="legend-diagonal" /> lower-left pullback · upper-right target</span>
                    <span><i className="legend-hit" /> hit</span>
                    <span><i className="legend-miss" /> missed</span>
                    <span><i className="legend-probability" /> probability</span>
                  </div>
                ) : (
                  <div className="probability-legend">
                    <span className="legend-gradient" aria-hidden="true" />
                    <span>lower</span><span>higher</span>
                  </div>
                )}
                <p>Entry is eligible for five completed candles. After a fill, the target mark uses the actual entry and twenty completed candles. Without a fill, it uses the hypothetical pullback price across the full twenty-five-candle window. No stop, costs, slippage, or order authority is included.</p>
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
