import type { ActionFunctionArgs } from "react-router";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "PUT") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  
  const targetUrl = new URL(request.url).searchParams.get("target");
  if (!targetUrl || !targetUrl.startsWith("https://")) {
    return Response.json({ error: "Invalid target" }, { status: 400 });
  }

  // Prevent proxying to internal network or arbitrary domains (limit to Cloudflare R2)
  if (!targetUrl.includes(".r2.cloudflarestorage.com")) {
    return Response.json({ error: "Invalid upload destination" }, { status: 403 });
  }

  const headers = new Headers();
  if (request.headers.get("Content-Type")) {
    headers.set("Content-Type", request.headers.get("Content-Type")!);
  }
  if (request.headers.get("Content-Length")) {
    headers.set("Content-Length", request.headers.get("Content-Length")!);
  }

  try {
    const res = await fetch(targetUrl, {
      method: "PUT",
      headers,
      body: request.body,
      // @ts-ignore - Required for Node.js fetch with ReadableStream body
      duplex: "half",
    });

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
    });
  } catch (error) {
    console.error("Proxy upload failed:", error);
    return Response.json({ error: "Proxy upload failed" }, { status: 500 });
  }
}
