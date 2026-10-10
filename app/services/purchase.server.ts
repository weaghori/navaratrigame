import prisma from "../db.server";
import { getCampaignTimeStatus } from "./campaign.server";

type ShopifyOrder = {
  id?: string | number;
  name?: string;
  customer?: { id?: string | number } | null;
  financial_status?: string;
  total_price?: string;
  paid_at?: string | null;
  created_at?: string | null;
  line_items?: Array<{ product_id?: string | number | null }>;
};

export async function recordPaidShopifyOrder(shop: string, order: ShopifyOrder) {
  if (!order.id || !order.customer?.id || order.financial_status !== "paid") return;
  const customerId = String(order.customer.id);
  const orderId = String(order.id);
  const totalPrice = Number(order.total_price || 0);
  const paidAt = new Date(order.paid_at || order.created_at || Date.now());
  if (!Number.isFinite(totalPrice) || Number.isNaN(paidAt.getTime())) return;

  const campaigns = await prisma.campaign.findMany({
    where: { shop },
    include: { levels: { where: { levelNumber: 9, activityType: "purchase", isActive: true } } },
  });
  for (const campaign of campaigns) {
    if (!campaign.levels.length || getCampaignTimeStatus(campaign, paidAt) !== "ACTIVE") continue;
    const level = campaign.levels[0];
    const config = (level.config as Record<string, unknown> | null) || {};
    if (totalPrice < (Number(config.minimumOrderValue) || 0)) continue;
    const normalizeProductId = (value: unknown) => String(value || "").split("/").pop() || "";
    const eligibleProducts = Array.isArray(config.eligibleProductIds) ? config.eligibleProductIds.map(normalizeProductId) : [];
    const orderedProducts = (order.line_items || []).map((item) => normalizeProductId(item.product_id));
    if (eligibleProducts.length && !orderedProducts.some((productId) => eligibleProducts.includes(productId))) continue;

    const progress = await prisma.customerProgress.upsert({
      where: { campaignId_shopifyCustomerId: { campaignId: campaign.id, shopifyCustomerId: customerId } },
      update: {},
      create: { campaignId: campaign.id, shopifyCustomerId: customerId },
    });
    await prisma.purchaseVerification.upsert({
      where: { shop_shopifyOrderId: { shop, shopifyOrderId: orderId } },
      update: {},
      create: {
        shop,
        shopifyOrderId: orderId,
        orderName: order.name || null,
        totalPrice,
        paidAt,
        campaignId: campaign.id,
        customerProgressId: progress.id,
      },
    });
    await completeReadyPurchaseForCustomer(campaign.id, customerId);
  }
}

/** Award the final purchase level once the customer has completed the previous level. */
export async function completeReadyPurchaseForCustomer(campaignId: string, shopifyCustomerId: string) {
  const cleanCustomerId = String(shopifyCustomerId).trim();
  // Read prerequisites before opening a transaction so a busy pool cannot leave
  // an interactive transaction expired before its first write.
  const [progress, level] = await Promise.all([
    prisma.customerProgress.findUnique({
      where: { campaignId_shopifyCustomerId: { campaignId, shopifyCustomerId: cleanCustomerId } },
    }),
    prisma.level.findFirst({
      where: { campaignId, levelNumber: 9, activityType: "purchase", isActive: true },
      include: { campaign: true },
    }),
  ]);
  if (!progress || !level || getCampaignTimeStatus(level.campaign) !== "ACTIVE") return false;

  const [previous, existingAward, purchase] = await Promise.all([
    prisma.level.findFirst({ where: { campaignId, levelNumber: 8 }, select: { id: true } }),
    prisma.pointTransaction.findFirst({
      where: { customerProgressId: progress.id, levelId: level.id },
      select: { id: true },
    }),
    prisma.purchaseVerification.findFirst({
      where: { campaignId, customerProgressId: progress.id, completedAt: null },
      orderBy: { paidAt: "asc" },
    }),
  ]);
  if (existingAward || !purchase) return false;
  if (previous && !(await prisma.pointTransaction.findFirst({
    where: { customerProgressId: progress.id, levelId: previous.id },
    select: { id: true },
  }))) return false;

  // A conditional claim keeps concurrent webhook and page retries idempotent.
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.purchaseVerification.updateMany({
      where: { id: purchase.id, completedAt: null },
      data: { completedAt: new Date() },
    });
    if (claimed.count === 0) return false;

    const pointTransaction = await tx.pointTransaction.create({
      data: {
        customerProgressId: progress.id,
        levelId: level.id,
        points: level.points,
        transactionType: "purchase_verified",
        description: `Verified paid Shopify order ${purchase.orderName || purchase.shopifyOrderId}`,
        referenceId: purchase.shopifyOrderId,
      },
    });
    const updatedProgress = await tx.customerProgress.update({
      where: { id: progress.id },
      data: {
        totalPoints: { increment: level.points },
        currentLevel: Math.max(progress.currentLevel, level.levelNumber + 1),
      },
      select: { totalPoints: true, eligibleAt: true },
    });
    if (updatedProgress.totalPoints >= level.campaign.maxPoints && !updatedProgress.eligibleAt) {
      await tx.customerProgress.update({
        where: { id: progress.id },
        data: { status: "eligible", eligibleAt: new Date(), completedAt: new Date() },
      });
    }
    await tx.auditEvent.create({
      data: {
        campaignId,
        eventType: "POINTS_AWARDED",
        actorType: "SYSTEM",
        actorId: `shopify-order:${purchase.shopifyOrderId}`,
        targetId: pointTransaction.id,
        metadata: { levelNumber: level.levelNumber, points: level.points, orderName: purchase.orderName },
      },
    });
    return true;
  }, { maxWait: 15_000, timeout: 15_000 });
}

/** A purchase check must not turn a successfully completed challenge into an error. */
export async function tryCompleteReadyPurchaseForCustomer(campaignId: string, shopifyCustomerId: string) {
  try {
    return await completeReadyPurchaseForCustomer(campaignId, shopifyCustomerId);
  } catch (error) {
    console.error("Could not check for a newly unlocked purchase level:", error);
    return false;
  }
}

export async function checkAndRecordRecentOrders(shop: string, customerId: string, campaignId: string) {
  try {
    const { unauthenticated } = await import("../shopify.server");
    const { admin } = await unauthenticated.admin(shop);
    const response = await admin.graphql(
      `query getCustomerOrders($id: ID!) {
        customer(id: $id) {
          orders(first: 10, sortKey: CREATED_AT, reverse: true) {
            edges {
              node {
                id
                name
                createdAt
                fullyPaid
                totalPriceSet {
                  shopMoney { amount }
                }
                lineItems(first: 20) {
                  edges {
                    node {
                      product { id }
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      { variables: { id: `gid://shopify/Customer/${customerId}` } }
    );
    const data = await response.json();
    const orders = data.data?.customer?.orders?.edges || [];
    
    let anyRecorded = false;
    for (const edge of orders) {
      const orderNode = edge.node;
      if (!orderNode.fullyPaid) continue;
      
      const shopifyOrder = {
        id: orderNode.id.split("/").pop(),
        name: orderNode.name,
        customer: { id: customerId },
        financial_status: "paid",
        total_price: orderNode.totalPriceSet?.shopMoney?.amount,
        paid_at: orderNode.createdAt,
        created_at: orderNode.createdAt,
        line_items: orderNode.lineItems?.edges.map((li: any) => ({
          product_id: li.node.product?.id?.split("/").pop() || null,
        })) || [],
      };
      
      const existing = await prisma.purchaseVerification.findFirst({
        where: { shop, shopifyOrderId: String(shopifyOrder.id) }
      });
      if (!existing) {
        await recordPaidShopifyOrder(shop, shopifyOrder);
        anyRecorded = true;
      }
    }
    
    return await tryCompleteReadyPurchaseForCustomer(campaignId, customerId);
  } catch (error) {
    console.error("Failed to check recent orders manually:", error);
    return false;
  }
}
