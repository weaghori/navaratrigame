import { useState, useEffect, useCallback } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useRouteError } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getActiveCampaign, getCampaignStats } from "../services/campaign.server";
import { getNotifications, getUnreadNotificationCount } from "../services/notification.server";
import { getRecentAuditEvents } from "../services/audit.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const campaign = await getActiveCampaign();

  if (!campaign) {
    return {
      campaign: null,
      stats: null,
      recentSubmissions: [],
      recentTransactions: [],
      recentAuditEvents: [],
      initialNotifications: [],
      initialUnreadCount: 0,
    };
  }

  const [
    stats,
    recentSubmissions,
    recentTransactions,
    recentAuditEvents,
    levels,
    notificationsData,
    unreadCount,
  ] = await Promise.all([
    getCampaignStats(campaign.id),
    prisma.submission.findMany({
      where: { campaignId: campaign.id },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: {
        level: true,
        customerProgress: true,
      },
    }),
    prisma.pointTransaction.findMany({
      where: {
        customerProgress: { campaignId: campaign.id },
      },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: {
        level: true,
        customerProgress: true,
      },
    }),
    getRecentAuditEvents({ campaignId: campaign.id, limit: 8 }),
    prisma.level.findMany({
      where: { campaignId: campaign.id },
      orderBy: { levelNumber: "asc" },
    }),
    getNotifications({
      recipientType: "ADMIN",
      recipientId: "admin",
      campaignId: campaign.id,
      limit: 10,
    }),
    getUnreadNotificationCount({
      recipientType: "ADMIN",
      recipientId: "admin",
      campaignId: campaign.id,
    }),
  ]);

  return {
    campaign: {
      ...campaign,
      startDate: campaign.startDate.toISOString(),
      endDate: campaign.endDate.toISOString(),
      levels,
    },
    stats,
    recentSubmissions: recentSubmissions.map((s) => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
    })),
    recentTransactions: recentTransactions.map((t) => ({
      ...t,
      createdAt: t.createdAt.toISOString(),
    })),
    recentAuditEvents: recentAuditEvents.map((a) => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
    })),
    initialNotifications: (notificationsData?.notifications || []).map((n) => ({
      ...n,
      createdAt: n.createdAt.toISOString(),
      readAt: n.readAt ? n.readAt.toISOString() : null,
    })),
    initialUnreadCount: unreadCount || 0,
  };
};

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  // Real-time state
  const [stats, setStats] = useState(data.stats);
  const [recentSubmissions, setRecentSubmissions] = useState(data.recentSubmissions);
  const [recentTransactions, setRecentTransactions] = useState(data.recentTransactions);
  const [auditEvents, setAuditEvents] = useState(data.recentAuditEvents);
  const [notifications, setNotifications] = useState(data.initialNotifications);
  const [unreadCount, setUnreadCount] = useState(data.initialUnreadCount);
  const [isLive, setIsLive] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [showNotifications, setShowNotifications] = useState(false);

  const campaign = data.campaign;

  // Real-time synchronization polling (every 10 seconds)
  const fetchLiveUpdates = useCallback(async () => {
    if (!campaign) return;
    try {
      setIsUpdating(true);
      const res = await fetch("/api/realtime/admin");
      if (res.ok) {
        const liveData = await res.json();
        if (liveData.stats) setStats(liveData.stats);
        if (liveData.recentSubmissions) setRecentSubmissions(liveData.recentSubmissions);
        if (liveData.recentTransactions) setRecentTransactions(liveData.recentTransactions);
        if (liveData.auditEvents) setAuditEvents(liveData.auditEvents);
        if (liveData.notifications) setNotifications(liveData.notifications);
        if (typeof liveData.unreadCount === "number") setUnreadCount(liveData.unreadCount);
        setIsLive(true);
        setLastUpdated(new Date());
      } else {
        setIsLive(false);
      }
    } catch {
      setIsLive(false);
    } finally {
      setIsUpdating(false);
    }
  }, [campaign]);

  useEffect(() => {
    // Polling removed to prevent egress. 
  }, [fetchLiveUpdates]);

  const handleMarkAllRead = async () => {
    if (!campaign) return;
    const form = new FormData();
    form.append("actionType", "mark_all_read");
    form.append("recipientType", "ADMIN");
    form.append("recipientId", "admin");
    form.append("campaignId", campaign.id);

    try {
      await fetch("/api/notifications", { method: "POST", body: form });
      setUnreadCount(0);
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, readAt: new Date().toISOString() })),
      );
    } catch (err) {
      console.error(err);
    }
  };

  const handleMarkRead = async (id: string) => {
    const form = new FormData();
    form.append("actionType", "mark_read");
    form.append("notificationId", id);

    try {
      await fetch("/api/notifications", { method: "POST", body: form });
      setUnreadCount((c) => Math.max(0, c - 1));
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
      );
    } catch (err) {
      console.error(err);
    }
  };

  if (!campaign || !stats) {
    return (
      <s-page heading="Navratri Gamification Dashboard">
        <s-section heading="No Active Campaign">
          <div
            style={{
              padding: "48px 24px",
              textAlign: "center",
              background: "#ffffff",
              borderRadius: "12px",
              border: "1px solid #e1e3e5",
            }}
          >
            <div style={{ fontSize: "40px", marginBottom: "16px" }}>🪔</div>
            <div style={{ fontSize: "20px", fontWeight: "bold", color: "#202223", marginBottom: "8px" }}>
              Welcome to Navratri Gamification!
            </div>
            <div style={{ fontSize: "14px", color: "#6d7175", maxWidth: "480px", margin: "0 auto 24px" }}>
              No active campaign is configured yet. Set up your 10-level challenge campaign to begin engaging customers.
            </div>
            <s-button variant="primary" onClick={() => navigate("/app/campaign")}>
              Create First Campaign
            </s-button>
          </div>
        </s-section>
      </s-page>
    );
  }

  const completionRate =
    stats.totalParticipants > 0
      ? Math.round((stats.completedParticipants / stats.totalParticipants) * 100)
      : 0;

  return (
    <s-page heading="Navratri Gamification Dashboard">
      {/* Top Header Controls (Live Status & Notification Bell) */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
          position: "relative",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {/* Live Status Pill */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "4px 10px",
              borderRadius: "20px",
              background: isLive ? "#ecfdf5" : "#fef3c7",
              border: `1px solid ${isLive ? "#a7f3d0" : "#fde68a"}`,
              fontSize: "12px",
              fontWeight: 600,
              color: isLive ? "#065f46" : "#92400e",
            }}
          >
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: isLive ? "#10b981" : "#f59e0b",
                boxShadow: isLive ? "0 0 6px rgba(16, 185, 129, 0.6)" : "none",
              }}
            />
            {isLive ? (isUpdating ? "Syncing..." : "Live") : "Reconnecting..."}
            <span style={{ fontSize: "10px", opacity: 0.7, marginLeft: "4px" }}>
              ({lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })})
            </span>
          </div>
        </div>

        {/* Notification Bell Button */}
        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setShowNotifications(!showNotifications)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 14px",
              borderRadius: "8px",
              background: "#ffffff",
              border: "1px solid #d1d5db",
              fontSize: "13px",
              fontWeight: 600,
              color: "#374151",
              cursor: "pointer",
              boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
            }}
          >
            <span>🔔</span>
            <span>Notifications</span>
            {unreadCount > 0 && (
              <span
                style={{
                  background: "#dc2626",
                  color: "#ffffff",
                  fontSize: "11px",
                  fontWeight: 700,
                  borderRadius: "10px",
                  padding: "1px 7px",
                  marginLeft: "2px",
                }}
              >
                {unreadCount}
              </span>
            )}
          </button>

          {/* Notification Dropdown Panel */}
          {showNotifications && (
            <div
              style={{
                position: "absolute",
                right: 0,
                top: "40px",
                width: "360px",
                maxHeight: "440px",
                background: "#ffffff",
                borderRadius: "12px",
                boxShadow: "0 10px 25px -5px rgba(0,0,0,0.15), 0 8px 10px -6px rgba(0,0,0,0.1)",
                border: "1px solid #e5e7eb",
                zIndex: 100,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "12px 16px",
                  borderBottom: "1px solid #f3f4f6",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "#f9fafb",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: "14px", color: "#111827" }}>
                  Admin Notifications
                </div>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#047857",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Mark all read
                  </button>
                )}
              </div>

              <div style={{ overflowY: "auto", flex: 1, padding: "8px 0" }}>
                {notifications.length === 0 ? (
                  <div style={{ padding: "24px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>
                    No notifications yet.
                  </div>
                ) : (
                  notifications.map((n) => {
                    const isUnread = !n.readAt;
                    return (
                      <div
                        key={n.id}
                        style={{
                          padding: "10px 16px",
                          borderBottom: "1px solid #f3f4f6",
                          background: isUnread ? "#f0fdf4" : "#ffffff",
                          display: "flex",
                          flexDirection: "column",
                          gap: "4px",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div style={{ fontWeight: 600, fontSize: "13px", color: "#111827" }}>
                            {n.title}
                          </div>
                          {isUnread && (
                            <button
                              type="button"
                              onClick={() => handleMarkRead(n.id)}
                              style={{
                                background: "none",
                                border: "none",
                                fontSize: "11px",
                                color: "#059669",
                                cursor: "pointer",
                                padding: "0 0 0 8px",
                              }}
                            >
                              ✓ Read
                            </button>
                          )}
                        </div>
                        <div style={{ fontSize: "12px", color: "#4b5563" }}>
                          {n.message}
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px" }}>
                          <span style={{ fontSize: "10px", color: "#9ca3af" }}>
                            {new Date(n.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          {n.actionUrl && (
                            <button
                              type="button"
                              onClick={() => {
                                setShowNotifications(false);
                                navigate(n.actionUrl!);
                              }}
                              style={{
                                background: "none",
                                border: "none",
                                color: "#2563eb",
                                fontSize: "11px",
                                fontWeight: 600,
                                cursor: "pointer",
                                padding: 0,
                              }}
                            >
                              View details ➜
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Top Banner / Campaign Header */}
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
              <span style={{ fontSize: "24px" }}>🪔</span>
              <span style={{ fontSize: "24px", fontWeight: "bold", letterSpacing: "-0.02em" }}>
                {campaign.name}
              </span>
              <span
                style={{
                  background: campaign.status === "active" ? "#10b981" : "#f59e0b",
                  color: "#ffffff",
                  fontSize: "11px",
                  fontWeight: 700,
                  padding: "3px 10px",
                  borderRadius: "12px",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {campaign.status}
              </span>
            </div>
            <div style={{ fontSize: "14px", color: "#a7f3d0", maxWidth: "560px", lineHeight: "1.4" }}>
              {campaign.description || "10 Festive Challenges • 1,000 Points • Exclusive Rewards"}
            </div>
          </div>
          <div
            style={{
              background: "rgba(255,255,255,0.12)",
              backdropFilter: "blur(6px)",
              padding: "10px 16px",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.2)",
              fontSize: "12px",
              textAlign: "right",
            }}
          >
            <div style={{ color: "#d1fae5", fontWeight: 600 }}>CAMPAIGN DATES (IST)</div>
            <div style={{ color: "#ffffff", fontWeight: "bold", fontSize: "13px", marginTop: "2px" }}>
              {new Date(campaign.startDate).toLocaleDateString()} – {new Date(campaign.endDate).toLocaleDateString()}
            </div>
          </div>
        </div>

        {/* Quick Action Navigation Bar */}
        <div
          style={{
            display: "flex",
            gap: "10px",
            marginTop: "20px",
            paddingTop: "16px",
            borderTop: "1px solid rgba(255,255,255,0.15)",
            flexWrap: "wrap",
          }}
        >
          <s-button variant="primary" onClick={() => navigate("/app/submissions")}>
            Review Submissions ({stats.pendingSubmissions})
          </s-button>
          <s-button onClick={() => navigate("/app/levels")}>Manage 10 Levels</s-button>
          <s-button onClick={() => navigate("/app/leaderboard")}>Leaderboard</s-button>
          <s-button onClick={() => navigate("/app/winners")}>Top 25 Winners</s-button>
          <s-button onClick={() => navigate("/app/rewards")}>Rewards</s-button>
          <s-button onClick={() => navigate("/app/dev-tools")}>🧪 Dev Tools</s-button>
          <s-button onClick={() => navigate("/app/campaign")}>Settings</s-button>
        </div>
      </div>

      {/* 5 Real-Time KPI Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        <div
          style={{
            background: "#ffffff",
            borderRadius: "10px",
            padding: "20px",
            border: "1px solid #e1e3e5",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "#6d7175", textTransform: "uppercase" }}>
              Participants
            </span>
            <span style={{ fontSize: "18px" }}>👥</span>
          </div>
          <div style={{ fontSize: "28px", fontWeight: "bold", color: "#202223", marginTop: "8px" }}>
            {stats.totalParticipants.toLocaleString()}
          </div>
          <div style={{ fontSize: "12px", color: "#2c6ecb", marginTop: "4px" }}>
            Registered customers
          </div>
        </div>

        <div
          style={{
            background: "#ffffff",
            borderRadius: "10px",
            padding: "20px",
            border: "1px solid #e1e3e5",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "#6d7175", textTransform: "uppercase" }}>
              Completed
            </span>
            <span style={{ fontSize: "18px" }}>🏆</span>
          </div>
          <div style={{ fontSize: "28px", fontWeight: "bold", color: "#108043", marginTop: "8px" }}>
            {stats.completedParticipants.toLocaleString()}
          </div>
          <div style={{ fontSize: "12px", color: "#108043", marginTop: "4px" }}>
            {completionRate}% completion rate
          </div>
        </div>

        <div
          style={{
            background: "#ffffff",
            borderRadius: "10px",
            padding: "20px",
            border: "1px solid #e1e3e5",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "#6d7175", textTransform: "uppercase" }}>
              Pending Reviews
            </span>
            <span style={{ fontSize: "18px" }}>⏳</span>
          </div>
          <div
            style={{
              fontSize: "28px",
              fontWeight: "bold",
              color: stats.pendingSubmissions > 0 ? "#b98900" : "#202223",
              marginTop: "8px",
            }}
          >
            {stats.pendingSubmissions.toLocaleString()}
          </div>
          <div style={{ fontSize: "12px", color: stats.pendingSubmissions > 0 ? "#b98900" : "#6d7175", marginTop: "4px" }}>
            {stats.pendingSubmissions > 0 ? "Requires admin action" : "All reviewed"}
          </div>
        </div>

        <div
          style={{
            background: "#ffffff",
            borderRadius: "10px",
            padding: "20px",
            border: "1px solid #e1e3e5",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "#6d7175", textTransform: "uppercase" }}>
              Total Points
            </span>
            <span style={{ fontSize: "18px" }}>🪙</span>
          </div>
          <div style={{ fontSize: "28px", fontWeight: "bold", color: "#202223", marginTop: "8px" }}>
            {stats.totalPointsAwarded.toLocaleString()}
          </div>
          <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "4px" }}>
            Points awarded in campaign
          </div>
        </div>

        <div
          style={{
            background: "#ffffff",
            borderRadius: "10px",
            padding: "20px",
            border: "1px solid #e1e3e5",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "#6d7175", textTransform: "uppercase" }}>
              Eligible
            </span>
            <span style={{ fontSize: "18px" }}>🎁</span>
          </div>
          <div style={{ fontSize: "28px", fontWeight: "bold", color: "#d97706", marginTop: "8px" }}>
            {stats.eligibleParticipants.toLocaleString()}
          </div>
          <div style={{ fontSize: "12px", color: "#d97706", marginTop: "4px" }}>
            Reached 1,000 pts threshold
          </div>
        </div>
      </div>

      {/* Live Activity Stream & Audit Feed */}
      <div
        style={{
          background: "#ffffff",
          borderRadius: "10px",
          padding: "20px 24px",
          border: "1px solid #e1e3e5",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          marginBottom: "24px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
          <div>
            <div style={{ fontSize: "16px", fontWeight: "bold", color: "#202223", display: "flex", alignItems: "center", gap: "8px" }}>
              <span>⚡ Live Activity Feed</span>
              <span style={{ fontSize: "11px", background: "#dbeafe", color: "#1e40af", padding: "2px 8px", borderRadius: "10px" }}>
                Real-time
              </span>
            </div>
            <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "2px" }}>
              Live audit stream of participant completions, reviews, referrals, and rewards.
            </div>
          </div>
        </div>

        {auditEvents.length === 0 ? (
          <div style={{ textAlign: "center", padding: "24px", color: "#9ca3af", fontSize: "13px" }}>
            No live activity recorded yet. Events will stream in as users participate.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {auditEvents.map((evt) => (
              <div
                key={evt.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 14px",
                  background: "#f9fafb",
                  borderRadius: "8px",
                  border: "1px solid #f3f4f6",
                  fontSize: "13px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "16px" }}>
                    {evt.eventType === "SUBMISSION_APPROVED" ? "✅" :
                     evt.eventType === "SUBMISSION_REJECTED" ? "❌" :
                     evt.eventType === "SUBMISSION_CREATED" ? "📥" :
                     evt.eventType === "ELIGIBILITY_REACHED" ? "🎉" :
                     evt.eventType === "WINNER_FINALIZED" ? "🏆" :
                     evt.eventType === "REWARD_ISSUED" ? "🎁" :
                     evt.eventType === "REFERRAL_COMPLETED" ? "🤝" : "🪙"}
                  </span>
                  <div>
                    <span style={{ fontWeight: 600, color: "#111827" }}>
                      Customer {evt.actorId.slice(-6)}
                    </span>{" "}
                    <span style={{ color: "#4b5563" }}>
                      {evt.eventType.replace(/_/g, " ").toLowerCase()}
                    </span>
                  </div>
                </div>
                <div style={{ fontSize: "11px", color: "#9ca3af" }}>
                  {new Date(evt.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom Grid: Recent Submissions & Point Stream */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))",
          gap: "24px",
        }}
      >
        {/* Recent Submissions Table */}
        <div
          style={{
            background: "#ffffff",
            borderRadius: "10px",
            padding: "20px",
            border: "1px solid #e1e3e5",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div style={{ fontSize: "16px", fontWeight: "bold", color: "#202223" }}>
              Recent Submissions
            </div>
            <s-button onClick={() => navigate("/app/submissions")}>View All</s-button>
          </div>

          {recentSubmissions.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 16px", color: "#6d7175", fontSize: "13px" }}>
              <div>📥</div>
              <div style={{ marginTop: "8px", fontWeight: 600 }}>No submissions yet</div>
              <div style={{ fontSize: "12px", color: "#8c9196" }}>Customer submissions will appear here once challenges begin.</div>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e1e3e5", textAlign: "left", color: "#6d7175", fontSize: "11px", textTransform: "uppercase" }}>
                    <th style={{ padding: "8px 6px" }}>Customer</th>
                    <th style={{ padding: "8px 6px" }}>Level</th>
                    <th style={{ padding: "8px 6px" }}>Status</th>
                    <th style={{ padding: "8px 6px", textAlign: "right" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSubmissions.map((s) => (
                    <tr key={s.id} style={{ borderBottom: "1px solid #f1f2f3" }}>
                      <td style={{ padding: "10px 6px", fontWeight: 500, color: "#202223" }}>
                        {s.customerProgress?.shopifyCustomerId?.slice(-8) || "Customer"}
                      </td>
                      <td style={{ padding: "10px 6px", color: "#4b5563" }}>
                        Day {s.level?.levelNumber || s.levelId.slice(0, 4)} ({s.level?.activityType.replace("_", " ")})
                      </td>
                      <td style={{ padding: "10px 6px" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: "10px",
                            fontSize: "11px",
                            fontWeight: 600,
                            background:
                              s.status === "approved" ? "#dcfce7" : s.status === "rejected" ? "#fee2e2" : "#fef3c7",
                            color:
                              s.status === "approved" ? "#166534" : s.status === "rejected" ? "#991b1b" : "#92400e",
                          }}
                        >
                          {s.status.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: "10px 6px", textAlign: "right" }}>
                        <s-button onClick={() => navigate("/app/submissions")}>Review</s-button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent Points Activity Stream */}
        <div
          style={{
            background: "#ffffff",
            borderRadius: "10px",
            padding: "20px",
            border: "1px solid #e1e3e5",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div style={{ fontSize: "16px", fontWeight: "bold", color: "#202223" }}>
              Recent Activity & Points Stream
            </div>
            <s-button onClick={() => navigate("/app/points")}>Points Log</s-button>
          </div>

          {recentTransactions.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 16px", color: "#6d7175", fontSize: "13px" }}>
              <div>🪙</div>
              <div style={{ marginTop: "8px", fontWeight: 600 }}>No point transactions yet</div>
              <div style={{ fontSize: "12px", color: "#8c9196" }}>Point awards and level completions will appear in this feed.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {recentTransactions.map((t) => (
                <div
                  key={t.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 12px",
                    background: "#f9fafb",
                    borderRadius: "8px",
                    border: "1px solid #f3f4f6",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span
                      style={{
                        fontSize: "14px",
                        fontWeight: "bold",
                        color: t.points >= 0 ? "#16a34a" : "#dc2626",
                        background: t.points >= 0 ? "#dcfce7" : "#fee2e2",
                        padding: "4px 8px",
                        borderRadius: "6px",
                      }}
                    >
                      {t.points >= 0 ? `+${t.points}` : t.points}
                    </span>
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "#1f2937" }}>
                        {t.transactionType.replace("_", " ").toUpperCase()}
                      </div>
                      <div style={{ fontSize: "11px", color: "#6b7280" }}>
                        {t.description || "Activity points credit"}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: "11px", color: "#9ca3af" }}>
                    {new Date(t.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
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
