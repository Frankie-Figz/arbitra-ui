import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { LOOPBACK_HOSTS, loopbackAllowed } from "./runtime-environment.mjs";

function requiredEnvironment(environment, name) {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required for artifact downloads`);
  return value;
}

export function createBucketArtifactSigner(environment = process.env) {
  const endpoint = requiredEnvironment(environment, "BUCKET_ENDPOINT");
  const parsedEndpoint = new URL(endpoint);
  // On Railway this is unchanged: the bucket endpoint must use HTTPS. Off
  // Railway a loopback endpoint may use plaintext, so a local S3-compatible
  // store such as MinIO exercises the real presigning path. A deployed bucket
  // can never be reached in plaintext, and no public host ever may.
  const plaintextAllowed = LOOPBACK_HOSTS.has(parsedEndpoint.hostname) &&
    loopbackAllowed(environment);
  if (parsedEndpoint.protocol !== "https:" &&
      !(plaintextAllowed && parsedEndpoint.protocol === "http:")) {
    throw new Error("BUCKET_ENDPOINT must use HTTPS unless it is a loopback address off Railway");
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
