import { useState, useEffect, useRef } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, useSearchParams, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getActiveCampaign } from "../services/campaign.server";
import { getSubmissionsList, reviewSubmissionAdmin } from "../services/submission.server";

function appMediaPath(value: string | null): string | null {
  if (!value) return value;
  try {
    const url = value.startsWith("r2:")
      ? new URL(`/api/media${value.slice(3)}`, "https://media.invalid")
      : new URL(value, "https://media.invalid");
    return url.pathname === "/api/media" && url.searchParams.has("key")
      ? `${url.pathname}${url.search}`
      : value;
  } catch {
    return value;
  }
}

function thumbnailUrl(value: string): string {
  try {
    const url = new URL(value, "https://media.invalid");
    const key = url.pathname === "/api/media" ? url.searchParams.get("key") : null;
    if (key?.endsWith(".webp")) {
      url.searchParams.set("key", key.replace(/\.webp$/i, "_thumb.webp"));
      return `${url.pathname}${url.search}`;
    }
  } catch {
    // Keep external legacy URLs unchanged.
  }
  return value.replace(/\.webp$/i, "_thumb.webp");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);

  const status = url.searchParams.get("status") || "pending";
  const campaign = await getActiveCampaign(session.shop);

  if (!campaign) {
    return {
      campaign: null,
      submissions: [],
      totalCount: 0,
      hasMore: false,
      statusFilter: status,
      adminShop: session.shop,
    };
  }

  const result = await getSubmissionsList({
    campaignId: campaign.id,
    status: status === "all" ? undefined : status,
    limit: 50,
  });

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
    },
    submissions: result.submissions.map((s) => ({
      ...s,
      fileUrl: appMediaPath(s.fileUrl),
      createdAt: s.createdAt.toISOString(),
      reviewedAt: s.reviewedAt ? s.reviewedAt.toISOString() : null,
    })),
    totalCount: result.totalCount,
    hasMore: result.hasMore,
    statusFilter: status,
    adminShop: session.shop,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const submissionId = String(formData.get("submissionId") || "");
  const rawReviewAction = String(formData.get("reviewAction") || "");
  const reviewAction = rawReviewAction === "approve" || rawReviewAction === "reject" ? rawReviewAction : null;
  const adminNote = String(formData.get("adminNote") || "").trim();

  if (!submissionId || !reviewAction) {
    return { success: false, error: "Missing submission ID or review action." };
  }

  try {
    const result = await reviewSubmissionAdmin({
      submissionId,
      action: reviewAction,
      adminNote,
      reviewerInfo: `Shopify Admin (${session.shop})`,
      shop: session.shop,
    });

    return {
      success: true,
      message:
        reviewAction === "approve"
          ? result.pointTransaction?.points
            ? `Submission approved! ${result.pointTransaction.points} points credited to customer.`
            : "Feedback saved. No points awarded for this activity."
          : "Submission rejected. Customer notified.",
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to review submission";
    return { success: false, error: msg };
  }
};

export default function SubmissionsPage() {
  const { campaign, submissions, totalCount, hasMore, statusFilter } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  const [activeReviewSubmission, setActiveReviewSubmission] = useState<(typeof submissions)[0] | null>(null);
  const [chosenAction, setChosenAction] = useState<"approve" | "reject">("approve");
  const formRef = useRef<HTMLFormElement>(null);
  const reviewActionInputRef = useRef<HTMLInputElement>(null);
  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.success) {
      shopify.toast.show(actionData.message || "Action completed!");
      setActiveReviewSubmission(null);
    } else if (actionData?.error) {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData, shopify]);

  const handleTabChange = (status: string) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("status", status);
      return p;
    });
  };

  if (!campaign) {
    return (
      <s-page heading="Submissions Moderation">
        <s-section heading="No Active Campaign">
          <div style={{ padding: "32px", textAlign: "center", background: "#ffffff", borderRadius: "10px", border: "1px solid #e1e3e5" }}>
            <div style={{ fontSize: "16px", fontWeight: "bold", color: "#202223" }}>No active campaign found</div>
          </div>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Submissions Review & Moderation">
      {/* Header Banner */}
      <div
        style={{
          background: "#ffffff",
          borderRadius: "10px",
          padding: "20px 24px",
          border: "1px solid #e1e3e5",
          marginBottom: "20px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <div style={{ fontSize: "18px", fontWeight: "bold", color: "#202223" }}>
              📥 Submissions Review Queue
            </div>
            <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "2px" }}>
              Moderate photo, video, and text challenge entries from participating customers.
            </div>
          </div>
          <div style={{ fontSize: "13px", color: "#6d7175" }}>
            Showing <strong>{submissions.length}{hasMore ? "+" : ""}</strong> submissions{!hasMore && <> (<strong>{totalCount}</strong> total)</>}
          </div>
        </div>

        {/* Status Tabs */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            marginTop: "16px",
            borderBottom: "1px solid #e5e7eb",
            paddingBottom: "8px",
          }}
        >
          {[
            { id: "pending", label: "⏳ Pending Review" },
            { id: "approved", label: "✓ Approved" },
            { id: "rejected", label: "✕ Rejected" },
            { id: "all", label: "All Submissions" },
          ].map((tab) => {
            const isSelected = statusFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabChange(tab.id)}
                style={{
                  background: isSelected ? "#065f46" : "#f3f4f6",
                  color: isSelected ? "#ffffff" : "#4b5563",
                  border: "none",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Submissions List / Table */}
      {submissions.length === 0 ? (
        <div
          style={{
            background: "#ffffff",
            borderRadius: "10px",
            border: "1px solid #e1e3e5",
            padding: "48px 24px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "36px", marginBottom: "12px" }}>
            {statusFilter === "pending" ? "🎉" : "📥"}
          </div>
          <div style={{ fontSize: "16px", fontWeight: "bold", color: "#202223", marginBottom: "6px" }}>
            {statusFilter === "pending" ? "No pending submissions to review!" : "No submissions found"}
          </div>
          <div style={{ fontSize: "13px", color: "#6d7175", maxWidth: "420px", margin: "0 auto" }}>
            {statusFilter === "pending"
              ? "All customer challenge submissions have been processed and moderated."
              : "Submissions will appear here as customers complete challenges."}
          </div>
        </div>
      ) : (
        <div
          style={{
            background: "#ffffff",
            borderRadius: "10px",
            border: "1px solid #e1e3e5",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            overflowX: "auto",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e1e3e5", textAlign: "left", color: "#4b5563", fontSize: "12px", textTransform: "uppercase" }}>
                <th style={{ padding: "12px 16px" }}>Customer</th>
                <th style={{ padding: "12px 16px" }}>Level & Activity</th>
                <th style={{ padding: "12px 16px" }}>Submitted Content</th>
                <th style={{ padding: "12px 16px" }}>Submitted At</th>
                <th style={{ padding: "12px 16px" }}>Status</th>
                <th style={{ padding: "12px 16px", textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((sub) => {
                const isApproved = sub.status === "approved";
                const isRejected = sub.status === "rejected";
                const isPending = sub.status === "pending";
                const customerId = sub.customerProgress?.shopifyCustomerId || "Customer";

                return (
                  <tr key={sub.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "14px 16px", fontWeight: 600, color: "#111827" }}>
                      {customerId.replace(/\D/g, "").slice(-6) ? `Customer ...${customerId.slice(-6)}` : customerId}
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <div style={{ fontWeight: 600, color: "#1f2937" }}>
                        Day {sub.level?.levelNumber || sub.levelId.slice(0, 4)}: {sub.level?.title}
                      </div>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          color: "#6b7280",
                          textTransform: "uppercase",
                        }}
                      >
                        {sub.level?.activityType.replace("_", " ")}
                      </span>
                    </td>
                    <td style={{ padding: "14px 16px", maxWidth: "260px" }}>
                      {sub.fileUrl ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          {sub.submissionType.includes("photo") || (sub.fileUrl && sub.fileUrl.match(/\.(jpg|jpeg|png|webp)/i)) ? (
                            <img
                              src={thumbnailUrl(sub.fileUrl)}
                              alt="Customer Submission"
                              loading="lazy"
                              width={40}
                              height={40}
                              style={{ width: "40px", height: "40px", objectFit: "cover", borderRadius: "4px", border: "1px solid #e5e7eb" }}
                            />
                          ) : (
                            <span style={{ fontSize: "20px" }}>🎥</span>
                          )}
                          <a
                            href={sub.fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: "12px", color: "#2563eb", textDecoration: "none" }}
                          >
                            View Media
                          </a>
                        </div>
                      ) : sub.textResponse ? (
                        <div style={{ fontSize: "12px", color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          &ldquo;{sub.textResponse}&rdquo;
                        </div>
                      ) : (
                        <span style={{ fontSize: "12px", color: "#9ca3af" }}>Quiz submission</span>
                      )}
                    </td>
                    <td style={{ padding: "14px 16px", color: "#6b7280", fontSize: "12px" }}>
                      {new Date(sub.createdAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "3px 10px",
                          borderRadius: "12px",
                          fontSize: "11px",
                          fontWeight: 700,
                          background: isApproved ? "#dcfce7" : isRejected ? "#fee2e2" : "#fef3c7",
                          color: isApproved ? "#166534" : isRejected ? "#991b1b" : "#92400e",
                          textTransform: "uppercase",
                        }}
                      >
                        {sub.status}
                      </span>
                    </td>
                    <td style={{ padding: "14px 16px", textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: "8px" }}>
                        <button onClick={() = style={{ background: "#000", color: "#fff", padding: "10px 20px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: 600 }}> setActiveReviewSubmission(sub)}>
                          {isPending ? "Review" : "View"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Review & Preview Modal */}
      {activeReviewSubmission && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "20px",
          }}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: "12px",
              maxWidth: "580px",
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
              padding: "24px",
              boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div style={{ fontSize: "18px", fontWeight: "bold", color: "#111827" }}>
                Review Day {activeReviewSubmission.level?.levelNumber || ""} Challenge Submission
              </div>
              <button
                type="button"
                onClick={() => setActiveReviewSubmission(null)}
                style={{ background: "none", border: "none", fontSize: "18px", cursor: "pointer", color: "#6b7280" }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* Submission Metadata */}
              <div style={{ background: "#f9fafb", padding: "12px 16px", borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "13px" }}>
                <div>
                  <strong>Customer ID:</strong> <code>{activeReviewSubmission.customerProgress?.shopifyCustomerId || "Customer"}</code>
                </div>
                <div style={{ marginTop: "4px" }}>
                  <strong>Activity:</strong> {activeReviewSubmission.level?.title} (+{activeReviewSubmission.level?.points} pts)
                </div>
                <div style={{ marginTop: "4px" }}>
                  <strong>Submitted:</strong> {new Date(activeReviewSubmission.createdAt).toLocaleString()}
                </div>
              </div>

              {/* Media Preview / Content Display */}
              {activeReviewSubmission.fileUrl && (
                <div style={{ textAlign: "center", background: "#000000", borderRadius: "8px", overflow: "hidden", padding: "8px" }}>
                  {activeReviewSubmission.submissionType.includes("photo") || activeReviewSubmission.fileUrl.match(/\.(jpg|jpeg|png|webp)/i) ? (
                    <img
                      src={activeReviewSubmission.fileUrl}
                      alt="Submitted content"
                      loading="lazy"
                      width={560}
                      height={320}
                      style={{ maxHeight: "320px", maxWidth: "100%", objectFit: "contain" }}
                    />
                  ) : (
                    <video
                      src={activeReviewSubmission.fileUrl}
                      controls
                      style={{ maxHeight: "320px", maxWidth: "100%" }}
                    >
                      <track kind="captions" />
                    </video>
                  )}
                </div>
              )}

              {activeReviewSubmission.textResponse && (
                <div style={{ background: "#fdf8f6", border: "1px solid #fee2e2", padding: "16px", borderRadius: "8px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "#991b1b", marginBottom: "4px" }}>
                    Customer Text Response:
                  </div>
                  <div style={{ fontSize: "14px", color: "#1f2937", lineHeight: "1.5", whiteSpace: "pre-wrap" }}>
                    {activeReviewSubmission.textResponse}
                  </div>
                </div>
              )}

              {/* Review Decision Form */}
              <Form method="post" ref={formRef}>
                <input type="hidden" name="submissionId" value={activeReviewSubmission.id} />
                <input ref={reviewActionInputRef} type="hidden" name="reviewAction" value={chosenAction} />

                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "4px" }}>
                    Admin Note (Optional feedback for customer)
                  </label>
                  <input
                    type="text"
                    name="adminNote"
                    defaultValue={activeReviewSubmission.adminNote || ""}
                    placeholder="e.g. Great festive photo! Points approved."
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      border: "1px solid #d1d5db",
                      fontSize: "13px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "20px" }}>
                  <button type="button" onClick={() = style={{ background: "#000", color: "#fff", padding: "10px 20px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: 600 }}> setActiveReviewSubmission(null)}>
                    Close
                  </button>
                  <button
                    type="submit"
                    
                    disabled={isSubmitting}
                    onClick={() = style={{ background: "#000", color: "#fff", padding: "10px 20px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: 600 }}> { if (reviewActionInputRef.current) reviewActionInputRef.current.value = "approve"; setChosenAction("approve"); }}
                  >
                    {isSubmitting && chosenAction === "approve" ? "Approving..." : activeReviewSubmission.level?.levelNumber === 10 ? "✓ Save Feedback (0 Points)" : "✓ Approve & Award Points"}
                  </button>
                  <button
                    type="submit"
                    
                    disabled={isSubmitting}
                    onClick={() = style={{ background: "#fff", color: "#000", border: "1px solid #ccc", padding: "10px 20px", borderRadius: "6px", cursor: "pointer", fontWeight: 600 }}> { if (reviewActionInputRef.current) reviewActionInputRef.current.value = "reject"; setChosenAction("reject"); }}
                  >
                    {isSubmitting && chosenAction === "reject" ? "Rejecting..." : "✕ Reject"}
                  </button>
                </div>
              </Form>
            </div>
          </div>
        </div>
      )}
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

