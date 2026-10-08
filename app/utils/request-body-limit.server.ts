/**
 * Bounds the number of bytes exposed to downstream body parsers. React Router
 * actions receive a Web Request, so formData() still buffers the allowed body;
 * this guard prevents it from receiving an unbounded/chunked request.
 */
export function limitRequestBody(request: Request, maxBytes: number) {
  const declaredLength = request.headers.get("content-length");
  const parsedLength = declaredLength && /^\d+$/.test(declaredLength)
    ? Number(declaredLength)
    : null;
  if (parsedLength !== null && parsedLength > maxBytes) {
    return { request, tooLarge: true, wasExceeded: () => false };
  }

  if (!request.body) {
    return { request, tooLarge: false, wasExceeded: () => false };
  }

  let bytesRead = 0;
  let exceeded = false;
  const reader = request.body.getReader();
  const limitedBody = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }

        bytesRead += value.byteLength;
        if (bytesRead > maxBytes) {
          exceeded = true;
          void reader.cancel().catch(() => undefined);
          controller.error(new Error("Request body exceeds the configured limit."));
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  const requestInit: RequestInit & { duplex: "half" } = {
    method: request.method,
    headers: request.headers,
    body: limitedBody,
    signal: request.signal,
    duplex: "half",
  };
  const limitedRequest = new Request(request.url, requestInit);

  return {
    request: limitedRequest,
    tooLarge: false,
    wasExceeded: () => exceeded,
  };
}
