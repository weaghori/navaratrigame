import prisma from "../db.server";

export interface CreateCampaignInput {
  shop?: string;
  name: string;
  slug: string;
  description?: string;
  startDate: Date;
  endDate: Date;
  status?: string;
  maxPoints?: number;
  unlockMode?: string;
  unlockIntervalHours?: number;
}

export interface UpdateCampaignInput {
  name?: string;
  description?: string;
  startDate?: Date;
  endDate?: Date;
  status?: string;
  maxPoints?: number;
  unlockMode?: string;
  unlockIntervalHours?: number;
}

export type CampaignTimeStatus = "UPCOMING" | "ACTIVE" | "PAUSED" | "COMPLETED";

export const CAMPAIGN_TIMEZONE = "Asia/Kolkata";
// IST is UTC+5:30 = 330 minutes
export const IST_OFFSET_MINUTES = 330;

/**
 * Determine campaign time status relative to Asia/Kolkata timezone
 */
export function getCampaignTimeStatus(
  campaign: {
    startDate: Date;
    endDate: Date;
    status: string;
  },
  customNow?: Date,
): CampaignTimeStatus {
  // If explicitly paused in admin
  if (campaign.status === "paused") {
    return "PAUSED";
  }

  const now = customNow ? customNow.getTime() : Date.now();
  const startMs = new Date(campaign.startDate).getTime();
  const endMs = new Date(campaign.endDate).getTime();

  if (now < startMs) {
    return "UPCOMING";
  }

  if (now > endMs || campaign.status === "completed") {
    return "COMPLETED";
  }

  return "ACTIVE";
}

/**
 * Calculate the availability window for a level relative to campaign start in Asia/Kolkata
 */
export function getLevelAvailabilitySchedule(
  level: {
    levelNumber: number;
    availableFrom?: Date | null;
    availableUntil?: Date | null;
  },
  campaign: {
    startDate: Date;
    endDate: Date;
    unlockMode?: string | null;
    unlockIntervalHours?: number | null;
  },
  customNow?: Date,
): {
  isAvailableNow: boolean;
  isExpired: boolean;
  availableFrom: Date;
  availableUntil: Date;
} {
  const now = customNow ? customNow.getTime() : Date.now();
  const mode = campaign.unlockMode || "sequential";
  let availableFrom: Date;

  if (level.availableFrom) {
    availableFrom = new Date(level.availableFrom);
  } else if (mode === "all_at_once" || mode === "after_submission") {
    availableFrom = new Date(campaign.startDate);
  } else if (mode === "timed_interval") {
    const intervalHours = Math.max(1, Number(campaign.unlockIntervalHours) || 24);
    availableFrom = new Date(campaign.startDate.getTime() + (level.levelNumber - 1) * intervalHours * 60 * 60 * 1000);
  } else if (level.levelNumber === 1) {
    availableFrom = new Date(campaign.startDate);
  } else {
    // Preserve the existing sequential schedule: each level starts at midnight IST.
    const istTimeMs = campaign.startDate.getTime() + (330 * 60 * 1000);
    const istDate = new Date(istTimeMs);
    istDate.setUTCHours(0, 0, 0, 0);
    istDate.setUTCDate(istDate.getUTCDate() + (level.levelNumber - 1));
    availableFrom = new Date(istDate.getTime() - (330 * 60 * 1000));
  }

  const availableUntil = level.availableUntil ? new Date(level.availableUntil) : new Date(campaign.endDate);
  return {
    isAvailableNow: now >= availableFrom.getTime() && now <= availableUntil.getTime(),
    isExpired: now > availableUntil.getTime(),
    availableFrom,
    availableUntil,
  };
}
/**
 * Find campaign by unique shop + slug (multi-store isolated)
 */
export async function getCampaignBySlug(slug: string, shop?: string) {
  if (shop) {
    const campaign = await prisma.campaign.findUnique({
      where: { shop_slug: { shop, slug } },
    });
    if (campaign) return campaign;
  }
  // Fallback for non-proxy (admin) context or unmapped shop domain: find by slug only
  return prisma.campaign.findFirst({
    where: { slug },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Find the currently active campaign for a shop. Without a shop, use the
 * most recent active campaign for single-store/internal contexts.
 */
export async function getActiveCampaign(shop?: string) {
  const shopFilter = shop ? { shop } : {};
  const active = await prisma.campaign.findFirst({
    where: { ...shopFilter, status: "active" },
    orderBy: { createdAt: "desc" },
    include: {
      levels: {
        orderBy: { levelNumber: "asc" },
      },
    },
  });

  if (active) return active;

  // Never return another shop's campaign when the request has a shop context.
  if (shop) return null;

  // Fallback to latest active campaign for non-shop-specific callers.
  return prisma.campaign.findFirst({
    where: { status: "active" },
    orderBy: { createdAt: "desc" },
    include: {
      levels: {
        orderBy: { levelNumber: "asc" },
      },
    },
  });
}

/**
 * Get campaign with all levels sorted by levelNumber (admin context — by id or slug)
 */
export async function getCampaignWithLevels(campaignIdOrSlug: string, shop?: string) {
  const shopFilter = shop ? { shop } : {};
  return prisma.campaign.findFirst({
    where: {
      ...shopFilter,
      OR: [{ id: campaignIdOrSlug }, { slug: campaignIdOrSlug }],
    },
    include: {
      levels: {
        orderBy: { levelNumber: "asc" },
      },
    },
  });
}


/**
 * Get top-level dashboard statistics for a campaign with mathematically strict definitions
 */
export async function getCampaignStats(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
  });

  const maxPoints = campaign?.maxPoints || 1000;

  const [
    totalParticipants,
    completedParticipants,
    eligibleParticipants,
    pendingSubmissions,
    approvedSubmissions,
    totalPointsSum,
  ] = await Promise.all([
    // Total unique participants
    prisma.customerProgress.count({
      where: { campaignId },
    }),
    // Completed entire campaign (completedAt timestamp or reached maxPoints)
    prisma.customerProgress.count({
      where: {
        campaignId,
        OR: [
          { totalPoints: { gte: maxPoints } },
          { completedAt: { not: null } },
        ],
      },
    }),
    // Eligible (reached threshold totalPoints >= maxPoints or eligibleAt set)
    prisma.customerProgress.count({
      where: {
        campaignId,
        OR: [
          { totalPoints: { gte: maxPoints } },
          { eligibleAt: { not: null } },
        ],
      },
    }),
    // Pending submissions awaiting review
    prisma.submission.count({
      where: {
        campaignId,
        status: "pending",
      },
    }),
    // Approved submissions
    prisma.submission.count({
      where: {
        campaignId,
        status: "approved",
      },
    }),
    // Total points awarded strictly from valid PointTransaction records
    prisma.pointTransaction.aggregate({
      where: {
        customerProgress: { campaignId },
        points: { gt: 0 },
      },
      _sum: {
        points: true,
      },
    }),
  ]);

  return {
    totalParticipants,
    completedParticipants,
    eligibleParticipants,
    pendingSubmissions,
    approvedSubmissions,
    totalPointsAwarded: totalPointsSum._sum.points || 0,
  };
}

/**
 * Update campaign details safely
 */
export async function updateCampaign(id: string, data: UpdateCampaignInput) {
  const current = await prisma.campaign.findUniqueOrThrow({ where: { id } });
  const scheduleChanged =
    (data.startDate && data.startDate.getTime() !== current.startDate.getTime()) ||
    (data.endDate && data.endDate.getTime() !== current.endDate.getTime());

  return prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.update({ where: { id }, data });

    if (scheduleChanged) {
      await tx.pointTransaction.deleteMany({
        where: { customerProgress: { campaignId: id } },
      });
      await tx.submission.deleteMany({ where: { campaignId: id } });
      await tx.purchaseVerification.deleteMany({ where: { campaignId: id } });
      await tx.referral.deleteMany({ where: { campaignId: id } });
      await tx.winner.deleteMany({ where: { campaignId: id } });
      await tx.notification.deleteMany({ where: { campaignId: id, recipientType: "CUSTOMER" } });
      await tx.auditEvent.deleteMany({ where: { campaignId: id, eventType: "SPIN_PRIZE_SELECTED" } });
      await tx.reward.updateMany({
        where: { campaignId: id, status: { in: ["issued", "pending"] } },
        data: { status: "cancelled" },
      });
      await tx.customerProgress.updateMany({
        where: { campaignId: id },
        data: {
          totalPoints: 0,
          currentLevel: 1,
          status: "active",
          eligibleAt: null,
          completedAt: null,
        },
      });
    }

    return { campaign, pointsReset: Boolean(scheduleChanged) };
  }, {
    // Schedule changes clear several campaign tables in one atomic reset. The
    // default 5s interactive transaction timeout can expire before cleanup
    // reaches later delegates (for example auditEvent.deleteMany on Supabase).
    maxWait: 10_000,
    timeout: 60_000,
  });
}

/**
 * Create or upsert a campaign
 */
export async function upsertCampaign(data: CreateCampaignInput) {
  const shop = data.shop || "demo-store.myshopify.com";
  return prisma.campaign.upsert({
    where: {
      shop_slug: {
        shop,
        slug: data.slug,
      },
    },
    update: {
      name: data.name,
      description: data.description,
      startDate: data.startDate,
      endDate: data.endDate,
      status: data.status,
      maxPoints: data.maxPoints,
    },
    create: {
      ...data,
      shop,
    },
  });
}
