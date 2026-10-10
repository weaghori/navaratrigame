import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";

export type NotificationType = "success" | "error" | "warning" | "info" | "confirmation";

export interface GlobalNotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  type?: NotificationType;
  title: string;
  message: string | React.ReactNode;
  points?: number;
  onConfirm?: () => void;
  confirmText?: string;
  cancelText?: string;
}

export function GlobalNotificationModal({
  isOpen,
  onClose,
  type = "info",
  title,
  message,
  points,
  onConfirm,
  confirmText = "Confirm",
  cancelText = "Cancel",
}: GlobalNotificationModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isOpen || !mounted) return null;

  const getColors = () => {
    switch (type) {
      case "success": return { bg: "radial-gradient(circle at 50% 0%, #1e1b4b 0%, #020617 80%)", border: "#fbbf24", text: "#fef08a", icon: "✨" };
      case "error": return { bg: "radial-gradient(circle at 50% 0%, #450a0a 0%, #020617 80%)", border: "#ef4444", text: "#fca5a5", icon: "⚠️" };
      case "warning": return { bg: "radial-gradient(circle at 50% 0%, #451a03 0%, #020617 80%)", border: "#f59e0b", text: "#fcd34d", icon: "🔔" };
      case "confirmation": return { bg: "radial-gradient(circle at 50% 0%, #0f172a 0%, #020617 80%)", border: "#3b82f6", text: "#bfdbfe", icon: "❓" };
      default: return { bg: "radial-gradient(circle at 50% 0%, #064e3b 0%, #020617 80%)", border: "#10b981", text: "#6ee7b7", icon: "ℹ️" };
    }
  };

  const colors = getColors();

  const modalContent = (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0, 0, 0, 0.8)", backdropFilter: "blur(6px)" }} role="dialog" aria-modal="true">
      <div style={{ background: colors.bg, borderRadius: "24px", padding: "32px 24px", width: "90%", maxWidth: "440px", boxShadow: `0 20px 60px -10px rgba(0, 0, 0, 0.8), 0 0 30px ${colors.border}30`, position: "relative", overflow: "hidden", textAlign: "center", border: `1px solid ${colors.border}`, animation: "slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)" }}>
        
        {/* Festive Golden Top Decorative Border */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "6px", background: `linear-gradient(90deg, transparent 0%, ${colors.border} 50%, transparent 100%)` }} />

        <button type="button" onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%', width: 32, height: 32, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          ✕
        </button>

        {/* Header Icon */}
        <div style={{ fontSize: "52px", margin: "0 0 16px" }} aria-hidden="true">
          {points ? "🎉" : colors.icon}
        </div>

        {/* Main Title & Message */}
        <h2 style={{ fontSize: "28px", fontWeight: 900, color: colors.text, marginBottom: "8px", fontFamily: "var(--font-serif, serif)" }}>
          {title}
        </h2>
        <div style={{ fontSize: "16px", color: "#e2e8f0", lineHeight: "1.5", marginBottom: points ? "20px" : "32px" }}>
          {message}
        </div>

        {/* Points Display */}
        {points ? (
          <div style={{ color: "#fbbf24", fontSize: "40px", fontWeight: 900, marginBottom: "28px", textShadow: "0 2px 10px rgba(251, 191, 36, 0.3)" }}>
            +{points} points
          </div>
        ) : null}

        {/* Actions */}
        <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
          {type === "confirmation" && (
            <button type="button" onClick={onClose} style={{ flex: 1, padding: "14px", borderRadius: "12px", background: "rgba(255,255,255,0.1)", color: "#ffffff", fontWeight: "bold", border: "1px solid rgba(255,255,255,0.2)", cursor: "pointer", transition: "background 0.2s" }}>
              {cancelText}
            </button>
          )}
          <button type="button" onClick={onConfirm || onClose} style={{ flex: 1, padding: "14px", borderRadius: "12px", background: "linear-gradient(135deg, #d97706, #b45309)", color: "#ffffff", fontWeight: "bold", border: "none", cursor: "pointer", transition: "opacity 0.2s", boxShadow: "0 4px 6px -1px rgba(217, 119, 6, 0.4)", textTransform: "uppercase", letterSpacing: "1px" }}>
            {type === "confirmation" ? confirmText : "Awesome!"}
          </button>
        </div>
        
        {/* Sub-style for slideUp animation */}
        <style dangerouslySetInnerHTML={{__html: `
          @keyframes slideUp {
            from { opacity: 0; transform: translateY(20px) scale(0.95); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
        `}} />
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
