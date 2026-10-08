import { useState } from "react";

export interface ReferralData {
  referralCode: string;
  totalInvited: number;
  completedReferrals: number;
  totalEarnedPoints: number;
  referrals: Array<{
    id: string;
    referredCustomerId: string | null;
    status: string;
    points: number;
    completedAt: string | null;
    createdAt: string;
  }>;
}

interface ReferralSectionProps {
  referrals: ReferralData;
  campaignSlug: string;
}

export function ReferralSection({ referrals, campaignSlug }: ReferralSectionProps) {
  const [copied, setCopied] = useState(false);

  // Generate shareable link
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const shareUrl = `${origin}/campaigns/${campaignSlug}?ref=${referrals.referralCode}`;

  const handleCopyLink = async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
    } catch {
      // Fallback
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Join the 10-Level Navratri Challenge!",
          text: `Join me in the Navratri Gamification Challenge and win grand festive hampers! Use my referral code: ${referrals.referralCode}`,
          url: shareUrl,
        });
      } catch {
        // User cancelled or share failed
      }
    } else {
      await handleCopyLink();
    }
  };

  return (
    <div
      style={{
        background: "#ffffff",
        borderRadius: "16px",
        padding: "20px",
        boxShadow: "0 4px 14px rgba(0,0,0,0.05)",
        border: "1.5px solid #fed7aa",
        marginBottom: "24px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <div>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: "10px",
              background: "#ffedd5",
              color: "#c2410c",
              textTransform: "uppercase",
            }}
          >
            🤝 Bonus Points
          </span>
          <h3 style={{ margin: "4px 0 0 0", fontSize: "17px", fontWeight: 800, color: "#1e293b" }}>
            Invite Friends & Earn +100 Pts
          </h3>
        </div>

        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 600 }}>Earned</div>
          <div style={{ fontSize: "18px", fontWeight: 900, color: "#ea580c" }}>
            +{referrals.totalEarnedPoints} pts
          </div>
        </div>
      </div>

      <p style={{ fontSize: "13px", color: "#475569", margin: "0 0 16px 0", lineHeight: 1.4 }}>
        Share your unique referral link with family and friends. When they join and participate, you receive 100 bonus points!
      </p>

      {/* Referral Code Box */}
      <div
        style={{
          background: "#fff7ed",
          borderRadius: "12px",
          padding: "12px 14px",
          border: "1px dashed #fdba74",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "14px",
        }}
      >
        <div>
          <div style={{ fontSize: "11px", color: "#9a3412", fontWeight: 700 }}>YOUR REFERRAL CODE</div>
          <div style={{ fontSize: "18px", fontWeight: 900, color: "#c2410c", letterSpacing: "1px" }}>
            {referrals.referralCode}
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            onClick={handleCopyLink}
            style={{
              padding: "8px 14px",
              borderRadius: "8px",
              background: copied ? "#16a34a" : "#ea580c",
              color: "#ffffff",
              fontWeight: 700,
              fontSize: "12px",
              border: "none",
              cursor: "pointer",
              transition: "background 0.2s ease",
            }}
          >
            {copied ? "✓ Copied!" : "📋 Copy Link"}
          </button>

          <button
            type="button"
            onClick={handleShare}
            style={{
              padding: "8px 14px",
              borderRadius: "8px",
              background: "#062617",
              color: "#ffffff",
              fontWeight: 700,
              fontSize: "12px",
              border: "none",
              cursor: "pointer",
            }}
          >
            🚀 Share
          </button>
        </div>
      </div>

      {/* Stats Mini Row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "10px",
          marginBottom: referrals.referrals.length > 0 ? "14px" : "0",
        }}
      >
        <div style={{ padding: "10px", background: "#f8fafc", borderRadius: "8px", textAlign: "center" }}>
          <div style={{ fontSize: "11px", color: "#64748b" }}>Friends Joined</div>
          <div style={{ fontSize: "16px", fontWeight: 800, color: "#1e293b" }}>{referrals.totalInvited}</div>
        </div>
        <div style={{ padding: "10px", background: "#f8fafc", borderRadius: "8px", textAlign: "center" }}>
          <div style={{ fontSize: "11px", color: "#64748b" }}>Completed Referrals</div>
          <div style={{ fontSize: "16px", fontWeight: 800, color: "#16a34a" }}>{referrals.completedReferrals}</div>
        </div>
      </div>

      {/* Referral History List */}
      {referrals.referrals.length > 0 && (
        <div style={{ marginTop: "12px" }}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#64748b", marginBottom: "8px" }}>
            Recent Referrals
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {referrals.referrals.slice(0, 5).map((r) => (
              <div
                key={r.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 10px",
                  background: "#f8fafc",
                  borderRadius: "6px",
                  fontSize: "12px",
                }}
              >
                <div style={{ color: "#334155", fontWeight: 500 }}>
                  Friend {r.referredCustomerId ? `(#${r.referredCustomerId.slice(-4)})` : "Invited"}
                </div>
                <div>
                  {r.status === "completed" ? (
                    <span style={{ color: "#16a34a", fontWeight: 700 }}>+{r.points} pts</span>
                  ) : (
                    <span style={{ color: "#f59e0b", fontWeight: 600 }}>Pending</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
