import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { getCampaignBySlug, getCampaignTimeStatus, getLevelAvailabilitySchedule } from "../services/campaign.server";
import { processMediaSubmission } from "../services/submission.server";
import { createR2PutUrl, deleteR2Object, getR2ObjectMetadata, readR2Object } from "../services/r2.server";
import { limitRequestBody } from "../utils/request-body-limit.server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const MAX_JSON_BYTES = 64 * 1024;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const UPLOAD_PREFIX = "navratri/submissions/uploads";

type UploadToken = {
  key: string;
  uploadId: string;
  customerId: string;
  shop: string;
  slug: string;
  campaignId: string;
  levelId: string;
  submissionType: "photo_upload" | "final_submission";
  contentType: string;
  size: number;
  fileName: string;
  expiresAt: number;
};

function sign(value: string): string {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) throw new Error("Shopify authentication is not configured.");
  return createHmac("sha256", secret).update(value).digest("hex");
}

function createToken(payload: UploadToken): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

function readToken(token: unknown): UploadToken | null {
  if (typeof token !== "string") return null;
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) return null;
  const expected = Buffer.from(sign(encoded), "hex");
  const received = Buffer.from(signature, "hex");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as UploadToken;
    if (!payload || typeof payload !== "object" || payload.expiresAt <= Date.now()) return null;
    if (!payload.key.startsWith(`${UPLOAD_PREFIX}/`) || !/^[a-f0-9]{32}$/i.test(payload.uploadId)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function getProxyIdentity(request: Request): Promise<{ customerId: string; shop: string }> {
  const { session } = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const customerId = url.searchParams.get("logged_in_customer_id")?.trim();
  const shop = (session as unknown as { shop?: string } | undefined)?.shop || url.searchParams.get("shop") || "";
  if (!customerId || !/^\d+$/.test(customerId)) throw new Response("A logged-in Shopify customer is required.", { status: 401 });
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) throw new Response("Invalid Shopify shop.", { status: 400 });
  return { customerId, shop };
}

export async function action({ params, request }: ActionFunctionArgs) {
  const bodyGuard = limitRequestBody(request, MAX_JSON_BYTES);
  if (bodyGuard.tooLarge) return Response.json({ success: false, error: "Request is too large." }, { status: 413 });

  let identity: { customerId: string; shop: string };
  try {
    identity = await getProxyIdentity(bodyGuard.request.clone());
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ success: false, error: "Shopify customer authentication failed." }, { status: 401 });
  }

  try {
    const body = await bodyGuard.request.json() as Record<string, unknown>;
    const intent = body.intent;

    if (intent === "authorize") {
      const slug = String(params.slug || "");
      const levelId = String(body.levelId || "");
      const contentType = String(body.contentType || "").toLowerCase();
      const size = Number(body.size);
      const fileName = String(body.fileName || "image").replace(/[\\/]/g, "_").slice(0, 180);
      const submissionType = body.submissionType === "final_submission" ? "final_submission" : "photo_upload";

      if (!levelId || !IMAGE_TYPES.has(contentType) || !Number.isInteger(size) || size < 1 || size > MAX_IMAGE_BYTES) {
        return Response.json({ success: false, error: "Choose a JPEG, PNG, or WebP image up to 25 MB." }, { status: 400 });
      }

      const campaign = await getCampaignBySlug(slug, identity.shop);
      if (!campaign || campaign.status !== "active" || getCampaignTimeStatus(campaign) !== "ACTIVE") {
        return Response.json({ success: false, error: "Campaign not found or not active." }, { status: 404 });
      }
      const level = await prisma.level.findUnique({ where: { id: levelId } });
      if (!level || level.campaignId !== campaign.id || !level.isActive
        || (level.activityType !== "photo_upload" && level.activityType !== "final_submission")
        || (submissionType === "photo_upload" && level.activityType !== "photo_upload")) {
        return Response.json({ success: false, error: "This level does not accept an image upload." }, { status: 400 });
      }
      const levelConfig = level.config && typeof level.config === "object" && !Array.isArray(level.config)
        ? level.config as Record<string, unknown>
        : {};
      const configuredLimitMb = Number(levelConfig.maxFileSizeMb);
      const maxAllowedBytes = Math.min(MAX_IMAGE_BYTES, (Number.isFinite(configuredLimitMb) && configuredLimitMb > 0 ? configuredLimitMb : 15) * 1024 * 1024);
      if (size > maxAllowedBytes) {
        return Response.json({ success: false, error: "This challenge accepts images up to " + Math.floor(maxAllowedBytes / (1024 * 1024)) + " MB." }, { status: 413 });
      }
      if (!getLevelAvailabilitySchedule(level, campaign).isAvailableNow) {
        return Response.json({ success: false, error: "This challenge is not currently available." }, { status: 400 });
      }

      const uploadId = randomUUID().replace(/-/g, "");
      const customerKey = createHmac("sha256", process.env.SHOPIFY_API_SECRET || "").update(identity.customerId).digest("hex").slice(0, 32);
      const key = `${UPLOAD_PREFIX}/${customerKey}/${uploadId}.upload`;
      const payload: UploadToken = {
        key, uploadId, customerId: identity.customerId, shop: identity.shop, slug,
        campaignId: campaign.id, levelId, submissionType, contentType, size, fileName,
        expiresAt: Date.now() + 10 * 60 * 1000,
      };
      const uploadUrl = await createR2PutUrl(key, contentType, size, 5 * 60);
      return Response.json({
        success: true,
        uploadUrl,
        finalizeToken: createToken(payload),
        requiredHeaders: { "Content-Type": contentType },
      });
    }

    if (intent === "finalize") {
      const payload = readToken(body.finalizeToken);
      if (!payload || payload.customerId !== identity.customerId || payload.shop !== identity.shop || payload.slug !== String(params.slug || "")) {
        return Response.json({ success: false, error: "Upload authorization is invalid or expired." }, { status: 403 });
      }

      const campaign = await getCampaignBySlug(payload.slug, payload.shop);
      if (!campaign || campaign.id !== payload.campaignId || campaign.status !== "active" || getCampaignTimeStatus(campaign) !== "ACTIVE") {
        return Response.json({ success: false, error: "Campaign not found or not active." }, { status: 404 });
      }
      const metadata = await getR2ObjectMetadata(payload.key);
      if (metadata.size !== payload.size || metadata.size < 1 || metadata.size > MAX_IMAGE_BYTES
        || metadata.contentType.toLowerCase().split(";")[0].trim() !== payload.contentType) {
        await deleteR2Object(payload.key);
        return Response.json({ success: false, error: "Uploaded image did not match its authorized size or type." }, { status: 400 });
      }

      try {
        const buffer = await readR2Object(payload.key);
        if (buffer.byteLength !== payload.size || buffer.byteLength > MAX_IMAGE_BYTES) {
          return Response.json({ success: false, error: "Uploaded image size is invalid." }, { status: 400 });
        }
        const result = await processMediaSubmission({
          campaignId: payload.campaignId,
          levelId: payload.levelId,
          shopifyCustomerId: payload.customerId,
          submissionType: payload.submissionType,
          fileName: payload.fileName,
          buffer,
          contentType: payload.contentType,
          textResponse: typeof body.textResponse === "string" ? body.textResponse.slice(0, 2000) : undefined,
          // Each finalize attempt gets a distinct permanent key. This lets the
          // submission service safely remove that attempt's object if the
          // MongoDB upsert fails, without risking a shared/content-addressed
          // object referenced by another submission.
          storageObjectName: randomUUID().replace(/-/g, ""),
          storageUserKey: createHmac("sha256", process.env.SHOPIFY_API_SECRET || "").update(payload.customerId).digest("hex").slice(0, 32),
        });
        return Response.json({ success: true, message: result.message });
      } finally {
        await deleteR2Object(payload.key).catch((error) => {
          console.warn("Temporary R2 upload cleanup failed.", error instanceof Error ? error.name : "Unknown error");
        });
      }
    }

    return Response.json({ success: false, error: "Unsupported upload operation." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image upload failed.";
    return Response.json({ success: false, error: message }, { status: 400 });
  }
}

export async function loader() {
  return Response.json({ success: false, error: "Method not allowed." }, { status: 405, headers: { Allow: "POST" } });
}
