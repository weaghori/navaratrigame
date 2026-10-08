import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, Form, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getActiveCampaign } from "../services/campaign.server";
import { getAdminLeaderboard } from "../services/leaderboard.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const url = new URL(request.url);

  const query = url.searchParams.get("q") || "";
  const campaign = await getActiveCampaign();

  if (!campaign) {
    return {
      campaign: null,
      leaderboard: [],
      top25: [],
      totalCount: 0,
      query,
    };
  }

  const result = await getAdminLeaderboard({
    campaignId: campaign.id,
    search: query,
    limit: 100,
  });

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      maxPoints: campaign.maxPoints,
    },
    leaderboard: result.participants.map((p) => ({
      ...p,
      maskedName: p.shopifyCustomerId.replace(/\D/g, "").slice(-4)
        ? `Player #${p.shopifyCustomerId.replace(/\D/g, "").slice(-4)}`
        : `Player #${p.rank}`,
      createdAt: p.createdAt.toISOString(),
      eligibleAt: p.eligibleAt ? p.eligibleAt.toISOString() : null,
      completedAt: p.completedAt ? p.completedAt.toISOString() : null,
    })),
    totalCount: result.totalCount,
    query,
  };
};

export default function LeaderboardPage() {
  const { campaign, leaderboard, totalCount, query } = useLoaderData<typeof loader>();

  if (!campaign) {
    return (
      <s-page heading="Campaign Leaderboard">
        <s-section heading="No Active Campaign">
          <div style={{ padding: "32px", textAlign: "center", background: "#ffffff", borderRadius: "10px", border: "1px solid #e1e3e5" }}>
            <div style={{ fontSize: "16px", fontWeight: "bold", color: "#202223" }}>No active campaign found</div>
          </div>
        </s-section>
      </s-page>
    );
  }

  const top3 = leaderboard.slice(0, 3);
  const ranks4to25 = leaderboard.slice(3, 25);
  const remaining = leaderboard.slice(25);

  return (
    <s-page heading="Live Campaign Leaderboard">
      {/* Header Banner */}
      <div
        style={{
          background: "linear-gradient(135deg, #064e3b 0%, #065f46 60%, #047857 100%)",
          borderRadius: "12px",
          padding: "24px 28px",
          color: "#ffffff",
          marginBottom: "24px",
          boxShadow: "0 4px 16px rgba(6, 78, 59, 0.15)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "24px" }}>🏆</span>
              <span style={{ fontSize: "22px", fontWeight: "bold" }}>NAVRATRI LIVE LEADERBOARD</span>
            </div>
            <div style={{ fontSize: "13px", color: "#a7f3d0", marginTop: "4px" }}>
              Deterministic ranking sorted by Total Points DESC, Completion Timestamp ASC.
            </div>
          </div>
          <div style={{ fontSize: "13px", background: "rgba(255,255,255,0.15)", padding: "8px 16px", borderRadius: "8px" }}>
            Total Ranked: <strong>{totalCount}</strong> participants
          </div>
        </div>
      </div>

      {/* Top 3 Podium Cards */}
      {top3.length > 0 && (
        <div style={{ marginBottom: "28px" }}>
          <div style={{ fontSize: "15px", fontWeight: 700, color: "#374151", textTransform: "uppercase", marginBottom: "12px" }}>
            ⭐ Top 3 Podium
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: "16px",
            }}
          >
            {top3.map((entry) => {
              const isFirst = entry.rank === 1;
              const isSecond = entry.rank === 2;
              const isThird = entry.rank === 3;

              const bgGradient = isFirst
                ? "linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)"
                : isSecond
                  ? "linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)"
                  : "linear-gradient(135deg, #ffedd5 0%, #fed7aa 100%)";

              const borderColor = isFirst ? "#f59e0b" : isSecond ? "#94a3b8" : "#f97316";
              const medalIcon = isFirst ? "🥇" : isSecond ? "🥈" : "🥉";

              return (
                <div
                  key={entry.id}
                  style={{
                    background: bgGradient,
                    border: `2px solid ${borderColor}`,
                    borderRadius: "12px",
                    padding: "20px",
                    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05)",
                    position: "relative",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "28px" }}>{medalIcon}</span>
                    <span
                      style={{
                        background: "#ffffff",
                        padding: "2px 10px",
                        borderRadius: "12px",
                        fontSize: "12px",
                        fontWeight: "bold",
                        color: "#1f2937",
                        boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                      }}
                    >
                      RANK #{entry.rank}
                    </span>
                  </div>

                  <div style={{ fontSize: "18px", fontWeight: "bold", color: "#111827", marginTop: "12px" }}>
                    {entry.maskedName}
                  </div>
                  <div style={{ fontSize: "12px", color: "#4b5563", marginTop: "2px" }}>
                    Day {entry.currentLevel} • {entry.status.toUpperCase()}
                  </div>

                  <div style={{ fontSize: "24px", fontWeight: "bold", color: "#065f46", marginTop: "12px" }}>
                    {entry.totalPoints} <span style={{ fontSize: "14px", fontWeight: "normal" }}>pts</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Ranks 4 to 25 (Top 25 Contenders) */}
      <div
        style={{
          background: "#ffffff",
          borderRadius: "10px",
          border: "1px solid #e1e3e5",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          marginBottom: "28px",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #e1e3e5", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: "16px", fontWeight: "bold", color: "#202223" }}>
              Top 25 Candidates (Eligible for Final Rewards)
            </div>
            <div style={{ fontSize: "12px", color: "#6d7175" }}>
              Participants currently positioned within the Top 25 threshold.
            </div>
          </div>
        </div>

        {ranks4to25.length === 0 && top3.length === 0 ? (
          <div style={{ padding: "32px", textAlign: "center", color: "#6d7175" }}>
            No participants on leaderboard yet.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e1e3e5", textAlign: "left", color: "#4b5563", fontSize: "12px", textTransform: "uppercase" }}>
                  <th style={{ padding: "12px 16px" }}>Rank</th>
                  <th style={{ padding: "12px 16px" }}>Customer</th>
                  <th style={{ padding: "12px 16px" }}>Total Points</th>
                  <th style={{ padding: "12px 16px" }}>Current Level</th>
                  <th style={{ padding: "12px 16px" }}>Status</th>
                  <th style={{ padding: "12px 16px" }}>Completed At</th>
                </tr>
              </thead>
              <tbody>
                {ranks4to25.map((entry) => (
                  <tr key={entry.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "12px 16px", fontWeight: "bold", color: "#1f2937" }}>
                      #{entry.rank}
                    </td>
                    <td style={{ padding: "12px 16px", fontWeight: 600, color: "#111827" }}>
                      {entry.maskedName}
                    </td>
                    <td style={{ padding: "12px 16px", fontWeight: "bold", color: "#059669" }}>
                      {entry.totalPoints} pts
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ background: "#e0e7ff", color: "#3730a3", padding: "2px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 700 }}>
                        Day {entry.currentLevel}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: "10px",
                          fontSize: "11px",
                          fontWeight: 700,
                          background: entry.status === "eligible" || entry.status === "completed" ? "#dcfce7" : "#f3f4f6",
                          color: entry.status === "eligible" || entry.status === "completed" ? "#166534" : "#4b5563",
                        }}
                      >
                        {entry.status.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", color: "#6b7280", fontSize: "12px" }}>
                      {entry.completedAt ? new Date(entry.completedAt).toLocaleString() : "In Progress"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Ranks 26+ (Other Participants) */}
      {remaining.length > 0 && (
        <div
          style={{
            background: "#ffffff",
            borderRadius: "10px",
            border: "1px solid #e1e3e5",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "16px 20px", borderBottom: "1px solid #e1e3e5" }}>
            <div style={{ fontSize: "15px", fontWeight: "bold", color: "#202223" }}>
              Other Participating Customers (Rank 26+)
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e1e3e5", textAlign: "left", color: "#4b5563", fontSize: "12px", textTransform: "uppercase" }}>
                  <th style={{ padding: "12px 16px" }}>Rank</th>
                  <th style={{ padding: "12px 16px" }}>Customer</th>
                  <th style={{ padding: "12px 16px" }}>Total Points</th>
                  <th style={{ padding: "12px 16px" }}>Current Level</th>
                  <th style={{ padding: "12px 16px" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {remaining.map((entry) => (
                  <tr key={entry.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "12px 16px", color: "#6b7280" }}>#{entry.rank}</td>
                    <td style={{ padding: "12px 16px", color: "#374151" }}>{entry.maskedName}</td>
                    <td style={{ padding: "12px 16px", fontWeight: 600, color: "#059669" }}>{entry.totalPoints} pts</td>
                    <td style={{ padding: "12px 16px", color: "#4b5563" }}>Day {entry.currentLevel}</td>
                    <td style={{ padding: "12px 16px", color: "#6b7280", textTransform: "capitalize" }}>{entry.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
