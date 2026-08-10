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

test("server-renders the Arbitra observatory", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /Arbitra Research Observatory/);
  assert.match(html, /Biblical basket registry/);
  assert.match(html, /One model\. One target cell\. Full provenance\./);
  assert.match(html, /David/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("ships a complete, objective-aware snapshot", async () => {
  const snapshot = JSON.parse(
    await readFile(new URL("public/data/arbitra-snapshot.json", root), "utf8"),
  );
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.families.length, 18);
  assert.equal(snapshot.cells.length, 144);
  assert.equal(snapshot.jacob.length, 4);
  assert.equal(snapshot.families.find((family) => family.id === "david").coverage, "full");
  assert.equal(snapshot.families.find((family) => family.id === "jacob").mode, "hazard");
  assert.equal(snapshot.families.find((family) => family.id === "ichimoku").coverage, "registry");
});
