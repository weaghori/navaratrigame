import { PrismaClient } from "../generated/mongodb-runtime-client/index.js";

const prisma = new PrismaClient();

async function reconcile() {
  console.log("🔍 Reconciling database records for Navratri Campaign...\n");

  const campaign = await prisma.campaign.findFirst({
    where: { status: "active" },
  });

  if (!campaign) {
    console.log("No active campaign found.");
    return;
  }

  const allProgress = await prisma.customerProgress.findMany({
    where: { campaignId: campaign.id },
    include: {
      pointTransactions: true,
      submissions: true,
      winner: true,
    },
  });

  console.log(`Found ${allProgress.length} customer progress records in campaign "${campaign.name}".`);

  let updatedCount = 0;

  for (const p of allProgress) {
    // 1. Calculate actual sum of point transactions
    const txSum = p.pointTransactions.reduce((acc, t) => acc + t.points, 0);

    // If totalPoints differs from txSum, sync them
    if (p.totalPoints !== txSum) {
      console.log(`⚠️ Mismatch for customer ${p.shopifyCustomerId}: totalPoints=${p.totalPoints}, txSum=${txSum}`);

      // If customer has 1000 points but fewer transactions (e.g. from test script direct update),
      // backfill the missing transaction
      if (p.totalPoints === 1000 && txSum < 1000) {
        const diff = 1000 - txSum;
        await prisma.pointTransaction.create({
          data: {
            customerProgressId: p.id,
            points: diff,
            transactionType: "level_completed",
            description: "Completed Festive Challenge Finale (Reconciled)",
          },
        });
        console.log(`  -> Added missing ${diff} pts transaction.`);
      } else {
        // Sync totalPoints to actual transactions
        await prisma.customerProgress.update({
          where: { id: p.id },
          data: { totalPoints: txSum },
        });
        p.totalPoints = txSum;
        console.log(`  -> Synced totalPoints to ${txSum}.`);
      }
      updatedCount++;
    }

    // 2. Fix status: A customer with < 1000 points cannot have status 'winner' or 'eligible'
    if (p.totalPoints < campaign.maxPoints && (p.status === "winner" || p.status === "eligible")) {
      console.log(`⚠️ Customer ${p.shopifyCustomerId} has ${p.totalPoints} pts but status "${p.status}". Resetting to "active"...`);
      // Delete premature Winner record if any
      if (p.winner) {
        await prisma.winner.delete({ where: { id: p.winner.id } });
      }

      await prisma.customerProgress.update({
        where: { id: p.id },
        data: {
          status: "active",
          eligibleAt: null,
          completedAt: null,
        },
      });
      updatedCount++;
    }
  }

  // Check the resulting KPI calculations
  const [
    totalParticipants,
    completedParticipants,
    eligibleParticipants,
    pendingSubmissions,
    totalPointsSum,
  ] = await Promise.all([
    prisma.customerProgress.count({ where: { campaignId: campaign.id } }),
    prisma.customerProgress.count({
      where: {
        campaignId: campaign.id,
        OR: [
          { totalPoints: { gte: campaign.maxPoints } },
          { completedAt: { not: null } },
        ],
      },
    }),
    prisma.customerProgress.count({
      where: {
        campaignId: campaign.id,
        OR: [
          { totalPoints: { gte: campaign.maxPoints } },
          { eligibleAt: { not: null } },
        ],
      },
    }),
    prisma.submission.count({ where: { campaignId: campaign.id, status: "pending" } }),
    prisma.pointTransaction.aggregate({
      where: { customerProgress: { campaignId: campaign.id }, points: { gt: 0 } },
      _sum: { points: true },
    }),
  ]);

  console.log("\n✅ RECONCILIATION COMPLETE. Verified KPI values:");
  console.log(`  Participants:      ${totalParticipants}`);
  console.log(`  Completed:         ${completedParticipants}`);
  console.log(`  Eligible:          ${eligibleParticipants}`);
  console.log(`  Pending Reviews:   ${pendingSubmissions}`);
  console.log(`  Total Points:      ${totalPointsSum._sum.points || 0}`);
}

reconcile()
  .catch((e) => {
    console.error("Reconciliation error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
