import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { getCampaignBySlug } from "../services/campaign.server";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const campaign = await getCampaignBySlug(params.slug || "", url.searchParams.get("shop") || undefined);
  if (!campaign) return new Response("Audio challenge not found.", { status: 404 });

  const levelId = url.searchParams.get("levelId") || "";
  const level = await prisma.level.findFirst({
    where: { id: levelId, campaignId: campaign.id, activityType: "audio_guess" },
    select: { config: true },
  });
  const config = level?.config && typeof level.config === "object" && !Array.isArray(level.config)
    ? level.config as Record<string, unknown>
    : {};
  const audioUrl = typeof config.audioUrl === "string" ? config.audioUrl : "";
  if (!audioUrl) return new Response("Audio clip not found.", { status: 404 });

  if (audioUrl.startsWith("r2:") || audioUrl.startsWith("/api/media?")) {
    const mediaPath = audioUrl.startsWith("r2:")
      ? `/api/media${audioUrl.slice(3)}`
      : audioUrl;
    const basePath = url.pathname.replace(/\/api\/campaigns\/[^/]+\/audio$/, "");
    return Response.redirect(new URL(`${basePath}${mediaPath}`, url.origin), 302);
  }

  if (audioUrl.startsWith("data:")) {
    const separator = audioUrl.indexOf(",");
    if (separator < 0) return new Response("Audio clip is invalid.", { status: 500 });
    const metadata = audioUrl.slice(0, separator);
    const payload = audioUrl.slice(separator + 1);
    const contentType = metadata.slice(5).split(";")[0] || "application/octet-stream";
    const bytes = metadata.endsWith(";base64")
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload));
    return new Response(bytes, {
      headers: {
        "Cache-Control": "private, max-age=300",
        "Content-Type": contentType,
        "Content-Length": String(bytes.byteLength),
      },
    });
  }

  try {
    const range = request.headers.get("range");
    const upstream = await fetch(audioUrl, {
      headers: {
        ...(range ? { Range: range } : {}),
      },
    });
    const headers = new Headers({
      "Cache-Control": "private, max-age=300",
      "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
      "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
    });
    for (const name of ["content-length", "content-range", "last-modified", "etag"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return new Response("Audio clip could not be loaded.", { status: 502 });
  }
};
