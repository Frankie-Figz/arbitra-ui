/** Browser-side projection of the frozen scanner, never an order or a position. */
export const SIGNAL_REFRESH_MS = 15 * 60_000;
const FRESHNESS_MS = 17 * 60_000;
const HISTORY_MS = 36 * 60 * 60_000;
const VENUE_QUOTES: Record<string, string> = { kraken: "USD", coinbase: "USD", binance: "USDT", okx: "USDT" };

export type SignalMarketEntry = { id: string; indicator: string; timeframeMinutes: number; mode: string };
export type SignalMarketCatalog = { bundleId: string; assets: { symbol: string; entries: SignalMarketEntry[] }[] };
export type SignalCard = {
  key: string; entryId: string; asset: string; venue: string; quote: string; pair: string;
  indicator: string; timeframeMinutes: number; mode: string; direction: "BUY" | "SELL";
  signalTime: string; expiresAt: string; isLatest: boolean; isActive: boolean;
  price: number | null; priceAsOf: string | null;
};
export type MarketView = {
  cards: SignalCard[]; totalAssets: number; completedAssets: number; availableAssets: number;
  unavailableAssets: number; pendingAssets: number; evaluatedSetups: number; unavailableSetups: number;
  staleAssets: number; longAssets: number; shortAssets: number; mixedAssets: number;
  status: string; nextScanAt: string | null;
};
type ObjectValue = Record<string, unknown>;

function object(value: unknown): value is ObjectValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Require explicit timezone and real calendar dates, not Date.parse's local-time or rollover guesses. */
function timestamp(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  const [year, month, day, hour, minute, second] = value.slice(0, 19).split(/[-T:]/).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || minute > 59 || second > 59) return NaN;
  if (!value.endsWith("Z")) {
    const [offsetHour, offsetMinute] = value.slice(-5).split(":").map(Number);
    if (offsetHour > 23 || offsetMinute > 59) return NaN;
  }
  return Date.parse(value);
}

/** Refresh shortly after each UTC quarter-hour, including when a tab resumes midway through a candle. */
export function millisecondsUntilNextScan(now: number): number {
  if (!Number.isFinite(now)) return SIGNAL_REFRESH_MS;
  return (Math.floor((now - 10_000) / SIGNAL_REFRESH_MS) + 1) * SIGNAL_REFRESH_MS + 10_000 - now;
}

/** A 15-minute refresh may retain evidence for at most 17 minutes; future candles are never current. */
export function isSnapshotFresh(asOf: string, dataThrough: string, now = Date.now()): boolean {
  const evaluated = timestamp(asOf), through = timestamp(dataThrough);
  return Number.isFinite(now) && Number.isFinite(evaluated) && Number.isFinite(through)
    && evaluated <= now + 60_000 && through <= now && through <= evaluated
    && now - evaluated <= FRESHNESS_MS && now - through <= FRESHNESS_MS;
}

function direction(value: unknown): value is "BUY" | "SELL" { return value === "BUY" || value === "SELL"; }
function accepted(status: unknown, admission: unknown, entry: SignalMarketEntry): boolean {
  const expected = entry.mode === "raw" ? "raw_accepted" : "xgb_accepted";
  return status === expected && object(admission) && admission.accepted === true && admission.status === status;
}
function rowMatches(row: ObjectValue, entry: SignalMarketEntry, asset: string): boolean {
  return row.id === entry.id && row.asset === asset && row.indicator === entry.indicator
    && row.timeframe_minutes === entry.timeframeMinutes && row.mode === entry.mode;
}
function liveMatches(live: ObjectValue, catalog: SignalMarketCatalog, asset: string, venue: string, quote: string): boolean {
  return live.schemaVersion === 1 && live.bundleId === catalog.bundleId && live.asset === asset
    && live.venue === venue && live.quote === quote && live.pair === `${asset}/${quote}`
    && live.marketType === "spot" && live.historicalVenue === "binance" && live.historicalQuote === "USDT"
    && live.transferValidation === (venue === "binance" ? "same_venue" : "not_validated")
    && live.ordersSubmitted === 0 && live.deploymentAllowed === false && live.diagnosticOnly !== true
    && ["available", "unavailable"].includes(String(live.status)) && Array.isArray(live.results);
}

type ActiveSignal = { direction: "BUY" | "SELL"; decision: number; expiry: number; latest: boolean };

/** Trust the server's complete raw-event replay, never reconstruct an active badge from capped history. */
function activeSignal(row: ObjectValue, entry: SignalMarketEntry, live: ObjectValue, now: number): ActiveSignal | null {
  if (row.status === "unavailable" || !["BUY", "SELL", "NONE"].includes(String(row.current_signal))) return null;
  const through = timestamp(live.dataThrough), evaluated = timestamp(live.asOf);
  const window = Math.max(60, entry.timeframeMinutes), raw = row.latest_raw_event;
  const recent = row.recent_signal;
  if (recent != null) {
    if (!object(recent) || !direction(recent.direction) || recent.window_minutes !== window || typeof recent.at_latest_native_close !== "boolean") return null;
    const decision = timestamp(recent.decision_utc), expiry = timestamp(recent.expires_utc);
    if (!Number.isFinite(decision) || !Number.isFinite(expiry) || decision > now || decision > through || decision > evaluated
      || now >= expiry || expiry - decision !== window * 60_000 || recent.at_latest_native_close !== (decision === through)) return null;
    if (recent.at_latest_native_close ? row.current_signal !== recent.direction : row.current_signal !== "NONE") return null;
    // A later opposite raw pulse cancels even when the opposite entry is XGB-rejected.
    if (!object(raw) || !direction(raw.direction)) return null;
    const rawDecision = timestamp(raw.decision_utc);
    if (!Number.isFinite(rawDecision) || rawDecision < decision || rawDecision > through || rawDecision > evaluated
      || raw.at_latest_native_close !== (rawDecision === through) || raw.direction !== recent.direction) return null;
    if (rawDecision === decision && !accepted(row.status, row.admission, entry)) return null;
    if (rawDecision > decision) {
      // A later accepted event would replace this one. Only a known rejection may leave it intact.
      if (!["xgb_rejected", "ineligible_warmup_or_sigma"].includes(String(row.status)) || !object(row.admission)
        || row.admission.status !== row.status || row.admission.accepted !== false) return null;
    }
    return { direction: recent.direction, decision, expiry, latest: recent.at_latest_native_close };
  }
  // Compatibility with an older backend: only an accepted event on this exact latest close qualifies.
  if (!direction(row.current_signal) || !accepted(row.status, row.admission, entry) || !object(raw)
    || raw.direction !== row.current_signal || raw.at_latest_native_close !== true) return null;
  const decision = timestamp(raw.decision_utc);
  if (!Number.isFinite(decision) || decision !== through || decision > now || decision > evaluated || now >= decision + window * 60_000) return null;
  return { direction: row.current_signal, decision, expiry: decision + window * 60_000, latest: true };
}

function validEntry(entry: SignalMarketEntry): boolean {
  return typeof entry.id === "string" && !!entry.id && typeof entry.indicator === "string" && !!entry.indicator
    && typeof entry.mode === "string" && !!entry.mode && Number.isInteger(entry.timeframeMinutes) && entry.timeframeMinutes > 0;
}

/** Project the last 36 hours of accepted entries, with separately verified active/latest-close markers. */
export function buildMarketView(snapshot: unknown, catalog: SignalMarketCatalog, venue: string, now: number): MarketView {
  const assetCounts = new Map<string, number>();
  for (const item of catalog.assets) assetCounts.set(item.symbol, (assetCounts.get(item.symbol) ?? 0) + 1);
  const assets = catalog.assets.filter((item) => assetCounts.get(item.symbol) === 1);
  const view: MarketView = { cards: [], totalAssets: assetCounts.size, completedAssets: 0, availableAssets: 0,
    unavailableAssets: 0, pendingAssets: assetCounts.size, evaluatedSetups: 0, unavailableSetups: 0,
    staleAssets: 0, longAssets: 0, shortAssets: 0, mixedAssets: 0, status: "idle", nextScanAt: null };
  const quote = VENUE_QUOTES[venue];
  if (snapshot == null) return view;
  if (!Number.isFinite(now) || !quote || !object(snapshot) || snapshot.schemaVersion !== 1 || snapshot.bundleId !== catalog.bundleId
    || snapshot.venue !== venue || snapshot.quote !== quote || !["scanning", "ready", "idle"].includes(String(snapshot.status))
    || snapshot.ordersSubmitted !== 0 || snapshot.deploymentAllowed !== false || snapshot.diagnosticOnly === true
    || !Array.isArray(snapshot.assets)) { view.status = "unavailable"; return view; }
  view.status = String(snapshot.status);
  const nextScan = timestamp(snapshot.nextScanAt);
  if (Number.isFinite(nextScan)) view.nextScanAt = new Date(nextScan).toISOString();
  const responses = new Map<string, ObjectValue[]>();
  for (const item of snapshot.assets) {
    if (!object(item) || typeof item.asset !== "string" || !assetCounts.has(item.asset)) continue;
    responses.set(item.asset, [...(responses.get(item.asset) ?? []), item]);
  }
  const cards = new Map<string, SignalCard>();
  for (const item of assets) {
    const returned = responses.get(item.symbol);
    if (!returned) continue;
    view.completedAssets++;
    const entryCounts = new Map<string, number>();
    for (const entry of item.entries) entryCounts.set(entry.id, (entryCounts.get(entry.id) ?? 0) + 1);
    const entries = item.entries.filter((entry) => entryCounts.get(entry.id) === 1 && validEntry(entry));
    const live = returned[0];
    if (returned.length !== 1 || !liveMatches(live, catalog, item.symbol, venue, quote)) {
      view.unavailableAssets++; view.unavailableSetups += entryCounts.size; continue;
    }
    const fresh = live.status === "available" && isSnapshotFresh(String(live.asOf), String(live.dataThrough), now);
    const stale = live.status === "available" && !fresh;
    if (stale) view.staleAssets++;
    const rows = new Map<string, ObjectValue[]>();
    for (const row of live.results as unknown[]) {
      if (object(row) && typeof row.id === "string" && entryCounts.has(row.id)) rows.set(row.id, [...(rows.get(row.id) ?? []), row]);
    }
    let evaluated = 0;
    const active = new Map<string, ActiveSignal>();
    for (const entry of entries) {
      const matches = rows.get(entry.id), row = matches?.[0];
      if (!fresh || matches?.length !== 1 || !row || !rowMatches(row, entry, item.symbol)
        || !["raw_accepted", "xgb_accepted", "xgb_rejected", "ineligible_warmup_or_sigma", "no_raw_signal"].includes(String(row.status))) continue;
      evaluated++;
      const signal = activeSignal(row, entry, live, now);
      if (signal) active.set(entry.id, signal);
    }
    view.evaluatedSetups += evaluated;
    view.unavailableSetups += entryCounts.size - evaluated;
    if (fresh && evaluated > 0) view.availableAssets++;
    else if (!stale) view.unavailableAssets++;
    const priceSnapshot = live.marketSnapshot;
    const priceValid = fresh && object(priceSnapshot) && typeof priceSnapshot.price === "number" && Number.isFinite(priceSnapshot.price)
      && priceSnapshot.price > 0 && priceSnapshot.priceType === "closed_candle" && priceSnapshot.timeframeMinutes === 15
      && priceSnapshot.quote === quote && priceSnapshot.pair === live.pair && timestamp(priceSnapshot.asOf) === timestamp(live.dataThrough);
    const addCard = (entry: SignalMarketEntry, side: "BUY" | "SELL", decision: number, eventPrice?: unknown) => {
      const signal = active.get(entry.id);
      const isActive = signal?.direction === side && signal.decision === decision;
      const key = `${venue}/${item.symbol}/${entry.id}/${side}/${decision}`;
      // The journal's market condition is stamped at this exact signal close.
      // A current snapshot is a valid fallback only for that same candle, never for an older signal.
      const journalPrice = typeof eventPrice === "number" && Number.isFinite(eventPrice) && eventPrice > 0 ? eventPrice : null;
      const price = journalPrice ?? cards.get(key)?.price
        ?? (priceValid && timestamp(priceSnapshot.asOf) === decision ? priceSnapshot.price as number : null);
      const priceAsOf = price == null ? null : new Date(decision).toISOString();
      cards.set(key, { key, entryId: entry.id, asset: item.symbol, venue, quote, pair: `${item.symbol}/${quote}`,
        indicator: entry.indicator, timeframeMinutes: entry.timeframeMinutes, mode: entry.mode, direction: side,
        signalTime: new Date(decision).toISOString(), expiresAt: new Date(decision + Math.max(60, entry.timeframeMinutes) * 60_000).toISOString(),
        isLatest: isActive && signal?.latest === true, isActive, price, priceAsOf });
    };
    if (Array.isArray(live.history)) for (const history of live.history) {
      if (!object(history)) continue;
      const entry = entries.find((candidate) => candidate.id === history.entryId);
      if (!entry || history.bundleId !== catalog.bundleId || history.asset !== item.symbol || history.venue !== venue || history.pair !== live.pair
        || history.indicator !== entry.indicator || history.timeframeMinutes !== entry.timeframeMinutes || history.mode !== entry.mode
        || !direction(history.direction) || !["observed", "reconstructed"].includes(String(history.evaluationKind))
        || !accepted(history.status, history.admission, entry) || !object(history.marketCondition)) continue;
      const decision = timestamp(history.signalTime), evaluatedAt = timestamp(history.evaluatedAt);
      if (!Number.isFinite(decision) || !Number.isFinite(evaluatedAt) || decision < now - HISTORY_MS || decision > now
        || decision > evaluatedAt || evaluatedAt > now + 60_000 || timestamp(history.marketCondition.as_of_utc) !== decision) continue;
      addCard(entry, history.direction, decision, history.marketCondition.close);
    }
    // Live projection remains useful even if history persistence is unavailable or capped.
    for (const entry of entries) {
      const signal = active.get(entry.id);
      if (signal && signal.decision >= now - HISTORY_MS) addCard(entry, signal.direction, signal.decision);
    }
  }
  view.pendingAssets = view.totalAssets - view.completedAssets;
  view.cards = [...cards.values()].sort((a, b) => Date.parse(b.signalTime) - Date.parse(a.signalTime) || a.key.localeCompare(b.key));
  const sides = new Map<string, Set<string>>();
  for (const card of view.cards) { const directions = sides.get(card.asset) ?? new Set<string>(); directions.add(card.direction); sides.set(card.asset, directions); }
  for (const directions of sides.values()) {
    if (directions.size === 2) view.mixedAssets++;
    else if (directions.has("BUY")) view.longAssets++;
    else view.shortAssets++;
  }
  return view;
}
