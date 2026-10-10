import type { LoaderFunctionArgs } from "react-router";
import { getCampaignBySlug } from "../services/campaign.server";
import { getCustomerLevelProgress, getCustomerPointHistory } from "../services/customer.server";
import { getNotifications, getUnreadNotificationCount } from "../services/notification.server";
import { getCustomerReward } from "../services/reward.server";
import { getPublicLeaderboard } from "../services/leaderboard.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug") || "navratri-2026";
  let customerId: string | null = null;
  let shopDomain: string | undefined;

  // Check for App Proxy authenticated customer ID and shop domain
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
  } catch (err: any) {
    // If proxy auth fails (e.g., missing signature due to direct access), check if it's an admin previewing
    try {
      const { session } = await authenticate.admin(request);
      shopDomain = session.shop;
      customerId = url.searchParams.get("customerId") || "preview_admin_customer";
    } catch {
      // Standalone or local dev fallback without admin session
    }
  }

  if (!shopDomain) {
    shopDomain = url.searchParams.get("shop") || undefined;
  }

  const isDev = process.env.NODE_ENV === "development";

  if (!customerId) {
    if (isDev) {
      customerId = url.searchParams.get("customerId") || "demo_guest_customer";
    } else {
      return new Response(JSON.stringify({ error: "Missing authenticated customerId" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const campaign = await getCampaignBySlug(slug, shopDomain);
  if (!campaign) {
    return new Response(JSON.stringify({ error: "Campaign not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const cleanCustomerId = String(customerId).trim();

  const [levelProgress, notifications, unreadCount, reward, leaderboard, pointTransactions] = await Promise.all([
    getCustomerLevelProgress({
      campaignId: campaign.id,
      shopifyCustomerId: cleanCustomerId,
    }),
    getNotifications({
      recipientType: "CUSTOMER",
      recipientId: cleanCustomerId,
      campaignId: campaign.id,
      limit: 10,
    }),
    getUnreadNotificationCount({
      recipientType: "CUSTOMER",
      recipientId: cleanCustomerId,
      campaignId: campaign.id,
    }),
    getCustomerReward(campaign.id, cleanCustomerId),
    getPublicLeaderboard({
      campaignId: campaign.id,
      currentCustomerId: cleanCustomerId,
      limit: 10,
    }),
    getCustomerPointHistory(cleanCustomerId, campaign.id),
  ]);

  return new Response(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      progress: {
        totalPoints: levelProgress.progress.totalPoints,
        currentLevel: levelProgress.progress.currentLevel,
        status: levelProgress.progress.status,
        eligibleAt: levelProgress.progress.eligibleAt,
      },
      currentAvailableLevel: levelProgress.currentAvailableLevel,
      levels: levelProgress.levels,
      unreadCount,
      notifications: notifications.notifications,
      reward: reward
        ? {
            id: reward.id,
            discountCode: reward.discountCode,
            status: reward.status,
            rewardValue: reward.rewardValue,
            rewardType: reward.rewardType,
            prizeLabel: reward.prizeLabel,
            offerMessage: reward.offerMessage,
            expiresAt: reward.expiresAt,
          }
        : null,
      leaderboard: {
        currentCustomerRank: leaderboard.currentCustomerRank,
        totalParticipants: leaderboard.totalParticipants,
      },
      transactions: pointTransactions.slice(0, 10),
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  );
};
