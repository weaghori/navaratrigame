import prisma from "../db.server";
import { createNotification } from "./notification.server";
import { recordAuditEvent } from "./audit.server";

export interface Top25Candidate {
  rank: number;
  customerProgressId: string;
  shopifyCustomerId: string;
  totalPoints: number;
  currentLevel: number;
  status: string;
  eligibleAt: Date | null;
  completedAt: Date | null;
  isFinalizedWinner: boolean;
  rewardAssigned: boolean;
}

/**
 * Get the real-time calculated Top 25 participants before or after finalization
 */
export async function getTop25Calculated(campaignId: string): Promise<{
  candidates: Top25Candidate[];
  isFinalized: boolean;
  totalEligible: number;
}> {
  const [candidates, existingWinners, campaign] = await Promise.all([
    prisma.customerProgress.findMany({
      where: { campaignId },
      orderBy: [
        { totalPoints: "desc" },
        { completedAt: "asc" },
        { createdAt: "asc" },
      ],
      take: 25,
      include: {
        winner: true,
        rewards: true,
      },
    }),
    prisma.winner.findMany({
      where: { campaignId },
      orderBy: { rank: "asc" },
    }),
    prisma.campaign.findUnique({
      where: { id: campaignId },
    }),
  ]);

  const maxPoints = campaign?.maxPoints || 1000;
  const isFinalized = existingWinners.length >= 1;

  // Strict definition of eligible participants
  const totalEligible = await prisma.customerProgress.count({
    where: {
      campaignId,
      OR: [
        { totalPoints: { gte: maxPoints } },
        { eligibleAt: { not: null } },
      ],
    },
  });

  const formattedCandidates: Top25Candidate[] = candidates.map((p, index) => ({
    rank: index + 1,
    customerProgressId: p.id,
    shopifyCustomerId: p.shopifyCustomerId,
    totalPoints: p.totalPoints,
    currentLevel: p.currentLevel,
    status: p.status,
    eligibleAt: p.eligibleAt,
    completedAt: p.completedAt,
    isFinalizedWinner: Boolean(p.winner),
    rewardAssigned: p.rewards.some((r) => r.status === "issued"),
  }));

  return {
    candidates: formattedCandidates,
    isFinalized,
    totalEligible,
  };
}

/**
 * Admin action to officially finalize the Top 25 Winners in a database transaction.
 * Creates immutable Winner records and flags customer records as winners.
 * Generates WINNER notifications and audit logs.
 */
export async function finalizeTop25Winners({
  campaignId,
  adminUser,
}: {
  campaignId: string;
  adminUser?: string;
}) {
  const result = await prisma.$transaction(
    async (tx) => {
      const campaign = await tx.campaign.findUnique({
        where: { id: campaignId },
      });

      if (!campaign) {
        throw new Error("Campaign not found.");
      }

      const maxPoints = campaign.maxPoints || 1000;

      // Fetch eligible participants who met threshold or have highest completed scores
      let topParticipants = await tx.customerProgress.findMany({
        where: {
          campaignId,
          OR: [
            { totalPoints: { gte: maxPoints } },
            { eligibleAt: { not: null } },
          ],
        },
        orderBy: [
          { totalPoints: "desc" },
          { completedAt: "asc" },
          { createdAt: "asc" },
        ],
        take: 25,
      });

      // If no customers have reached maxPoints yet (e.g. testing), fall back to top scorers
      if (topParticipants.length === 0) {
        topParticipants = await tx.customerProgress.findMany({
          where: { campaignId, totalPoints: { gt: 0 } },
          orderBy: [
            { totalPoints: "desc" },
            { completedAt: "asc" },
            { createdAt: "asc" },
          ],
          take: 25,
        });
      }

      if (topParticipants.length === 0) {
        throw new Error("No active participants found to finalize as winners.");
      }

      const createdWinners = [];

      for (let i = 0; i < topParticipants.length; i++) {
        const participant = topParticipants[i];
        const rank = i + 1;

        // Upsert winner entry
        const winner = await tx.winner.upsert({
          where: {
            campaignId_rank: {
              campaignId,
              rank,
            },
          },
          update: {
            customerProgressId: participant.id,
            shopifyCustomerId: participant.shopifyCustomerId,
          },
          create: {
            campaignId,
            rank,
            customerProgressId: participant.id,
            shopifyCustomerId: participant.shopifyCustomerId,
            rewardAssigned: false,
          },
        });

        // Update customer progress status to winner
        await tx.customerProgress.update({
          where: { id: participant.id },
          data: {
            status: "winner",
          },
        });

        createdWinners.push({
          ...winner,
          customerId: participant.shopifyCustomerId,
          customerProgressId: participant.id,
        });
      }

      return {
        success: true,
        finalizedCount: createdWinners.length,
        winners: createdWinners,
        finalizedBy: adminUser || "Shopify Admin",
        campaign,
      };
    },
    { maxWait: 15000, timeout: 30000 },
  );

  // Trigger Notifications & Audit Log outside transaction
  try {
    for (const w of result.winners) {
      await createNotification({
        recipientType: "CUSTOMER",
        recipientId: w.customerId,
        campaignId,
        type: "WINNER",
        title: `🏆 You are an Official Winner (Rank #${w.rank})!`,
        message: `Congratulations! You placed Rank #${w.rank} in the Navratri Top 25. Your grand festive reward is ready to be issued!`,
        actionUrl: `/campaigns/${result.campaign.slug}`,
        idempotencyKey: `winner_${w.id}`,
      });
    }

    // Admin notification
    await createNotification({
      recipientType: "ADMIN",
      recipientId: "admin",
      campaignId,
      type: "TOP_25_CHANGE",
      title: "Top 25 Winners Finalized 🏆",
      message: `Finalized ${result.finalizedCount} winners for ${result.campaign.name}.`,
      actionUrl: "/app/winners",
      idempotencyKey: `admin_top25_${campaignId}`,
    });

    // Audit Event
    await recordAuditEvent({
      campaignId,
      eventType: "WINNER_FINALIZED",
      actorType: "ADMIN",
      actorId: adminUser || "Admin",
      metadata: {
        count: result.finalizedCount,
        campaignId,
      },
    });
  } catch (err) {
    console.error("Non-blocking notification error in finalizeTop25Winners:", err);
  }

  return result;
}

/**
 * Get all finalized winners with customer progress and reward details
 */
export async function getWinnersList(campaignId: string) {
  return prisma.winner.findMany({
    where: { campaignId },
    orderBy: { rank: "asc" },
    include: {
      customerProgress: {
        include: {
          rewards: true,
        },
      },
    },
  });
}

export async function pickRandomWinners({ campaignId, count, adminUser }: { campaignId: string, count: number, adminUser?: string }) {
  const result = await prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new Error("Campaign not found.");

    const existingWinners = await tx.winner.findMany({ where: { campaignId } });
    const existingIds = existingWinners.map(w => w.customerProgressId);

    const eligible = await tx.customerProgress.findMany({
      where: {
        campaignId,
        id: { notIn: existingIds },
        totalPoints: { gt: 0 }
      }
    });

    if (eligible.length === 0) throw new Error("No eligible candidates found.");

    // Shuffle and pick
    const shuffled = eligible.sort(() => 0.5 - Math.random());
    const picked = shuffled.slice(0, count);
    const startRank = existingWinners.length + 1;

    const createdWinners = [];
    for (let i = 0; i < picked.length; i++) {
      const participant = picked[i];
      const rank = startRank + i;
      
      const winner = await tx.winner.create({
        data: {
          campaignId,
          rank,
          customerProgressId: participant.id,
          shopifyCustomerId: participant.shopifyCustomerId,
          rewardAssigned: false,
        }
      });
      await tx.customerProgress.update({ where: { id: participant.id }, data: { status: "winner" } });
      createdWinners.push({ ...winner, customerId: participant.shopifyCustomerId });
    }
    return { success: true, count: createdWinners.length, winners: createdWinners, campaign };
  });

  // Notifications
  for (const w of result.winners) {
    await createNotification({
      recipientType: "CUSTOMER", recipientId: w.customerId, campaignId, type: "WINNER",
      title: `🏆 You are an Official Winner (Rank #${w.rank})!`,
      message: `Congratulations! You were selected as a winner in the Navratri campaign!`,
      actionUrl: `/campaigns/${result.campaign.slug}`, idempotencyKey: `winner_${w.id}`,
    });
  }
  return result;
}

export async function addManualWinner({ campaignId, shopifyCustomerId, adminUser }: { campaignId: string, shopifyCustomerId: string, adminUser?: string }) {
  const result = await prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new Error("Campaign not found.");

    let participant = await tx.customerProgress.findUnique({
      where: { campaignId_shopifyCustomerId: { campaignId, shopifyCustomerId } }
    });
    if (!participant) {
      participant = await tx.customerProgress.create({
        data: { campaignId, shopifyCustomerId, totalPoints: 0, currentLevel: 1 }
      });
    }

    const existing = await tx.winner.findFirst({ where: { campaignId, customerProgressId: participant.id } });
    if (existing) throw new Error("Customer is already a winner.");

    const existingWinnersCount = await tx.winner.count({ where: { campaignId } });
    const rank = existingWinnersCount + 1;

    const winner = await tx.winner.create({
      data: {
        campaignId, rank, customerProgressId: participant.id, shopifyCustomerId, rewardAssigned: false
      }
    });
    await tx.customerProgress.update({ where: { id: participant.id }, data: { status: "winner" } });

    return { success: true, winner: { ...winner, customerId: shopifyCustomerId }, campaign };
  });

  await createNotification({
    recipientType: "CUSTOMER", recipientId: result.winner.customerId, campaignId, type: "WINNER",
    title: `🏆 You are an Official Winner (Rank #${result.winner.rank})!`,
    message: `Congratulations! You were selected as a winner in the Navratri campaign!`,
    actionUrl: `/campaigns/${result.campaign.slug}`, idempotencyKey: `winner_${result.winner.id}`,
  });
  return result;
}
