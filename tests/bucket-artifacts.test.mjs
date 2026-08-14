import assert from "node:assert/strict";
import test from "node:test";

import { createBucketArtifactSigner } from "../scripts/bucket-artifacts.mjs";

test("creates a short-lived virtual-hosted Railway bucket download", async () => {
  const sign = createBucketArtifactSigner({
    BUCKET_ENDPOINT: "https://storage.railway.app",
    BUCKET_REGION: "auto",
    BUCKET_NAME: "arbitra-history-test123",
    BUCKET_ACCESS_KEY_ID: "test-access-key",
    BUCKET_SECRET_ACCESS_KEY: "test-secret-key",
  });

  const signed = new URL(await sign("massive/spy/job/manifest.json", "manifest.json"));

  assert.equal(signed.hostname, "arbitra-history-test123.storage.railway.app");
  assert.match(signed.searchParams.get("X-Amz-Signature") ?? "", /^[0-9a-f]{64}$/);
  assert.equal(signed.searchParams.get("X-Amz-Expires"), "900");
  assert.equal(signed.searchParams.has("response-content-disposition"), false);
});

test("rejects a non-TLS bucket endpoint before credentials can be used", () => {
  assert.throws(() => createBucketArtifactSigner({
    BUCKET_ENDPOINT: "http://storage.example",
    BUCKET_NAME: "arbitra-history",
    BUCKET_ACCESS_KEY_ID: "test-access-key",
    BUCKET_SECRET_ACCESS_KEY: "test-secret-key",
  }), /must use HTTPS/);
});
