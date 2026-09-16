"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./oscillators.module.css";
import CryptoSignalTicker from "./CryptoSignalTicker";
import { isSnapshotFresh, millisecondsUntilNextScan } from "./signal-market";
import { formatTimestamp, getTimeZoneState, initialTimeZoneState, isSignalToday, resolveTimeZone, TIME_ZONE_STORAGE_KEY } from "./timezones";

type Entry = {
  id: string; rank: number; indicator: string; timeframeMinutes: number; mode: string;
  returnPct: number; drawdownPct: number; trades: number; stressReturnPct: number | null;
  latestFoldReturnPct: number | null; bindingId: string; parameters: unknown;
  featuresByFold: Record<string, string[]>; policyByFold: Record<string, unknown>;
  modelByFold: Record<string, { sha256: string; path: string; inferenceDevice?: string; trainingDevice?: string }>;
};
type Catalog = {
  schemaVersion: number; bundleId: string; status: string; frozenAt: string; sourceDigest: string;
  deploymentAllowed: false; assets: { symbol: string; entries: Entry[] }[];
};
type RecentSignal = {
  direction: "BUY" | "SELL"; decision_utc: string; expires_utc: string;
  window_minutes: number; at_latest_native_close: boolean;
};
type LiveRow = {
  id: string; status: string; reason?: string | null; current_signal: "BUY" | "SELL" | "NONE";
  recent_signal?: RecentSignal | null;
  diagnostic_code?: string; diagnostic_message?: string;
  source?: { closed_parent_bars?: number; minimum_closed_parent_bars?: number; native_bars?: number; minimum_native_bars?: number } | null;
  latest_raw_event: null | { direction: string; decision_utc: string; age_minutes: number;
    at_latest_native_close: boolean; raw_exit_for: string; exit_requires_xgb_acceptance: false };
  admission: null | { status: string; accepted: boolean | null; score: number | null;
    policy_mode: string; inference_device?: string; cpu_portability_not_historical_gpu_parity?: boolean };
};
type HistoricalSignal = {
  bundleId: string; entryId: string; asset: string; venue: string; pair: string;
  timeframeMinutes: number; indicator: string; mode: string; direction: "BUY" | "SELL";
  signalTime: string; evaluatedAt: string; evaluationKind: "observed" | "reconstructed";
  sourceStart: string; status: string; admission: LiveRow["admission"];
  marketCondition: { as_of_utc: string; close: number | null; trend: string;
    bar_change_pct: number | null; return_1h_pct: number | null; return_24h_pct: number | null;
    atr14_pct: number | null; volatility_24h_pct: number | null; volume_ratio20: number | null };
};
type Live = {
  schemaVersion: number; bundleId: string; asset: string; status: string; reason?: string;
  venue: string; quote: string; pair: string; marketType: string; transferValidation: string;
  asOf: string; dataThrough: string; results: LiveRow[]; deploymentAllowed: false; ordersSubmitted: 0;
  history?: HistoricalSignal[]; historyPersistence?: string; historyWarning?: string;
  historyDataThrough?: string; historyBackfill?: string;
};
const venues = { binance: { name: "Binance", quote: "USDT" }, kraken: { name: "Kraken", quote: "USD" }, coinbase: { name: "Coinbase", quote: "USD" }, okx: { name: "OKX", quote: "USDT" } };
type Venue = keyof typeof venues;
const bundleId = "oscillator-mixed-top10-20260913-v1";
const names: Record<string, string> = { ao: "AO", ppo: "PPO", pvo: "PVO", roc: "ROC", rsi: "RSI", stc: "STC", stochrsi: "StochRSI", stochastic: "Stochastic", tsi: "TSI", ultimate: "Ultimate", vortex: "Vortex", cci: "CCI", dpo: "DPO", mfi: "MFI", obv_divergence: "OBV divergence", volume_exhaustion: "Volume exhaustion" };
const modes: Record<string, string> = { raw: "Raw", baseline27: "XGB baseline", selected: "XGB support", frozen_pooled: "XGB pooled", frozen_specialist: "XGB specialist" };
const pct = (value: number | null) => value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const clock = (minutes: number) => minutes === 1440 ? "1d" : minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;

function matchesSelection(live: Live | null, asset: string, venue: Venue): live is Live {
  return !!live && live.schemaVersion === 1 && live.bundleId === bundleId && live.asset === asset && live.venue === venue && live.quote === venues[venue].quote && live.pair === `${asset}/${venues[venue].quote}` && live.marketType === "spot" && live.transferValidation === (venue === "binance" ? "same_venue" : "not_validated") && live.deploymentAllowed === false && live.ordersSubmitted === 0 && ["available", "unavailable"].includes(live.status) && Array.isArray(live.results);
}

function fresh(live: Live | null, asset: string, venue: Venue): boolean {
  if (!live || live.schemaVersion !== 1 || live.bundleId !== bundleId || live.asset !== asset || live.venue !== venue || live.quote !== venues[venue].quote || live.pair !== `${asset}/${venues[venue].quote}` || live.marketType !== "spot" || live.transferValidation !== (venue === "binance" ? "same_venue" : "not_validated") || live.status !== "available" || live.deploymentAllowed !== false || live.ordersSubmitted !== 0) return false;
  return isSnapshotFresh(live.asOf, live.dataThrough, Date.now());
}

/** Reject ambiguous/local timestamps before accepting a backend recency window. */
function signalTimestamp(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  const [year, month, day, hour, minute, second] = value.slice(0, 19).split(/[-T:]/).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || minute > 59 || second > 59) return NaN;
  return Date.parse(value);
}

/** Recency comes only from the service, never reconstructed from the UI's capped history. */
function validRecentSignal(entry: Entry, row: LiveRow, live: Live, now: number): RecentSignal | null {
  const recent = row.recent_signal;
  if (!recent || typeof recent !== "object" || row.id !== entry.id || row.status === "unavailable" || !["BUY", "SELL"].includes(recent.direction)) return null;
  const expectedWindow = Math.max(60, entry.timeframeMinutes);
  if (!Number.isInteger(entry.timeframeMinutes) || entry.timeframeMinutes <= 0 || !Number.isInteger(recent.window_minutes) || recent.window_minutes !== expectedWindow || typeof recent.at_latest_native_close !== "boolean") return null;
  const decision = signalTimestamp(recent.decision_utc), expiry = signalTimestamp(recent.expires_utc);
  const through = Date.parse(live.dataThrough), asOf = Date.parse(live.asOf);
  if (![decision, expiry, through, asOf].every(Number.isFinite) || decision > now || decision > through || decision > asOf || now >= expiry || expiry - decision !== expectedWindow * 60_000) return null;
  if (recent.at_latest_native_close !== (decision === through)) return null;
  if (recent.at_latest_native_close && row.current_signal !== recent.direction) return null;
  if (!recent.at_latest_native_close && ["BUY", "SELL"].includes(row.current_signal)) return null;
  return recent;
}

function signalAge(recent: RecentSignal, now: number): string {
  const minutes = Math.floor((now - Date.parse(recent.decision_utc)) / 60_000);
  return minutes < 1 ? "<1m" : clock(minutes);
}

export default function FrozenOscillatorLab() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [asset, setAsset] = useState("BTC");
  const [selectedId, setSelectedId] = useState("");
  const [live, setLive] = useState<Live | null>(null);
  const [liveError, setLiveError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [fold, setFold] = useState("fold3");
  const [, setTick] = useState(0);
  const [venue, setVenue] = useState<Venue>("binance");
  const [historyFilter, setHistoryFilter] = useState("accepted");
  const [historyTf, setHistoryTf] = useState("all");
  const [timeZoneState, setTimeZoneState] = useState(initialTimeZoneState);

  useEffect(() => {
    let saved: string | null = null;
    try { saved = window.localStorage.getItem(TIME_ZONE_STORAGE_KEY); } catch { /* Storage can be disabled. */ }
    setTimeZoneState(getTimeZoneState(saved));
  }, []);

  const timeZone = resolveTimeZone(timeZoneState);
  const time = (value: string | null | undefined) => formatTimestamp(value, timeZone);
  const changeTimeZone = (preference: string) => {
    if (preference !== "auto" && !timeZoneState.options.includes(preference)) return;
    setTimeZoneState((previous) => ({ ...previous, preference }));
    try { window.localStorage.setItem(TIME_ZONE_STORAGE_KEY, preference); } catch { /* Keep the in-memory selection. */ }
  };

  useEffect(() => {
    const controller = new AbortController();
    fetch("/data/frozen-oscillator-catalog.json", { cache: "no-store", signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error("Frozen catalog has not been synchronized"); return response.json(); })
      .then((value: Catalog) => {
        if (value.schemaVersion !== 1 || value.bundleId !== bundleId || value.status !== "frozen_research" || value.deploymentAllowed !== false || !Array.isArray(value.assets) || !value.assets.length) throw new Error("Frozen catalog identity could not be verified");
        setCatalog(value);
      }).catch((error) => { if (!controller.signal.aborted) setCatalogError(error.message); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 15_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!catalog) return;
    const controller = new AbortController();
    let busy = false;
    setLive(null); setLiveError("");
    const load = async () => {
      if (busy || document.hidden) return;
      busy = true; setLoading(true);
      try {
        const response = await fetch(`/api/frozen-oscillators/live?asset=${encodeURIComponent(asset)}&venue=${venue}`, { cache: "no-store", signal: controller.signal });
        const value = await response.json();
        if (controller.signal.aborted) return;
        if (!matchesSelection(value, asset, venue)) {
          setLive(null); setLiveError("Live response does not match the selected asset and venue");
        } else { setLive(value); setLiveError(response.ok && value.status === "available" ? "" : value.reason || "Live service unavailable"); }
      } catch { if (!controller.signal.aborted) { setLive((previous) => previous ? { ...previous, status: "unavailable", results: [] } : null); setLiveError("Live service is unreachable. Any retained signal history is not current evidence."); } }
      finally { busy = false; if (!controller.signal.aborted) setLoading(false); }
    };
    void load();
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => { void load(); schedule(); }, millisecondsUntilNextScan(Date.now()));
    };
    schedule();
    document.addEventListener("visibilitychange", load);
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", load); };
  }, [asset, venue, catalog, refresh]);

  const entries = catalog?.assets.find((item) => item.symbol === asset)?.entries ?? [];
  const selected = entries.find((entry) => entry.id === selectedId);
  const liveReady = fresh(live, asset, venue);
  const trusted = matchesSelection(live, asset, venue);
  const histories = trusted && Array.isArray(live.history) ? live.history.filter((row) => row.bundleId === bundleId && row.asset === asset && row.venue === venue && row.pair === live.pair && entries.some((entry) => entry.id === row.entryId) && ["BUY", "SELL"].includes(row.direction) && ["observed", "reconstructed"].includes(row.evaluationKind) && Number.isFinite(Date.parse(row.signalTime)) && Date.parse(row.signalTime) <= Date.parse(row.evaluatedAt) && Date.parse(row.signalTime) === Date.parse(row.marketCondition?.as_of_utc)).sort((a, b) => Date.parse(b.signalTime) - Date.parse(a.signalTime)).slice(0, 200) : [];
  const visibleHistory = histories.filter((row) => (historyFilter === "all" || row.admission?.accepted === true) && (historyTf === "all" || row.timeframeMinutes === Number(historyTf)));
  const diagnosticRows = trusted ? live.results : [];
  const liveRow = useCallback((id: string) => live?.results.find((row) => row.id === id), [live]);
  const signal = (row: LiveRow | undefined, recent: RecentSignal | null) => {
    if (!row || !trusted) return "Unavailable";
    if (row.status === "unavailable") return row.diagnostic_code === "warmup_insufficient" ? "Needs history" : "Unavailable";
    if (!liveReady) return "Unavailable";
    if (["BUY", "SELL"].includes(row.current_signal)) return row.current_signal;
    if (recent) return `Recent ${recent.direction}`;
    if (row.status === "ineligible_warmup_or_sigma") return "Ineligible event";
    return row.status === "xgb_rejected" && row.latest_raw_event?.at_latest_native_close ? "Filtered" : "No new entry";
  };
  const now = Date.now();
  const entrySignals = entries.map((entry) => {
    const row = liveRow(entry.id);
    const recent = liveReady && trusted && row ? validRecentSignal(entry, row, live, now) : null;
    return { entry, row, recent, state: signal(row, recent) };
  });
  const latestCount = entrySignals.filter(({ state }) => ["BUY", "SELL"].includes(state)).length;
  const recentCount = entrySignals.filter(({ state }) => ["Recent BUY", "Recent SELL"].includes(state)).length;
  const detailLive = selected && liveReady ? liveRow(selected.id) : undefined;
  const detailSignal = selected ? entrySignals.find(({ entry }) => entry.id === selected.id) : undefined;
  return (
    <div className={styles.shell}>
      <header className={styles.header}><a href="/" className={styles.brand}>A / ARBITRA</a><nav aria-label="Market sections"><a href="/">Stock Picker</a><a href="/oscillators" aria-current="page">Crypto Scanner</a></nav><span>Research only · no order execution</span></header>
      <main className={styles.main}>
        <div className={styles.heading}>
          <div><p className={styles.eyebrow}>Oscillators</p><h1>Crypto Scanner</h1></div>
          <label className={styles.timezoneControl}>Timezone<select aria-label="Display timezone" value={timeZoneState.preference} onChange={(event) => changeTimeZone(event.target.value)}><option value="auto">Automatic ({timeZoneState.browserTimeZone})</option>{timeZoneState.options.map((zone) => <option key={zone} value={zone}>{zone === "America/New_York" ? "Florida / New York — Eastern Time" : zone}</option>)}</select></label>
        </div>
        {catalogError && <p role="alert" className={styles.notice}>{catalogError}. Run the dedicated frozen-catalog sync; existing market snapshots need not change.</p>}
        {!catalog && !catalogError && <p role="status">Loading the frozen catalog…</p>}
        {catalog && <>
          <CryptoSignalTicker key={venue} catalog={catalog} venue={venue} venueName={venues[venue].name} timeZone={timeZone} now={now} onSelect={(nextAsset, entryId) => { if (nextAsset !== asset) { setAsset(nextAsset); setLive(null); setLiveError(""); setHistoryTf("all"); } setSelectedId(entryId); }} />
          <section className={styles.toolbar} aria-label="Asset and live inference controls">
            <label>Asset<select value={asset} onChange={(event) => { setAsset(event.target.value); setSelectedId(""); setLive(null); setLiveError(""); setHistoryTf("all"); }}>{catalog.assets.map((item) => <option key={item.symbol} value={item.symbol}>{item.symbol}{venues[venue].quote}</option>)}</select></label>
            <label>Data venue<select value={venue} onChange={(event) => { setVenue(event.target.value as Venue); setLive(null); setLiveError(""); setSelectedId(""); }}>{Object.entries(venues).map(([key, value]) => <option key={key} value={key}>{value.name} · {value.quote} spot</option>)}</select></label>
            <div><span className={styles.label}>Closed candles through</span><strong>{liveReady ? time(live?.dataThrough) : "Not verified"}</strong><small>{venues[venue].name} · {asset}/{venues[venue].quote} spot</small></div>
            <button className={styles.refresh} disabled={loading} onClick={() => setRefresh((value) => value + 1)}>{loading ? "Evaluating…" : "Refresh signals"}</button>
          </section>
          <p className={styles.timezoneNote}>Signals recalculate every 15 minutes, just after each quarter-hour close. All timestamps shown in {timeZone}; each includes its UTC offset. Stored timestamps, signal ages and expiry windows are unchanged.</p>
          <p className={styles.notice} role="status">{liveReady ? "BUY/SELL marks an accepted entry on the latest closed 15m candle. Recent BUY/SELL retains an earlier accepted entry for the longer of 60 minutes or its oscillator timeframe, unless an opposite raw signal cancels it. Recency is display-only, not a new entry, position or order." : liveError || (loading ? "Checking completed candles and frozen models. No current or recent signal is asserted while evaluation is pending." : "Live evidence is stale or unavailable. Historical winners are not current or recent signals.")}</p>
          {venue !== "binance" && <p className={styles.transferNote}>Cross-venue observation: models and historical returns are from Binance USDT. Performance on {venues[venue].name} is not validated. Pairs or timeframes without enough same-venue history stay unavailable.</p>}
          {!!diagnosticRows.length && <p className={styles.diagnostics}>{diagnosticRows.filter((row) => !["unavailable", "ineligible_warmup_or_sigma"].includes(row.status)).length}/{entries.length} setups evaluated · {diagnosticRows.filter((row) => row.status === "unavailable").length} unavailable · {diagnosticRows.filter((row) => row.status === "ineligible_warmup_or_sigma").length} ineligible last events. Active entry badges: {latestCount + recentCount} ({latestCount} latest-close · {recentCount} recent). Historical rows below do not revive an expired or cancelled badge.</p>}
          <div className={styles.workspace}>
            <section className={styles.board} aria-label={`${asset} frozen top ten`}>
              <div className={styles.panelHeading}><h2>{asset} / ranked setups</h2><span>Select an oscillator for details</span></div>
              <div className={styles.tableScroll}><table><thead><tr><th>#</th><th>Oscillator / TF</th><th>Version</th><th>Net return</th><th>Max DD</th><th>Trades</th><th>Entry signal / recency</th><th>Latest raw signal ({timeZone})</th></tr></thead><tbody>
                {entrySignals.map(({ entry, row, recent, state }) => <tr key={entry.id} className={selected?.id === entry.id ? styles.selected : ""}>
                  <td>{entry.rank}</td><td><button className={styles.rowButton} onClick={() => setSelectedId(entry.id)} aria-pressed={selected?.id === entry.id}>{names[entry.indicator] ?? entry.indicator}<small>{clock(entry.timeframeMinutes)}</small></button></td>
                  <td><span className={entry.mode === "raw" ? styles.raw : styles.xgb}>{modes[entry.mode]}</span></td><td className={styles.return}>{pct(entry.returnPct)}</td><td>{entry.drawdownPct.toFixed(2)}%</td><td>{entry.trades}{entry.trades <= 5 && <small className={styles.sparse}>Sparse</small>}</td>
                  <td><span className={state === "BUY" ? styles.buy : state === "SELL" ? styles.sell : state === "Recent BUY" ? styles.recentBuy : state === "Recent SELL" ? styles.recentSell : styles.quiet}>{state}</span>
                    {recent ? <small className={styles.signalTiming}>{recent.at_latest_native_close ? "Latest 15m close" : "Earlier accepted entry"} · age {signalAge(recent, now)}<br />Expires {time(recent.expires_utc)} · {clock(recent.window_minutes)} window</small> : ["BUY", "SELL"].includes(state) && <small className={styles.signalTiming}>Latest 15m close</small>}
                    {trusted && <small className={styles.rowDiagnostic}>{row?.diagnostic_message || row?.reason}{row?.source?.minimum_closed_parent_bars != null && ` (${row.source.closed_parent_bars ?? 0}/${row.source.minimum_closed_parent_bars} TF candles)`}</small>}</td>
                  <td className={trusted && row?.latest_raw_event ? (isSignalToday(row.latest_raw_event.decision_utc, timeZone, now) ? styles.rawSignalToday : styles.rawSignalOlder) : undefined}>{trusted && row?.latest_raw_event ? <>{row.latest_raw_event.direction}<small className={styles.rowDiagnostic}>{time(row.latest_raw_event.decision_utc)}</small></> : "—"}</td></tr>)}
              </tbody></table></div>
              <p className={styles.footnote}>Historical results: Binance USDT spot · Mar 28 – Sep 8, 2026 · 18 bp costs · independent 1× accounts. These returns are not current signals or results from the selected venue.</p>
            </section>
            {selected && <aside className={styles.detail} aria-label="Selected oscillator model details">
              <button className={styles.closeDetails} onClick={() => setSelectedId("")}>Close details</button>
              <p className={styles.eyebrow}>Frozen definition / #{selected.rank}</p><h2>{names[selected.indicator] ?? selected.indicator} <span>{clock(selected.timeframeMinutes)}</span></h2>
              <p>{modes[selected.mode]} · {asset}</p>
              <dl className={styles.metrics}><div><dt>36 bp stress return</dt><dd>{pct(selected.stressReturnPct)}</dd></div><div><dt>Latest historical fold</dt><dd>{pct(selected.latestFoldReturnPct)}</dd></div></dl>
              <section className={styles.event}><h3>Entry signal</h3><strong>{detailSignal?.state ?? "Unavailable"}</strong>
                {detailSignal?.recent && <p>Accepted close: {time(detailSignal.recent.decision_utc)} · age {signalAge(detailSignal.recent, now)}. Expires {time(detailSignal.recent.expires_utc)} ({clock(detailSignal.recent.window_minutes)} window from that close).</p>}
                <p>BUY/SELL is a latest-close entry. Recent is an earlier accepted entry still inside its display window, not a new pulse or an open position. An opposite raw signal cancels it even if that opposite entry is XGB-rejected. A rejected same-direction pulse does not renew it.</p>
                <h3>Latest raw event</h3>{liveReady && detailLive?.latest_raw_event ? <><strong>{detailLive.latest_raw_event.direction} · {time(detailLive.latest_raw_event.decision_utc)}</strong><p>This newest raw pulse can differ from the retained accepted entry above. Its admission applies only to this pulse.</p><p>Opposite-position exit: {detailLive.latest_raw_event.raw_exit_for}. Raw exits do not require XGBoost acceptance.</p>{detailLive.admission && <p>Latest raw admission: {detailLive.admission.accepted === true ? "accepted" : detailLive.admission.accepted === false ? "rejected" : "unavailable"} · policy {detailLive.admission.policy_mode}{detailLive.admission.score != null ? ` · score ${detailLive.admission.score.toFixed(4)} (not a probability)` : ""}</p>}</> : <p>No verified raw event is available.</p>}{detailLive?.reason && <p role="status">{detailLive.reason}</p>}</section>
              <details><summary>Oscillator parameters</summary><pre>{JSON.stringify(selected.parameters, null, 2)}</pre></details>
              <details><summary>Model and feature support</summary>
              <label className={styles.fold}>Inspect historical definition<select value={fold} onChange={(event) => setFold(event.target.value)}><option value="fold3">Fold 3 (live model)</option><option value="fold2">Fold 2 (historical only)</option><option value="fold1">Fold 1 (historical only)</option></select></label>
              <details><summary>Entry policy</summary><pre>{JSON.stringify(selected.policyByFold[fold] ?? {}, null, 2)}</pre><p>ALL does not score-filter entries. NONE takes no entries.</p></details>
              <details><summary>Ordered features ({selected.featuresByFold[fold]?.length ?? 0})</summary>{selected.mode === "raw" ? <p>Raw strategy: no XGBoost features or model.</p> : <ol>{(selected.featuresByFold[fold] ?? []).map((name) => <li key={name}>{name}</li>)}</ol>}</details>
              <details><summary>Model provenance</summary><pre>{JSON.stringify(selected.modelByFold[fold] ?? { mode: "raw", model: null }, null, 2)}</pre><p>Native models remain on the private inference service. Full-period results span three historical versions, not just the latest checkpoint.</p></details>
              </details>
              <small className={styles.identity}>{selected.id}</small>
            </aside>}
          </div>
          <section className={`${styles.board} ${styles.history}`} aria-label="Historical signals">
            <div className={styles.panelHeading}><div><h2>Historical signals</h2><p>{asset} · {venues[venue].name} · {visibleHistory.length} shown / {histories.length} loaded</p></div>
              <div className={styles.historyControls}><label>Entries<select value={historyFilter} onChange={(event) => setHistoryFilter(event.target.value)}><option value="accepted">Accepted entries</option><option value="all">All raw signals + filters</option></select></label>
              <label>Timeframe<select value={historyTf} onChange={(event) => setHistoryTf(event.target.value)}><option value="all">All timeframes</option>{[...new Set(entries.map((entry) => entry.timeframeMinutes))].sort((a, b) => a - b).map((tf) => <option key={tf} value={String(tf)}>{clock(tf)}</option>)}</select></label></div>
            </div>
            <p className={styles.footnote}>Signal time is the candle close when the event became knowable. “Observed” means evaluated on its latest close; “Reconstructed” means replayed now with the frozen fold-3 rules, not a previously recorded live call or a trade. Conditions use only 15m candles closed at signal time.</p>
            <p className={styles.footnote}>Today’s signals are bold; other days are grey. “Today” follows {timeZone} and the original signal time, not its later evaluation time.</p>
            {trusted && live.historyBackfill && <p className={styles.notice}>{live.historyBackfill} History candles through {time(live.historyDataThrough!)}.</p>}
            {trusted && live.historyWarning && <p role="status" className={styles.notice}>{live.historyWarning}</p>}
            {!!visibleHistory.length ? <div className={styles.tableScroll}><table className={styles.historyTable}><thead><tr><th>Asset / venue</th><th>Oscillator / TF</th><th>Signal / admission</th><th>Signal time ({timeZone})</th><th>Evaluation ({timeZone})</th><th>Market condition at signal</th></tr></thead><tbody>
              {visibleHistory.map((row) => <tr key={`${row.entryId}/${row.signalTime}/${row.sourceStart}/${row.evaluationKind}`} className={isSignalToday(row.signalTime, timeZone, now) ? styles.historyToday : styles.historyOlder}><td>{row.asset}<small>{row.pair} · {venues[venue].name}</small></td><td>{names[row.indicator] ?? row.indicator} · {clock(row.timeframeMinutes)}<small>{modes[row.mode] ?? row.mode}</small></td>
                <td><strong>{row.direction}</strong><small>{row.admission?.accepted === true ? "Accepted entry" : row.admission?.accepted === false ? "Filtered entry" : "Ineligible / unavailable"}</small></td>
                <td>{time(row.signalTime)}</td><td>{time(row.evaluatedAt)}<small>{row.evaluationKind === "observed" ? "Observed" : "Reconstructed"}</small></td>
                <td><strong>{row.marketCondition.trend ?? "unknown"}</strong> · price {row.marketCondition.close?.toLocaleString(undefined, { maximumSignificantDigits: 8 }) ?? "—"}<small>Bar {pct(row.marketCondition.bar_change_pct)} · 1h {pct(row.marketCondition.return_1h_pct)} · 24h {pct(row.marketCondition.return_24h_pct)}</small><small>ATR14 {pct(row.marketCondition.atr14_pct)} · σ96 {pct(row.marketCondition.volatility_24h_pct)} · volume {row.marketCondition.volume_ratio20 == null ? "—" : `${row.marketCondition.volume_ratio20.toFixed(2)}×`}</small></td></tr>)}
            </tbody></table></div> : <p className={styles.footnote}>No {historyFilter === "accepted" ? "accepted entries" : "raw signals"} saved for this selection yet. {histories.length ? "Try all raw signals or another timeframe." : "Unavailable data or insufficient warm-up does not mean the strategies never signalled."}</p>}
            <p className={styles.footnote}>Latest 200 saved events for this asset and venue. Replay: up to seven days / 50 events per setup, constrained by available history. The market scan requests every asset on Binance every 15 minutes; other venues scan while recently viewed. Trend: close + EMA20/50 alignment. ATR14: Wilder percent of close. σ96: 15m return volatility over 24h, not annualized. Volume: current / preceding 20-bar mean. {trusted && live.historyPersistence === "available" ? "Saved on the inference server." : "Server persistence not confirmed."}</p>
          </section>
          <details className={styles.footer}><summary>Research notes</summary><p>Retrospective selection, not fresh validation. Exact ties prefer raw. Drawdown uses 15m candle closes; funding, borrowing and liquidation are not modeled.</p><p>Live inference uses fold 3 on CPU. Frozen {time(catalog.frozenAt)} · {catalog.bundleId}</p><p>Williams %R excluded. All 23 assets retained; ENA removal applies only to the separate MFI 1h pooled sensitivity.</p></details>
        </>}
      </main>
    </div>
  );
}
