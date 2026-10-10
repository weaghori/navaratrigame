import { useState, useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getActiveCampaign } from "../services/campaign.server";
import { getEligibleCandidates, finalizeSelectedWinners } from "../services/winner.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const campaign = await getActiveCampaign();

  if (!campaign) {
    return {
      campaign: null,
      eligibleCandidates: [],
      finalizedWinners: [],
      isFinalized: false,
      adminShop: session.shop,
    };
  }

  const [eligibleCandidates, finalizedWinners] = await Promise.all([
    getEligibleCandidates(campaign.id),
    prisma.winner.findMany({
      where: { campaignId: campaign.id },
      orderBy: { rank: "asc" },
      include: {
        customerProgress: true,
      },
    }),
  ]);

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      maxPoints: campaign.maxPoints,
    },
    eligibleCandidates: eligibleCandidates.map((c) => ({
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
    isFinalized: finalizedWinners.length > 0,
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
      const selectedIds = String(formData.get("selectedIds") || "").split(",").filter(Boolean);
      if (!selectedIds.length) {
        return { success: false, error: "No winners selected." };
      }
      const result = await finalizeSelectedWinners({
        campaignId,
        customerProgressIds: selectedIds,
        adminUser: `Shopify Admin (${session.shop})`,
      });

      return {
        success: true,
        message: `Successfully finalized ${result.finalizedCount} winners!`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to finalize winners";
      return { success: false, error: msg };
    }
  }

  return { success: false, error: "Unknown action." };
};

export default function WinnersPage() {
  const { campaign, eligibleCandidates, finalizedWinners, isFinalized } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  const [numWinners, setNumWinners] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.success) {
      shopify.toast.show(actionData.message || "Winners finalized successfully!");
      setShowConfirmModal(false);
      setSelectedIds([]);
    } else if (actionData?.error) {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData, shopify]);

  const handleRandomSelect = () => {
    if (eligibleCandidates.length === 0) {
      shopify.toast.show("No eligible candidates available.", { isError: true });
      return;
    }
    const shuffled = [...eligibleCandidates].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, numWinners).map(c => c.id);
    setSelectedIds(selected);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  if (!campaign) {
    return (
      <s-page heading="Winners Management">
        <s-section heading="No Active Campaign">
          <div style={{ padding: "32px", textAlign: "center", background: "#ffffff", borderRadius: "10px", border: "1px solid #e1e3e5" }}>
            <div style={{ fontSize: "16px", fontWeight: "bold", color: "#202223" }}>No active campaign found</div>
          </div>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Winners Management">
      <div style={{ background: "#ffffff", borderRadius: "10px", padding: "20px 24px", border: "1px solid #e1e3e5", marginBottom: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "22px" }}>🏆</span>
              <span style={{ fontSize: "20px", fontWeight: "bold", color: "#202223" }}>Select Winners</span>
            </div>
            <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "4px" }}>
              Choose winners manually or randomly from {eligibleCandidates.length} eligible participants.
            </div>
          </div>

          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <input 
              type="number" 
              min={1} 
              max={eligibleCandidates.length || 1} 
              value={numWinners} 
              onChange={(e) => setNumWinners(parseInt(e.target.value) || 1)}
              style={{ padding: "8px 12px", border: "1px solid #c9cccf", borderRadius: "4px", width: "80px" }}
            />
            <button style={{ background: "#f4f6f8", color: "#202223", border: "1px solid #c9cccf", padding: "8px 16px", borderRadius: "4px", cursor: "pointer", fontWeight: 600 }} onClick={handleRandomSelect}>
              🎲 Pick Random
            </button>
            <button disabled={selectedIds.length === 0} style={{ background: selectedIds.length > 0 ? "#008060" : "#f4f6f8", color: selectedIds.length > 0 ? "#fff" : "#8c9196", border: "none", padding: "8px 16px", borderRadius: "4px", cursor: selectedIds.length > 0 ? "pointer" : "not-allowed", fontWeight: 600 }} onClick={() => setShowConfirmModal(true)}>
              🔒 Finalize ({selectedIds.length})
            </button>
          </div>
        </div>
      </div>

      {finalizedWinners.length > 0 && (
        <div style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "18px", fontWeight: "bold", marginBottom: "12px", color: "#202223" }}>Previously Finalized Winners</h2>
          <div style={{ background: "#ffffff", borderRadius: "10px", border: "1px solid #e1e3e5", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e1e3e5", textAlign: "left", color: "#4b5563" }}>
                  <th style={{ padding: "12px 16px" }}>Rank</th>
                  <th style={{ padding: "12px 16px" }}>Customer</th>
                  <th style={{ padding: "12px 16px" }}>Display Name</th>
                  <th style={{ padding: "12px 16px" }}>Points</th>
                </tr>
              </thead>
              <tbody>
                {finalizedWinners.map(w => (
                  <tr key={w.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "12px 16px", fontWeight: "bold" }}>#{w.rank}</td>
                    <td style={{ padding: "12px 16px" }}>{w.shopifyCustomerId}</td>
                    <td style={{ padding: "12px 16px" }}>{w.customerProgress.displayName || "Unknown"}</td>
                    <td style={{ padding: "12px 16px", color: "#059669", fontWeight: "bold" }}>{w.customerProgress.totalPoints} pts</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <h2 style={{ fontSize: "18px", fontWeight: "bold", marginBottom: "12px", color: "#202223" }}>Eligible Candidates</h2>
        <div style={{ background: "#ffffff", borderRadius: "10px", border: "1px solid #e1e3e5", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e1e3e5", textAlign: "left", color: "#4b5563" }}>
                <th style={{ padding: "12px 16px", width: "40px" }}>Select</th>
                <th style={{ padding: "12px 16px" }}>Customer ID</th>
                <th style={{ padding: "12px 16px" }}>Display Name</th>
                <th style={{ padding: "12px 16px" }}>Points</th>
                <th style={{ padding: "12px 16px" }}>Level</th>
              </tr>
            </thead>
            <tbody>
              {eligibleCandidates.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: "24px", textAlign: "center", color: "#6d7175" }}>No eligible candidates available yet.</td>
                </tr>
              ) : eligibleCandidates.map((c) => (
                <tr key={c.id} style={{ borderBottom: "1px solid #f3f4f6", background: selectedIds.includes(c.id) ? "#f0fdf4" : "transparent" }}>
                  <td style={{ padding: "12px 16px" }}>
                    <input type="checkbox" checked={selectedIds.includes(c.id)} onChange={() => toggleSelect(c.id)} style={{ cursor: "pointer", width: "16px", height: "16px" }} />
                  </td>
                  <td style={{ padding: "12px 16px", fontWeight: 600 }}>{c.shopifyCustomerId}</td>
                  <td style={{ padding: "12px 16px" }}>{c.displayName || "-"}</td>
                  <td style={{ padding: "12px 16px", color: "#059669", fontWeight: "bold" }}>{c.totalPoints} pts</td>
                  <td style={{ padding: "12px 16px" }}>{c.currentLevel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showConfirmModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
          <div style={{ background: "#ffffff", borderRadius: "12px", maxWidth: "500px", width: "100%", padding: "24px", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)" }}>
            <div style={{ fontSize: "18px", fontWeight: "bold", color: "#111827", marginBottom: "8px" }}>Finalize {selectedIds.length} Winners?</div>
            <div style={{ fontSize: "13px", color: "#4b5563", lineHeight: "1.5", marginBottom: "20px" }}>
              This will lock the selected {selectedIds.length} candidates into the official Winner records table. This action cannot be undone.
            </div>

            <Form method="post">
              <input type="hidden" name="campaignId" value={campaign.id} />
              <input type="hidden" name="actionType" value="finalize_winners" />
              <input type="hidden" name="selectedIds" value={selectedIds.join(",")} />

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button type="button" style={{ background: "#f4f6f8", color: "#202223", padding: "10px 20px", borderRadius: "6px", border: "1px solid #c9cccf", cursor: "pointer", fontWeight: 600 }} onClick={() => setShowConfirmModal(false)}>Cancel</button>
                <button type="submit" disabled={isSubmitting} style={{ background: "#008060", color: "#fff", padding: "10px 20px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: 600 }}>{isSubmitting ? "Finalizing..." : "Yes, Finalize Winners"}</button>
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
}
