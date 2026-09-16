import test from "node:test";
import assert from "node:assert/strict";
import { FROZEN_BUNDLE_ID } from "../scripts/frozen-oscillator-proxy.mjs";
import { createFrozenOscillatorMarket, FROZEN_MARKET_ASSETS, FROZEN_MARKET_PATH, nextMarketScanAt } from "../scripts/frozen-oscillator-market.mjs";

const INITIAL_TIME = Date.parse("2026-09-16T00:01:00Z");
const request = (query = "", method = "GET") => new Request(`http://ui${FROZEN_MARKET_PATH}${query}`, { method });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const settle = async (predicate) => { for (let step = 0; step < 200; step++) { if (await predicate()) return; await new Promise(setImmediate); } assert.fail("Market scan did not settle"); };

function clock(initial = INITIAL_TIME) {
  let stamp = initial;
  const timers = new Set();
  return {
    now: () => stamp,
    setTimeoutImpl: (callback, delay) => { const item = { callback, at: stamp + delay, unref() { this.unreferenced = true; } }; timers.add(item); return item; },
    clearTimeoutImpl: (item) => timers.delete(item),
    advance: (value) => { stamp = value; for (const item of [...timers]) if (item.at <= stamp) { timers.delete(item); item.callback(); } },
    timers,
  };
}

function liveBody(request, overrides = {}) {
  const url = new URL(request.url);
  const asset = url.searchParams.get("asset");
  const venue = url.searchParams.get("venue");
  const quote = ["kraken", "coinbase"].includes(venue) ? "USD" : "USDT";
  return {
    schemaVersion: 1, bundleId: FROZEN_BUNDLE_ID, asset, venue, quote, pair: `${asset}/${quote}`,
    marketType: "spot", status: "available", asOf: new Date(INITIAL_TIME).toISOString(), dataThrough: "2026-09-16T00:00:00Z",
    marketSnapshot: { price: 2345.67, asOf: "2026-09-16T00:00:00Z", priceType: "closed_candle", timeframeMinutes: 15, quote, pair: `${asset}/${quote}` },
    liveInferenceEnabled: true, diagnosticOnly: false, ordersSubmitted: 0, deploymentAllowed: false,
    results: [{ id: `${asset}-rsi`, asset, indicator: "rsi", timeframe_minutes: 15, mode: "raw", status: "raw_accepted", current_signal: "BUY",
      recent_signal: { direction: "BUY", decision_utc: "2026-09-16T00:00:00Z", expires_utc: "2026-09-16T01:00:00Z", window_minutes: 60, at_latest_native_close: true },
      admission: { accepted: true, status: "raw_accepted", model_sha256: "private-model", feature_names: ["private-feature"] }, source: { path: "private-path" } }],
    history: [{ privateHistory: true }],
    ...overrides,
  };
}

async function snapshot(market, query = "") { return (await market.handle(request(query))).json(); }

test("UTC quarter-hour scans include the ten-second candle close grace", () => {
  for (const [at, expected] of [["00:00:00", "00:00:10"], ["00:00:09", "00:00:10"], ["00:00:10", "00:15:10"], ["00:14:59", "00:15:10"], ["00:15:09", "00:15:10"], ["00:15:10", "00:30:10"]]) {
    assert.equal(nextMarketScanAt(Date.parse(`2026-09-16T${at}Z`)), Date.parse(`2026-09-16T${expected}Z`));
  }
});

test("successive Binance quarter-hours across midnight refresh candles once per cycle and continue unattended", async (t) => {
  const fake = clock(Date.parse("2026-09-16T23:44:00Z"));
  const calls = [];
  const market = createFrozenOscillatorMarket({ ...fake, liveHandler: async (req) => {
    const stamp = fake.now();
    calls.push({ venue: new URL(req.url).searchParams.get("venue"), stamp });
    const decision = new Date(Math.floor(stamp / 900_000) * 900_000).toISOString();
    const body = liveBody(req, { asOf: new Date(stamp).toISOString(), dataThrough: decision });
    body.results[0].recent_signal.decision_utc = decision;
    body.results[0].recent_signal.expires_utc = new Date(Date.parse(decision) + 3600_000).toISOString();
    return Response.json(body);
  } });
  t.after(() => market.stop());
  market.start();
  await settle(() => calls.length === 23);
  let expected = 23;
  for (const stamp of ["2026-09-16T23:45:10Z", "2026-09-17T00:00:10Z", "2026-09-17T00:15:10Z", "2026-09-17T00:30:10Z"]) {
    const at = Date.parse(stamp);
    fake.advance(at - 1); assert.equal(calls.length, expected);
    fake.advance(at); expected += 23;
    await settle(() => calls.length === expected);
    await settle(async () => (await snapshot(market)).status === "ready");
    const result = await snapshot(market);
    assert.equal(result.startedAt, new Date(at).toISOString());
    assert.ok(result.assets.every((asset) => Date.parse(asset.dataThrough) === at - 10_000));
    for (let n = 0; n < 4; n++) { fake.advance(at + 1); await snapshot(market); }
    assert.equal(calls.length, expected);
    assert.equal(fake.timers.size, 1);
  }
  // No viewer for over two hours: the default venue still scans, without replaying every missed interval.
  fake.advance(Date.parse("2026-09-17T03:00:10Z"));
  await settle(() => calls.length === expected + 23);
  assert.ok(calls.every((call) => call.venue === "binance"));
  assert.equal(fake.timers.size, 1);
});

test("concurrent viewers share one progressive all-23 sweep, including unavailable assets", async (t) => {
  const fake = clock();
  const gate = deferred();
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const market = createFrozenOscillatorMarket({ ...fake, liveHandler: async (req) => {
    calls.push(new URL(req.url).searchParams.get("asset"));
    maxInFlight = Math.max(maxInFlight, ++inFlight);
    if (calls.length === 1) await gate.promise;
    inFlight--;
    const body = liveBody(req, calls.at(-1) === "ENA" ? { status: "unavailable", reason: "Needs history", results: [], marketSnapshot: null } : {});
    return Response.json(body, { status: body.status === "available" ? 200 : 503 });
  } });
  t.after(() => market.stop());
  const replies = await Promise.all(Array.from({ length: 12 }, () => snapshot(market)));
  assert.equal(calls.length, 1);
  assert.ok(replies.every((body) => body.status === "scanning" && body.completedAssets === 0));
  assert.equal(fake.timers.size, 1);
  assert.equal([...fake.timers][0].unreferenced, true);
  gate.resolve();
  await settle(async () => (await snapshot(market)).status === "ready");
  const body = await snapshot(market);
  assert.deepEqual(calls, FROZEN_MARKET_ASSETS);
  assert.equal(maxInFlight, 1);
  assert.equal(body.completedAssets, 23);
  assert.equal(body.totalAssets, 23);
  assert.equal(body.venue, "binance");
  assert.equal(body.quote, "USDT");
  assert.equal(body.assets.find((asset) => asset.asset === "ENA").status, "unavailable");
  assert.equal(body.assets[0].marketSnapshot.price, 2345.67);
  assert.equal(body.assets[0].results[0].recent_signal.direction, "BUY");
  assert.equal(JSON.stringify(body).includes("private-"), false);
  assert.deepEqual(body.assets[0].history, []);
  assert.equal(body.ordersSubmitted, 0);
  assert.equal(body.deploymentAllowed, false);
  assert.equal(body.nextScanAt, "2026-09-16T00:15:10.000Z");
  for (let index = 0; index < 5; index++) await snapshot(market);
  assert.equal(calls.length, 23);
});

test("start scans Binance without a viewer; next quarter resets old results immediately", async (t) => {
  const fake = clock();
  const gate = deferred();
  let calls = 0;
  const market = createFrozenOscillatorMarket({ ...fake, liveHandler: async (req) => {
    if (++calls === 24) await gate.promise;
    return Response.json(liveBody(req));
  } });
  t.after(() => market.stop());
  market.start();
  market.start();
  await settle(() => calls === 23);
  await settle(async () => (await snapshot(market)).status === "ready");
  fake.advance(Date.parse("2026-09-16T00:15:09Z"));
  assert.equal(calls, 23);
  fake.advance(Date.parse("2026-09-16T00:15:10Z"));
  const scanning = await snapshot(market);
  assert.equal(scanning.status, "scanning");
  assert.equal(scanning.startedAt, "2026-09-16T00:15:10.000Z");
  assert.equal(scanning.completedAssets, 0);
  assert.deepEqual(scanning.assets, []);
  assert.equal(calls, 24);
  gate.resolve();
  await settle(async () => (await snapshot(market)).status === "ready");
  assert.equal(calls, 46);
});

test("four venue queue is isolated, coalesced, sequential and expires inactive nondefault venues", async (t) => {
  const fake = clock();
  const gate = deferred();
  const calls = [];
  let active = 0;
  let maximum = 0;
  const market = createFrozenOscillatorMarket({ ...fake, liveHandler: async (req) => {
    maximum = Math.max(maximum, ++active);
    const venue = new URL(req.url).searchParams.get("venue");
    calls.push(venue);
    if (calls.length === 1) await gate.promise;
    active--;
    return Response.json(liveBody(req));
  } });
  t.after(() => market.stop());
  market.start();
  for (const venue of ["binance", "coinbase", "okx", "kraken", "okx", "binance"]) await snapshot(market, `?venue=${venue}`);
  assert.equal(calls.length, 1);
  gate.resolve();
  await settle(() => calls.length === 92);
  for (const venue of ["kraken", "binance", "coinbase", "okx"]) {
    const body = await snapshot(market, `?venue=${venue}`);
    assert.equal(body.completedAssets, 23);
    assert.ok(body.assets.every((asset) => asset.venue === venue));
  }
  assert.equal(maximum, 1);
  assert.deepEqual(calls.slice(0, 23), Array(23).fill("binance"));
  fake.advance(Date.parse("2026-09-16T00:15:10Z"));
  await settle(() => calls.length === 184);
  // No polling of the other venues renews their request timestamp.
  fake.advance(Date.parse("2026-09-16T00:45:10Z"));
  await settle(() => calls.length === 207);
  assert.ok(calls.slice(184).every((venue) => venue === "binance"));
});

test("bad methods, duplicate/unknown venues and extra parameters never start work", async () => {
  const fake = clock();
  let calls = 0;
  const market = createFrozenOscillatorMarket({ ...fake, liveHandler: async () => { calls++; throw new Error("Must not run"); } });
  assert.equal(await market.handle(new Request("http://ui/health")), null);
  assert.equal((await market.handle(request("", "POST"))).status, 405);
  for (const query of ["?venue=Kraken", "?venue=", "?venue=other", "?venue=kraken&venue=okx", "?asset=ETH", "?refresh=true", "?url=https://example.com"]) {
    assert.equal((await market.handle(request(query))).status, 400);
  }
  assert.equal(calls, 0);
  assert.equal(fake.timers.size, 0);
  market.stop();
});

test("upstream failures and malformed identity fail closed without leaking errors or repeating polls", async (t) => {
  const fake = clock();
  let calls = 0;
  const market = createFrozenOscillatorMarket({ ...fake, liveHandler: async (req) => {
    calls++;
    if (calls % 2) throw new Error("secret-token and private-model-path");
    return Response.json(liveBody(req, { asset: "WRONG" }));
  } });
  t.after(() => market.stop());
  market.start();
  await settle(async () => (await snapshot(market)).status === "ready");
  const body = await snapshot(market);
  assert.equal(calls, 23);
  assert.equal(body.completedAssets, 23);
  assert.ok(body.assets.every((asset) => asset.status === "unavailable" && asset.marketSnapshot === null && asset.results.length === 0));
  assert.ok(body.assets.every((asset) => asset.historicalVenue === "binance" && asset.historicalQuote === "USDT" && asset.transferValidation === "same_venue" && asset.diagnosticOnly === false));
  assert.equal(JSON.stringify(body).includes("secret"), false);
  assert.equal((await market.handle(request())).headers.get("cache-control"), "no-store");
  assert.equal(calls, 23);
});

test("expired cards are removed from cached snapshots and unverified prices are never invented", async (t) => {
  const fake = clock();
  const market = createFrozenOscillatorMarket({ ...fake, liveHandler: async (req) => Response.json(liveBody(req, { marketSnapshot: { price: 42, quote: "WRONG" } })) });
  t.after(() => market.stop());
  market.start();
  await settle(async () => (await snapshot(market)).status === "ready");
  market.stop(); // Keep this completed snapshot, without starting a new scan.
  fake.advance(Date.parse("2026-09-16T01:00:00Z"));
  const body = await snapshot(market);
  assert.ok(body.assets.every((asset) => asset.marketSnapshot === null && asset.results[0].recent_signal === null));
  assert.equal(body.nextScanAt, null);
});

test("stop cancels the timer and prevents further assets or restart while a request is in flight", async () => {
  const fake = clock();
  const gate = deferred();
  let calls = 0;
  let signal;
  const market = createFrozenOscillatorMarket({ ...fake, liveHandler: async (req) => { calls++; signal = req.signal; await gate.promise; return Response.json(liveBody(req)); } });
  market.start();
  assert.equal(calls, 1);
  market.stop();
  assert.equal(signal.aborted, true);
  assert.equal(fake.timers.size, 0);
  gate.resolve();
  await new Promise(setImmediate);
  fake.advance(Date.parse("2026-09-16T02:00:00Z"));
  market.start();
  const body = await snapshot(market);
  assert.equal(calls, 1);
  assert.equal(body.status, "idle");
  assert.equal(body.completedAssets, 0);
  assert.equal(body.nextScanAt, null);
});

test("historical feed includes only accepted signals within the inclusive36h window and projects safe fields", async (t) => {
  const fake = clock();
  const at = (hours) => new Date(INITIAL_TIME - hours * 60 * 60_000).toISOString();
  const market = createFrozenOscillatorMarket({ ...fake, liveHandler: async (req) => {
    const base = liveBody(req);
    const history = [0, 12, 36, 36.001, -1, 1].map((hours, index) => ({
      entryId: `${base.asset}-rsi`, asset: base.asset, venue: base.venue, pair: base.pair, bundleId: base.bundleId,
      indicator: "rsi", timeframeMinutes: 15, mode: "raw", direction: "BUY", signalTime: at(hours), evaluatedAt: at(0),
      evaluationKind: "reconstructed", status: index === 5 ? "xgb_rejected" : "raw_accepted",
      admission: { status: "raw_accepted", accepted: index !== 5, score: 9, private: "secret-model" },
      marketCondition: { as_of_utc: at(hours), close: 2345.67, private: "secret-path" },
    }));
    return Response.json({ ...base, history, historyLimit: 200, historyPersistence: "available", historyScope: "same_venue" });
  } });
  t.after(() => market.stop());
  market.start();
  await settle(async () => (await snapshot(market)).status === "ready");
  const body = await snapshot(market);
  const asset = body.assets[0];
  assert.deepEqual(asset.history.map((event) => event.signalTime), [at(0), at(12), at(36)]);
  assert.equal(asset.historySourceCount, 6);
  assert.equal(asset.historyLimit, 200);
  assert.equal(asset.historyPersistence, "available");
  assert.deepEqual(asset.history[0].admission, { status: "raw_accepted", accepted: true });
  assert.deepEqual(asset.history[0].marketCondition, { as_of_utc: at(0), close: 2345.67 });
  assert.equal(JSON.stringify(body).includes("secret-"), false);
  market.stop();
  fake.advance(INITIAL_TIME + 1);
  assert.equal((await snapshot(market)).assets[0].history.length, 2);
});

test("slow scans remain globally sequential and coalesce missed quarters into one latest-cycle sweep", async (t) => {
  const fake = clock();
  const firstGate = deferred();
  const nextGate = deferred();
  let calls = 0;
  let active = 0;
  let maximum = 0;
  const market = createFrozenOscillatorMarket({ ...fake, liveHandler: async (req) => {
    maximum = Math.max(maximum, ++active);
    calls++;
    if (calls === 1) await firstGate.promise;
    if (calls === 24) await nextGate.promise;
    active--;
    return Response.json(liveBody(req));
  } });
  t.after(() => market.stop());
  market.start();
  for (const minute of [15, 30, 45]) {
    fake.advance(Date.parse(`2026-09-16T00:${minute}:10Z`));
    for (let index = 0; index < 5; index++) await snapshot(market);
    assert.equal(calls, 1);
  }
  firstGate.resolve();
  await settle(() => calls === 24);
  const latest = await snapshot(market);
  assert.equal(latest.status, "scanning");
  assert.equal(latest.startedAt, "2026-09-16T00:45:10.000Z");
  assert.equal(latest.completedAssets, 0);
  nextGate.resolve();
  await settle(async () => (await snapshot(market)).status === "ready");
  assert.equal(calls, 46);
  assert.equal(maximum, 1);
  assert.equal((await snapshot(market)).nextScanAt, "2026-09-16T01:00:10.000Z");
  assert.equal(calls, 46);
});
