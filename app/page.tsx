"use client";

import { useMemo, useState } from "react";
import snapshotJson from "../public/data/arbitra-snapshot.json";

type Direction = "long" | "short";
type View = "baskets" | "scan" | "indicators" | "schedule";
type Parameters = Record<string, string | number | boolean | null>;

type Candidate = { category: string; featureId: string; parameters: Parameters };
type Family = {
  id: string;
  name: string;
  description: string;
  mode: "binary" | "hazard";
  coverage: "full" | "historical" | "ladder" | "registry";
  cellCount: number;
  candidates: Candidate[];
  references: Array<{ featureId: string; parameters: Parameters }>;
};
type Cell = {
  family: string;
  direction: Direction;
  bps: number;
  horizon: number;
  candleInterval: string;
  macroF1: number | null;
  balancedAccuracy: number | null;
  validationRows: number | null;
  positiveRows: number | null;
  negativeRows: number | null;
  finalFeatureCount: number | null;
  protectedReferencesSurvived: boolean;
  survivingFeatures: string[];
  source: string;
  evidenceKind: "selection" | "validation";
  runId: string | null;
};
type JacobFit = {
  direction: Direction;
  horizon: number;
  candleInterval: string;
  ladderBps: number[];
  baseRates: number[];
  rows: number;
  baselineLoss: number;
  boostedLoss: number;
  boostedSkill: number;
  improvement: number;
  confidenceInterval: number[];
};
type Snapshot = {
  generatedAt: string;
  source: string;
  families: Family[];
  cells: Cell[];
  jacob: JacobFit[];
  scanner: {
    updatedAt: string;
    universe: number;
    analyzed: number;
    signalLabel: string;
    candidates: Array<{
      symbol: string;
      name: string;
      close: number;
      direction: string;
      signalBar: string;
      ppo: number;
      priorMedian: number;
    }>;
  };
  indicators: {
    refined: Array<{ name: string; outputs: number; role: string }>;
    pine: string[];
  };
  schedule: Array<{ cadence: string; jobs: string[]; consequence: string }>;
};

const snapshot = snapshotJson as Snapshot;
const bpsOptions = [75, 100, 125, 150, 200, 300];
const candleOptions = ["1d", "4h", "3h", "2h", "1h"];

function percent(value: number | null | undefined, digits = 1) {
  return value == null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

function fixed(value: number | null | undefined, digits = 4) {
  return value == null ? "—" : value.toFixed(digits);
}

function parameterText(parameters: Parameters) {
  const entries = Object.entries(parameters).filter(
    ([key]) => !["denominator_epsilon", "round_decimals", "normalization"].includes(key),
  );
  return entries.length
    ? entries.map(([key, value]) => `${key}=${String(value)}`).join(", ")
    : "—";
}

function coverageLabel(family: Family) {
  if (family.coverage === "full") return "24 daily cells";
  if (family.coverage === "historical") return "100 bps selection";
  if (family.coverage === "ladder") return "joint ladder";
  return "definition only";
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function BarrierBars({
  primary,
  secondary,
  selected,
  mode,
}: {
  primary: Array<number | null>;
  secondary?: Array<number | null>;
  selected: number;
  mode: "classifier" | "base-rate";
}) {
  const min = mode === "classifier" ? 0.35 : 0;
  const max = mode === "classifier" ? 0.75 : 0.8;
  const height = (value: number | null) =>
    value == null ? 0 : Math.max(4, Math.min(100, ((value - min) / (max - min)) * 100));
  const description = bpsOptions
    .map((bps, index) => {
      const first = primary[index];
      const second = secondary?.[index];
      return `${bps} bps: ${first == null ? "unavailable" : percent(first)}${second == null ? "" : ` and ${percent(second)}`}`;
    })
    .join("; ");

  return (
    <div className="bar-chart" role="img" aria-label={description}>
      <div className="chart-scale" aria-hidden="true">
        <span>{Math.round(max * 100)}%</span>
        <span>{Math.round(((min + max) / 2) * 100)}%</span>
        <span>{Math.round(min * 100)}%</span>
      </div>
      <div className="bar-field">
        {bpsOptions.map((bps, index) => (
          <div className={`bar-column ${bps === selected ? "selected" : ""}`} key={bps}>
            <div className="bar-value">
              {bps === selected && primary[index] != null ? percent(primary[index]) : ""}
            </div>
            <div className="bar-pair">
              <span
                className={`bar primary ${primary[index] == null ? "missing" : ""}`}
                style={{ height: `${height(primary[index])}%` }}
              />
              {secondary && (
                <span
                  className={`bar secondary ${secondary[index] == null ? "missing" : ""}`}
                  style={{ height: `${height(secondary[index])}%` }}
                />
              )}
            </div>
            <span className="bar-label">{bps}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BasketExplorer() {
  const [familyId, setFamilyId] = useState("david");
  const [direction, setDirection] = useState<Direction>("long");
  const [bps, setBps] = useState(100);
  const [horizon, setHorizon] = useState(1);
  const [candle, setCandle] = useState("1d");
  const family = snapshot.families.find((item) => item.id === familyId) ?? snapshot.families[0];

  const sliceCells = useMemo(
    () =>
      snapshot.cells.filter(
        (cell) =>
          cell.family === familyId &&
          cell.direction === direction &&
          cell.horizon === horizon &&
          cell.candleInterval === candle,
      ),
    [familyId, direction, horizon, candle],
  );
  const cell = sliceCells.find((item) => item.bps === bps);
  const jacob = snapshot.jacob.find(
    (item) =>
      item.direction === direction &&
      item.horizon === horizon &&
      item.candleInterval === candle,
  );
  const selectedBaseRate = jacob?.baseRates[jacob.ladderBps.indexOf(bps)] ?? null;
  const unavailable =
    candle !== "1d"
      ? `No comparable ${candle} biblical-basket matrix is indexed.`
      : family.coverage === "registry"
        ? "The basket definition is registered, but no comparable evaluation cell is indexed."
        : family.mode === "binary" && !cell
          ? `${family.name} has no indexed ${bps} bps cell for this direction and horizon.`
          : null;

  const primary = bpsOptions.map((barrier) => {
    if (family.mode === "hazard") {
      return jacob?.baseRates[jacob.ladderBps.indexOf(barrier)] ?? null;
    }
    return sliceCells.find((item) => item.bps === barrier)?.balancedAccuracy ?? null;
  });
  const secondary =
    family.mode === "binary"
      ? bpsOptions.map(
          (barrier) => sliceCells.find((item) => item.bps === barrier)?.macroF1 ?? null,
        )
      : undefined;

  const selectFamily = (next: Family) => {
    setFamilyId(next.id);
    if (next.coverage === "historical") setBps(100);
  };

  return (
    <main className="product-shell">
      <section className="product-intro">
        <div>
          <p className="eyebrow">Biblical basket registry</p>
          <h1>One model. One target cell. Full provenance.</h1>
        </div>
        <p>
          Inspect exactly how a basket changes across direction, barrier, horizon, and candle size—without mixing validation, selection, or hazard objectives.
        </p>
      </section>

      <div className="explorer-layout">
        <aside className="registry" aria-label="Model basket registry">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Registry</span>
              <h2>18 families</h2>
            </div>
            <span className="count">{snapshot.cells.length} cells</span>
          </div>
          <div className="family-list">
            {snapshot.families.map((item) => (
              <button
                className={`family-button coverage-${item.coverage}`}
                aria-pressed={item.id === familyId}
                onClick={() => selectFamily(item)}
                key={item.id}
              >
                <span>{item.name}</span>
                <small>{coverageLabel(item)}</small>
              </button>
            ))}
          </div>
          <div className="coverage-key" aria-label="Coverage key">
            <span><i className="dot full" />full grid</span>
            <span><i className="dot historical" />100 bps</span>
            <span><i className="dot ladder" />hazard</span>
            <span><i className="dot registry-only" />definition</span>
          </div>
        </aside>

        <section className="basket-detail">
          <header className="basket-header">
            <div>
              <div className="title-row">
                <h2>{family.name}</h2>
                <span className={`status-pill ${family.mode}`}>{family.mode === "hazard" ? "hazard ladder" : "binary basket"}</span>
              </div>
              <p>{family.description}</p>
            </div>
            <div className="coverage-block">
              <strong>{family.cellCount}</strong>
              <span>indexed read-offs</span>
            </div>
          </header>

          <div className="controls" aria-label="Evaluation slice">
            <label>Direction
              <select value={direction} onChange={(event) => setDirection(event.target.value as Direction)}>
                <option value="long">LONG</option><option value="short">SHORT</option>
              </select>
            </label>
            <label>Barrier
              <select value={bps} onChange={(event) => setBps(Number(event.target.value))}>
                {bpsOptions.map((value) => <option value={value} key={value}>{value} bps</option>)}
              </select>
            </label>
            <label>Horizon
              <select value={horizon} onChange={(event) => setHorizon(Number(event.target.value))}>
                <option value={1}>h1</option><option value={2}>h2</option>
              </select>
            </label>
            <label>Candle
              <select value={candle} onChange={(event) => setCandle(event.target.value)}>
                {candleOptions.map((value) => <option value={value} key={value}>{value}</option>)}
              </select>
            </label>
          </div>

          {unavailable ? (
            <div className="coverage-gap" role="status">
              <span>Coverage gap</span>
              <strong>{unavailable}</strong>
              <small>Unavailable evidence is never rendered as zero.</small>
            </div>
          ) : family.mode === "hazard" && jacob ? (
            <>
              <div className="metrics">
                <Metric label="Boosted Brier loss" value={fixed(jacob.boostedLoss)} note="joint ladder · lower is better" />
                <Metric label="Baseline Brier loss" value={fixed(jacob.baselineLoss)} note="same rows and ladder" />
                <Metric label="Brier skill" value={percent(jacob.boostedSkill, 2)} note="relative to baseline" />
              </div>
              <div className="chart-section">
                <div className="section-heading">
                  <div><span className="eyebrow">Variation by barrier</span><h3>Unconditional hit base rate</h3></div>
                  <span className="chart-legend"><i className="dot full" />base rate</span>
                </div>
                <BarrierBars primary={primary} selected={bps} mode="base-rate" />
                <p className="evidence-line">
                  n={jacob.rows} · {bps} bps base rate {percent(selectedBaseRate)} · paired improvement {fixed(jacob.improvement)} · 95% CI {fixed(jacob.confidenceInterval[0])} to {fixed(jacob.confidenceInterval[1])}
                </p>
              </div>
            </>
          ) : cell ? (
            <>
              <div className="metrics">
                <Metric label="Balanced accuracy" value={percent(cell.balancedAccuracy)} note={cell.evidenceKind === "validation" ? "chronological validation" : "selection period"} />
                <Metric label="Macro F1" value={percent(cell.macroF1)} note="same target cell" />
                <Metric
                  label={cell.validationRows == null ? "Final features" : "Positive base rate"}
                  value={cell.validationRows == null ? String(cell.finalFeatureCount ?? "—") : percent((cell.positiveRows ?? 0) / cell.validationRows)}
                  note={cell.validationRows == null ? "top selected variant" : `${cell.positiveRows} of ${cell.validationRows} rows`}
                />
              </div>
              <div className="chart-section">
                <div className="section-heading">
                  <div><span className="eyebrow">Variation by barrier</span><h3>{direction.toUpperCase()} · h{horizon} · {candle}</h3></div>
                  <div className="chart-legend"><span><i className="dot full" />balanced accuracy</span><span><i className="dot historical" />Macro F1</span></div>
                </div>
                <BarrierBars primary={primary} secondary={secondary} selected={bps} mode="classifier" />
                <p className="evidence-line">
                  {cell.validationRows == null ? "Row counts not indexed in this summary" : `n=${cell.validationRows} · ${cell.positiveRows} positive · ${cell.negativeRows} negative`} · {cell.finalFeatureCount} final features · protected references {cell.protectedReferencesSurvived ? "survived" : "not verified"} · {cell.source} {cell.evidenceKind}
                </p>
              </div>
            </>
          ) : null}

          <section className="features-section">
            <div className="section-heading">
              <div><span className="eyebrow">Configured order</span><h3>Candidate feature manifest</h3></div>
              <span className="count">{family.candidates.length} candidates</span>
            </div>
            <div className="feature-table-wrap">
              <table>
                <thead><tr><th>#</th><th>Category</th><th>Stable identity</th><th>Parameters</th></tr></thead>
                <tbody>
                  {family.candidates.map((candidate, index) => (
                    <tr key={`${candidate.featureId}-${index}`}>
                      <td>{index + 1}</td><td>{candidate.category}</td><td><code>{candidate.featureId}</code></td><td>{parameterText(candidate.parameters)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="references">
              <span>Protected references</span>
              {family.references.map((reference) => (
                <code key={reference.featureId}>{reference.featureId}{parameterText(reference.parameters) === "—" ? "" : ` · ${parameterText(reference.parameters)}`}</code>
              ))}
            </div>
            {cell?.survivingFeatures.length ? (
              <details className="survivors">
                <summary>Show {cell.survivingFeatures.length} selected-cell survivors</summary>
                <ul>{cell.survivingFeatures.map((feature) => <li key={feature}><code>{feature}</code></li>)}</ul>
              </details>
            ) : null}
          </section>
        </section>
      </div>
    </main>
  );
}

function ScanView() {
  const coverage = snapshot.scanner.analyzed / snapshot.scanner.universe;
  return (
    <main className="secondary-view">
      <section className="product-intro">
        <div><p className="eyebrow">Daily universe</p><h1>Liquidity Sniper scan</h1></div>
        <p>The scan is an opportunity surface. A LONG flag is research evidence, never order authority.</p>
      </section>
      <div className="metrics">
        <Metric label="Declared universe" value={snapshot.scanner.universe.toLocaleString()} note="stocks and crypto" />
        <Metric label="Analyzed" value={snapshot.scanner.analyzed.toLocaleString()} note={`${percent(coverage)} denominator coverage`} />
        <Metric label="Primary LONG shadows" value={String(snapshot.scanner.candidates.length)} note="completed candles only" />
      </div>
      <section className="scan-card">
        <div className="section-heading"><div><span className="eyebrow">Current green set</span><h2>{snapshot.scanner.signalLabel}</h2></div><span className="status-pill hazard">research only</span></div>
        <div className="scan-list">
          {snapshot.scanner.candidates.map((candidate) => (
            <article key={candidate.symbol}>
              <div className="ticker"><strong>{candidate.symbol}</strong><span>{candidate.name}</span></div>
              <strong>${candidate.close.toFixed(2)}</strong>
              <span className="direction">{candidate.direction}</span>
              <small>PPO {candidate.ppo.toFixed(4)} &lt; prior median {candidate.priorMedian.toFixed(4)}</small>
              <time>{candidate.signalBar}</time>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function IndicatorsView() {
  return (
    <main className="secondary-view">
      <section className="product-intro">
        <div><p className="eyebrow">Indicator arsenal</p><h1>One identity across Python and Pine.</h1></div>
        <p>Refined outputs stay explicit so chart behavior, feature engineering, and research evidence can be reconciled.</p>
      </section>
      <div className="indicator-layout">
        <section>
          <div className="section-heading"><div><span className="eyebrow">Causal package</span><h2>Refined families</h2></div><span className="count">58 outputs</span></div>
          <div className="indicator-list">
            {snapshot.indicators.refined.map((indicator) => (
              <article key={indicator.name}><div><strong>{indicator.name}</strong><p>{indicator.role}</p></div><span>{indicator.outputs}</span></article>
            ))}
          </div>
        </section>
        <section>
          <div className="section-heading"><div><span className="eyebrow">TradingView</span><h2>Optimized Pine inventory</h2></div><span className="count">{snapshot.indicators.pine.length} scripts</span></div>
          <div className="pine-grid">{snapshot.indicators.pine.map((name) => <code key={name}>{name}</code>)}</div>
        </section>
      </div>
    </main>
  );
}

function ScheduleView() {
  return (
    <main className="secondary-view">
      <section className="product-intro">
        <div><p className="eyebrow">Living interface</p><h1>Scheduled evidence lanes</h1></div>
        <p>Each cadence updates a bounded slice of the observatory. Missing runs stay visible instead of disappearing.</p>
      </section>
      <div className="schedule-grid">
        {snapshot.schedule.map((lane, index) => (
          <article key={lane.cadence}>
            <span className="lane-number">0{index + 1}</span>
            <h2>{lane.cadence}</h2>
            <ul>{lane.jobs.map((job) => <li key={job}>{job}</li>)}</ul>
            <p>{lane.consequence}</p>
          </article>
        ))}
      </div>
      <section className="data-contract">
        <span className="eyebrow">Update contract</span>
        <h2>Artifacts in. Snapshot out. Interface stays stable.</h2>
        <p>The repository’s sync task reads model definitions, evaluation matrices, and Jacob ablations from Arbitra, then rebuilds a versioned UI snapshot for deployment.</p>
      </section>
    </main>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("baskets");
  const navigation: Array<[View, string]> = [
    ["baskets", "Model baskets"], ["scan", "Daily scan"], ["indicators", "Indicators"], ["schedule", "Schedule"],
  ];
  const generated = new Intl.DateTimeFormat("en", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
  }).format(new Date(snapshot.generatedAt));

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">A</span><div><strong>ARBITRA</strong><small>Research Observatory</small></div></div>
        <nav aria-label="Primary navigation">
          {navigation.map(([id, label]) => <button key={id} aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}
        </nav>
        <div className="sync-state"><i />snapshot <time>{generated}</time></div>
      </header>
      <div className="authority-strip"><strong>Research opportunity ≠ order</strong><span>Every score retains its target identity, evidence period, and objective.</span></div>
      {view === "baskets" && <BasketExplorer />}
      {view === "scan" && <ScanView />}
      {view === "indicators" && <IndicatorsView />}
      {view === "schedule" && <ScheduleView />}
      <footer><span>Arbitra UI</span><span>Snapshot schema v1 · deployment authority disabled</span></footer>
    </div>
  );
}
