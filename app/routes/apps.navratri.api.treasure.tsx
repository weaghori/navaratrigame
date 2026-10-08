import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getCampaignBySlug } from "../services/campaign.server";
import { completeSpecialActivity } from "../services/special-activity.server";

async function findCampaignForStore(slug: string, shop?: string) {
  if (!shop) return slug ? getCampaignBySlug(slug) : null;
  const exact = slug
    ? await prisma.campaign.findUnique({ where: { shop_slug: { shop, slug } } })
    : null;
  if (exact) return exact;
  return prisma.campaign.findFirst({
    where: { shop, status: "active" },
    orderBy: { createdAt: "desc" },
  });
}

async function findTreasureLevel(campaignId: string, requestedLevel: number) {
  const exact = Number.isInteger(requestedLevel)
    ? await prisma.level.findFirst({
        where: { campaignId, levelNumber: requestedLevel, activityType: "treasure_hunt", isActive: true },
        select: { id: true, levelNumber: true, config: true },
      })
    : null;
  if (exact) return exact;
  return prisma.level.findFirst({
    where: { campaignId, activityType: "treasure_hunt", isActive: true },
    orderBy: { levelNumber: "asc" },
    select: { id: true, levelNumber: true, config: true },
  });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = (session as unknown as Record<string, unknown> | null)?.shop as string | undefined || url.searchParams.get("shop") || undefined;
  const slug = url.searchParams.get("campaignSlug") || "";
  const requestedLevel = Number(url.searchParams.get("levelNumber"));
  const campaign = await findCampaignForStore(slug, shop);
  if (!campaign) return Response.json({ success: false }, { status: 404 });
  const level = await findTreasureLevel(campaign.id, requestedLevel);
  if (!level) return Response.json({ success: false }, { status: 404 });
  const config = (level.config as Record<string, unknown> | null) || {};
  const customerId = url.searchParams.get("logged_in_customer_id")?.trim();
  const completed = customerId
    ? Boolean(await prisma.pointTransaction.findFirst({
        where: {
          levelId: level.id,
          customerProgress: { campaignId: campaign.id, shopifyCustomerId: customerId },
        },
        select: { id: true },
      }))
    : false;
  return Response.json({
    success: true,
    campaignSlug: campaign.slug,
    levelNumber: level.levelNumber,
    eligibleProductHandles: Array.isArray(config.eligibleProductHandles) ? config.eligibleProductHandles : [],
    eligibleCategories: Array.isArray(config.eligibleCategories) ? config.eligibleCategories : [],
    buttonLabel: String(config.buttonLabel || "Find the Navratri treasure"),
    buttonIcon: String(config.buttonIcon || "🎁"),
    buttonPosition: String(config.buttonPosition || "random"),
    completed,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const customerId = url.searchParams.get("logged_in_customer_id")?.trim();
  const shop = (session as unknown as Record<string, unknown> | null)?.shop as string | undefined || url.searchParams.get("shop") || undefined;
  if (!customerId) return Response.json({ success: false, error: "Please sign in to claim the treasure." }, { status: 401 });

  const formData = await request.formData();
  const slug = String(formData.get("campaignSlug") || "");
  const campaign = await findCampaignForStore(slug, shop);
  if (!campaign) return Response.json({ success: false, error: "Campaign not found." }, { status: 404 });
  const level = await findTreasureLevel(campaign.id, Number(formData.get("levelNumber")));
  if (!level) return Response.json({ success: false, error: "No active treasure hunt is configured for this store." }, { status: 404 });
  try {
    const result = await completeSpecialActivity({
      campaignId: campaign.id,
      levelNumber: level.levelNumber,
      shopifyCustomerId: customerId,
      productHandle: String(formData.get("productHandle") || ""),
      collectionHandle: String(formData.get("collectionHandle") || ""),
    });
    return Response.json({ success: true, pointsAwarded: result.pointsAwarded, message: `Treasure found! You earned ${result.pointsAwarded} points.` });
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : "Unable to claim the treasure." }, { status: 400 });
  }
};
