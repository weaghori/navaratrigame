/**
 * Central media storage service. Raster images are validated and optimized in
 * memory before they are sent to object storage. Non-image media keeps its
 * supplied format for existing audio assets.
 */
import { createHash } from "node:crypto";
import sharp from "sharp";
import { deleteR2Object, isR2Configured, putR2Object, r2KeyFromMediaReference, r2MediaReferenceForKey, readR2Object } from "./r2.server";

const MAX_IMAGE_INPUT_BYTES = 25 * 1024 * 1024;
const IMAGE_MIME_FORMATS: Record<string, string> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};

export interface UploadOptions {
  fileName: string;
  buffer: Buffer | Uint8Array;
  contentType: string;
  folder?: string;
  thumbnailFolder?: string;
  objectName?: string;
}

export interface UploadResult {
  url: string;
  path: string;
  provider: "r2";
  contentType: string;
  size: number;
}

type PreparedMedia = { buffer: Buffer; thumbBuffer?: Buffer; contentType: string; fileName: string };

async function putContentAddressedR2Object({
  key,
  body,
  contentType,
  expectedHash,
}: {
  key: string;
  body: Buffer;
  contentType: string;
  expectedHash: string;
}): Promise<void> {
  try {
    await putR2Object({ key, body, contentType, ifNoneMatch: "*" });
  } catch (error) {
    const details = error && typeof error === "object" ? error as { name?: string; Code?: string; code?: string; $metadata?: { httpStatusCode?: number } } : {};
    const isAlreadyPresent = details.$metadata?.httpStatusCode === 412 || details.name === "PreconditionFailed" || details.Code === "PreconditionFailed" || details.code === "PreconditionFailed";
    if (!isAlreadyPresent) throw error;

    const existing = await readR2Object(key);
    const existingHash = createHash("sha256").update(existing).digest("hex");
    if (existingHash !== expectedHash) {
      throw new Error("An existing R2 object did not match its content-addressed key.");
    }
  }
}

async function prepareMedia(options: UploadOptions): Promise<PreparedMedia> {
  const contentType = options.contentType.toLowerCase().split(";")[0].trim();
  // Keep an existing Buffer by reference to avoid an unnecessary copy.
  const input = Buffer.isBuffer(options.buffer) ? options.buffer : Buffer.from(options.buffer);

  if (!contentType.startsWith("image/")) {
    return { buffer: input, contentType, fileName: options.fileName };
  }

  const expectedFormat = IMAGE_MIME_FORMATS[contentType];
  if (!expectedFormat) throw new Error("Unsupported image type. Upload a JPEG, PNG, or WebP image.");
  if (input.byteLength === 0 || input.byteLength > MAX_IMAGE_INPUT_BYTES) {
    throw new Error("Images must be smaller than 25MB before processing.");
  }

  const baseImage = sharp(input, { limitInputPixels: 40_000_000, failOn: "error" }).rotate();
  const metadata = await baseImage.metadata();
  if (metadata.format !== expectedFormat || !metadata.width || !metadata.height) {
    throw new Error("The uploaded image content does not match its file type or is invalid.");
  }

  const isSubmissionPhoto = options.folder === "photos";
  const maxDimension = isSubmissionPhoto ? 1200 : 1600;
  
  const webp = await baseImage
    .clone()
    .resize({ width: maxDimension, height: maxDimension, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78, effort: 4, smartSubsample: true })
    .toBuffer();

  const thumbBuffer = await baseImage
    .clone()
    .resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 75, effort: 4 })
    .toBuffer();

  return { buffer: webp, thumbBuffer, contentType: "image/webp", fileName: `${options.fileName.replace(/\.[^.]*$/, "")}.webp` };
}

function cleanFolder(folder: string): string {
  return folder.split("/").map((part) => part.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80)).filter(Boolean).join("/") || "general";
}

export async function uploadMedia(options: UploadOptions): Promise<UploadResult> {
  const media = await prepareMedia(options);
  if (!isR2Configured()) throw new Error("Cloudflare R2 is the active media provider but is not fully configured.");
  const fileHash = createHash("sha256").update(media.buffer).digest("hex");
  const extension = media.contentType === "image/webp"
    ? "webp"
    : (media.fileName.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin");
  // Content-addressed names make repeated identical uploads reuse the same object.
  const requestedObjectName = options.objectName?.replace(/[^a-fA-F0-9_-]/g, "").slice(0, 80);
  const objectName = requestedObjectName && /^[a-f0-9]{32}$/i.test(requestedObjectName)
    ? `${requestedObjectName}${fileHash.slice(0, 32)}`
    : requestedObjectName;
  const filePath = `${cleanFolder(options.folder || "general")}/${objectName ? `${objectName}.${extension}` : `${fileHash}.${extension}`}`;

  try {
    await putContentAddressedR2Object({ key: filePath, body: media.buffer, contentType: media.contentType, expectedHash: fileHash });
    if (media.thumbBuffer && extension === "webp") {
      const thumbPath = `${cleanFolder(options.thumbnailFolder || options.folder || "general")}/${objectName ? `${objectName}.webp` : `${fileHash}_thumb.webp`}`;
      const thumbHash = createHash("sha256").update(media.thumbBuffer).digest("hex");
      try {
        await putContentAddressedR2Object({ key: thumbPath, body: media.thumbBuffer, contentType: "image/webp", expectedHash: thumbHash });
      } catch (error) {
        console.warn("Cloudflare R2 thumbnail upload failed.", error && typeof error === "object" && "name" in error ? error.name : "Unknown error");
      }
    }
    return { url: r2MediaReferenceForKey(filePath), path: filePath, provider: "r2", contentType: media.contentType, size: media.buffer.byteLength };
  } catch (error) {
    const diagnostic = error && typeof error === "object"
      ? {
          name: "name" in error ? error.name : undefined,
          code: "Code" in error ? error.Code : "code" in error ? error.code : undefined,
          httpStatus: "$metadata" in error && error.$metadata && typeof error.$metadata === "object" && "httpStatusCode" in error.$metadata ? error.$metadata.httpStatusCode : undefined,
        }
      : { type: typeof error };
    console.error("Cloudflare R2 media upload failed.", diagnostic);
    throw new Error("Media could not be stored. Please try again.");
  }
}

/** Deletes an object only when the caller has confirmed it is no longer referenced. */
export async function deleteStoredMedia(path: string): Promise<void> {
  if (!path || path.startsWith("data:")) return;
  const r2Key = r2KeyFromMediaReference(path);
  if (r2Key) {
    await deleteR2Object(r2Key);
    if (r2Key.includes("/images/original/")) {
      await deleteR2Object(r2Key.replace("/images/original/", "/images/thumbnails/"));
    } else if (r2Key.endsWith(".webp")) {
      await deleteR2Object(r2Key.replace(/\.webp$/, "_thumb.webp"));
    }
    return;
  }
}
