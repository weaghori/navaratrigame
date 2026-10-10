import { createHmac, timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getCampaignBySlug, getCampaignTimeStatus } from "../services/campaign.server";
import { completeSpecialActivity, recordMovieGuessAttempt } from "../services/special-activity.server";
import { tryCompleteReadyPurchaseForCustomer } from "../services/purchase.server";

function getSignedCustomerId(params: URL | URLSearchParams) {
  const search = params instanceof URL ? params.searchParams : params;
  const customerId = search.get("customer_id_from_liquid")?.trim();
  const signature = search.get("customer_sig")?.trim();
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!customerId || !signature || !secret) return null;
  const expected = createHmac("sha256", secret).update(customerId).digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(signature, "utf8");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
    ? customerId
    : null;
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

  const json = (body: Record<string, unknown>, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": "no-store", ...corsHeaders } });
  if (request.method !== "POST") return json({ success: false, error: "Method not allowed." }, 405);

  const url = new URL(request.url);
  let customerId: string | null = null;
  let isProxyRequest = false;
  let shopDomain = url.searchParams.get("shop") || undefined;
  try {
    const { session } = await authenticate.public.appProxy(request);
    isProxyRequest = true;
    shopDomain = (session as unknown as Record<string, unknown> | undefined)?.shop as string | undefined || shopDomain;
    customerId = url.searchParams.get("logged_in_customer_id")?.trim() || null;
    if (!customerId && session) {
      const access = (session as unknown as Record<string, unknown>).onlineAccessInfo as
        | { associated_user?: { id?: number | string } } | undefined;
      if (access?.associated_user?.id) customerId = String(access.associated_user.id);
    }
  } catch {
    // A verified Liquid customer signature can authenticate requests outside the app proxy.
  }

  customerId ||= getSignedCustomerId(url);
  try {
    const form = await request.formData();
    const formIdentity = new URLSearchParams({
      customer_id_from_liquid: String(form.get("customer_id_from_liquid") || ""),
      customer_sig: String(form.get("customer_sig") || ""),
    });
    customerId ||= getSignedCustomerId(formIdentity);
    shopDomain ||= String(form.get("shop") || "") || undefined;
    customerId ||= process.env.NODE_ENV === "development" && !isProxyRequest
      ? String(form.get("customerId") || "").trim() || null
      : null;
    if (!customerId) return json({ success: false, error: "Please log in with your store account to submit this challenge." }, 401);

    const campaign = await getCampaignBySlug(params.slug || "", shopDomain);
    if (!campaign) return json({ success: false, error: "Campaign not found." }, 404);
    if (getCampaignTimeStatus(campaign) !== "ACTIVE") {
      return json({ success: false, error: "This campaign is not active." }, 400);
    }
    const levelId = String(form.get("levelId") || "");
    const activityType = String(form.get("activityType") || "");
    if (!levelId || !["memory_game", "movie_guess", "audio_guess", "purchase_check"].includes(activityType)) {
      return json({ success: false, error: "Invalid game completion request." }, 400);
    }

    if (activityType === "purchase_check") {
      if (!shopDomain) {
        return json({ success: false, error: "Cannot verify purchases outside a Shopify context." }, 400);
      }
      const { checkAndRecordRecentOrders } = await import("../services/purchase.server");
      const verified = await checkAndRecordRecentOrders(shopDomain, customerId, campaign.id);
      if (!verified) {
        return json({ success: false, error: "We could not find an eligible paid order. If you just ordered, it may take a minute to process." });
      }
      // If verified, it will have created the point transaction.
      // We can fetch the updated progress.
      const prisma = (await import("../db.server")).default;
      const progress = await prisma.customerProgress.findUnique({
        where: { campaignId_shopifyCustomerId: { campaignId: campaign.id, shopifyCustomerId: customerId } },
      });
      const level = await prisma.level.findUnique({ where: { id: levelId } });
      return json({
        success: true,
        outcome: "points_awarded",
        pointsAwarded: level?.points || 0,
        completedLevelId: levelId,
        completedLevelNumber: 9,
        progressSummary: progress ? {
          totalPoints: progress.totalPoints,
          currentLevel: progress.currentLevel,
          status: progress.status,
          eligibleAt: progress.eligibleAt?.toISOString() || null,
        } : undefined,
        message: "Purchase verified successfully! Points awarded.",
      });
    }

    if (activityType === "movie_guess") {
      const guessAttempt = await recordMovieGuessAttempt({
        campaignId: campaign.id,
        levelId,
        shopifyCustomerId: customerId,
        answer: String(form.get("answer") || ""),
      });
      if (!guessAttempt.isCorrect) {
        return json({
          success: true,
          isCorrect: false,
          attemptsUsed: guessAttempt.attemptsUsed,
          attemptsRemaining: guessAttempt.attemptsRemaining,
          error: guessAttempt.exhausted
            ? "No guesses remaining. You used all 3 attempts."
            : `Wrong movie name. ${guessAttempt.attemptsRemaining} guess${guessAttempt.attemptsRemaining === 1 ? "" : "es"} remaining.`,
        });
      }
    }

    let result;
    try {
      result = await completeSpecialActivity({
        campaignId: campaign.id,
        levelId,
        shopifyCustomerId: customerId,
        answer: String(form.get("answer") || ""),
        attempts: Number(form.get("attempts")) || undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The answer could not be checked.";
      if (activityType === "audio_guess" && message === "That answer is not correct. Try again.") {
        return json({ success: true, isCorrect: false, error: "That tune is not correct. Check the song name and try again." });
      }
      throw error;
    }
    if (result.levelNumber === 8) await tryCompleteReadyPurchaseForCustomer(campaign.id, customerId);

    const { autoIssueRewardIfEligible } = await import("../services/reward.server");
    const reward = shopDomain ? await autoIssueRewardIfEligible(campaign.id, customerId, shopDomain) : null;

    return json({
      success: true,
      isCorrect: ["movie_guess", "audio_guess"].includes(activityType) ? true : undefined,
      outcome: "points_awarded",
      pointsAwarded: result.pointsAwarded,
      completedLevelId: levelId,
      completedLevelNumber: result.levelNumber,
      progressSummary: {
        totalPoints: result.progress.totalPoints,
        currentLevel: result.progress.currentLevel,
        status: result.progress.status,
        eligibleAt: result.progress.eligibleAt?.toISOString() || null,
      },
      prizeLabel: reward ? `${reward.rewardValue}% OFF` : undefined,
      discountPercent: reward?.rewardValue,
      discountCode: reward?.discountCode,
      message: `Challenge complete! +${result.pointsAwarded} points added.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Challenge could not be completed.";
    console.error("Special-activity submission failed:", message);
    return json({ success: false, error: message }, 400);
  }
};
