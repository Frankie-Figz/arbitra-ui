import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { verifyFrozenCatalog } from "../scripts/sync-frozen-oscillators.mjs";

const { bytes } = await verifyFrozenCatalog();
const catalog = JSON.parse(bytes);
const source = await readFile(new URL("../app/oscillators/FrozenOscillatorLab.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const timeZoneSource = await readFile(new URL("../app/oscillators/timezones.ts", import.meta.url), "utf8");
const timeZoneModule = { exports: {} };
new Function("module", "exports", ts.transpileModule(timeZoneSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(timeZoneModule, timeZoneModule.exports);
const timeZones = timeZoneModule.exports;
const signalMarketModule = { exports: {} };
new Function("module", "exports", ts.transpileModule(await readFile(new URL("../app/oscillators/signal-market.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(signalMarketModule, signalMarketModule.exports);

// A pure component harness: keep hook state and event handlers, suppress effects
// (no provider calls or timers), and render the actual TSX through React's SSR.
function screen({ asset = "ETH", live = null, venue = "binance", selectedId = "", timeZoneState, useInitialSelection = false } = {}) {
  const state = new Map([[0, catalog], [2, asset], [3, selectedId], [4, live], [10, venue]]);
  // Existing signal fixtures use ETH/Binance; default-selection tests use the component's initial state.
  if (useInitialSelection) { state.delete(2); state.delete(10); }
  if (timeZoneState) state.set(13, timeZoneState);
  let cursor = 0;
  const react = { ...React, useEffect() {}, useCallback: (callback) => callback,
    useState(initial) {
      const index = cursor++;
      if (!state.has(index)) state.set(index, typeof initial === "function" ? initial() : initial);
      return [state.get(index), (value) => state.set(index, typeof value === "function" ? value(state.get(index)) : value)];
    },
  };
  const module = { exports: {} };
  const require = (name) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return jsx;
    if (name === "./oscillators.module.css") return { default: new Proxy({}, { get: (_, key) => key }) };
    if (name === "./timezones") return timeZones;
    if (name === "./signal-market") return signalMarketModule.exports;
    if (name === "./CryptoSignalTicker") return { default: () => null }; // Dedicated ticker tests exercise its own hooks.
    throw new Error(`Unexpected component dependency: ${name}`);
  };
  new Function("require", "module", "exports", compiled)(require, module, module.exports);
  const tree = () => { cursor = 0; const node = module.exports.default(); assert.equal(cursor, 14, "Update the state fixture when hook order changes"); return node; };
  return { tree, html: () => renderToStaticMarkup(tree()) };
}

function find(node, predicate) {
  if (Array.isArray(node)) return node.map((item) => find(item, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return undefined;
  return predicate(node) ? node : find(node.props?.children, predicate);
}

function liveResponse(asset, entry, overrides = {}) {
  const now = Date.now();
  return {
    schemaVersion: 1, bundleId: catalog.bundleId, asset, status: "available",
    venue: "binance", quote: "USDT", pair: `${asset}/USDT`, marketType: "spot", transferValidation: "same_venue",
    asOf: new Date(now).toISOString(), dataThrough: new Date(now - 60_000).toISOString(),
    deploymentAllowed: false, ordersSubmitted: 0,
    results: [{ id: entry.id, status: entry.mode === "raw" ? "raw_accepted" : "xgb_accepted", current_signal: "BUY", admission: null,
      latest_raw_event: { direction: "BUY", decision_utc: new Date(now - 60_000).toISOString(), age_minutes: 1, at_latest_native_close: true, raw_exit_for: "SHORT", exit_requires_xgb_acceptance: false } }],
    ...overrides,
  };
}

test("scanner defaults to BTCUSDT on Binance and preserves manual asset and venue selections", () => {
  const view = screen({ useInitialSelection: true });
  const assetPicker = find(view.tree(), (node) => node.type === "select" && node.props.value === "BTC");
  const venuePicker = find(view.tree(), (node) => node.type === "select" && node.props.value === "binance");
  assert.ok(assetPicker, "BTC must be the initial asset");
  assert.ok(venuePicker, "Binance must supply the default USDT pair");
  assert.match(view.html(), /Binance.*BTC\/USDT spot/);
  assert.match(view.html(), /<option value="BTC" selected="">BTCUSDT<\/option>/);
  assert.equal((view.html().match(/aria-pressed="false"/g) ?? []).length, 10);

  assetPicker.props.onChange({ target: { value: "ETH" } });
  assert.match(view.html(), /Binance.*ETH\/USDT spot/);
  venuePicker.props.onChange({ target: { value: "kraken" } });
  assert.match(view.html(), /Kraken.*ETH\/USD spot/);
  assert.match(view.html(), /<option value="ETH" selected="">ETHUSD<\/option>/);
  assert.match(view.html(), /ETH \/ ranked setups/);
});

test("scanner has two destinations, ten ranked setups, and no default detail panel", () => {
  const html = screen().html();
  const nav = /<nav aria-label="Market sections">([\s\S]*?)<\/nav>/.exec(html)?.[1];
  assert.equal((nav?.match(/<a\b/g) ?? []).length, 2);
  assert.match(nav, /Stock Picker/);
  assert.match(nav, /aria-current="page">Crypto Scanner/);
  assert.equal((html.match(/aria-pressed="false"/g) ?? []).length, 10);
  assert.doesNotMatch(html, /aria-label="Selected oscillator model details"|<details open/);
  assert.match(html, /Historical results:/);
  assert.match(html, /Unavailable/);
});

test("model details open only on selection, close again, and reset on asset change", () => {
  const view = screen();
  find(view.tree(), (node) => node.type === "button" && node.props["aria-pressed"] === false).props.onClick();
  let html = view.html();
  assert.match(html, /Selected oscillator model details/);
  assert.match(html, /<details><summary>Oscillator parameters/);
  assert.match(html, /<details><summary>Model and feature support/);
  assert.doesNotMatch(html, /<details open/);
  find(view.tree(), (node) => node.type === "button" && node.props.children === "Close details").props.onClick();
  assert.doesNotMatch(view.html(), /Selected oscillator model details/);
  find(view.tree(), (node) => node.type === "button" && node.props["aria-pressed"] === false).props.onClick();
  find(view.tree(), (node) => node.type === "select" && node.props.value === "ETH").props.onChange({ target: { value: "ADA" } });
  html = view.html();
  assert.match(html, /ADA \/ ranked setups/);
  assert.doesNotMatch(html, /Selected oscillator model details/);
});

test("fresh BUY and rejected XGBoost entries are distinct from historical rankings", () => {
  const entry = catalog.assets.find((item) => item.symbol === "ADA").entries.find((row) => row.mode !== "raw");
  const live = liveResponse("ADA", entry);
  assert.match(screen({ asset: "ADA", live }).html(), /class="buy">BUY/);
  live.results[0].status = "xgb_rejected";
  live.results[0].current_signal = "NONE";
  assert.match(screen({ asset: "ADA", live }).html(), />Filtered<\/span>/);
  assert.doesNotMatch(screen({ asset: "ADA", live }).html(), /class="buy">BUY/);
});

test("stale, wrong-bundle, and order-authorized responses cannot display a current BUY", () => {
  const entry = catalog.assets.find((item) => item.symbol === "ETH").entries[0];
  for (const overrides of [
    { asOf: new Date(Date.now() - 18 * 60_000).toISOString() },
    { dataThrough: new Date(Date.now() - 18 * 60_000).toISOString() },
    { status: "unavailable" }, { bundleId: "wrong" }, { ordersSubmitted: 1 },
  ]) {
    const view = screen({ live: liveResponse("ETH", entry, overrides) });
    find(view.tree(), (node) => node.type === "button" && node.props["aria-pressed"] === false).props.onClick();
    assert.doesNotMatch(view.html(), /class="buy">BUY/);
    assert.match(view.html(), /No verified raw event is available/);
  }
});

test("home has no legacy watch import or runtime watch state", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /import .*oscillator-alpha-watch\.json/);
  const home = page.slice(page.indexOf("export default function Home()"));
  assert.doesNotMatch(home, /OscillatorWatch|EtfOpportunities|CryptoOpportunities|setOscillatorWatch/);
  assert.match(home, /StockOpportunityCard/);
});

test("venue selector offers four spot feeds and clears the previous venue's live signal", () => {
  const entry = catalog.assets.find((item) => item.symbol === "ETH").entries[0];
  const view = screen({ live: liveResponse("ETH", entry) });
  assert.match(view.html(), /class="buy">BUY/);
  const picker = find(view.tree(), (node) => node.type === "select" && node.props.value === "binance");
  assert.deepEqual(picker.props.children.map((option) => option.props.value), ["binance", "kraken", "coinbase", "okx"]);
  picker.props.onChange({ target: { value: "kraken" } });
  assert.doesNotMatch(view.html(), /class="buy">BUY/);
  assert.match(view.html(), /Kraken.*ETH\/USD spot/);
  assert.match(view.html(), /Cross-venue observation/);
  assert.match(view.html(), /models and historical returns are from Binance USDT/);
});

test("only signals matching the selected venue, pair and quote can appear", () => {
  const entry = catalog.assets.find((item) => item.symbol === "ETH").entries[0];
  const transferred = liveResponse("ETH", entry, { venue: "coinbase", quote: "USD", pair: "ETH/USD", transferValidation: "not_validated" });
  assert.match(screen({ venue: "coinbase", live: transferred }).html(), /class="buy">BUY/);
  for (const patch of [{ venue: "kraken" }, { quote: "USDT" }, { pair: "BTC/USD" }, { marketType: "futures" }, { transferValidation: "validated" }]) {
    assert.doesNotMatch(screen({ venue: "coinbase", live: { ...transferred, ...patch } }).html(), /class="buy">BUY/);
  }
});

function historical(entry, overrides = {}) {
  return { bundleId: catalog.bundleId, entryId: entry.id, asset: "ETH", venue: "binance", pair: "ETH/USDT",
    indicator: entry.indicator, timeframeMinutes: entry.timeframeMinutes, mode: entry.mode, direction: "SELL",
    signalTime: "2026-09-08T20:00:00Z", evaluatedAt: "2026-09-14T02:00:00Z", sourceStart: "2023-09-09T00:00:00Z",
    evaluationKind: "reconstructed", status: "raw_accepted", admission: { accepted: true },
    marketCondition: { as_of_utc: "2026-09-08T20:00:00Z", trend: "downtrend", close: 2350.5,
      bar_change_pct: -0.4, return_1h_pct: -0.8, return_24h_pct: -2.4, atr14_pct: 0.6, volatility_24h_pct: 0.2, volume_ratio20: 1.5 }, ...overrides };
}

test("unavailable live feed retains dated history without asserting a new SELL", () => {
  const entry = catalog.assets.find((item) => item.symbol === "ETH").entries[0];
  const live = liveResponse("ETH", entry, { status: "unavailable", results: [], history: [historical(entry)], historyPersistence: "available",
    historyBackfill: "Verified Binance cache replay; live feed is unavailable.", historyDataThrough: "2026-09-09T00:00:00Z" });
  const html = screen({ live }).html();
  assert.match(html, /Historical signals/);
  assert.match(html, /Reconstructed/);
  assert.match(html, /2026-09-08 20:00:00 UTC/);
  assert.match(html, /2026-09-14 02:00:00 UTC/);
  assert.match(html, /downtrend/);
  assert.match(html, /volume 1\.50×/);
  assert.match(html, /Saved on the inference server/);
  assert.doesNotMatch(html, /class="sell">SELL/);
});

test("history filters distinguish accepted entries from rejected pulses and reset on asset change", () => {
  const entries = catalog.assets.find((item) => item.symbol === "ETH").entries;
  const live = liveResponse("ETH", entries[0], { history: [historical(entries[0]), historical(entries[1], { admission: { accepted: false }, status: "xgb_rejected" })] });
  const view = screen({ live });
  assert.match(view.html(), /1 shown \/ 2 loaded/);
  find(view.tree(), (node) => node.type === "select" && node.props.value === "accepted").props.onChange({ target: { value: "all" } });
  assert.match(view.html(), /2 shown \/ 2 loaded/);
  assert.match(view.html(), /Filtered entry/);
  find(view.tree(), (node) => node.type === "select" && node.props.children?.[0]?.props?.children === "All timeframes").props.onChange({ target: { value: String(entries[0].timeframeMinutes) } });
  assert.match(view.html(), /1 shown \/ 2 loaded/);
  find(view.tree(), (node) => node.type === "select" && node.props.value === "ETH").props.onChange({ target: { value: "ADA" } });
  assert.match(view.html(), /0 shown \/ 0 loaded/);
});

test("foreign identity and mismatched market-condition dates never appear as signal history", () => {
  const entry = catalog.assets.find((item) => item.symbol === "ETH").entries[0];
  for (const patch of [{ venue: "kraken" }, { asset: "BTC" }, { bundleId: "wrong" }, { entryId: "unknown" },
    { marketCondition: { as_of_utc: "2026-09-09T00:00:00Z" } }, { evaluatedAt: "2026-09-01T00:00:00Z" }]) {
    const html = screen({ live: liveResponse("ETH", entry, { history: [historical(entry, patch)] }) }).html();
    assert.match(html, /0 shown \/ 0 loaded/);
  }
});

test("warm-up failures display candle counts even when every live entry is unavailable", () => {
  const entry = catalog.assets.find((item) => item.symbol === "ETH").entries[0];
  const live = liveResponse("ETH", entry, { status: "unavailable", results: [{ id: entry.id, status: "unavailable", current_signal: "NONE",
    diagnostic_code: "warmup_insufficient", diagnostic_message: "Not enough same-venue candles.", source: { closed_parent_bars: 90, minimum_closed_parent_bars: 200 } }] });
  const html = screen({ live }).html();
  assert.match(html, /Needs history/);
  assert.match(html, /90\/200 TF candles/);
  assert.match(html, /0\/10 setups evaluated/);
});

function entryAt(timeframeMinutes) {
  for (const asset of catalog.assets) {
    const entry = asset.entries.find((row) => row.timeframeMinutes === timeframeMinutes);
    if (entry) return { asset: asset.symbol, entry };
  }
  assert.fail(`Frozen test catalog has no ${timeframeMinutes}m entry`);
}

function recentResponse(asset, entry, { direction = "BUY", decision = "2026-09-14T12:00:00Z" } = {}) {
  const now = Date.now();
  const through = Math.floor(now / 900_000) * 900_000;
  const window = Math.max(60, entry.timeframeMinutes);
  const latest = Date.parse(decision) === through;
  return liveResponse(asset, entry, {
    dataThrough: new Date(through).toISOString(),
    results: [{ id: entry.id, status: entry.mode === "raw" ? "raw_accepted" : "xgb_accepted",
      current_signal: latest ? direction : "NONE",
      recent_signal: { direction, decision_utc: decision, expires_utc: new Date(Date.parse(decision) + window * 60_000).toISOString(),
        window_minutes: window, at_latest_native_close: latest },
      latest_raw_event: { direction, decision_utc: decision, age_minutes: (now - Date.parse(decision)) / 60_000,
        at_latest_native_close: latest, raw_exit_for: direction === "BUY" ? "SHORT" : "LONG", exit_requires_xgb_acceptance: false },
      admission: { status: "accepted", accepted: true, score: null, policy_mode: "ALL" } }],
  });
}

test("30m entries retain a distinct recent badge for a decision-anchored 60m window", (t) => {
  t.mock.method(Date, "now", () => Date.parse("2026-09-14T12:45:00Z"));
  const { asset, entry } = entryAt(30);
  const live = recentResponse(asset, entry);
  const html = screen({ asset, live }).html();
  assert.match(html, /class="recentBuy">Recent BUY/);
  assert.doesNotMatch(html, /class="buy">BUY/);
  assert.match(html, /Earlier accepted entry · age 45m/);
  assert.match(html, /Expires 2026-09-14 13:00:00 UTC · 1h window/);
  assert.match(html, /Active entry badges: 1 \(0 latest-close · 1 recent\)/);
  assert.equal(live.results[0].current_signal, "NONE", "Display retention must not change native-pulse semantics");
});

test("a higher-timeframe recent entry uses its own timeframe, not the one-hour minimum", (t) => {
  t.mock.method(Date, "now", () => Date.parse("2026-09-14T13:30:00Z"));
  const { asset, entry } = entryAt(120);
  const live = recentResponse(asset, entry, { direction: "SELL" });
  const html = screen({ asset, live }).html();
  assert.match(html, /class="recentSell">Recent SELL/);
  assert.match(html, /age 90m/);
  assert.match(html, /Expires 2026-09-14 14:00:00 UTC · 2h window/);
});

test("accepted latest-close pulses keep the BUY badge and show their separate expiry", (t) => {
  t.mock.method(Date, "now", () => Date.parse("2026-09-14T12:01:00Z"));
  const { asset, entry } = entryAt(30);
  const html = screen({ asset, live: recentResponse(asset, entry) }).html();
  assert.match(html, /class="buy">BUY/);
  assert.doesNotMatch(html, /class="recentBuy">Recent BUY/);
  assert.match(html, /Latest 15m close · age 1m/);
  assert.match(html, /Expires 2026-09-14 13:00:00 UTC · 1h window/);
  assert.match(html, /Active entry badges: 1 \(1 latest-close · 0 recent\)/);
});

test("the existing render tick advances age without renewing a retained event", (t) => {
  let now = Date.parse("2026-09-14T12:45:00Z");
  t.mock.method(Date, "now", () => now);
  const { asset, entry } = entryAt(30);
  const live = recentResponse(asset, entry);
  const originalPayload = JSON.stringify(live.results[0].recent_signal);
  const view = screen({ asset, live });
  assert.match(view.html(), /age 45m/);
  now += 60_000;
  assert.match(view.html(), /age 46m/);
  assert.match(view.html(), /Expires 2026-09-14 13:00:00 UTC/);
  assert.equal(JSON.stringify(live.results[0].recent_signal), originalPayload);
});

test("recency ends at the exact exclusive expiry even with a still-fresh response", (t) => {
  let now = Date.parse("2026-09-14T12:59:59.999Z");
  t.mock.method(Date, "now", () => now);
  const { asset, entry } = entryAt(30);
  const live = recentResponse(asset, entry);
  const view = screen({ asset, live });
  assert.match(view.html(), /class="recentBuy">Recent BUY/);
  now += 1;
  assert.doesNotMatch(view.html(), /class="recentBuy">Recent BUY/);
  assert.match(view.html(), /Active entry badges: 0 \(0 latest-close · 0 recent\)/);
  assert.match(view.html(), />No new entry<\/span>/);
});

test("recent badges still require fresh same-venue evidence and research-only identity", (t) => {
  t.mock.method(Date, "now", () => Date.parse("2026-09-14T12:45:00Z"));
  const { asset, entry } = entryAt(30);
  for (const patch of [
    { asOf: new Date(Date.now() - 180_001).toISOString() },
    { dataThrough: new Date(Date.now() - 17 * 60_000 - 1).toISOString() },
    { status: "unavailable" }, { venue: "kraken" }, { asset: "FOREIGN" }, { pair: "WRONG/USDT" },
    { quote: "USD" }, { marketType: "futures" }, { bundleId: "wrong" }, { ordersSubmitted: 1 }, { deploymentAllowed: true },
  ]) {
    const html = screen({ asset, live: { ...recentResponse(asset, entry), ...patch } }).html();
    assert.doesNotMatch(html, /class="recent(?:Buy|Sell)">Recent/);
    assert.doesNotMatch(html, /Active entry badges: 1/);
  }
  const matching = { ...recentResponse(asset, entry), venue: "kraken", quote: "USD", pair: `${asset}/USD`, transferValidation: "not_validated" };
  assert.match(screen({ asset, venue: "kraken", live: matching }).html(), /class="recentBuy">Recent BUY/);
});

test("malformed, future, wrong-lifetime and inconsistent recency payloads fail closed", (t) => {
  t.mock.method(Date, "now", () => Date.parse("2026-09-14T12:45:00Z"));
  const { asset, entry } = entryAt(30);
  const base = recentResponse(asset, entry);
  for (const patch of [
    { direction: "HOLD" }, { window_minutes: 30 }, { window_minutes: 120 }, { window_minutes: "60" },
    { window_minutes: 60.5 }, { window_minutes: Infinity }, { expires_utc: "not-a-date" },
    { decision_utc: "2026-09-14T12:00:00" }, { decision_utc: "2026-09-14" },
    { decision_utc: 123 }, { decision_utc: "2026-02-30T12:00:00Z" },
    { decision_utc: "2026-09-14T24:00:00Z" }, { expires_utc: "2026-09-14T13:00:00.001Z" },
    { decision_utc: "2026-09-14T12:46:00Z", expires_utc: "2026-09-14T13:46:00Z" },
    { expires_utc: "2026-09-14T11:00:00Z" }, { at_latest_native_close: "false" }, { at_latest_native_close: true },
  ]) {
    const live = { ...base, results: [{ ...base.results[0], recent_signal: { ...base.results[0].recent_signal, ...patch } }] };
    const html = screen({ asset, live }).html();
    assert.doesNotMatch(html, /class="recent(?:Buy|Sell)">Recent/, JSON.stringify(patch));
    assert.match(html, /Active entry badges: 0/);
  }
  for (const value of [null, undefined, "BUY", {}, []]) {
    const live = { ...base, results: [{ ...base.results[0], recent_signal: value }] };
    assert.doesNotMatch(screen({ asset, live }).html(), /class="recent(?:Buy|Sell)">Recent/);
  }
});

test("a decision after the verified candle boundary cannot become a recent entry", (t) => {
  t.mock.method(Date, "now", () => Date.parse("2026-09-14T12:45:00Z"));
  const { asset, entry } = entryAt(30);
  const live = recentResponse(asset, entry, { decision: "2026-09-14T12:40:00Z" });
  live.dataThrough = "2026-09-14T12:30:00Z";
  assert.doesNotMatch(screen({ asset, live }).html(), /class="recent(?:Buy|Sell)">Recent/);
});

test("timezone-offset timestamps preserve the same decision-anchored expiry", (t) => {
  t.mock.method(Date, "now", () => Date.parse("2026-09-14T12:45:00Z"));
  const { asset, entry } = entryAt(30);
  const live = recentResponse(asset, entry, { decision: "2026-09-14T08:00:00.000000-04:00" });
  live.results[0].recent_signal.expires_utc = "2026-09-14T09:00:00.000000-04:00";
  assert.match(screen({ asset, live }).html(), /Expires 2026-09-14 13:00:00 UTC · 1h window/);
});

test("a rejected later same-direction pulse does not replace or renew an accepted entry", (t) => {
  t.mock.method(Date, "now", () => Date.parse("2026-09-14T12:45:00Z"));
  const { asset, entry } = entryAt(30);
  const live = recentResponse(asset, entry);
  live.results[0].status = "xgb_rejected";
  live.results[0].admission = { accepted: false, status: "rejected", policy_mode: "score", score: -0.25 };
  live.results[0].latest_raw_event = { ...live.results[0].latest_raw_event, decision_utc: live.dataThrough, age_minutes: 0, at_latest_native_close: true };
  const html = screen({ asset, live, selectedId: entry.id }).html();
  assert.match(html, /class="recentBuy">Recent BUY/);
  assert.doesNotMatch(html, />Filtered<\/span>/);
  assert.match(html, /Accepted close: 2026-09-14 12:00:00 UTC · age 45m/);
  assert.match(html, /Expires 2026-09-14 13:00:00 UTC/);
  assert.match(html, /Latest raw admission: rejected/);
});

test("recent admission can survive an ineligible latest event, but never an unavailable row", (t) => {
  t.mock.method(Date, "now", () => Date.parse("2026-09-14T12:45:00Z"));
  const { asset, entry } = entryAt(30);
  const live = recentResponse(asset, entry);
  live.results[0].status = "ineligible_warmup_or_sigma";
  assert.match(screen({ asset, live }).html(), /class="recentBuy">Recent BUY/);
  live.results[0].status = "unavailable";
  live.results[0].diagnostic_code = "warmup_insufficient";
  const html = screen({ asset, live }).html();
  assert.doesNotMatch(html, /class="recentBuy">Recent BUY/);
  assert.match(html, /Needs history/);
  assert.match(html, /Active entry badges: 0/);
});

test("null cancellation cannot revive an accepted entry from historical rows", (t) => {
  t.mock.method(Date, "now", () => Date.parse("2026-09-14T12:45:00Z"));
  const { asset, entry } = entryAt(30);
  const live = recentResponse(asset, entry);
  live.history = [historical(entry, { asset, pair: `${asset}/USDT`, direction: "BUY", signalTime: "2026-09-14T12:00:00Z",
    evaluatedAt: "2026-09-14T12:01:00Z", marketCondition: { as_of_utc: "2026-09-14T12:00:00Z", trend: "uptrend" } })];
  const view = screen({ asset, live });
  assert.match(view.html(), /class="recentBuy">Recent BUY/);
  live.results[0].recent_signal = null;
  live.results[0].status = "xgb_rejected";
  live.results[0].admission.accepted = false;
  live.results[0].latest_raw_event = { direction: "SELL", decision_utc: live.dataThrough, age_minutes: 0,
    at_latest_native_close: true, raw_exit_for: "LONG", exit_requires_xgb_acceptance: false };
  const html = view.html();
  assert.doesNotMatch(html, /class="recent(?:Buy|Sell)">Recent/);
  assert.match(html, /1 shown \/ 1 loaded/);
  assert.match(html, />Filtered<\/span>/);
  assert.match(html, /Active entry badges: 0/);
});

test("changing venue clears a retained recent badge immediately", (t) => {
  t.mock.method(Date, "now", () => Date.parse("2026-09-14T12:45:00Z"));
  const { asset, entry } = entryAt(30);
  const view = screen({ asset, live: recentResponse(asset, entry) });
  assert.match(view.html(), /class="recentBuy">Recent BUY/);
  find(view.tree(), (node) => node.type === "select" && node.props.value === "binance").props.onChange({ target: { value: "kraken" } });
  assert.doesNotMatch(view.html(), /class="recentBuy">Recent BUY/);
});

test("display timezone has an automatic browser option and can return to it", () => {
  const initial = screen();
  let picker = find(initial.tree(), (node) => node.type === "select" && node.props["aria-label"] === "Display timezone");
  assert.equal(picker.props.value, "auto");
  assert.match(initial.html(), /Automatic \(UTC\)/);

  // Effects are intentionally suppressed; seed the state that browser detection supplies.
  const view = screen({ timeZoneState: { preference: "UTC", browserTimeZone: "America/New_York", options: ["UTC", "America/New_York"] } });
  assert.match(view.html(), /<option value="America\/New_York">Florida \/ New York — Eastern Time<\/option>/);
  assert.match(view.html(), /Automatic \(America\/New_York\)/);
  picker = find(view.tree(), (node) => node.type === "select" && node.props["aria-label"] === "Display timezone");
  picker.props.onChange({ target: { value: "auto" } });
  assert.equal(find(view.tree(), (node) => node.type === "select" && node.props["aria-label"] === "Display timezone").props.value, "auto");
  assert.match(view.html(), /America\/New_York/);
  picker.props.onChange({ target: { value: "Not/A_Zone" } });
  assert.equal(find(view.tree(), (node) => node.type === "select" && node.props["aria-label"] === "Display timezone").props.value, "auto");
});

test("the simplified heading contains the only timezone selector, above the ticker rather than in the toolbar", () => {
  const view = screen();
  const heading = find(view.tree(), (node) => node.props?.className === "heading");
  const html = renderToStaticMarkup(heading);
  assert.match(html, /<p class="eyebrow">Oscillators<\/p><h1>Crypto Scanner<\/h1>/);
  assert.ok(find(heading, (node) => node.type === "label" && node.props.className === "timezoneControl"));
  assert.ok(find(heading, (node) => node.type === "select" && node.props["aria-label"] === "Display timezone"));
  const toolbar = find(view.tree(), (node) => node.props?.["aria-label"] === "Asset and live inference controls");
  assert.equal(find(toolbar, (node) => node.props?.["aria-label"] === "Display timezone"), undefined);
  assert.equal((view.html().match(/aria-label="Display timezone"/g) ?? []).length, 1);
  assert.doesNotMatch(view.html(), /Top 10 frozen setups per asset, with raw or XGBoost-filtered BUY\/SELL signals\.|Divergence oscillators · XGBoost enhancement/);
});

test("timezone selection reformats all signal dates without changing age, admission or source JSON", (t) => {
  t.mock.method(Date, "now", () => Date.parse("2026-09-14T12:45:00Z"));
  const requestMock = t.mock.method(globalThis, "fetch", () => { assert.fail("Timezone changes must not fetch or reset market evidence"); });
  const stored = [];
  const storage = { getItem: () => null, setItem: (key, value) => stored.push([key, value]) };
  for (const [key, value] of [["localStorage", storage], ["window", { localStorage: storage }]]) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key]; });
  }
  const { asset, entry } = entryAt(30);
  const live = recentResponse(asset, entry);
  live.results[0].latest_raw_event = { ...live.results[0].latest_raw_event, decision_utc: "2026-09-14T12:30:00Z", age_minutes: 15 };
  live.history = [historical(entry, { asset, pair: `${asset}/USDT`, direction: "BUY", signalTime: "2026-09-14T12:00:00Z",
    evaluatedAt: "2026-09-14T12:01:00Z", marketCondition: { as_of_utc: "2026-09-14T12:00:00Z", trend: "uptrend" } })];
  const original = JSON.stringify(live);
  const view = screen({ asset, live, selectedId: entry.id,
    timeZoneState: { preference: "auto", browserTimeZone: "America/New_York", options: ["UTC", "America/New_York", "Europe/Paris"] } });
  const values = [live.dataThrough, live.results[0].latest_raw_event.decision_utc, live.history[0].signalTime,
    live.history[0].evaluatedAt, live.results[0].recent_signal.expires_utc, catalog.frozenAt];
  for (const value of values) assert.ok(view.html().includes(timeZones.formatTimestamp(value, "America/New_York")), value);
  find(view.tree(), (node) => node.type === "select" && node.props["aria-label"] === "Display timezone").props.onChange({ target: { value: "Europe/Paris" } });
  const html = view.html();
  for (const value of values) assert.ok(html.includes(timeZones.formatTimestamp(value, "Europe/Paris")), value);
  assert.match(html, /class="recentBuy">Recent BUY/);
  assert.match(html, /age 45m/);
  assert.match(html, /Active entry badges: 1 \(0 latest-close · 1 recent\)/);
  assert.match(html, /Signal time \(Europe\/Paris\)/);
  assert.match(html, /Evaluation \(Europe\/Paris\)/);
  assert.deepEqual(stored, [[timeZones.TIME_ZONE_STORAGE_KEY, "Europe/Paris"]]);
  assert.equal(requestMock.mock.callCount(), 0);
  assert.equal(JSON.stringify(live), original);
});

test("history styling follows signal day, not evaluation day, and switches with display timezone", async (t) => {
  const css = await readFile(new URL("../app/oscillators/oscillators.module.css", import.meta.url), "utf8");
  for (const [className, weight, color] of [["historyToday", "700", "var(--ink)"], ["historyOlder", "400", "#6b6b6b"]]) {
    const rule = new RegExp(`([^{}]*\\.${className}\\b[^{}]*)\\{([^{}]*)\\}`).exec(css);
    assert.ok(rule, `${className} must have an actual stylesheet rule`);
    const selectors = rule[1].split(",").map((value) => value.trim());
    for (const tag of ["td", "strong", "small"]) assert.ok(selectors.includes(`.historyTable .${className} ${tag}`));
    assert.match(rule[2], new RegExp(`font-weight:\\s*${weight}\\s*;`));
    assert.ok(rule[2].replace(/\s/g, "").includes(`color:${color};`));
  }
  t.mock.method(Date, "now", () => Date.parse("2026-09-14T00:30:00Z"));
  const requests = t.mock.method(globalThis, "fetch", () => { assert.fail("Day styling must not fetch market evidence"); });
  const entry = catalog.assets.find((item) => item.symbol === "ETH").entries[0];
  const history = ["2026-09-14T00:15:00Z", "2026-09-13T23:45:00Z"].map((signalTime) => historical(entry, {
    signalTime, evaluatedAt: "2026-09-14T00:20:00Z", marketCondition: { as_of_utc: signalTime, trend: "uptrend" },
  }));
  const live = liveResponse("ETH", entry, { status: "unavailable", results: [], history });
  const original = JSON.stringify(live);
  const view = screen({ live, timeZoneState: { preference: "UTC", browserTimeZone: "UTC", options: ["UTC", "America/New_York"] } });
  let html = view.html();
  assert.equal((html.match(/<tr class="historyToday">/g) ?? []).length, 1);
  assert.equal((html.match(/<tr class="historyOlder">/g) ?? []).length, 1);
  const older = /<tr class="historyOlder">([\s\S]*?)<\/tr>/.exec(html)?.[1];
  assert.match(older, /2026-09-13 23:45:00 UTC/);
  assert.match(older, /2026-09-14 00:20:00 UTC/, "A replay evaluated today must not make yesterday's signal bold");
  find(view.tree(), (node) => node.type === "select" && node.props["aria-label"] === "Display timezone").props.onChange({ target: { value: "America/New_York" } });
  html = view.html();
  assert.equal((html.match(/<tr class="historyToday">/g) ?? []).length, 2);
  assert.equal((html.match(/<tr class="historyOlder">/g) ?? []).length, 0);
  assert.match(html, /2 shown \/ 2 loaded/);
  assert.equal(JSON.stringify(live), original);
  assert.equal(requests.mock.callCount(), 0);
});

test("the existing render tick changes today's history to older at local midnight without refetch", (t) => {
  let now = Date.parse("2026-09-14T03:59:59.999Z");
  t.mock.method(Date, "now", () => now);
  const requests = t.mock.method(globalThis, "fetch", () => { assert.fail("Midnight restyling must use retained history"); });
  const entry = catalog.assets.find((item) => item.symbol === "ETH").entries[0];
  const live = liveResponse("ETH", entry, { status: "unavailable", results: [], history: [historical(entry, {
    signalTime: "2026-09-14T03:45:00Z", evaluatedAt: "2026-09-14T03:46:00Z",
    marketCondition: { as_of_utc: "2026-09-14T03:45:00Z", trend: "uptrend" },
  })] });
  const original = JSON.stringify(live);
  const view = screen({ live, timeZoneState: { preference: "America/New_York", browserTimeZone: "America/New_York", options: ["UTC", "America/New_York"] } });
  assert.match(view.html(), /<tr class="historyToday">/);
  now += 1;
  const html = view.html();
  assert.match(html, /<tr class="historyOlder">/);
  assert.doesNotMatch(html, /<tr class="historyToday">/);
  assert.match(html, /2026-09-13 23:45:00 UTC-04:00/);
  assert.equal(JSON.stringify(live), original);
  assert.equal(requests.mock.callCount(), 0);
});

test("ETH screenshot regression styles the latest raw signal cells without creating live entries", async (t) => {
  const css = await readFile(new URL("../app/oscillators/oscillators.module.css", import.meta.url), "utf8");
  for (const [className, weight, color] of [["rawSignalToday", "700", "var(--ink)"], ["rawSignalOlder", "400", "#6b6b6b"]]) {
    const rule = new RegExp(`([^{}]*\\.${className}\\b[^{}]*)\\{([^{}]*)\\}`).exec(css);
    assert.ok(rule, `${className} needs an actual direction-and-timestamp CSS rule`);
    const selectors = rule[1].split(",").map((value) => value.trim());
    assert.ok(selectors.some((value) => new RegExp(`td\\.${className}$`).test(value)));
    assert.ok(selectors.some((value) => new RegExp(`td\\.${className}\\s+(?:small)?\\.rowDiagnostic$`).test(value)));
    assert.match(rule[2], new RegExp(`font-weight:\\s*${weight}\\s*;`));
    assert.ok(rule[2].replace(/\s/g, "").includes(`color:${color};`));
  }
  t.mock.method(Date, "now", () => Date.parse("2026-09-14T13:00:00Z"));
  const entries = catalog.assets.find((item) => item.symbol === "ETH").entries;
  const cci = entries.find((entry) => entry.indicator === "cci" && entry.timeframeMinutes === 15);
  const volume = entries.find((entry) => entry.indicator === "volume_exhaustion");
  const dpo = entries.find((entry) => entry.indicator === "dpo" && entry.timeframeMinutes === 480);
  assert.ok(cci && volume && dpo, "The pinned ETH catalog must contain the screenshot setups");
  const events = new Map([
    [cci.id, { direction: "SELL", decision_utc: "2026-09-14T10:30:00Z" }],
    [volume.id, { direction: "SELL", decision_utc: "2026-09-10T09:00:00Z" }],
    [dpo.id, { direction: "BUY", decision_utc: "2026-08-30T08:00:00Z" }],
  ]);
  const live = liveResponse("ETH", cci, { results: entries.map((entry) => ({
    id: entry.id, status: entry.mode === "raw" ? "raw_accepted" : "xgb_accepted", current_signal: "NONE", recent_signal: null, admission: null,
    latest_raw_event: events.has(entry.id) ? { ...events.get(entry.id), age_minutes: (Date.now() - Date.parse(events.get(entry.id).decision_utc)) / 60_000,
      at_latest_native_close: false, raw_exit_for: events.get(entry.id).direction === "SELL" ? "LONG" : "SHORT", exit_requires_xgb_acceptance: false } : null,
  })) });
  const html = screen({ live, timeZoneState: { preference: "America/New_York", browserTimeZone: "America/New_York", options: ["UTC", "America/New_York"] } }).html();
  const cells = [...html.matchAll(/<td class="(rawSignalToday|rawSignalOlder)">([\s\S]*?)<\/td>/g)];
  assert.equal(cells.length, 3);
  assert.equal(cells.filter((cell) => cell[1] === "rawSignalToday").length, 1);
  assert.match(cells.find((cell) => cell[1] === "rawSignalToday")[2], /^SELL<small class="rowDiagnostic">2026-09-14 06:30:00 UTC-04:00<\/small>$/);
  const older = cells.filter((cell) => cell[1] === "rawSignalOlder").map((cell) => cell[2]).join("\n");
  assert.match(older, /SELL<small class="rowDiagnostic">2026-09-10 05:00:00 UTC-04:00/);
  assert.match(older, /BUY<small class="rowDiagnostic">2026-08-30 04:00:00 UTC-04:00/);
  assert.match(html, /Active entry badges: 0/);
  assert.doesNotMatch(html, /class="(?:buy|sell|recentBuy|recentSell)">/);
  assert.ok(live.results.every((row) => row.current_signal === "NONE"));
});

test("latest raw day styling changes with timezone and midnight, never asOf or untrusted data", (t) => {
  let now = Date.parse("2026-09-14T00:30:00Z");
  t.mock.method(Date, "now", () => now);
  const requests = t.mock.method(globalThis, "fetch", () => { assert.fail("Raw signal restyling must not fetch"); });
  const entry = catalog.assets.find((item) => item.symbol === "ETH").entries.find((item) => item.indicator === "cci");
  const live = liveResponse("ETH", entry);
  live.results[0].current_signal = "NONE";
  live.results[0].recent_signal = null;
  live.results[0].latest_raw_event = { direction: "SELL", decision_utc: "2026-09-13T23:45:00Z", age_minutes: 45,
    at_latest_native_close: false, raw_exit_for: "LONG", exit_requires_xgb_acceptance: false };
  const original = JSON.stringify(live);
  const view = screen({ live, timeZoneState: { preference: "UTC", browserTimeZone: "UTC", options: ["UTC", "America/New_York"] } });
  assert.match(view.html(), /<td class="rawSignalOlder">SELL/, "An evaluation today must not restyle yesterday's raw pulse as today");
  find(view.tree(), (node) => node.type === "select" && node.props["aria-label"] === "Display timezone").props.onChange({ target: { value: "America/New_York" } });
  assert.match(view.html(), /<td class="rawSignalToday">SELL/);
  now = Date.parse("2026-09-14T04:00:00Z");
  assert.match(view.html(), /<td class="rawSignalOlder">SELL/);
  assert.doesNotMatch(view.html(), /<td class="rawSignalToday">/);
  assert.equal(JSON.stringify(live), original);
  for (const patch of [{ venue: "kraken" }, { pair: "BTC/USDT" }, { bundleId: "wrong" }]) {
    assert.doesNotMatch(screen({ live: { ...live, ...patch } }).html(), /<td class="rawSignal(?:Today|Older)">/);
  }
  const missing = { ...live, results: [{ ...live.results[0], latest_raw_event: null }] };
  assert.doesNotMatch(screen({ live: missing }).html(), /<td class="rawSignal(?:Today|Older)">/);
  assert.doesNotMatch(screen().html(), /<td class="rawSignal(?:Today|Older)">/);
  assert.equal(requests.mock.callCount(), 0);
});
