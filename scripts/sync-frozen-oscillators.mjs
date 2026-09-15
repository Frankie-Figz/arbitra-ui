// Dedicated sync: never rewrites the user's market snapshots or exposes native models.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FROZEN_BUNDLE_ID } from "./frozen-oscillator-proxy.mjs";

export const CATALOG_SHA256 = "171e295aba853b8eeb9ebb12a9c41e05e1bb15be8572b4c41aa11e6622deea91";
const uiRoot = fileURLToPath(new URL("../", import.meta.url));

/** Authenticate a catalog without updating market data or requiring private models. */
export async function verifyFrozenCatalog(path = resolve(uiRoot, "public/data/frozen-oscillator-catalog.json")) {
  const bytes = await readFile(path);
  if (createHash("sha256").update(bytes).digest("hex") !== CATALOG_SHA256) throw new Error("Frozen catalog hash mismatch");
  const catalog = JSON.parse(bytes.toString("utf8"));
  if (catalog.bundleId !== FROZEN_BUNDLE_ID || catalog.schemaVersion !== 1 || catalog.deploymentAllowed !== false || catalog.liveInferenceEnabled !== false || catalog.summary.entries !== 230 || catalog.assets.length !== 23) throw new Error("Unexpected frozen catalog contract");
  return { bytes, summary: { bundleId: catalog.bundleId, assets: catalog.assets.length, entries: catalog.summary.entries, sha256: CATALOG_SHA256, nativeModelsCopiedToPublic: 0 } };
}

export async function syncFrozenCatalog({ bundle = resolve(process.env.ARBITRA_OSCILLATOR_BUNDLE ?? resolve(uiRoot, "../Arbitra/artifacts/oscillator-frozen-catalog-v1/20260913-mixed-top10")), output = resolve(uiRoot, "public/data/frozen-oscillator-catalog.json") } = {}) {
  const { bytes, summary } = await verifyFrozenCatalog(resolve(bundle, "catalog.json"));
  await writeFile(output, bytes);
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(process.argv.includes("--check") ? (await verifyFrozenCatalog()).summary : await syncFrozenCatalog(), null, 2));
}
