import { useState } from "react";

export interface RewardData {
  id: string;
  discountCode: string | null;
  rewardType: string;
  rewardValue: number | null;
  prizeLabel?: string | null;
  offerMessage?: string | null;
  status: string;
  issuedAt: string | null;
  expiresAt: string | null;
}

interface RewardSectionProps {
  reward: RewardData | null;
  isEligible: boolean;
  maxPoints: number;
}

export function RewardSection({ reward, isEligible, maxPoints }: RewardSectionProps) {
  const [copied, setCopied] = useState(false);
  const isSpinReward = reward?.rewardType.startsWith("spin_discount") ?? false;

  if (!isEligible && !reward) return null;

  const handleCopyCode = async () => {
    if (!reward?.discountCode) return;
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(reward.discountCode);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
    } catch {
      // Fallback
    }
  };

  const isIssued = reward?.status === "issued" && reward.discountCode;

  return (
    <div
      style={{
        background: "rgba(8, 35, 79, 0.72)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        color: "#ffffff",
        borderRadius: "16px",
        padding: "14px 18px",
        width: "calc(100% - 24px)",
        maxWidth: "740px",
        boxSizing: "border-box",
        margin: "0 auto 24px",
        boxShadow: "0 8px 24px rgba(8, 35, 79, 0.38)",
        border: "2px solid #fde047",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Decorative festive emoji banner */}
      <div style={{ textAlign: "center", marginBottom: "4px" }}>
        <div style={{ fontSize: "28px", lineHeight: 1 }}>🎉 🪔 🏆</div>
      </div>

      <div style={{ textAlign: "center" }}>
        <h3
          style={{
            margin: "0 0 4px 0",
            fontSize: "18px",
            fontWeight: 900,
            color: "#fef08a",
            letterSpacing: "0.5px",
          }}
        >
          {isSpinReward ? "YOU GOT THIS OFFER!" : isIssued ? "FESTIVE REWARD UNLOCKED!" : "CONGRATULATIONS!"}
        </h3>

        <p style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#eaf2ff", lineHeight: 1.35 }}>
          {isIssued
            ? isSpinReward
              ? `${reward.offerMessage || "Congratulations! You won a Navratri offer."} ${reward.prizeLabel ? `Prize: ${reward.prizeLabel}.` : ""} This unique code is reserved for your account.`
              : `You conquered all 10 challenges and earned ${maxPoints} Points! Enjoy ${reward.rewardValue || 10}% OFF on your next order.`
            : `You have successfully completed the 10-level Navratri Challenge with ${maxPoints} Points! Your exclusive reward is being generated.`}
        </p>

        {isIssued && (
          <div
            style={{
              background: "rgba(255, 255, 255, 0.15)",
              backdropFilter: "blur(6px)",
              borderRadius: "12px",
              padding: "10px 12px",
              border: "1.5px dashed #fef08a",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "7px",
            }}
          >
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#fef08a", textTransform: "uppercase" }}>
              {isSpinReward ? "Your personal Spin & Win code" : `Shopify Discount Code (${reward.rewardValue}% OFF)`}
            </div>

            <div
              style={{
                fontFamily: "monospace",
                fontSize: "18px",
                fontWeight: 900,
                color: "#ffffff",
                letterSpacing: "2px",
                background: "rgba(0, 0, 0, 0.3)",
                padding: "6px 12px",
                borderRadius: "8px",
                width: "fit-content",
              }}
            >
              {reward.discountCode}
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: "8px", width: "100%" }}>
              <button
                type="button"
                onClick={handleCopyCode}
                style={{
                  padding: "7px 16px",
                  borderRadius: "20px",
                  background: copied ? "#2563eb" : "#fef08a",
                  color: copied ? "#ffffff" : "#123872",
                  fontWeight: 800,
                  fontSize: "12px",
                  border: "none",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                  transition: "all 0.2s ease",
                }}
              >
                {copied ? "✓ Code Copied!" : "📋 Copy Coupon Code"}
              </button>

              <a
                href={`https://aghoristore.com/discount/${encodeURIComponent(reward.discountCode || "")}?redirect=%2Fcollections%2Fall`}
                target="_top"
                rel="noreferrer"
                style={{ padding: "7px 18px", borderRadius: 20, background: "linear-gradient(135deg,#8d101e,#bc7a1c)", border: "1px solid #e8bb5f", color: "#fff4ce", fontWeight: 900, fontSize: 12, textDecoration: "none", whiteSpace: "nowrap" }}
              >
                Use it now
              </a>
            </div>

            {reward.expiresAt && (
              <div style={{ fontSize: "10px", color: "#cbd5e1", marginTop: "0" }}>
                Valid until {new Date(reward.expiresAt).toLocaleDateString()}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
