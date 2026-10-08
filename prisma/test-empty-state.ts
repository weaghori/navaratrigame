import { getActiveCampaign, getCampaignStats, getCampaignTimeStatus } from "../app/services/campaign.server";
import { getNotifications, getUnreadNotificationCount } from "../app/services/notification.server";
import { getRecentAuditEvents } from "../app/services/audit.server";
import { getAdminLeaderboard, getPublicLeaderboard } from "../app/services/leaderboard.server";
import { getTop25Calculated, getWinnersList } from "../app/services/winner.server";
import { getRewardsList } from "../app/services/reward.server";
import prisma from "../app/db.server";

async function testEmptyStates() {
  console.log("=================================================");
  console.log("🧪 TESTING EMPTY DATABASE & EDGE STATE HANDLING");
  console.log("=================================================");

  const campaign = await getActiveCampaign();
  const campaignId = campaign ? campaign.id : "non_existent_id";

  // 1. Test getCampaignStats for non-existent/empty campaign
  console.log("Testing getCampaignStats with non-existent ID...");
  const emptyStats = await getCampaignStats("non_existent_id");
  console.log("✅ getCampaignStats empty result:", emptyStats);

  // 2. Test getNotifications for non-existent recipient/campaign
  console.log("Testing getNotifications with empty state...");
  const emptyNotifs = await getNotifications({
    recipientType: "ADMIN",
    recipientId: "empty_admin",
    campaignId: "empty_campaign",
  });
  console.log("✅ getNotifications empty result:", emptyNotifs);

  // 3. Test getUnreadNotificationCount
  console.log("Testing getUnreadNotificationCount with empty state...");
  const emptyUnread = await getUnreadNotificationCount({
    recipientType: "ADMIN",
    recipientId: "empty_admin",
    campaignId: "empty_campaign",
  });
  console.log("✅ getUnreadNotificationCount empty result:", emptyUnread);

  // 4. Test getRecentAuditEvents
  console.log("Testing getRecentAuditEvents with empty state...");
  const emptyAudit = await getRecentAuditEvents({
    campaignId: "empty_campaign",
  });
  console.log("✅ getRecentAuditEvents empty result:", emptyAudit);

  // 5. Test Leaderboard queries with empty state
  console.log("Testing Leaderboard with empty state...");
  const emptyAdminLb = await getAdminLeaderboard({ campaignId: "empty_campaign" });
  console.log("✅ getAdminLeaderboard empty result:", emptyAdminLb);

  const emptyPublicLb = await getPublicLeaderboard({
    campaignId: "empty_campaign",
    currentCustomerId: "empty_customer",
  });
  console.log("✅ getPublicLeaderboard empty result:", emptyPublicLb);

  // 6. Test Winner queries with empty state
  console.log("Testing Winners with empty state...");
  const emptyWinners = await getWinnersList("empty_campaign");
  console.log("✅ getWinnersList empty result:", emptyWinners);

  const emptyCalculated = await getTop25Calculated("empty_campaign");
  console.log("✅ getTop25Calculated empty result:", emptyCalculated);

  // 7. Test Reward list with empty state
  console.log("Testing Rewards with empty state...");
  const emptyRewards = await getRewardsList({ campaignId: "empty_campaign" });
  console.log("✅ getRewardsList empty result:", emptyRewards);

  console.log("\n🎉 ALL EMPTY-STATE CHECKS PASSED SUCCESSFULLY!");
}

testEmptyStates()
  .catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
