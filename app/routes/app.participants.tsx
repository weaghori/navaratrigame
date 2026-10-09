import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, Form, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getActiveCampaign } from "../services/campaign.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const url = new URL(request.url);

  const query = url.searchParams.get("q") || "";
  const campaign = await getActiveCampaign();

  if (!campaign) {
    return {
      campaign: null,
      participants: [],
      query,
      totalParticipants: 0,
    };
  }

  const where: Record<string, unknown> = {
    campaignId: campaign.id,
  };

  if (query.trim()) {
    where.shopifyCustomerId = {
      contains: query.trim(),
      mode: "insensitive",
    };
  }

  const [participants, totalCount] = await Promise.all([
    prisma.customerProgress.findMany({
      where,
      orderBy: { totalPoints: "desc" },
      take: 100,
      include: {
        _count: {
          select: {
            submissions: true,
            pointTransactions: true,
          },
        },
      },
    }),
    prisma.customerProgress.count({ where }),
  ]);

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      maxPoints: campaign.maxPoints,
    },
    participants: participants.map((p, idx) => ({
      ...p,
      calculatedRank: idx + 1,
      createdAt: p.createdAt.toISOString(),
      eligibleAt: p.eligibleAt ? p.eligibleAt.toISOString() : null,
      completedAt: p.completedAt ? p.completedAt.toISOString() : null,
    })),
    query,
    totalParticipants: totalCount,
  };
};

export default function ParticipantsPage() {
  const { campaign, participants, query, totalParticipants } = useLoaderData<typeof loader>();

  if (!campaign) {
    return (
      <s-page heading="Participants Directory">
        <s-section heading="No Active Campaign">
          <div style={{ padding: "32px", textAlign: "center", background: "#ffffff", borderRadius: "10px", border: "1px solid #e1e3e5" }}>
            <div style={{ fontSize: "16px", fontWeight: "bold", color: "#202223" }}>No active campaign found</div>
          </div>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Navratri Participants Directory">
      {/* Header Search & Overview */}
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
              👥 Enrolled Participants Directory
            </div>
            <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "2px" }}>
              Track customer engagement, level unlocks, total points accumulated, and reward eligibility.
            </div>
          </div>
          <div style={{ fontSize: "13px", color: "#6d7175" }}>
            Total Registered: <strong>{totalParticipants}</strong>
          </div>
        </div>

        <Form method="get" style={{ display: "flex", gap: "12px", alignItems: "center", marginTop: "16px" }}>
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder="Search by Shopify Customer ID or phone..."
            style={{
              flex: 1,
              padding: "10px 14px",
              borderRadius: "6px",
              border: "1px solid #d1d5db",
              fontSize: "13px",
            }}
          />
          <button type="submit"  style={{ background: "#000", color: "#fff", padding: "10px 20px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: 600 }}>
            Search
          </button>
          {query && (
            <a
              href="/app/participants"
              style={{ fontSize: "13px", color: "#6b7280", textDecoration: "none" }}
            >
              Clear
            </a>
          )}
        </Form>
      </div>

      {/* Participants Table */}
      {participants.length === 0 ? (
        <div
          style={{
            background: "#ffffff",
            borderRadius: "10px",
            border: "1px solid #e1e3e5",
            padding: "48px 24px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "36px", marginBottom: "12px" }}>👥</div>
          <div style={{ fontSize: "16px", fontWeight: "bold", color: "#202223", marginBottom: "6px" }}>
            No participants found
          </div>
          <div style={{ fontSize: "13px", color: "#6d7175" }}>
            {query ? `No matching customers for "${query}".` : "Participants will appear here as customers log in with GoKwik."}
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
                <th style={{ padding: "12px 16px" }}>Rank</th>
                <th style={{ padding: "12px 16px" }}>Customer</th>
                <th style={{ padding: "12px 16px" }}>Total Points</th>
                <th style={{ padding: "12px 16px" }}>Current Level</th>
                <th style={{ padding: "12px 16px" }}>Submissions</th>
                <th style={{ padding: "12px 16px" }}>Eligibility Status</th>
                <th style={{ padding: "12px 16px" }}>Joined At</th>
              </tr>
            </thead>
            <tbody>
              {participants.map((p) => {
                const isEligible = p.totalPoints >= campaign.maxPoints || p.status === "eligible" || p.status === "completed" || p.status === "winner";

                return (
                  <tr key={p.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "14px 16px", fontWeight: "bold", color: p.calculatedRank <= 3 ? "#d97706" : "#4b5563" }}>
                      #{p.calculatedRank}
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <div style={{ fontWeight: 600, color: "#111827" }}>
                        {p.shopifyCustomerId.replace(/\D/g, "").slice(-6) ? `Customer ...${p.shopifyCustomerId.slice(-6)}` : p.shopifyCustomerId}
                      </div>
                      <span style={{ fontSize: "11px", color: "#9ca3af" }}>ID: {p.shopifyCustomerId}</span>
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <span style={{ fontSize: "14px", fontWeight: "bold", color: "#059669" }}>
                        {p.totalPoints} pts
                      </span>
                      <div style={{ fontSize: "11px", color: "#9ca3af" }}>
                        {Math.round((p.totalPoints / campaign.maxPoints) * 100)}% to goal
                      </div>
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <span
                        style={{
                          background: "#e0e7ff",
                          color: "#3730a3",
                          padding: "2px 8px",
                          borderRadius: "6px",
                          fontSize: "11px",
                          fontWeight: 700,
                        }}
                      >
                        Day {p.currentLevel}
                      </span>
                    </td>
                    <td style={{ padding: "14px 16px", color: "#4b5563" }}>
                      {p._count.submissions} submissions ({p._count.pointTransactions} transactions)
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "3px 10px",
                          borderRadius: "12px",
                          fontSize: "11px",
                          fontWeight: 700,
                          background: isEligible ? "#dcfce7" : "#f3f4f6",
                          color: isEligible ? "#166534" : "#6b7280",
                          textTransform: "uppercase",
                        }}
                      >
                        {isEligible ? "✓ Eligible" : "In Progress"}
                      </span>
                    </td>
                    <td style={{ padding: "14px 16px", color: "#6b7280", fontSize: "12px" }}>
                      {new Date(p.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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

