// Server-only bridge. Native models and service credentials never reach the browser.
export const FROZEN_BUNDLE_ID = "oscillator-mixed-top10-20260913-v1";
export const FROZEN_LIVE_PATH = "/api/frozen-oscillators/live";
const ASSETS = new Set("AAVE ADA AVAX BCH BNB BTC DOGE DOT ENA ETH HBAR LINK LTC NEAR ONDO PAXG PEPE SHIB SOL SUI XLM XRP ZEC".split(" "));
const VENUE_QUOTES = new Map([["binance", "USDT"], ["kraken", "USD"], ["coinbase", "USD"], ["okx", "USDT"]]);

function response(body, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export function createFrozenOscillatorHandler({ serviceUrl = "", token = "", fetchImpl = fetch } = {}) {
  let upstream = null;
  if (serviceUrl) {
    const parsed = new URL(serviceUrl);
    const privateHost = ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) || parsed.hostname.endsWith(".railway.internal");
    if (!privateHost || !["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname)) {
      throw new Error("Oscillator service must use a loopback or Railway-private origin");
    }
    if (parsed.hostname.endsWith(".railway.internal") && !token) throw new Error("Private oscillator service requires a token");
    upstream = parsed.origin;
  }
  return async function frozenOscillatorResponse(request) {
    const url = new URL(request.url);
    if (url.pathname !== FROZEN_LIVE_PATH) return null;
    if (request.method !== "GET") return response({ status: "unavailable", reason: "Only GET is supported" }, 405);
    const asset = url.searchParams.get("asset");
    const venue = url.searchParams.get("venue") ?? "binance";
    if (!ASSETS.has(asset) || !VENUE_QUOTES.has(venue) || [...url.searchParams.keys()].some((key) => !["asset", "venue"].includes(key)) || url.searchParams.getAll("asset").length !== 1 || url.searchParams.getAll("venue").length > 1) {
      return response({ status: "unavailable", reason: "Choose one frozen asset and one supported venue" }, 400);
    }
    const quote = VENUE_QUOTES.get(venue);
    const pair = `${asset}/${quote}`;
    const unavailable = (reason) => response({ schemaVersion: 1, bundleId: FROZEN_BUNDLE_ID, asset, venue, quote, pair, marketType: "spot", historicalVenue: "binance", historicalQuote: "USDT", transferValidation: venue === "binance" ? "same_venue" : "not_validated", status: "unavailable", reason, results: [], ordersSubmitted: 0, deploymentAllowed: false, liveInferenceEnabled: false }, 503);
    if (!upstream) return unavailable("Live inference service is not configured. Frozen results remain available.");
    try {
      const result = await fetchImpl(`${upstream}/v1/oscillators/live?asset=${encodeURIComponent(asset)}&venue=${venue}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(120_000), redirect: "error", cache: "no-store",
      });
      const text = await result.text();
      if (text.length > 1_000_000) return unavailable("Inference response exceeded its size limit");
      const body = JSON.parse(text);
      if (body.schemaVersion !== 1 || body.bundleId !== FROZEN_BUNDLE_ID || body.asset !== asset || body.venue !== venue || body.quote !== quote || body.pair !== pair || body.marketType !== "spot" || body.historicalVenue !== "binance" || body.historicalQuote !== "USDT" || body.transferValidation !== (venue === "binance" ? "same_venue" : "not_validated") || body.deploymentAllowed !== false || body.ordersSubmitted !== 0 || !["available", "unavailable"].includes(body.status) || !Array.isArray(body.results)) {
        return unavailable("Inference response did not match the frozen research contract");
      }
      if (!result.ok && body.status !== "unavailable") return unavailable("Inference service could not complete this request");
      if (body.history != null && (!Array.isArray(body.history) || body.history.length > 200 || body.history.some((row) => !row || row.bundleId !== FROZEN_BUNDLE_ID || row.asset !== asset || row.venue !== venue || row.pair !== pair || !["BUY", "SELL"].includes(row.direction) || !["observed", "reconstructed"].includes(row.evaluationKind) || !Number.isFinite(Date.parse(row.signalTime)) || !Number.isFinite(Date.parse(row.evaluatedAt)) || Date.parse(row.signalTime) > Date.parse(row.evaluatedAt) || Date.parse(row.marketCondition?.as_of_utc) !== Date.parse(row.signalTime)))) {
        return unavailable("Historical signal response did not match the selected asset, venue and evaluation time");
      }
      return response(body, body.status === "available" ? 200 : 503);
    } catch {
      return unavailable("Live inference is unavailable or timed out. No signal is inferred from historical results.");
    }
  };
}
