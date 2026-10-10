import type { ActionFunctionArgs } from "react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getCampaignBySlug } from "../services/campaign.server";
import {
  processQuizSubmission,
  processTextSubmission,
} from "../services/submission.server";
import { limitRequestBody } from "../utils/request-body-limit.server";
import { authenticate } from "../shopify.server";

const MAX_REQUEST_BYTES = 1 * 1024 * 1024;

function getSignedLiquidCustomerId(url: URL | URLSearchParams) {
  const params = url instanceof URL ? url.searchParams : url;
  const customerId = params.get("customer_id_from_liquid")?.trim();
  const signature = params.get("customer_sig")?.trim();
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!customerId || !signature || !secret) return null;
  const expected = createHmac("sha256", secret).update(customerId).digest();
  const actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? customerId : null;
}

export const loader = async ({ request }: ActionFunctionArgs) => {
  const requestOrigin = request.headers.get("Origin") || "";
  const secureStorefrontOrigin = /^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(requestOrigin);
  const corsHeaders = secureStorefrontOrigin ? {
    "Access-Control-Allow-Origin": requestOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  } : undefined;

  if (request.method === "OPTIONS") {
    if (!secureStorefrontOrigin || !corsHeaders) {
      return new Response(null, { status: 403 });
    }
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  return new Response("Method not allowed", { status: 405 });
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const { slug } = params;
  const url = new URL(request.url);
  const requestOrigin = request.headers.get("Origin") || "";
  const secureStorefrontOrigin = /^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(requestOrigin);
  const corsHeaders = secureStorefrontOrigin ? {
    "Access-Control-Allow-Origin": requestOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  } : undefined;

  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: corsHeaders });

  if (request.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }

  const contentType = request.headers.get("Content-Type") || "";
  const bodyGuard = limitRequestBody(request, MAX_REQUEST_BYTES);
  if (bodyGuard.tooLarge) {
    return json({ success: false, error: "Request is too large. Upload images directly to the media endpoint." }, 413);
  }
  const guardedRequest = bodyGuard.request;

  // Check for App Proxy authenticated customer ID and shop domain
  let authenticatedCustomerId: string | null = null;
  let shopDomain: string | undefined;

  try {
    const { session } = await authenticate.public.appProxy(guardedRequest);
    shopDomain = (session as unknown as Record<string, unknown>)?.shop as string | undefined;
    const proxyCustomerId = url.searchParams.get("logged_in_customer_id");
    if (proxyCustomerId && proxyCustomerId.trim() !== "") {
      authenticatedCustomerId = proxyCustomerId.trim();
    } else if (session) {
      const accessInfo = (session as unknown as Record<string, unknown>).onlineAccessInfo as
        | { associated_user?: { id?: number | string } }
        | undefined;
      if (accessInfo?.associated_user?.id) {
        authenticatedCustomerId = String(accessInfo.associated_user.id);
      }
    }
  } catch {
    // Direct upload calls use the HMAC-signed customer bridge from the campaign page.
  }
  authenticatedCustomerId ||= getSignedLiquidCustomerId(url);

  if (!shopDomain) {
    shopDomain = url.searchParams.get("shop") || undefined;
  }

  const campaign = await getCampaignBySlug(slug || "", shopDomain);

  if (!campaign) {
    return json({ success: false, error: "Campaign not found" }, 404);
  }

  if (campaign.status !== "active") {
    return json({ success: false, error: "Campaign is not currently active" }, 400);
  }

  const isDev = process.env.NODE_ENV === "development";
  try {
    if (contentType.includes("application/json")) {
      const body = await guardedRequest.json();
      const { activityType, levelId, customerId: bodyCustomerId, selectedOption, textResponse } = body;
      const customerId = authenticatedCustomerId || (isDev ? bodyCustomerId : null);

      if (!levelId || !customerId) {
        return json(
          { success: false, error: "Authenticated customer ID required. Please log in to participate." },
          401,
        );
      }

      if (activityType === "quiz") {
        const result = await processQuizSubmission({
          campaignId: campaign.id,
          levelId,
          shopifyCustomerId: customerId,
          selectedOption,
        });
        return json({
          success: true,
          outcome: result.success ? "points_awarded" : "quiz_partial",
          pointsAwarded: result.pointsAwarded,
          quizPointsTotal: result.quizPointsTotal,
          correctCount: result.correctCount,
          totalCorrect: result.totalCorrect,
          completedLevelId: result.success ? result.level.id : undefined,
          completedLevelNumber: result.success ? result.level.levelNumber : undefined,
          progressSummary: {
            totalPoints: result.progress.totalPoints,
            currentLevel: result.progress.currentLevel,
            status: result.progress.status,
            eligibleAt: result.progress.eligibleAt?.toISOString() || null,
          },
          message: result.message,
        });
      }

      if (activityType === "text_submission") {
        const result = await processTextSubmission({
          campaignId: campaign.id,
          levelId,
          shopifyCustomerId: customerId,
          textResponse,
        });
        const approved = result.status === "approved" && "progress" in result && "pointsAwarded" in result;
        const { autoIssueRewardIfEligible } = await import("../services/reward.server");
        const reward = approved && shopDomain ? await autoIssueRewardIfEligible(campaign.id, customerId, shopDomain) : null;
        
        return json({
          success: true,
          outcome: approved
            ? result.pointsAwarded > 0 ? "points_awarded" : "feedback_submitted"
            : "pending_review",
          pointsAwarded: approved ? result.pointsAwarded : undefined,
          completedLevelId: approved ? levelId : undefined,
          completedLevelNumber: approved && "level" in result ? result.level.levelNumber : undefined,
          progressSummary: approved ? {
            totalPoints: result.progress.totalPoints,
            currentLevel: result.progress.currentLevel,
            status: result.progress.status,
            eligibleAt: result.progress.eligibleAt?.toISOString() || null,
          } : undefined,
          prizeLabel: reward ? `${reward.rewardValue}% OFF` : undefined,
          discountPercent: reward?.rewardValue,
          discountCode: reward?.discountCode,
          useNowUrl: reward?.discountCode
            ? `https://aghoristore.com/discount/${encodeURIComponent(reward.discountCode)}?redirect=%2Fcollections%2Fall`
            : undefined,
          message: result.message,
        });
      }

      return json({ success: false, error: "Unsupported activity type for JSON payload" }, 400);
    }

    if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await guardedRequest.formData();
      const formIdentity = new URLSearchParams({
        customer_id_from_liquid: String(formData.get("customer_id_from_liquid") || ""),
        customer_sig: String(formData.get("customer_sig") || ""),
      });
      authenticatedCustomerId ||= getSignedLiquidCustomerId(formIdentity);
      const levelId = String(formData.get("levelId") || "");
      const formCustomerId = String(formData.get("customerId") || "");
      const customerId = authenticatedCustomerId || (isDev ? formCustomerId : null);
      const activityType = String(formData.get("activityType") || "");
      const selectedOption = String(formData.get("selectedOption") || "");
      const file = formData.get("file") as File | null;
      const textResponse = String(formData.get("textResponse") || "").trim();

      if (!levelId || !customerId || !activityType) {
        return json({ success: false, error: "Missing required form fields" }, 400);
      }

      if (activityType === "quiz") {
        const result = await processQuizSubmission({
          campaignId: campaign.id,
          levelId,
          shopifyCustomerId: customerId,
          selectedOption,
        });
        const { autoIssueRewardIfEligible } = await import("../services/reward.server");
        const reward = shopDomain ? await autoIssueRewardIfEligible(campaign.id, customerId, shopDomain) : null;

        return json({
          success: true,
          outcome: result.success ? "points_awarded" : "quiz_partial",
          pointsAwarded: result.pointsAwarded,
          quizPointsTotal: result.quizPointsTotal,
          correctCount: result.correctCount,
          totalCorrect: result.totalCorrect,
          completedLevelId: result.success ? result.level.id : undefined,
          completedLevelNumber: result.success ? result.level.levelNumber : undefined,
          progressSummary: {
            totalPoints: result.progress.totalPoints,
            currentLevel: result.progress.currentLevel,
            status: result.progress.status,
            eligibleAt: result.progress.eligibleAt?.toISOString() || null,
          },
          prizeLabel: reward ? `${reward.rewardValue}% OFF` : undefined,
          discountPercent: reward?.rewardValue,
          discountCode: reward?.discountCode,
          useNowUrl: reward?.discountCode
            ? `https://aghoristore.com/discount/${encodeURIComponent(reward.discountCode)}?redirect=%2Fcollections%2Fall`
            : undefined,
          message: result.message,
        });
      }

      if (activityType === "text_submission") {
        const result = await processTextSubmission({
          campaignId: campaign.id,
          levelId,
          shopifyCustomerId: customerId,
          textResponse,
        });
        const approved = result.status === "approved" && "progress" in result && "pointsAwarded" in result;
        const { autoIssueRewardIfEligible } = await import("../services/reward.server");
        const reward = approved && shopDomain ? await autoIssueRewardIfEligible(campaign.id, customerId, shopDomain) : null;

        return json({
          success: true,
          outcome: approved
            ? result.pointsAwarded > 0 ? "points_awarded" : "feedback_submitted"
            : "pending_review",
          pointsAwarded: approved ? result.pointsAwarded : undefined,
          completedLevelId: approved ? levelId : undefined,
          completedLevelNumber: approved && "level" in result ? result.level.levelNumber : undefined,
          progressSummary: approved ? {
            totalPoints: result.progress.totalPoints,
            currentLevel: result.progress.currentLevel,
            status: result.progress.status,
            eligibleAt: result.progress.eligibleAt?.toISOString() || null,
          } : undefined,
          prizeLabel: reward ? `${reward.rewardValue}% OFF` : undefined,
          discountPercent: reward?.rewardValue,
          discountCode: reward?.discountCode,
          useNowUrl: reward?.discountCode
            ? `https://aghoristore.com/discount/${encodeURIComponent(reward.discountCode)}?redirect=%2Fcollections%2Fall`
            : undefined,
          message: result.message,
        });
      }

      if (activityType === "photo_upload" || (activityType === "final_submission" && file && file.size > 0)) {
        return json({ success: false, error: "Image uploads must use the secure direct-to-R2 upload flow." }, 400);
      }

      return json({ success: false, error: "Invalid activity type" }, 400);
    }

    return json({ success: false, error: "Unsupported content type" }, 415);
  } catch (err: unknown) {
    if (bodyGuard.wasExceeded()) {
      return json({ success: false, error: "Request is too large." }, 413);
    }
    const msg = err instanceof Error ? err.message : "Internal server error";
    return json({ success: false, error: msg }, 400);
  }
};
