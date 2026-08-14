import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function requiredEnvironment(environment, name) {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required for artifact downloads`);
  return value;
}

export function createBucketArtifactSigner(environment = process.env) {
  const endpoint = requiredEnvironment(environment, "BUCKET_ENDPOINT");
  const parsedEndpoint = new URL(endpoint);
  if (parsedEndpoint.protocol !== "https:") {
    throw new Error("BUCKET_ENDPOINT must use HTTPS for artifact downloads");
  }
  const region = environment.BUCKET_REGION || "auto";
  const bucket = requiredEnvironment(environment, "BUCKET_NAME");
  const client = new S3Client({
    endpoint,
    region,
    forcePathStyle: environment.BUCKET_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: requiredEnvironment(environment, "BUCKET_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnvironment(environment, "BUCKET_SECRET_ACCESS_KEY"),
    },
  });
  return async (key, label) => getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${String(label).replace(/[\r\n"\\/]/g, "_").slice(0, 120)}"`,
    }),
    { expiresIn: 15 * 60 },
  );
}
