import { useState, useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getActiveCampaign } from "../services/campaign.server";
import { getTop25Calculated, finalizeTop25Winners } from "../services/winner.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const campaign = await getActiveCampaign();

  if (!campaign) {
    return {
      campaign: null,
      candidates: [],
      finalizedWinners: [],
      isFinalized: false,
      adminShop: session.shop,
    };
  }

  const [calcResult, finalizedWinners] = await Promise.all([
    getTop25Calculated(campaign.id),
    prisma.winner.findMany({
      where: { campaignId: campaign.id },
      orderBy: { rank: "asc" },
      include: {
        customerProgress: true,
      },
    }),
  ]);

  const isFinalized = finalizedWinners.length > 0;

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      maxPoints: campaign.maxPoints,
    },
    candidates: calcResult.candidates.map((c) => ({
      ...c,
      eligibleAt: c.eligibleAt ? c.eligibleAt.toISOString() : null,
      completedAt: c.completedAt ? c.completedAt.toISOString() : null,
    })),
    finalizedWinners: finalizedWinners.map((w) => ({
      ...w,
      createdAt: w.createdAt.toISOString(),
      customerProgress: {
        ...w.customerProgress,
        createdAt: w.customerProgress.createdAt.toISOString(),
        completedAt: w.customerProgress.completedAt ? w.customerProgress.completedAt.toISOString() : null,
      },
    })),
    isFinalized,
    adminShop: session.shop,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const campaignId = String(formData.get("campaignId") || "");
  const actionType = String(formData.get("actionType") || "");

  if (!campaignId) {
    return { success: false, error: "Campaign ID is required." };
  }

  if (actionType === "finalize_winners") {
    try {
      const result = await finalizeTop25Winners({
        campaignId,
        adminUser: `Shopify Admin (${session.shop})`,
      });

      return {
        success: true,
        message: `Successfully finalized ${result.finalizedCount} winners for the campaign! Records locked into official Winner table.`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to finalize winners";
      return { success: false, error: msg };
    }
  }

  return { success: false, error: "Unknown action." };
};

export default function WinnersPage() {
  const { campaign, candidates, finalizedWinners, isFinalized } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.success) {
      shopify.toast.show(actionData.message || "Winners finalized successfully!");
      setShowConfirmModal(false);
    } else if (actionData?.error) {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData, shopify]);

  if (!campaign) {
    return (
      <s-page heading="Top 25 Winners">
        <s-section heading="No Active Campaign">
          <div style={{ padding: "32px", textAlign: "center", background: "#ffffff", borderRadius: "10px", border: "1px solid #e1e3e5" }}>
            <div style={{ fontSize: "16px", fontWeight: "bold", color: "#202223" }}>No active campaign found</div>
          </div>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Top 25 Winners Management">
      {/* Header Banner */}
      <div
        style={{
          background: "#ffffff",
          borderRadius: "10px",
          padding: "20px 24px",
          border: "1px solid #e1e3e5",
          marginBottom: "20px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "22px" }}>🏆</span>
              <span style={{ fontSize: "20px", fontWeight: "bold", color: "#202223" }}>Top 25 Winners</span>
              <span
                style={{
                  background: isFinalized ? "#dcfce7" : "#fef3c7",
                  color: isFinalized ? "#166534" : "#92400e",
                  fontSize: "12px",
                  fontWeight: 700,
                  padding: "3px 10px",
                  borderRadius: "12px",
                  textTransform: "uppercase",
                }}
              >
                {isFinalized ? "✓ FINALIZED" : "⚡ LIVE CANDIDATES"}
              </span>
            </div>
            <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "4px" }}>
              {isFinalized
                ? "Official winners have been locked in database. Proceed to issue grand rewards."
                : "Real-time ranking of top participants based on total points and completion timestamps."}
            </div>
          </div>

          {!isFinalized && (
            <s-button variant="primary" onClick={() => setShowConfirmModal(true)}>
              🔒 Finalize Top 25 Winners
            </s-button>
          )}
        </div>
      </div>

      {/* Finalization Notice Banner */}
      {!isFinalized ? (
        <div
          style={{
            background: "#fffbeb",
            border: "1.5px solid #fde68a",
            borderRadius: "10px",
            padding: "16px 20px",
            marginBottom: "20px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <span style={{ fontSize: "24px" }}>ℹ️</span>
          <div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#92400e" }}>
              Winner selection has not been finalized yet.
            </div>
            <div style={{ fontSize: "12px", color: "#b45309", marginTop: "2px" }}>
              The table below displays live calculated candidates. Click &ldquo;Finalize Top 25 Winners&rdquo; when the campaign period ends to lock official records.
            </div>
          </div>
        </div>
      ) : (
        <div
          style={{
            background: "#f0fdf4",
            border: "1.5px solid #bbf7d0",
            borderRadius: "10px",
            padding: "16px 20px",
            marginBottom: "20px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <span style={{ fontSize: "24px" }}>🎉</span>
          <div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#166534" }}>
              Top 25 Winners officially finalized!
            </div>
            <div style={{ fontSize: "12px", color: "#15803d", marginTop: "2px" }}>
              Official records are locked in the database. Head to <strong>Rewards</strong> to generate real Shopify discount codes.
            </div>
          </div>
        </div>
      )}

      {/* Table of Winners / Candidates */}
      <div
        style={{
          background: "#ffffff",
          borderRadius: "10px",
          border: "1px solid #e1e3e5",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          overflowX: "auto",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
          <thead>
            <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e1e3e5", textAlign: "left", color: "#4b5563", fontSize: "12px", textTransform: "uppercase" }}>
              <th style={{ padding: "12px 16px" }}>Official Rank</th>
              <th style={{ padding: "12px 16px" }}>Customer</th>
              <th style={{ padding: "12px 16px" }}>Points</th>
              <th style={{ padding: "12px 16px" }}>Progress Level</th>
              <th style={{ padding: "12px 16px" }}>Eligibility</th>
              <th style={{ padding: "12px 16px" }}>Reward Status</th>
              <th style={{ padding: "12px 16px" }}>Completed At</th>
            </tr>
          </thead>
          <tbody>
            {(isFinalized ? finalizedWinners : candidates).map((row) => {
              const rank = isFinalized ? (row as (typeof finalizedWinners)[0]).rank : (row as (typeof candidates)[0]).rank;
              const customerId = isFinalized
                ? (row as (typeof finalizedWinners)[0]).shopifyCustomerId
                : (row as (typeof candidates)[0]).shopifyCustomerId;
              const points = isFinalized
                ? (row as (typeof finalizedWinners)[0]).customerProgress.totalPoints
                : (row as (typeof candidates)[0]).totalPoints;
              const currentLevel = isFinalized
                ? (row as (typeof finalizedWinners)[0]).customerProgress.currentLevel
                : (row as (typeof candidates)[0]).currentLevel;
              const isEligible = points >= campaign.maxPoints;
              const rewardAssigned = isFinalized ? (row as (typeof finalizedWinners)[0]).rewardAssigned : false;
              const completedAt = isFinalized
                ? (row as (typeof finalizedWinners)[0]).customerProgress.completedAt
                : (row as (typeof candidates)[0]).completedAt;

              return (
                <tr key={"id" in row ? String(row.id) : (row as { customerProgressId: string }).customerProgressId} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "14px 16px", fontWeight: "bold", color: rank <= 3 ? "#d97706" : "#1f2937" }}>
                    #{rank} {rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : ""}
                  </td>
                  <td style={{ padding: "14px 16px" }}>
                    <div style={{ fontWeight: 600, color: "#111827" }}>
                      {customerId.replace(/\D/g, "").slice(-6) ? `Customer ...${customerId.slice(-6)}` : customerId}
                    </div>
                    <span style={{ fontSize: "11px", color: "#9ca3af" }}>ID: {customerId}</span>
                  </td>
                  <td style={{ padding: "14px 16px", fontWeight: "bold", color: "#059669" }}>
                    {points} pts
                  </td>
                  <td style={{ padding: "14px 16px" }}>
                    <span style={{ background: "#e0e7ff", color: "#3730a3", padding: "2px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 700 }}>
                      Day {currentLevel}
                    </span>
                  </td>
                  <td style={{ padding: "14px 16px" }}>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        borderRadius: "10px",
                        fontSize: "11px",
                        fontWeight: 700,
                        background: isEligible ? "#dcfce7" : "#fef3c7",
                        color: isEligible ? "#166534" : "#92400e",
                      }}
                    >
                      {isEligible ? "✓ Eligible (1000 pts)" : "Pending (Under 1000 pts)"}
                    </span>
                  </td>
                  <td style={{ padding: "14px 16px" }}>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        borderRadius: "10px",
                        fontSize: "11px",
                        fontWeight: 700,
                        background: rewardAssigned ? "#dcfce7" : "#f3f4f6",
                        color: rewardAssigned ? "#166534" : "#6b7280",
                      }}
                    >
                      {rewardAssigned ? "✓ Reward Issued" : "Pending Issuance"}
                    </span>
                  </td>
                  <td style={{ padding: "14px 16px", color: "#6b7280", fontSize: "12px" }}>
                    {completedAt ? new Date(completedAt).toLocaleString() : "In Progress"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Finalize Confirmation Modal */}
      {showConfirmModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "20px",
          }}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: "12px",
              maxWidth: "500px",
              width: "100%",
              padding: "24px",
              boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)",
            }}
          >
            <div style={{ fontSize: "18px", fontWeight: "bold", color: "#111827", marginBottom: "8px" }}>
              Finalize Top 25 Winners?
            </div>
            <div style={{ fontSize: "13px", color: "#4b5563", lineHeight: "1.5", marginBottom: "20px" }}>
              This will lock the current top 25 candidates into the official Winner records table. Once locked, rankings cannot be altered.
            </div>

            <Form method="post">
              <input type="hidden" name="campaignId" value={campaign.id} />
              <input type="hidden" name="actionType" value="finalize_winners" />

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <s-button type="button" onClick={() => setShowConfirmModal(false)}>
                  Cancel
                </s-button>
                <s-button type="submit" variant="primary" disabled={isSubmitting}>
                  {isSubmitting ? "Finalizing..." : "Yes, Finalize Winners"}
                </s-button>
              </div>
            </Form>
          </div>
        </div>
      )}
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
