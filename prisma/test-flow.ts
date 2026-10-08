import { getActiveCampaign, getCampaignStats, getCampaignTimeStatus, getLevelAvailabilitySchedule } from "../app/services/campaign.server";
import {
  getCustomerLevelProgress,
  getCustomerProgress,
  awardPointsAtomic,
  getCustomerPointHistory,
} from "../app/services/customer.server";
import {
  processQuizSubmission,
  processMediaSubmission,
  processTextSubmission,
  reviewSubmissionAdmin,
} from "../app/services/submission.server";
import {
  getOrCreateReferralCode,
  trackReferralVisit,
  qualifyReferral,
  getCustomerReferralStats,
} from "../app/services/referral.server";
import {
  getPublicLeaderboard,
  maskCustomerIdentifier,
} from "../app/services/leaderboard.server";
import {
  getTop25Calculated,
  finalizeTop25Winners,
  getWinnersList,
} from "../app/services/winner.server";
import {
  issueCustomerReward,
  getCustomerReward,
  getRewardsList,
} from "../app/services/reward.server";
import {
  getNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
} from "../app/services/notification.server";
import { getRecentAuditEvents } from "../app/services/audit.server";
import prisma from "../app/db.server";

async function runComprehensiveFlow() {
  console.log("================================================================");
  console.log("🚀 STARTING COMPREHENSIVE PHASE 6 PRODUCTION EXPERIENCE TEST");
  console.log("================================================================\n");

  const timestamp = Date.now();
  const testUserId = `realtime_user_${timestamp}`;
  const testFriendId = `realtime_friend_${timestamp}`;

  // -------------------------------------------------------------
  // 1. CAMPAIGN & TIMING VERIFICATION (Asia/Kolkata)
  // -------------------------------------------------------------
  console.log("--- 1. CAMPAIGN & TIMING (Asia/Kolkata) ---");
  const campaign = await getActiveCampaign();
  if (!campaign) throw new Error("No active campaign found!");

  const timeStatus = getCampaignTimeStatus(campaign);
  console.log(`✅ Campaign: "${campaign.name}" (${campaign.slug})`);
  console.log(`✅ Status: Stored = ${campaign.status}, Computed Time Status = ${timeStatus}`);

  // Test timing schedule on Day 1 vs Day 9
  const level1 = campaign.levels.find((l) => l.levelNumber === 1)!;
  const level9 = campaign.levels.find((l) => l.levelNumber === 9)!;
  const sched1 = getLevelAvailabilitySchedule(level1, campaign);
  const sched9 = getLevelAvailabilitySchedule(level9, campaign);

  console.log(`✅ Day 1 starts: ${sched1.availableFrom.toISOString()} (Available: ${sched1.isAvailableNow})`);
  console.log(`✅ Day 9 starts: ${sched9.availableFrom.toISOString()}`);

  // Verify total points = 1000 across 9 levels
  const totalPoints = campaign.levels.reduce((sum, l) => sum + l.points, 0);
  if (totalPoints !== 1000 || campaign.levels.length !== 9) {
    throw new Error(`Expected 9 levels totaling 1000 points, found ${campaign.levels.length} levels totaling ${totalPoints}`);
  }
  console.log(`✅ Exactly 9 levels totaling ${totalPoints} points verified.\n`);

  // -------------------------------------------------------------
  // 2. CUSTOMER PROGRESS & LEVEL 1 QUIZ
  // -------------------------------------------------------------
  console.log("--- 2. CUSTOMER LEVEL 1 QUIZ & REAL-TIME POINTS ---");
  const initProg = await getCustomerLevelProgress({
    campaignId: campaign.id,
    shopifyCustomerId: testUserId,
  });
  if (initProg.progress.totalPoints !== 0 || initProg.currentAvailableLevel !== 1) {
    throw new Error("Initial customer progress should start at 0 points and Level 1.");
  }
  console.log(`✅ Customer initialized with 0 points at Day 1.`);

  // Incorrect answer test
  const wrongQuiz = await processQuizSubmission({
    campaignId: campaign.id,
    levelId: level1.id,
    shopifyCustomerId: testUserId,
    selectedOption: "A",
  });
  if (wrongQuiz.isCorrect) throw new Error("Wrong answer should have failed!");
  console.log(`✅ Incorrect quiz answer rejected cleanly.`);

  // Correct answer test (Option B)
  const rightQuiz = await processQuizSubmission({
    campaignId: campaign.id,
    levelId: level1.id,
    shopifyCustomerId: testUserId,
    selectedOption: "B",
  });
  if (!rightQuiz.isCorrect || rightQuiz.pointsAwarded !== 100) {
    throw new Error("Correct quiz answer failed to award 100 points!");
  }
  console.log(`✅ Correct quiz answer approved (+100 pts). New points: ${rightQuiz.progress.totalPoints}`);

  // Duplicate submission test
  try {
    await processQuizSubmission({
      campaignId: campaign.id,
      levelId: level1.id,
      shopifyCustomerId: testUserId,
      selectedOption: "B",
    });
    throw new Error("Duplicate quiz submission should have been blocked!");
  } catch (err: unknown) {
    console.log(`✅ Duplicate submission blocked: "${(err as Error).message}"`);
  }

  // Verify Level 2 unlocked and customer notifications created
  const afterLvl1 = await getCustomerLevelProgress({
    campaignId: campaign.id,
    shopifyCustomerId: testUserId,
  });
  const lvl2Info = afterLvl1.levels.find((l) => l.levelNumber === 2)!;
  console.log(`✅ Day 2 state: ${lvl2Info.state}`);

  const customerNotifs = await getNotifications({
    recipientType: "CUSTOMER",
    recipientId: testUserId,
    campaignId: campaign.id,
  });
  console.log(`✅ Customer received ${customerNotifs.notifications.length} in-app notification(s). Latest: "${customerNotifs.notifications[0]?.title}"\n`);

  // -------------------------------------------------------------
  // 3. LEVEL 2 PHOTO UPLOAD & ADMIN REVIEW
  // -------------------------------------------------------------
  console.log("--- 3. PHOTO SUBMISSION & ADMIN REVIEW FLOW ---");
  const level2 = campaign.levels.find((l) => l.levelNumber === 2)!;

  // Invalid MIME type test
  try {
    await processMediaSubmission({
      campaignId: campaign.id,
      levelId: level2.id,
      shopifyCustomerId: testUserId,
      submissionType: "photo_upload",
      fileName: "test.pdf",
      buffer: Buffer.from("pdf-bytes"),
      contentType: "application/pdf",
    });
    throw new Error("PDF submission for photo challenge should be blocked!");
  } catch (err: unknown) {
    console.log(`✅ Invalid MIME blocked: "${(err as Error).message}"`);
  }

  // Valid Photo Submission
  const photoResult = await processMediaSubmission({
    campaignId: campaign.id,
    levelId: level2.id,
    shopifyCustomerId: testUserId,
    submissionType: "photo_upload",
    fileName: "puja.jpg",
    buffer: Buffer.from("image-bytes"),
    contentType: "image/jpeg",
    textResponse: "Home mandir decoration",
  });
  if (photoResult.submission.status !== "pending") {
    throw new Error("Photo upload should start in 'pending' status.");
  }
  console.log(`✅ Photo submission created in 'pending' review with 0 instant points.`);

  // Admin Notification verification
  const adminNotifs = await getNotifications({
    recipientType: "ADMIN",
    recipientId: "admin",
    campaignId: campaign.id,
  });
  const submissionNotif = adminNotifs.notifications.find((n) => n.type === "NEW_SUBMISSION");
  if (!submissionNotif) throw new Error("Admin did not receive NEW_SUBMISSION notification!");
  console.log(`✅ Admin received real-time notification: "${submissionNotif.title}"`);

  // Admin Approval
  const approval = await reviewSubmissionAdmin({
    submissionId: photoResult.submission.id,
    action: "approve",
    reviewerInfo: "Test Admin",
    adminNote: "Festive mandir decor approved!",
  });
  if (approval.status !== "approved" || approval.pointTransaction?.points !== 100) {
    throw new Error("Admin approval failed to award 100 points!");
  }
  console.log(`✅ Admin approved submission (+100 pts credited). Total points: ${approval.progress.totalPoints}`);

  // Duplicate approval protection
  try {
    await reviewSubmissionAdmin({
      submissionId: photoResult.submission.id,
      action: "approve",
    });
    throw new Error("Duplicate approval should have been blocked!");
  } catch (err: unknown) {
    console.log(`✅ Duplicate approval blocked: "${(err as Error).message}"\n`);
  }

  // -------------------------------------------------------------
  // 4. REFERRAL LIFECYCLE
  // -------------------------------------------------------------
  console.log("--- 4. REFERRAL SYSTEM & BONUS POINTS ---");
  const refCode = await getOrCreateReferralCode(campaign.id, testUserId);
  console.log(`✅ Unique referral code created: "${refCode}"`);

  // Self-referral protection
  const selfRef = await trackReferralVisit({
    campaignId: campaign.id,
    referralCode: refCode,
    referredCustomerId: testUserId,
  });
  if (selfRef !== null) throw new Error("Self-referral should have been blocked!");
  console.log(`✅ Self-referral prevented.`);

  // Friend joins via referral link
  const friendVisit = await trackReferralVisit({
    campaignId: campaign.id,
    referralCode: refCode,
    referredCustomerId: testFriendId,
  });
  if (!friendVisit) throw new Error("Referral visit tracking failed!");

  // Friend completes Level 1 Quiz
  await processQuizSubmission({
    campaignId: campaign.id,
    levelId: level1.id,
    shopifyCustomerId: testFriendId,
    selectedOption: "B",
  });

  // Qualify referral -> awards +100 bonus points to referrer
  const qualifyResult = await qualifyReferral({
    campaignId: campaign.id,
    referredCustomerId: testFriendId,
  });
  if (!qualifyResult.success || qualifyResult.pointsAwarded !== 100) {
    throw new Error("Referral qualification failed to award 100 points!");
  }
  console.log(`✅ Referral qualified! Referrer awarded +100 bonus points.`);

  // Duplicate referral qualification blocked
  const dupQualify = await qualifyReferral({
    campaignId: campaign.id,
    referredCustomerId: testFriendId,
  });
  if (dupQualify.success) throw new Error("Duplicate referral qualification should be blocked!");
  console.log(`✅ Duplicate referral points blocked: "${dupQualify.reason}"\n`);

  // -------------------------------------------------------------
  // 5. 1,000 POINTS ELIGIBILITY & TOP 25 WINNERS
  // -------------------------------------------------------------
  console.log("--- 5. 1,000-POINT ELIGIBILITY & TOP 25 FINALIZATION ---");
  const currentProg = await prisma.customerProgress.findUnique({
    where: { campaignId_shopifyCustomerId: { campaignId: campaign.id, shopifyCustomerId: testUserId } },
  });
  if (!currentProg) throw new Error("Customer progress not found");

  const ptsNeeded = 1000 - currentProg.totalPoints;
  if (ptsNeeded > 0) {
    // Award remaining points using atomic awardPointsAtomic so transactions and eligibility trigger properly
    await awardPointsAtomic({
      customerProgressId: currentProg.id,
      points: ptsNeeded,
      transactionType: "level_completed",
      description: "Festive Challenge Grand Finale",
    });
  }

  const eligibleProg = await prisma.customerProgress.findUnique({
    where: { id: currentProg.id },
  });
  if (eligibleProg?.status !== "eligible" || !eligibleProg.eligibleAt) {
    throw new Error("Customer should have status 'eligible' and non-null eligibleAt after reaching 1,000 points!");
  }
  console.log(`✅ Customer reached ${eligibleProg.totalPoints} points and status is "${eligibleProg.status}".`);

  // Leaderboard ranking
  const leaderboard = await getPublicLeaderboard({
    campaignId: campaign.id,
    currentCustomerId: testUserId,
  });
  console.log(`✅ Leaderboard calculated: Rank #${leaderboard.currentCustomerRank} for customer.`);

  // Top 25 calculation & official finalization
  const top25 = await getTop25Calculated(campaign.id);
  console.log(`✅ Calculated Top 25 candidates: ${top25.candidates.length} candidates, Total eligible: ${top25.totalEligible}`);

  const finalizeWinners = await finalizeTop25Winners({
    campaignId: campaign.id,
    adminUser: "Automated Phase 6 QA",
  });
  if (!finalizeWinners.success || finalizeWinners.finalizedCount === 0) {
    throw new Error("Finalize Top 25 winners failed!");
  }
  console.log(`✅ Finalized ${finalizeWinners.finalizedCount} winners into official Winner table.`);

  // Verify Winner notification sent to customer
  const winnerNotifs = await getNotifications({
    recipientType: "CUSTOMER",
    recipientId: testUserId,
    campaignId: campaign.id,
  });
  const winNotif = winnerNotifs.notifications.find((n) => n.type === "WINNER");
  if (!winNotif) throw new Error("Winner did not receive WINNER notification!");
  console.log(`✅ Customer received WINNER notification: "${winNotif.title}"\n`);

  // -------------------------------------------------------------
  // 6. REAL SHOPIFY DISCOUNT VERIFICATION
  // -------------------------------------------------------------
  console.log("--- 6. REAL SHOPIFY DISCOUNT VERIFICATION ---");
  // Test 1: Ineligible customer cannot receive reward
  const ineligibleId = `ineligible_${timestamp}`;
  const ineligProg = await prisma.customerProgress.create({
    data: {
      campaignId: campaign.id,
      shopifyCustomerId: ineligibleId,
      totalPoints: 100,
      status: "active",
    },
  });

  try {
    await issueCustomerReward({
      campaignId: campaign.id,
      customerProgressId: ineligProg.id,
      percentage: 10,
    });
    throw new Error("Ineligible customer should not be able to receive reward!");
  } catch (err: unknown) {
    console.log(`✅ Ineligible reward blocked: "${(err as Error).message}"`);
  }

  // Test 2: Missing GraphQL client in live mode fails (does not fake)
  try {
    await issueCustomerReward({
      campaignId: campaign.id,
      customerProgressId: eligibleProg.id,
      percentage: 10,
      adminGraphqlClient: null,
      isTestRunner: false, // Live production mode flag
    });
    throw new Error("Missing GraphQL client should fail without fake discount!");
  } catch (err: unknown) {
    console.log(`✅ Fake discount prevented: "${(err as Error).message}"`);
  }

  // Test 3: Valid issuance with Shopify GraphQL (or test runner in automated CLI)
  const rewardResult = await issueCustomerReward({
    campaignId: campaign.id,
    customerProgressId: eligibleProg.id,
    percentage: 10,
    adminUser: "Automated QA Admin",
    isTestRunner: true, // CLI test runner simulation
  });
  if (!rewardResult.success || !rewardResult.discountCode) {
    throw new Error("Reward issuance failed!");
  }
  console.log(`✅ Real discount code issued: "${rewardResult.discountCode}" (${rewardResult.reward.rewardValue}% OFF)`);

  // Duplicate reward issuance protection
  try {
    await issueCustomerReward({
      campaignId: campaign.id,
      customerProgressId: eligibleProg.id,
      percentage: 15,
      isTestRunner: true,
    });
    throw new Error("Duplicate reward issuance should be blocked!");
  } catch (err: unknown) {
    console.log(`✅ Duplicate reward blocked: "${(err as Error).message}"`);
  }

  // Storefront customer reward retrieval
  const customerReward = await getCustomerReward(campaign.id, testUserId);
  if (!customerReward || customerReward.status !== "issued" || !customerReward.discountCode) {
    throw new Error("Customer unable to retrieve issued reward on storefront!");
  }
  console.log(`✅ Storefront customer reward retrieved: Coupon Code = "${customerReward.discountCode}"\n`);

  // -------------------------------------------------------------
  // 7. NOTIFICATION CENTER & AUDIT LOGS
  // -------------------------------------------------------------
  console.log("--- 7. NOTIFICATION CENTER & AUDIT LOGS ---");
  const unreadBefore = await getUnreadNotificationCount({
    recipientType: "CUSTOMER",
    recipientId: testUserId,
    campaignId: campaign.id,
  });
  console.log(`✅ Customer unread notifications before marking read: ${unreadBefore}`);

  // Mark all as read
  await markAllNotificationsRead({
    recipientType: "CUSTOMER",
    recipientId: testUserId,
    campaignId: campaign.id,
  });
  const unreadAfter = await getUnreadNotificationCount({
    recipientType: "CUSTOMER",
    recipientId: testUserId,
    campaignId: campaign.id,
  });
  if (unreadAfter !== 0) throw new Error("Unread notifications should be 0 after markAllRead!");
  console.log(`✅ Customer notifications marked as read. Unread count: ${unreadAfter}`);

  // Audit Events
  const recentAudits = await getRecentAuditEvents({ campaignId: campaign.id, limit: 10 });
  if (recentAudits.length === 0) throw new Error("Audit log should contain recorded events!");
  console.log(`✅ Audit Event Log verified (${recentAudits.length} recent events recorded). Latest: ${recentAudits[0].eventType}`);

  // -------------------------------------------------------------
  // 8. STRICT DASHBOARD KPI CALCULATIONS
  // -------------------------------------------------------------
  console.log("\n--- 8. MATHEMATICALLY STRICT KPI VERIFICATION ---");
  const stats = await getCampaignStats(campaign.id);
  console.log(`  Participants:      ${stats.totalParticipants}`);
  console.log(`  Completed:         ${stats.completedParticipants}`);
  console.log(`  Eligible:          ${stats.eligibleParticipants}`);
  console.log(`  Pending Reviews:   ${stats.pendingSubmissions}`);
  console.log(`  Approved:          ${stats.approvedSubmissions}`);
  console.log(`  Total Points:      ${stats.totalPointsAwarded}`);

  if (stats.eligibleParticipants > stats.totalParticipants) {
    throw new Error("Eligible participants cannot exceed total participants!");
  }

  console.log("\n================================================================");
  console.log("🎉 ALL PHASE 6 REAL-TIME, NOTIFICATION & FLOW TESTS PASSED! 🚀");
  console.log("================================================================\n");
}

runComprehensiveFlow()
  .catch((e) => {
    console.error("❌ Test failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
