import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const compile = (source, withJsx = false) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, ...(withJsx ? { jsx: ts.JsxEmit.ReactJSX } : {}) },
}).outputText;
const componentSource = await readFile(new URL("../app/oscillators/CryptoSignalTicker.tsx", import.meta.url), "utf8");
const componentCode = compile(componentSource, true);
const tickerCss = await readFile(new URL("../app/oscillators/crypto-signal-ticker.module.css", import.meta.url), "utf8");
const dependencies = {};
for (const name of ["signal-market", "timezones", "ticker-wheel"]) {
  const module = { exports: {} };
  const source = await readFile(new URL(`../app/oscillators/${name}.ts`, import.meta.url), "utf8");
  new Function("module", "exports", compile(source))(module, module.exports);
  dependencies[`./${name}`] = module.exports;
}
const wheelModule = { exports: {} };
new Function("require", "module", "exports", compile(await readFile(new URL("../app/oscillators/BitcoinTickerWheel.tsx", import.meta.url), "utf8"), true))((name) => {
  if (name === "react") return React;
  if (name === "react/jsx-runtime") return jsx;
  if (name === "./crypto-signal-ticker.module.css") return { default: new Proxy({}, { get: (_, key) => key }) };
  if (name === "./ticker-wheel") return dependencies[name];
  throw new Error(`Unexpected wheel dependency: ${name}`);
}, wheelModule, wheelModule.exports);
dependencies["./BitcoinTickerWheel"] = wheelModule.exports;

// Entirely synthetic UI evidence. These values are not market data or strategy results.
const NOW = Date.parse("2026-09-16T15:16:00Z");
const THROUGH = Date.parse("2026-09-16T15:15:00Z");
const iso = (stamp) => new Date(stamp).toISOString();
const fixtureCatalog = {
  bundleId: "synthetic-ui-test-fixture-not-live",
  assets: [
    { symbol: "BTC", entries: [
      { id: "fixture-btc-cci-15", indicator: "cci", timeframeMinutes: 15, mode: "raw" },
      { id: "fixture-btc-stc-240", indicator: "stc", timeframeMinutes: 240, mode: "selected" },
    ] },
    { symbol: "ETH", entries: [{ id: "fixture-eth-rsi-60", indicator: "rsi", timeframeMinutes: 60, mode: "raw" }] },
    { symbol: "XRP", entries: [{ id: "fixture-xrp-mfi-1440", indicator: "mfi", timeframeMinutes: 1440, mode: "baseline27" }] },
  ],
};
const entryFor = (symbol, index = 0) => fixtureCatalog.assets.find((asset) => asset.symbol === symbol).entries[index];
const statusFor = (entry) => entry.mode === "raw" ? "raw_accepted" : "xgb_accepted";
const admissionFor = (entry) => ({ accepted: true, status: statusFor(entry) });

function fixtureRow(symbol, index, direction, decision) {
  const entry = entryFor(symbol, index);
  const latest = decision === THROUGH;
  return {
    id: entry.id, asset: symbol, indicator: entry.indicator, timeframe_minutes: entry.timeframeMinutes, mode: entry.mode,
    status: statusFor(entry), admission: admissionFor(entry), current_signal: latest ? direction : "NONE",
    latest_raw_event: { direction, decision_utc: iso(decision), at_latest_native_close: latest },
    recent_signal: {
      direction, decision_utc: iso(decision), expires_utc: iso(decision + Math.max(60, entry.timeframeMinutes) * 60_000),
      window_minutes: Math.max(60, entry.timeframeMinutes), at_latest_native_close: latest,
    },
  };
}

function fixtureHistory(symbol, index, direction, decision) {
  const entry = entryFor(symbol, index);
  return {
    bundleId: fixtureCatalog.bundleId, entryId: entry.id, asset: symbol, venue: "kraken", pair: `${symbol}/USD`,
    indicator: entry.indicator, timeframeMinutes: entry.timeframeMinutes, mode: entry.mode,
    direction, signalTime: iso(decision), evaluatedAt: iso(NOW), evaluationKind: "reconstructed",
    status: statusFor(entry), admission: admissionFor(entry), marketCondition: { as_of_utc: iso(decision), close: symbol === "BTC" ? (index === 0 ? 67111.25 : 66800) : symbol === "ETH" ? 3333.33 : null },
  };
}

function fixtureAsset(symbol, price) {
  return {
    schemaVersion: 1, bundleId: fixtureCatalog.bundleId, asset: symbol, venue: "kraken", quote: "USD", pair: `${symbol}/USD`,
    marketType: "spot", historicalVenue: "binance", historicalQuote: "USDT", transferValidation: "not_validated",
    status: "available", ordersSubmitted: 0, deploymentAllowed: false, diagnosticOnly: false, liveInferenceEnabled: true,
    asOf: iso(NOW), dataThrough: iso(THROUGH), results: [], history: [],
    marketSnapshot: { price, asOf: iso(THROUGH), priceType: "closed_candle", timeframeMinutes: 15, quote: "USD", pair: `${symbol}/USD` },
  };
}

export function tickerFixtureSnapshot() {
  const btc = fixtureAsset("BTC", 67543.21);
  btc.results = [fixtureRow("BTC", 0, "BUY", THROUGH), { ...fixtureRow("BTC", 1, "SELL", NOW - 12 * 60 * 60_000), recent_signal: null }];
  btc.history = [fixtureHistory("BTC", 0, "BUY", THROUGH), fixtureHistory("BTC", 1, "SELL", NOW - 12 * 60 * 60_000)];
  const eth = fixtureAsset("ETH", 3456.78);
  eth.results = [fixtureRow("ETH", 0, "SELL", Date.parse("2026-09-16T15:00:00Z"))];
  eth.history = [fixtureHistory("ETH", 0, "SELL", Date.parse("2026-09-16T15:00:00Z"))];
  const xrp = fixtureAsset("XRP", 0.789);
  xrp.status = "unavailable";
  xrp.marketSnapshot = null;
  xrp.history = [fixtureHistory("XRP", 0, "BUY", NOW - 6 * 60 * 60_000)];
  return {
    schemaVersion: 1, bundleId: fixtureCatalog.bundleId, venue: "kraken", quote: "USD", status: "ready",
    startedAt: iso(NOW - 15_000), completedAt: iso(NOW), nextScanAt: "2026-09-16T15:30:10.000Z",
    totalAssets: 3, completedAssets: 3, assets: [btc, eth, xrp], ordersSubmitted: 0, deploymentAllowed: false,
  };
}

/** Render actual component + actual signal validation; suppress only effects and seed hook state. */
function screen({ snapshot = tickerFixtureSnapshot(), error = "", paused = false, timeZone = "America/New_York", now = NOW, onSelect = () => {} } = {}) {
  const state = new Map([[0, snapshot], [1, error], [2, paused]]);
  let cursor = 0;
  const react = {
    ...React,
    useEffect() {}, // No provider requests, browser globals or timers in this deterministic SSR harness.
    useRef(initial) {
      const index = cursor++;
      if (!state.has(index)) state.set(index, { current: initial });
      return state.get(index);
    },
    useState(initial) {
      const index = cursor++;
      if (!state.has(index)) state.set(index, typeof initial === "function" ? initial() : initial);
      return [state.get(index), (value) => state.set(index, typeof value === "function" ? value(state.get(index)) : value)];
    },
  };
  const require = (name) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return jsx;
    if (name === "./crypto-signal-ticker.module.css") return { default: new Proxy({}, { get: (_, key) => key }) };
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected ticker dependency: ${name}`);
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", componentCode)(require, module, module.exports);
  const tree = () => {
    cursor = 0;
    const node = module.exports.default({ catalog: fixtureCatalog, venue: "kraken", venueName: "Kraken", timeZone, now, onSelect });
    assert.equal(cursor, 5, "Update the state fixture if ticker hook order changes");
    return node;
  };
  return { tree, html: () => renderToStaticMarkup(tree()) };
}

function nodes(node, predicate) {
  if (Array.isArray(node)) return node.flatMap((item) => nodes(item, predicate));
  if (!node || typeof node !== "object") return [];
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}
const cards = (tree, duplicate = false) => nodes(tree, (node) => node.type === "button" && node.props.className?.split(" ").includes("card") && node.props.tabIndex === (duplicate ? -1 : 0));

/** Standalone synthetic preview for visual QA; no network calls or real trading evidence. */
export function tickerPreviewHtml() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Arbitra ticker — synthetic UI test fixture</title><style>
    :root { --font-geist-mono: ui-monospace; color-scheme: light; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; background: #f4f2ea; color: #1a2820; font-family: Arial, sans-serif; }
    main { max-width: 1380px; margin: 0 auto; }
    .fixtureBanner { margin: 0 0 24px; padding: 16px; background: #ffedbd; color: #4e3100; border: 2px solid #966000; font-weight: 800; line-height: 1.5; }
    .fixtureHeader { margin-bottom: 24px; } .fixtureHeader h1 { margin: 0 0 8px; } .fixtureHeader p { margin: 0; line-height: 1.6; }
    .fixtureFooter { font-size: 13px; line-height: 1.6; color: #56635b; }
    @media(max-width: 640px) { body { padding: 12px; } .fixtureBanner { font-size: 13px; padding: 12px; } }
    ${tickerCss}
  </style></head><body><main><aside class="fixtureBanner">UI TEST FIXTURE — NOT LIVE SIGNALS<br>Invented prices and events for visual verification only. No trading inference or market claims.</aside><header class="fixtureHeader"><h1>Crypto scanner</h1><p>Synthetic market-pulse preview · Kraken · America/New_York<br>Fixed fixture clock: September 16, 2026, 11:16 a.m. Eastern.</p></header>${screen({ paused: true }).html()}<p class="fixtureFooter">This is static server-rendered test markup. Motion is paused for inspection; buttons are exercised in the component tests, not hydrated in this preview. Resize to inspect the responsive desktop/mobile layout.</p></main></body></html>`;
}

test("ticker renders green LONG and red SHORT cards with exact asset, oscillator, timeframe and candle price", () => {
  const rendered = screen();
  const all = cards(rendered.tree());
  assert.equal(all.length, 4);
  const buy = all.find((node) => node.props["aria-label"].startsWith("BTC LONG, CCI 15m"));
  const sell = all.find((node) => node.props["aria-label"].startsWith("ETH SHORT, RSI 1h"));
  assert.ok(buy && sell);
  assert.equal(buy.props.className, "card long active");
  assert.equal(sell.props.className, "card short active");
  const buyHtml = renderToStaticMarkup(buy);
  assert.match(buyHtml, /BTC<small>\/USD<\/small>/);
  assert.match(buyHtml, /CCI<b>15m<\/b>/);
  assert.match(buyHtml, /67,111\.25/);
  assert.match(buyHtml, /USD · price at signal/);
  assert.match(renderToStaticMarkup(sell), /3,333\.33/);
  assert.doesNotMatch(rendered.html(), /67,543\.21|3,456\.78/);
  assert.match(tickerCss, /\.long\s*\{[^}]*border-top-color:\s*#74ebae/);
  assert.match(tickerCss, /\.short\s*\{[^}]*color:\s*#ff9699/);
  assert.match(rendered.html(), /green\/red indicates direction, not profit/);
});

test("signal and price timestamps use the selected timezone while UTC machine timestamps stay intact", () => {
  const fixture = tickerFixtureSnapshot();
  const before = JSON.stringify(fixture);
  for (const zone of ["America/New_York", "Europe/Paris", "UTC"]) {
    const html = screen({ snapshot: fixture, timeZone: zone }).html();
    assert.ok(html.includes(dependencies["./timezones"].formatTimestamp(iso(THROUGH), zone)));
    assert.match(html, /dateTime="2026-09-16T15:15:00\.000Z"/i);
    assert.ok(html.includes(`timestamps in ${zone}`));
  }
  assert.match(screen().html(), /2026-09-16 11:15:00 UTC-04:00/);
  assert.equal(JSON.stringify(fixture), before);
});

test("active latest-close, active recent and historical XGB cards are visibly distinct", () => {
  const html = screen().html();
  assert.match(html, /Active · latest close/);
  assert.match(html, /Active · recent/);
  assert.match(html, /Historical · not active/);
  const historical = cards(screen().tree()).find((node) => node.props["aria-label"].startsWith("BTC SHORT, STC 4h, historical"));
  assert.equal(historical.props.className, "card short historical");
  assert.match(renderToStaticMarkup(historical), /XGB/);
  assert.doesNotMatch(renderToStaticMarkup(historical), /Active ·/);
  assert.match(html, /<strong>2<\/strong> active \/ 4 signals in 36h/);
});

test("unavailable-price historical cards never show a fabricated current value or active badge", () => {
  const xrp = cards(screen().tree()).find((node) => node.props["aria-label"].startsWith("XRP LONG, MFI 1d"));
  const html = renderToStaticMarkup(xrp);
  assert.match(html, /Unavailable<small>signal price not verified/);
  assert.match(html, /Signal candle close · price not verified/);
  assert.match(html, /Historical · not active/);
  assert.doesNotMatch(html, /0\.789|latest 15m close|Active ·/);
});

test("partial scans expose evaluated, unavailable and pending coverage; empty scans do not imply a neutral market", () => {
  const partial = tickerFixtureSnapshot();
  partial.status = "scanning";
  partial.assets = [partial.assets[0], partial.assets[2]];
  const partialHtml = screen({ snapshot: partial }).html();
  assert.match(partialHtml, /Scanning 2\/3 assets/);
  assert.match(partialHtml, /1 fresh · 1 unavailable · 0 stale · 1 pending/);
  assert.match(partialHtml, /Next 15m scan 14:10/);
  const empty = tickerFixtureSnapshot();
  for (const asset of empty.assets) {
    asset.history = [];
    asset.results = asset.results.map((row) => ({ ...row, status: "no_raw_signal", current_signal: "NONE", recent_signal: null, latest_raw_event: null, admission: null }));
  }
  const html = screen({ snapshot: empty }).html();
  assert.match(html, /No accepted signals in the last 36 hours/);
  assert.match(html, /Unavailable data is not a neutral market signal/);
  assert.equal(cards(screen({ snapshot: empty }).tree()).length, 0);
  assert.match(screen({ snapshot: null }).html(), /Scanning the frozen universe/);
});

test("offline errors show no cards and never assert an old cached signal as active", () => {
  const view = screen({ snapshot: null, error: "Market feed unavailable. No cached signal is asserted as active." });
  assert.equal(cards(view.tree()).length, 0);
  assert.match(view.html(), /Signal wire offline/);
  assert.match(view.html(), /No cached signal is asserted as active/);
  assert.match(view.html(), /class="offlineDot"/);
});

test("pause/resume toggles real state and selecting a card reports its exact asset and entry ID", () => {
  const selected = [];
  const view = screen({ onSelect: (...values) => selected.push(values) });
  assert.doesNotMatch(view.html(), /Bitcoin ticker steering wheel/);
  let pause = nodes(view.tree(), (node) => node.type === "button" && node.props.children === "Pause ticker")[0];
  assert.equal(pause.props["aria-pressed"], false);
  pause.props.onClick();
  assert.match(view.html(), /class="viewport paused"/);
  assert.match(view.html(), /Bitcoin ticker steering wheel/);
  assert.match(view.html(), /Hold the gold handle/);
  pause = nodes(view.tree(), (node) => node.type === "button" && node.props.children === "Resume ticker")[0];
  assert.equal(pause.props["aria-pressed"], true);
  pause.props.onClick();
  assert.doesNotMatch(view.html(), /class="viewport paused"/);
  assert.doesNotMatch(view.html(), /Bitcoin ticker steering wheel/);
  cards(view.tree()).find((node) => node.props["aria-label"].startsWith("ETH SHORT")).props.onClick();
  assert.deepEqual(selected, [["ETH", "fixture-eth-rsi-60"]]);
});

test("marquee duplicates are aria-hidden and excluded from tab order; reduced motion disables animation", () => {
  const tree = screen().tree();
  const groups = nodes(tree, (node) => node.props?.className === "group");
  assert.equal(groups.length, 2);
  assert.equal(groups[0].props["aria-hidden"], undefined);
  assert.equal(groups[1].props["aria-hidden"], "true");
  assert.equal(cards(groups[0]).length, 4);
  assert.equal(cards(groups[1], true).length, 4);
  assert.ok(nodes(groups[1], (node) => node.type === "button").every((node) => node.props.tabIndex === -1));
  assert.match(tickerCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*animation:\s*none/);
  assert.match(tickerCss, /\.group\[aria-hidden="true"\]\s*\{\s*display:\s*none/);
  assert.match(tickerCss, /\.paused \.track[^{]*\{\s*animation-play-state:\s*paused/);
});

test("a signal exactly36 hours old remains historical; one millisecond older disappears from the UI", () => {
  const fixture = tickerFixtureSnapshot();
  const decision = NOW - 36 * 60 * 60_000;
  fixture.assets = [fixture.assets[0]];
  fixture.assets[0].results = [];
  fixture.assets[0].history = [fixtureHistory("BTC", 0, "BUY", decision), fixtureHistory("BTC", 1, "SELL", decision - 1)];
  const view = screen({ snapshot: fixture });
  assert.equal(cards(view.tree()).length, 1);
  assert.equal(cards(view.tree())[0].props.className, "card long historical");
  assert.match(view.html(), /0<\/strong> active \/ 1 signals in 36h/);
  assert.equal(cards(screen({ snapshot: fixture, now: NOW + 1 }).tree()).length, 0);
});

test("standalone preview clearly labels synthetic evidence and embeds actual responsive CSS", () => {
  const html = tickerPreviewHtml();
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /UI TEST FIXTURE — NOT LIVE SIGNALS/);
  assert.match(html, /Invented prices and events/);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.ok(html.includes(tickerCss));
  assert.match(html, /class="viewport paused"/);
  assert.doesNotMatch(html, /<script\b|<link\b/);
});
