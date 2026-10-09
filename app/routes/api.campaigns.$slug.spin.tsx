import { timingSafeEqual, createHmac } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { getCampaignBySlug, getCampaignTimeStatus } from "../services/campaign.server";
import { completeSpecialActivity, prepareWheelSpin } from "../services/special-activity.server";
import { tryCompleteReadyPurchaseForCustomer } from "../services/purchase.server";
import type { WheelDiscountAdminClient } from "../services/reward.server";
import { authenticate, unauthenticated } from "../shopify.server";

function getSignedCustomerId(url: URL | URLSearchParams) {
  const params = url instanceof URL ? url.searchParams : url;
  const customerId = params.get("customer_id_from_liquid")?.trim();
  const signature = params.get("customer_sig")?.trim();
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

  if (request.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }

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
      const accessInfo = (session as unknown as Record<string, unknown>).onlineAccessInfo as
        | { associated_user?: { id?: number | string } }
        | undefined;
      if (accessInfo?.associated_user?.id) customerId = String(accessInfo.associated_user.id);
    }
  } catch {
    // Allow the signed Liquid customer bridge below when the proxy context is unavailable.
  }

  customerId ||= getSignedCustomerId(url);

  try {
    const formData = await request.formData();
    const formIdentity = new URLSearchParams({
      customer_id_from_liquid: String(formData.get("customer_id_from_liquid") || ""),
      customer_sig: String(formData.get("customer_sig") || ""),
    });
    customerId ||= getSignedCustomerId(formIdentity);
    shopDomain ||= String(formData.get("shop") || "") || undefined;
    const campaign = await getCampaignBySlug(params.slug || "", shopDomain);
    if (!campaign) return Response.json({ success: false, error: "Campaign not found." }, { status: 404 });
    if (getCampaignTimeStatus(campaign) !== "ACTIVE") {
      return Response.json({ success: false, error: "This campaign is not active." }, { status: 400 });
    }

    const formCustomerId = String(formData.get("customerId") || "").trim();
    customerId ||= process.env.NODE_ENV === "development" && !isProxyRequest ? formCustomerId : null;
    if (!customerId) {
      return Response.json({ success: false, error: "Please log in with your store account before spinning." }, { status: 401 });
    }

    const levelId = String(formData.get("levelId") || "");
    const actionType = String(formData.get("actionType") || "");
    if (!levelId) return Response.json({ success: false, error: "Missing challenge level." }, { status: 400 });

    if (actionType === "prepare_spin") {
      const spinPrize = await prepareWheelSpin({ campaignId: campaign.id, levelId, shopifyCustomerId: customerId });
      return Response.json({ success: true, outcome: "spin_prepared", spinPrize }, { headers: { "Cache-Control": "no-store" } });
    }

    if (actionType === "complete_activity" && String(formData.get("activityType") || "") === "spin_wheel") {
      const adminContext = await unauthenticated.admin(campaign.shop);
      const result = await completeSpecialActivity({
        campaignId: campaign.id,
        levelId,
        shopifyCustomerId: customerId,
        adminGraphqlClient: adminContext.admin as unknown as WheelDiscountAdminClient,
        spinAttemptToken: String(formData.get("spinAttemptToken") || "") || undefined,
      });
      if (result.levelNumber === 8) await tryCompleteReadyPurchaseForCustomer(campaign.id, customerId);
      return Response.json({
        success: true,
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
        prizeLabel: result.reward,
        discountPercent: result.discountPercent,
        discountCode: result.discountCode,
        useNowUrl: result.discountCode
          ? `https://aghoristore.com/discount/${encodeURIComponent(result.discountCode)}?redirect=%2Fcollections%2Fall`
          : undefined,
        offerMessage: result.offerMessage,
        message: result.reward
          ? `🎉 You won ${result.reward}!${result.discountCode ? ` Your one-use code is ${result.discountCode}.` : ""} +${result.pointsAwarded} points added.`
          : `🎉 Challenge complete! +${result.pointsAwarded} points added.`,
      }, { headers: { "Cache-Control": "no-store" } });
    }

    return Response.json({ success: false, error: "Invalid Spin & Win request." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The spin could not be completed. Please try again.";
    console.error("Spin & Win request failed:", message);
    return Response.json({ success: false, error: message }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
};
