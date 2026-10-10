import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { LotusOrnament, KalashArtwork } from "./NavratriGraphics";

export interface WinnerPopupModalProps {
  isOpen: boolean;
  onClose: () => void;
  rank?: number | null;
  prizeValue?: string;
}

export function WinnerPopupModal({ isOpen, onClose, rank, prizeValue = "₹1,500–₹2,000" }: WinnerPopupModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isOpen || !mounted) return null;

  const modalContent = (
    <div className="navratri-winner-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="winner-modal-title">
      <div className="navratri-winner-modal-card">
        {/* Festive Golden Top Decorative Border */}
        <div className="winner-modal-gold-bar" />

        {/* Festive Ornament Header */}
        <div className="winner-modal-graphic-container">
          <LotusOrnament />
          <div className="winner-trophy-badge">
            <span className="trophy-emoji">🏆</span>
            {rank ? <span className="rank-pill">Rank #{rank}</span> : null}
          </div>
        </div>

        {/* Main Title & Subtitle */}
        <h2 id="winner-modal-title" className="winner-modal-title">
          🎉 Congratulations! 🎉
        </h2>
        <div className="winner-modal-subtitle">
          You are our Navratri 2026 Winner!
        </div>

        {/* Main Prize Message Box */}
        <div className="winner-prize-banner">
          <div className="prize-icon">🎁</div>
          <div className="prize-text-container">
            <div className="prize-heading">Special Festive Prize</div>
            <div className="prize-value-text">
              You have won a special gift worth <strong>{prizeValue}</strong>.
            </div>
          </div>
        </div>

        {/* Additional Instructions */}
        <p className="winner-modal-description">
          Thank you for participating in <strong>Aghori Store Navratri 2026</strong>.
          <br />
          Our team will contact you shortly with the prize details.
        </p>

        {/* Action Button */}
        <div className="winner-modal-actions">
          <button type="button" className="winner-awesome-btn" onClick={onClose} autoFocus>
            <span>Awesome! 🌟</span>
          </button>
        </div>

        {/* Bottom Decorative Floral Footer */}
        <div style={{ marginTop: "16px", display: "flex", justifyContent: "center" }}>
          <LotusOrnament />
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
