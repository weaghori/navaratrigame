import React from "react";
import dandiyaArtwork from "../styles/e1.webp";

/**
 * Hanging Lantern with ornate golden filigree cap, glowing amber body, and tassels
 */
export function HangingLantern({ side }: { side: "left" | "right" }) {
  return (
    <div className={`hanging-lantern ${side}`}>
      <svg width="64" height="160" viewBox="0 0 64 160" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Golden Hanging Chain */}
        <line x1="32" y1="0" x2="32" y2="65" stroke="#f59e0b" strokeWidth="2" strokeDasharray="3 3" opacity="0.85" />
        <circle cx="32" cy="65" r="3" fill="#fbbf24" />

        {/* Ornate Top Cap / Crown */}
        <path d="M20 68H44L40 76H24L20 68Z" fill="url(#lanternGoldCap)" stroke="#fde047" strokeWidth="1" />
        <path d="M26 65L32 60L38 65H26Z" fill="#fbbf24" />

        {/* Outer Glow Halo */}
        <circle cx="32" cy="96" r="28" fill="#f59e0b" opacity="0.15" />

        {/* Ornate Glass Body */}
        <path
          d="M16 82C16 76 22 76 32 76C42 76 48 76 48 82C48 98 40 116 32 116C24 116 16 98 16 82Z"
          fill="url(#lanternGlassGlow)"
          stroke="#f59e0b"
          strokeWidth="1.8"
        />

        {/* Filigree Ribs */}
        <path d="M32 76C26 86 26 106 32 116" stroke="#d97706" strokeWidth="1" opacity="0.6" />
        <path d="M32 76C38 86 38 106 32 116" stroke="#d97706" strokeWidth="1" opacity="0.6" />

        {/* Inner Flame / Diya Light */}
        <path
          d="M32 82C29 90 27 94 27 99C27 104 29.2 107 32 107C34.8 107 37 104 37 99C37 94 35 90 32 82Z"
          fill="url(#lanternFlameGrad)"
        />
        <circle cx="32" cy="99" r="2.5" fill="#ffffff" />

        {/* Bottom Ring & Hanging Tassel */}
        <path d="M26 116H38L35 122H29L26 116Z" fill="#d97706" />
        <circle cx="32" cy="125" r="3.5" fill="#fbbf24" />
        <path d="M28 128L32 148L36 128H28Z" fill="url(#lanternGoldCap)" />
        <line x1="32" y1="148" x2="32" y2="155" stroke="#fde047" strokeWidth="1.5" />

        <defs>
          <linearGradient id="lanternGoldCap" x1="20" y1="68" x2="44" y2="76" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#f59e0b" />
            <stop offset="50%" stopColor="#fde047" />
            <stop offset="100%" stopColor="#b45309" />
          </linearGradient>
          <radialGradient id="lanternGlassGlow" cx="50%" cy="45%" r="55%">
            <stop offset="0%" stopColor="#fffbeb" stopOpacity="0.95" />
            <stop offset="45%" stopColor="#fbbf24" stopOpacity="0.8" />
            <stop offset="85%" stopColor="#d97706" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#78350f" stopOpacity="0.2" />
          </radialGradient>
          <linearGradient id="lanternFlameGrad" x1="32" y1="82" x2="32" y2="107" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="30%" stopColor="#fde047" />
            <stop offset="75%" stopColor="#ea580c" />
            <stop offset="100%" stopColor="#dc2626" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

/**
 * Garba Dandiya Dancers Artwork (Left)
 * Two detailed female dancers in traditional colorful chaniya choli with golden dandiya sticks
 */
export function GarbaDancersLeft() {
  return (
    <div className="garba-dancers-left">
      <img src={dandiyaArtwork} alt="Decorative crossed dandiya sticks" width={220} height={240} />
    </div>
  );
}

/**
 * Garba Dandiya Dancers Artwork (Right)
 * Two detailed Garba dancers in blue, green, and orange traditional attire
 */
export function GarbaDancersRight() {
  return (
    <div className="garba-dancers-right">
      <img src={dandiyaArtwork} alt="Decorative crossed dandiya sticks" width={220} height={240} />
    </div>
  );
}

/**
 * Hero Header Golden Lotus Filigree Ornament
 */
export function LotusOrnament() {
  return (
    <div className="hero-lotus-ornament">
      <svg width="140" height="32" viewBox="0 0 140 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Left flourish line with dots */}
        <line x1="0" y1="16" x2="48" y2="16" stroke="url(#lotusLineLeft)" strokeWidth="1.8" />
        <circle cx="50" cy="16" r="2.5" fill="#fbbf24" />

        {/* Center Lotus Flower */}
        <g transform="translate(70, 16)">
          <path d="M0 -12C-4 -6 -6 0 -6 5C-3 6 3 6 6 5C6 0 4 -6 0 -12Z" fill="#fde047" />
          <path d="M0 -9C-9 -4 -15 2 -12 6C-8 7 -3 4 -1 2C-1 -2 0 -5 0 -9Z" fill="#f59e0b" />
          <path d="M0 -9C9 -4 15 2 12 6C8 7 3 4 1 2C1 -2 0 -5 0 -9Z" fill="#f59e0b" />
          <path d="M0 -6C-14 -1 -20 6 -16 10C-11 11 -5 7 -2 3C-2 0 0 -3 0 -6Z" fill="#d97706" />
          <path d="M0 -6C14 -1 20 6 16 10C11 11 5 7 2 3C2 0 0 -3 0 -6Z" fill="#d97706" />
          <circle cx="0" cy="4" r="2.5" fill="#ffffff" />
        </g>

        {/* Right flourish line with dots */}
        <circle cx="90" cy="16" r="2.5" fill="#fbbf24" />
        <line x1="92" y1="16" x2="140" y2="16" stroke="url(#lotusLineRight)" strokeWidth="1.8" />

        <defs>
          <linearGradient id="lotusLineLeft" x1="0" y1="16" x2="48" y2="16" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity="0" />
            <stop offset="100%" stopColor="#fbbf24" />
          </linearGradient>
          <linearGradient id="lotusLineRight" x1="92" y1="16" x2="140" y2="16" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#fbbf24" />
            <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

/**
 * Small Lotus SVG for the HUD top notch
 */
export function LotusNotchSVG() {
  return (
    <svg width="22" height="14" viewBox="0 0 22 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M11 0C9.5 4 8.5 7 8.5 10C10 11.2 12 11.2 13.5 10C13.5 7 12.5 4 11 0Z" fill="#fde047" />
      <path d="M11 2C6.5 5 2.5 9 4 11.5C6.5 12.5 9.5 10.5 10 8.5C10 6.5 10.5 4.5 11 2Z" fill="#fbbf24" />
      <path d="M11 2C15.5 5 19.5 9 18 11.5C15.5 12.5 12.5 10.5 12 8.5C12 6.5 11.5 4.5 11 2Z" fill="#fbbf24" />
    </svg>
  );
}

/**
 * Dandiya Artwork for the Day 1 Active Card
 */
export function KalashArtwork() {
  return (
    <div className="active-card-illustration">
      <img src={dandiyaArtwork} alt="Decorative crossed dandiya sticks" width={115} height={100} />
    </div>
  );
}

/**
 * Intricate Mandala Pattern behind the Mystery Question Mark (Double concentric filigree wheel)
 */
export function MysteryMandalaPattern() {
  return (
    <svg className="mystery-mandala-bg" viewBox="0 0 150 150" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="75" cy="75" r="64" stroke="#fbbf24" strokeWidth="1" strokeDasharray="4 4" opacity="0.5" />
      <circle cx="75" cy="75" r="54" stroke="#f59e0b" strokeWidth="1.5" opacity="0.6" />
      <circle cx="75" cy="75" r="42" stroke="#fbbf24" strokeWidth="1" opacity="0.45" />
      <circle cx="75" cy="75" r="30" stroke="#fde047" strokeWidth="1.2" opacity="0.5" />

      {/* 8-Point Mandala Star Petals */}
      {/* <g stroke="#fde047" strokeWidth="1.2" opacity="0.55">
        <path d="M75 11C70 30 80 30 75 51" />
        <path d="M75 139C70 120 80 120 75 99" />
        <path d="M11 75C30 70 30 80 51 75" />
        <path d="M139 75C120 70 120 80 99 75" />
        <path d="M30 30C46 44 40 52 58 60" />
        <path d="M120 120C104 106 110 98 92 90" />
        <path d="M120 30C106 46 98 40 90 58" />
        <path d="M30 120C46 104 40 110 60 92" />
      </g> */}

      {/* Outer Filigree Ring Accents */}
      <g fill="#fbbf24" opacity="0.75">
        <circle cx="75" cy="8" r="2.5" />
        <circle cx="75" cy="142" r="2.5" />
        <circle cx="8" cy="75" r="2.5" />
        <circle cx="142" cy="75" r="2.5" />
        <circle cx="28" cy="28" r="2.5" />
        <circle cx="122" cy="122" r="2.5" />
        <circle cx="122" cy="28" r="2.5" />
        <circle cx="28" cy="122" r="2.5" />
      </g>
    </svg>
  );
}

/** Gift illustration used on locked challenge cards. */
export function GiftBoxArtwork() {
  const gradientPrefix = React.useId().replace(/:/g, "");

  return (
    <svg
      className="gift-box-artwork"
      viewBox="0 0 64 64"
      role="img"
      aria-label="Mystery gift box"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={`${gradientPrefix}-giftBoxBody`} x1="12" y1="31" x2="53" y2="55" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fa4d5b" />
          <stop offset="1" stopColor="#bd1838" />
        </linearGradient>
        <linearGradient id={`${gradientPrefix}-giftBoxGold`} x1="10" y1="24" x2="54" y2="34" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff0a0" />
          <stop offset=".48" stopColor="#ffc629" />
          <stop offset="1" stopColor="#df8307" />
        </linearGradient>
      </defs>
      <path d="M30 22C18 22 14 16 17 12c4-5 12-1 15 8 3-9 11-13 15-8 3 4-1 10-13 10Z" fill="#f4a51c" stroke="#ffe06b" strokeWidth="1.8" />
      <path d="M31 21c-8-7-10-11-13-8-3 4 3 9 13 10m2-2c8-7 10-11 13-8 3 4-3 9-13 10" fill="none" stroke="#d97706" strokeWidth="1.1" />
      <rect x="12" y="30" width="40" height="25" rx="3" fill={`url(#${gradientPrefix}-giftBoxBody)`} stroke="#f5b72e" strokeWidth="1.8" />
      <path d="M29 30h7v24h-7z" fill={`url(#${gradientPrefix}-giftBoxGold)`} />
      <rect x="9" y="24" width="46" height="9" rx="2.5" fill={`url(#${gradientPrefix}-giftBoxGold)`} stroke="#ffe174" strokeWidth="1.4" />
      <path d="M29 24h7v9h-7z" fill="#e53946" />
      <path d="M16 38h8m16 0h8M16 47h8m16 0h8" stroke="#ff9c8e" strokeWidth="1.1" strokeLinecap="round" opacity=".8" />
      <path d="m7 18 1.2-3.3L10 18l3.3 1.2L10 20.5 8.2 24 7 20.5l-3.3-1.3L7 18Zm50 18 1-2.5 1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1Z" fill="#ffda70" />
    </svg>
  );
}

/**
 * Golden Corner Mandala for bottom corners
 */
export function CornerMandala({ side }: { side: "left" | "right" }) {
  const isLeft = side === "left";
  const cx = isLeft ? "0" : "240";
  const cy = "240";

  return (
    <div className={`bottom-mandala-${side}`}>
      <svg width="240" height="240" viewBox="0 0 240 240" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx={cx} cy={cy} r="210" stroke="#f59e0b" strokeWidth="1" strokeDasharray="5 5" opacity="0.3" />
        <circle cx={cx} cy={cy} r="170" stroke="#fbbf24" strokeWidth="1.5" opacity="0.35" />
        <circle cx={cx} cy={cy} r="130" stroke="#f59e0b" strokeWidth="1" opacity="0.4" />
        <circle cx={cx} cy={cy} r="90" stroke="#fde047" strokeWidth="1.8" opacity="0.45" />
        <circle cx={cx} cy={cy} r="50" stroke="#fbbf24" strokeWidth="1.2" strokeDasharray="3 3" opacity="0.5" />
      </svg>
    </div>
  );
}

/**
 * Bottom Festive Temple / Palace Skyline Silhouette
 */
export function TempleSkyline() {
  return (
    <div className="navratri-skyline-bg">
      <svg width="100%" height="100%" viewBox="0 0 1200 150" preserveAspectRatio="none" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Layer 1: Distant Spire Silhouettes */}
        <path
          d="M0 150V115L35 105L45 88L55 105L95 115L135 100L145 72L155 100L195 115L235 110L245 82L255 110L315 120L375 95L385 62L395 95L455 120L515 105L525 78L535 105L595 115L655 95L665 58L675 95L735 115L795 105L805 78L815 105L875 120L935 95L945 62L955 95L1015 120L1075 110L1085 82L1095 110L1145 115L1200 105V150H0Z"
          fill="#01140c"
          opacity="0.65"
        />
        {/* Layer 2: Detailed Foreground Palace / Temple Spires */}
        <path
          d="M0 150V125L55 120L65 98L75 120L175 125L215 115L225 88L235 115L345 130L415 110L425 78L435 110L545 125L615 110L625 68L635 110L745 125L835 110L845 78L855 110L965 130L1035 115L1045 88L1055 115L1155 125L1200 120V150H0Z"
          fill="#010c07"
          opacity="0.92"
        />
        {/* Golden Horizon Rim Glow */}
        <path
          d="M0 126L55 121L65 99L75 121L175 126L215 116L225 89L235 116L345 131L415 111L425 79L435 111L545 126L615 111L625 69L635 111L745 126L835 111L845 79L855 111L965 131L1035 116L1045 89L1055 116L1155 126L1200 121"
          stroke="#f59e0b"
          strokeWidth="1.2"
          opacity="0.4"
        />
      </svg>
    </div>
  );
}

/**
 * Decorative Floral & Leaf Accents for Card Bottom Corners
 */
export function CardCornerDecor() {
  return (
    <>
      <svg
        width="32"
        height="32"
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ position: "absolute", bottom: "4px", left: "4px", pointerEvents: "none", opacity: 0.8 }}
      >
        <path d="M2 30C10 30 18 22 18 14C18 8 24 2 30 2" stroke="#15803d" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M6 24C12 24 16 18 16 14" stroke="#22c55e" strokeWidth="1.2" />
        <circle cx="8" cy="24" r="2.5" fill="#ea580c" />
        <circle cx="14" cy="18" r="2" fill="#fde047" />
        <circle cx="4" cy="28" r="1.5" fill="#16a34a" />
      </svg>
      <svg
        width="32"
        height="32"
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ position: "absolute", bottom: "4px", right: "4px", pointerEvents: "none", opacity: 0.8, transform: "scaleX(-1)" }}
      >
        <path d="M2 30C10 30 18 22 18 14C18 8 24 2 30 2" stroke="#15803d" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M6 24C12 24 16 18 16 14" stroke="#22c55e" strokeWidth="1.2" />
        <circle cx="8" cy="24" r="2.5" fill="#ea580c" />
        <circle cx="14" cy="18" r="2" fill="#fde047" />
        <circle cx="4" cy="28" r="1.5" fill="#16a34a" />
      </svg>
    </>
  );
}

/**
 * Side Leaf & Floral Decorations that extend from the sides of active challenge cards
 * Matches the reference design - lush green leaves + orange marigold flowers on both sides
 */
export function ActiveCardSideDecor() {
  return (
    <>
      {/* LEFT side leaves + flower */}
      <svg
        width="36"
        height="120"
        viewBox="0 0 36 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          position: "absolute",
          left: "-18px",
          top: "50%",
          transform: "translateY(-50%)",
          pointerEvents: "none",
          zIndex: 5,
          filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.2))",
        }}
      >
        {/* Stem */}
        <path d="M30 10C28 30 24 50 20 60C24 70 28 90 30 110" stroke="#15803d" strokeWidth="2" strokeLinecap="round" />
        {/* Upper leaf */}
        <path d="M26 25C18 22 8 26 6 34C14 36 22 30 26 25Z" fill="#16a34a" />
        <path d="M26 25C22 18 14 16 8 20C12 28 20 30 26 25Z" fill="#22c55e" />
        {/* Middle marigold */}
        <circle cx="22" cy="60" r="9" fill="#ea580c" />
        <circle cx="22" cy="60" r="5.5" fill="#fbbf24" />
        <circle cx="22" cy="60" r="2.5" fill="#ffffff" opacity="0.8" />
        {/* Lower leaf */}
        <path d="M26 95C18 92 8 96 6 104C14 106 22 100 26 95Z" fill="#16a34a" />
        <path d="M26 95C22 88 14 86 8 90C12 98 20 100 26 95Z" fill="#22c55e" />
      </svg>

      {/* RIGHT side leaves + flower */}
      <svg
        width="36"
        height="120"
        viewBox="0 0 36 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          position: "absolute",
          right: "-18px",
          top: "50%",
          transform: "translateY(-50%) scaleX(-1)",
          pointerEvents: "none",
          zIndex: 5,
          filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.2))",
        }}
      >
        {/* Stem */}
        <path d="M30 10C28 30 24 50 20 60C24 70 28 90 30 110" stroke="#15803d" strokeWidth="2" strokeLinecap="round" />
        {/* Upper leaf */}
        <path d="M26 25C18 22 8 26 6 34C14 36 22 30 26 25Z" fill="#16a34a" />
        <path d="M26 25C22 18 14 16 8 20C12 28 20 30 26 25Z" fill="#22c55e" />
        {/* Middle marigold */}
        <circle cx="22" cy="60" r="9" fill="#ea580c" />
        <circle cx="22" cy="60" r="5.5" fill="#fbbf24" />
        <circle cx="22" cy="60" r="2.5" fill="#ffffff" opacity="0.8" />
        {/* Lower leaf */}
        <path d="M26 95C18 92 8 96 6 104C14 106 22 100 26 95Z" fill="#16a34a" />
        <path d="M26 95C22 88 14 86 8 90C12 98 20 100 26 95Z" fill="#22c55e" />
      </svg>
    </>
  );
}
