import cardImage from "../../styles/card-image.webp";
import { useEffect, useMemo, useRef, useState } from "react";

type SpecialActivityProps = {
  activityType: string;
  levelNumber: number;
  campaignSlug: string;
  config: Record<string, unknown>;
  points: number;
  isSubmitting: boolean;
  error?: string | null;
  answerFeedback?: { correct: boolean; message: string };
  attemptsRemaining?: number;
  onComplete: (activityType: string, values?: Record<string, string>) => void;
  onPrepareSpin: () => void;
  spinPrize: { label: string; discountPercent: number; index: number; token: string } | null;
  storefrontUrl: string | null;
};

const buttonStyle: React.CSSProperties = {
  border: 0,
  borderRadius: 10,
  padding: "12px 18px",
  background: "linear-gradient(135deg, #d97706, #b45309)",
  color: "#fff",
  fontWeight: 800,
  cursor: "pointer",
};

export function SpecialActivity({
  activityType,
  levelNumber,
  campaignSlug,
  config,
  points,
  isSubmitting,
  error,
  answerFeedback,
  attemptsRemaining,
  onComplete,
  onPrepareSpin,
  spinPrize,
  storefrontUrl,
}: SpecialActivityProps) {
  const [answer, setAnswer] = useState("");
  const [spinning, setSpinning] = useState(false);
  const [wheelRotation, setWheelRotation] = useState(0);
  const [wheelArmed, setWheelArmed] = useState(false);
  const animatedSpinToken = useRef<string | null>(null);
  const onCompleteRef = useRef(onComplete);
  const cardFaces = useMemo(() => {
    const faces = Array.isArray(config.cards) && config.cards.length
      ? config.cards.map(String).slice(0, 12)
      : ["🪔", "🥁", "🪘", "💃", "👗", "🌸", "🛕", "🎶"];
    return faces;
  }, [config.cards]);

  const [cards, setCards] = useState<string[]>(() => {
    if (activityType === "memory_game") {
      const deck = [...cardFaces, ...cardFaces].sort(() => Math.random() - 0.5);
      return deck;
    }
    return [];
  });
  const [open, setOpen] = useState<number[]>([]);
  const [matched, setMatched] = useState<number[]>([]);
  const [gameComplete, setGameComplete] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(Number(config.timerSeconds) || 90);
  const memoryCompletionSent = useRef(false);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (activityType !== "memory_game") return;
    memoryCompletionSent.current = false;
    setGameComplete(false);
    // Remove the asynchronous setting of cards to avoid flashing empty grid or duplicate initializations.
    // The cards are already synchronously initialized in useState.
    // Only re-shuffle if user actually changes campaign or manually resets, which they do via Try Again.
  }, [activityType]);

  useEffect(() => {
    if (activityType !== "memory_game" || secondsLeft <= 0 || gameComplete) return;
    const timer = window.setInterval(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [activityType, secondsLeft, gameComplete]);

  useEffect(() => {
    if (open.length !== 2) return;
    const [first, second] = open;
    const timer = window.setTimeout(() => {
      if (cards[first] === cards[second]) {
        const nextMatched = [...matched, first, second];
        setMatched(nextMatched);
        if (cards.length > 0 && nextMatched.length >= cards.length) setGameComplete(true);

      }
      setOpen([]);
    }, 650);
    return () => window.clearTimeout(timer);
  }, [open, cards, matched]);

  useEffect(() => {
    if (activityType === "memory_game" && error && !isSubmitting) {
      memoryCompletionSent.current = false;
    }
  }, [activityType, error, isSubmitting]);
  useEffect(() => {
    if (activityType !== "spin_wheel") return;
    if (!spinPrize) {
      animatedSpinToken.current = null;
      return;
    }
    if (animatedSpinToken.current === spinPrize.token) return;
    animatedSpinToken.current = spinPrize.token;
    setWheelArmed(true);
    const rewards = Array.isArray(config.rewards) && config.rewards.length
      ? config.rewards.map((item) => typeof item === "string" ? item : item && typeof item === "object" && !Array.isArray(item) ? String((item as Record<string, unknown>).label || "") : "").filter(Boolean)
      : ["10% OFF", "15% OFF", "20% OFF"];
    const wheelRewards = Array.from({ length: Math.max(6, rewards.length) }, (_, index) => ({ prizeIndex: index % rewards.length }));
    const landingIndex = wheelRewards.findIndex((item) => item.prizeIndex === spinPrize.index);
    const segmentAngle = 360 / wheelRewards.length;
    const targetOffset = (360 - landingIndex * segmentAngle) % 360;
    setSpinning(true);
    setWheelRotation((rotation) => Math.ceil((rotation + 1) / 360) * 360 + 1440 + targetOffset);
    const timer = window.setTimeout(() => {
      setSpinning(false);
      setWheelArmed(false);
      onCompleteRef.current("spin_wheel", { spinAttemptToken: spinPrize.token });
    }, 3200);
    return () => window.clearTimeout(timer);
    // Only restart the animation for a new prepared spin. Callback identity can
    // change as the parent rerenders and must not cancel the wheel timer.
  }, [activityType, config.rewards, spinPrize?.token, spinPrize?.index]);

  useEffect(() => {
    if (activityType === "spin_wheel" && error && !isSubmitting) setWheelArmed(false);
  }, [activityType, error, isSubmitting]);

  if (activityType === "spin_wheel") {
    const rewards = Array.isArray(config.rewards) && config.rewards.length
      ? config.rewards.map((item) => typeof item === "string" ? item : item && typeof item === "object" && !Array.isArray(item) ? String((item as Record<string, unknown>).label || "") : "").filter(Boolean)
      : ["10% OFF", "15% OFF", "20% OFF"];
    const wheelRewards = Array.from({ length: Math.max(6, rewards.length) }, (_, index) => ({ label: rewards[index % rewards.length], prizeIndex: index % rewards.length }));
    const wheelPalette = [
      { color: "#123f6c", tone: "light" },
      { color: "#fff3dc", tone: "dark" },
      { color: "#1b6863", tone: "light" },
      { color: "#0b2d50", tone: "light" },
      { color: "#f8edda", tone: "dark" },
      { color: "#174e52", tone: "light" },
    ];
    const segment = 360 / wheelRewards.length;
    const wheelGradient = wheelRewards
      .map((_, index) => {
        const start = index * segment;
        const end = (index + 1) * segment;
        const separator = Math.min(1, segment * 0.025);
        const color = wheelPalette[index % wheelPalette.length].color;
        return `${color} ${start}deg ${end - separator}deg, #e7c16c ${end - separator}deg ${end}deg`;
      })
      .join(", ");
    return (
      <section className="spin-wheel-panel" aria-label="Spin and win challenge">

        <div className="spin-wheel-frame">
          <div aria-hidden="true" className="spin-wheel-pointer" />
          <div
            className="spin-wheel-disc"
            role="img"
            style={{
              background: `conic-gradient(from -${segment / 2}deg, ${wheelGradient})`,
              transform: `rotate(${wheelRotation}deg)`,
              transition: spinning ? "transform 3.2s cubic-bezier(.12,.72,.12,1)" : "none",
            }}
          >
            {wheelRewards.map(({ label }, index) => {
              const angle = index * segment;
              const radians = angle * Math.PI / 180;
              const x = 50 + Math.sin(radians) * 31;
              const y = 50 - Math.cos(radians) * 31;
              const tone = wheelPalette[index % wheelPalette.length].tone;
              const offerParts = label.match(/^(\d{1,3}%)\s+(OFF)$/i);
              return (
                <span key={`${label}-${index}`} className={`spin-wheel-label spin-wheel-label--${tone}`} style={{ left: `${x}%`, top: `${y}%` }}>
                  {offerParts ? <>{offerParts[1]}<br />{offerParts[2]}</> : label}
                </span>
              );
            })}
          </div>
          <div aria-hidden="true" className="spin-wheel-hub" />
        </div>
        <p className="spin-wheel-instructions">{String(config.instructions || "Spin the wheel and unlock your Navratri surprise!")}</p>
        <button type="button" className="spin-wheel-button" disabled={isSubmitting || spinning || wheelArmed} onClick={() => {
          setWheelArmed(true);
          if (!spinPrize) onPrepareSpin();
        }}>{spinning ? "Spinning…" : wheelArmed && !spinPrize ? "Choosing your prize…" : String(config.spinButtonText || "Spin & Win")}</button>
        {error && <p className="spin-wheel-error" role="alert">{error}</p>}

      </section>
    );
  }
  if (activityType === "memory_game") {
    const maxAttempts = Number(config.maxAttempts) || 30;
    const lost = !gameComplete && (secondsLeft <= 0 || attempts >= maxAttempts);
    return (
      <div className="memory-game" style={{ padding: 0, textAlign: "center" }}>
        <p className="memory-game-status" style={{ color: "rgba(255, 255, 255, 0.9)", fontWeight: 600 }}>Find every matching pair · {secondsLeft}s · {attempts}/{maxAttempts} attempts</p>
        <div className="memory-game-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(48px, 1fr))", gap: 12, maxWidth: 420, margin: "0 auto 18px" }}>
          {cards.map((face, index) => {
            const revealed = open.includes(index) || matched.includes(index);
            const isMatched = matched.includes(index);
            const imageFace = face.startsWith("https://") || face.startsWith("http://") || face.startsWith("/");
            return (
              <button
                className={`memory-game-card ${revealed ? "is-revealed" : ""} ${isMatched ? "is-matched" : ""}`}
                key={index}
                type="button"
                aria-label={revealed ? (imageFace ? `Card ${index + 1}` : face) : "Hidden card"}
                disabled={revealed || lost || isSubmitting}
                onClick={() => {
                  if (open.length >= 2) return;
                  if (open.length === 1) setAttempts((value) => value + 1);
                  setOpen((value) => [...value, index]);
                }}
              >
                <div className="memory-card-inner">
                  <div className="memory-card-hidden" style={{ padding: 0, background: "transparent", borderRadius: "12px", border: "2px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 6px rgba(0,0,0,0.1)", overflow: "hidden" }}>
                    {cardImage ? (
                      <img src={cardImage} alt="Card back" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                    ) : (
                      <span style={{ fontSize: "24px", opacity: 0.8 }}>🪔</span>
                    )}
                  </div>
                  <div className="memory-card-revealed" style={imageFace ? { padding: 0, backgroundImage: `url(${face})`, backgroundSize: "cover", backgroundPosition: "center", borderRadius: "12px", border: "none" } : { background: "#ffffff", color: "#1e293b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px", fontWeight: "bold" }}>
                    {!imageFace && face}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        {lost && <button type="button" style={buttonStyle} onClick={() => { memoryCompletionSent.current = false; setAttempts(0); setMatched([]); setGameComplete(false); setOpen([]); setSecondsLeft(Number(config.timerSeconds) || 90); setCards([...cardFaces, ...cardFaces].sort(() => Math.random() - 0.5)); }}>Try Again</button>}
        {cards.length > 0 && gameComplete && (
          <div style={{ display: "grid", justifyItems: "center", gap: 8, marginTop: 12 }}>
            <p style={{ margin: 0, fontWeight: 800, color: "#166534" }}>All pairs matched! Submit your game to earn {points} points.</p>
            <button type="button" style={buttonStyle} disabled={memoryCompletionSent.current || isSubmitting} onClick={() => {
              if (memoryCompletionSent.current || isSubmitting) return;
              memoryCompletionSent.current = true;
              onCompleteRef.current("memory_game", { attempts: String(attempts) });
            }}>{isSubmitting ? "Submitting game…" : error ? "Retry game submission" : "Submit completed game"}</button>
          </div>
        )}
        {error && <p role="alert" style={{ color: "#b91c1c" }}>{error}</p>}
      </div>
    );
  }

  if (activityType === "movie_guess" || activityType === "audio_guess") {
    let rawAudioUrl = String(config.audioUrl || "");
    let audioUrl = rawAudioUrl;
    if (audioUrl.startsWith("r2:")) {
      let key: string | null = null;
      try {
        key = new URL(audioUrl.slice(3), "https://media.invalid").searchParams.get("key");
      } catch {
        if (audioUrl.includes("key=")) key = audioUrl.split("key=")[1];
      }
      if (key) {
        audioUrl = `/api/media?key=${encodeURIComponent(key)}`;
      }
    }
    const movieOptions = Array.isArray(config.options) ? config.options.map(String).filter(Boolean) : [];
    const movieGuessesLeft = Math.max(0, Math.min(3, attemptsRemaining ?? 3));
    const movieAttemptsUsed = 3 - movieGuessesLeft;
    return (
      <form onSubmit={(event) => { event.preventDefault(); if (answer.trim() && (activityType !== "movie_guess" || movieGuessesLeft > 0)) onComplete(activityType, { answer }); }} style={{ display: "grid", gap: 12 }}>
        {activityType === "movie_guess" ? (
          <>
            <div style={{ textAlign: "center", fontSize: 48 }}>{String(config.clue || "🎬❓")}</div>
            <p style={{ margin: 0, textAlign: "center", color: "#334155", fontWeight: 700 }}>Guess the movie name · {movieAttemptsUsed}/3 attempts used · {movieGuessesLeft} left</p>
            {movieOptions.length > 0 && <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
              <legend style={{ color: "#334155", fontWeight: 700, marginBottom: 8 }}>Choose the movie</legend>
              {movieOptions.map((option, index) => <label key={`${option}-${index}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: 12, border: "1px solid #cbd5e1", borderRadius: 10, background: answer === option ? "#fff7ed" : "#fff", cursor: "pointer", color: "#1f2937" }}>
                <input type="radio" name="movie_guess_choice" value={option} checked={answer === option} onChange={() => setAnswer(option)} required />{option}
              </label>)}
            </fieldset>}
          </>
        ) : audioUrl ? (
          <audio controls src={audioUrl} style={{ width: "100%" }}>Audio playback is not supported.</audio>
        ) : <p style={{ color: "#b91c1c" }}>The campaign team has not added an audio clip yet.</p>}
        {!(activityType === "movie_guess" && movieOptions.length > 0) && <label style={{ display: "grid", gap: 6, color: "#334155", fontWeight: 700 }}>
          {activityType === "movie_guess" ? "Your movie guess" : String(config.prompt || "Your tune guess")}
          <input value={answer} onChange={(event) => setAnswer(event.target.value)} required style={{ padding: 10, border: "1px solid #cbd5e1", borderRadius: 8, width: "100%", boxSizing: "border-box", background: "rgba(255, 255, 255, 0.95)", color: "#1e293b" }} />
        </label>}
        <button type="submit" style={buttonStyle} disabled={activityType === "audio_guess" ? false : isSubmitting || (activityType === "movie_guess" && movieGuessesLeft <= 0)} aria-busy={isSubmitting}>
          {isSubmitting ? "Checking answer…" : activityType === "movie_guess" ? movieGuessesLeft <= 0 ? "No guesses remaining" : "Submit Movie Guess" : "Submit Answer"}
        </button>
        {(activityType === "movie_guess" || activityType === "audio_guess") && answerFeedback && <p role={answerFeedback.correct ? "status" : "alert"} style={{ margin: 0, padding: 12, borderRadius: 8, color: answerFeedback.correct ? "#166534" : "#ffffff", background: answerFeedback.correct ? "#dcfce7" : "transparent", fontWeight: 800, textAlign: "center", textShadow: answerFeedback.correct ? "none" : "0 1px 3px rgba(0,0,0,0.4)" }}>{answerFeedback.message}</p>}
        {error && <p role="alert" style={{ color: "#ffffff", background: "transparent", padding: 8, textShadow: "0 1px 3px rgba(0,0,0,0.4)", fontWeight: 800, textAlign: "center", margin: 0 }}>{error}</p>}
      </form>
    );
  }

  if (activityType === "treasure_hunt") {
    const handles = Array.isArray(config.eligibleProductHandles) ? config.eligibleProductHandles.map(String) : [];
    const categories = Array.isArray(config.eligibleCategories) ? config.eligibleCategories.map(String) : [];
    const treasureLabel = String(config.buttonLabel || "Find the Navratri treasure");
    const treasurePageUrl = (type: "collections" | "products", handle: string) => {
      const path = `/${type}/${encodeURIComponent(handle)}`;
      const query = new URLSearchParams({ navratri_campaign: campaignSlug, navratri_level: String(levelNumber) });
      const baseUrl = storefrontUrl ? storefrontUrl.replace(/\/$/, "") : "";
      return `${baseUrl}${path}?${query.toString()}`;
    };
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <p>{String(config.instructions || "Open a featured collection, look around the page for the floating 🎁, and tap it to claim your treasure.")}</p>
        {categories.length > 0 && <div style={{ display: "grid", gap: 8 }}>
          <strong style={{ color: "#7a161b" }}>1. Visit a featured collection</strong>
          {categories.map((handle) => <a key={handle} target="_top" rel="noreferrer" href={treasurePageUrl("collections", handle)} style={{ ...buttonStyle, textAlign: "center", textDecoration: "none" }}>Open {handle.replaceAll("-", " ")} collection →</a>)}
        </div>}
        {handles.length > 0 && <div style={{ display: "grid", gap: 8 }}>
          <strong style={{ color: "#7a161b" }}>{categories.length ? "2. Or visit a featured product" : "1. Open a featured product"}</strong>
          {handles.map((handle) => <a key={handle} target="_top" rel="noreferrer" href={treasurePageUrl("products", handle)} style={{ color: "#7a161b", fontWeight: 800 }}>Explore {handle.replaceAll("-", " ")} →</a>)}
        </div>}
        {(categories.length > 0 || handles.length > 0) && <p style={{ margin: 0, color: "#5d3220", fontSize: 13, lineHeight: 1.55 }}>
          {categories.length ? "3. On the collection or an eligible product, find the festive treasure button and tap it. Your discovery will be recorded automatically." : "2. On the product page, find the festive treasure button and tap it. Your discovery will be recorded automatically."}
        </p>}
        {handles.length === 0 && categories.length === 0 && <p style={{ color: "#b91c1c" }}>The campaign team has not selected eligible products or collections yet.</p>}
      </div>
    );
  }

  if (activityType === "purchase") {
    return <div style={{ display: "grid", gap: 12 }}>
      <p>{String(config.instructions || "Complete an eligible purchase. Points are added after Shopify confirms payment.")}</p>
      {storefrontUrl && <a href={storefrontUrl} style={{ ...buttonStyle, textAlign: "center", textDecoration: "none" }}>Continue shopping</a>}
      <p style={{ color: "#64748b", fontSize: 12 }}>Your {points} points will appear here after the paid order is verified.</p>
      <button 
        type="button" 
        onClick={() => onComplete("purchase_check")} 
        style={{ ...buttonStyle, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.3)" }}
        disabled={isSubmitting}
      >
        {isSubmitting ? "Checking past orders…" : "Refresh & Check Past Orders"}
      </button>
      {error && <p role="alert" style={{ color: "#fecaca", fontSize: 13, margin: 0, textAlign: "center" }}>{error}</p>}
    </div>;
  }

  return <p>This activity is not configured yet.</p>;
}
