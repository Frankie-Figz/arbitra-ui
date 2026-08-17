import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function requiredEnvironment(environment, name) {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required for artifact downloads`);
  return value;
}

// Mirrors _safe_platform_url in arbitra_elijah_worker.py: plaintext is allowed
// only to a loopback host, so a local S3-compatible store such as MinIO can
// exercise the real presigning path. Every non-loopback endpoint still requires
// HTTPS, so a deployed bucket cannot be reached in plaintext.
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function createBucketArtifactSigner(environment = process.env) {
  const endpoint = requiredEnvironment(environment, "BUCKET_ENDPOINT");
  const parsedEndpoint = new URL(endpoint);
  const loopback = LOOPBACK_HOSTS.has(parsedEndpoint.hostname);
  if (parsedEndpoint.protocol !== "https:" && !(loopback && parsedEndpoint.protocol === "http:")) {
    throw new Error("BUCKET_ENDPOINT must use HTTPS unless it is a loopback address");
  }
  const region = environment.BUCKET_REGION || "auto";
  const bucket = requiredEnvironment(environment, "BUCKET_NAME");
  const client = new S3Client({
    endpoint,
    region,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    forcePathStyle: environment.BUCKET_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: requiredEnvironment(environment, "BUCKET_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnvironment(environment, "BUCKET_SECRET_ACCESS_KEY"),
    },
  });
  return async (key) => getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
    { expiresIn: 15 * 60 },
  );
}
