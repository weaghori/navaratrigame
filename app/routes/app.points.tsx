import { useState, useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, useSearchParams, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getActiveCampaign } from "../services/campaign.server";
import { adjustPointsAdmin, aggregateQuizTransactions } from "../services/customer.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);

  const typeFilter = url.searchParams.get("type") || "all";
  const campaign = await getActiveCampaign();

  if (!campaign) {
    return {
      campaign: null,
      transactions: [],
      participants: [],
      typeFilter,
      adminShop: session.shop,
    };
  }

  const where: Record<string, unknown> = {
    customerProgress: { campaignId: campaign.id },
  };

  if (typeFilter !== "all") {
    if (typeFilter === "quiz") {
      where.OR = [
        { transactionType: "quiz_completed" },
        { transactionType: { startsWith: "quiz_question_" } },
      ];
    } else {
      where.transactionType = typeFilter;
    }
  }

  const [transactions, participants] = await Promise.all([
    prisma.pointTransaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        level: true,
        customerProgress: true,
      },
    }),
    prisma.customerProgress.findMany({
      where: { campaignId: campaign.id },
      orderBy: { totalPoints: "desc" },
      select: {
        id: true,
        shopifyCustomerId: true,
        displayName: true,
        totalPoints: true,
      },
    }),
  ]);

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
    },
    transactions: aggregateQuizTransactions(transactions).map((t) => ({
      ...t,
      createdAt: t.createdAt.toISOString(),
    })),
    participants,
    typeFilter,
    adminShop: session.shop,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const customerProgressId = String(formData.get("customerProgressId") || "");
  const points = Number(formData.get("points"));
  const reason = String(formData.get("reason") || "").trim();

  if (!customerProgressId) {
    return { success: false, error: "Please select a customer." };
  }

  if (isNaN(points) || points === 0) {
    return { success: false, error: "Points must be a non-zero number (e.g. +100 or -50)." };
  }

  if (!reason) {
    return { success: false, error: "A clear reason is required for manual point adjustment." };
  }

  try {
    const result = await adjustPointsAdmin({
      customerProgressId,
      points,
      reason,
      adminUser: session.shop,
    });

    return {
      success: true,
      message: `Points adjusted by ${points >= 0 ? `+${points}` : points}. Customer new balance: ${result.progress.totalPoints} pts.`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Adjustment failed";
    return { success: false, error: msg };
  }
};

export default function PointsHistoryPage() {
  const { campaign, transactions, participants, typeFilter } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.success) {
      shopify.toast.show(actionData.message || "Points adjusted successfully!");
      setShowAdjustmentModal(false);
    } else if (actionData?.error) {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData, shopify]);

  const handleFilter = (type: string) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("type", type);
      return p;
    });
  };

  if (!campaign) {
    return (
      <s-page heading="Points Ledger">
        <s-section heading="No Active Campaign">
          <div style={{ padding: "32px", textAlign: "center", background: "#ffffff", borderRadius: "10px", border: "1px solid #e1e3e5" }}>
            <div style={{ fontSize: "16px", fontWeight: "bold", color: "#202223" }}>No active campaign found</div>
          </div>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Points Ledger & Audit History">
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
            <div style={{ fontSize: "18px", fontWeight: "bold", color: "#202223" }}>
              🪙 Points Audit Trail & Ledger
            </div>
            <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "2px" }}>
              Immutable record of all level completion rewards, referral bonuses, and administrative adjustments.
            </div>
          </div>
          <button  style={{ background: "#000", color: "#fff", padding: "10px 20px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: 600 }} onClick={() => setShowAdjustmentModal(true)}>
            + Manual Points Adjustment
          </button>
        </div>

        {/* Filter Tabs */}
        <div style={{ display: "flex", gap: "8px", marginTop: "16px", borderBottom: "1px solid #e5e7eb", paddingBottom: "8px" }}>
          {[
            { id: "all", label: "All Transactions" },
            { id: "quiz", label: "Quiz Rewards" },
            { id: "media", label: "Media Challenges" },
            { id: "text", label: "Text Challenges" },
            { id: "referral", label: "Referral Bonuses" },
            { id: "admin_adjustment", label: "Admin Adjustments" },
          ].map((tab) => {
            const isSelected = typeFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleFilter(tab.id)}
                style={{
                  background: isSelected ? "#065f46" : "#f3f4f6",
                  color: isSelected ? "#ffffff" : "#4b5563",
                  border: "none",
                  padding: "8px 14px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Transactions Table */}
      {transactions.length === 0 ? (
        <div
          style={{
            background: "#ffffff",
            borderRadius: "10px",
            border: "1px solid #e1e3e5",
            padding: "48px 24px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "36px", marginBottom: "12px" }}>🪙</div>
          <div style={{ fontSize: "16px", fontWeight: "bold", color: "#202223", marginBottom: "6px" }}>
            No point transactions found
          </div>
          <div style={{ fontSize: "13px", color: "#6d7175" }}>
            Transactions will appear here as customers complete challenges.
          </div>
        </div>
      ) : (
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
                <th style={{ padding: "12px 16px" }}>Timestamp</th>
                <th style={{ padding: "12px 16px" }}>Customer</th>
                <th style={{ padding: "12px 16px" }}>Points</th>
                <th style={{ padding: "12px 16px" }}>Type</th>
                <th style={{ padding: "12px 16px" }}>Level</th>
                <th style={{ padding: "12px 16px" }}>Description / Reason</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => {
                const isPositive = t.points >= 0;
                return (
                  <tr key={t.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "14px 16px", color: "#6b7280", fontSize: "12px" }}>
                      {new Date(t.createdAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                    </td>
                    <td style={{ padding: "14px 16px", fontWeight: 600, color: "#111827" }}>
                      {t.customerProgress.displayName || "Player"}
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "3px 10px",
                          borderRadius: "12px",
                          fontSize: "12px",
                          fontWeight: "bold",
                          background: isPositive ? "#dcfce7" : "#fee2e2",
                          color: isPositive ? "#166534" : "#991b1b",
                        }}
                      >
                        {isPositive ? `+${t.points}` : t.points} pts
                      </span>
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <span
                        style={{
                          background: "#f3f4f6",
                          color: "#374151",
                          fontSize: "11px",
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: "6px",
                          textTransform: "uppercase",
                        }}
                      >
                        {t.transactionType.replace("_", " ")}
                      </span>
                    </td>
                    <td style={{ padding: "14px 16px", color: "#4b5563" }}>
                      {t.level ? `Day ${t.level.levelNumber}` : "—"}
                    </td>
                    <td style={{ padding: "14px 16px", color: "#374151" }}>
                      {t.description || "Activity point award"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Manual Points Adjustment Modal */}
      {showAdjustmentModal && (
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
              maxWidth: "520px",
              width: "100%",
              padding: "24px",
              boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div style={{ fontSize: "18px", fontWeight: "bold", color: "#111827" }}>
                Manual Points Adjustment
              </div>
              <button
                type="button"
                onClick={() => setShowAdjustmentModal(false)}
                style={{ background: "none", border: "none", fontSize: "18px", cursor: "pointer", color: "#6b7280" }}
              >
                ✕
              </button>
            </div>

            <div style={{ background: "#fef3c7", border: "1px solid #fde68a", padding: "12px 14px", borderRadius: "8px", fontSize: "12px", color: "#92400e", marginBottom: "16px" }}>
              ⚠️ <strong>Administrative Action:</strong> This will adjust the customer&rsquo;s live balance and record an audit log entry.
            </div>

            <Form method="post">
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "4px" }}>
                    Select Customer *
                  </label>
                  <select
                    name="customerProgressId"
                    required
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      border: "1px solid #d1d5db",
                      fontSize: "13px",
                      boxSizing: "border-box",
                    }}
                  >
                    <option value="">-- Choose participating customer --</option>
                    {participants.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.displayName || "Player"} ({p.totalPoints} pts)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "4px" }}>
                    Points to Add / Subtract *
                  </label>
                  <input
                    type="number"
                    name="points"
                    placeholder="e.g. +100 or -50"
                    required
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      border: "1px solid #d1d5db",
                      fontSize: "14px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "4px" }}>
                    Reason for Adjustment *
                  </label>
                  <input
                    type="text"
                    name="reason"
                    placeholder="e.g. Support ticket #1042 manual bonus"
                    required
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      border: "1px solid #d1d5db",
                      fontSize: "13px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
                  <button type="button" style={{ background: "#000", color: "#fff", padding: "10px 20px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: 600 }} onClick={() => setShowAdjustmentModal(false)}>
                    Cancel
                  </button>
                  <button type="submit"  disabled={isSubmitting} style={{ background: "#000", color: "#fff", padding: "10px 20px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: 600 }}>
                    {isSubmitting ? "Applying..." : "Confirm Adjustment"}
                  </button>
                </div>
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


