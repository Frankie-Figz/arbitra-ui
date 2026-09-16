import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createFrozenOscillatorHandler, FROZEN_BUNDLE_ID } from "../scripts/frozen-oscillator-proxy.mjs";
import { CATALOG_SHA256 } from "../scripts/sync-frozen-oscillators.mjs";

const request = (path = "/api/frozen-oscillators/live?asset=ETH", method = "GET") => new Request(`http://ui${path}`, { method });
const valid = { schemaVersion: 1, bundleId: FROZEN_BUNDLE_ID, asset: "ETH", venue: "binance", quote: "USDT", pair: "ETH/USDT", marketType: "spot", historicalVenue: "binance", historicalQuote: "USDT", transferValidation: "same_venue", status: "available", results: [], deploymentAllowed: false, ordersSubmitted: 0 };

test("missing service refuses live output without historical fallbacks", async () => {
  const result = await createFrozenOscillatorHandler()(request());
  assert.equal(result.status, 503);
  assert.deepEqual((await result.json()).results, []);
});
test("proxy ignores unrelated routes and rejects malformed assets and methods", async () => {
  const handler = createFrozenOscillatorHandler();
  assert.equal(await handler(request("/health")), null);
  assert.equal((await handler(request(undefined, "POST"))).status, 405);
  for (const query of ["asset=INVALID", "asset=ETH&asset=BTC", "asset=ETH&url=https://example.com", "asset=../BTC"]) assert.equal((await handler(request(`/api/frozen-oscillators/live?${query}`))).status, 400);
});
test("only configured private origins are allowed", () => {
  for (const serviceUrl of ["https://example.com", "file:///tmp/a", "http://user:secret@localhost", "http://localhost/path", "http://localhost?url=x", "http://service.railway.internal"]) assert.throws(() => createFrozenOscillatorHandler({ serviceUrl }));
});
test("upstream authorization stays server-side and redirects are denied", async () => {
  let options;
  const handler = createFrozenOscillatorHandler({ serviceUrl: "http://worker.railway.internal:8766", token: "private-secret", fetchImpl: async (url, config) => { assert.equal(url, "http://worker.railway.internal:8766/v1/oscillators/live?asset=ETH&venue=binance"); options = config; return Response.json(valid); } });
  const result = await handler(request());
  assert.equal(options.headers.authorization, "Bearer private-secret");
  assert.equal(options.redirect, "error");
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.equal((await result.text()).includes("private-secret"), false);
});
test("wrong bundles, orders and malformed responses fail closed", async () => {
  for (const body of [{ ...valid, bundleId: "wrong" }, { ...valid, asset: "BTC" }, { ...valid, ordersSubmitted: 1 }, { ...valid, deploymentAllowed: true }, { ...valid, results: null }]) {
    const handler = createFrozenOscillatorHandler({ serviceUrl: "http://127.0.0.1:8766", fetchImpl: async () => Response.json(body) });
    assert.equal((await handler(request())).status, 503);
  }
});

test("market-scan shutdown propagates cancellation to the private upstream", async () => {
  const controller = new AbortController();
  let upstreamSignal;
  const handler = createFrozenOscillatorHandler({ serviceUrl: "http://localhost:8766", fetchImpl: async (_url, config) => {
    upstreamSignal = config.signal;
    return new Promise((_resolve, reject) => config.signal.addEventListener("abort", () => reject(config.signal.reason), { once: true }));
  } });
  const pending = handler(new Request("http://ui/api/frozen-oscillators/live?asset=BTC&venue=kraken", { signal: controller.signal }));
  controller.abort();
  assert.equal(upstreamSignal.aborted, true);
  assert.equal((await pending).status, 503);
});
test("provider errors never disclose exceptions or tokens", async () => {
  const handler = createFrozenOscillatorHandler({ serviceUrl: "http://localhost:8766", fetchImpl: async () => { throw new Error("secret and local model paths"); } });
  const result = await handler(request());
  assert.equal(result.status, 503);
  assert.equal((await result.text()).includes("local model paths"), false);
});
test("venue and quote routing is explicit, with no cross-venue response fallback", async () => {
  for (const [venue, quote] of [["binance", "USDT"], ["kraken", "USD"], ["coinbase", "USD"], ["okx", "USDT"]]) {
    let calls = 0;
    const payload = { ...valid, venue, quote, pair: `ETH/${quote}`, transferValidation: venue === "binance" ? "same_venue" : "not_validated" };
    const handler = createFrozenOscillatorHandler({ serviceUrl: "http://localhost:8766", fetchImpl: async (url) => { calls++; assert.equal(new URL(url).searchParams.get("venue"), venue); return Response.json(payload); } });
    const result = await handler(request(`/api/frozen-oscillators/live?asset=ETH&venue=${venue}`));
    assert.equal(result.status, 200);
    assert.equal((await result.json()).pair, `ETH/${quote}`);
    assert.equal(calls, 1);
    for (const mismatch of [{ venue: "other" }, { quote: "USDC" }, { pair: "BTC/USD" }, { marketType: "perpetual" }, { historicalVenue: venue === "binance" ? "kraken" : venue }, { transferValidation: "validated" }]) {
      const wrong = createFrozenOscillatorHandler({ serviceUrl: "http://localhost:8766", fetchImpl: async () => Response.json({ ...payload, ...mismatch }) });
      assert.equal((await wrong(request(`/api/frozen-oscillators/live?asset=ETH&venue=${venue}`))).status, 503);
    }
  }
});
test("unsupported or duplicate venue queries never reach the service", async () => {
  const handler = createFrozenOscillatorHandler({ serviceUrl: "http://localhost:8766", fetchImpl: async () => { throw new Error("Must not be called"); } });
  for (const query of ["venue=other", "venue=", "venue=Kraken", "venue=kraken&venue=okx", "venue=https://example.com"]) {
    assert.equal((await handler(request(`/api/frozen-oscillators/live?asset=ETH&${query}`))).status, 400);
  }
});
test("frozen UI projection exactly matches pinned catalog, with no Williams or public model URLs", async () => {
  const bytes = await readFile(new URL("../public/data/frozen-oscillator-catalog.json", import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), CATALOG_SHA256);
  const catalog = JSON.parse(bytes);
  assert.equal(catalog.assets.length, 23);
  assert.equal(catalog.assets.flatMap((asset) => asset.entries).length, 230);
  for (const asset of catalog.assets) for (const row of asset.entries) {
    assert.notEqual(row.indicator, "williamsr");
    for (const model of Object.values(row.modelByFold)) assert.match(model.path, /^payloads\/[a-f0-9]{64}\//);
  }
});

test("unavailable upstream preserves verified history and warm-up diagnostics", async () => {
  const event = { bundleId: FROZEN_BUNDLE_ID, asset: "ETH", venue: "binance", pair: "ETH/USDT", direction: "BUY",
    evaluationKind: "reconstructed", signalTime: "2026-09-08T00:00:00Z", evaluatedAt: "2026-09-14T00:00:00Z",
    marketCondition: { as_of_utc: "2026-09-08T00:00:00Z" } };
  const body = { ...valid, status: "unavailable", reason: "Needs more history", history: [event], results: [{ current_signal: "NONE", diagnostic_code: "warmup_insufficient" }] };
  const handler = createFrozenOscillatorHandler({ serviceUrl: "http://localhost:8766", fetchImpl: async () => Response.json(body) });
  const result = await handler(request());
  assert.equal(result.status, 503);
  assert.deepEqual(await result.json(), body);
  for (const patch of [{ asset: "BTC" }, { venue: "okx" }, { pair: "ETH/USD" }, { bundleId: "wrong" },
    { signalTime: "2026-09-15T00:00:00Z" }, { marketCondition: { as_of_utc: "2026-09-09T00:00:00Z" } }]) {
    const bad = createFrozenOscillatorHandler({ serviceUrl: "http://localhost:8766", fetchImpl: async () => Response.json({ ...body, history: [{ ...event, ...patch }] }) });
    const rejected = await (await bad(request())).json();
    assert.match(rejected.reason, /Historical signal response did not match/);
    assert.equal(rejected.history, undefined);
  }
});
