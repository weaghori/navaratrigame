import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { deleteStoredMedia } from "../services/storage.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);
  const customerId = payload?.customer?.id ? String(payload.customer.id) : null;
  
  if (!customerId) {
    return new Response();
  }

  // Find submissions to delete their R2 media
  const submissions = await prisma.submission.findMany({
    where: {
      customerProgress: {
        shopifyCustomerId: customerId,
        campaign: { shop }
      },
      fileUrl: { not: null }
    }
  });

  for (const sub of submissions) {
    if (sub.fileUrl) {
      try {
        await deleteStoredMedia(sub.fileUrl);
      } catch (e) {
        console.error("Failed to delete media for submission", sub.id, e);
      }
    }
  }

  // Delete CustomerProgress (this cascades to Submissions, PointTransactions, Rewards, Winners)
  await prisma.customerProgress.deleteMany({
    where: { shopifyCustomerId: customerId, campaign: { shop } }
  });

  // Delete Referrals where they are referrer or referred
  await prisma.referral.deleteMany({
    where: {
      campaign: { shop },
      OR: [
        { referrerCustomerId: customerId },
        { referredCustomerId: customerId }
      ]
    }
  });

  // Delete AuditEvents involving this customer
  const shopCampaigns = await prisma.campaign.findMany({ where: { shop }, select: { id: true } });
  const campaignIds = shopCampaigns.map(c => c.id);
  
  if (campaignIds.length > 0) {
    await prisma.auditEvent.deleteMany({
      where: {
        campaignId: { in: campaignIds },
        OR: [
          { actorId: customerId, actorType: "CUSTOMER" },
          { targetId: customerId }
        ]
      }
    });
  }

  // Delete notifications sent to this customer
  if (campaignIds.length > 0) {
    await prisma.notification.deleteMany({
      where: {
        campaignId: { in: campaignIds },
        recipientId: customerId,
        recipientType: "CUSTOMER"
      }
    });
  }

  console.log(`[${topic}] Redacted customer ${customerId} on shop ${shop}`);
  return new Response();
};
