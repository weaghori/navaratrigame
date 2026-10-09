import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createR2PutUrl, deleteR2Object, getR2ObjectMetadata, readR2Object } from "../services/r2.server";
import { uploadMedia } from "../services/storage.server";
import { limitRequestBody } from "../utils/request-body-limit.server";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const AUDIO_TYPES = new Set(["audio/mpeg", "audio/mp3", "audio/mp4", "audio/aac", "audio/ogg", "audio/wav", "audio/webm", "audio/x-m4a"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

type UploadTicket = {
  shop: string;
  campaignId: string;
  levelId: string;
  key: string;
  contentType: string;
  size: number;
  kind: "image" | "audio";
  expiresAt: number;
};

function signTicket(ticket: UploadTicket): string {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) throw new Error("Shopify app secret is not configured.");
  const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function readTicket(value: string): UploadTicket | null {
  const [payload, signature] = value.split(".");
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!payload || !signature || !secret) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(signature, "base64url"); } catch { return null; }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const ticket = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as UploadTicket;
    if (!ticket || typeof ticket !== "object" || ticket.expiresAt < Date.now()) return null;
    return ticket;
  } catch { return null; }
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
  const { session } = await authenticate.admin(request);
  const guard = limitRequestBody(request, 16_384);
  if (guard.tooLarge) return Response.json({ error: "Upload request is too large." }, { status: 413 });
  let raw: string;
  try {
    raw = await guard.request.text();
    if (guard.wasExceeded()) return Response.json({ error: "Upload request is too large." }, { status: 413 });
  } catch {
    return Response.json({ error: "Upload request is too large or malformed." }, { status: 413 });
  }
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid upload request." }, { status: 400 });
  }

  const mode = body.mode;
  const campaignId = String(body.campaignId || "");
  const levelId = String(body.levelId || "");
  if (!campaignId || !levelId) return Response.json({ error: "Campaign and level are required." }, { status: 400 });
  const [campaign, level] = await Promise.all([
    prisma.campaign.findFirst({ where: { id: campaignId, shop: session.shop }, select: { id: true } }),
    prisma.level.findFirst({ where: { id: levelId, campaign: { shop: session.shop } }, select: { id: true, campaignId: true, activityType: true } }),
  ]);
  if (!campaign || !level || level.campaignId !== campaign.id) return Response.json({ error: "Level not found for this store." }, { status: 404 });

  if (mode === "authorize") {
    const contentType = String(body.contentType || "").toLowerCase();
    const size = Number(body.size);
    const kind = IMAGE_TYPES.has(contentType) ? "image" : AUDIO_TYPES.has(contentType) ? "audio" : null;
    if (!kind) return Response.json({ error: "Choose a supported JPEG, PNG, WebP, or audio file." }, { status: 415 });
    if (!Number.isSafeInteger(size) || size < 1 || size > (kind === "image" ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES)) {
      return Response.json({ error: kind === "image" ? "Product images must be 10MB or smaller." : "Audio files must be 25MB or smaller." }, { status: 413 });
    }
    // We no longer strictly enforce `level.activityType` here because an admin might
    // be changing a level from 'quiz' to 'audio_guess' and uploading the file before saving.
    // If we enforce it, they can't upload the file until they save, but they want to preview it first.
    const key = `navratri/admin-staging/${randomBytes(24).toString("hex")}.upload`;
    const ticket = signTicket({ shop: session.shop, campaignId, levelId, key, contentType, size, kind, expiresAt: Date.now() + 10 * 60_000 });
    const uploadUrl = await createR2PutUrl(key, contentType, size, 300);
    return Response.json({ uploadUrl, ticket });
  }

  if (mode === "finalize") {
    const ticket = readTicket(String(body.ticket || ""));
    if (!ticket || ticket.shop !== session.shop || ticket.campaignId !== campaignId || ticket.levelId !== levelId) {
      return Response.json({ error: "The upload authorization is invalid or expired." }, { status: 403 });
    }
    try {
      const metadata = await getR2ObjectMetadata(ticket.key);
      if (metadata.size !== ticket.size || metadata.contentType.toLowerCase() !== ticket.contentType) {
        return Response.json({ error: "The uploaded file does not match its authorization." }, { status: 400 });
      }
      const buffer = await readR2Object(ticket.key);
      if (buffer.length !== ticket.size) return Response.json({ error: "The uploaded file size could not be verified." }, { status: 400 });
      const result = await uploadMedia({
        fileName: ticket.kind === "image" ? "product-benefits" : "campaign-audio",
        buffer,
        contentType: ticket.contentType,
        folder: ticket.kind === "image" ? "campaign-product-images" : "campaign-audio",
      });
      return Response.json({ url: result.url });
    } catch (error) {
      console.error("Admin media finalization failed.", error instanceof Error ? error.name : "Unknown error");
      return Response.json({ error: error instanceof Error ? error.message : "The uploaded media could not be finalized." }, { status: 400 });
    } finally {
      await deleteR2Object(ticket.key).catch(() => undefined);
    }
  }
  return Response.json({ error: "Unknown upload operation." }, { status: 400 });
}

export async function loader() {
  return Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "POST" } });
}
