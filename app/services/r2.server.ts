import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
}

function readR2Config(): R2Config | null {
  const values = {
    accountId: process.env.R2_ACCOUNT_ID?.trim(),
    accessKeyId: process.env.R2_ACCESS_KEY_ID?.trim(),
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY?.trim(),
    bucketName: process.env.R2_BUCKET_NAME?.trim(),
  };
  const present = Object.values(values).filter(Boolean).length;
  if (present === 0) return null;
  if (present !== Object.keys(values).length) {
    throw new Error("Cloudflare R2 is partially configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME.");
  }
  return values as R2Config;
}

let client: S3Client | undefined;

function getClient(config: R2Config): S3Client {
  client ??= new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  return client;
}

export function isR2Configured(): boolean {
  return readR2Config() !== null;
}

export function r2MediaReferenceForKey(key: string): string {
  if (!readR2Config()) throw new Error("Cloudflare R2 is not configured.");
  const url = new URL("/api/media", "https://media.invalid");
  url.searchParams.set("key", key);
  return `r2:${url.search}`;
}

export function r2KeyFromMediaReference(value: string): string | null {
  const config = readR2Config();
  if (!config) return null;
  try {
    const url = value.startsWith("r2:")
      ? new URL(value.slice(3), "https://media.invalid")
      : new URL(value, "https://media.invalid");
    if (!value.startsWith("r2:") && url.pathname !== "/api/media") return null;
    const key = url.searchParams.get("key") || "";
    const parts = key.split("/");
    if (parts.length < 2 || parts.length > 6
      || parts.slice(0, -1).some((part) => !/^[A-Za-z0-9_-]{1,80}$/.test(part))
      || !/^[a-f0-9]{64}(?:_thumb)?\.[A-Za-z0-9]{1,10}$/i.test(parts.at(-1) || "")) return null;
    return key;
  } catch {
    return null;
  }
}

export async function putR2Object({
  key,
  body,
  contentType,
  cacheControl = "public, max-age=31536000, immutable",
  ifNoneMatch,
}: {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
  cacheControl?: string;
  ifNoneMatch?: "*";
}): Promise<void> {
  const config = readR2Config();
  if (!config) throw new Error("Cloudflare R2 is not configured.");
  await getClient(config).send(new PutObjectCommand({
    Bucket: config.bucketName,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: cacheControl,
    IfNoneMatch: ifNoneMatch,
  }));
}

export async function readR2Object(key: string): Promise<Buffer> {
  const config = readR2Config();
  if (!config) throw new Error("Cloudflare R2 is not configured.");
  const result = await getClient(config).send(new GetObjectCommand({ Bucket: config.bucketName, Key: key }));
  if (!result.Body) throw new Error("Cloudflare R2 returned an empty object body.");
  return Buffer.from(await result.Body.transformToByteArray());
}

export async function getR2ObjectResponse(key: string, range?: string): Promise<{
  body: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength?: number;
  contentRange?: string;
  etag?: string;
  partial: boolean;
}> {
  const config = readR2Config();
  if (!config) throw new Error("Cloudflare R2 is not configured.");
  const result = await getClient(config).send(new GetObjectCommand({
    Bucket: config.bucketName,
    Key: key,
    ...(range ? { Range: range } : {}),
  }));
  if (!result.Body) throw new Error("Cloudflare R2 returned an empty object body.");
  return {
    body: result.Body.transformToWebStream(),
    contentType: result.ContentType || "application/octet-stream",
    contentLength: result.ContentLength,
    contentRange: result.ContentRange,
    etag: result.ETag,
    partial: Boolean(result.ContentRange),
  };
}

export async function deleteR2Object(key: string): Promise<void> {
  const config = readR2Config();
  if (!config) return;
  await getClient(config).send(new DeleteObjectCommand({ Bucket: config.bucketName, Key: key }));
}

export async function verifyR2Object(key: string, expectedSize?: number): Promise<boolean> {
  const config = readR2Config();
  if (!config) throw new Error("Cloudflare R2 is not configured.");
  try {
    const result = await getClient(config).send(new HeadObjectCommand({ Bucket: config.bucketName, Key: key }));
    return expectedSize === undefined || result.ContentLength === expectedSize;
  } catch (error) {
    if (error && typeof error === "object") {
      const details = error as { name?: unknown; Code?: unknown; code?: unknown; $metadata?: { httpStatusCode?: unknown } };
      if (details.$metadata?.httpStatusCode === 404 || details.name === "NotFound" || details.name === "NoSuchKey" || details.Code === "NoSuchKey" || details.code === "NoSuchKey") return false;
    }
    throw error;
  }
}

export async function createR2PutUrl(key: string, contentType: string, contentLength: number, expiresIn = 300): Promise<string> {
  const config = readR2Config();
  if (!config) throw new Error("Cloudflare R2 is not configured.");
  return getSignedUrl(getClient(config), new PutObjectCommand({
    Bucket: config.bucketName,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
    CacheControl: "no-store",
  }), { expiresIn });
}

export async function getR2ObjectMetadata(key: string): Promise<{ size: number; contentType: string }> {
  const config = readR2Config();
  if (!config) throw new Error("Cloudflare R2 is not configured.");
  const result = await getClient(config).send(new HeadObjectCommand({ Bucket: config.bucketName, Key: key }));
  return { size: result.ContentLength || 0, contentType: result.ContentType || "" };
}
