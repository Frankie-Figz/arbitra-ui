import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/oscillators/signal-market.ts", import.meta.url), "utf8");
const module = { exports: {} };
new Function("module", "exports", ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(module, module.exports);
const { buildMarketView, isSnapshotFresh, millisecondsUntilNextScan, SIGNAL_REFRESH_MS } = module.exports;
const NOW = Date.parse("2026-09-16T15:16:00Z"), THROUGH = NOW - 60_000;
const iso = (time) => new Date(time).toISOString();
const catalog = { bundleId: "frozen-test", assets: [
  { symbol: "BTC", entries: [
    { id: "btc-cci", indicator: "cci", timeframeMinutes: 15, mode: "raw" },
    { id: "btc-stc", indicator: "stc", timeframeMinutes: 240, mode: "selected" },
  ] },
  { symbol: "ETH", entries: [{ id: "eth-rsi", indicator: "rsi", timeframeMinutes: 60, mode: "raw" }] },
  { symbol: "XRP", entries: [{ id: "xrp-mfi", indicator: "mfi", timeframeMinutes: 1440, mode: "baseline27" }] },
] };
const entryFor = (asset, index = 0) => catalog.assets.find((item) => item.symbol === asset).entries[index];
const statusFor = (entry) => entry.mode === "raw" ? "raw_accepted" : "xgb_accepted";
const admissionFor = (entry) => ({ status: statusFor(entry), accepted: true, policy_mode: "all", score: entry.mode === "raw" ? null : 0.2 });
function rowFor(asset, index = 0, decision = THROUGH, side = "BUY") {
  const entry = entryFor(asset, index);
  return { id: entry.id, asset, indicator: entry.indicator, timeframe_minutes: entry.timeframeMinutes, mode: entry.mode,
    status: statusFor(entry), current_signal: decision === THROUGH ? side : "NONE", admission: admissionFor(entry),
    latest_raw_event: { direction: side, decision_utc: iso(decision), at_latest_native_close: decision === THROUGH },
    recent_signal: { direction: side, decision_utc: iso(decision), expires_utc: iso(decision + Math.max(60, entry.timeframeMinutes) * 60_000),
      window_minutes: Math.max(60, entry.timeframeMinutes), at_latest_native_close: decision === THROUGH } };
}
function historyFor(asset, index = 0, decision = NOW - 2 * 60 * 60_000, side = "BUY") {
  const entry = entryFor(asset, index);
  return { bundleId: catalog.bundleId, entryId: entry.id, asset, venue: "kraken", pair: `${asset}/USD`,
    indicator: entry.indicator, timeframeMinutes: entry.timeframeMinutes, mode: entry.mode, direction: side,
    signalTime: iso(decision), evaluatedAt: iso(NOW), evaluationKind: "reconstructed", status: statusFor(entry),
    admission: admissionFor(entry), marketCondition: { as_of_utc: iso(decision), close: 500 } };
}
function liveFor(asset = "BTC") {
  return { schemaVersion: 1, bundleId: catalog.bundleId, asset, venue: "kraken", quote: "USD", pair: `${asset}/USD`,
    marketType: "spot", historicalVenue: "binance", historicalQuote: "USDT", transferValidation: "not_validated",
    deploymentAllowed: false, ordersSubmitted: 0, diagnosticOnly: false, liveInferenceEnabled: true,
    asOf: iso(NOW), dataThrough: iso(THROUGH), status: "available",
    results: catalog.assets.find((item) => item.symbol === asset).entries.map((_, index) => rowFor(asset, index)),
    history: [], marketSnapshot: { price: 123.5, asOf: iso(THROUGH), priceType: "closed_candle", timeframeMinutes: 15, quote: "USD", pair: `${asset}/USD` } };
}
function snapshotFor(assets = [liveFor()]) {
  return { schemaVersion: 1, bundleId: catalog.bundleId, venue: "kraken", quote: "USD", status: "scanning",
    ordersSubmitted: 0, deploymentAllowed: false,
    startedAt: iso(NOW), completedAt: null, nextScanAt: iso(NOW + 14 * 60_000 + 10_000),
    totalAssets: catalog.assets.length, completedAssets: assets.length, assets };
}
const viewFor = (live, now = NOW) => buildMarketView(snapshotFor([live]), catalog, "kraken", now);

test("refresh cadence lands ten seconds after UTC quarter-hours without a zero-delay loop", () => {
  assert.equal(SIGNAL_REFRESH_MS, 900_000);
  for (const [at, expected] of [
    ["2026-09-16T12:00:00Z", 10_000], ["2026-09-16T12:00:09Z", 1_000],
    ["2026-09-16T12:00:10Z", 900_000], ["2026-09-16T12:15:05Z", 5_000],
    ["2026-09-16T12:59:59Z", 11_000], ["2026-09-16T23:59:59Z", 11_000],
  ]) assert.equal(millisecondsUntilNextScan(Date.parse(at)), expected, at);
  assert.equal(millisecondsUntilNextScan(NaN), SIGNAL_REFRESH_MS);
});

test("freshness tolerates a full fifteen-minute scan cadence, but fails closed after seventeen minutes", () => {
  assert.equal(isSnapshotFresh(iso(NOW - 16 * 60_000), iso(NOW - 17 * 60_000), NOW), true);
  assert.equal(isSnapshotFresh(iso(NOW - 17 * 60_000), iso(NOW - 17 * 60_000), NOW), true);
  assert.equal(isSnapshotFresh(iso(NOW - 17 * 60_000 - 1), iso(NOW - 17 * 60_000 - 1), NOW), false);
  assert.equal(isSnapshotFresh(iso(NOW), iso(NOW - 17 * 60_000 - 1), NOW), false);
  assert.equal(isSnapshotFresh(iso(NOW + 60_000), iso(NOW), NOW), true);
  assert.equal(isSnapshotFresh(iso(NOW + 60_001), iso(NOW), NOW), false);
  assert.equal(isSnapshotFresh(iso(NOW), iso(NOW + 1), NOW), false);
  assert.equal(isSnapshotFresh(iso(NOW - 60_000), iso(NOW), NOW), false);
  assert.equal(isSnapshotFresh(iso(NOW), iso(THROUGH), NaN), false);
});

test("freshness rejects local, malformed, rollover dates and invalid timezone offsets", () => {
  for (const bad of ["2026-09-16T15:16:00", "2026-09-16", "yesterday", "2026-02-30T15:16:00Z", "2026-09-16T25:16:00Z", "2026-09-16T15:16:00+24:00", "2026-09-16T15:16:00+00:60", ""]) {
    assert.equal(isSnapshotFresh(bad, iso(THROUGH), NOW), false, bad);
    assert.equal(isSnapshotFresh(iso(NOW), bad, NOW), false, bad);
  }
  assert.equal(isSnapshotFresh("2026-09-16T11:16:00-04:00", "2026-09-16T11:15:00-04:00", NOW), true);
});

test("fresh raw and model-assisted cards carry exact frozen identity and latest closed-candle price", () => {
  const view = viewFor(liveFor());
  assert.equal(view.cards.length, 2);
  assert.deepEqual(view.cards.map((card) => [card.indicator, card.timeframeMinutes, card.direction]), [["cci", 15, "BUY"], ["stc", 240, "BUY"]]);
  for (const card of view.cards) {
    assert.equal(card.asset, "BTC"); assert.equal(card.venue, "kraken"); assert.equal(card.pair, "BTC/USD");
    assert.equal(card.quote, "USD"); assert.equal(card.isActive, true); assert.equal(card.isLatest, true);
    assert.equal(card.price, 123.5); assert.equal(card.priceAsOf, iso(THROUGH));
    assert.equal(card.signalTime, iso(THROUGH));
  }
  assert.equal(view.cards[0].expiresAt, iso(THROUGH + 60 * 60_000));
  assert.equal(view.cards[1].expiresAt, iso(THROUGH + 240 * 60_000));
  assert.equal(view.longAssets, 1); assert.equal(view.mixedAssets, 0);
  assert.equal(view.totalAssets, 3); assert.equal(view.completedAssets, 1); assert.equal(view.availableAssets, 1);
  assert.equal(view.pendingAssets, 2); assert.equal(view.evaluatedSetups, 2); assert.equal(view.unavailableSetups, 0);
});

test("older authoritative recency stays active with original expiry, not a new latest-close event", () => {
  const live = liveFor(); live.results = [rowFor("BTC", 0, NOW - 30 * 60_000)];
  const [card] = viewFor(live).cards;
  assert.equal(card.isActive, true); assert.equal(card.isLatest, false);
  assert.equal(card.signalTime, iso(NOW - 30 * 60_000));
  assert.equal(card.expiresAt, iso(NOW + 30 * 60_000));
  assert.equal(card.price, null, "A newer market quote cannot stand in for the older signal price");
});

test("each event uses its own emission price, unchanged by later quote refreshes or live deduplication", () => {
  const live = liveFor();
  const first = historyFor("BTC", 0, NOW - 2 * 60 * 60_000);
  const second = historyFor("BTC", 0, NOW - 3 * 60 * 60_000);
  second.marketCondition.close = 450;
  const latest = historyFor("BTC", 0, THROUGH);
  latest.marketCondition.close = 525;
  live.history = [first, second, latest];
  live.results = [rowFor("BTC")];
  const before = viewFor(live).cards;
  assert.deepEqual(before.map((card) => card.price), [525, 500, 450]);
  assert.ok(before.every((card) => card.priceAsOf === card.signalTime));
  live.marketSnapshot.price = 99999;
  assert.deepEqual(viewFor(live).cards, before);
  for (const invalid of [undefined, null, 0, -1, "500", NaN, Infinity]) {
    live.results = []; live.history = [{ ...first, marketCondition: { ...first.marketCondition, close: invalid } }];
    assert.equal(viewFor(live).cards[0].price, null);
  }
});

test("historical accepted signals cover an inclusive 36-hour window and never synthesize active badges", () => {
  const live = liveFor(); live.results = [];
  live.history = [historyFor("BTC", 0, NOW - 36 * 60 * 60_000), historyFor("BTC", 0, NOW - 36 * 60 * 60_000 - 1),
    historyFor("BTC", 0, NOW - 10 * 60_000), historyFor("BTC", 0, NOW + 1)];
  const view = viewFor(live);
  assert.deepEqual(view.cards.map((card) => card.signalTime), [iso(NOW - 10 * 60_000), iso(NOW - 36 * 60 * 60_000)]);
  assert.ok(view.cards.every((card) => !card.isActive && !card.isLatest));
  assert.equal(view.availableAssets, 0); assert.equal(view.unavailableAssets, 1); assert.equal(view.unavailableSetups, 2);
});

test("expired active projections disappear but verified historical events remain labelled historical", () => {
  const live = liveFor(); const decision = NOW - 60 * 60_000;
  live.results = [rowFor("BTC", 0, decision)]; live.history = [historyFor("BTC", 0, decision)];
  const view = viewFor(live);
  assert.equal(view.cards.length, 1); assert.equal(view.cards[0].isActive, false); assert.equal(view.cards[0].isLatest, false);
});

test("history/live overlap deduplicates normalized timestamps and does not double-count breadth", () => {
  const live = liveFor(); live.results = [rowFor("BTC")];
  const record = historyFor("BTC", 0, THROUGH);
  live.history = [record, structuredClone(record), { ...record, signalTime: "2026-09-16T11:15:00-04:00", marketCondition: { as_of_utc: iso(THROUGH) } }];
  const view = viewFor(live);
  assert.equal(view.cards.length, 1); assert.equal(view.cards[0].isActive, true); assert.equal(view.longAssets, 1);
});

test("inactive history retains its signal price even if current market data is unavailable", () => {
  for (const override of [{ status: "unavailable" }, { asOf: iso(NOW - 18 * 60_000), dataThrough: iso(NOW - 18 * 60_000) }]) {
    const live = { ...liveFor(), ...override }; live.history = [historyFor("BTC")];
    const view = viewFor(live);
    assert.equal(view.cards.length, 1); assert.equal(view.cards[0].isActive, false); assert.equal(view.cards[0].price, 500);
    assert.equal(view.cards[0].priceAsOf, live.history[0].signalTime); assert.equal(view.unavailableAssets, override.status ? 1 : 0); assert.equal(view.evaluatedSetups, 0);
    assert.equal(view.staleAssets, override.status ? 0 : 1);
    assert.equal(view.availableAssets + view.unavailableAssets + view.staleAssets + view.pendingAssets, view.totalAssets);
  }
});

test("historical feed enforces research, venue, pair and bundle contracts even when unavailable", () => {
  for (const bad of [{ schemaVersion: 2 }, { bundleId: "other" }, { asset: "ETH" }, { venue: "binance" }, { quote: "USDT" },
    { pair: "ETH/USD" }, { marketType: "perpetual" }, { historicalVenue: "kraken" }, { historicalQuote: "USD" },
    { transferValidation: "same_venue" }, { deploymentAllowed: true }, { ordersSubmitted: 1 }, { diagnosticOnly: true },
    { results: null }, { status: "successful" }]) {
    const live = { ...liveFor(), ...bad, history: [historyFor("BTC")] };
    assert.equal(viewFor(live).cards.length, 0, JSON.stringify(bad));
  }
});

test("malformed or cross-asset historical identities and nonaccepted rows cannot enter the feed", () => {
  const changes = [{ bundleId: "other" }, { entryId: "unknown" }, { asset: "ETH" }, { venue: "binance" }, { pair: "ETH/USD" },
    { indicator: "rsi" }, { timeframeMinutes: 60 }, { mode: "selected" }, { direction: "LONG" }, { evaluationKind: "guessed" },
    { status: "xgb_accepted" }, { admission: { status: "raw_accepted", accepted: false } }, { admission: null },
    { admission: { status: "accepted", accepted: true } }, { evaluatedAt: iso(NOW + 60_001) },
    { evaluatedAt: iso(NOW - 3 * 60 * 60_000) }, { signalTime: "2026-09-16T13:16:00" },
    { marketCondition: { as_of_utc: iso(NOW) } }, { marketCondition: null }];
  for (const change of changes) {
    const live = liveFor(); live.results = []; live.history = [{ ...historyFor("BTC"), ...change }];
    assert.equal(viewFor(live).cards.length, 0, JSON.stringify(change));
  }
});

test("current-only compatibility requires accepted matching latest raw event and cannot revive an older event", () => {
  const base = liveFor(); base.results = [rowFor("BTC")]; delete base.results[0].recent_signal;
  assert.equal(viewFor(base).cards.length, 1);
  const nullRecent = structuredClone(base); nullRecent.results[0].recent_signal = null;
  assert.equal(viewFor(nullRecent).cards.length, 1);
  for (const alter of [
    (row) => { row.current_signal = "NONE"; },
    (row) => { row.admission.accepted = false; },
    (row) => { row.admission.status = "xgb_accepted"; },
    (row) => { row.status = "xgb_accepted"; },
    (row) => { row.latest_raw_event.direction = "SELL"; },
    (row) => { row.latest_raw_event.at_latest_native_close = false; },
    (row) => { row.latest_raw_event.decision_utc = iso(THROUGH - 15 * 60_000); },
    (row) => { row.latest_raw_event = null; },
  ]) { const live = structuredClone(base); alter(live.results[0]); assert.equal(viewFor(live).cards.length, 0); }
});

test("malformed recent projection fails closed instead of falling back to a current signal", () => {
  for (const change of [{ direction: "LONG" }, { decision_utc: "2026-09-16T15:15:00" }, { decision_utc: iso(NOW + 1) },
    { expires_utc: iso(THROUGH + 61 * 60_000) }, { window_minutes: 61 }, { window_minutes: "60" },
    { at_latest_native_close: false }, { at_latest_native_close: 1 }]) {
    const live = liveFor(); live.results = [rowFor("BTC")]; Object.assign(live.results[0].recent_signal, change);
    assert.equal(viewFor(live).cards.length, 0, JSON.stringify(change));
  }
});

test("recent latest marker and row current direction must agree in both directions", () => {
  for (const [decision, current] of [[THROUGH, "NONE"], [THROUGH, "SELL"], [NOW - 30 * 60_000, "BUY"], [NOW - 30 * 60_000, "SELL"]]) {
    const live = liveFor(); live.results = [rowFor("BTC", 0, decision)]; live.results[0].current_signal = current;
    assert.equal(viewFor(live).cards.length, 0);
  }
});

test("an opposite later raw event cancels recent, including an XGB-rejected opposite entry", () => {
  const live = liveFor(); live.results = [rowFor("BTC", 1, NOW - 30 * 60_000)];
  Object.assign(live.results[0], { latest_raw_event: { direction: "SELL", decision_utc: iso(THROUGH), at_latest_native_close: true },
    status: "xgb_rejected", admission: { status: "xgb_rejected", accepted: false } });
  assert.equal(viewFor(live).cards.length, 0);
  live.history = [historyFor("BTC", 1, NOW - 30 * 60_000)];
  const [card] = viewFor(live).cards; assert.equal(card.isActive, false); assert.equal(card.direction, "BUY");
});

test("same-direction rejection preserves original acceptance and cannot renew its lifetime", () => {
  const live = liveFor(); const decision = NOW - 30 * 60_000; live.results = [rowFor("BTC", 1, decision)];
  Object.assign(live.results[0], { latest_raw_event: { direction: "BUY", decision_utc: iso(THROUGH), at_latest_native_close: true },
    status: "xgb_rejected", admission: { status: "xgb_rejected", accepted: false } });
  const [card] = viewFor(live).cards;
  assert.equal(card.isActive, true); assert.equal(card.isLatest, false); assert.equal(card.signalTime, iso(decision));
  assert.equal(card.expiresAt, iso(decision + 240 * 60_000));
  live.results[0].admission.accepted = null;
  assert.equal(viewFor(live).cards.length, 0);
});

test("no unavailable, mismatched, unknown or duplicated result becomes an active card", () => {
  const changes = [{ id: "unknown" }, { asset: "ETH" }, { indicator: "rsi" }, { timeframe_minutes: 60 }, { mode: "selected" }, { status: "unavailable" }];
  for (const change of changes) {
    const live = liveFor(); live.results = [{ ...rowFor("BTC"), ...change }];
    assert.equal(viewFor(live).cards.length, 0, JSON.stringify(change));
  }
  const live = liveFor(); live.results = [rowFor("BTC"), rowFor("BTC")];
  assert.equal(viewFor(live).cards.length, 0); assert.equal(viewFor(live).evaluatedSetups, 0);
});

test("unknown and duplicate asset responses cannot create duplicate or cross-asset signals", () => {
  const live = liveFor();
  const duplicate = buildMarketView(snapshotFor([live, structuredClone(live)]), catalog, "kraken", NOW);
  assert.equal(duplicate.cards.length, 0); assert.equal(duplicate.completedAssets, 1); assert.equal(duplicate.unavailableAssets, 1);
  const unknown = buildMarketView(snapshotFor([{ ...live, asset: "UNKNOWN" }]), catalog, "kraken", NOW);
  assert.equal(unknown.cards.length, 0); assert.equal(unknown.completedAssets, 0); assert.equal(unknown.pendingAssets, 3);
});

test("catalog duplicate identities fail closed instead of multiplying a setup or an asset", () => {
  const duplicatedEntries = structuredClone(catalog); duplicatedEntries.assets[0].entries.push(structuredClone(duplicatedEntries.assets[0].entries[0]));
  const view = buildMarketView(snapshotFor(), duplicatedEntries, "kraken", NOW);
  assert.deepEqual(view.cards.map((card) => card.entryId), ["btc-stc"]);
  const duplicateAssets = structuredClone(catalog); duplicateAssets.assets.push(structuredClone(duplicateAssets.assets[0]));
  assert.equal(buildMarketView(snapshotFor(), duplicateAssets, "kraken", NOW).cards.length, 0);
});

test("coverage derives actual asset and result evidence, not optimistic metadata or a zero-result success", () => {
  const btc = liveFor(), eth = liveFor("ETH"), xrp = liveFor("XRP");
  eth.status = "unavailable"; xrp.results = [];
  const snapshot = snapshotFor([btc, eth, xrp]); snapshot.completedAssets = 999; snapshot.totalAssets = 999; snapshot.status = "ready";
  const view = buildMarketView(snapshot, catalog, "kraken", NOW);
  assert.equal(view.totalAssets, 3); assert.equal(view.completedAssets, 3); assert.equal(view.pendingAssets, 0);
  assert.equal(view.availableAssets, 1); assert.equal(view.unavailableAssets, 2);
  assert.equal(view.evaluatedSetups, 2); assert.equal(view.unavailableSetups, 2);
  assert.equal(view.availableAssets + view.unavailableAssets + view.staleAssets + view.pendingAssets, view.totalAssets);
});

test("coverage buckets are disjoint for fresh, unavailable, stale and pending assets", () => {
  const btc = liveFor(), eth = liveFor("ETH"), xrp = liveFor("XRP");
  eth.status = "unavailable";
  xrp.asOf = iso(NOW - 18 * 60_000); xrp.dataThrough = iso(NOW - 18 * 60_000);
  for (const responses of [[btc, eth, xrp], [btc, xrp], [eth, xrp], [btc], [], [xrp]]) {
    const view = buildMarketView(snapshotFor(responses), catalog, "kraken", NOW);
    assert.equal(view.availableAssets + view.unavailableAssets + view.staleAssets + view.pendingAssets, view.totalAssets);
    assert.equal(view.availableAssets + view.unavailableAssets + view.staleAssets, view.completedAssets);
    assert.equal(view.unavailableAssets, responses.includes(eth) ? 1 : 0);
    assert.equal(view.staleAssets, responses.includes(xrp) ? 1 : 0);
  }
});

test("breadth counts unique 36-hour assets, with mixed assets separate from one-direction-only assets", () => {
  const btc = liveFor(), eth = liveFor("ETH"), xrp = liveFor("XRP");
  for (const live of [btc, eth, xrp]) live.results = [];
  btc.history = [historyFor("BTC", 0), historyFor("BTC", 1), historyFor("BTC", 0, NOW - 3 * 60 * 60_000, "SELL")];
  eth.history = [historyFor("ETH", 0), historyFor("ETH", 0, NOW - 3 * 60 * 60_000)];
  xrp.history = [historyFor("XRP", 0, NOW - 4 * 60 * 60_000, "SELL")];
  const view = buildMarketView(snapshotFor([xrp, eth, btc]), catalog, "kraken", NOW);
  assert.equal(view.longAssets, 1); assert.equal(view.shortAssets, 1); assert.equal(view.mixedAssets, 1);
  assert.equal(view.cards.length, 6);
  assert.deepEqual(view.cards.map((card) => card.key), buildMarketView(snapshotFor([btc, eth, xrp]), catalog, "kraken", NOW).cards.map((card) => card.key));
});

test("price must be a positive finite latest closed fifteen-minute candle in the same pair and quote", () => {
  for (const change of [{ price: 0 }, { price: -1 }, { price: Infinity }, { price: NaN }, { price: "123" },
    { asOf: iso(THROUGH - 1) }, { asOf: "2026-09-16T15:15:00" }, { priceType: "last_trade" },
    { timeframeMinutes: 60 }, { quote: "USDT" }, { pair: "ETH/USD" }]) {
    const live = liveFor(); Object.assign(live.marketSnapshot, change);
    const view = viewFor(live); assert.equal(view.cards.length, 2);
    assert.ok(view.cards.every((card) => card.price === null && card.priceAsOf === null), JSON.stringify(change));
  }
  const oldBackend = liveFor(); delete oldBackend.marketSnapshot;
  assert.equal(viewFor(oldBackend).cards[0].price, null);
});

test("invalid market envelopes remain non-current, while missing snapshot is a truthful pending idle view", () => {
  for (const change of [{ schemaVersion: 2 }, { bundleId: "other" }, { venue: "binance" }, { quote: "USDT" }, { assets: null }, { status: "success" },
    { ordersSubmitted: 1 }, { ordersSubmitted: "0" }, { ordersSubmitted: undefined },
    { deploymentAllowed: true }, { deploymentAllowed: undefined }, { diagnosticOnly: true }]) {
    const view = buildMarketView({ ...snapshotFor(), ...change }, catalog, "kraken", NOW);
    assert.equal(view.cards.length, 0); assert.equal(view.status, "unavailable"); assert.equal(view.completedAssets, 0);
  }
  const idle = buildMarketView(null, catalog, "kraken", NOW);
  assert.equal(idle.status, "idle"); assert.equal(idle.pendingAssets, 3); assert.equal(idle.unavailableAssets, 0);
  assert.equal(buildMarketView(snapshotFor(), catalog, "unknown", NOW).cards.length, 0);
});
