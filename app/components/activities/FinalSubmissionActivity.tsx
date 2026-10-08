import React, { useState, useRef } from "react";

export interface FinalConfig {
  instructions?: string;
  maxFileSizeMb?: number;
  minCharacters?: number;
}

interface FinalSubmissionActivityProps {
  levelId: string;
  points: number;
  config: FinalConfig;
  onSubmit: (data: { file?: File; text: string }) => Promise<void>;
  isSubmitting: boolean;
  error?: string | null;
}

export function FinalSubmissionActivity({
  points,
  config,
  onSubmit,
  isSubmitting,
  error,
}: FinalSubmissionActivityProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [text, setText] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const minChars = config.minCharacters || 10;
  const maxMb = config.maxFileSizeMb || 15;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > maxMb * 1024 * 1024) {
      alert(`File is too large. Maximum size is ${maxMb}MB.`);
      return;
    }

    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = () => {
      setPreviewUrl(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (text.trim().length < minChars || isSubmitting) return;
    onSubmit({ file: selectedFile || undefined, text: text.trim() });
  };

  const isValid = text.trim().length >= minChars;

  return (
    <form onSubmit={handleSubmit} style={{ width: "100%" }}>
      <div style={{ marginBottom: "16px" }}>
        <div
          style={{
            padding: "12px 14px",
            background: "#fefce8",
            border: "1px solid #fde047",
            borderRadius: "8px",
            marginBottom: "12px",
          }}
        >
          <div style={{ fontWeight: 700, color: "#854d0e", fontSize: "14px" }}>
            🏆 Grand Navratri Finale Challenge (+{points} Points)
          </div>
          <p style={{ fontSize: "13px", color: "#a16207", marginTop: "4px", margin: 0 }}>
            {config.instructions ||
              "Upload your celebratory Navratri moment and share your final festive greeting to complete the 1000 Points Challenge!"}
          </p>
        </div>

        {/* Optional Photo Upload */}
        <div
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: "2px dashed #cbd5e1",
            borderRadius: "10px",
            padding: previewUrl ? "10px" : "20px",
            textAlign: "center",
            background: previewUrl ? "#f8fafc" : "#ffffff",
            cursor: "pointer",
            marginBottom: "14px",
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileChange}
            style={{ display: "none" }}
          />
          {previewUrl ? (
            <div>
              <img
                src={previewUrl}
                alt="Finale Preview"
                style={{ maxHeight: "160px", maxWidth: "100%", borderRadius: "6px" }}
              />
              <div style={{ fontSize: "11px", color: "#64748b", marginTop: "4px" }}>
                Tap to replace festive photo
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: "28px" }}>🎆</div>
              <div style={{ fontWeight: 600, fontSize: "13px", color: "#1e293b" }}>
                Add Finale Photo (Optional)
              </div>
            </div>
          )}
        </div>

        {/* Mandatory Finale Greeting */}
        <div>
          <label
            htmlFor="finale_text"
            style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}
          >
            Final Navratri Greeting & Completion Note:
          </label>
          <textarea
            id="finale_text"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Share your wishes as you complete the Navratri Challenge..."
            style={{
              width: "100%",
              padding: "10px",
              borderRadius: "8px",
              border: isValid ? "1.5px solid #cbd5e1" : "1.5px solid #f87171",
              fontSize: "14px",
              boxSizing: "border-box",
            }}
          />
          <div style={{ fontSize: "12px", color: isValid ? "#64748b" : "#dc2626", marginTop: "2px" }}>
            {isValid ? `${text.trim().length} chars` : `Minimum ${minChars} characters required`}
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
        disabled={!isValid || isSubmitting}
        style={{
          width: "100%",
          padding: "14px 20px",
          borderRadius: "10px",
          background:
            !isValid || isSubmitting
              ? "#cbd5e1"
              : "linear-gradient(135deg, #d97706 0%, #b45309 100%)",
          color: "#ffffff",
          fontWeight: 700,
          fontSize: "16px",
          border: "none",
          cursor: !isValid || isSubmitting ? "not-allowed" : "pointer",
          boxShadow: !isValid || isSubmitting ? "none" : "0 4px 14px rgba(217, 119, 6, 0.4)",
          transition: "all 0.2s ease",
        }}
      >
        {isSubmitting ? "Submitting Grand Finale..." : `Complete Navratri Challenge (+${points} Pts)`}
      </button>
    </form>
  );
}
