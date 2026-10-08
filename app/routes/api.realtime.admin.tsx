import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getActiveCampaign, getCampaignStats } from "../services/campaign.server";
import { getUnreadNotificationCount, getNotifications } from "../services/notification.server";
import { getRecentAuditEvents } from "../services/audit.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    await authenticate.admin(request);
  } catch {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const campaign = await getActiveCampaign();
  if (!campaign) {
    return new Response(JSON.stringify({ campaign: null }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const [stats, unreadCount, recentNotifications, recentAuditEvents, recentSubmissions, recentTransactions] = await Promise.all([
    getCampaignStats(campaign.id),
    getUnreadNotificationCount({
      recipientType: "ADMIN",
      recipientId: "admin",
      campaignId: campaign.id,
    }),
    getNotifications({
      recipientType: "ADMIN",
      recipientId: "admin",
      campaignId: campaign.id,
      limit: 10,
    }),
    getRecentAuditEvents({
      campaignId: campaign.id,
      limit: 10,
    }),
    prisma.submission.findMany({
      where: { campaignId: campaign.id },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: {
        level: true,
        customerProgress: true,
      },
    }),
    prisma.pointTransaction.findMany({
      where: { customerProgress: { campaignId: campaign.id } },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: {
        level: true,
        customerProgress: true,
      },
    }),
  ]);

  return new Response(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      campaignId: campaign.id,
      stats,
      unreadCount,
      notifications: recentNotifications.notifications,
      auditEvents: recentAuditEvents,
      recentSubmissions: recentSubmissions.map((s) => ({
        ...s,
        createdAt: s.createdAt.toISOString(),
      })),
      recentTransactions: recentTransactions.map((t) => ({
        ...t,
        createdAt: t.createdAt.toISOString(),
      })),
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  );
};
