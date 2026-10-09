import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getActiveCampaign } from "../services/campaign.server";
import { getOrCreateCustomerProgress, adjustPointsAdmin } from "../services/customer.server";
import { getOrCreateReferralCode, trackReferralVisit, qualifyReferral } from "../services/referral.server";
import { reviewSubmissionAdmin } from "../services/submission.server";
import { issueCustomerReward } from "../services/reward.server";
import { finalizeTop25Winners } from "../services/winner.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  if (process.env.NODE_ENV === "production") {
    throw new Response("Dev testing tools disabled in production mode.", { status: 403 });
  }

  const campaign = await getActiveCampaign();

  if (!campaign) {
    return { campaign: null, testParticipants: [] };
  }

  const testParticipants = await prisma.customerProgress.findMany({
    where: { campaignId: campaign.id },
    orderBy: { totalPoints: "desc" },
    take: 12,
    include: {
      submissions: {
        include: { level: true },
        orderBy: { createdAt: "desc" },
      },
      pointTransactions: {
        orderBy: { createdAt: "desc" },
      },
      rewards: true,
      winner: true,
    },
  });

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      slug: campaign.slug,
      maxPoints: campaign.maxPoints,
    },
    testParticipants: testParticipants.map((p) => ({
      ...p,
      createdAt: p.createdAt.toISOString(),
      submissions: p.submissions.map((s) => ({
        ...s,
        createdAt: s.createdAt.toISOString(),
      })),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  if (process.env.NODE_ENV === "production") {
    return { success: false, error: "Dev testing tools are disabled in production mode." };
  }

  const formData = await request.formData();
  const actionType = String(formData.get("actionType") || "");
  const campaignId = String(formData.get("campaignId") || "");

  if (!campaignId) {
    return { success: false, error: "Campaign ID missing." };
  }

  try {
    if (actionType === "create_test_participant") {
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      const testCustomerId = `test_player_${randomSuffix}`;

      const progress = await getOrCreateCustomerProgress({
        campaignId,
        shopifyCustomerId: testCustomerId,
      });

      return {
        success: true,
        message: `Created test participant "${testCustomerId}" (ID: ${progress.id}) with 0 points.`,
      };
    }

    if (actionType === "award_test_points") {
      const customerProgressId = String(formData.get("customerProgressId") || "");
      const points = Number(formData.get("points")) || 100;

      if (!customerProgressId) return { success: false, error: "Select a participant." };

      const result = await adjustPointsAdmin({
        customerProgressId,
        points,
        reason: "Dev testing tool manual credit",
        adminUser: `Shopify Admin (${session.shop})`,
      });

      return {
        success: true,
        message: `Awarded +${points} pts to customer. New total: ${result.progress.totalPoints} pts.`,
      };
    }

    if (actionType === "fast_forward_1000") {
      const customerProgressId = String(formData.get("customerProgressId") || "");
      if (!customerProgressId) return { success: false, error: "Select a participant." };

      const progress = await prisma.customerProgress.findUnique({
        where: { id: customerProgressId },
        include: { campaign: true },
      });
      if (!progress) return { success: false, error: "Participant not found." };

      const needed = Math.max(0, 1000 - progress.totalPoints);
      if (needed > 0) {
        await adjustPointsAdmin({
          customerProgressId,
          points: needed,
          reason: "Fast-forward to 1000 Points Challenge Completion",
          adminUser: `Shopify Admin (${session.shop})`,
        });
      }

      return {
        success: true,
        message: `Customer reached 1,000 points and is now eligible for rewards!`,
      };
    }

    if (actionType === "fast_forward_all_test_participants") {
      const participants = await prisma.customerProgress.findMany({
        where: { campaignId, shopifyCustomerId: { startsWith: "test_player_" }, totalPoints: { lt: 1000 } },
        select: { id: true, totalPoints: true },
      });
      for (const participant of participants) {
        const needed = 1000 - participant.totalPoints;
        if (needed > 0) {
          await adjustPointsAdmin({
            customerProgressId: participant.id,
            points: needed,
            reason: "QA setup: bring test participant to the 1,000-point eligibility threshold",
            adminUser: `Shopify Admin (${session.shop})`,
          });
        }
      }
      return {
        success: true,
        message: `Set ${participants.length} temporary test participant(s) to 1,000 points for winner-list testing.`,
      };
    }
    if (actionType === "simulate_photo_submission") {
      const customerProgressId = String(formData.get("customerProgressId") || "");
      if (!customerProgressId) return { success: false, error: "Select a participant." };

      const progress = await prisma.customerProgress.findUnique({ where: { id: customerProgressId } });
      if (!progress) return { success: false, error: "Participant not found." };

      const photoLevel = await prisma.level.findFirst({
        where: { campaignId, activityType: "photo_upload" },
      });

      if (!photoLevel) return { success: false, error: "No photo level found in campaign." };

      const sub = await prisma.submission.upsert({
        where: {
          levelId_customerProgressId: {
            levelId: photoLevel.id,
            customerProgressId: progress.id,
          },
        },
        update: {
          submissionType: "photo_upload",
          fileUrl: "https://images.unsplash.com/photo-1599566150163-29194dcaad36",
          status: "pending",
        },
        create: {
          campaignId,
          levelId: photoLevel.id,
          customerProgressId: progress.id,
          submissionType: "photo_upload",
          fileUrl: "https://images.unsplash.com/photo-1599566150163-29194dcaad36",
          status: "pending",
        },
      });

      return {
        success: true,
        message: `Created pending photo submission for level ${photoLevel.levelNumber} (Submission ID: ${sub.id}).`,
      };
    }

    if (actionType === "approve_submission") {
      const submissionId = String(formData.get("submissionId") || "");
      if (!submissionId) return { success: false, error: "Missing submissionId" };

      const result = await reviewSubmissionAdmin({
        submissionId,
        action: "approve",
        reviewerInfo: `Dev QA Admin (${session.shop})`,
        adminNote: "Approved via Dev QA Testing Console.",
      });

      return {
        success: true,
        message: result.pointTransaction?.points
          ? `Approved submission! +${result.pointTransaction.points} pts awarded to customer.`
          : "Feedback saved. No points awarded for this activity.",
      };
    }

    if (actionType === "reject_submission") {
      const submissionId = String(formData.get("submissionId") || "");
      if (!submissionId) return { success: false, error: "Missing submissionId" };

      await reviewSubmissionAdmin({
        submissionId,
        action: "reject",
        reviewerInfo: `Dev QA Admin (${session.shop})`,
        adminNote: "Please upload a clearer festive photo.",
      });

      return {
        success: true,
        message: `Submission marked as rejected. Customer can re-attempt.`,
      };
    }

    if (actionType === "simulate_referral_flow") {
      const customerProgressId = String(formData.get("customerProgressId") || "");
      if (!customerProgressId) return { success: false, error: "Select a participant." };

      const progress = await prisma.customerProgress.findUnique({ where: { id: customerProgressId } });
      if (!progress) return { success: false, error: "Participant not found." };

      const referralCode = await getOrCreateReferralCode(campaignId, progress.shopifyCustomerId);

      const friendCustomerId = `test_friend_${Date.now().toString().slice(-4)}`;
      await trackReferralVisit({
        campaignId,
        referralCode,
        referredCustomerId: friendCustomerId,
      });

      await qualifyReferral({
        campaignId,
        referredCustomerId: friendCustomerId,
      });

      return {
        success: true,
        message: `Simulated full referral loop! Code ${referralCode} used by ${friendCustomerId}. Referrer awarded +100 bonus points.`,
      };
    }

    if (actionType === "finalize_top25") {
      const res = await finalizeTop25Winners({
        campaignId,
        adminUser: `Shopify Admin (${session.shop})`,
      });
      return {
        success: true,
        message: `Finalized ${res.finalizedCount} winners for campaign.`,
      };
    }

    if (actionType === "issue_test_reward") {
      const customerProgressId = String(formData.get("customerProgressId") || "");
      if (!customerProgressId) return { success: false, error: "Select a participant." };

      const res = await issueCustomerReward({
        campaignId,
        customerProgressId,
        rewardType: "discount",
        percentage: 10,
        adminUser: session.shop,
        adminGraphqlClient: admin?.graphql,
        isTestRunner: !admin?.graphql,
      });

      return {
        success: true,
        message: `Issued 10% discount reward: ${res.discountCode}!`,
      };
    }

    if (actionType === "reset_participant_progress") {
      const customerProgressId = String(formData.get("customerProgressId") || "");
      if (!customerProgressId) return { success: false, error: "Select a participant." };

      await prisma.$transaction(async (tx) => {
        await tx.submission.deleteMany({ where: { customerProgressId } });
        await tx.pointTransaction.deleteMany({ where: { customerProgressId } });
        await tx.reward.deleteMany({ where: { customerProgressId } });
        await tx.winner.deleteMany({ where: { customerProgressId } });
        await tx.customerProgress.update({
          where: { id: customerProgressId },
          data: {
            totalPoints: 0,
            currentLevel: 1,
            status: "active",
            completedAt: null,
            eligibleAt: null,
          },
        });
      });

      return {
        success: true,
        message: "Reset participant progress to Day 1 with 0 points.",
      };
    }

    return { success: false, error: "Unknown action." };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Dev action failed";
    return { success: false, error: msg };
  }
};

export default function DevToolsPage() {
  const { campaign, testParticipants } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.success) {
      shopify.toast.show(actionData.message || "Test action succeeded!");
    } else if (actionData?.error) {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData, shopify]);

  if (!campaign) {
    return (
      <s-page heading="Developer Test Suite">
        <s-section heading="No Active Campaign">
          <div style={{ padding: "32px", textAlign: "center", background: "#ffffff", borderRadius: "10px", border: "1px solid #e1e3e5" }}>
            <div style={{ fontSize: "16px", fontWeight: "bold", color: "#202223" }}>No active campaign found</div>
          </div>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="🧪 Development & QA Testing Console">
      {/* Notice Banner */}
      <div
        style={{
          background: "#fef3c7",
          border: "1.5px solid #fde68a",
          borderRadius: "10px",
          padding: "16px 20px",
          marginBottom: "20px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
        }}
      >
        <span style={{ fontSize: "24px" }}>🧪</span>
        <div>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "#92400e" }}>
            Development QA Testing Environment (Admin Only)
          </div>
          <div style={{ fontSize: "12px", color: "#b45309", marginTop: "2px" }}>
            Simulate complete customer journey steps: participant creation, submissions, reviews, points, referrals, winners, and Shopify rewards.
          </div>
        </div>
      </div>

      {/* 1-Click QA Quick Actions */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "16px",
          marginBottom: "28px",
        }}
      >
        <div style={{ background: "#ffffff", borderRadius: "10px", padding: "20px", border: "1px solid #e1e3e5", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize: "15px", fontWeight: "bold", color: "#111827", marginBottom: "4px" }}>
            1. Spawn Test Customer
          </div>
          <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "16px" }}>
            Creates a clean test customer progress record with 0 points.
          </div>
          <Form method="post">
            <input type="hidden" name="campaignId" value={campaign.id} />
            <input type="hidden" name="actionType" value="create_test_participant" />
            <button type="submit"  disabled={isSubmitting} style={{ background: "#000", color: "#fff", padding: "10px 20px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: 600 }}>
              + Create Test Participant
            </button>
          </Form>
        </div>

        <div style={{ background: "#ffffff", borderRadius: "10px", padding: "20px", border: "1px solid #e1e3e5", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize: "15px", fontWeight: "bold", color: "#111827", marginBottom: "4px" }}>Set Temporary Test Users to 1,000 Points</div>
          <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "16px" }}>Raises only test_player_ accounts to the winner eligibility threshold, so you can inspect the winner list.</div>
          <Form method="post">
            <input type="hidden" name="campaignId" value={campaign.id} />
            <input type="hidden" name="actionType" value="fast_forward_all_test_participants" />
            <button type="submit"  disabled={isSubmitting} style={{ background: "#000", color: "#fff", padding: "10px 20px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: 600 }}>⚡ Set Test Users to 1,000</button>
          </Form>
        </div>
        <div style={{ background: "#ffffff", borderRadius: "10px", padding: "20px", border: "1px solid #e1e3e5", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize: "15px", fontWeight: "bold", color: "#111827", marginBottom: "4px" }}>
            2. Finalize Top 25 Winners
          </div>
          <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "16px" }}>
            Locks top eligible participants into the immutable Winner table.
          </div>
          <Form method="post">
            <input type="hidden" name="campaignId" value={campaign.id} />
            <input type="hidden" name="actionType" value="finalize_top25" />
            <button type="submit"  disabled={isSubmitting} style={{ background: "#000", color: "#fff", padding: "10px 20px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: 600 }}>
              🔒 Finalize Top 25
            </button>
          </Form>
        </div>
      </div>

      {/* Participant Actions Console */}
      <div
        style={{
          background: "#ffffff",
          borderRadius: "10px",
          border: "1px solid #e1e3e5",
          padding: "20px 24px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}
      >
        <div style={{ fontSize: "16px", fontWeight: "bold", color: "#202223", marginBottom: "4px" }}>
          Interactive Customer Flow Simulators
        </div>
        <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "20px" }}>
          Execute state transitions on behalf of test participants.
        </div>

        {testParticipants.length === 0 ? (
          <div style={{ padding: "24px", textAlign: "center", color: "#6d7175" }}>
            No test participants found. Click &ldquo;Create Test Participant&rdquo; above.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {testParticipants.map((p) => {
              const pendingSub = p.submissions.find((s) => s.status === "pending");

              return (
                <div
                  key={p.id}
                  style={{
                    background: "#f9fafb",
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    padding: "16px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", marginBottom: "12px" }}>
                    <div>
                      <span style={{ fontWeight: "bold", color: "#111827", fontSize: "14px" }}>
                        {p.shopifyCustomerId}
                      </span>
                      <span style={{ marginLeft: "10px", fontSize: "13px", fontWeight: 700, color: "#059669" }}>
                        {p.totalPoints} pts
                      </span>
                      <span style={{ marginLeft: "8px", background: "#e0e7ff", color: "#3730a3", fontSize: "11px", fontWeight: 700, padding: "2px 6px", borderRadius: "6px" }}>
                        Day {p.currentLevel}
                      </span>
                      <span style={{ marginLeft: "8px", background: p.status === "winner" ? "#fef3c7" : p.status === "eligible" ? "#dcfce7" : "#f3f4f6", color: p.status === "winner" ? "#b45309" : p.status === "eligible" ? "#166534" : "#4b5563", fontSize: "11px", fontWeight: 700, padding: "2px 6px", borderRadius: "6px", textTransform: "uppercase" }}>
                        {p.status}
                      </span>
                    </div>
                    <div style={{ fontSize: "11px", color: "#6b7280" }}>
                      Submissions: {p.submissions.length} • Rewards: {p.rewards.length}
                    </div>
                  </div>

                  {/* Pending Submission Review Bar */}
                  {pendingSub && (
                    <div
                      style={{
                        padding: "10px 14px",
                        background: "#fffbeb",
                        borderRadius: "6px",
                        border: "1px solid #fde68a",
                        marginBottom: "12px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ fontSize: "12px", color: "#92400e" }}>
                        <strong>Pending Review:</strong> Day {pendingSub.level?.levelNumber || "?"} {pendingSub.submissionType}
                      </div>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <Form method="post" style={{ display: "inline" }}>
                          <input type="hidden" name="campaignId" value={campaign.id} />
                          <input type="hidden" name="actionType" value="approve_submission" />
                          <input type="hidden" name="submissionId" value={pendingSub.id} />
                          <button type="submit"  disabled={isSubmitting} style={{ background: "#000", color: "#fff", padding: "10px 20px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: 600 }}>
                            {pendingSub.level?.levelNumber === 10 ? "✓ Save Feedback (0 pts)" : "✓ Approve (+100)"}
                          </button>
                        </Form>
                        <Form method="post" style={{ display: "inline" }}>
                          <input type="hidden" name="campaignId" value={campaign.id} />
                          <input type="hidden" name="actionType" value="reject_submission" />
                          <input type="hidden" name="submissionId" value={pendingSub.id} />
                          <button type="submit"  disabled={isSubmitting} style={{ background: "#fff", color: "#000", border: "1px solid #ccc", padding: "10px 20px", borderRadius: "6px", cursor: "pointer", fontWeight: 600 }}>
                            ✕ Reject
                          </button>
                        </Form>
                      </div>
                    </div>
                  )}

                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    {/* +100 Points */}
                    <Form method="post">
                      <input type="hidden" name="campaignId" value={campaign.id} />
                      <input type="hidden" name="actionType" value="award_test_points" />
                      <input type="hidden" name="customerProgressId" value={p.id} />
                      <input type="hidden" name="points" value="100" />
                      <button type="submit" disabled={isSubmitting} style={{ background: "#000", color: "#fff", padding: "10px 20px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: 600 }}>
                        +100 Points
                      </button>
                    </Form>

                    {/* Fast forward to 1000 */}
                    {p.totalPoints < 1000 && (
                      <Form method="post">
                        <input type="hidden" name="campaignId" value={campaign.id} />
                        <input type="hidden" name="actionType" value="fast_forward_1000" />
                        <input type="hidden" name="customerProgressId" value={p.id} />
                        <button type="submit" disabled={isSubmitting} style={{ background: "#000", color: "#fff", padding: "10px 20px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: 600 }}>
                          ⚡ Reach 1,000 Pts
                        </button>
                      </Form>
                    )}

                    {/* Simulate Pending Photo Submission */}
                    <Form method="post">
                      <input type="hidden" name="campaignId" value={campaign.id} />
                      <input type="hidden" name="actionType" value="simulate_photo_submission" />
                      <input type="hidden" name="customerProgressId" value={p.id} />
                      <button type="submit" disabled={isSubmitting} style={{ background: "#000", color: "#fff", padding: "10px 20px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: 600 }}>
                        📷 Submit Photo
                      </button>
                    </Form>

                    {/* Simulate Referral */}
                    <Form method="post">
                      <input type="hidden" name="campaignId" value={campaign.id} />
                      <input type="hidden" name="actionType" value="simulate_referral_flow" />
                      <input type="hidden" name="customerProgressId" value={p.id} />
                      <button type="submit" disabled={isSubmitting} style={{ background: "#000", color: "#fff", padding: "10px 20px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: 600 }}>
                        🤝 Referral (+100)
                      </button>
                    </Form>

                    {/* Issue Reward */}
                    <Form method="post">
                      <input type="hidden" name="campaignId" value={campaign.id} />
                      <input type="hidden" name="actionType" value="issue_test_reward" />
                      <input type="hidden" name="customerProgressId" value={p.id} />
                      <button type="submit"  disabled={isSubmitting || p.totalPoints < 1000} style={{ background: "#000", color: "#fff", padding: "10px 20px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: 600 }}>
                        🎁 Issue Reward
                      </button>
                    </Form>

                    {/* Reset */}
                    <Form method="post">
                      <input type="hidden" name="campaignId" value={campaign.id} />
                      <input type="hidden" name="actionType" value="reset_participant_progress" />
                      <input type="hidden" name="customerProgressId" value={p.id} />
                      <button type="submit"  disabled={isSubmitting} style={{ background: "#fff", color: "#000", border: "1px solid #ccc", padding: "10px 20px", borderRadius: "6px", cursor: "pointer", fontWeight: 600 }}>
                        ↺ Reset
                      </button>
                    </Form>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

