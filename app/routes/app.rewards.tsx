import { useState, useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, useSearchParams, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getActiveCampaign } from "../services/campaign.server";
import { getRewardsList, issueCustomerReward, cancelRewardAdmin } from "../services/reward.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);

  const status = url.searchParams.get("status") || "all";
  const campaign = await getActiveCampaign();

  if (!campaign) {
    return {
      campaign: null,
      rewards: [],
      eligibleCandidates: [],
      stats: { eligibleCount: 0, issuedCount: 0, pendingCount: 0, usedCount: 0 },
      statusFilter: status,
      adminShop: session.shop,
    };
  }

  const [rewardsResult, eligibleCandidates, issuedCount, usedCount] = await Promise.all([
    getRewardsList({
      campaignId: campaign.id,
      status: status === "all" ? undefined : status,
      limit: 100,
    }),
    prisma.customerProgress.findMany({
      where: {
        campaignId: campaign.id,
        OR: [
          { totalPoints: { gte: campaign.maxPoints || 1000 } },
          { status: { in: ["eligible", "completed", "winner"] } },
        ],
        rewards: {
          none: {
            status: { in: ["issued", "pending"] },
          },
        },
      },
      include: {
        winner: true,
      },
      orderBy: { totalPoints: "desc" },
      take: 50,
    }),
    prisma.reward.count({
      where: { campaignId: campaign.id, status: "issued" },
    }),
    prisma.reward.count({
      where: { campaignId: campaign.id, status: "used" },
    }),
  ]);

  const eligibleCount = eligibleCandidates.length + issuedCount + usedCount;
  const pendingCount = eligibleCandidates.length;

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      slug: campaign.slug,
      maxPoints: campaign.maxPoints,
    },
    rewards: rewardsResult.rewards.map((r) => ({
      ...r,
      issuedAt: r.issuedAt ? r.issuedAt.toISOString() : null,
      usedAt: r.usedAt ? r.usedAt.toISOString() : null,
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      customerProgress: {
        ...r.customerProgress,
        createdAt: r.customerProgress.createdAt.toISOString(),
      },
    })),
    eligibleCandidates: eligibleCandidates.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
      eligibleAt: c.eligibleAt ? c.eligibleAt.toISOString() : null,
      completedAt: c.completedAt ? c.completedAt.toISOString() : null,
    })),
    stats: {
      eligibleCount,
      issuedCount,
      pendingCount,
      usedCount,
    },
    statusFilter: status,
    adminShop: session.shop,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const actionType = String(formData.get("actionType") || "");
  const campaignId = String(formData.get("campaignId") || "");

  if (!campaignId) {
    return { success: false, error: "Campaign ID is required." };
  }

  if (actionType === "issue_reward") {
    const customerProgressId = String(formData.get("customerProgressId") || "");
    const percentage = Number(formData.get("percentage")) || 10;
    const rewardType = (formData.get("rewardType") as "discount") || "discount";

    if (!customerProgressId) {
      return { success: false, error: "Please select a customer to issue reward." };
    }

    try {
      const result = await issueCustomerReward({
        campaignId,
        customerProgressId,
        rewardType,
        percentage,
        adminUser: `Shopify Admin (${session.shop})`,
        adminGraphqlClient: admin?.graphql,
      });

      return {
        success: true,
        message: `Successfully created ${percentage}% OFF Shopify Discount Code: ${result.discountCode}! Reward marked as issued.`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Reward issuance failed";
      return { success: false, error: msg };
    }
  }

  if (actionType === "cancel_reward") {
    const rewardId = String(formData.get("rewardId") || "");
    if (!rewardId) {
      return { success: false, error: "Missing reward ID to cancel." };
    }

    try {
      await cancelRewardAdmin({
        rewardId,
        adminUser: `Shopify Admin (${session.shop})`,
      });

      return {
        success: true,
        message: "Reward has been cancelled.",
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to cancel reward";
      return { success: false, error: msg };
    }
  }

  return { success: false, error: "Unknown action." };
};

export default function RewardsPage() {
  const { campaign, rewards, eligibleCandidates, stats, statusFilter } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  const [selectedCandidate, setSelectedCandidate] = useState<(typeof eligibleCandidates)[0] | null>(null);
  const [discountPercent, setDiscountPercent] = useState<number>(10);

  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.success) {
      shopify.toast.show(actionData.message || "Action successful!");
      setSelectedCandidate(null);
    } else if (actionData?.error) {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData, shopify]);

  const handleStatusFilter = (st: string) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("status", st);
      return p;
    });
  };

  if (!campaign) {
    return (
      <s-page heading="Campaign Rewards">
        <s-section heading="No Active Campaign">
          <div style={{ padding: "32px", textAlign: "center", background: "#ffffff", borderRadius: "10px", border: "1px solid #e1e3e5" }}>
            <div style={{ fontSize: "16px", fontWeight: "bold", color: "#202223" }}>No active campaign found</div>
          </div>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Rewards & Shopify Discount Management">
      {/* 4 Key Reward Metrics */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        <div style={{ background: "#ffffff", borderRadius: "10px", padding: "18px 20px", border: "1px solid #e1e3e5", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "#6d7175", textTransform: "uppercase" }}>
            Eligible Customers
          </div>
          <div style={{ fontSize: "28px", fontWeight: "bold", color: "#202223", marginTop: "6px" }}>
            {stats.eligibleCount}
          </div>
          <div style={{ fontSize: "12px", color: "#059669", marginTop: "2px" }}>
            Achieved 1000+ points threshold
          </div>
        </div>

        <div style={{ background: "#ffffff", borderRadius: "10px", padding: "18px 20px", border: "1px solid #e1e3e5", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "#6d7175", textTransform: "uppercase" }}>
            Rewards Issued
          </div>
          <div style={{ fontSize: "28px", fontWeight: "bold", color: "#108043", marginTop: "6px" }}>
            {stats.issuedCount}
          </div>
          <div style={{ fontSize: "12px", color: "#108043", marginTop: "2px" }}>
            Shopify discounts active
          </div>
        </div>

        <div style={{ background: "#ffffff", borderRadius: "10px", padding: "18px 20px", border: "1px solid #e1e3e5", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "#6d7175", textTransform: "uppercase" }}>
            Pending Issuance
          </div>
          <div style={{ fontSize: "28px", fontWeight: "bold", color: stats.pendingCount > 0 ? "#b98900" : "#202223", marginTop: "6px" }}>
            {stats.pendingCount}
          </div>
          <div style={{ fontSize: "12px", color: stats.pendingCount > 0 ? "#b98900" : "#6d7175", marginTop: "2px" }}>
            {stats.pendingCount > 0 ? "Awaiting admin code generation" : "All issued"}
          </div>
        </div>

        <div style={{ background: "#ffffff", borderRadius: "10px", padding: "18px 20px", border: "1px solid #e1e3e5", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "#6d7175", textTransform: "uppercase" }}>
            Rewards Redeemed
          </div>
          <div style={{ fontSize: "28px", fontWeight: "bold", color: "#2563eb", marginTop: "6px" }}>
            {stats.usedCount}
          </div>
          <div style={{ fontSize: "12px", color: "#2563eb", marginTop: "2px" }}>
            Used at store checkout
          </div>
        </div>
      </div>

      {/* Eligible Customers Pending Reward Issuance */}
      {eligibleCandidates.length > 0 && (
        <div
          style={{
            background: "#ffffff",
            borderRadius: "10px",
            border: "1.5px solid #fde68a",
            padding: "20px 24px",
            marginBottom: "28px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div>
              <div style={{ fontSize: "16px", fontWeight: "bold", color: "#92400e" }}>
                ⚡ {eligibleCandidates.length} Eligible Customers Ready for Reward Issuance
              </div>
              <div style={{ fontSize: "12px", color: "#b45309", marginTop: "2px" }}>
                These participants have unlocked 1000 points. Click &ldquo;Issue 10% Discount&rdquo; to create a real Shopify discount code.
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {eligibleCandidates.map((candidate) => (
              <div
                key={candidate.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "12px 16px",
                  background: "#fffbeb",
                  borderRadius: "8px",
                  border: "1px solid #fef3c7",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, color: "#111827", fontSize: "13px" }}>
                    {candidate.shopifyCustomerId}
                    {candidate.winner && (
                      <span style={{ marginLeft: "8px", background: "#f59e0b", color: "#ffffff", fontSize: "10px", fontWeight: 700, padding: "2px 6px", borderRadius: "8px" }}>
                        OFFICIAL WINNER #{candidate.winner.rank}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "12px", color: "#065f46", marginTop: "2px" }}>
                    Total Score: <strong>{candidate.totalPoints} pts</strong> • Day {candidate.currentLevel} Completed
                  </div>
                </div>
                <button  onClick={() = style={{ background: "#000", color: "#fff", padding: "10px 20px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: 600 }}> setSelectedCandidate(candidate)}>
                  Issue 10% Discount
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Issued Rewards History Table */}
      <div
        style={{
          background: "#ffffff",
          borderRadius: "10px",
          border: "1px solid #e1e3e5",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #e1e3e5", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <div style={{ fontSize: "16px", fontWeight: "bold", color: "#202223" }}>
              Issued Rewards & Shopify Discounts Ledger
            </div>
            <div style={{ fontSize: "12px", color: "#6d7175" }}>
              Active discount codes generated via Shopify Admin API.
            </div>
          </div>

          {/* Status Tabs */}
          <div style={{ display: "flex", gap: "6px" }}>
            {[
              { id: "all", label: "All" },
              { id: "issued", label: "Active" },
              { id: "used", label: "Used" },
              { id: "cancelled", label: "Cancelled" },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => handleStatusFilter(t.id)}
                style={{
                  background: statusFilter === t.id ? "#065f46" : "#f3f4f6",
                  color: statusFilter === t.id ? "#ffffff" : "#4b5563",
                  border: "none",
                  padding: "6px 12px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {rewards.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center", color: "#6d7175" }}>
            <div style={{ fontSize: "32px", marginBottom: "8px" }}>🎁</div>
            <div style={{ fontSize: "15px", fontWeight: "bold", color: "#202223" }}>No rewards issued yet</div>
            <div style={{ fontSize: "12px", marginTop: "4px" }}>
              When participants reach 1000 points, issue their discount codes above.
            </div>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e1e3e5", textAlign: "left", color: "#4b5563", fontSize: "12px", textTransform: "uppercase" }}>
                  <th style={{ padding: "12px 16px" }}>Customer</th>
                  <th style={{ padding: "12px 16px" }}>Reward Type</th>
                  <th style={{ padding: "12px 16px" }}>Discount Code</th>
                  <th style={{ padding: "12px 16px" }}>Status</th>
                  <th style={{ padding: "12px 16px" }}>Issued Date</th>
                  <th style={{ padding: "12px 16px" }}>Expiry Date</th>
                  <th style={{ padding: "12px 16px", textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rewards.map((r) => {
                  const isIssued = r.status === "issued";
                  const isUsed = r.status === "used";
                  const isCancelled = r.status === "cancelled";

                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "14px 16px" }}>
                        <div style={{ fontWeight: 600, color: "#111827" }}>
                          {r.shopifyCustomerId}
                        </div>
                        {r.customerProgress.winner && (
                          <span style={{ fontSize: "11px", color: "#d97706", fontWeight: 700 }}>
                            Official Winner #{r.customerProgress.winner.rank}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "14px 16px" }}>
                        <span style={{ fontWeight: 600, color: "#065f46" }}>
                          {r.rewardValue}% OFF
                        </span>
                        <div style={{ fontSize: "11px", color: "#6b7280" }}>
                          Shopify Basic Discount
                        </div>
                      </td>
                      <td style={{ padding: "14px 16px" }}>
                        <code
                          style={{
                            background: "#f0fdf4",
                            color: "#166534",
                            padding: "4px 8px",
                            borderRadius: "6px",
                            border: "1px solid #bbf7d0",
                            fontWeight: "bold",
                            fontSize: "12px",
                          }}
                        >
                          {r.discountCode}
                        </code>
                      </td>
                      <td style={{ padding: "14px 16px" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: "10px",
                            fontSize: "11px",
                            fontWeight: 700,
                            background: isIssued ? "#dcfce7" : isUsed ? "#e0e7ff" : isCancelled ? "#fee2e2" : "#f3f4f6",
                            color: isIssued ? "#166534" : isUsed ? "#3730a3" : isCancelled ? "#991b1b" : "#6b7280",
                            textTransform: "uppercase",
                          }}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td style={{ padding: "14px 16px", color: "#6b7280", fontSize: "12px" }}>
                        {r.issuedAt ? new Date(r.issuedAt).toLocaleDateString() : "—"}
                      </td>
                      <td style={{ padding: "14px 16px", color: "#6b7280", fontSize: "12px" }}>
                        {r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : "30 days"}
                      </td>
                      <td style={{ padding: "14px 16px", textAlign: "right" }}>
                        {isIssued && (
                          <Form method="post" style={{ display: "inline" }}>
                            <input type="hidden" name="campaignId" value={campaign.id} />
                            <input type="hidden" name="actionType" value="cancel_reward" />
                            <input type="hidden" name="rewardId" value={r.id} />
                            <button type="submit"  style={{ background: "#fff", color: "#000", border: "1px solid #ccc", padding: "10px 20px", borderRadius: "6px", cursor: "pointer", fontWeight: 600 }}>
                              Cancel
                            </button>
                          </Form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirmation & Issue Modal */}
      {selectedCandidate && (
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
            <div style={{ fontSize: "18px", fontWeight: "bold", color: "#111827", marginBottom: "8px" }}>
              Issue Real Shopify Discount Code
            </div>
            <div style={{ fontSize: "13px", color: "#4b5563", marginBottom: "16px" }}>
              This will invoke the Shopify Admin GraphQL API to generate a percentage coupon code applicable at checkout.
            </div>

            <div style={{ background: "#f9fafb", padding: "12px 16px", borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "13px", marginBottom: "16px" }}>
              <div><strong>Customer ID:</strong> <code>{selectedCandidate.shopifyCustomerId}</code></div>
              <div style={{ marginTop: "4px" }}><strong>Total Points:</strong> {selectedCandidate.totalPoints} pts</div>
              <div style={{ marginTop: "4px" }}><strong>Validity:</strong> 30 Days from issuance</div>
            </div>

            <Form method="post">
              <input type="hidden" name="campaignId" value={campaign.id} />
              <input type="hidden" name="actionType" value="issue_reward" />
              <input type="hidden" name="customerProgressId" value={selectedCandidate.id} />

              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "4px" }}>
                  Discount Percentage
                </label>
                <select
                  name="percentage"
                  value={discountPercent}
                  onChange={(e) => setDiscountPercent(Number(e.target.value))}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid #d1d5db",
                    fontSize: "14px",
                    boxSizing: "border-box",
                  }}
                >
                  <option value={10}>10% OFF Storewide</option>
                  <option value={15}>15% OFF Storewide</option>
                  <option value={20}>20% OFF Storewide</option>
                  <option value={25}>25% OFF Storewide</option>
                </select>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "20px" }}>
                <button type="button" onClick={() = style={{ background: "#000", color: "#fff", padding: "10px 20px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: 600 }}> setSelectedCandidate(null)}>
                  Cancel
                </button>
                <button type="submit"  disabled={isSubmitting} style={{ background: "#000", color: "#fff", padding: "10px 20px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: 600 }}>
                  {isSubmitting ? "Calling Shopify API..." : `Generate ${discountPercent}% Discount Code`}
                </button>
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

