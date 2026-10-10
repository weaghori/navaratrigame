import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  console.log("Retroactively awarding points for uncompleted purchases...");
  const allPurchases = await prisma.purchaseVerification.findMany({
    include: { customerProgress: true }
  });
  const pendingPurchases = allPurchases.filter(p => !p.completedAt);
  
  console.log(`Found ${pendingPurchases.length} pending purchases.`);
  
  for (const purchase of pendingPurchases) {
    const campaignId = purchase.campaignId;
    
    const level = await prisma.level.findFirst({
      where: { campaignId, levelNumber: 9, activityType: "purchase" },
      include: { campaign: true }
    });
    
    if (!level) continue;
    
    const existingAward = await prisma.pointTransaction.findFirst({
      where: { customerProgressId: purchase.customerProgressId, levelId: level.id },
      select: { id: true }
    });
    
    if (existingAward) {
        console.log(`Order ${purchase.shopifyOrderId} already has points awarded. Marking as completed.`);
        await prisma.purchaseVerification.update({
            where: { id: purchase.id },
            data: { completedAt: new Date() }
        });
        continue;
    }
    
    console.log(`Awarding ${level.points} points for order ${purchase.shopifyOrderId}...`);
    
    // In MongoDB we can't do interactive transactions with Prisma sometimes depending on the setup, 
    // but the app is doing it so we will try.
    await prisma.$transaction(async (tx) => {
      await tx.purchaseVerification.update({
        where: { id: purchase.id },
        data: { completedAt: new Date() },
      });

      const pointTx = await tx.pointTransaction.create({
        data: {
          customerProgressId: purchase.customerProgressId,
          levelId: level.id,
          points: level.points,
          transactionType: "purchase_verified",
          description: `Verified paid Shopify order ${purchase.orderName || purchase.shopifyOrderId}`,
          referenceId: purchase.shopifyOrderId,
        },
      });

      const updatedProgress = await tx.customerProgress.update({
        where: { id: purchase.customerProgressId },
        data: {
          totalPoints: { increment: level.points },
          currentLevel: Math.max(purchase.customerProgress.currentLevel, level.levelNumber + 1),
        },
      });

      if (updatedProgress.totalPoints >= level.campaign.maxPoints && !updatedProgress.eligibleAt) {
        await tx.customerProgress.update({
          where: { id: purchase.customerProgressId },
          data: { status: "eligible", eligibleAt: new Date(), completedAt: new Date() },
        });
      }

      await tx.auditEvent.create({
        data: {
          campaignId,
          eventType: "POINTS_AWARDED",
          actorType: "SYSTEM",
          actorId: `shopify-order:${purchase.shopifyOrderId}`,
          targetId: pointTx.id,
          metadata: { levelNumber: level.levelNumber, points: level.points, orderName: purchase.orderName },
        },
      });
    });
  }
  console.log("Done.");
}

run().catch(console.error).finally(() => prisma.$disconnect());
