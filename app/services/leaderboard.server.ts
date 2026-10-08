import prisma from "../db.server";

export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  totalPoints: number;
  currentLevel: number;
  status: string;
  completedAt: Date | null;
  isCurrentCustomer?: boolean;
}

/**
 * Privacy-preserving customer name generator
 * Never reveals customer email or internal database IDs
 */
export function maskCustomerIdentifier(customerId: string, rank?: number): string {
  const clean = String(customerId).trim();
  if (!clean || clean.startsWith("demo_") || clean.startsWith("audit_")) {
    return rank ? `Festive Player #${rank}` : `Player #${clean.slice(-4)}`;
  }
  // Extract trailing digits or hash
  const digits = clean.replace(/\D/g, "");
  if (digits.length >= 4) {
    return `Player #${digits.slice(-4)}`;
  }
  return rank ? `Festive Player #${rank}` : `Participant #${clean.substring(0, 4)}***`;
}

/**
 * Get public customer-facing leaderboard with deterministic sorting and privacy masking
 */
export async function getPublicLeaderboard({
  campaignId,
  currentCustomerId,
  limit = 25,
}: {
  campaignId: string;
  currentCustomerId?: string;
  limit?: number;
}) {
  const participants = await prisma.customerProgress.findMany({
    where: { campaignId },
    orderBy: [
      { totalPoints: "desc" },
      { completedAt: "asc" },
      { createdAt: "asc" },
    ],
    take: limit,
  });

  const totalParticipants = await prisma.customerProgress.count({
    where: { campaignId },
  });

  let currentCustomerRank: number | null = null;
  let currentCustomerTotalPoints = 0;

  if (currentCustomerId) {
    const cleanCurrentId = String(currentCustomerId).trim();
    // Count how many participants have more points or earlier completion
    const currentProgress = await prisma.customerProgress.findUnique({
      where: {
        campaignId_shopifyCustomerId: {
          campaignId,
          shopifyCustomerId: cleanCurrentId,
        },
      },
    });

    if (currentProgress) {
      currentCustomerTotalPoints = currentProgress.totalPoints;
      const aheadCount = await prisma.customerProgress.count({
        where: {
          campaignId,
          OR: [
            { totalPoints: { gt: currentProgress.totalPoints } },
            {
              totalPoints: currentProgress.totalPoints,
              createdAt: { lt: currentProgress.createdAt },
            },
          ],
        },
      });
      currentCustomerRank = aheadCount + 1;
    }
  }

  const entries: LeaderboardEntry[] = participants.map((p, index) => {
    const rank = index + 1;
    const isCurrentCustomer =
      Boolean(currentCustomerId) && p.shopifyCustomerId === String(currentCustomerId).trim();

    return {
      rank,
      displayName: isCurrentCustomer ? "You" : maskCustomerIdentifier(p.shopifyCustomerId, rank),
      totalPoints: p.totalPoints,
      currentLevel: p.currentLevel,
      status: p.status,
      completedAt: p.completedAt,
      isCurrentCustomer,
    };
  });

  return {
    entries,
    totalParticipants,
    currentCustomerRank,
    currentCustomerTotalPoints,
  };
}

/**
 * Get full admin leaderboard with search and pagination
 */
export async function getAdminLeaderboard({
  campaignId,
  page = 1,
  limit = 50,
  search = "",
}: {
  campaignId: string;
  page?: number;
  limit?: number;
  search?: string;
}) {
  const where: Record<string, unknown> = { campaignId };

  if (search.trim()) {
    where.shopifyCustomerId = {
      contains: search.trim(),
      mode: "insensitive",
    };
  }

  const [participants, totalCount] = await Promise.all([
    prisma.customerProgress.findMany({
      where,
      orderBy: [
        { totalPoints: "desc" },
        { completedAt: "asc" },
        { createdAt: "asc" },
      ],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        winner: true,
        rewards: true,
        _count: {
          select: {
            submissions: true,
            pointTransactions: true,
          },
        },
      },
    }),
    prisma.customerProgress.count({ where }),
  ]);

  return {
    participants: participants.map((p, index) => ({
      rank: (page - 1) * limit + index + 1,
      id: p.id,
      shopifyCustomerId: p.shopifyCustomerId,
      totalPoints: p.totalPoints,
      currentLevel: p.currentLevel,
      status: p.status,
      eligibleAt: p.eligibleAt,
      completedAt: p.completedAt,
      createdAt: p.createdAt,
      isWinner: Boolean(p.winner),
      winnerRank: p.winner?.rank ?? null,
      rewardIssued: p.rewards.some((r) => r.status === "issued"),
      rewardCode: p.rewards.find((r) => r.status === "issued")?.discountCode ?? null,
      submissionsCount: p._count.submissions,
      transactionsCount: p._count.pointTransactions,
    })),
    totalCount,
    page,
    totalPages: Math.ceil(totalCount / limit),
  };
}
