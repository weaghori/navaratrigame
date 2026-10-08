import prisma from "../db.server";
import { getLevelAvailabilitySchedule } from "./campaign.server";
import { createNotification } from "./notification.server";
import { recordAuditEvent } from "./audit.server";

export interface GetOrCreateProgressInput {
  campaignId: string;
  shopifyCustomerId: string;
  displayName?: string | null;
}

export type LevelState = "LOCKED" | "AVAILABLE" | "PENDING" | "COMPLETED" | "REJECTED" | "EXPIRED";

export interface CustomerLevelInfo {
  id: string;
  levelNumber: number;
  title: string;
  description: string | null;
  activityType: string;
  points: number;
  config: unknown;
  isActive: boolean;
  state: LevelState;
  availableFrom?: string;
  availableUntil?: string;
  isAvailableNow?: boolean;
  submission?: {
    id: string;
    status: string;
    submissionType: string;
    textResponse: string | null;
    adminNote: string | null;
    createdAt: Date;
  } | null;
  pointTransaction?: {
    id: string;
    points: number;
    createdAt: Date;
  } | null;
}

/**
 * Concurrency-safe helper to get or create a customer's progress record
 */
export async function getOrCreateCustomerProgress({
  campaignId,
  shopifyCustomerId,
  displayName,
}: GetOrCreateProgressInput) {
  const cleanCustomerId = String(shopifyCustomerId).trim();
  const existing = await prisma.customerProgress.findUnique({
    where: {
      campaignId_shopifyCustomerId: {
        campaignId,
        shopifyCustomerId: cleanCustomerId,
      },
    },
    include: { campaign: true },
  });
  if (existing) {
    const cleanDisplayName = displayName?.trim().slice(0, 120);
    if (cleanDisplayName && existing.displayName !== cleanDisplayName) {
      return prisma.customerProgress.update({
        where: { id: existing.id },
        data: { displayName: cleanDisplayName },
        include: { campaign: true },
      });
    }
    return existing;
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const progress = await tx.customerProgress.create({
        data: {
          campaignId,
          shopifyCustomerId: cleanCustomerId,
          displayName: displayName?.trim().slice(0, 120) || null,
          totalPoints: 0,
          currentLevel: 1,
          status: "active",
        },
        include: { campaign: true },
      });

      // A progress row is the durable customer record for this campaign.
      // Record first-time registration alongside it, but never for the guest preview.
      if (cleanCustomerId !== "__guest_preview__") {
        await tx.auditEvent.create({
          data: {
            campaignId,
            eventType: "CUSTOMER_REGISTERED",
            actorType: "CUSTOMER",
            actorId: cleanCustomerId,
            targetId: progress.id,
            metadata: { shopifyCustomerId: cleanCustomerId },
          },
        });
      }

      return progress;
    });
  } catch (error) {
    // Another request may have created this customer concurrently.
    const raced = await prisma.customerProgress.findUnique({
      where: {
        campaignId_shopifyCustomerId: {
          campaignId,
          shopifyCustomerId: cleanCustomerId,
        },
      },
      include: { campaign: true },
    });
    if (raced) return raced;
    throw error;
  }
}

/**
 * Get customer progress with campaign details
 */
export async function getCustomerProgress({
  campaignId,
  shopifyCustomerId,
}: GetOrCreateProgressInput) {
  const cleanCustomerId = String(shopifyCustomerId).trim();

  return prisma.customerProgress.findUnique({
    where: {
      campaignId_shopifyCustomerId: {
        campaignId,
        shopifyCustomerId: cleanCustomerId,
      },
    },
    include: {
      campaign: true,
      pointTransactions: {
        orderBy: { createdAt: "desc" },
      },
      submissions: {
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

/**
 * Compute the authoritative state for all levels for a customer
 */
export async function getCustomerLevelProgress({
  campaignId,
  shopifyCustomerId,
  displayName,
}: GetOrCreateProgressInput) {
  const progress = await getOrCreateCustomerProgress({
    campaignId,
    shopifyCustomerId,
    displayName,
  });

  const [levels, transactions, submissions] = await Promise.all([
    prisma.level.findMany({
      where: { campaignId, isActive: true },
      orderBy: { levelNumber: "asc" },
    }),
    prisma.pointTransaction.findMany({
      where: { customerProgressId: progress.id },
    }),
    prisma.submission.findMany({
      where: { customerProgressId: progress.id },
      // Campaign progress needs submission status and feedback, not media URLs.
      select: {
        id: true,
        levelId: true,
        status: true,
        submissionType: true,
        textResponse: true,
        adminNote: true,
        createdAt: true,
      },
    }),
  ]);

  const transactionsByLevel = new Map<string, (typeof transactions)[0]>();
  for (const t of transactions) {
    // Per-question quiz awards grant points but don't complete the level until
    // the customer has answered every required quiz question correctly.
    if (t.levelId && !t.transactionType.startsWith("quiz_question_")) {
      transactionsByLevel.set(t.levelId, t);
    }
  }

  const submissionsByLevel = new Map<string, (typeof submissions)[0]>();
  for (const s of submissions) {
    submissionsByLevel.set(s.levelId, s);
  }

  let previousLevelCompleted = true;
  let previousLevelSubmitted = true;

  const levelProgressList: CustomerLevelInfo[] = levels.map((level) => {
    const transaction = transactionsByLevel.get(level.id);
    const submission = submissionsByLevel.get(level.id);

    // Compute timing relative to campaign
    const timing = getLevelAvailabilitySchedule(level, progress.campaign);

    let state: LevelState = "LOCKED";

    if (transaction || submission?.status === "approved") {
      state = "COMPLETED";
    } else if (submission?.status === "pending") {
      state = "PENDING";
    } else if (submission?.status === "rejected") {
      state = "REJECTED";
    } else if (timing.isExpired) {
      state = "EXPIRED";
    } else if (
      progress.campaign.unlockMode === "all_at_once" ||
      progress.campaign.unlockMode === "timed_interval" ||
      (progress.campaign.unlockMode === "after_submission" ? previousLevelSubmitted : previousLevelCompleted)
    ) {
      if (timing.isAvailableNow) {
        state = "AVAILABLE";
      } else {
        // Locked because it's scheduled for a future day
        state = "LOCKED";
      }
    } else {
      state = "LOCKED";
    }

    // A level is only completed if points are awarded / approved
    previousLevelCompleted = state === "COMPLETED";
    previousLevelSubmitted = state === "COMPLETED" || state === "PENDING";

    // Keep answer keys on the server so quiz and guessing answers cannot be read from loaders.
    let safeConfig: unknown = level.config;
    if (typeof safeConfig === "object" && safeConfig !== null && !Array.isArray(safeConfig)) {
      const sanitizedConfig = { ...(safeConfig as Record<string, unknown>) };
      if (level.levelNumber === 7 && level.activityType === "text_submission") {
        sanitizedConfig.instructions = "Look carefully at the product picture, then describe its benefits. Submit your response for review; points are awarded after approval.";
      }
      if (level.levelNumber === 10 && level.activityType === "text_submission") {
        sanitizedConfig.instructions = "Give us your feedback (20–500 characters), then see the finalized winners below. No points are awarded for Level 10.";
        sanitizedConfig.showWinnerAnnouncements = true;
      }
      if (level.activityType === "quiz") {
        delete sanitizedConfig.correctOption;
        if (Array.isArray(sanitizedConfig.questions)) {
          sanitizedConfig.questions = sanitizedConfig.questions.map((question) => {
            if (!question || typeof question !== "object" || Array.isArray(question)) return question;
            const publicQuestion = { ...(question as Record<string, unknown>) };
            delete publicQuestion.answer;
            delete publicQuestion.correctOption;
            delete publicQuestion.correctAnswer;
            return publicQuestion;
          });
        }
      }
      if (level.activityType === "movie_guess" || level.activityType === "audio_guess") {
        delete sanitizedConfig.answer;
        delete sanitizedConfig.acceptedAnswers;
      }
      safeConfig = sanitizedConfig;
    }

    return {
      id: level.id,
      levelNumber: level.levelNumber,
      title: level.title,
      description: level.description,
      activityType: level.activityType,
      points: level.levelNumber === 10 ? 0 : level.points,
      config: safeConfig,
      isActive: level.isActive,
      state,
      availableFrom: timing.availableFrom.toISOString(),
      availableUntil: timing.availableUntil.toISOString(),
      isAvailableNow: timing.isAvailableNow,
      submission: submission
        ? {
            id: submission.id,
            status: submission.status,
            submissionType: submission.submissionType,
            textResponse: submission.textResponse,
            adminNote: submission.adminNote,
            createdAt: submission.createdAt,
          }
        : null,
      pointTransaction: transaction
        ? {
            id: transaction.id,
            points: transaction.points,
            createdAt: transaction.createdAt,
          }
        : null,
    };
  });

  // This value is also used by the storefront to redact challenges that are
  // still locked. Use the highest unlocked level so all-at-once and timed
  // release modes can reveal more than just the first available challenge.
  const currentAvailableLevel = levelProgressList.reduce(
    (highest, level) =>
      ["AVAILABLE", "PENDING", "COMPLETED", "REJECTED"].includes(level.state)
        ? Math.max(highest, level.levelNumber)
        : highest,
    1,
  );

  return {
    progress,
    currentAvailableLevel,
    levels: levelProgressList,
  };
}

/**
 * Get point history for a customer
 */
export async function getCustomerPointHistory(shopifyCustomerId: string, campaignId?: string) {
  const customerProgress = {
    shopifyCustomerId: String(shopifyCustomerId).trim(),
    ...(campaignId ? { campaignId } : {}),
  };
  const [regularTransactions, quizTransactions] = await Promise.all([
    prisma.pointTransaction.findMany({
      where: { customerProgress, NOT: { transactionType: { startsWith: "quiz_question_" } }, transactionType: { not: "quiz_completed" } },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { level: true },
    }),
    prisma.pointTransaction.findMany({
      where: { customerProgress, OR: [{ transactionType: "quiz_completed" }, { transactionType: { startsWith: "quiz_question_" } }] },
      orderBy: { createdAt: "desc" },
      include: { level: true },
    }),
  ]);
  return [...regularTransactions, ...aggregateQuizTransactions(quizTransactions)]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 100);
}

export function aggregateQuizTransactions<T extends {
  id: string;
  customerProgressId: string;
  levelId: string | null;
  transactionType: string;
  points: number;
  description: string | null;
  createdAt: Date;
  level: { title: string; levelNumber: number } | null;
}>(transactions: T[]) {
  const groups = new Map<string, T[]>();
  for (const transaction of transactions) {
    const key = `${transaction.customerProgressId}:${transaction.levelId || "unknown"}`;
    groups.set(key, [...(groups.get(key) || []), transaction]);
  }
  return [...groups.values()].flatMap((group) => {
    const answers = group.filter((item) => item.transactionType.startsWith("quiz_question_"));
    const completion = group.find((item) => item.transactionType === "quiz_completed");
    const points = answers.length ? answers.reduce((sum, item) => sum + item.points, 0) : (completion?.points || 0);
    if (points === 0) return [];
    const latest = [...group].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return [{
      ...latest,
      id: `quiz-total:${latest.customerProgressId}:${latest.levelId || "unknown"}`,
      transactionType: "quiz_total",
      points,
      description: `${latest.level?.title || "Quiz"} • ${answers.length || 1} correct ${answers.length === 1 ? "answer" : "answers"}`,
    }];
  });
}

/**
 * Atomic point awarding inside a Prisma transaction with notifications and audit logging
 */
export async function awardPointsAtomic({
  customerProgressId,
  levelId,
  points,
  transactionType,
  description,
  referenceId,
}: {
  customerProgressId: string;
  levelId?: string;
  points: number;
  transactionType: string;
  description?: string;
  referenceId?: string;
}) {
  const result = await prisma.$transaction(
    async (tx) => {
      // 1. If levelId provided, check if points were already awarded for this level
      if (levelId) {
        const existingTx = await tx.pointTransaction.findFirst({
          where: {
            customerProgressId,
            levelId,
          },
        });

        if (existingTx) {
          throw new Error("Points have already been awarded for this level.");
        }
      }

      // 2. Fetch current customer progress
      const progress = await tx.customerProgress.findUnique({
        where: { id: customerProgressId },
        include: { campaign: true },
      });

      if (!progress) {
        throw new Error("Customer progress not found.");
      }

      // 3. Create PointTransaction
      const pointTx = await tx.pointTransaction.create({
        data: {
          customerProgressId,
          levelId,
          points,
          transactionType,
          description,
          referenceId,
        },
      });

      // 4. Calculate new total points
      const newTotalPoints = progress.totalPoints + points;
      const becameEligible = newTotalPoints >= progress.campaign.maxPoints && !progress.eligibleAt;

      // Only advance currentLevel if completing a level
      const newCurrentLevel = levelId
        ? Math.min(progress.currentLevel + 1, 9)
        : progress.currentLevel;

      // 5. Update customer progress
      const updatedProgress = await tx.customerProgress.update({
        where: { id: customerProgressId },
        data: {
          totalPoints: newTotalPoints,
          currentLevel: newCurrentLevel,
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
        progress: updatedProgress,
        pointTransaction: pointTx,
        becameEligible,
        campaign: progress.campaign,
      };
    },
    { maxWait: 15000, timeout: 30000 },
  );

  // Trigger Notifications & Audit Log outside transaction
  try {
    // 1. Customer points notification
    await createNotification({
      recipientType: "CUSTOMER",
      recipientId: result.progress.shopifyCustomerId,
      campaignId: result.campaign.id,
      type: "POINTS_EARNED",
      title: "Points Earned! 🪙",
      message: `You earned +${points} points for ${description || transactionType}. Total: ${result.progress.totalPoints} pts.`,
      actionUrl: `/campaigns/${result.campaign.slug}`,
      idempotencyKey: `pts_${result.pointTransaction.id}`,
    });

    // 2. Record Audit Event
    await recordAuditEvent({
      campaignId: result.campaign.id,
      eventType: "POINTS_AWARDED",
      actorType: "CUSTOMER",
      actorId: result.progress.shopifyCustomerId,
      targetId: result.pointTransaction.id,
      metadata: {
        points,
        transactionType,
        newTotal: result.progress.totalPoints,
      },
    });

    // 3. If milestone reached (1,000 points)
    if (result.becameEligible) {
      // Customer notification
      await createNotification({
        recipientType: "CUSTOMER",
        recipientId: result.progress.shopifyCustomerId,
        campaignId: result.campaign.id,
        type: "ELIGIBLE",
        title: "🎉 Congratulations! You reached 1,000 points!",
        message: "You have completed the challenge and unlocked eligibility for exclusive Navratri rewards.",
        actionUrl: `/campaigns/${result.campaign.slug}`,
        idempotencyKey: `elig_${result.progress.id}`,
      });

      // Admin notification
      await createNotification({
        recipientType: "ADMIN",
        recipientId: "admin",
        campaignId: result.campaign.id,
        type: "NEW_ELIGIBLE_CUSTOMER",
        title: "New Eligible Customer Reached 1,000 Points!",
        message: `Customer ${result.progress.shopifyCustomerId} has reached 1,000 points and is ready for reward issuance.`,
        actionUrl: "/app/rewards",
        idempotencyKey: `admin_elig_${result.progress.id}`,
      });

      // Audit Event
      await recordAuditEvent({
        campaignId: result.campaign.id,
        eventType: "ELIGIBILITY_REACHED",
        actorType: "CUSTOMER",
        actorId: result.progress.shopifyCustomerId,
        metadata: {
          totalPoints: result.progress.totalPoints,
        },
      });
    }

    // 4. Next level unlocked notification
    if (levelId && result.progress.currentLevel <= 10) {
      await createNotification({
        recipientType: "CUSTOMER",
        recipientId: result.progress.shopifyCustomerId,
        campaignId: result.campaign.id,
        type: "LEVEL_UNLOCKED",
        title: `Day ${result.progress.currentLevel} Unlocked! 🔓`,
        message: `Level ${result.progress.currentLevel} is now open for you. Complete today's challenge!`,
        actionUrl: `/campaigns/${result.campaign.slug}`,
        idempotencyKey: `lvl_unlock_${result.progress.id}_${result.progress.currentLevel}`,
      });
    }
  } catch (err) {
    console.error("Non-blocking notification/audit error:", err);
  }

  return {
    progress: result.progress,
    pointTransaction: result.pointTransaction,
  };
}

/**
 * Admin manual adjustment of customer points with reason
 */
export async function adjustPointsAdmin({
  customerProgressId,
  points,
  reason,
  adminUser,
}: {
  customerProgressId: string;
  points: number;
  reason: string;
  adminUser?: string;
}) {
  const result = await prisma.$transaction(
    async (tx) => {
      const progress = await tx.customerProgress.findUnique({
        where: { id: customerProgressId },
        include: { campaign: true },
      });

      if (!progress) {
        throw new Error("Customer progress not found");
      }

      const pointTx = await tx.pointTransaction.create({
        data: {
          customerProgressId,
          points,
          transactionType: "admin_adjustment",
          description: `Admin adjustment${adminUser ? ` by ${adminUser}` : ""}: ${reason}`,
        },
      });

      const newTotalPoints = Math.max(0, progress.totalPoints + points);
      const becameEligible = newTotalPoints >= progress.campaign.maxPoints && !progress.eligibleAt;

      const updatedProgress = await tx.customerProgress.update({
        where: { id: customerProgressId },
        data: {
          totalPoints: newTotalPoints,
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
        progress: updatedProgress,
        pointTransaction: pointTx,
        becameEligible,
        campaign: progress.campaign,
      };
    },
    { maxWait: 15000, timeout: 30000 },
  );

  // Trigger Notifications & Audit Log
  try {
    await recordAuditEvent({
      campaignId: result.campaign.id,
      eventType: "POINTS_AWARDED",
      actorType: "ADMIN",
      actorId: adminUser || "Admin",
      targetId: result.progress.shopifyCustomerId,
      metadata: {
        points,
        reason,
        newTotal: result.progress.totalPoints,
      },
    });

    if (result.becameEligible) {
      await createNotification({
        recipientType: "CUSTOMER",
        recipientId: result.progress.shopifyCustomerId,
        campaignId: result.campaign.id,
        type: "ELIGIBLE",
        title: "🎉 Congratulations! You reached 1,000 points!",
        message: "You have unlocked eligibility for the grand Navratri rewards.",
        actionUrl: `/campaigns/${result.campaign.slug}`,
        idempotencyKey: `elig_${result.progress.id}`,
      });
    }
  } catch (err) {
    console.error("Non-blocking notification/audit error:", err);
  }

  return {
    progress: result.progress,
    pointTransaction: result.pointTransaction,
  };
}
