import type { LoaderFunctionArgs } from "react-router";
import { getR2ObjectResponse } from "../services/r2.server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

function validObjectKey(key: string): boolean {
  const parts = key.split("/");
  if (parts.length < 2 || parts.length > 6) return false;
  const fileName = parts.at(-1) || "";
  const folders = parts.slice(0, -1);
  return folders.every((part) => /^[A-Za-z0-9_-]{1,80}$/.test(part))
    && /^[a-f0-9]{64}(?:_thumb)?\.[A-Za-z0-9]{1,10}$/i.test(fileName);
}

export async function loader({ request }: LoaderFunctionArgs): Promise<Response> {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") || "";
  if (!validObjectKey(key)) return new Response("Media not found.", { status: 404 });

  let customerId: string | null = null;
  let adminShop: string | null = null;
  const isProxyRequest = url.searchParams.has("signature");

  try {
    if (isProxyRequest) {
      const { session } = await authenticate.public.appProxy(request);
      if (session) {
        const accessInfo = (session as any).onlineAccessInfo;
        if (accessInfo?.associated_user?.id) {
          customerId = String(accessInfo.associated_user.id);
        }
      }
      if (!customerId) {
        const proxyCustomerId = url.searchParams.get("logged_in_customer_id");
        if (proxyCustomerId) customerId = proxyCustomerId.trim();
      }
      if (!customerId) return new Response("Unauthorized proxy access.", { status: 401 });
    } else {
      const { session } = await authenticate.admin(request);
      adminShop = session.shop;
    }
  } catch (error) {
    if (error instanceof Response) return error;
    return new Response("Authentication error", { status: 401 });
  }

  const baseKey = key.replace(/_thumb(\.[a-zA-Z0-9]+)$/, "$1");
  const encodedKey = encodeURIComponent(key);
  const encodedBaseKey = encodeURIComponent(baseKey);

  let isAuthorized = false;
  if (customerId) {
    const count = await prisma.submission.count({
      where: {
        OR: [
          { fileUrl: { contains: encodedKey } },
          { fileUrl: { contains: encodedBaseKey } }
        ],
        customerProgress: { shopifyCustomerId: customerId }
      }
    });
    if (count > 0) isAuthorized = true;
  } else if (adminShop) {
    const count = await prisma.submission.count({
      where: {
        OR: [
          { fileUrl: { contains: encodedKey } },
          { fileUrl: { contains: encodedBaseKey } }
        ],
        campaign: { shop: adminShop }
      }
    });
    if (count > 0) isAuthorized = true;
  }

  if (!isAuthorized) {
    return new Response("Forbidden.", { status: 403 });
  }

  const range = request.headers.get("range") || undefined;
  if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) {
    return new Response("Invalid byte range.", {
      status: 416,
      headers: { "Accept-Ranges": "bytes" },
    });
  }

  try {
    const object = await getR2ObjectResponse(key, range);
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": object.contentType,
      "X-Content-Type-Options": "nosniff",
    });
    if (object.contentLength !== undefined) headers.set("Content-Length", String(object.contentLength));
    if (object.contentRange) headers.set("Content-Range", object.contentRange);
    if (object.etag) headers.set("ETag", object.etag);
    return new Response(object.body, { status: object.partial ? 206 : 200, headers });
  } catch (error) {
    const details = error && typeof error === "object"
      ? error as { name?: unknown; Code?: unknown; code?: unknown; $metadata?: { httpStatusCode?: unknown } }
      : {};
    const status = details.$metadata?.httpStatusCode === 404
      || details.name === "NoSuchKey"
      || details.Code === "NoSuchKey"
      || details.code === "NoSuchKey"
      ? 404
      : 502;
    return new Response(status === 404 ? "Media not found." : "Media could not be loaded.", { status });
  }
}
