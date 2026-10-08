import React, { useState, useRef } from "react";

export interface PhotoConfig {
  instructions?: string;
  hideActivityInstructions?: boolean;
  maxFileSizeMb?: number;
  allowedTypes?: string[];
}

interface PhotoUploadActivityProps {
  levelId: string;
  config: PhotoConfig;
  onSubmit: (file: File, textNote?: string) => Promise<void>;
  isSubmitting: boolean;
  error?: string | null;
}

export function PhotoUploadActivity({
  config,
  onSubmit,
  isSubmitting,
  error,
}: PhotoUploadActivityProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const maxMb = config.maxFileSizeMb || 10;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileError(null);

    if (file.size > maxMb * 1024 * 1024) {
      setFileError(`File is too large. Maximum size allowed is ${maxMb}MB.`);
      e.currentTarget.value = "";
      return;
    }

    const imageExtensions = /\.(jpe?g|png|webp)$/i;
    if (!(file.type.startsWith("image/") || (!file.type && imageExtensions.test(file.name)))) {
      setFileError("Please upload a valid image file (JPEG, PNG, WEBP).");
      e.currentTarget.value = "";
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || isSubmitting) return;
    onSubmit(selectedFile);
  };

  return (
    <form onSubmit={handleSubmit} style={{ width: "100%" }}>
      <div style={{ marginBottom: "16px" }}>
        {!config.hideActivityInstructions && <p style={{ fontSize: "14px", color: "#475569", lineHeight: "1.5", marginBottom: "12px" }}>
          {config.instructions ||
            "Upload a clear and bright festive photograph to complete this challenge."}
        </p>}

        {/* Dropzone / Upload Box */}
        <div
          className="photo-upload-dropzone"
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: "2px dashed #cbd5e1",
            borderRadius: "12px",
            padding: previewUrl ? "10px" : "16px 12px",
            textAlign: "center",
            background: previewUrl ? "#f8fafc" : "#ffffff",
            cursor: "pointer",
            transition: "border-color 0.2s ease",
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onClick={(event) => event.stopPropagation()}
            onChange={handleFileChange}
            style={{ display: "none" }}
          />

          {previewUrl ? (
            <div>
              <img
                src={previewUrl}
                alt="Upload preview"
                style={{
                  maxHeight: "200px",
                  maxWidth: "100%",
                  objectFit: "contain",
                  borderRadius: "8px",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
                }}
              />
              <div style={{ marginTop: "8px", fontSize: "12px", color: "#64748b" }}>
                {selectedFile?.name} · Click to choose a different photo
              </div>
            </div>
          ) : (
            <div>
              <svg aria-hidden="true" viewBox="0 0 32 32" width="30" height="30" style={{ display: "block", margin: "0 auto 6px", color: "#f3c04d" }}><path d="M5 10h5l2-3h8l2 3h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V12a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><circle cx="16" cy="17" r="5" fill="none" stroke="currentColor" strokeWidth="2"/></svg>
              <div style={{ fontWeight: 600, color: "#1e293b", fontSize: "14px" }}>
                Tap to upload photo
              </div>
              <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "4px" }}>
                JPEG, PNG, WEBP (Max {maxMb}MB)
              </div>
            </div>
          )}
        </div>

      </div>

      {(fileError || error) && (
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
          ⚠️ {fileError || error}
        </div>
      )}

      <button
        className="photo-upload-submit"
        type="submit"
        disabled={!selectedFile || isSubmitting}
        style={{
          width: "100%",
          padding: "10px 20px",
          borderRadius: "10px",
          background:
            !selectedFile || isSubmitting
              ? "#cbd5e1"
              : "linear-gradient(135deg, #059669 0%, #047857 100%)",
          color: "#ffffff",
          fontWeight: 700,
          fontSize: "15px",
          border: "none",
          cursor: !selectedFile || isSubmitting ? "not-allowed" : "pointer",
          boxShadow: !selectedFile || isSubmitting ? "none" : "0 4px 12px rgba(5, 150, 105, 0.3)",
          transition: "all 0.2s ease",
        }}
      >
        {isSubmitting ? "Uploading Photo..." : "Submit for Review"}
      </button>
    </form>
  );
}
