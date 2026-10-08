import prisma from "../db.server";
import { createNotification } from "./notification.server";
import { recordAuditEvent } from "./audit.server";

export interface ReferralHistoryItem {
  id: string;
  referredCustomerId: string | null;
  status: string;
  points: number;
  completedAt: Date | null;
  createdAt: Date;
}

/**
 * Generate a deterministic or randomized unique referral code for a customer in a campaign
 */
export async function getOrCreateReferralCode(campaignId: string, shopifyCustomerId: string): Promise<string> {
  const cleanCustomerId = String(shopifyCustomerId).trim();

  // Check if customer already has a referral record with a code
  const existing = await prisma.referral.findFirst({
    where: {
      campaignId,
      referrerCustomerId: cleanCustomerId,
    },
    select: { referralCode: true },
  });

  if (existing?.referralCode) {
    return existing.referralCode;
  }

  // Generate a clean alphanumeric code (e.g., NAV-K8X9Q2)
  const hashPart = Math.random().toString(36).substring(2, 8).toUpperCase();
  const referralCode = `NAV-${hashPart}`;

  // Create initial referrer entry
  await prisma.referral.create({
    data: {
      campaignId,
      referrerCustomerId: cleanCustomerId,
      referralCode,
      status: "pending",
      points: 0,
    },
  });

  return referralCode;
}

/**
 * Track when a user clicks/lands on a referral link
 */
export async function trackReferralVisit({
  campaignId,
  referralCode,
  referredCustomerId,
}: {
  campaignId: string;
  referralCode: string;
  referredCustomerId: string;
}) {
  const cleanReferredId = String(referredCustomerId).trim();

  // 1. Look up the referral template by code
  const referralRecord = await prisma.referral.findFirst({
    where: {
      campaignId,
      referralCode,
    },
  });

  if (!referralRecord) {
    return null;
  }

  // 2. Anti-fraud: Disallow self-referral
  if (referralRecord.referrerCustomerId === cleanReferredId) {
    return null;
  }

  // 3. Check if this customer was already referred for this campaign
  const existingFriend = await prisma.referral.findFirst({
    where: {
      campaignId,
      referredCustomerId: cleanReferredId,
    },
  });

  if (existingFriend) {
    return existingFriend;
  }

  // 4. If the found record already has a referredCustomerId, create a new link entry under same code
  if (referralRecord.referredCustomerId && referralRecord.referredCustomerId !== cleanReferredId) {
    return prisma.referral.create({
      data: {
        campaignId,
        referrerCustomerId: referralRecord.referrerCustomerId,
        referredCustomerId: cleanReferredId,
        referralCode,
        status: "pending",
        points: 0,
      },
    });
  }

  // 5. Update existing pending template record
  return prisma.referral.update({
    where: { id: referralRecord.id },
    data: {
      referredCustomerId: cleanReferredId,
    },
  });
}

/**
 * Qualify a referral and atomically award referral points to the referrer.
 * Called when the referred customer completes their first level or registration.
 */
export async function qualifyReferral({
  campaignId,
  referredCustomerId,
  pointsToAward = 100,
}: {
  campaignId: string;
  referredCustomerId: string;
  pointsToAward?: number;
}) {
  const cleanReferredId = String(referredCustomerId).trim();

  const result = await prisma.$transaction(async (tx) => {
    // 1. Find pending referral for this referred customer
    const referral = await tx.referral.findFirst({
      where: {
        campaignId,
        referredCustomerId: cleanReferredId,
        status: "pending",
      },
    });

    if (!referral) {
      return { success: false, reason: "No pending referral found for customer" };
    }

    // 2. Prevent self-referral
    if (referral.referrerCustomerId === cleanReferredId) {
      return { success: false, reason: "Self-referral is disallowed" };
    }

    // 3. Find referrer's CustomerProgress
    const referrerProgress = await tx.customerProgress.findUnique({
      where: {
        campaignId_shopifyCustomerId: {
          campaignId,
          shopifyCustomerId: referral.referrerCustomerId,
        },
      },
      include: { campaign: true },
    });

    if (!referrerProgress) {
      return { success: false, reason: "Referrer progress record not found" };
    }

    // 4. Check for duplicate point transaction
    const existingTx = await tx.pointTransaction.findFirst({
      where: {
        customerProgressId: referrerProgress.id,
        transactionType: "referral_completed",
        referenceId: referral.id,
      },
    });

    if (existingTx) {
      return { success: false, reason: "Referral points already awarded for this referral" };
    }

    // 5. Update referral status to completed
    const updatedReferral = await tx.referral.update({
      where: { id: referral.id },
      data: {
        status: "completed",
        points: pointsToAward,
        completedAt: new Date(),
      },
    });

    // 6. Create PointTransaction for referrer
    const pointTx = await tx.pointTransaction.create({
      data: {
        customerProgressId: referrerProgress.id,
        points: pointsToAward,
        transactionType: "referral_completed",
        referenceId: referral.id,
        description: `Referral Bonus: Friend (${cleanReferredId.substring(0, 6)}...) joined the challenge!`,
      },
    });

    // 7. Update referrer's total points (do NOT advance currentLevel)
    const newTotal = referrerProgress.totalPoints + pointsToAward;
    const isCompleted = newTotal >= referrerProgress.campaign.maxPoints;
    const becameEligible = isCompleted && !referrerProgress.eligibleAt;

    const updatedProgress = await tx.customerProgress.update({
      where: { id: referrerProgress.id },
      data: {
        totalPoints: newTotal,
        ...(becameEligible
          ? {
              status: "eligible",
              eligibleAt: new Date(),
              completedAt: new Date(),
            }
          : {}),
      },
    });

    return {
      success: true,
      referral: updatedReferral,
      pointTransaction: pointTx,
      pointsAwarded: pointsToAward,
      referrerProgress: updatedProgress,
      campaign: referrerProgress.campaign,
      becameEligible,
    };
  }, { maxWait: 15000, timeout: 30000 });

  if (result.success && result.referrerProgress) {
    try {
      const referrerId = result.referrerProgress.shopifyCustomerId;

      // Customer Notification
      await createNotification({
        recipientType: "CUSTOMER",
        recipientId: referrerId,
        campaignId,
        type: "POINTS_EARNED",
        title: `+${pointsToAward} Referral Bonus Points! 🤝`,
        message: `Your invited friend joined and completed their first challenge!`,
        actionUrl: `/campaigns/${result.campaign.slug}`,
        idempotencyKey: `ref_pts_${result.pointTransaction?.id}`,
      });

      // Admin Notification
      await createNotification({
        recipientType: "ADMIN",
        recipientId: "admin",
        campaignId,
        type: "REFERRAL_COMPLETED",
        title: "Referral Completed 🤝",
        message: `Customer ${referrerId} earned referral bonus from ${cleanReferredId}.`,
        actionUrl: "/app/leaderboard",
        idempotencyKey: `admin_ref_${result.referral?.id}`,
      });

      // Audit Log
      await recordAuditEvent({
        campaignId,
        eventType: "REFERRAL_COMPLETED",
        actorType: "CUSTOMER",
        actorId: referrerId,
        targetId: cleanReferredId,
        metadata: {
          pointsAwarded: pointsToAward,
          referralId: result.referral?.id,
        },
      });

      // If became eligible
      if (result.becameEligible) {
        await createNotification({
          recipientType: "CUSTOMER",
          recipientId: referrerId,
          campaignId,
          type: "ELIGIBLE",
          title: "🎉 Congratulations! You reached 1,000 points!",
          message: "You have completed the challenge and unlocked eligibility for exclusive Navratri rewards.",
          actionUrl: `/campaigns/${result.campaign.slug}`,
          idempotencyKey: `elig_${result.referrerProgress.id}`,
        });

        await createNotification({
          recipientType: "ADMIN",
          recipientId: "admin",
          campaignId,
          type: "NEW_ELIGIBLE_CUSTOMER",
          title: "New Eligible Customer (1,000 pts)!",
          message: `Customer ${referrerId} reached 1,000 points.`,
          actionUrl: "/app/rewards",
          idempotencyKey: `admin_elig_${result.referrerProgress.id}`,
        });
      }
    } catch (e) {
      console.error("Non-blocking notification error in qualifyReferral:", e);
    }
  }

  return result;
}

/**
 * Get customer's referral dashboard details
 */
export async function getCustomerReferralStats(campaignId: string, shopifyCustomerId: string) {
  const cleanCustomerId = String(shopifyCustomerId).trim();
  const referralCode = await getOrCreateReferralCode(campaignId, cleanCustomerId);

  const referrals = await prisma.referral.findMany({
    where: {
      campaignId,
      referrerCustomerId: cleanCustomerId,
      referredCustomerId: { not: null },
    },
    orderBy: { createdAt: "desc" },
  });

  const totalInvited = referrals.length;
  const completedReferrals = referrals.filter((r) => r.status === "completed").length;
  const totalEarnedPoints = referrals
    .filter((r) => r.status === "completed")
    .reduce((sum, r) => sum + r.points, 0);

  return {
    referralCode,
    totalInvited,
    completedReferrals,
    totalEarnedPoints,
    referrals: referrals.map((r) => ({
      id: r.id,
      referredCustomerId: r.referredCustomerId,
      status: r.status,
      points: r.points,
      completedAt: r.completedAt,
      createdAt: r.createdAt,
    })),
  };
}
