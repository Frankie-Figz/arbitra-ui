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

test("server-renders the focused daily-long workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /Arbitra Daily Longs/);
  assert.match(html, /Long setups,/);
  assert.match(html, /Pick a methodology/);
  assert.match(html, /Pullback \/ target matrix/);
  assert.match(html, /Company profile/);
  assert.match(html, /Yahoo Finance/);
  assert.match(html, /SMC \+ PPO/);
  assert.match(html, /CLMT/);
  assert.match(html, /type="date"/);
  assert.doesNotMatch(html, /Biblical basket registry|Research Observatory/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("ships exact-date signals and a matrix for every methodology", async () => {
  const snapshot = JSON.parse(
    await readFile(new URL("public/data/arbitra-snapshot.json", root), "utf8"),
  );
  assert.equal(snapshot.schemaVersion, 3);
  assert.equal(snapshot.deploymentAllowed, false);
  assert.deepEqual(
    snapshot.methodologies.map((methodology) => methodology.id),
    ["smc-ppo", "smc-ppo-atr10", "smc-ppo-atr10-bb40", "smc-ppo-atr10-ema20"],
  );
  assert.equal(snapshot.matrices.length, snapshot.methodologies.length);
  assert.ok(snapshot.matrices.every((matrix) => matrix.cells.length === 100));

  const august10 = snapshot.datasets.find((dataset) => dataset.date === "2026-08-10");
  assert.ok(august10);
  assert.deepEqual(
    august10.assets.map((asset) => asset.symbol).sort(),
    ["CLMT", "LFST", "OGN", "OMDA"],
  );
  assert.ok(august10.assets.every((asset) => asset.signalDate === august10.date));
  assert.ok(august10.assets.every((asset) => asset.methodologies.includes("smc-ppo")));
  assert.equal(
    august10.assets.filter((asset) => asset.methodologies.includes("smc-ppo-atr10")).length,
    0,
  );

  assert.equal(snapshot.datasets.length, 41);
  assert.equal(snapshot.datasets.at(-1).date, "2026-07-01");
  assert.equal(snapshot.history.startDate, "2026-07-01");
  assert.equal(snapshot.history.entryWindowCompletedCandles, 5);
  assert.equal(snapshot.history.targetWindowCompletedCandlesAfterFill, 20);
  assert.equal(snapshot.profiles.CLMT.source, "Yahoo Finance");
  assert.ok(snapshot.profiles.CLMT.description.length > 100);

  const maturedAssets = snapshot.datasets.flatMap((dataset) =>
    dataset.assets.filter((asset) => asset.evaluationMature),
  );
  assert.ok(maturedAssets.length > 0);
  assert.ok(maturedAssets.every((asset) => asset.realizedOutcomes.length === 100));
  assert.ok(
    maturedAssets.every((asset) =>
      asset.realizedOutcomes.every(
        (outcome) => typeof outcome.filled === "boolean" && typeof outcome.targetHit === "boolean",
      ),
    ),
  );
});
