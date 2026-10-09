export { action } from "./api.campaigns.$slug.upload";

export const loader = async ({ request }: { request: Request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
      },
    });
  }
  return new Response("Method Not Allowed", { status: 405 });
};
