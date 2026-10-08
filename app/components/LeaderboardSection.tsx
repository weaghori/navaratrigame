export interface LeaderboardData {
  entries: Array<{
    rank: number;
    displayName: string;
    totalPoints: number;
    currentLevel: number;
    status: string;
    isCurrentCustomer?: boolean;
  }>;
  totalParticipants: number;
  currentCustomerRank: number | null;
  currentCustomerTotalPoints: number;
}

interface LeaderboardSectionProps {
  leaderboard: LeaderboardData;
}

export function LeaderboardSection({ leaderboard }: LeaderboardSectionProps) {
  return (
    <div className="leaderboard-panel"
      style={{
        background: "#ffffff",
        borderRadius: "16px",
        padding: "20px",
        boxShadow: "0 4px 14px rgba(0,0,0,0.05)",
        border: "1.5px solid #e2e8f0",
        marginBottom: "24px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
        <div>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: "10px",
              background: "#fef08a",
              color: "#854d0e",
              textTransform: "uppercase",
            }}
          >
            🏆 Live Standings
          </span>
          <h3 className="leaderboard-heading" style={{ margin: "4px 0 0 0", fontSize: "17px", fontWeight: 800, color: "#0f172a" }}>
            Top Festive Challengers
          </h3>
        </div>

        {leaderboard?.currentCustomerRank ? (
          <div
            style={{
              padding: "6px 12px",
              borderRadius: "20px",
              background: "#f0fdf4",
              border: "1px solid #bbf7d0",
              textAlign: "right",
            }}
          >
            <div style={{ fontSize: "11px", color: "#166534", fontWeight: 600 }}>Your Rank</div>
            <div style={{ fontSize: "15px", fontWeight: 800, color: "#14532d" }}>
              #{leaderboard.currentCustomerRank} of {leaderboard.totalParticipants || 0}
            </div>
          </div>
        ) : null}
      </div>

      {(!leaderboard?.entries || leaderboard.entries.length === 0) ? (
        <div style={{ textAlign: "center", color: "#94a3b8", fontSize: "13px", padding: "16px 0" }}>
          Be the first to complete levels and claim the #1 spot on the leaderboard!
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {leaderboard.entries.map((entry) => {
            const isTop3 = entry.rank <= 3;
            const isCurrent = entry.isCurrentCustomer;

            return (
              <div
                className={`leaderboard-entry${isCurrent ? " is-current" : ""}${isTop3 ? " is-top-three" : ""}`}
                key={entry.rank}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 14px",
                  borderRadius: "10px",
                  background: isCurrent
                    ? "#eff6ff"
                    : isTop3
                      ? "#fefce8"
                      : "#f8fafc",
                  border: isCurrent
                    ? "1.5px solid #3b82f6"
                    : isTop3
                      ? "1px solid #fef08a"
                      : "1px solid #f1f5f9",
                  transition: "all 0.15s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div
                    style={{
                      width: "28px",
                      height: "28px",
                      borderRadius: "50%",
                      background:
                        entry.rank === 1
                          ? "#fef08a"
                          : entry.rank === 2
                            ? "#e2e8f0"
                            : entry.rank === 3
                              ? "#fed7aa"
                              : "#ffffff",
                      color:
                        entry.rank === 1
                          ? "#854d0e"
                          : entry.rank === 2
                            ? "#475569"
                            : entry.rank === 3
                              ? "#c2410c"
                              : "#64748b",
                      fontWeight: 800,
                      fontSize: "12px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {entry.rank === 1 ? "🥇" : entry.rank === 2 ? "🥈" : entry.rank === 3 ? "🥉" : entry.rank}
                  </div>

                  <div>
                    <div
                      className="leaderboard-name"
                      style={{
                        fontWeight: isCurrent ? 800 : 600,
                        fontSize: "13px",
                        color: isCurrent ? "#1d4ed8" : "#1e293b",
                      }}
                    >
                      {entry.displayName} {isCurrent && "(You)"}
                    </div>
                    <div className="leaderboard-day" style={{ fontSize: "11px", color: "#94a3b8" }}>
                      Day {entry.currentLevel}
                    </div>
                  </div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 800, color: "#16a34a", fontSize: "14px" }}>
                    {entry.totalPoints} pts
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
