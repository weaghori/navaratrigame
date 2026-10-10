import { type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { checkAndRecordRecentOrders } from "../services/purchase.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const { id } = params;
  if (!id) return Response.json({ error: "No ID provided" }, { status: 400 });

  const progress = await prisma.customerProgress.findUnique({
    where: { id },
    include: {
      submissions: { orderBy: { createdAt: "desc" } },
      purchaseVerifications: { orderBy: { createdAt: "desc" } },
      rewards: { orderBy: { createdAt: "desc" } },
      pointTransactions: { orderBy: { createdAt: "desc" } }
    }
  });

  if (!progress) return Response.json({ error: "Not found" }, { status: 404 });

  let email = null;
  let phone = null;
  let shopifyName = null;

  try {
    const customerId = progress.shopifyCustomerId;
    const graphqlId = customerId.startsWith("gid://") ? customerId : `gid://shopify/Customer/${customerId}`;
    
    const response = await admin.graphql(`#graphql
      query GetCustomerDetails($id: ID!) {
        customer(id: $id) {
          firstName
          lastName
          email
          phone
        }
      }
    `, { variables: { id: graphqlId } });

    const data = await response.json();
    if (data.data?.customer) {
      email = data.data.customer.email;
      phone = data.data.customer.phone;
      shopifyName = [data.data.customer.firstName, data.data.customer.lastName].filter(Boolean).join(" ");
    }
  } catch (err) {
    // Ignore graphql fetch errors gracefully
  }

  const auditLogs = await prisma.auditEvent.findMany({
    where: { actorId: progress.shopifyCustomerId },
    orderBy: { createdAt: "desc" },
    take: 20
  });

  return Response.json({
    progress,
    email,
    phone,
    shopifyName,
    auditLogs
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { id } = params;
  if (!id) return Response.json({ error: "No ID provided" }, { status: 400 });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "sync_orders") {
    const progress = await prisma.customerProgress.findUnique({
      where: { id },
      include: { campaign: true }
    });
    if (!progress) return Response.json({ error: "Not found" }, { status: 404 });

    try {
      await checkAndRecordRecentOrders(session.shop, progress.shopifyCustomerId, progress.campaignId);
      return Response.json({ success: true, message: "Orders synchronized successfully" });
    } catch (e: any) {
      return Response.json({ error: e.message || "Failed to sync orders" }, { status: 500 });
    }
  }

  return Response.json({ error: "Invalid intent" }, { status: 400 });
};
