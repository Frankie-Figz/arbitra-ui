// One shared, bounded market sweep per venue and closed-candle quarter-hour.
// Credentials and provider access stay behind the existing live-response bridge.
import { FROZEN_BUNDLE_ID, FROZEN_LIVE_PATH } from "./frozen-oscillator-proxy.mjs";

export const FROZEN_MARKET_PATH = "/api/frozen-oscillators/market";
export const DEFAULT_MARKET_VENUE = "binance";
export const FROZEN_MARKET_ASSETS = Object.freeze("AAVE ADA AVAX BCH BNB BTC DOGE DOT ENA ETH HBAR LINK LTC NEAR ONDO PAXG PEPE SHIB SOL SUI XLM XRP ZEC".split(" "));
export const MARKET_SCAN_INTERVAL_MS = 15 * 60_000;
export const MARKET_SCAN_GRACE_MS = 10_000;
export const MARKET_SIGNAL_LOOKBACK_MS = 36 * 60 * 60_000;
const ACTIVE_VENUE_MS = 30 * 60_000;
const VENUE_QUOTES = new Map([["kraken", "USD"], ["binance", "USDT"], ["coinbase", "USD"], ["okx", "USDT"]]);
const cycleAt = (stamp) => Math.floor((stamp - MARKET_SCAN_GRACE_MS) / MARKET_SCAN_INTERVAL_MS);
const iso = (stamp) => new Date(stamp).toISOString();

/** UTC quarter-hour boundary plus a short allowance for candle finalization. */
export function nextMarketScanAt(stamp = Date.now()) {
  return (cycleAt(stamp) + 1) * MARKET_SCAN_INTERVAL_MS + MARKET_SCAN_GRACE_MS;
}

function response(body, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function pick(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]));
}

function projectResult(row) {
  const projected = pick(row, ["id", "asset", "indicator", "timeframe_minutes", "mode", "status", "current_signal", "latest_parent_close_utc", "diagnostic_code", "diagnostic_message", "reason"]);
  if (!projected) return null;
  return {
    ...projected,
    recent_signal: pick(row.recent_signal, ["direction", "decision_utc", "expires_utc", "window_minutes", "at_latest_native_close"]),
    latest_raw_event: pick(row.latest_raw_event, ["direction", "signal_open_utc", "decision_utc", "context_last_open_utc", "age_minutes", "at_latest_parent_close", "at_latest_native_close", "event_id"]),
    admission: pick(row.admission, ["status", "accepted", "score", "score_units", "policy_mode", "threshold"]),
  };
}

function withinSignalLookback(signalTime, stamp) {
  const signalStamp = Date.parse(signalTime);
  return Number.isFinite(signalStamp) && signalStamp >= stamp - MARKET_SIGNAL_LOOKBACK_MS && signalStamp <= stamp;
}

function projectHistory(history, stamp) {
  if (!Array.isArray(history)) return [];
  return history.slice(0, 200).filter((event) => event?.admission?.accepted === true && withinSignalLookback(event.signalTime, stamp)).map((event) => ({
    ...pick(event, ["entryId", "asset", "venue", "pair", "bundleId", "indicator", "timeframeMinutes", "mode", "direction", "signalTime", "evaluatedAt", "evaluationKind", "status"]),
    admission: pick(event.admission, ["status", "accepted"]),
    marketCondition: pick(event.marketCondition, ["as_of_utc", "close"]),
  }));
}

function projectAsset(body, asset, venue, stamp) {
  const quote = VENUE_QUOTES.get(venue);
  const pair = `${asset}/${quote}`;
  if (body?.schemaVersion !== 1 || body.bundleId !== FROZEN_BUNDLE_ID || body.asset !== asset || body.venue !== venue || body.quote !== quote || body.pair !== pair || body.ordersSubmitted !== 0 || body.deploymentAllowed !== false || !["available", "unavailable"].includes(body.status) || !Array.isArray(body.results)) {
    throw new Error("Unexpected live contract");
  }
  const price = body.marketSnapshot;
  const marketSnapshot = price && Number.isFinite(price.price) && price.price > 0 && price.priceType === "closed_candle" && price.timeframeMinutes === 15 && price.quote === quote && price.pair === pair && Number.isFinite(Date.parse(price.asOf))
    ? pick(price, ["price", "asOf", "priceType", "timeframeMinutes", "quote", "pair"]) : null;
  return {
    ...pick(body, ["schemaVersion", "bundleId", "asset", "venue", "quote", "pair", "marketType", "historicalVenue", "historicalQuote", "transferValidation", "status", "reason", "asOf", "dataThrough", "liveInferenceEnabled", "pairAvailability", "pairMetadataVerified", "historyLimit", "historyScope", "historyPersistence", "historyDataThrough"]),
    marketSnapshot,
    results: body.results.map(projectResult).filter(Boolean),
    history: projectHistory(body.history, stamp),
    historySourceCount: Array.isArray(body.history) ? body.history.length : 0,
    ordersSubmitted: 0,
    deploymentAllowed: false,
    diagnosticOnly: body.diagnosticOnly === true,
  };
}

function unavailableAsset(asset, venue, stamp) {
  const quote = VENUE_QUOTES.get(venue);
  return {
    schemaVersion: 1, bundleId: FROZEN_BUNDLE_ID, asset, venue, quote, pair: `${asset}/${quote}`,
    marketType: "spot", status: "unavailable", reason: "This asset could not be evaluated in the current market scan.",
    historicalVenue: "binance", historicalQuote: "USDT", transferValidation: venue === "binance" ? "same_venue" : "not_validated",
    asOf: iso(stamp), dataThrough: null, marketSnapshot: null, results: [], history: [], historySourceCount: 0, liveInferenceEnabled: false,
    ordersSubmitted: 0, deploymentAllowed: false, diagnosticOnly: false,
  };
}

/**
 * Shared server lifecycle. start() scans Binance without a browser; other venues
 * remain active for 30 minutes after a request. stop() permanently closes this
 * instance, cancels its timer, and prevents additional upstream asset requests.
 * Only one asset request is in flight globally; readers get progressive snapshots.
 */
export function createFrozenOscillatorMarket({ liveHandler, now = () => Date.now(), setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {}) {
  if (typeof liveHandler !== "function") throw new TypeError("A live response handler is required");
  const states = new Map();
  const pending = new Map(); // At most the four supported venues, never viewer jobs.
  let timer = null;
  let started = false;
  let stopped = false;
  let pumping = false;
  let abortController = null;

  function stateFor(venue) {
    if (!states.has(venue)) states.set(venue, {
      lastRequested: -Infinity, attemptedCycle: -Infinity,
      snapshot: { status: "idle", startedAt: null, completedAt: null, assets: [] },
    });
    return states.get(venue);
  }

  async function pump() {
    if (pumping || stopped) return;
    pumping = true;
    try {
      while (pending.size && !stopped) {
        const [venue, requestedCycle] = pending.entries().next().value;
        pending.delete(venue);
        const state = stateFor(venue);
        const cycle = Math.max(requestedCycle, cycleAt(now()));
        if (state.attemptedCycle >= cycle) continue;
        state.attemptedCycle = cycle;
        // Never carry previous-cycle results into a new progressive sweep.
        const snapshot = { status: "scanning", startedAt: iso(now()), completedAt: null, assets: [] };
        state.snapshot = snapshot;
        for (const asset of FROZEN_MARKET_ASSETS) {
          if (stopped) break;
          let projected;
          abortController = new AbortController();
          try {
            const request = new Request(`http://oscillator-market.internal${FROZEN_LIVE_PATH}?asset=${asset}&venue=${venue}`, { signal: abortController.signal });
            const upstream = await liveHandler(request);
            projected = projectAsset(await upstream.json(), asset, venue, now());
          } catch {
            // Exceptions can contain provider URLs or credentials; do not expose them.
            projected = unavailableAsset(asset, venue, now());
          } finally {
            abortController = null;
          }
          if (stopped) break;
          snapshot.assets.push(projected);
        }
        if (!stopped) {
          snapshot.status = "ready";
          snapshot.completedAt = iso(now());
        }
      }
    } finally {
      pumping = false;
    }
  }

  function enqueue(venue) {
    if (stopped) return;
    const cycle = cycleAt(now());
    if (stateFor(venue).attemptedCycle >= cycle) return;
    pending.set(venue, cycle);
    void pump();
  }

  function schedule() {
    if (stopped) return;
    timer = setTimeoutImpl(() => {
      timer = null;
      const stamp = now();
      for (const [venue, state] of states) {
        if (venue === DEFAULT_MARKET_VENUE || stamp - state.lastRequested < ACTIVE_VENUE_MS) enqueue(venue);
      }
      schedule();
    }, Math.max(1, nextMarketScanAt(now()) - now()));
    timer?.unref?.();
  }

  function start() {
    if (started || stopped) return;
    started = true;
    enqueue(DEFAULT_MARKET_VENUE);
    schedule();
  }

  function stop() {
    stopped = true;
    if (timer !== null) clearTimeoutImpl(timer);
    timer = null;
    pending.clear();
    abortController?.abort();
    for (const state of states.values()) if (state.snapshot.status === "scanning") state.snapshot.status = "idle";
  }

  function publicSnapshot(venue) {
    const snapshot = stateFor(venue).snapshot;
    const stamp = now();
    return {
      schemaVersion: 1, bundleId: FROZEN_BUNDLE_ID, venue, quote: VENUE_QUOTES.get(venue),
      status: snapshot.status, startedAt: snapshot.startedAt, completedAt: snapshot.completedAt,
      nextScanAt: stopped ? null : iso(nextMarketScanAt(stamp)),
      totalAssets: FROZEN_MARKET_ASSETS.length, completedAssets: snapshot.assets.length,
      assets: snapshot.assets.map((asset) => ({
        ...asset,
        history: asset.history.filter((event) => withinSignalLookback(event.signalTime, stamp)),
        results: asset.results.map((row) => ({
          ...row,
          recent_signal: row.recent_signal && Date.parse(row.recent_signal.decision_utc) <= stamp && stamp < Date.parse(row.recent_signal.expires_utc) ? row.recent_signal : null,
        })),
      })),
      ordersSubmitted: 0, deploymentAllowed: false,
    };
  }

  async function handle(request) {
    const url = new URL(request.url);
    if (url.pathname !== FROZEN_MARKET_PATH) return null;
    if (request.method !== "GET") return response({ status: "unavailable", reason: "Only GET is supported" }, 405);
    const venue = url.searchParams.get("venue") ?? DEFAULT_MARKET_VENUE;
    if (!VENUE_QUOTES.has(venue) || url.searchParams.getAll("venue").length > 1 || [...url.searchParams.keys()].some((key) => key !== "venue")) {
      return response({ status: "unavailable", reason: "Choose one supported data venue" }, 400);
    }
    stateFor(venue).lastRequested = now();
    start();
    enqueue(venue);
    return response(publicSnapshot(venue));
  }

  return { handle, start, stop };
}
