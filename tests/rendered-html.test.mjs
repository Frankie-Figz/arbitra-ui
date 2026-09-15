import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;",
})[character]);
const indicatorCount = (asset) => 1 + Number(asset.atr10Pass) + Number(asset.bb40Pass) + Number(asset.ema20Pass);

function selectOptions(html, label) {
  const select = new RegExp(`<select\\b[^>]*aria-label="${label}"[^>]*>([\\s\\S]*?)<\\/select>`).exec(html);
  assert.ok(select, `Missing ${label} selector`);
  return [...select[1].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map((match) => ({
    value: /\bvalue="([^"]*)"/.exec(match[1])?.[1],
    selected: /\bselected(?:=""|\s|$)/.test(match[1]),
    text: match[2].replace(/<!--[\s\S]*?-->/g, "").trim(),
  }));
}

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Stock Picker with one Crypto Scanner destination", async () => {
  const snapshot = JSON.parse(await readFile(new URL("public/data/arbitra-snapshot.json", root), "utf8"));
  const tradeDatasets = snapshot.datasets.filter((dataset) => dataset.assets.length > 0).slice(0, 30);
  assert.ok(tradeDatasets.length > 0, "The bundled fixture must contain a stock signal date");
  const selectedDataset = tradeDatasets[0];
  const selectedAsset = selectedDataset.assets[0];
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /Arbitra Market Signals/);
  assert.match(html, /Setups,/);
  assert.match(html, /Daily stock opportunities/);
  assert.match(html, /Indicator-lit setups/);
  assert.match(html, /Reference trade setup/);
  assert.match(html, /Company profile/);
  assert.match(html, /Yahoo Finance/);
  assert.match(html, /SMC \+ PPO/);
  assert.match(html, /aria-label="Signal date"/);
  assert.match(html, /aria-label="Eligible asset"/);
  assert.match(html, /open company detail/);
  const dateOptions = selectOptions(html, "Signal date");
  assert.deepEqual(dateOptions.map((option) => option.value), tradeDatasets.map((dataset) => dataset.date));
  assert.deepEqual(dateOptions.filter((option) => option.selected).map((option) => option.value), [selectedDataset.date]);
  for (const [index, dataset] of tradeDatasets.entries()) {
    assert.ok(dateOptions[index].text.endsWith(`— ${dataset.assets.length} setup${dataset.assets.length === 1 ? "" : "s"}`));
  }
  const assetOptions = selectOptions(html, "Eligible asset");
  assert.deepEqual(assetOptions.map((option) => option.value), selectedDataset.assets.map((asset) => escapeHtml(asset.symbol)));
  assert.deepEqual(assetOptions.filter((option) => option.selected).map((option) => option.value), [escapeHtml(selectedAsset.symbol)]);
  const cardLabels = [...html.matchAll(/aria-label="([^"]* of 4 indicators lit, open company detail)"/g)].map((match) => match[1]);
  assert.deepEqual(cardLabels, selectedDataset.assets.map((asset) => escapeHtml(`${asset.symbol}, ${indicatorCount(asset)} of 4 indicators lit, open company detail`)));
  assert.ok(html.includes(`<span>Current setups</span><strong>${selectedDataset.assets.length}</strong>`));
  assert.ok(html.includes(`<span>Full confirmation</span><strong>${selectedDataset.assets.filter((asset) => indicatorCount(asset) === 4).length}</strong>`));
  assert.ok(html.includes(`<span>Parent only</span><strong>${selectedDataset.assets.filter((asset) => indicatorCount(asset) === 1).length}</strong>`));
  const profile = snapshot.profiles[selectedAsset.symbol];
  if (profile?.available) assert.ok(html.includes(escapeHtml(profile.longName)));
  const navigation = /<nav aria-label="Market sections">([\s\S]*?)<\/nav>/.exec(html)?.[1];
  assert.ok(navigation);
  assert.equal((navigation.match(/<a\b/g) ?? []).length, 2);
  assert.match(navigation, /href="\/" aria-current="page">Stock Picker<\/a>/);
  assert.match(navigation, /href="\/oscillators">Crypto Scanner<\/a>/);
  assert.doesNotMatch(html, /id="(?:etf-opportunities|crypto-opportunities|oscillator-watch)"/);
  assert.doesNotMatch(html, /ETF opportunities|Crypto opportunities|Oscillator alpha watch|Godmode confirmed transitions/);
  assert.match(html, /research only · no capital authority/);
  assert.match(html, /Indicator states are causal/);
  assert.match(html, /completed candles only/);
  assert.match(html, /No order authority/);
  assert.match(html, /An unlit add-on never removes the parent opportunity/);
  assert.doesNotMatch(html, /Biblical basket registry|Research Observatory/);
  assert.doesNotMatch(html, /Historical data acquisition|Elijah&#x27;s Ravens|Data jobs|Call the champions|XGB champions/);
  assert.doesNotMatch(html, /Pullback \/ target matrix|Forecast probability/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("ships exact-date stock signals with complementary indicator states", async () => {
  const snapshot = JSON.parse(
    await readFile(new URL("public/data/arbitra-snapshot.json", root), "utf8"),
  );
  assert.equal(snapshot.schemaVersion, 6);
  assert.equal(snapshot.deploymentAllowed, false);
  assert.equal(snapshot.stockSelector.status, "legacy_snapshot");
  assert.equal(snapshot.stockSelector.deploymentAllowed, false);
  assert.equal(snapshot.stockSelector.ordersSubmitted, 0);
  assert.ok(snapshot.stockSelector.universe >= 5000);
  const historyStart = Date.parse(`${snapshot.history.startDate}T00:00:00Z`);
  const historyEnd = Date.parse(`${snapshot.history.endDate}T00:00:00Z`);
  assert.ok(Number.isFinite(historyStart) && Number.isFinite(historyEnd) && historyEnd >= historyStart);
  // The bundled daily-history contract includes empty calendar dates as well as
  // signal dates. Derive its exact extent from the declared window, not a vintage.
  const expectedDates = Array.from({ length: (historyEnd - historyStart) / 86_400_000 + 1 }, (_, index) =>
    new Date(historyEnd - index * 86_400_000).toISOString().slice(0, 10));
  assert.deepEqual(snapshot.datasets.map((dataset) => dataset.date), expectedDates);
  for (const dataset of snapshot.datasets) {
    assert.ok(Array.isArray(dataset.assets));
    assert.equal(new Set(dataset.assets.map((asset) => asset.symbol)).size, dataset.assets.length);
    for (const asset of dataset.assets) {
      assert.equal(asset.signalDate, dataset.date, `${asset.symbol} must belong to the exact signal date`);
      for (const indicator of ["atr10Pass", "bb40Pass", "ema20Pass"]) assert.equal(typeof asset[indicator], "boolean");
      assert.ok(asset.methodologies.includes("smc-ppo"), "Unlit complementary indicators must not remove the parent setup");
    }
  }
  const validTradeDates = snapshot.datasets.filter((dataset) => dataset.assets.length > 0).slice(0, 30);
  assert.equal(validTradeDates.length, Math.min(30, snapshot.datasets.filter((dataset) => dataset.assets.length > 0).length));
  assert.ok(validTradeDates.length > 0);
  assert.ok(validTradeDates.every((dataset) => dataset.assets.length > 0));
  assert.equal(snapshot.history.entryWindowCompletedCandles, 5);
  assert.equal(snapshot.history.targetWindowCompletedCandlesAfterFill, 20);
  assert.equal(snapshot.history.unfilledTargetMarkWindowCompletedCandles, 25);
  const availableProfiles = Object.values(snapshot.profiles).filter((profile) => profile.available);
  assert.ok(availableProfiles.length > 0);
  assert.ok(availableProfiles.every((profile) => profile.source === "Yahoo Finance"));
  assert.ok(availableProfiles.some((profile) => typeof profile.description === "string" && profile.description.length > 100));

  assert.ok(snapshot.etf);
  assert.equal(snapshot.etf.deploymentAllowed, false);
  assert.equal(snapshot.etf.capitalAuthority, false);
  assert.equal(snapshot.etf.etfProspectiveTradabilityGateEnabled, false);
  assert.equal(snapshot.etf.basicCandleIntegrityGateEnabled, true);
  assert.equal(snapshot.etf.mfiAddOnRequiredForParentSignal, false);
  assert.equal(snapshot.etf.universeSymbols, 10);
  assert.equal(snapshot.etf.usableHistory, 10);
  assert.equal(snapshot.etf.historyWindowSessions, 252);
  assert.equal(snapshot.etf.latestStates.length, 10);
  assert.ok(snapshot.etf.opportunities.length > 0);
  assert.ok(snapshot.etf.opportunities.every((opportunity) => typeof opportunity.mfiAddOnMet === "boolean"));
  assert.ok(
    snapshot.etf.opportunities.every(
      (opportunity) =>
        opportunity.orderState === "awaiting_next_open" ||
        (typeof opportunity.entryPrice === "number" &&
          typeof opportunity.targetPrice === "number" &&
          opportunity.targetPrice > opportunity.entryPrice),
    ),
  );
  assert.equal(snapshot.etf.referenceOutcome.horizonCandles, 2);
  assert.equal(snapshot.etf.referenceOutcome.barrierBps, 100);
  assert.equal(snapshot.etf.referenceOutcome.modeledStop, null);
  assert.equal(snapshot.etf.evidence.parentBarrierEdgePercentagePoints, 17.1);
  assert.equal(snapshot.etf.evidence.mfiBarrierChangePercentagePoints, 3.14);

  assert.ok(snapshot.crypto);
  assert.equal(snapshot.crypto.deploymentAllowed, false);
  assert.equal(snapshot.crypto.capitalAuthority, false);
  assert.equal(snapshot.crypto.venue, "okx");
  assert.equal(snapshot.crypto.marketType, "spot");
  assert.equal(snapshot.crypto.schemaVersion, 3);
  assert.equal(snapshot.crypto.historyWindowHours, 168);
  assert.equal(snapshot.crypto.cryptoTradabilityGateEnabled, false);
  assert.ok(snapshot.crypto.universe.considered > 250);
  assert.ok(snapshot.crypto.universe.usableHistory > 0);
  assert.deepEqual(
    {
      timeframe: snapshot.crypto.rsi.setup.timeframe,
      rsiPeriod: snapshot.crypto.rsi.setup.rsiPeriod,
      emaFast: snapshot.crypto.rsi.setup.emaFast,
      emaSlow: snapshot.crypto.rsi.setup.emaSlow,
    },
    { timeframe: "3h", rsiPeriod: 15, emaFast: 8, emaSlow: 30 },
  );
  assert.deepEqual(snapshot.crypto.rsi.recentCandidates, []);
  assert.ok(snapshot.crypto.rsi.history.length > 0);
  assert.ok(snapshot.crypto.rsi.history.some((candidate) => candidate.godmodeAddOnMet));
  assert.ok(snapshot.crypto.rsi.history.some((candidate) => !candidate.godmodeAddOnMet));
  assert.ok(snapshot.crypto.rsi.history.every((candidate) => candidate.orders.length === 6));
  assert.ok(
    snapshot.crypto.rsi.history.every((candidate) =>
      candidate.orders.every(
        (order) =>
          typeof order.plannedEntryPrice === "number" &&
          typeof order.plannedExitPrice === "number" &&
          order.plannedExitPrice < order.plannedEntryPrice,
      ),
    ),
  );
  assert.ok(
    snapshot.crypto.rsi.history
      .filter((candidate) => candidate.suggestedSetupEligible)
      .every((candidate) => candidate.godmodeAddOnMet),
  );
  assert.ok(
    snapshot.crypto.rsi.history.some(
      (candidate) => candidate.suggestedSetupEligible && !candidate.tradabilityPass,
    ),
  );
  assert.equal(snapshot.crypto.godmodeAddOn.lookbackCompletedHours, 6);
  assert.equal(snapshot.crypto.godmodeAddOn.requiredForParentRsiSetup, false);
  assert.equal(snapshot.crypto.suggestedTradeSetup.pushPercent, 1);
  assert.equal(snapshot.crypto.suggestedTradeSetup.targetPercentBelowFill, 2);
  assert.equal(snapshot.crypto.suggestedTradeSetup.orderAuthority, false);
  assert.equal(snapshot.crypto.suggestedTradeSetup.tradabilityQualityGateRequired, false);
  assert.ok(snapshot.crypto.godmode.current.every((opportunity) => !opportunity.deploymentAllowed));
  assert.ok(snapshot.crypto.godmode.current.every((opportunity) => ["long", "short"].includes(opportunity.direction)));

  const maturedAssets = snapshot.datasets.flatMap((dataset) =>
    dataset.assets.filter((asset) => asset.evaluationMature),
  );
  assert.ok(maturedAssets.length > 0);
  assert.ok(maturedAssets.every((asset) => asset.realizedOutcomes.length === 100));
  assert.ok(
    maturedAssets.every((asset) =>
      asset.realizedOutcomes.every(
        (outcome) =>
          typeof outcome.filled === "boolean" &&
          typeof outcome.targetHit === "boolean" &&
          typeof outcome.targetMarkHit === "boolean" &&
          typeof outcome.targetMarkPrice === "number",
      ),
    ),
  );
  assert.ok(
    maturedAssets.some((asset) =>
      asset.realizedOutcomes.some((outcome) => !outcome.filled && outcome.targetMarkHit),
    ),
  );
});
