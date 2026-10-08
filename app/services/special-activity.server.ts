import prisma from "../db.server";
import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { getCampaignTimeStatus, getLevelAvailabilitySchedule } from "./campaign.server";
import { createNotification } from "./notification.server";
import { createWheelDiscountCode, deactivateWheelDiscountCode, type WheelDiscountAdminClient } from "./reward.server";

type Config = Record<string, unknown>;

function normalizeGuess(value: string) {
  return value.normalize("NFKD").toLocaleLowerCase().replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

const MOVIE_GUESS_MAX_ATTEMPTS = 3;

export async function recordMovieGuessAttempt({ campaignId, levelId, shopifyCustomerId, answer }: {
  campaignId: string;
  levelId: string;
  shopifyCustomerId: string;
  answer: string;
}) {
  const customerId = String(shopifyCustomerId).trim();
  const guess = normalizeGuess(answer);
  if (!guess) throw new Error("Enter a movie name before submitting.");

  return prisma.$transaction(async (tx) => {
    const level = await tx.level.findUnique({ where: { id: levelId }, include: { campaign: true } });
    if (!level || level.campaignId !== campaignId || level.activityType !== "movie_guess" || !level.isActive) {
      throw new Error("This movie challenge is unavailable.");
    }
    if (getCampaignTimeStatus(level.campaign) !== "ACTIVE") throw new Error("The campaign is not active.");
    const schedule = getLevelAvailabilitySchedule(level, level.campaign);
    if (!schedule.isAvailableNow) throw new Error(schedule.isExpired ? "This challenge has expired." : "This challenge is not available yet.");

    const progress = await tx.customerProgress.upsert({
      where: { campaignId_shopifyCustomerId: { campaignId, shopifyCustomerId: customerId } },
      update: {},
      create: { campaignId, shopifyCustomerId: customerId },
    });
    if (await tx.pointTransaction.findFirst({ where: { customerProgressId: progress.id, levelId } })) {
      throw new Error("You have already completed this level.");
    }
    if (level.levelNumber > 1 && !["all_at_once", "timed_interval"].includes(level.campaign.unlockMode || "sequential")) {
      const previous = await tx.level.findFirst({ where: { campaignId, levelNumber: level.levelNumber - 1 } });
      if (previous) {
        const completed = await tx.pointTransaction.findFirst({ where: { customerProgressId: progress.id, levelId: previous.id } });
        const priorSubmission = level.campaign.unlockMode === "after_submission"
          ? await tx.submission.findUnique({
              where: { levelId_customerProgressId: { levelId: previous.id, customerProgressId: progress.id } },
              select: { status: true },
            })
          : null;
        if (!completed && priorSubmission?.status !== "pending" && priorSubmission?.status !== "approved") {
          throw new Error(`Complete Level ${previous.levelNumber} first.`);
        }
      }
    }

    const attemptsUsed = await tx.auditEvent.count({
      where: { campaignId, targetId: levelId, actorId: customerId, eventType: "MOVIE_GUESS_ATTEMPT" },
    });
    if (attemptsUsed >= MOVIE_GUESS_MAX_ATTEMPTS) {
      return { isCorrect: false, attemptsUsed, attemptsRemaining: 0, exhausted: true };
    }

    const config = (level.config as Config | null) || {};
    const accepted = [config.answer, ...(Array.isArray(config.acceptedAnswers) ? config.acceptedAnswers : [])]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map(normalizeGuess);
    const isCorrect = accepted.includes(guess);
    const nextAttempt = attemptsUsed + 1;
    await tx.auditEvent.create({
      data: {
        campaignId,
        eventType: "MOVIE_GUESS_ATTEMPT",
        actorType: "CUSTOMER",
        actorId: customerId,
        targetId: levelId,
        metadata: { attempt: nextAttempt, correct: isCorrect },
      },
    });
    return {
      isCorrect,
      attemptsUsed: nextAttempt,
      attemptsRemaining: MOVIE_GUESS_MAX_ATTEMPTS - nextAttempt,
      exhausted: false,
    };
  }, { maxWait: 10_000, timeout: 15_000 });
}

type WheelPrize = { label: string; discountPercent: number; index: number };
type SignedWheelPrize = WheelPrize & {
  campaignId: string;
  levelId: string;
  customerId: string;
  attemptId: string;
  expiresAt: number;
};

function requireShopifyCustomerId(customerId: string) {
  const cleanId = String(customerId).trim();
  if (!/^(?:\d+|gid:\/\/shopify\/Customer\/\d+)$/.test(cleanId)) {
    throw new Error("Please sign in to your Aghori Store customer account before spinning. A signed-in account is needed for a personal checkout code.");
  }
  return cleanId;
}

function configuredWheelPrizes(config: Config): WheelPrize[] {
  const rewards = Array.isArray(config.rewards) ? config.rewards : ["10% OFF", "15% OFF", "20% OFF"];
  return rewards.flatMap((item) => {
    const option = typeof item === "string" ? { label: item } : item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
    const label = String(option.label || "").trim();
    if (!label) return [];
    const match = label.match(/(\d+(?:\.\d+)?)\s*%/);
    const discountPercent = Math.round(Number(option.discountPercent) || (match ? Number(match[1]) : Number(config.discountPercent) || 10));
    if (!Number.isFinite(discountPercent) || discountPercent < 1 || discountPercent > 100) return [];
    return [{ label, discountPercent, index: 0 }];
  }).map((prize, index) => ({ ...prize, index }));
}

function signWheelPrize(prize: SignedWheelPrize) {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) throw new Error("Spin & Win security is not configured.");
  const payload = Buffer.from(JSON.stringify(prize)).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyWheelPrizeToken(token: string, expected: Pick<SignedWheelPrize, "campaignId" | "levelId" | "customerId">) {
  const secret = process.env.SHOPIFY_API_SECRET;
  const [encoded, signature] = token.split(".");
  if (!secret || !encoded || !signature) throw new Error("Please start the Spin & Win challenge again.");
  const expectedSignature = createHmac("sha256", secret).update(encoded).digest();
  const actualSignature = Buffer.from(signature, "base64url");
  if (actualSignature.length !== expectedSignature.length || !timingSafeEqual(actualSignature, expectedSignature)) {
    throw new Error("This wheel result is invalid. Please spin again.");
  }
  const prize = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SignedWheelPrize;
  if (prize.campaignId !== expected.campaignId || prize.levelId !== expected.levelId || prize.customerId !== expected.customerId) {
    throw new Error("This wheel result belongs to a different challenge or customer.");
  }
  if (prize.expiresAt < Date.now()) throw new Error("This wheel result expired. Please refresh the challenge and spin again.");
  return prize;
}

export async function prepareWheelSpin({ campaignId, levelId, shopifyCustomerId }: {
  campaignId: string;
  levelId: string;
  shopifyCustomerId: string;
}) {
  const customerId = requireShopifyCustomerId(shopifyCustomerId);
  return prisma.$transaction(async (tx) => {
    const level = await tx.level.findUnique({ where: { id: levelId }, include: { campaign: true } });
    if (!level || level.campaignId !== campaignId || level.activityType !== "spin_wheel" || !level.isActive) {
      throw new Error("This Spin & Win challenge is unavailable.");
    }
    if (getCampaignTimeStatus(level.campaign) !== "ACTIVE") throw new Error("The campaign is not active.");
    const schedule = getLevelAvailabilitySchedule(level, level.campaign);
    if (!schedule.isAvailableNow) throw new Error(schedule.isExpired ? "This challenge has expired." : "This challenge is not available yet.");
    const progress = await tx.customerProgress.upsert({
      where: { campaignId_shopifyCustomerId: { campaignId, shopifyCustomerId: customerId } },
      update: {},
      create: { campaignId, shopifyCustomerId: customerId },
    });
    if (level.levelNumber > 1 && !["all_at_once", "timed_interval"].includes(level.campaign.unlockMode || "sequential")) {
      const previous = await tx.level.findFirst({ where: { campaignId, levelNumber: level.levelNumber - 1 } });
      const completed = previous ? await tx.pointTransaction.findFirst({ where: { customerProgressId: progress.id, levelId: previous.id } }) : null;
      const priorSubmission = previous && level.campaign.unlockMode === "after_submission"
        ? await tx.submission.findUnique({
            where: { levelId_customerProgressId: { levelId: previous.id, customerProgressId: progress.id } },
            select: { status: true },
          })
        : null;
      if (previous && !completed && priorSubmission?.status !== "pending" && priorSubmission?.status !== "approved") {
        throw new Error(`Complete Level ${previous.levelNumber} first.`);
      }
    }
    if (await tx.pointTransaction.findFirst({ where: { customerProgressId: progress.id, levelId } })) {
      throw new Error("You have already completed this level.");
    }

    const pendingAttempt = await tx.auditEvent.findFirst({
      where: { campaignId, targetId: levelId, actorId: customerId, eventType: "SPIN_PRIZE_SELECTED" },
      orderBy: { createdAt: "desc" },
    });
    if (pendingAttempt?.metadata && typeof pendingAttempt.metadata === "object") {
      const saved = pendingAttempt.metadata as Record<string, unknown>;
      if (typeof saved.token === "string") {
        try {
          const prize = verifyWheelPrizeToken(saved.token, { campaignId, levelId, customerId });
          return { label: prize.label, discountPercent: prize.discountPercent, index: prize.index, token: saved.token };
        } catch {
          await tx.auditEvent.delete({ where: { id: pendingAttempt.id } });
        }
      }
    }

    const prizes = configuredWheelPrizes((level.config as Config | null) || {});
    if (!prizes.length) throw new Error("Add at least one valid wheel prize with a 1–100% discount.");
    const selected = prizes[randomInt(prizes.length)];
    const token = signWheelPrize({
      ...selected,
      campaignId,
      levelId,
      customerId,
      attemptId: randomUUID(),
      expiresAt: Date.now() + 12 * 60 * 60 * 1000,
    });
    await tx.auditEvent.create({
      data: {
        campaignId,
        eventType: "SPIN_PRIZE_SELECTED",
        actorType: "CUSTOMER",
        actorId: customerId,
        targetId: levelId,
        metadata: { token, label: selected.label, discountPercent: selected.discountPercent },
      },
    });
    return { ...selected, token };
  }, { maxWait: 10_000, timeout: 15_000 });
}

export async function completeSpecialActivity({
  campaignId,
  levelId,
  levelNumber,
  shopifyCustomerId,
  answer,
  productHandle,
  collectionHandle,
  attempts,
  adminGraphqlClient,
  spinAttemptToken,
}: {
  campaignId: string;
  levelId?: string;
  levelNumber?: number;
  shopifyCustomerId: string;
  answer?: string;
  productHandle?: string;
  collectionHandle?: string;
  attempts?: number;
  adminGraphqlClient?: WheelDiscountAdminClient;
  spinAttemptToken?: string;
}) {
  const cleanCustomerId = String(shopifyCustomerId).trim();
  if (spinAttemptToken) requireShopifyCustomerId(cleanCustomerId);

  // Never hold a database transaction open while Shopify creates a discount.
  // Admin GraphQL can take longer than Prisma's interactive transaction limit,
  // leaving later audit writes with a closed transaction handle.
  let preparedWheelCode: { code: string; discountId: string; expiresAt: Date } | undefined;
  if (spinAttemptToken) {
    const level = levelId
      ? await prisma.level.findUnique({ where: { id: levelId }, include: { campaign: true } })
      : await prisma.level.findFirst({ where: { campaignId, levelNumber }, include: { campaign: true } });
    if (!level || level.campaignId !== campaignId || level.activityType !== "spin_wheel" || !level.isActive) {
      throw new Error("This Spin & Win challenge is unavailable.");
    }
    if (getCampaignTimeStatus(level.campaign) !== "ACTIVE") throw new Error("The campaign is not active.");
    const schedule = getLevelAvailabilitySchedule(level, level.campaign);
    if (!schedule.isAvailableNow) throw new Error(schedule.isExpired ? "This challenge has expired." : "This challenge is not available yet.");
    const config = (level.config as Config | null) || {};
    const signedPrize = verifyWheelPrizeToken(spinAttemptToken, { campaignId, levelId: level.id, customerId: cleanCustomerId });
    const configuredPrize = configuredWheelPrizes(config)[signedPrize.index];
    if (!configuredPrize || configuredPrize.label !== signedPrize.label || configuredPrize.discountPercent !== signedPrize.discountPercent) {
      throw new Error("The wheel prizes changed. Refresh the challenge and spin again.");
    }
    const [savedAttempt, progress] = await Promise.all([
      prisma.auditEvent.findFirst({
        where: { campaignId, targetId: level.id, actorId: cleanCustomerId, eventType: "SPIN_PRIZE_SELECTED" },
        orderBy: { createdAt: "desc" },
      }),
      prisma.customerProgress.findUnique({ where: { campaignId_shopifyCustomerId: { campaignId, shopifyCustomerId: cleanCustomerId } } }),
    ]);
    const savedToken = savedAttempt?.metadata && typeof savedAttempt.metadata === "object"
      ? (savedAttempt.metadata as Record<string, unknown>).token
      : null;
    if (savedToken !== spinAttemptToken) throw new Error("This wheel result is no longer valid. Spin again.");
    if (progress && await prisma.pointTransaction.findFirst({ where: { customerProgressId: progress.id, levelId: level.id } })) {
      throw new Error("You have already completed this level.");
    }
    if (level.levelNumber > 1 && !["all_at_once", "timed_interval"].includes(level.campaign.unlockMode || "sequential")) {
      const previous = await prisma.level.findFirst({ where: { campaignId, levelNumber: level.levelNumber - 1 } });
      const completed = progress && previous ? await prisma.pointTransaction.findFirst({ where: { customerProgressId: progress.id, levelId: previous.id } }) : null;
      const priorSubmission = progress && previous && level.campaign.unlockMode === "after_submission"
        ? await prisma.submission.findUnique({
            where: { levelId_customerProgressId: { levelId: previous.id, customerProgressId: progress.id } },
            select: { status: true },
          })
        : null;
      if (!progress || (previous && !completed && priorSubmission?.status !== "pending" && priorSubmission?.status !== "approved")) {
        throw new Error(`Complete Level ${level.levelNumber - 1} first.`);
      }
    }
    if (!adminGraphqlClient) throw new Error("Sign in through the storefront to create your personal discount offer.");
    preparedWheelCode = await createWheelDiscountCode({
      adminGraphqlClient,
      campaignSlug: level.campaign.slug,
      customerId: cleanCustomerId,
      percentage: signedPrize.discountPercent,
    });
  }

  let completion;
  try {
    completion = await prisma.$transaction(async (tx) => {
    const level = levelId
      ? await tx.level.findUnique({ where: { id: levelId }, include: { campaign: true } })
      : await tx.level.findFirst({ where: { campaignId, levelNumber }, include: { campaign: true } });
    if (!level || level.campaignId !== campaignId || !level.isActive) throw new Error("This activity is unavailable.");
    if (getCampaignTimeStatus(level.campaign) !== "ACTIVE") throw new Error("The campaign is not active.");
    const schedule = getLevelAvailabilitySchedule(level, level.campaign);
    if (!schedule.isAvailableNow) throw new Error(schedule.isExpired ? "This challenge has expired." : "This challenge is not available yet.");
    if (!["spin_wheel", "treasure_hunt", "memory_game", "movie_guess", "audio_guess"].includes(level.activityType)) {
      throw new Error("This activity cannot be completed from this page.");
    }

    const config = (level.config as Config | null) || {};
    let reward: string | undefined;
    let discountPercent: number | undefined;
    let offerMessage: string | undefined;
    if (level.activityType === "movie_guess" || level.activityType === "audio_guess") {
      const accepted = [config.answer, ...(Array.isArray(config.acceptedAnswers) ? config.acceptedAnswers : [])]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map(normalizeGuess);
      if (!normalizeGuess(String(answer || "")) || !accepted.includes(normalizeGuess(String(answer || "")))) throw new Error("That answer is not correct. Try again.");
    }
    if (level.activityType === "treasure_hunt") {
      const handles = Array.isArray(config.eligibleProductHandles) ? config.eligibleProductHandles.map(String) : [];
      const categories = Array.isArray(config.eligibleCategories) ? config.eligibleCategories.map(String) : [];
      const productMatches = Boolean(productHandle && handles.includes(productHandle));
      const categoryMatches = Boolean(collectionHandle && categories.includes(collectionHandle));
      const eligible = handles.length === 0 && categories.length === 0
        ? Boolean(productHandle || collectionHandle)
        : handles.length > 0 && categories.length > 0
          ? productMatches || categoryMatches
          : handles.length > 0
            ? productMatches
            : categoryMatches;
      if (!eligible) throw new Error("This product is not part of the treasure hunt.");
    }
    if (level.activityType === "memory_game") {
      const maxAttempts = Number(config.maxAttempts) || 30;
      // Completion is only submitted by the UI after every card is matched.
      // Validate the submitted attempt count against the configured limit, but
      // don't infer board size from config.pairs/cards: older levels can have
      // those values out of sync with the board rendered to the customer.
      if (!Number.isInteger(attempts) || Number(attempts) < 1 || Number(attempts) > maxAttempts) {
        throw new Error("Finish the memory game within the allowed attempts.");
      }
    }
    let signedPrize: SignedWheelPrize | undefined;
    if (level.activityType === "spin_wheel") {
      if (!spinAttemptToken) throw new Error("Spin the wheel to choose your prize first.");
      signedPrize = verifyWheelPrizeToken(spinAttemptToken, { campaignId, levelId: level.id, customerId: cleanCustomerId });
      const prizes = configuredWheelPrizes(config);
      const matchingPrize = prizes[signedPrize.index];
      if (!matchingPrize || matchingPrize.label !== signedPrize.label || matchingPrize.discountPercent !== signedPrize.discountPercent) {
        throw new Error("The wheel prizes changed. Refresh the challenge and spin again.");
      }
      const savedAttempt = await tx.auditEvent.findFirst({
        where: { campaignId, targetId: level.id, actorId: cleanCustomerId, eventType: "SPIN_PRIZE_SELECTED" },
        orderBy: { createdAt: "desc" },
      });
      const savedToken = savedAttempt?.metadata && typeof savedAttempt.metadata === "object"
        ? (savedAttempt.metadata as Record<string, unknown>).token
        : null;
      if (savedToken !== spinAttemptToken) throw new Error("This wheel result is no longer valid. Spin again.");
      reward = signedPrize.label;
      discountPercent = signedPrize.discountPercent;
      offerMessage = String(config.offerMessage || "Congratulations! You got this offer. Use your exclusive code at checkout.");
    }

    const progress = await tx.customerProgress.upsert({
      where: { campaignId_shopifyCustomerId: { campaignId, shopifyCustomerId: cleanCustomerId } },
      update: {},
      create: { campaignId, shopifyCustomerId: cleanCustomerId },
    });
    if (level.levelNumber > 1 && !["all_at_once", "timed_interval"].includes(level.campaign.unlockMode || "sequential")) {
      const previous = await tx.level.findFirst({ where: { campaignId, levelNumber: level.levelNumber - 1 } });
      if (previous) {
        const previousCompletion = await tx.pointTransaction.findFirst({ where: { customerProgressId: progress.id, levelId: previous.id } });
        const priorSubmission = level.campaign.unlockMode === "after_submission"
          ? await tx.submission.findUnique({
              where: { levelId_customerProgressId: { levelId: previous.id, customerProgressId: progress.id } },
              select: { status: true },
            })
          : null;
        if (!previousCompletion && priorSubmission?.status !== "pending" && priorSubmission?.status !== "approved") throw new Error(`Complete Level ${previous.levelNumber} first.`);
      }
    }
    const alreadyCompleted = await tx.pointTransaction.findFirst({
      where: { customerProgressId: progress.id, levelId: level.id },
      select: { points: true },
    });
    if (alreadyCompleted) {
      // A retry after a lost response reuses the original points award and
      // makes sure the completed game is also recorded as an approved submission.
      if (level.activityType === "memory_game") {
        await tx.submission.upsert({
          where: { levelId_customerProgressId: { levelId: level.id, customerProgressId: progress.id } },
          create: {
            campaignId,
            levelId: level.id,
            customerProgressId: progress.id,
            submissionType: "memory_game",
            status: "approved",
            quizAnswer: { completed: true, attempts: attempts ?? null },
            reviewedBy: "System (Memory Game)",
            reviewedAt: new Date(),
          },
          update: {
            submissionType: "memory_game",
            status: "approved",
            quizAnswer: { completed: true, attempts: attempts ?? null },
            reviewedBy: "System (Memory Game)",
            reviewedAt: new Date(),
          },
        });
        return { success: true, pointsAwarded: alreadyCompleted.points, progress, levelNumber: level.levelNumber };
      }
      throw new Error("You have already completed this level.");
    }
    if (level.activityType === "memory_game") {
      await tx.submission.upsert({
        where: { levelId_customerProgressId: { levelId: level.id, customerProgressId: progress.id } },
        create: {
          campaignId,
          levelId: level.id,
          customerProgressId: progress.id,
          submissionType: "memory_game",
          status: "approved",
          quizAnswer: { completed: true, attempts: attempts ?? null },
          reviewedBy: "System (Memory Game)",
          reviewedAt: new Date(),
        },
        update: {
          submissionType: "memory_game",
          status: "approved",
          quizAnswer: { completed: true, attempts: attempts ?? null },
          reviewedBy: "System (Memory Game)",
          reviewedAt: new Date(),
        },
      });
    }
    if (level.activityType === "treasure_hunt") {
      const maxAttempts = Number(config.maxAttempts) || 3;
      const usedAttempts = await tx.auditEvent.count({
        where: { campaignId, targetId: level.id, actorId: cleanCustomerId, eventType: "TREASURE_ATTEMPT" },
      });
      if (usedAttempts >= maxAttempts) throw new Error("You have used all your treasure hunt attempts.");
      await tx.auditEvent.create({
        data: {
          campaignId,
          eventType: "TREASURE_ATTEMPT",
          actorType: "CUSTOMER",
          actorId: cleanCustomerId,
          targetId: level.id,
          metadata: { productHandle: productHandle || null, collectionHandle: collectionHandle || null },
        },
      });
    }

    const wheelCode = preparedWheelCode;
    if (level.activityType === "spin_wheel") {
      if (!wheelCode) throw new Error("The personal discount offer could not be created. Please spin again.");
    }

    const nextTotal = progress.totalPoints + level.points;
    const becameEligible = nextTotal >= level.campaign.maxPoints && !progress.eligibleAt;
    const pointTransaction = await tx.pointTransaction.create({
      data: {
        customerProgressId: progress.id,
        levelId: level.id,
        points: level.points,
        transactionType: `${level.activityType}_completed`,
        description: `${level.title}${reward ? ` — ${reward}` : ""}`,
        referenceId: level.activityType === "treasure_hunt" ? `${productHandle || ""}${collectionHandle ? `/${collectionHandle}` : ""}` : null,
      },
    });
    const updatedProgress = await tx.customerProgress.update({
      where: { id: progress.id },
      data: {
        totalPoints: nextTotal,
        currentLevel: Math.max(progress.currentLevel, level.levelNumber + 1),
        ...(becameEligible ? { status: "eligible", eligibleAt: new Date(), completedAt: new Date() } : {}),
      },
    });
    if (wheelCode && reward) {
      const spinRewardType = `spin_discount_level_${level.levelNumber}`;
      await tx.reward.upsert({
        where: {
          campaignId_customerProgressId_rewardType: {
            campaignId,
            customerProgressId: progress.id,
            rewardType: spinRewardType,
          },
        },
        create: {
          campaignId,
          customerProgressId: progress.id,
          shopifyCustomerId: cleanCustomerId,
          rewardType: spinRewardType,
          rewardValue: discountPercent,
          discountCode: wheelCode.code,
          shopifyDiscountId: wheelCode.discountId,
          prizeLabel: reward,
          offerMessage,
          status: "issued",
          issuedAt: new Date(),
          expiresAt: wheelCode.expiresAt,
        },
        update: {
          rewardValue: discountPercent,
          discountCode: wheelCode.code,
          shopifyDiscountId: wheelCode.discountId,
          prizeLabel: reward,
          offerMessage,
          status: "issued",
          issuedAt: new Date(),
          expiresAt: wheelCode.expiresAt,
        },
      });
      if (signedPrize) {
        const attempt = await tx.auditEvent.findFirst({
          where: { campaignId, targetId: level.id, actorId: cleanCustomerId, eventType: "SPIN_PRIZE_SELECTED" },
          orderBy: { createdAt: "desc" },
        });
        if (attempt) await tx.auditEvent.update({ where: { id: attempt.id }, data: { eventType: "SPIN_PRIZE_REDEEMED" } });
      }
    }
    await tx.auditEvent.create({
      data: {
        campaignId,
        eventType: "POINTS_AWARDED",
        actorType: "CUSTOMER",
        actorId: cleanCustomerId,
        targetId: pointTransaction.id,
        metadata: { levelNumber: level.levelNumber, activityType: level.activityType, points: level.points, ...(reward ? { reward } : {}) },
      },
    });
    return {
      success: true,
      pointsAwarded: level.points,
      reward,
      discountPercent,
      discountCode: wheelCode?.code,
      offerMessage,
      progress: updatedProgress,
      levelNumber: level.levelNumber,
    };
    }, { maxWait: 10_000, timeout: 30_000 });
  } catch (error) {
    if (preparedWheelCode && adminGraphqlClient) {
      try {
        await deactivateWheelDiscountCode({ adminGraphqlClient, discountId: preparedWheelCode.discountId });
      } catch (cleanupError) {
        console.error("Failed to deactivate an unclaimed Spin & Win discount:", cleanupError);
      }
    }
    throw error;
  }

  if (completion.discountCode && completion.reward) {
    try {
      await createNotification({
      recipientType: "CUSTOMER",
      recipientId: cleanCustomerId,
      campaignId,
      type: "REWARD_ISSUED",
      title: "🎁 Your Spin & Win offer is ready!",
      message: `${completion.offerMessage || "Congratulations! You got this offer."} ${completion.reward} — code ${completion.discountCode}`,
      actionUrl: `https://aghoristore.com/discount/${encodeURIComponent(completion.discountCode)}?redirect=%2Fcollections%2Fall`,
      data: { discountCode: completion.discountCode, prizeLabel: completion.reward, discountPercent: completion.discountPercent },
      idempotencyKey: `spin_reward_${completion.discountCode}`,
      });
    } catch (error) {
      console.error("Failed to create Spin & Win customer notification:", error);
    }
  }

  return completion;
}
