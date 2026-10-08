import React, { useState } from "react";

export interface TextConfig {
  instructions?: string;
  hideActivityInstructions?: boolean;
  minCharacters?: number;
  maxCharacters?: number;
  imageUrl?: string;
  imageAlt?: string;
  productImageUrl?: string;
  productImageAlt?: string;
  showWinnerAnnouncements?: boolean;
}

interface WinnerAnnouncement {
  rank: number;
  displayId: string;
  totalPoints: number;
}

interface TextSubmissionActivityProps {
  levelId: string;
  config: TextConfig;
  onSubmit: (text: string) => Promise<void>;
  isSubmitting: boolean;
  error?: string | null;
  winnerAnnouncements?: WinnerAnnouncement[];
}

export function TextSubmissionActivity({
  config,
  onSubmit,
  isSubmitting,
  error,
  winnerAnnouncements = [],
}: TextSubmissionActivityProps) {
  const [text, setText] = useState<string>("");

  const minChars = config.minCharacters || 20;
  const maxChars = config.maxCharacters || 500;
  const productImageUrl = String(config.imageUrl || config.productImageUrl || "").trim();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (text.trim().length < minChars || text.trim().length > maxChars || isSubmitting) return;
    onSubmit(text.trim());
  };

  const currentLength = text.trim().length;
  const isValidLength = currentLength >= minChars && currentLength <= maxChars;

  return (
    <form onSubmit={handleSubmit} style={{ width: "100%" }}>
      <div style={{ marginBottom: "16px" }}>
        {!config.hideActivityInstructions && <p style={{ fontSize: "14px", color: "#f8fafc", lineHeight: "1.5", marginBottom: "12px" }}>
          {config.instructions ||
            "Share your thoughts, festival memory, or festive wishes in the box below."}
        </p>}

        {productImageUrl && (
          <>
            <img
              key={productImageUrl}
              src={productImageUrl}
              alt={config.imageAlt || config.productImageAlt || "Product for this challenge"}
              loading="eager"
              onError={(event) => {
                event.currentTarget.hidden = true;
                event.currentTarget.style.display = "none";
                const fallback = event.currentTarget.nextElementSibling;
                if (fallback instanceof HTMLElement) fallback.hidden = false;
              }}
              style={{ display: "block", width: "100%", maxHeight: 280, objectFit: "contain", borderRadius: 10, marginBottom: 14, background: "#fff" }}
            />
            <p hidden role="status" style={{ margin: "-6px 0 14px", color: "#ffdf9a", fontSize: 13 }}>Product image unavailable. Set Level 7 to a direct, publicly accessible image URL, such as a Shopify CDN image ending in .jpg, .png, or .webp.</p>
          </>
        )}

        <div>
          <textarea
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Type your response here (min ${minChars}, max ${maxChars} characters)...`}
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: "10px",
              border: isValidLength ? "1.5px solid #cbd5e1" : "1.5px solid #b7791f",
              background: "rgba(255, 255, 255, 0.95)",
              color: "#1e293b",
              fontSize: "14px",
              lineHeight: "1.4",
              boxSizing: "border-box",
              resize: "vertical",
            }}
          />

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "12px",
              color: currentLength < minChars ? "#8a5a12" : "#475569",
              marginTop: "4px",
            }}
          >
            <span>
              {currentLength < minChars
                ? `Need ${minChars - currentLength} more character${minChars - currentLength === 1 ? "" : "s"}`
                : "Length requirement met ✓"}
            </span>
            <span>
              {currentLength} / {maxChars} chars
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: "8px",
            background: "#fef2f2",
            color: "#991b1b",
            fontSize: "13px",
            marginBottom: "14px",
            border: "1px solid #fecaca",
          }}
        >
          ⚠️ {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!isValidLength || isSubmitting}
        style={{
          width: "100%",
          padding: "14px 20px",
          borderRadius: "10px",
          background:
            !isValidLength || isSubmitting
              ? "#cbd5e1"
              : "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
          color: "#ffffff",
          fontWeight: 700,
          fontSize: "15px",
          border: "none",
          cursor: !isValidLength || isSubmitting ? "not-allowed" : "pointer",
          boxShadow: !isValidLength || isSubmitting ? "none" : "0 4px 12px rgba(2, 132, 199, 0.3)",
          transition: "all 0.2s ease",
        }}
      >
        {isSubmitting
          ? (config.showWinnerAnnouncements ? "Submitting Feedback..." : "Submitting Text...")
          : config.showWinnerAnnouncements
            ? "Submit Feedback"
            : "Submit response for review"}
      </button>

      {!config.showWinnerAnnouncements && (
        <p style={{ margin: "8px 0 0", color: "#f1f5f9", fontSize: 12, textAlign: "center" }}>
          Points are added after your response is approved.
        </p>
      )}

      {config.showWinnerAnnouncements && (
        <section aria-label="Final winner announcements" style={{ marginTop: 18, padding: 14, borderRadius: 10, background: "rgba(255,255,255,.08)", color: "#f8fafc" }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 16 }}>🏆 Give Us Your Feedback &amp; See the Winners</h3>
          {winnerAnnouncements.length ? (
            <ol style={{ margin: 0, paddingLeft: 22, display: "grid", gap: 6 }}>
              {winnerAnnouncements.map((winner) => <li key={winner.rank}>Rank #{winner.rank} · {winner.displayId} · {winner.totalPoints} points</li>)}
            </ol>
          ) : <p style={{ margin: 0, color: "#cbd5e1", fontSize: 13 }}>The winners will appear here after the campaign team finalizes the list.</p>}
        </section>
      )}
    </form>
  );
}
