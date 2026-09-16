"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import BitcoinTickerWheel from "./BitcoinTickerWheel";
import { steerTicker } from "./ticker-wheel";
import { buildMarketView, millisecondsUntilNextScan, type SignalMarketCatalog, type SignalCard } from "./signal-market";
import { formatTimestamp } from "./timezones";
import styles from "./crypto-signal-ticker.module.css";

const indicatorNames: Record<string, string> = { ao: "AO", ppo: "PPO", pvo: "PVO", roc: "ROC", rsi: "RSI", stc: "STC", stochrsi: "StochRSI", stochastic: "Stochastic", tsi: "TSI", ultimate: "Ultimate", vortex: "Vortex", cci: "CCI", dpo: "DPO", mfi: "MFI", obv_divergence: "OBV divergence", volume_exhaustion: "Volume exhaustion" };
const timeframe = (minutes: number) => minutes === 1440 ? "1d" : minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
const price = (value: number | null) => value == null ? "Unavailable" : value.toLocaleString("en-US", { maximumSignificantDigits: 8 });

type Props = { catalog: SignalMarketCatalog; venue: string; venueName: string; timeZone: string; now: number; onSelect: (asset: string, entryId: string) => void };

/** A shared server scan, not a per-browser fan-out to every provider. */
export default function CryptoSignalTicker({ catalog, venue, venueName, timeZone, now, onSelect }: Props) {
  const [snapshot, setSnapshot] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [paused, setPaused] = useState(false);
  const viewport = useRef<HTMLDivElement | null>(null);
  const track = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const load = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        // This reads the shared cache/progress only; inference runs every 15 minutes on the server.
        const response = await fetch(`/api/frozen-oscillators/market?venue=${encodeURIComponent(venue)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Market feed unavailable");
        const value = await response.json();
        if (!controller.signal.aborted) { setSnapshot(value); setError(""); }
      } catch {
        if (!controller.signal.aborted) { setSnapshot(null); setError("Market feed unavailable. No cached signal is asserted as active."); }
      } finally { busy = false; }
    };
    void load();
    const timer = setInterval(() => { void load(); }, 15_000);
    document.addEventListener("visibilitychange", load);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", load); };
  }, [venue]);

  const view = buildMarketView(snapshot, catalog, venue, now);
  const feedError = error || (view.status === "unavailable" ? "Market response could not be verified for this venue." : "");
  const next = view.nextScanAt ? Date.parse(view.nextScanAt) : now + millisecondsUntilNextScan(now);
  const remaining = Math.max(0, Math.ceil((next - now) / 1000));
  const countdown = `${Math.floor(remaining / 60).toString().padStart(2, "0")}:${(remaining % 60).toString().padStart(2, "0")}`;
  const active = view.cards.filter((card) => card.isActive).length;
  const scanPending = view.status !== "ready";
  const totalSetups = catalog.assets.reduce((total, asset) => total + asset.entries.length, 0);

  const card = (signal: SignalCard, duplicate: boolean) => <button key={signal.key} type="button"
    className={`${styles.card} ${signal.direction === "BUY" ? styles.long : styles.short} ${signal.isActive ? styles.active : styles.historical}`}
    tabIndex={duplicate ? -1 : 0} onClick={() => onSelect(signal.asset, signal.entryId)}
    aria-label={`${signal.asset} ${signal.direction === "BUY" ? "LONG" : "SHORT"}, ${indicatorNames[signal.indicator] ?? signal.indicator} ${timeframe(signal.timeframeMinutes)}, ${signal.isActive ? "active" : "historical"}, ${formatTimestamp(signal.signalTime, timeZone, "h12")}`}>
    <span className={styles.cardTop}><strong>{signal.asset}<small>/{signal.quote}</small></strong><span className={styles.direction}>{signal.direction === "BUY" ? "↗ LONG" : "↘ SHORT"}</span></span>
    <span className={styles.indicator}>{indicatorNames[signal.indicator] ?? signal.indicator}<b>{timeframe(signal.timeframeMinutes)}</b></span>
    <span className={styles.price}>{price(signal.price)}<small>{signal.price == null ? "signal price not verified" : `${signal.quote} · price at signal`}</small></span>
    <span className={styles.cardTime}>Signal <time dateTime={signal.signalTime}>{formatTimestamp(signal.signalTime, timeZone, "h12")}</time></span>
    <span className={styles.cardBottom}><span>{signal.isActive ? (signal.isLatest ? "● Active · latest close" : "● Active · recent") : "○ Historical · not active"}</span><span>{signal.mode === "raw" ? "RAW" : "XGB"}</span></span>
    <span className={styles.priceTime}>Signal candle close · {signal.priceAsOf ? formatTimestamp(signal.priceAsOf, timeZone, "h12") : "price not verified"}</span>
  </button>;

  return <section className={styles.ticker} aria-label="Crypto market signal ticker">
    <div className={styles.topline}>
      <div><p className={styles.eyebrow}><span className={feedError ? styles.offlineDot : styles.dot} /> CRYPTO / SIGNAL WIRE</p><h2>Market pulse <span>Last 36 hours</span></h2></div>
      <div className={styles.controls}><span>{venueName} · {catalog.assets.length} assets · {totalSetups} frozen setups</span><button type="button" aria-pressed={paused} onClick={() => setPaused((value) => !value)}>{paused ? "Resume ticker" : "Pause ticker"}</button></div>
    </div>
    <div className={styles.breadth}>
      <span className={styles.longText}><strong>{view.longAssets}</strong> assets LONG only</span><span className={styles.shortText}><strong>{view.shortAssets}</strong> SHORT only</span><span><strong>{view.mixedAssets}</strong> with both</span><span><strong>{active}</strong> active / {view.cards.length} signals in 36h</span>
    </div>
    {paused && <BitcoinTickerWheel disabled={!view.cards.length} onRotate={(radians) => steerTicker(track.current, viewport.current, radians)} />}
    <div ref={viewport} className={`${styles.viewport} ${paused ? styles.paused : ""}`} tabIndex={0} aria-label="Signal cards, scroll horizontally or pause to inspect">
      {view.cards.length ? <div ref={track} className={styles.track} style={{ "--ticker-duration": `${Math.max(45, view.cards.length * 7)}s` } as CSSProperties}>
        <div className={styles.group}>{view.cards.map((signal) => card(signal, false))}</div>
        <div className={styles.group} aria-hidden="true">{view.cards.map((signal) => card(signal, true))}</div>
      </div> : <div className={styles.empty}><strong>{feedError ? "Signal wire offline" : scanPending ? "Scanning the frozen universe…" : "No accepted signals in the last 36 hours"}</strong><span>{feedError || "Cards appear as assets finish evaluation. Unavailable data is not a neutral market signal."}</span></div>}
    </div>
    <div className={styles.scanline} role="status"><span>{feedError ? "Unavailable" : scanPending ? `Scanning ${view.completedAssets}/${view.totalAssets} assets` : `Scan complete · ${view.completedAssets}/${view.totalAssets} assets`} · {view.availableAssets} fresh · {view.unavailableAssets} unavailable · {view.staleAssets} stale · {view.pendingAssets} pending</span><span>Next 15m scan {countdown}</span></div>
    <p className={styles.note}>Accepted signals only · newest first · timestamps in {timeZone}. Prices are the candle close at signal emission, not the current market price. Historical cards are not current entries; green/red indicates direction, not profit. Counts describe this frozen universe, not the entire crypto market. Saved history is capped at 200 events per asset. {venue !== "binance" && "Cross-venue performance is unvalidated."}</p>
  </section>;
}
