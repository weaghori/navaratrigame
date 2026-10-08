import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);
  const customerId = payload?.customer?.id ? String(payload.customer.id) : "unknown";
  
  console.log(`[${topic}] Data request for customer ${customerId} on shop ${shop}`);
  
  // In a complete manual-fulfillment system, you would enqueue a job to compile
  // the requested data (CustomerProgress, Submissions, PointTransactions)
  // and email it to the store owner or customer.
  // Shopify requires an immediate 200 response to acknowledge receipt.
  
  return new Response();
};
