import type { LoaderFunctionArgs } from "react-router";
import { getCampaignBySlug } from "../services/campaign.server";
import { getCustomerLevelProgress, getCustomerPointHistory } from "../services/customer.server";
import { getPublicLeaderboard } from "../services/leaderboard.server";
import { getCustomerReward } from "../services/reward.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { slug } = params;
  const url = new URL(request.url);

  if (!slug) {
    return Response.json({ success: false, error: "Campaign slug required" }, { status: 400 });
  }

  // 1. Try Shopify App Proxy authentication if accessed through storefront proxy
  let customerId: string | null = null;
  let shopDomain: string | undefined;

  try {
    const { session } = await authenticate.public.appProxy(request);
    shopDomain = (session as unknown as Record<string, unknown>)?.shop as string | undefined;
    const proxyCustomerId = url.searchParams.get("logged_in_customer_id");
    if (proxyCustomerId && proxyCustomerId.trim() !== "") {
      customerId = proxyCustomerId.trim();
    } else if (session) {
      const accessInfo = (session as unknown as Record<string, unknown>).onlineAccessInfo as
        | { associated_user?: { id?: number | string } }
        | undefined;
      if (accessInfo?.associated_user?.id) {
        customerId = String(accessInfo.associated_user.id);
      }
    }
  } catch {
    // Not an App Proxy request or standalone API call
  }

  if (!shopDomain) {
    shopDomain = url.searchParams.get("shop") || undefined;
  }

  const isDev = process.env.NODE_ENV === "development";

  // 2. Fallback to explicit query parameter / header ONLY in local dev / QA mode
  if (!customerId && isDev) {
    customerId = url.searchParams.get("customerId") || request.headers.get("x-customer-id");
  }

  if (!customerId) {
    return Response.json(
      { success: false, error: "Authenticated customer ID required. Please ensure the customer is logged in." },
      { status: 401 },
    );
  }

  const campaign = await getCampaignBySlug(slug, shopDomain);

  if (!campaign) {
    return Response.json({ success: false, error: "Campaign not found" }, { status: 404 });
  }

  const [levelProgress, transactions, leaderboard, reward] = await Promise.all([
    getCustomerLevelProgress({
      campaignId: campaign.id,
      shopifyCustomerId: customerId,
    }),
    getCustomerPointHistory(customerId, campaign.id),
    getPublicLeaderboard({
      campaignId: campaign.id,
      currentCustomerId: customerId,
      limit: 10,
    }),
    getCustomerReward(campaign.id, customerId),
  ]);

  const { progress, levels, currentAvailableLevel } = levelProgress;

  return Response.json({
    success: true,
    campaign: {
      id: campaign.id,
      name: campaign.name,
      slug: campaign.slug,
      status: campaign.status,
      maxPoints: campaign.maxPoints,
      startDate: campaign.startDate,
      endDate: campaign.endDate,
    },
    progress: {
      id: progress.id,
      shopifyCustomerId: progress.shopifyCustomerId,
      totalPoints: progress.totalPoints,
      currentLevel: progress.currentLevel,
      status: progress.status,
      eligibleAt: progress.eligibleAt,
      completedAt: progress.completedAt,
    },
    currentAvailableLevel,
    levels,
    transactions,
    leaderboard,
    reward: reward
      ? {
          id: reward.id,
          discountCode: reward.discountCode,
          rewardType: reward.rewardType,
          rewardValue: reward.rewardValue,
          prizeLabel: reward.prizeLabel,
          offerMessage: reward.offerMessage,
          status: reward.status,
          issuedAt: reward.issuedAt,
          expiresAt: reward.expiresAt,
        }
      : null,
  });
};
