import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getActiveCampaign, updateCampaign } from "../services/campaign.server";
import prisma from "../db.server";
import { campaignLevelTemplate } from "../services/campaign-level-template";

const IST_OFFSET = "+05:30";

function toIstDateTimeInput(value: Date) {
  return new Date(value.getTime() + 330 * 60_000).toISOString().slice(0, 16);
}

function parseIstDateTime(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return new Date(NaN);
  return new Date(`${value}:00${IST_OFFSET}`);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const campaign = await prisma.campaign.findFirst({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" }
  });

  return {
    campaign: campaign
      ? {
          ...campaign,
          startDate: toIstDateTimeInput(campaign.startDate),
          endDate: toIstDateTimeInput(campaign.endDate),
        }
      : null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

  const intent = formData.get("intent");
  if (intent === "initialize") {
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + 9 * 24 * 60 * 60 * 1000);
    
    try {
      const newCampaign = await prisma.campaign.create({
        data: {
          shop: session.shop,
          name: "Navratri Challenge",
          slug: "navratri-challenge",
          description: "Complete 10 festive challenges, collect 1,000 points, and unlock exclusive rewards.",
          startDate,
          endDate,
          status: "draft",
          maxPoints: 1000,
        }
      });

      for (const level of campaignLevelTemplate) {
        await prisma.level.create({
          data: {
            campaignId: newCampaign.id,
            levelNumber: level.levelNumber,
            title: level.title,
            description: level.description,
            activityType: level.activityType,
            points: level.points,
            config: level.config,
            isActive: true,
          }
        });
      }
      return { success: true, message: "Campaign initialized successfully." };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to initialize campaign";
      return { success: false, error: message };
    }
  }

  const id = String(formData.get("id") || "");
  const name = String(formData.get("name") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const startDateStr = String(formData.get("startDate") || "");
  const endDateStr = String(formData.get("endDate") || "");
  const status = String(formData.get("status") || "active");
  const maxPoints = Number(formData.get("maxPoints")) || 1000;
  const unlockMode = String(formData.get("unlockMode") || "sequential");
  const unlockIntervalHours = Math.min(8760, Math.max(1, Number(formData.get("unlockIntervalHours")) || 24));

  if (!id) {
    return { success: false, error: "Campaign ID is required." };
  }

  if (!["sequential", "all_at_once", "after_submission", "timed_interval"].includes(unlockMode)) {
    return { success: false, error: "Choose a valid level unlock rule." };
  }

  if (!name) {
    return { success: false, error: "Campaign name cannot be empty." };
  }

  const startDate = parseIstDateTime(startDateStr);
  const endDate = parseIstDateTime(endDateStr);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return { success: false, error: "Please enter valid start and end dates and times." };
  }

  if (endDate <= startDate) {
    return { success: false, error: "End date must be after start date." };
  }

  try {
    const current = await prisma.campaign.findFirst({ where: { id, shop: session.shop } });
    if (!current) return { success: false, error: "Campaign not found for this store." };
    const scheduleChanged = startDate.getTime() !== current.startDate.getTime() || endDate.getTime() !== current.endDate.getTime();
    if (scheduleChanged) {
      const activeRewards = await prisma.reward.findMany({
        where: { campaignId: id, status: "issued", shopifyDiscountId: { not: null } },
        select: { shopifyDiscountId: true },
      });
      for (const reward of activeRewards) {
        if (!reward.shopifyDiscountId) continue;

        const discountId = reward.shopifyDiscountId;
        const lookupResponse = await admin.graphql(`#graphql
          query CampaignDiscountExists($id: ID!) {
            node(id: $id) { id }
          }
        `, { variables: { id: discountId } });
        const lookupPayload = await lookupResponse.json() as {
          data?: { node?: { id: string } | null };
          errors?: Array<{ message: string }>;
        };
        const lookupFailure = lookupPayload.errors?.[0]?.message;
        if (lookupFailure) throw new Error(`Could not check an existing campaign discount: ${lookupFailure}`);

        // The discount can be removed directly in Shopify while its ID remains
        // on the local reward record. In that case there is nothing to deactivate.
        if (!lookupPayload.data?.node) {
          console.info(`Campaign discount ${discountId} is already missing from Shopify; skipping deactivation.`);
          continue;
        }

        const response = await admin.graphql(`#graphql
          mutation DeactivateCampaignDiscount($id: ID!) {
            discountCodeDeactivate(id: $id) {
              userErrors { code message }
            }
          }
        `, { variables: { id: discountId } });
        const payload = await response.json() as {
          data?: { discountCodeDeactivate?: { userErrors?: Array<{ code?: string; message: string }> } };
          errors?: Array<{ message: string }>;
        };
        const failure = payload.errors?.[0]?.message || payload.data?.discountCodeDeactivate?.userErrors?.[0]?.message;
        if (failure && /code discount does not exist|discount does not exist/i.test(failure)) {
          console.info(`Campaign discount ${discountId} was removed during cleanup; continuing with the schedule update.`);
          continue;
        }
        if (failure) throw new Error(`Could not deactivate an existing campaign discount: ${failure}`);
      }
    }

    const result = await updateCampaign(id, {
      name,
      description,
      startDate,
      endDate,
      status,
      maxPoints,
      unlockMode,
      unlockIntervalHours,
    });
    const updated = result.campaign;

    return {
      success: true,
      pointsReset: result.pointsReset,
      campaign: {
        ...updated,
        startDate: toIstDateTimeInput(updated.startDate),
        endDate: toIstDateTimeInput(updated.endDate),
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update campaign";
    return { success: false, error: message };
  }
};

export default function CampaignPage() {
  const { campaign } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  const isSaving = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.success) {
      shopify.toast.show(
        (actionData as any).message || (actionData.pointsReset
          ? "New campaign schedule saved. Customer progress, submissions, points history, and campaign rewards have been reset."
          : "Campaign settings saved successfully!"),
      );
    } else if (actionData?.error) {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData, shopify]);

  if (!campaign) {
    return (
      <s-page heading="Campaign Settings">
        <s-section heading="No Active Campaign">
          <div style={{ padding: "32px", textAlign: "center", background: "#ffffff", borderRadius: "10px", border: "1px solid #e1e3e5" }}>
            <div style={{ fontSize: "16px", fontWeight: "bold", color: "#202223" }}>No campaign found</div>
            <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "4px" }}>Initialize a default campaign for your store to get started.</div>
            <Form method="post" style={{ marginTop: "16px" }}>
              <input type="hidden" name="intent" value="initialize" />
              <s-button type="submit" variant="primary" disabled={isSaving}>
                {isSaving ? "Initializing..." : "Initialize Campaign"}
              </s-button>
            </Form>
          </div>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Campaign Settings">
      {/* Header Overview Card */}
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "20px" }}>🪔</span>
              <span style={{ fontSize: "18px", fontWeight: "bold", color: "#202223" }}>{campaign.name}</span>
              <span
                style={{
                  background: campaign.status === "active" ? "#dcfce7" : "#fef3c7",
                  color: campaign.status === "active" ? "#166534" : "#92400e",
                  fontSize: "11px",
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: "10px",
                  textTransform: "uppercase",
                }}
              >
                {campaign.status}
              </span>
            </div>
            <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "4px" }}>
              Slug: <code style={{ background: "#f3f4f6", padding: "2px 6px", borderRadius: "4px" }}>{campaign.slug}</code> • Public URL: <code style={{ background: "#f3f4f6", padding: "2px 6px", borderRadius: "4px" }}>/campaigns/{campaign.slug}</code>
            </div>
          </div>
        </div>
      </div>

      <Form method="post">
        <input type="hidden" name="id" value={campaign.id} />

        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Section 1: Campaign Information */}
          <div
            style={{
              background: "#ffffff",
              borderRadius: "10px",
              padding: "24px",
              border: "1px solid #e1e3e5",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <div style={{ fontSize: "16px", fontWeight: "bold", color: "#202223", marginBottom: "4px" }}>
              1. Campaign Information
            </div>
            <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "16px" }}>
              Basic details displayed to customers on the challenge dashboard.
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
                  Campaign Name *
                </label>
                <input
                  type="text"
                  name="name"
                  defaultValue={campaign.name}
                  required
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: "6px",
                    border: "1px solid #d1d5db",
                    fontSize: "14px",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
                  Description / Marketing Tagline
                </label>
                <textarea
                  name="description"
                  defaultValue={campaign.description || ""}
                  rows={3}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: "6px",
                    border: "1px solid #d1d5db",
                    fontSize: "14px",
                    boxSizing: "border-box",
                    fontFamily: "inherit",
                  }}
                />
              </div>
            </div>
          </div>

          {/* Section 2: Campaign Schedule */}
          <div
            style={{
              background: "#ffffff",
              borderRadius: "10px",
              padding: "24px",
              border: "1px solid #e1e3e5",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <div style={{ fontSize: "16px", fontWeight: "bold", color: "#202223", marginBottom: "4px" }}>
              2. Campaign Schedule
            </div>
            <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "16px" }}>
              Choose the start and end date and time (India Standard Time). Saving a changed schedule resets customer points, completed level progress, and points history.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
                  Start Date & Time (IST) *
                </label>
                <input
                  type="datetime-local"
                  name="startDate"
                  defaultValue={campaign.startDate}
                  required
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: "6px",
                    border: "1px solid #d1d5db",
                    fontSize: "14px",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
                  End Date & Time (IST) *
                </label>
                <input
                  type="datetime-local"
                  name="endDate"
                  defaultValue={campaign.endDate}
                  required
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: "6px",
                    border: "1px solid #d1d5db",
                    fontSize: "14px",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>
          </div>

          <div style={{ background: "#ffffff", borderRadius: "10px", padding: "24px", border: "1px solid #e1e3e5", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <div style={{ fontSize: "16px", fontWeight: "bold", color: "#202223", marginBottom: "4px" }}>Level Unlocking</div>
            <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "16px" }}>Choose how customers unlock campaign levels. “After submission” counts a photo or text entry while it is awaiting review.</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
              <label style={{ display: "grid", gap: "6px", fontSize: "13px", fontWeight: 600, color: "#374151" }}>
                Unlock rule
                <select name="unlockMode" defaultValue={campaign.unlockMode || "sequential"} style={{ width: "100%", padding: "10px 12px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "14px" }}>
                  <option value="sequential">Sequential daily (current behavior)</option>
                  <option value="all_at_once">All levels at campaign start</option>
                  <option value="after_submission">Unlock next after submission</option>
                  <option value="timed_interval">Unlock on a time interval</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: "6px", fontSize: "13px", fontWeight: 600, color: "#374151" }}>
                Hours between levels (timed rule)
                <input type="number" name="unlockIntervalHours" min={1} max={8760} step={1} defaultValue={campaign.unlockIntervalHours || 24} style={{ width: "100%", padding: "10px 12px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "14px", boxSizing: "border-box" }} />
              </label>
            </div>
          </div>
          {/* Section 3: Campaign Rules & Rewards Settings */}
          <div
            style={{
              background: "#ffffff",
              borderRadius: "10px",
              padding: "24px",
              border: "1px solid #e1e3e5",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <div style={{ fontSize: "16px", fontWeight: "bold", color: "#202223", marginBottom: "4px" }}>
              3. Campaign Rules & Gamification Points
            </div>
            <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "16px" }}>
              Target thresholds and qualifying points structure.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
                  Maximum Target Points
                </label>
                <input
                  type="number"
                  name="maxPoints"
                  defaultValue={campaign.maxPoints}
                  min={100}
                  max={10000}
                  step={50}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: "6px",
                    border: "1px solid #d1d5db",
                    fontSize: "14px",
                    boxSizing: "border-box",
                  }}
                />
                <span style={{ fontSize: "11px", color: "#6b7280", marginTop: "4px", display: "block" }}>
                  Default: 1,000 points (10 levels total)
                </span>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
                  Eligibility Threshold
                </label>
                <input
                  type="number"
                  disabled
                  value={1000}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: "6px",
                    border: "1px solid #e5e7eb",
                    background: "#f9fafb",
                    color: "#6b7280",
                    fontSize: "14px",
                    boxSizing: "border-box",
                  }}
                />
                <span style={{ fontSize: "11px", color: "#6b7280", marginTop: "4px", display: "block" }}>
                  Points required to qualify for reward
                </span>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
                  Referral Bonus Points
                </label>
                <input
                  type="number"
                  disabled
                  value={100}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: "6px",
                    border: "1px solid #e5e7eb",
                    background: "#f9fafb",
                    color: "#6b7280",
                    fontSize: "14px",
                    boxSizing: "border-box",
                  }}
                />
                <span style={{ fontSize: "11px", color: "#6b7280", marginTop: "4px", display: "block" }}>
                  Bonus points awarded upon referral qualification
                </span>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
                  Top Winner Count
                </label>
                <input
                  type="number"
                  disabled
                  value={25}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: "6px",
                    border: "1px solid #e5e7eb",
                    background: "#f9fafb",
                    color: "#6b7280",
                    fontSize: "14px",
                    boxSizing: "border-box",
                  }}
                />
                <span style={{ fontSize: "11px", color: "#6b7280", marginTop: "4px", display: "block" }}>
                  Finalized Top 25 leaderboard participants
                </span>
              </div>
            </div>
          </div>

          {/* Section 4: Campaign Status */}
          <div
            style={{
              background: "#ffffff",
              borderRadius: "10px",
              padding: "24px",
              border: "1px solid #e1e3e5",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <div style={{ fontSize: "16px", fontWeight: "bold", color: "#202223", marginBottom: "4px" }}>
              4. Campaign Lifecycle Status
            </div>
            <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "16px" }}>
              Control whether the campaign is open to customer participation.
            </div>

            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
              {["active", "paused", "draft", "completed"].map((st) => (
                <label
                  key={st}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "12px 16px",
                    borderRadius: "8px",
                    border: campaign.status === st ? "2px solid #059669" : "1px solid #d1d5db",
                    background: campaign.status === st ? "#f0fdf4" : "#ffffff",
                    cursor: "pointer",
                    fontSize: "14px",
                    fontWeight: 600,
                    textTransform: "capitalize",
                    color: campaign.status === st ? "#065f46" : "#374151",
                  }}
                >
                  <input
                    type="radio"
                    name="status"
                    value={st}
                    defaultChecked={campaign.status === st}
                    style={{ accentColor: "#059669" }}
                  />
                  {st}
                </label>
              ))}
            </div>
          </div>

          {/* Action Save Button Bar */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "12px",
              padding: "16px 0",
            }}
          >
            <s-button type="submit" variant="primary" disabled={isSaving}>
              {isSaving ? "Saving Settings..." : "Save Campaign Settings"}
            </s-button>
          </div>
        </div>
      </Form>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
