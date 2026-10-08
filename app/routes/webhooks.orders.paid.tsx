import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { recordPaidShopifyOrder } from "../services/purchase.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop } = await authenticate.webhook(request);
  await recordPaidShopifyOrder(shop, payload);
  return new Response(null, { status: 200 });
};
