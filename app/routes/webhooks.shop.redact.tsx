import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { deleteStoredMedia } from "../services/storage.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  
  // Find all submissions to delete R2 media
  const submissions = await prisma.submission.findMany({
    where: {
      campaign: { shop },
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

  // Delete all campaigns for this shop (cascades to Levels, CustomerProgress, Submissions, etc.)
  await prisma.campaign.deleteMany({
    where: { shop }
  });

  // Delete Session
  await prisma.session.deleteMany({
    where: { shop }
  });

  // Delete PurchaseVerifications for this shop
  await prisma.purchaseVerification.deleteMany({
    where: { shop }
  });

  console.log(`[${topic}] Redacted shop ${shop}`);
  return new Response();
};
