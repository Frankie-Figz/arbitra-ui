import { bearerAuthorized, jsonResponse, routeParts } from "./data-jobs.mjs";

export const OASIS_CATALOG_PATH = "/api/data-catalog/v1";
const RECORD_ID_PATTERN = /^oasis\.record\.v1\.[0-9a-f]{64}$/;
const EVIDENCE_ID_PATTERN = /^oasis\.upstream-evidence\.v1\.[0-9a-f]{64}$/;

function limitFrom(url) {
  const value = Number(url.searchParams.get("limit") ?? 50);
  return Number.isSafeInteger(value) && value >= 1 && value <= 100 ? value : null;
}

export function createOasisCatalogHandler({ store, adminToken, signArtifact }) {
  if (!store) throw new Error("Oasis PostgreSQL catalog store is required");

  return async function oasisCatalogResponse(request) {
    const url = new URL(request.url);
    const parts = routeParts(url.pathname, OASIS_CATALOG_PATH);
    if (parts === null) return null;
    if (request.method !== "GET" && request.method !== "HEAD") {
      return jsonResponse({ status: "method_not_allowed" }, 405, { allow: "GET, HEAD" });
    }
    if (parts.length === 1 && parts[0] === "health") {
      try {
        const readiness = await store.readiness();
        return jsonResponse(
          { schemaVersion: 1, contractId: "data-oasis-v1", ...readiness },
          readiness.ready ? 200 : 503,
        );
      } catch {
        return jsonResponse(
          { schemaVersion: 1, contractId: "data-oasis-v1", ready: false },
          503,
        );
      }
    }
    if (!bearerAuthorized(request, adminToken)) {
      return jsonResponse({ status: "unauthorized" }, 401, { "www-authenticate": "Bearer" });
    }
    try {
      if (parts.length === 1 && parts[0] === "datasets") {
        const limit = limitFrom(url);
        if (limit === null) return jsonResponse({ status: "rejected", error: "limit is invalid" }, 422);
        const after = url.searchParams.get("after");
        if (after !== null && !RECORD_ID_PATTERN.test(after)) {
          return jsonResponse({ status: "rejected", error: "after cursor is invalid" }, 422);
        }
        const datasets = await store.listDatasets({ limit, after });
        return jsonResponse({
          schemaVersion: 1,
          contractId: "data-oasis-v1",
          datasets,
          nextAfter: datasets.length === limit ? datasets.at(-1).record_id : null,
        });
      }
      if (parts.length >= 2 && parts[0] === "datasets") {
        if (!RECORD_ID_PATTERN.test(parts[1])) return jsonResponse({ status: "not_found" }, 404);
        if (parts.length === 2) {
          const record = await store.getDataset(parts[1]);
          return record
            ? jsonResponse({ schemaVersion: 1, contractId: "data-oasis-v1", ...record })
            : jsonResponse({ status: "not_found" }, 404);
        }
        if (parts.length === 3 && parts[2] === "download") {
          if (typeof signArtifact !== "function") {
            return jsonResponse({ status: "storage_unavailable" }, 503);
          }
          const locator = await store.latestDownloadLocator(parts[1]);
          if (!locator) return jsonResponse({ status: "not_found" }, 404);
          const signedUrl = await signArtifact(locator.object_key, locator.dataset_version_id);
          return jsonResponse({ url: signedUrl, expiresInSeconds: 15 * 60 });
        }
      }
      if (parts.length === 1 && parts[0] === "experiments") {
        return jsonResponse({
          schemaVersion: 1,
          contractId: "data-oasis-v1",
          experiments: await store.listExperimentReferences(),
        });
      }
      if (parts.length === 1 && parts[0] === "parameter-locks") {
        return jsonResponse({
          schemaVersion: 1,
          contractId: "data-oasis-v1",
          parameterLocks: await store.listParameterLocks(),
        });
      }
      if (parts.length === 1 && parts[0] === "upstream-evidence") {
        const limit = limitFrom(url);
        if (limit === null) return jsonResponse({ status: "rejected", error: "limit is invalid" }, 422);
        const after = url.searchParams.get("after");
        if (after !== null && !EVIDENCE_ID_PATTERN.test(after)) {
          return jsonResponse({ status: "rejected", error: "after cursor is invalid" }, 422);
        }
        const evidence = await store.listUpstreamEvidence({ limit, after });
        return jsonResponse({
          schemaVersion: 1,
          contractId: "data-oasis-v1",
          upstreamEvidence: evidence,
          nextAfter: evidence.length === limit ? evidence.at(-1).evidence_id : null,
        });
      }
      return jsonResponse({ status: "not_found" }, 404);
    } catch (error) {
      console.error("Oasis catalog query failed", { code: error?.code ?? "unknown" });
      return jsonResponse({ status: "catalog_unavailable" }, 503);
    }
  };
}
