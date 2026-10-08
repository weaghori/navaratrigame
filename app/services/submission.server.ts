import prisma from "../db.server";
import { deleteStoredMedia, uploadMedia } from "./storage.server";
import { getCampaignTimeStatus, getLevelAvailabilitySchedule } from "./campaign.server";
import { createNotification } from "./notification.server";
import { recordAuditEvent } from "./audit.server";
import { scoreQuizAnswers } from "./quiz-scoring";

export interface QuizSubmissionInput {
  campaignId: string;
  levelId: string;
  shopifyCustomerId: string;
  selectedOption: string;
}

export interface MediaSubmissionInput {
  campaignId: string;
  levelId: string;
  shopifyCustomerId: string;
  submissionType: "photo_upload" | "final_submission";
  fileName: string;
  buffer: Buffer | Uint8Array;
  contentType: string;
  textResponse?: string;
  storageObjectName?: string;
  storageUserKey?: string;
}

export interface TextSubmissionInput {
  campaignId: string;
  levelId: string;
  shopifyCustomerId: string;
  textResponse: string;
}

/**
 * Handle Quiz Submission:
 * - Validates campaign and level state
 * - Enforces progression prerequisite (previous level must be completed)
 * - Secret answer verified strictly server-side
 * - Awards points atomically in transaction
 */
export async function processQuizSubmission(input: QuizSubmissionInput) {
  const { campaignId, levelId, shopifyCustomerId, selectedOption } = input;

  const result = await prisma.$transaction(
    async (tx) => {
      // 1. Fetch level and verify
      const level = await tx.level.findUnique({
        where: { id: levelId },
        include: { campaign: true },
      });

      if (!level || level.campaignId !== campaignId || !level.isActive) {
        throw new Error("Invalid or inactive level.");
      }

      const timeStatus = getCampaignTimeStatus(level.campaign);
      if (timeStatus !== "ACTIVE") {
        throw new Error(`The campaign is currently ${timeStatus.toLowerCase()}. Challenges cannot be submitted.`);
      }

      const schedule = getLevelAvailabilitySchedule(level, level.campaign);
      if (!schedule.isAvailableNow) throw new Error(schedule.isExpired ? "This challenge has expired." : "This challenge is not available yet.");

      // 2. Fetch or create customer progress
      const progress = await tx.customerProgress.upsert({
        where: {
          campaignId_shopifyCustomerId: {
            campaignId,
            shopifyCustomerId: String(shopifyCustomerId).trim(),
          },
        },
        update: {},
        create: {
          campaignId,
          shopifyCustomerId: String(shopifyCustomerId).trim(),
          totalPoints: 0,
          currentLevel: 1,
        },
      });
      const config = (level.config as Record<string, unknown>) || {};

      const existingTx = await tx.pointTransaction.findFirst({
        where: { customerProgressId: progress.id, levelId: level.id, transactionType: "quiz_completed" },
        select: { id: true, points: true },
      });
      const existingQuestionAwards = await tx.pointTransaction.findMany({
        where: { customerProgressId: progress.id, levelId: level.id, transactionType: { startsWith: "quiz_question_" } },
        select: { points: true },
      });
      const awardedQuestionPoints = existingQuestionAwards.reduce((sum, award) => sum + award.points, 0);
      const existingSubmission = await tx.submission.findUnique({
        where: { levelId_customerProgressId: { levelId: level.id, customerProgressId: progress.id } },
        select: { id: true, quizAnswer: true },
      });

      if (existingTx) {
        // Older releases stored the quiz award only on quiz_completed. Reconcile
        // that legacy ledger with the saved answer count instead of returning 0.
        const savedAnswer = existingSubmission?.quizAnswer && typeof existingSubmission.quizAnswer === "object" && !Array.isArray(existingSubmission.quizAnswer)
          ? existingSubmission.quizAnswer as Record<string, unknown>
          : {};
        const savedCorrectCount = Math.max(0, Number(savedAnswer.correctCount) || 0);
        const totalQuizPoints = Math.max(awardedQuestionPoints + existingTx.points, savedCorrectCount * 50);
        const repairedCompletionPoints = Math.max(0, totalQuizPoints - awardedQuestionPoints);
        const progressDelta = repairedCompletionPoints - existingTx.points;
        if (progressDelta !== 0) {
          await tx.pointTransaction.update({ where: { id: existingTx.id }, data: { points: repairedCompletionPoints } });
        }
        const submission = await tx.submission.upsert({
          where: { levelId_customerProgressId: { levelId: level.id, customerProgressId: progress.id } },
          update: { status: "approved", submissionType: "quiz", reviewedAt: new Date(), reviewedBy: "System (Quiz Recovery)" },
          create: {
            campaignId,
            levelId: level.id,
            customerProgressId: progress.id,
            submissionType: "quiz",
            status: "approved",
            quizAnswer: { answers: {}, correctCount: Math.floor(totalQuizPoints / 50), isCorrect: false },
            reviewedAt: new Date(),
            reviewedBy: "System (Quiz Recovery)",
          },
        });
        let repairedProgress = await tx.customerProgress.update({
          where: { id: progress.id },
          data: {
            ...(progressDelta ? { totalPoints: { increment: progressDelta } } : {}),
            currentLevel: Math.max(progress.currentLevel, level.levelNumber + 1),
          },
        });
        const becameEligible = repairedProgress.totalPoints >= level.campaign.maxPoints && !repairedProgress.eligibleAt;
        if (becameEligible) {
          repairedProgress = await tx.customerProgress.update({
            where: { id: progress.id },
            data: { status: "eligible", eligibleAt: new Date(), completedAt: new Date() },
          });
        }
        const quizQuestionCount = Array.isArray(config.questions) ? config.questions.length : 1;
        return {
          success: true,
          isCorrect: Boolean(savedAnswer.isCorrect),
          quizPointsTotal: totalQuizPoints,
          pointsAwarded: Math.max(0, progressDelta),
          correctCount: savedCorrectCount || Math.floor(totalQuizPoints / 50),
          totalCorrect: savedCorrectCount || Math.floor(totalQuizPoints / 50),
          passingScore: Math.max(1, quizQuestionCount),
          submission,
          message: `Quiz completed: ${savedCorrectCount || Math.floor(totalQuizPoints / 50)}/${Math.max(1, quizQuestionCount)} correct. You earned ${totalQuizPoints} points.`,
          progress: repairedProgress,
          level,
          becameEligible,
        };
      }

      const pendingSubmission = await tx.submission.findUnique({
        where: { levelId_customerProgressId: { levelId: level.id, customerProgressId: progress.id } },
        select: { status: true },
      });
      if (pendingSubmission?.status === "pending") throw new Error("You have already submitted this challenge.");

      // 3. Progression security: verify prerequisite level is completed
      if (level.levelNumber > 1 && !["all_at_once", "timed_interval"].includes(level.campaign.unlockMode || "sequential")) {
        const prevLevel = await tx.level.findFirst({
          where: { campaignId, levelNumber: level.levelNumber - 1 },
        });
        if (prevLevel) {
          const prevCompleted = await tx.pointTransaction.findFirst({
            where: {
              customerProgressId: progress.id,
              levelId: prevLevel.id,
            },
          });
          const priorSubmission = level.campaign.unlockMode === "after_submission"
            ? await tx.submission.findUnique({
                where: { levelId_customerProgressId: { levelId: prevLevel.id, customerProgressId: progress.id } },
                select: { status: true },
              })
            : null;
          if (!prevCompleted && priorSubmission?.status !== "pending" && priorSubmission?.status !== "approved") {
            throw new Error(`Level ${level.levelNumber} is locked. You must complete Level ${prevLevel.levelNumber} first.`);
          }
        }
      }

      // 5. Verify answer against server-side secret config
      const quizQuestions = Array.isArray(config.questions) ? config.questions as Array<Record<string, unknown>> : [];
      const questions = quizQuestions.length ? quizQuestions : [{
        question: config.question,
        options: [config.optionA, config.optionB, config.optionC, config.optionD],
        answer: config.correctOption,
      }];
      let userAnswers: Record<string, string> = {};
      const userOption = String(selectedOption || "").trim().toUpperCase();
      if (quizQuestions.length > 0) {
        try {
          const parsed = JSON.parse(selectedOption) as Record<string, unknown>;
          userAnswers = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value).trim().toUpperCase()]));
        } catch {
          userAnswers = {};
        }
      } else {
        userAnswers["0"] = userOption;
      }

      const { correctIndexes, allAnswered } = scoreQuizAnswers(questions, userAnswers);
      const passingScore = Math.max(1, questions.length);
      const previousQuestionAwards = await tx.pointTransaction.findMany({
        where: { customerProgressId: progress.id, levelId: level.id, transactionType: { startsWith: "quiz_question_" } },
        select: { transactionType: true },
      });
      const earnedIndexes = new Set(previousQuestionAwards
        .map((item) => Number(item.transactionType.slice("quiz_question_".length)))
        .filter(Number.isInteger));
      const newCorrectIndexes = correctIndexes.filter((index) => !earnedIndexes.has(index));
      // Database uniqueness makes retries and simultaneous submissions safe:
      // a question can only be credited once for this customer and level.
      let pointsAwarded = 0;
      for (const index of newCorrectIndexes) {
        try {
          await tx.pointTransaction.create({
            data: {
            customerProgressId: progress.id,
            levelId: level.id,
            points: 50,
            transactionType: `quiz_question_${index}`,
            description: `Correct answer ${index + 1} on Level ${level.levelNumber}: ${level.title}`,
            },
          });
          pointsAwarded += 50;
        } catch (error) {
          if (!(error && typeof error === "object" && "code" in error && error.code === "P2002")) throw error;
        }
      }
      const allQuestionAwards = await tx.pointTransaction.findMany({
        where: { customerProgressId: progress.id, levelId: level.id, transactionType: { startsWith: "quiz_question_" } },
        select: { transactionType: true },
      });
      for (const award of allQuestionAwards) {
        const index = Number(award.transactionType.slice("quiz_question_".length));
        if (Number.isInteger(index)) earnedIndexes.add(index);
      }
      // Level 3 requires every answer to be correct before the next level unlocks.
      const completed = allAnswered && correctIndexes.length === questions.length;
      const submission = completed ? await tx.submission.upsert({
        where: { levelId_customerProgressId: { levelId: level.id, customerProgressId: progress.id } },
        update: {
          status: "approved",
          submissionType: "quiz",
          quizAnswer: { answers: userAnswers, correctCount: earnedIndexes.size, isCorrect: correctIndexes.length === questions.length, earnedQuestionIndexes: Array.from(earnedIndexes) },
          reviewedAt: new Date(),
          reviewedBy: "System (Auto-Quiz)",
        },
        create: {
          campaignId,
          levelId: level.id,
          customerProgressId: progress.id,
          submissionType: "quiz",
          status: "approved",
          quizAnswer: { answers: userAnswers, correctCount: earnedIndexes.size, isCorrect: correctIndexes.length === questions.length, earnedQuestionIndexes: Array.from(earnedIndexes) },
          reviewedAt: new Date(),
          reviewedBy: "System (Auto-Quiz)",
        },
      }) : null;

      if (completed) {
        try {
          await tx.pointTransaction.create({
            data: {
            customerProgressId: progress.id,
            levelId: level.id,
            points: 0,
            transactionType: "quiz_completed",
            description: `Quiz completed on Level ${level.levelNumber}: ${level.title}`,
            },
          });
        } catch (error) {
          if (!(error && typeof error === "object" && "code" in error && error.code === "P2002")) throw error;
        }
      }

      let updatedProgress = await tx.customerProgress.update({
        where: { id: progress.id },
        data: {
          totalPoints: { increment: pointsAwarded },
          ...(completed ? { currentLevel: Math.max(progress.currentLevel, level.levelNumber + 1) } : {}),
        },
      });
      const becameEligible = updatedProgress.totalPoints >= level.campaign.maxPoints && !updatedProgress.eligibleAt;
      if (becameEligible) {
        updatedProgress = await tx.customerProgress.update({
          where: { id: progress.id },
          data: {
            status: "eligible",
            eligibleAt: new Date(),
            completedAt: new Date(),
          },
        });
      }

      return {
        success: completed,
        isCorrect: correctIndexes.length === questions.length,
        quizPointsTotal: earnedIndexes.size * 50,
        pointsAwarded,
        correctCount: correctIndexes.length,
        totalCorrect: earnedIndexes.size,
        passingScore,
        submission,
        progress: updatedProgress,
        level,
        becameEligible,
        message: completed
          ? `Quiz submitted: ${earnedIndexes.size}/${questions.length} correct. You earned ${earnedIndexes.size * 50} points for this quiz.`
          : `You answered ${correctIndexes.length}/${questions.length} correctly this time. All ${passingScore} answers must be correct to complete the quiz. You earned ${pointsAwarded} points. Try again.`,
      };
    },
    { maxWait: 15000, timeout: 30000 },
  );

  if (result.success && result.submission) {
    try {
      // Customer notification
      await createNotification({
        recipientType: "CUSTOMER",
        recipientId: String(shopifyCustomerId).trim(),
        campaignId,
        type: "POINTS_EARNED",
        title: `+${result.quizPointsTotal} Points Earned! 🎯`,
        message: `Quiz submitted with ${result.totalCorrect}/${result.passingScore} correct answers. You earned ${result.quizPointsTotal} points for this quiz.`,
        actionUrl: `/campaigns/${result.level.campaign.slug}`,
        idempotencyKey: `quiz_pts_${result.submission.id}`,
      });

      // Next level unlock notification
      const nextLevel = result.level.levelNumber + 1;
      if (nextLevel <= 10) {
        await createNotification({
          recipientType: "CUSTOMER",
          recipientId: String(shopifyCustomerId).trim(),
          campaignId,
          type: "LEVEL_UNLOCKED",
          title: `Day ${nextLevel} Unlocked! 🔓`,
          message: `Day ${nextLevel} challenge is now unlocked for you.`,
          actionUrl: `/campaigns/${result.level.campaign.slug}`,
          idempotencyKey: `unlock_${result.progress.id}_${nextLevel}`,
        });
      }

      // Check eligibility
      if (result.becameEligible) {
        await createNotification({
          recipientType: "CUSTOMER",
          recipientId: String(shopifyCustomerId).trim(),
          campaignId,
          type: "ELIGIBLE",
          title: "🎉 Congratulations! 1,000 Points Achieved!",
          message: "You have completed the challenge and unlocked eligibility for exclusive Navratri rewards.",
          actionUrl: `/campaigns/${result.level.campaign.slug}`,
          idempotencyKey: `elig_${result.progress.id}`,
        });

        await createNotification({
          recipientType: "ADMIN",
          recipientId: "admin",
          campaignId,
          type: "NEW_ELIGIBLE_CUSTOMER",
          title: "New Eligible Customer Reached 1,000 Points!",
          message: `Customer ${result.progress.shopifyCustomerId} reached 1,000 points.`,
          actionUrl: "/app/rewards",
          idempotencyKey: `admin_elig_${result.progress.id}`,
        });
      }

      // Audit Log
      await recordAuditEvent({
        campaignId,
        eventType: "SUBMISSION_APPROVED",
        actorType: "CUSTOMER",
        actorId: String(shopifyCustomerId).trim(),
        targetId: result.submission.id,
        metadata: {
          levelNumber: result.level.levelNumber,
          points: result.pointsAwarded,
          type: "quiz",
        },
      });
    } catch (e) {
      console.error("Non-blocking notification error:", e);
    }
  }

  return result;
}

/**
 * Handle Image Submission:
 * - Validates MIME type and file size strictly server-side against level.config
 * - Validates level progression prerequisites
 * - Uploads media and creates 'pending' submission with 0 instant points
 * - Triggers notifications to customer and admin
 */
export async function processMediaSubmission(input: MediaSubmissionInput) {
  const {
    campaignId,
    levelId,
    shopifyCustomerId,
    submissionType,
    fileName,
    buffer,
    contentType,
    textResponse,
    storageObjectName,
    storageUserKey,
  } = input;

  // 1. Fetch level and verify
  const level = await prisma.level.findUnique({
    where: { id: levelId },
    include: { campaign: true },
  });

  if (!level || level.campaignId !== campaignId || !level.isActive) {
    throw new Error("Invalid or inactive level.");
  }

  const timeStatus = getCampaignTimeStatus(level.campaign);
  if (timeStatus !== "ACTIVE") {
    throw new Error(`The campaign is currently ${timeStatus.toLowerCase()}. Challenges cannot be submitted.`);
  }

  const schedule = getLevelAvailabilitySchedule(level, level.campaign);
  if (!schedule.isAvailableNow) throw new Error(schedule.isExpired ? "This challenge has expired." : "This challenge is not available yet.");

  // 2. Server-side file constraints validation
  const config = (level.config as Record<string, unknown>) || {};
  const configuredMaxMb = Number(config.maxFileSizeMb);
  const hardMaxMb = 25;
  const maxMb = Math.min(
    hardMaxMb,
    Number.isFinite(configuredMaxMb) && configuredMaxMb > 0
      ? configuredMaxMb
      : 15,
  );
  const maxBytes = maxMb * 1024 * 1024;

  if (buffer.length > maxBytes) {
    throw new Error(`File size (${(buffer.length / (1024 * 1024)).toFixed(1)}MB) exceeds the allowed limit of ${maxMb}MB.`);
  }

  const configuredTypes = Array.isArray(config.allowedTypes)
    ? (config.allowedTypes as string[]).map((t) => t.toLowerCase())
    : [];
  const supportedTypes = ["image/jpeg", "image/png", "image/webp"];
  const allowedTypes = configuredTypes.length > 0
    ? supportedTypes.filter((type) => configuredTypes.includes(type))
    : supportedTypes;
  const cleanContentType = contentType.toLowerCase().split(";")[0].trim();
  if (!allowedTypes.includes(cleanContentType)) {
    throw new Error(`Invalid file type (${contentType}). Expected one of: ${allowedTypes.join(", ")}`);
  }

  if (level.activityType !== "photo_upload" && level.activityType !== "final_submission") {
    throw new Error("This challenge does not accept image submissions.");
  }

  // 3. Fetch or create customer progress
  const progress = await prisma.customerProgress.upsert({
    where: {
      campaignId_shopifyCustomerId: {
        campaignId,
        shopifyCustomerId: String(shopifyCustomerId).trim(),
      },
    },
    update: {},
    create: {
      campaignId,
      shopifyCustomerId: String(shopifyCustomerId).trim(),
      totalPoints: 0,
      currentLevel: 1,
    },
  });

  // 4. Progression security: verify prerequisite level
  if (level.levelNumber > 1 && !["all_at_once", "timed_interval"].includes(level.campaign.unlockMode || "sequential")) {
    const prevLevel = await prisma.level.findFirst({
      where: { campaignId, levelNumber: level.levelNumber - 1 },
    });
    if (prevLevel) {
      const prevCompleted = await prisma.pointTransaction.findFirst({
        where: {
          customerProgressId: progress.id,
          levelId: prevLevel.id,
        },
      });
      const priorSubmission = level.campaign.unlockMode === "after_submission"
        ? await prisma.submission.findUnique({
            where: { levelId_customerProgressId: { levelId: prevLevel.id, customerProgressId: progress.id } },
            select: { status: true },
          })
        : null;
          if (!prevCompleted && priorSubmission?.status !== "pending" && priorSubmission?.status !== "approved") {
        throw new Error(`Level ${level.levelNumber} is locked. You must complete Level ${prevLevel.levelNumber} first.`);
      }
    }
  }

  // 5. Verify not already completed
  const existingTx = await prisma.pointTransaction.findFirst({
    where: {
      customerProgressId: progress.id,
      levelId: level.id,
    },
  });

  if (existingTx) {
    throw new Error("You have already completed this level.");
  }

  const existingSubmission = await prisma.submission.findUnique({
    where: { levelId_customerProgressId: { levelId: level.id, customerProgressId: progress.id } },
  });
  if (existingSubmission && existingSubmission.status !== "rejected" && !(level.levelNumber === 7 && existingSubmission.status === "pending") && !(level.levelNumber === 10 && existingSubmission.status === "pending")) {
    throw new Error("You have already submitted this challenge.");
  }

  // 6. Upload media
  const uploadResult = await uploadMedia({
    fileName,
    buffer,
    contentType,
    folder: storageUserKey
      ? `navratri/submissions/images/original/${storageUserKey}`
      : "photos",
    thumbnailFolder: storageUserKey
      ? `navratri/submissions/images/thumbnails/${storageUserKey}`
      : undefined,
    objectName: storageObjectName,
  });

  // 7. Create or update submission as pending
  let submission;
  try {
    submission = await prisma.submission.upsert({
      where: {
        levelId_customerProgressId: {
          levelId: level.id,
          customerProgressId: progress.id,
        },
      },
      update: {
        submissionType,
        fileUrl: uploadResult.url,
        textResponse: textResponse || null,
        status: "pending",
        adminNote: null,
        reviewedBy: null,
        reviewedAt: null,
      },
      create: {
        campaignId,
        levelId: level.id,
        customerProgressId: progress.id,
        submissionType,
        fileUrl: uploadResult.url,
        textResponse: textResponse || null,
        status: "pending",
      },
    });
  } catch (error) {
    // The direct-upload route supplies a fresh random object name per finalize
    // attempt, so this path cannot be shared with another submission. Clean up
    // the permanent rendition if the MongoDB write failed; the temporary
    // staging object is cleaned by the route's finally block / R2 lifecycle.
    if (storageObjectName) {
      await deleteStoredMedia(uploadResult.url).catch((cleanupError) => {
        console.warn("Failed to clean up an R2 object after submission persistence failed.", cleanupError instanceof Error ? cleanupError.name : "Unknown error");
      });
    }
    throw error;
  }

  // A replaced object is removed only after the database no longer references
  // it. Content-addressed paths may be shared by multiple submissions.
  const previousFileUrl = existingSubmission?.fileUrl;
  if (previousFileUrl && previousFileUrl !== uploadResult.url && previousFileUrl.startsWith("http")) {
    try {
      const stillReferenced = await prisma.submission.count({ where: { fileUrl: previousFileUrl } });
      if (stillReferenced === 0) await deleteStoredMedia(previousFileUrl);
    } catch (error) {
      console.warn("Could not remove an unreferenced replaced media file.", error instanceof Error ? error.message : "Unknown error");
    }
  }

  // Trigger Notifications & Audit Event
  try {
    // Customer confirmation
    await createNotification({
      recipientType: "CUSTOMER",
      recipientId: String(shopifyCustomerId).trim(),
      campaignId,
      type: "SUBMISSION_RECEIVED",
      title: level.levelNumber === 10 ? "Feedback saved ✓" : `Day ${level.levelNumber} Submission Received ⏳`,
      message: `Your ${level.activityType.replace("_", " ")} has been submitted and is pending admin review.`,
      actionUrl: `/campaigns/${level.campaign.slug}`,
      idempotencyKey: `sub_recv_${submission.id}`,
    });

    // Admin notification
    await createNotification({
      recipientType: "ADMIN",
      recipientId: "admin",
      campaignId,
      type: "NEW_SUBMISSION",
      title: `New Submission: Day ${level.levelNumber} 📥`,
      message: `Customer ${shopifyCustomerId} submitted ${level.title}.`,
      actionUrl: "/app/submissions",
      idempotencyKey: `admin_sub_${submission.id}`,
    });

    // Audit Event
    await recordAuditEvent({
      campaignId,
      eventType: "SUBMISSION_CREATED",
      actorType: "CUSTOMER",
      actorId: String(shopifyCustomerId).trim(),
      targetId: submission.id,
      metadata: {
        levelNumber: level.levelNumber,
        activityType: level.activityType,
        url: uploadResult.url,
      },
    });
  } catch (err) {
    console.error("Non-blocking notification error:", err);
  }

  return {
    success: true,
    submission,
    message: "Submission received! Our team will review your entry shortly.",
  };
}

/**
 * Handle Text Submission
 */
export async function processTextSubmission(input: TextSubmissionInput) {
  const { campaignId, levelId, shopifyCustomerId, textResponse } = input;

  const trimmedText = String(textResponse || "").trim();
  if (!trimmedText) {
    throw new Error("Text response cannot be empty.");
  }

  const level = await prisma.level.findUnique({
    where: { id: levelId },
    include: { campaign: true },
  });

  if (!level || level.campaignId !== campaignId || !level.isActive) {
    throw new Error("Invalid or inactive level.");
  }

  const timeStatus = getCampaignTimeStatus(level.campaign);
  if (timeStatus !== "ACTIVE") {
    throw new Error(`The campaign is currently ${timeStatus.toLowerCase()}. Challenges cannot be submitted.`);
  }

  const schedule = getLevelAvailabilitySchedule(level, level.campaign);
  if (!schedule.isAvailableNow) throw new Error(schedule.isExpired ? "This challenge has expired." : "This challenge is not available yet.");

  const config = (level.config as Record<string, unknown>) || {};
  const minLength = Number(config.minCharacters) || 10;
  const maxLength = Number(config.maxCharacters) || 1000;

  if (trimmedText.length < minLength) {
    throw new Error(`Response is too short. Minimum ${minLength} characters required.`);
  }

  if (trimmedText.length > maxLength) {
    throw new Error(`Response is too long. Maximum ${maxLength} characters allowed.`);
  }

  const progress = await prisma.customerProgress.upsert({
    where: {
      campaignId_shopifyCustomerId: {
        campaignId,
        shopifyCustomerId: String(shopifyCustomerId).trim(),
      },
    },
    update: {},
    create: {
      campaignId,
      shopifyCustomerId: String(shopifyCustomerId).trim(),
      totalPoints: 0,
      currentLevel: 1,
    },
  });

  if (level.levelNumber > 1 && !["all_at_once", "timed_interval"].includes(level.campaign.unlockMode || "sequential")) {
    const prevLevel = await prisma.level.findFirst({
      where: { campaignId, levelNumber: level.levelNumber - 1 },
    });
    if (prevLevel) {
      const prevCompleted = await prisma.pointTransaction.findFirst({
        where: {
          customerProgressId: progress.id,
          levelId: prevLevel.id,
        },
      });
      const priorSubmission = level.campaign.unlockMode === "after_submission"
        ? await prisma.submission.findUnique({
            where: { levelId_customerProgressId: { levelId: prevLevel.id, customerProgressId: progress.id } },
            select: { status: true },
          })
        : null;
          if (!prevCompleted && priorSubmission?.status !== "pending" && priorSubmission?.status !== "approved") {
        throw new Error(`Level ${level.levelNumber} is locked. You must complete Level ${prevLevel.levelNumber} first.`);
      }
    }
  }

  const existingTx = await prisma.pointTransaction.findFirst({
    where: {
      customerProgressId: progress.id,
      levelId: level.id,
    },
  });

  if (existingTx) {
    throw new Error("You have already completed this level.");
  }

  const existingSubmission = await prisma.submission.findUnique({
    where: { levelId_customerProgressId: { levelId: level.id, customerProgressId: progress.id } },
  });
  if (existingSubmission && existingSubmission.status !== "rejected" && !(level.levelNumber === 7 && existingSubmission.status === "pending") && !(level.levelNumber === 10 && existingSubmission.status === "pending")) {
    throw new Error("You have already submitted this challenge.");
  }

  const submission = await prisma.submission.upsert({
    where: {
      levelId_customerProgressId: {
        levelId: level.id,
        customerProgressId: progress.id,
      },
    },
    update: {
      submissionType: "text_submission",
      textResponse: trimmedText,
      status: "pending",
      adminNote: null,
      reviewedBy: null,
      reviewedAt: null,
    },
    create: {
      campaignId,
      levelId: level.id,
      customerProgressId: progress.id,
      submissionType: "text_submission",
      textResponse: trimmedText,
      status: "pending",
    },
  });

  // Notifications & Audit Log
  try {
    await createNotification({
      recipientType: "CUSTOMER",
      recipientId: String(shopifyCustomerId).trim(),
      campaignId,
      type: "SUBMISSION_RECEIVED",
      title: level.levelNumber === 10 ? "Feedback saved ✓" : `Day ${level.levelNumber} Submission Received ⏳`,
      message: level.levelNumber === 10 ? "Your feedback has been saved. No points are awarded for Level 10." : "Your message has been submitted and is pending admin review.",
      actionUrl: `/campaigns/${level.campaign.slug}`,
      idempotencyKey: `sub_recv_${submission.id}`,
    });

    await createNotification({
      recipientType: "ADMIN",
      recipientId: "admin",
      campaignId,
      type: "NEW_SUBMISSION",
      title: level.levelNumber === 10 ? "New Level 10 Feedback ✍️" : `New Text Submission: Day ${level.levelNumber} ✍️`,
      message: level.levelNumber === 10 ? `Customer ${shopifyCustomerId} shared Level 10 feedback; no points were awarded.` : `Customer ${shopifyCustomerId} submitted Day ${level.levelNumber} reflection.`,
      actionUrl: "/app/submissions",
      idempotencyKey: `admin_sub_${submission.id}`,
    });

    await recordAuditEvent({
      campaignId,
      eventType: "SUBMISSION_CREATED",
      actorType: "CUSTOMER",
      actorId: String(shopifyCustomerId).trim(),
      targetId: submission.id,
      metadata: {
        levelNumber: level.levelNumber,
        activityType: "text_submission",
      },
    });
  } catch (err) {
    console.error("Non-blocking notification error:", err);
  }

  // Level 10 is feedback only and does not enter the points review queue.
  if (level.levelNumber === 10) {
    const savedFeedback = await prisma.submission.update({
      where: { id: submission.id },
      data: { status: "approved", reviewedBy: "System (Feedback Only)", reviewedAt: new Date() },
    });
    const feedbackProgress = await prisma.customerProgress.findUniqueOrThrow({ where: { id: progress.id } });
    return {
      success: true,
      status: "approved" as const,
      submission: savedFeedback,
      progress: feedbackProgress,
      level,
      pointsAwarded: 0,
      feedbackOnly: true,
      message: "Your feedback has been saved. No points are awarded for Level 10. See the winner list below.",
    };
  }

  if (String(shopifyCustomerId).trim().startsWith("test_player_")) {
    const approved = await reviewSubmissionAdmin({
      submissionId: submission.id,
      action: "approve",
      reviewerInfo: "Automated test participant approval",
      shop: level.campaign.shop,
    });
    if (approved.status !== "approved") throw new Error("The response could not be approved.");
    return {
      success: true,
      status: approved.status,
      submission: approved.submission,
      progress: approved.progress,
      level,
      pointsAwarded: approved.pointTransaction?.points || 0,
      message: `Submission approved automatically. +${approved.pointTransaction?.points || 0} points awarded.`,
    };
  }

  return {
    success: true,
    status: "pending" as const,
    submission,
    message: "Text submission received! Awaiting review before points are awarded.",
  };
}

/**
 * Review Submission by Admin (Approve / Reject):
 * Transaction-safe execution awarding points and updating customer status upon approval.
 * Fires notifications and audit logs for instant synchronization.
 */
export async function reviewSubmissionAdmin({
  submissionId,
  action,
  adminNote,
  reviewerInfo,
  shop,
}: {
  submissionId: string;
  action: "approve" | "reject";
  adminNote?: string;
  reviewerInfo?: string;
  shop?: string;
}) {
  const result = await prisma.$transaction(
    async (tx) => {
      const submission = await tx.submission.findFirst({
        where: {
          id: submissionId,
          ...(shop ? { campaign: { is: { shop } } } : {}),
        },
        // Do not load fileUrl here: local/demo uploads can store a large
        // base64 video in this column, making the approval transaction time out.
        select: {
          id: true,
          status: true,
          campaignId: true,
          levelId: true,
          customerProgressId: true,
          level: { select: { id: true, title: true, levelNumber: true, points: true } },
          campaign: { select: { id: true, slug: true, maxPoints: true } },
          customerProgress: {
            select: {
              id: true,
              shopifyCustomerId: true,
              totalPoints: true,
              currentLevel: true,
              eligibleAt: true,
            },
          },
        },
      });

      if (!submission) {
        throw new Error("Submission not found.");
      }

      if (submission.status !== "pending") {
        throw new Error(`Submission has already been ${submission.status}.`);
      }

      // Handle Rejection
      if (action === "reject") {
        const updated = await tx.submission.update({
          where: { id: submissionId },
          data: {
            status: "rejected",
            adminNote: adminNote || "Submission does not meet the requirements.",
            reviewedBy: reviewerInfo || "Admin",
            reviewedAt: new Date(),
          },
          select: { id: true },
        });

        return {
          success: true,
          status: "rejected" as const,
          submission: updated,
          campaign: submission.campaign,
          customerProgress: submission.customerProgress,
          level: submission.level,
        };
      }

      // Handle Approval
      const existingTx = await tx.pointTransaction.findFirst({
        where: {
          customerProgressId: submission.customerProgressId,
          levelId: submission.levelId,
        },
      });

      if (existingTx) {
        throw new Error("Points have already been awarded for this level.");
      }

      const awardedPoints = submission.level.levelNumber === 10 ? 0 : submission.level.points;
      const pointTx = await tx.pointTransaction.create({
        data: {
          customerProgressId: submission.customerProgressId,
          levelId: submission.levelId,
          points: awardedPoints,
          transactionType: "submission_approved",
          description: `Approved Level ${submission.level.levelNumber} Submission: ${submission.level.title}`,
          referenceId: submission.id,
        },
      });

      // Keep concurrent approvals for different levels from overwriting one
      // another's points or moving currentLevel backwards.
      const nextLevel = submission.level.levelNumber + 1;
      await tx.customerProgress.updateMany({
        where: { id: submission.customerProgressId, currentLevel: { lt: nextLevel } },
        data: { currentLevel: nextLevel },
      });
      const progressAfterAward = await tx.customerProgress.update({
        where: { id: submission.customerProgressId },
        data: { totalPoints: { increment: awardedPoints } },
      });

      let becameEligible = false;
      if (progressAfterAward.totalPoints >= submission.campaign.maxPoints && !progressAfterAward.eligibleAt) {
        const now = new Date();
        const eligibilityUpdate = await tx.customerProgress.updateMany({
          where: { id: submission.customerProgressId, eligibleAt: null },
          data: { status: "eligible", eligibleAt: now, completedAt: now },
        });
        becameEligible = eligibilityUpdate.count > 0;
      }

      const updatedProgress = await tx.customerProgress.findUniqueOrThrow({
        where: { id: submission.customerProgressId },
      });

      const updatedSubmission = await tx.submission.update({
        where: { id: submissionId },
        data: {
          status: "approved",
          adminNote: adminNote || null,
          reviewedBy: reviewerInfo || "Admin",
          reviewedAt: new Date(),
        },
        select: { id: true },
      });

      return {
        success: true,
        status: "approved" as const,
        submission: updatedSubmission,
        pointTransaction: pointTx,
        progress: updatedProgress,
        campaign: submission.campaign,
        customerProgress: submission.customerProgress,
        level: submission.level,
        awardedPoints,
        becameEligible,
      };
    },
    { maxWait: 15000, timeout: 60000 },
  );

  // Trigger Notifications & Audit Log outside transaction
  try {
    const customerId = result.customerProgress.shopifyCustomerId;
    const campaignId = result.campaign.id;
    const campaignSlug = result.campaign.slug;

    if (result.status === "approved") {
      // 1. Customer notification: submission approved
      await createNotification({
        recipientType: "CUSTOMER",
        recipientId: customerId,
        campaignId,
        type: result.awardedPoints > 0 ? "POINTS_EARNED" : "SUBMISSION_RECEIVED",
        title: result.awardedPoints > 0 ? `Submission Approved! +${result.awardedPoints} Points 🎉` : "Thanks for your feedback!",
        message: result.awardedPoints > 0
          ? `Your Day ${result.level.levelNumber} submission (${result.level.title}) was approved!`
          : "Your feedback was saved. This activity does not award points.",
        actionUrl: `/campaigns/${campaignSlug}`,
        idempotencyKey: `sub_appr_${result.submission.id}`,
      });

      // 2. Next level unlock notification
      const nextLevel = result.level.levelNumber + 1;
      if (nextLevel <= 10) {
        await createNotification({
          recipientType: "CUSTOMER",
          recipientId: customerId,
          campaignId,
          type: "LEVEL_UNLOCKED",
          title: `Day ${nextLevel} Unlocked! 🔓`,
          message: `Level ${nextLevel} challenge is now open.`,
          actionUrl: `/campaigns/${campaignSlug}`,
          idempotencyKey: `lvl_unlock_${result.progress.id}_${nextLevel}`,
        });
      }

      // 3. Check Eligibility transition
      if (result.becameEligible) {
        await createNotification({
          recipientType: "CUSTOMER",
          recipientId: customerId,
          campaignId,
          type: "ELIGIBLE",
          title: "🎉 Congratulations! You reached 1,000 points!",
          message: "You have completed the challenge and unlocked eligibility for exclusive Navratri rewards.",
          actionUrl: `/campaigns/${campaignSlug}`,
          idempotencyKey: `elig_${result.progress.id}`,
        });

        await createNotification({
          recipientType: "ADMIN",
          recipientId: "admin",
          campaignId,
          type: "NEW_ELIGIBLE_CUSTOMER",
          title: "New Eligible Customer (1,000 pts)!",
          message: `Customer ${customerId} is now eligible for rewards.`,
          actionUrl: "/app/rewards",
          idempotencyKey: `admin_elig_${result.progress.id}`,
        });
      }

      // 4. Audit Log
      await recordAuditEvent({
        campaignId,
        eventType: "SUBMISSION_APPROVED",
        actorType: "ADMIN",
        actorId: reviewerInfo || "Admin",
        targetId: result.submission.id,
        metadata: {
          customerId,
          levelNumber: result.level.levelNumber,
          points: result.awardedPoints,
        },
      });
    } else {
      // Rejection notification
      await createNotification({
        recipientType: "CUSTOMER",
        recipientId: customerId,
        campaignId,
        type: "SUBMISSION_RECEIVED",
        title: `Submission Needs Attention ⚠️`,
        message: `Your Day ${result.level.levelNumber} submission needs another attempt: ${adminNote || "Please retry with valid festive content."}`,
        actionUrl: `/campaigns/${campaignSlug}`,
        idempotencyKey: `sub_rej_${result.submission.id}`,
      });

      await recordAuditEvent({
        campaignId,
        eventType: "SUBMISSION_REJECTED",
        actorType: "ADMIN",
        actorId: reviewerInfo || "Admin",
        targetId: result.submission.id,
        metadata: {
          customerId,
          levelNumber: result.level.levelNumber,
          adminNote,
        },
      });
    }
  } catch (err) {
    console.error("Non-blocking notification/audit error in reviewSubmissionAdmin:", err);
  }

  return result;
}

/**
 * List submissions with filtering
 */
export async function getSubmissionsList({
  campaignId,
  status,
  page = 1,
  limit = 20,
}: {
  campaignId?: string;
  status?: string;
  page?: number;
  limit?: number;
}) {
  const where: Record<string, unknown> = {};
  if (campaignId) where.campaignId = campaignId;
  if (status && status !== "all") where.status = status;

  // This page only displays the first page and has no pagination controls.
  // Avoid a separate COUNT query: small hosted Postgres pools can time out
  // waiting for a connection even after the submissions query has completed.
  const rows = await prisma.submission.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * limit,
    take: limit + 1,
    include: {
      level: true,
      customerProgress: true,
    },
  });
  const hasMore = rows.length > limit;
  const submissions = rows.slice(0, limit);

  return {
    submissions,
    totalCount: submissions.length,
    hasMore,
    page,
    totalPages: page + (hasMore ? 1 : 0),
  };
}
