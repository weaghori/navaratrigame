import React, { useState, useEffect, ReactNode } from "react";
import { createPortal } from "react-dom";

export interface NotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  type?: "success" | "error" | "info" | "warning" | "confirmation";
  title: string;
  message: ReactNode;
  highlightText?: string;
  actionText?: string;
  onAction?: () => void;
  hideCloseButton?: boolean;
  hideActionButton?: boolean;
}

export function NotificationModal({
  isOpen,
  onClose,
  type = "info",
  title,
  message,
  highlightText,
  actionText = "Okay",
  onAction,
  hideCloseButton = false,
  hideActionButton = false,
}: NotificationModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isOpen || !mounted) return null;

  // Determine colors based on type, defaulting to the vibrant purple theme for success/info
  let topBg = "linear-gradient(135deg, #6025C0, #4c1d95)";
  if (type === "error") topBg = "linear-gradient(135deg, #dc2626, #991b1b)";
  if (type === "warning") topBg = "linear-gradient(135deg, #d97706, #92400e)";

  const handleAction = () => {
    if (onAction) onAction();
    else onClose();
  };

  const modalContent = (
    <div className="navratri-notification-overlay" style={{
      position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
      background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center",
      justifyContent: "center", zIndex: 9999, padding: "20px"
    }}>
      <div className="navratri-notification-card" style={{
        background: "#fff", borderRadius: "16px", width: "100%", maxWidth: "400px",
        overflow: "hidden", position: "relative", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.2)"
      }}>
        
        {!hideCloseButton && (
          <button 
            onClick={onClose}
            style={{
              position: "absolute", top: "12px", right: "12px", zIndex: 10,
              background: "rgba(255,255,255,0.2)", border: "none", color: "#fff",
              width: "28px", height: "28px", borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", fontSize: "16px", fontWeight: "bold",
              boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
            }}
          >
            ×
          </button>
        )}

        <div className="notification-top-section" style={{
          background: topBg,
          padding: "40px 20px 32px", textAlign: "center", color: "#fff",
          position: "relative",
          maskImage: "radial-gradient(circle at 10px 100%, transparent 10px, black 11px)",
          maskSize: "20px 100%",
          maskPosition: "0 10px",
          maskRepeat: "repeat-x"
        }}>
          {/* Confetti decoration (simple CSS based) */}
          <div style={{ position: "absolute", top: "20px", left: "20px", width: "8px", height: "20px", background: "#38bdf8", transform: "rotate(45deg)", borderRadius: "4px" }} />
          <div style={{ position: "absolute", top: "40px", right: "30px", width: "10px", height: "10px", background: "#fbbf24", borderRadius: "50%" }} />
          <div style={{ position: "absolute", bottom: "30px", left: "40px", width: "10px", height: "10px", border: "2px solid #a78bfa", borderRadius: "50%" }} />
          <div style={{ position: "absolute", top: "15px", right: "70px", width: "16px", height: "4px", background: "#f43f5e", transform: "rotate(-30deg)", borderRadius: "2px" }} />

          {highlightText && (
            <h2 style={{ fontSize: "36px", fontWeight: 900, margin: 0, textShadow: "0 2px 4px rgba(0,0,0,0.2)" }}>
              {highlightText}
            </h2>
          )}
          {!highlightText && (
            <h2 style={{ fontSize: "28px", fontWeight: 800, margin: 0 }}>
              {title}
            </h2>
          )}
        </div>

        <div className="notification-bottom-section" style={{ padding: "24px", textAlign: "center", background: "#fff" }}>
          {highlightText && (
            <h3 style={{ fontSize: "20px", fontWeight: 800, color: "#1e293b", margin: "0 0 12px 0" }}>
              {title}
            </h3>
          )}
          
          <div style={{ fontSize: "15px", color: "#64748b", margin: "0 0 24px 0", lineHeight: "1.5" }}>
            {message}
          </div>

          <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
            {type === "confirmation" && (
              <button 
                onClick={onClose}
                style={{
                  flex: 1, padding: "12px", borderRadius: "8px", border: "1px solid #cbd5e1",
                  background: "#f8fafc", color: "#475569", fontWeight: 700,
                  cursor: "pointer", fontSize: "15px"
                }}
              >
                Cancel
              </button>
            )}
            {!hideActionButton && (
              <button 
                onClick={handleAction}
                style={{
                  flex: 1, padding: "12px", borderRadius: "8px", border: "none",
                  background: "#1e293b", color: "#fff", fontWeight: 700,
                  cursor: "pointer", fontSize: "15px", boxShadow: "0 4px 6px rgba(0,0,0,0.1)"
                }}
              >
                {actionText}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}