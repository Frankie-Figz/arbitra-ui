import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

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

test("server-renders indicator-led market workspaces without internal operations UI", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /Arbitra Market Signals/);
  assert.match(html, /Setups,/);
  assert.match(html, /Daily stock opportunities/);
  assert.match(html, /Indicator-lit setups/);
  assert.match(html, /Reference trade setup/);
  assert.match(html, /3 of 4 indicators lit/);
  assert.match(html, /Company profile/);
  assert.match(html, /Yahoo Finance/);
  assert.match(html, /SMC \+ PPO/);
  assert.match(html, /MSGS/);
  assert.match(html, /aria-label="Signal date"/);
  assert.match(html, /aria-label="Eligible asset"/);
  assert.match(html, /open company detail/);
  assert.match(html, /ETF opportunities/);
  assert.match(html, /Suggested setup after Godmode \+ MFI agree/);
  assert.match(html, /Past Godmode ETF opportunities/);
  assert.match(html, /MFI add-on/);
  assert.match(html, /Prospective tradability screening is not an ETF eligibility gate/);
  assert.match(html, /Crypto opportunities/);
  assert.match(html, /RSI divergence \+ EMA contraction/);
  assert.match(html, /Godmode confirmed transitions/);
  assert.match(html, /Suggested setup after both signals agree/);
  assert.match(html, /Past RSI \/ EMA opportunities/);
  assert.match(html, /Add-on met/);
  assert.match(html, /Without add-on/);
  assert.match(html, /No active short right now|active signal/);
  assert.match(html, /research only · no capital authority/);
  assert.match(html, /<option value="2026-07-28">/);
  assert.doesNotMatch(html, /<option value="2026-08-09">/);
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
  const august11 = snapshot.datasets.find((dataset) => dataset.date === "2026-08-11");
  assert.ok(august11);
  assert.deepEqual(
    august11.assets.map((asset) => asset.symbol),
    ["MPC", "VLO", "ARMK"],
  );
  assert.ok(august11.assets[0].atr10Pass && august11.assets[0].bb40Pass && august11.assets[0].ema20Pass);
  assert.ok(august11.assets[1].atr10Pass && august11.assets[1].bb40Pass && august11.assets[1].ema20Pass);
  assert.equal(august11.assets[2].atr10Pass, false);
  assert.equal(august11.assets[2].bb40Pass, false);
  assert.equal(august11.assets[2].ema20Pass, true);

  const august10 = snapshot.datasets.find((dataset) => dataset.date === "2026-08-10");
  assert.ok(august10);
  assert.deepEqual(
    august10.assets.map((asset) => asset.symbol).sort(),
    ["CLMT", "LFST", "OGN", "OMDA"],
  );
  assert.ok(august10.assets.every((asset) => asset.signalDate === august10.date));
  assert.equal(august10.assets.filter((asset) => asset.atr10Pass).length, 0);

  assert.equal(snapshot.datasets.length, 44);
  const validTradeDates = snapshot.datasets.filter((dataset) => dataset.assets.length > 0).slice(0, 30);
  assert.ok(validTradeDates.length <= 30);
  assert.ok(validTradeDates.every((dataset) => dataset.assets.length > 0));
  assert.equal(snapshot.datasets.at(-1).date, "2026-07-01");
  assert.equal(snapshot.history.startDate, "2026-07-01");
  assert.equal(snapshot.history.entryWindowCompletedCandles, 5);
  assert.equal(snapshot.history.targetWindowCompletedCandlesAfterFill, 20);
  assert.equal(snapshot.profiles.CLMT.source, "Yahoo Finance");
  assert.ok(snapshot.profiles.CLMT.description.length > 100);

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
