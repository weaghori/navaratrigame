import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import crypto from "crypto";
import prisma from "../db.server";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction, LinksFunction, ShouldRevalidateFunctionArgs, HeadersFunction } from "react-router";
import { useActionData, useFetcher, useLoaderData, useNavigation, useSubmit, useRouteError, Form } from "react-router";
import { AppProxyProvider } from "@shopify/shopify-app-react-router/react";
import { getCampaignBySlug, getCampaignTimeStatus } from "../services/campaign.server";
import { aggregateQuizTransactions, getCustomerLevelProgress, getCustomerPointHistory } from "../services/customer.server";
import {
  processQuizSubmission,
  processTextSubmission,
} from "../services/submission.server";
import { getPublicLeaderboard } from "../services/leaderboard.server";
import { getCustomerReward } from "../services/reward.server";
import { completeSpecialActivity, prepareWheelSpin, recordMovieGuessAttempt } from "../services/special-activity.server";
import { tryCompleteReadyPurchaseForCustomer } from "../services/purchase.server";
import { campaignLevelTemplate } from "../services/campaign-level-template";
import { QuizActivity, type QuizConfig } from "../components/activities/QuizActivity";
import { PhotoUploadActivity, type PhotoConfig } from "../components/activities/PhotoUploadActivity";
import { TextSubmissionActivity, type TextConfig } from "../components/activities/TextSubmissionActivity";
import { FinalSubmissionActivity, type FinalConfig } from "../components/activities/FinalSubmissionActivity";
import { SpecialActivity } from "../components/activities/SpecialActivities";
import { LeaderboardSection } from "../components/LeaderboardSection";
import lockImage from "../styles/lock.webp";
// Temporarily disabled; uncomment these imports and the render block below to restore the side videos.
// import dancerVideoV1 from "../styles/v1.gif";
// import dancerVideoV2 from "../styles/v2.gif";

import {
  LotusOrnament,
  KalashArtwork,
  MysteryMandalaPattern,
  CardCornerDecor,
  ActiveCardSideDecor,
} from "../components/NavratriGraphics";

import navratriGameStyles from "../styles/navratri-game.css?url";
import "../styles/navratri-game.css";
import { authenticate, unauthenticated } from "../shopify.server";
import { limitRequestBody } from "../utils/request-body-limit.server";
import type { WheelDiscountAdminClient } from "../services/reward.server";
import { getLoginUrl, getLogoutUrl } from "../config/urls";
import { WinnerPopupModal } from "../components/WinnerPopupModal";

type LevelWithChallengeCopy = {
  levelNumber: number;
  title: string;
  description: string | null;
  activityType: string;
  config: unknown;
  state?: string;
};

function applyLevelChallengeCopy<T extends LevelWithChallengeCopy>(level: T): T {
  if (level.activityType === "locked" || level.state === "LOCKED") return level;
  const template = campaignLevelTemplate.find((item) => item.levelNumber === level.levelNumber);
  if (!template) return level;

  const templateConfig = template.config as Record<string, unknown>;
  const currentConfig = level.config && typeof level.config === "object" && !Array.isArray(level.config)
    ? level.config as Record<string, unknown>
    : {};
  const nextConfig = { ...currentConfig };
  for (const key of ["sectionTitle", "tagline", "steps", "requirement", "instructions", "hideActivityInstructions"]) {
    if (Object.prototype.hasOwnProperty.call(currentConfig, key) && currentConfig[key] !== "") {
      nextConfig[key] = currentConfig[key];
    } else if (Object.prototype.hasOwnProperty.call(templateConfig, key)) {
      nextConfig[key] = templateConfig[key];
    } else if (key === "hideActivityInstructions") {
      delete nextConfig[key];
    }
  }

  return { ...level, title: level.title || template.title, description: level.description || template.description, config: nextConfig };
}

function sanitizeClientLevel<T extends LevelWithChallengeCopy & {
  id: string;
  levelNumber: number;
  points: number;
  movieGuessAttemptsUsed?: number;
  state?: string;
  title: string;
  description?: string | null;
  activityType: string;
  config?: unknown;
  isActive?: boolean;
  availableFrom?: string;
}>(
  l: T,
  proxyBasePath: string,
  currentAvailableLevel: number,
  campaignSlug: string,
  campaignShop?: string
): T {
  const isLocked = l.state === "LOCKED" || (l.levelNumber > currentAvailableLevel && l.state !== "COMPLETED" && l.state !== "PENDING" && l.state !== "REJECTED");
  const template = campaignLevelTemplate.find((item) => item.levelNumber === l.levelNumber);
  let safeConfig: unknown = l.config;
  if (safeConfig && typeof safeConfig === "object" && !Array.isArray(safeConfig)) {
    const sanitized = { ...(safeConfig as Record<string, unknown>) };
    if (l.activityType === "quiz") {
      delete sanitized.correctOption;
      if (Array.isArray(sanitized.questions)) {
        sanitized.questions = sanitized.questions.map((question) => {
          if (!question || typeof question !== "object" || Array.isArray(question)) return question;
          const safeQuestion = { ...(question as Record<string, unknown>) };
          delete safeQuestion.answer;
          delete safeQuestion.correctAnswer;
          return safeQuestion;
        });
      }
    }
    if (l.activityType === "movie_guess" || l.activityType === "audio_guess") {
      delete sanitized.answer;
      delete sanitized.acceptedAnswers;
    }
    for (const mediaField of ["audioUrl", "imageUrl", "productImageUrl"]) {
      const mediaReference = sanitized[mediaField];
      if (typeof mediaReference !== "string") continue;
      if (mediaReference.startsWith("r2:")) {
        let key: string | null = null;
        try {
          key = new URL(mediaReference.slice(3), "https://media.invalid").searchParams.get("key");
        } catch {
          if (mediaReference.includes("key=")) key = mediaReference.split("key=")[1];
        }
        if (key) {
          const baseUrl = process.env.SHOPIFY_APP_URL || "";
          sanitized[mediaField] = `${baseUrl}/api/media?key=${encodeURIComponent(key)}`;
        }
      } else if (mediaReference.startsWith("/api/media?")) {
        const baseUrl = process.env.SHOPIFY_APP_URL || "";
        sanitized[mediaField] = `${baseUrl}${mediaReference}`;
      }
    }
    if (l.activityType === "audio_guess" && typeof sanitized.audioUrl === "string") {
      if (sanitized.audioUrl.includes("/storage/v1/object/")) {
        sanitized.audioUrl = `${proxyBasePath}/api/campaigns/${encodeURIComponent(campaignSlug)}/audio?levelId=${encodeURIComponent(l.id)}${campaignShop ? `&shop=${encodeURIComponent(campaignShop)}` : ""}`;
      }
    }
    safeConfig = sanitized;
  }
  return applyLevelChallengeCopy({
    ...l,
    title: isLocked ? "Surprise Challenge" : l.title || template?.title || "",
    description: isLocked ? null : l.description || template?.description || "",
    activityType: isLocked ? "locked" : l.activityType,
    config: isLocked ? null : safeConfig,
  });
}

function getSignedLiquidCustomerId(url: URL | URLSearchParams): string | null {
  const params = url instanceof URL ? url.searchParams : url;
  const customerId = params.get("customer_id_from_liquid")?.trim();
  const signature = params.get("customer_sig")?.trim();
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!customerId || !signature || !secret) return null;

  const expected = crypto.createHmac("sha256", secret).update(customerId).digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const signatureBuffer = Buffer.from(signature, "utf8");
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null;
  return customerId;
}

function getSignedLiquidDisplayName(url: URL, expectedCustomerId: string | null): string | null {
  const customerId = url.searchParams.get("customer_id_from_liquid")?.trim();
  const displayName = url.searchParams.get("customer_display_name")?.trim().slice(0, 120);
  const signature = url.searchParams.get("customer_identity_sig")?.trim();
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!customerId || customerId !== expectedCustomerId || !displayName || !signature || !secret) return null;
  const expected = crypto.createHmac("sha256", secret).update(`${customerId}|${displayName}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const signatureBuffer = Buffer.from(signature, "utf8");
  return signatureBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ? displayName
    : null;
}

function getSignedLiquidCustomerIdentifier(url: URL, expectedCustomerId: string | null): string | null {
  const customerId = url.searchParams.get("customer_id_from_liquid")?.trim();
  const identifier = url.searchParams.get("customer_identifier")?.trim().slice(0, 320);
  const signature = url.searchParams.get("customer_identifier_sig")?.trim();
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!customerId || customerId !== expectedCustomerId || !identifier || !signature || !secret) return null;
  const expected = crypto.createHmac("sha256", secret).update(`${customerId}|${identifier}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const signatureBuffer = Buffer.from(signature, "utf8");
  return signatureBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ? identifier
    : null;
}
function createCustomerBridge(customerId: string) {
  const secret = process.env.SHOPIFY_API_SECRET;
  return secret
    ? { customerId, signature: crypto.createHmac("sha256", secret).update(customerId).digest("hex") }
    : null;
}

export const links: LinksFunction = () => {
  return [
    {
      rel: "stylesheet",
      href: new URL(navratriGameStyles, __APP_ASSET_BASE__).toString(),
    },
  ];
};

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  return [
    { title: data?.campaign ? `${data.campaign.name} | Navratri Gamification Challenge` : "Navratri 2026 Challenge" },
    {
      name: "description",
      content: "Complete 10 Navratri challenges, collect 1000 points, and unlock festive rewards!",
    },
  ];
};

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { slug } = params;
  const url = new URL(request.url);

  if (!slug) {
    throw new Response("Campaign slug missing", { status: 400 });
  }

  // 1. Check for Shopify App Proxy authenticated customer ID.
  let customerId: string | null = null;
  let isProxyRequest = false;
  let shopDomain: string | undefined;
  let proxyAdmin: any = null;
  try {
    const proxyAuth = await authenticate.public.appProxy(request);
    const { session } = proxyAuth;
    proxyAdmin = (proxyAuth as unknown as Record<string, unknown>).admin as typeof proxyAdmin ?? null;
    isProxyRequest = true; // proxy auth succeeded → request came from Shopify
    // Extract shop domain from proxy session for multi-store isolation
    shopDomain = (session as unknown as Record<string, unknown> | undefined)?.shop as string | undefined
      || url.searchParams.get("shop")
      || undefined;

    // Shopify natively passes logged_in_customer_id for authenticated customers.
    // We do NOT do a Liquid bounce redirect — it causes "error in third-party application"
    // because Shopify App Proxy strips custom query params, creating an infinite loop.
    const proxyCustomerId = url.searchParams.get("logged_in_customer_id");
    const signedLiquidCustomerId = getSignedLiquidCustomerId(url);

    if (signedLiquidCustomerId) {
      customerId = signedLiquidCustomerId;
    } else if (proxyCustomerId && proxyCustomerId.trim() !== "") {
      customerId = proxyCustomerId.trim();
    } else if (session) {
      const accessInfo = (session as unknown as Record<string, unknown>).onlineAccessInfo as
        | { associated_user?: { id?: number | string } }
        | undefined;
      if (accessInfo?.associated_user?.id) {
        customerId = String(accessInfo.associated_user.id);
      }
    }
  } catch {
    // Standalone or direct local development view — not a signed proxy request
  }

  // The signed Liquid customer bridge can survive storefront requests where
  // the app-proxy session lookup has no offline session to attach.
  customerId ||= getSignedLiquidCustomerId(url);
  // Display name & identifier come from signed Liquid params if present (legacy support),
  // otherwise we read from the DB below after the campaign lookup.
  const customerDisplayName = getSignedLiquidDisplayName(url, customerId);
  const customerIdentifier = getSignedLiquidCustomerIdentifier(url, customerId);

  if (!shopDomain) {
    shopDomain = url.searchParams.get("shop") || undefined;
  }

  // DEV mode is ONLY allowed in local development outside the signed App Proxy
  const isDev = process.env.NODE_ENV === "development" && !isProxyRequest;

  // In local dev ONLY (outside App Proxy), allow explicit ?customerId= testing
  if (!customerId && isDev) {
    customerId = url.searchParams.get("customerId") || null;
  }

  // Resolve campaign scoped to this shop for multi-store isolation
  const campaign = await getCampaignBySlug(slug, shopDomain);
  if (!campaign) {
    throw new Response("Campaign not found", { status: 404 });
  }

  const winnerAnnouncements = (await prisma.winner.findMany({
    where: { campaignId: campaign.id },
    orderBy: { rank: "asc" },
    select: {
      rank: true,
      customerProgress: { select: { shopifyCustomerId: true, totalPoints: true } },
    },
  })).map(({ rank, customerProgress }) => ({
    rank,
    displayId: `Customer • ${customerProgress.shopifyCustomerId.slice(-4)}`,
    totalPoints: customerProgress.totalPoints,
  }));

  const timeStatus = getCampaignTimeStatus(campaign);

  const isAuthenticated = Boolean(customerId);
  const isStorefrontProxyPath = url.pathname === "/apps/navratri" || url.pathname.startsWith("/apps/navratri/");
  const proxyBasePath = isProxyRequest || isStorefrontProxyPath ? "/apps/navratri" : "";
  const returnPath = `${proxyBasePath}/campaigns/${campaign.slug}`;

  // Use the live shopDomain (from proxy session) for building account URLs.
  // campaign.shop may contain the dev/seed store domain and must NOT be used for URLs.
  const liveShopDomain = shopDomain || campaign.shop;
  const storefrontUrl = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(liveShopDomain)
    ? `https://${liveShopDomain}`
    : null;
  // Account routes belong to Shopify's storefront domain, never the app tunnel
  // host (which doesn't serve /account/logout or customer authentication).
  const accountBaseUrl = storefrontUrl || "";
  const loginUrl = getLoginUrl({ slug: campaign.slug, isDev, storefrontUrl });
  const logoutUrl = getLogoutUrl({ slug: campaign.slug, isDev, storefrontUrl });

  // Resolve customer display name via Shopify Admin API (using the built-in proxy admin client).
  let resolvedDisplayName: string | null = customerDisplayName;
  let resolvedIdentifier: string | null = customerIdentifier;
  if (isAuthenticated && customerId && !resolvedDisplayName) {
    try {
      const numericCustomerId = customerId.replace(/\D/g, "");
      const shopifyCustomerGid = `gid://shopify/Customer/${numericCustomerId}`;

      // Prefer the authenticated admin client from the proxy session (no extra env vars needed)
      if (proxyAdmin) {
        const gqlResponse = await proxyAdmin.graphql(
          `#graphql
          query GetCustomer($id: ID!) {
            customer(id: $id) { email phone firstName lastName }
          }`,
          { variables: { id: shopifyCustomerGid } }
        );
        const gqlData = await gqlResponse.json() as { data?: { customer?: { email?: string; phone?: string; firstName?: string; lastName?: string } } };
        const cust = gqlData?.data?.customer;
        if (cust) {
          const firstName = cust.firstName?.trim();
          const lastName = cust.lastName?.trim();
          const fullName = [firstName, lastName].filter(Boolean).join(" ");
          
          resolvedDisplayName = fullName || null;
          resolvedIdentifier = cust.email || cust.phone || null;
        }
      } else {
        // Fallback: raw Admin API call with env token
        const shopifyAdminUrl = `https://${liveShopDomain}/admin/api/2024-10/graphql.json`;
        const adminToken = process.env.SHOPIFY_ACCESS_TOKEN || process.env.ADMIN_ACCESS_TOKEN;
        if (adminToken) {
          const gqlRes = await fetch(shopifyAdminUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": adminToken },
            body: JSON.stringify({
              query: `query GetCustomer($id: ID!) { customer(id: $id) { email phone firstName lastName } }`,
              variables: { id: shopifyCustomerGid },
            }),
          });
          if (gqlRes.ok) {
            const gqlData = await gqlRes.json() as { data?: { customer?: { email?: string; phone?: string; firstName?: string; lastName?: string } } };
            const cust = gqlData?.data?.customer;
            if (cust) {
              const firstName = cust.firstName?.trim();
              const lastName = cust.lastName?.trim();
              const fullName = [firstName, lastName].filter(Boolean).join(" ");
              
              resolvedDisplayName = fullName || null;
              resolvedIdentifier = cust.email || cust.phone || null;
            }
          }
        } else {
          // No admin access at all: fall back to existing DB display name
          const existingProgress = await prisma.customerProgress.findUnique({
            where: { campaignId_shopifyCustomerId: { campaignId: campaign.id, shopifyCustomerId: customerId } },
            select: { displayName: true },
          });
          
          const dbName = existingProgress?.displayName || null;
          // Do not expose raw email/phone as display name
          resolvedDisplayName = (dbName && !dbName.includes("@") && !/^\\+?\\d{10,}$/.test(dbName)) ? dbName : null;
        }
      }
    } catch {
      // Non-fatal: display name will fall back to "Player" in the UI
    }
  }

  // If customer is NOT authenticated, load public campaign preview (Day 1 preview & later mystery cards)
  if (!isAuthenticated || !customerId) {
    const [publicLevels, leaderboard] = await Promise.all([
      getCustomerLevelProgress({
        campaignId: campaign.id,
        shopifyCustomerId: "__guest_preview__",
      }),
      getPublicLeaderboard({
        campaignId: campaign.id,
        limit: 10,
      }),
    ]);

    return {
      isAuthenticated: false,
      isDev: false,
      appUrl: process.env.SHOPIFY_APP_URL || new URL(request.url).origin,
      proxyBasePath,
      returnPath,
      storefrontUrl,
      loginUrl,
      logoutUrl,
      isWinner: false,
      winnerDetails: null,
      serverNow: Date.now(),
      campaign: {
        id: campaign.id,
        shop: campaign.shop,
        name: campaign.name,
        slug: campaign.slug,
        description: campaign.description,
        status: campaign.status,
        timeStatus,
        maxPoints: campaign.maxPoints,
        startDate: campaign.startDate.toISOString(),
        endDate: campaign.endDate.toISOString(),
      },
      customerId: null,
      customerIdentifier: null,
      customerBridge: null,
      shopDomain: campaign.shop,
      progress: {
        id: "",
        shopifyCustomerId: "",
        displayName: null,
        totalPoints: 0,
        currentLevel: 1,
        status: "unauthenticated",
        eligibleAt: null,
      },
      // In guest preview, Day 1 is shown, Day 2-9 are masked as mystery cards
      levels: publicLevels.levels.map((l) => {
        const isLocked = l.levelNumber > 1;
        const template = campaignLevelTemplate.find((item) => item.levelNumber === l.levelNumber);
        return applyLevelChallengeCopy({
          id: l.id,
          levelNumber: l.levelNumber,
          points: l.points,
          movieGuessAttemptsUsed: 0,
          state: isLocked ? ("LOCKED" as const) : ("AVAILABLE" as const),
          title: isLocked ? "Surprise Challenge" : template?.title || l.title,
          description: isLocked ? null : template?.description || l.description,
          activityType: isLocked ? "locked" : l.activityType,
          config: isLocked ? null : l.config,
          isActive: l.isActive,
          availableFrom: l.availableFrom,
          submission: null,
          pointTransaction: null,
        });
      }),
      currentAvailableLevel: 1,
      transactions: [],
      leaderboard,
      winnerAnnouncements,
      reward: null,
    };
  }

  // Customer is authenticated → load actual customer progress & records
  await tryCompleteReadyPurchaseForCustomer(campaign.id, customerId);
  const [levelProgress, transactions, leaderboard, reward, movieGuessAttempts, winnerRecord] = await Promise.all([
    getCustomerLevelProgress({
      campaignId: campaign.id,
      shopifyCustomerId: customerId,
      displayName: resolvedDisplayName,
    }),
    getCustomerPointHistory(customerId, campaign.id),
    getPublicLeaderboard({
      campaignId: campaign.id,
      currentCustomerId: customerId,
      limit: 10,
    }),
    getCustomerReward(campaign.id, customerId),
    prisma.auditEvent.findMany({
      where: { campaignId: campaign.id, actorId: customerId, eventType: "MOVIE_GUESS_ATTEMPT" },
      select: { targetId: true },
    }),
    prisma.winner.findFirst({
      where: {
        campaignId: campaign.id,
        shopifyCustomerId: customerId,
      },
      select: {
        rank: true,
        rewardAssigned: true,
        createdAt: true,
      },
    }),
  ]);

  const { progress, levels, currentAvailableLevel } = levelProgress;
  const movieGuessAttemptsByLevel = new Map<string, number>();
  for (const attempt of movieGuessAttempts) {
    if (attempt.targetId) movieGuessAttemptsByLevel.set(attempt.targetId, (movieGuessAttemptsByLevel.get(attempt.targetId) || 0) + 1);
  }

  // SECURITY: Redact / mask future locked levels so their questions/titles are never leaked
  const secureLevels = levels.map((l) => {
    const movieGuessAttemptsUsed = movieGuessAttemptsByLevel.get(l.id) || 0;
    const levelObj = {
      id: l.id,
      levelNumber: l.levelNumber,
      points: l.points,
      movieGuessAttemptsUsed,
      state: l.state,
      title: l.title,
      description: l.description,
      activityType: l.activityType,
      config: l.config,
      isActive: l.isActive,
      availableFrom: l.availableFrom,
      submission: l.submission
        ? {
            ...l.submission,
            createdAt: l.submission.createdAt.toISOString(),
          }
        : null,
      pointTransaction: l.pointTransaction
        ? {
            ...l.pointTransaction,
            createdAt: l.pointTransaction.createdAt.toISOString(),
          }
        : null,
    };
    return sanitizeClientLevel(levelObj, proxyBasePath, currentAvailableLevel, campaign.slug, campaign.shop);
  });

  return {
    isAuthenticated: true,
    isDev,
    appUrl: process.env.SHOPIFY_APP_URL || new URL(request.url).origin,
    proxyBasePath,
    returnPath,
    storefrontUrl,
    loginUrl,
    logoutUrl,
    isWinner: Boolean(winnerRecord),
    winnerDetails: winnerRecord
      ? {
          rank: winnerRecord.rank,
          rewardAssigned: winnerRecord.rewardAssigned,
          prizeValue: "₹1,500–₹2,000",
          createdAt: winnerRecord.createdAt.toISOString(),
        }
      : null,
    serverNow: Date.now(),
    campaign: {
      id: campaign.id,
      shop: campaign.shop,
      name: campaign.name,
      slug: campaign.slug,
      description: campaign.description,
      status: campaign.status,
      timeStatus,
      maxPoints: campaign.maxPoints,
      startDate: campaign.startDate.toISOString(),
      endDate: campaign.endDate.toISOString(),
    },
    customerId,
    customerIdentifier: resolvedIdentifier,
    shopDomain: campaign.shop,
    customerBridge: customerId ? createCustomerBridge(customerId) : null,
    progress: {
      id: progress.id,
      shopifyCustomerId: progress.shopifyCustomerId,
      displayName: progress.displayName,
      totalPoints: progress.totalPoints,
      currentLevel: progress.currentLevel,
      status: progress.status,
      eligibleAt: progress.eligibleAt ? progress.eligibleAt.toISOString() : null,
    },
    levels: secureLevels,
    currentAvailableLevel,
    transactions: aggregateQuizTransactions(transactions).map((t) => ({
      ...t,
      createdAt: t.createdAt.toISOString(),
    })),
    leaderboard,
    winnerAnnouncements,
    reward: reward
      ? {
          id: reward.id,
          discountCode: reward.discountCode,
          rewardType: reward.rewardType,
          rewardValue: reward.rewardValue,
          prizeLabel: reward.prizeLabel,
          offerMessage: reward.offerMessage,
          status: reward.status,
          issuedAt: reward.issuedAt ? reward.issuedAt.toISOString() : null,
          expiresAt: reward.expiresAt ? reward.expiresAt.toISOString() : null,
        }
      : null,
  };
};

// Point-awarding requests return progress directly. Re-running this storefront
// loader after an app-proxy POST can lose the signed customer context and
// replace the current customer state with the guest preview.
export const shouldRevalidate = ({ formData, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) => {
  const actionType = String(formData?.get("actionType") || "");
  const isProgressRequest = actionType === "prepare_spin" || actionType === "quiz" || actionType === "complete_activity" || actionType === "text";
  return isProgressRequest ? false : defaultShouldRevalidate;
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const { slug } = params;
  const requestUrl = new URL(request.url);
  // 1. Check for App Proxy authenticated customer ID
  let authenticatedCustomerId: string | null = null;
  let isProxyRequest = false;
  let shopDomain = requestUrl.searchParams.get("shop") || undefined;
  try {
    const { session } = await authenticate.public.appProxy(request);
    isProxyRequest = true;
    shopDomain = (session as unknown as Record<string, unknown> | null)?.shop as string | undefined || shopDomain;
    const url = new URL(request.url);
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
    // Standalone or direct dev API call
  }

  // Some storefront POSTs preserve the signed Liquid identity query parameters
  // but omit the app-proxy session object. Accept only the HMAC-verified ID.
  authenticatedCustomerId ||= getSignedLiquidCustomerId(requestUrl);

  const bodyGuard = limitRequestBody(request, 1 * 1024 * 1024);
  if (bodyGuard.tooLarge) return Response.json({ success: false, error: "Request is too large." }, { status: 413 });
  const guardedRequest = bodyGuard.request;
  const contentType = guardedRequest.headers.get("Content-Type") || "";
  const formData = await guardedRequest.formData();
  const formIdentity = new URLSearchParams({
    customer_id_from_liquid: String(formData.get("customer_id_from_liquid") || ""),
    customer_sig: String(formData.get("customer_sig") || ""),
  });
  authenticatedCustomerId ||= getSignedLiquidCustomerId(formIdentity);
  shopDomain ||= String(formData.get("shop") || "") || undefined;

  const campaign = await getCampaignBySlug(slug || "", shopDomain);
  if (!campaign) return { success: false, error: "Campaign not found" };

  const timeStatus = getCampaignTimeStatus(campaign);
  if (timeStatus !== "ACTIVE") {
    return { success: false, error: `This campaign is currently ${timeStatus.toLowerCase()}. Submissions are not permitted.` };
  }

  if (contentType.includes("multipart/form-data")) {
    const levelId = String(formData.get("levelId") || "");
    const formCustomerId = String(formData.get("customerId") || "");
    
    // In proxy mode, customer ID must come from Shopify signed proxy context
    const customerId = authenticatedCustomerId || (process.env.NODE_ENV === "development" && !isProxyRequest ? formCustomerId : null);
    
    if (!customerId) {
      return { success: false, error: "Please log in with your store account to submit challenges." };
    }

    const activityType = String(formData.get("activityType") || "");
    const actionType = String(formData.get("actionType") || "");
    const file = formData.get("file") as File | null;
    const textResponse = String(formData.get("textResponse") || "").trim();

    // Text answers use FormData too (the page submits multipart). Save them
    // into the moderation queue; points are awarded only after admin approval.
    if (actionType === "text" || activityType === "text_submission") {
      if (!levelId) return { success: false, error: "Missing submission parameters." };
      try {
        const result = await processTextSubmission({
          campaignId: campaign.id,
          levelId,
          shopifyCustomerId: customerId,
          textResponse,
        });
        if (result.status === "approved" && "progress" in result && "pointsAwarded" in result) {
          return {
            success: true,
            outcome: result.pointsAwarded > 0 ? "points_awarded" as const : "feedback_submitted" as const,
            pointsAwarded: result.pointsAwarded,
            completedLevelId: levelId,
            completedLevelNumber: "level" in result ? result.level.levelNumber : undefined,
            progressSummary: {
              totalPoints: result.progress.totalPoints,
              currentLevel: result.progress.currentLevel,
              status: result.progress.status,
              eligibleAt: result.progress.eligibleAt?.toISOString() || null,
            },
            message: result.message,
          };
        }
        return {
          success: true,
          outcome: "pending_review" as const,
          message: result.message,
        };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : "Text submission failed." };
      }
    }

    if (!levelId || !activityType) {
      return { success: false, error: "Missing submission parameters." };
    }

    try {
      if (activityType === "photo_upload" || (activityType === "final_submission" && file && file.size > 0)) {
        return { success: false, error: "Image uploads must use the secure direct-to-R2 upload flow." };
      }

      if (activityType === "text_submission" || activityType === "final_submission") {
        const result = await processTextSubmission({
          campaignId: campaign.id,
          levelId,
          shopifyCustomerId: customerId,
          textResponse,
        });
        if (result.status === "approved" && "progress" in result && "pointsAwarded" in result) {
          return {
            success: true,
            outcome: result.pointsAwarded > 0 ? "points_awarded" as const : "feedback_submitted" as const,
            pointsAwarded: result.pointsAwarded,
            completedLevelId: levelId,
            completedLevelNumber: "level" in result ? result.level.levelNumber : undefined,
            progressSummary: {
              totalPoints: result.progress.totalPoints,
              currentLevel: result.progress.currentLevel,
              status: result.progress.status,
              eligibleAt: result.progress.eligibleAt?.toISOString() || null,
            },
            message: result.message,
          };
        }
        return {
          success: true,
          outcome: "pending_review" as const,
          message: result.message,
        };
      }

      return { success: false, error: "Unsupported activity submission format." };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Submission error";
      return { success: false, error: msg };
    }
  } else {
    // JSON / Form URL Encoded
    const actionType = String(formData.get("actionType") || "");
    const levelId = String(formData.get("levelId") || "");
    const formCustomerId = String(formData.get("customerId") || "");
    
    const customerId = authenticatedCustomerId || (process.env.NODE_ENV === "development" && !isProxyRequest ? formCustomerId : null);

    if (!customerId) {
      return { success: false, error: "Please log in with your store account to submit challenges." };
    }

    if (actionType === "prepare_spin") {
      try {
        const spinPrize = await prepareWheelSpin({ campaignId: campaign.id, levelId, shopifyCustomerId: customerId });
        return Response.json({ success: true, outcome: "spin_prepared" as const, spinPrize });
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : "Could not prepare your wheel spin." };
      }
    }

    if (actionType === "quiz") {
      const selectedOption = String(formData.get("selectedOption") || "").trim();
      try {
        const result = await processQuizSubmission({
          campaignId: campaign.id,
          levelId,
          shopifyCustomerId: customerId,
          selectedOption,
        });

        if (result.success) {
          return {
            success: true,
            outcome: "points_awarded" as const,
            pointsAwarded: result.pointsAwarded,
            quizPointsTotal: result.quizPointsTotal,
            correctCount: result.correctCount,
            totalCorrect: result.totalCorrect,
            completedLevelId: result.level.id,
            completedLevelNumber: result.level.levelNumber,
            progressSummary: {
              totalPoints: result.progress.totalPoints,
              currentLevel: result.progress.currentLevel,
              status: result.progress.status,
              eligibleAt: result.progress.eligibleAt?.toISOString() || null,
            },
            message: result.message,
          };
        } else {
          return {
            success: false,
            outcome: "quiz_partial" as const,
            pointsAwarded: result.pointsAwarded || 0,
            correctCount: result.correctCount,
            totalCorrect: result.totalCorrect,
            message: result.message || "Some answers were incorrect. Please try again.",
            progressSummary: {
              totalPoints: result.progress.totalPoints,
              currentLevel: result.progress.currentLevel,
              status: result.progress.status,
              eligibleAt: result.progress.eligibleAt?.toISOString() || null,
            },
          };
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Quiz submission failed";
        return { success: false, error: msg };
      }
    }

    if (actionType === "complete_activity") {
      try {
        const activityType = String(formData.get("activityType") || "");
        if (activityType === "movie_guess") {
          const guessAttempt = await recordMovieGuessAttempt({
            campaignId: campaign.id,
            levelId,
            shopifyCustomerId: customerId,
            answer: String(formData.get("answer") || ""),
          });
          if (!guessAttempt.isCorrect) {
            return {
              success: false,
              isCorrect: false,
              error: guessAttempt.exhausted
                ? "❌ No guesses remaining. You used all 3 attempts."
                : `❌ Wrong movie name. ${guessAttempt.attemptsRemaining} guess${guessAttempt.attemptsRemaining === 1 ? "" : "es"} remaining.`,
              attemptsUsed: guessAttempt.attemptsUsed,
              attemptsRemaining: guessAttempt.attemptsRemaining,
              movieGuessLevelId: levelId,
            };
          }
        }
        let adminGraphqlClient: WheelDiscountAdminClient | undefined;
        if (String(formData.get("activityType") || "") === "spin_wheel") {
          // Use the campaign's trusted shop record, not a storefront-provided
          // query parameter. This also works when the action POST is not itself
          // routed through Shopify's app proxy.
          const adminContext = await unauthenticated.admin(campaign.shop);
          adminGraphqlClient = adminContext.admin;
        }
        const result = await completeSpecialActivity({
          campaignId: campaign.id,
          levelId: levelId || undefined,
          levelNumber: Number(formData.get("levelNumber")) || undefined,
          shopifyCustomerId: customerId,
          answer: String(formData.get("answer") || ""),
          productHandle: String(formData.get("productHandle") || ""),
          collectionHandle: String(formData.get("collectionHandle") || ""),
          attempts: Number(formData.get("attempts")) || undefined,
          adminGraphqlClient,
          spinAttemptToken: String(formData.get("spinAttemptToken") || "") || undefined,
        });
        if (result.levelNumber === 8) {
          await tryCompleteReadyPurchaseForCustomer(campaign.id, customerId);
        }
        const responseData = {
          success: true,
          isCorrect: activityType === "movie_guess",
          outcome: "points_awarded" as const,
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
          discountPercent: "discountPercent" in result ? result.discountPercent : undefined,
          discountCode: "discountCode" in result ? result.discountCode : undefined,
          useNowUrl: result.discountCode
            ? `https://aghoristore.com/discount/${encodeURIComponent(result.discountCode)}?redirect=%2Fcollections%2Fall`
            : undefined,
          offerMessage: "offerMessage" in result ? result.offerMessage : undefined,
          message: result.reward
            ? `🎉 You won ${result.reward}!${result.discountCode ? ` Your one-use code is ${result.discountCode}.` : ""} +${result.pointsAwarded} points added.`
            : `🎉 Challenge complete! +${result.pointsAwarded} points added.`,
        };
        return String(formData.get("activityType") || "") === "spin_wheel"
          ? Response.json(responseData)
          : responseData;
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : "Challenge could not be completed." };
      }
    }

    if (actionType === "text") {
      const textResponse = String(formData.get("textResponse") || "").trim();
      try {
        const result = await processTextSubmission({
          campaignId: campaign.id,
          levelId,
          shopifyCustomerId: customerId,
          textResponse,
        });
        if (result.status === "approved" && "progress" in result && "pointsAwarded" in result) {
          return {
            success: true,
            outcome: result.pointsAwarded > 0 ? "points_awarded" as const : "feedback_submitted" as const,
            pointsAwarded: result.pointsAwarded,
            completedLevelId: levelId,
            completedLevelNumber: "level" in result ? result.level.levelNumber : undefined,
            progressSummary: {
              totalPoints: result.progress.totalPoints,
              currentLevel: result.progress.currentLevel,
              status: result.progress.status,
              eligibleAt: result.progress.eligibleAt?.toISOString() || null,
            },
            message: result.message,
          };
        }
        return {
          success: true,
          outcome: "pending_review" as const,
          message: result.message,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Text submission failed";
        return { success: false, error: msg };
      }
    }

    return { success: false, error: "Invalid action." };
  }
};

export const headers: HeadersFunction = () => {
  return {
    "Cache-Control": "no-cache, no-store, must-revalidate",
  };
};

export default function CustomerCampaignPage() {
  const initialData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as {
    outcome?: "points_awarded" | "pending_review" | "quiz_partial" | "feedback_submitted";
    pointsAwarded?: number;
    quizPointsTotal?: number;
    completedLevelId?: string;
    completedLevelNumber?: number;
    progressSummary?: Partial<typeof initialData.progress>;
    message?: string;
    error?: string;
    prizeLabel?: string;
    discountCode?: string;
    discountPercent?: number;
    useNowUrl?: string;
    offerMessage?: string;
  } | undefined;
  const navigation = useNavigation();
  const submit = useSubmit();
  const activityFetcher = useFetcher<typeof action>();
  const { proxyBasePath, returnPath, storefrontUrl, isAuthenticated, loginUrl, logoutUrl, currentAvailableLevel } = initialData;

  // State synced in real-time
  const [progress, setProgress] = useState(initialData.progress);
  const [levels, setLevels] = useState(initialData.levels);
  const [reward, setReward] = useState(initialData.reward);
  const [rewardCodeCopied, setRewardCodeCopied] = useState(false);
  const [spinPrize, setSpinPrize] = useState<{ label: string; discountPercent: number; index: number; token: string } | null>(null);
  const [isSpinFlowBusy, setIsSpinFlowBusy] = useState(false);
  const [isSpinSubmitting, setIsSpinSubmitting] = useState(false);
  const [isQuizSubmitting, setIsQuizSubmitting] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [isTextSubmitting, setIsTextSubmitting] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);
  const [isPhotoUploading, setIsPhotoUploading] = useState(false);
  const [photoUploadError, setPhotoUploadError] = useState<string | null>(null);
  const [spinError, setSpinError] = useState<string | null>(null);
  const [specialActivityError, setSpecialActivityError] = useState<string | null>(null);
  const [isSpecialActivitySubmitting, setIsSpecialActivitySubmitting] = useState(false);
  const [movieGuessFeedback, setMovieGuessFeedback] = useState<{ levelId: string; correct: boolean; message: string; attemptsRemaining: number } | null>(null);
  const [leaderboard, setLeaderboard] = useState(initialData.leaderboard);
  const [transactions, setTransactions] = useState(initialData.transactions);
  const [isLive, setIsLive] = useState(true);
  const liveSyncSequence = useRef(0);

  // Server-synchronized time for countdowns
  const [now, setNow] = useState(initialData.serverNow || Date.now());
  const serverOffset = useRef(Date.now() - (initialData.serverNow || Date.now()));
  useEffect(() => {
    const timer = setTimeout(() => {
      setNow(Date.now() - serverOffset.current);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const [activeLevelModal, setActiveLevelModal] = useState<(typeof levels)[0] | null>(null);
  const [submissionFeedback, setSubmissionFeedback] = useState<{
    outcome: "points_awarded" | "pending_review" | "feedback_submitted";
    pointsAwarded?: number;
    quizPointsTotal?: number;
    message: string;
    prizeLabel?: string;
    discountCode?: string;
    discountPercent?: number;
    useNowUrl?: string;
    offerMessage?: string;
  } | null>(null);

  const campaign = initialData.campaign;
  const customerId = initialData.customerId;
  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    try {
      window.sessionStorage.removeItem("navratri-campaign-load-retries");
    } catch {
      // Session storage can be unavailable in restricted storefront contexts.
    }
  }, []);

  // Re-sync local state when loader data revalidates
  useEffect(() => {
    setProgress(initialData.progress);
    setLevels(initialData.levels);
    setReward(initialData.reward);
    setLeaderboard(initialData.leaderboard);
    setTransactions(initialData.transactions);
  }, [initialData]);

  // Real-time synchronization polling (every 10s if authenticated)
  const fetchLiveUpdates = useCallback(async () => {
    if (!isAuthenticated || !customerId || document.visibilityState !== "visible") return;
    const requestSequence = ++liveSyncSequence.current;
    try {
      const res = await fetch(
        `${proxyBasePath}/api/realtime/customer?customerId=${encodeURIComponent(customerId)}&slug=${encodeURIComponent(campaign.slug)}`,
      );
      // A poll started before an award must not overwrite the newer result.
      if (requestSequence !== liveSyncSequence.current) return;
      if (res.ok) {
        const data = await res.json();
        if (data.progress) setProgress(data.progress);
        if (data.levels) {
          const availLevel = typeof data.currentAvailableLevel === "number" ? data.currentAvailableLevel : currentAvailableLevel;
          setLevels(data.levels.map((level: (typeof initialData.levels)[number]) =>
            sanitizeClientLevel(level, proxyBasePath, availLevel, campaign.slug, campaign.shop)
          ));
        }
        if (data.reward) setReward(data.reward);
        if (data.leaderboard) setLeaderboard(data.leaderboard);
        if (data.transactions) setTransactions(data.transactions);
        setIsLive(true);
      } else {
        setIsLive(false);
      }
    } catch {
      setIsLive(false);
    }
  }, [customerId, campaign.slug, proxyBasePath, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void fetchLiveUpdates();


  }, [fetchLiveUpdates, isAuthenticated]);

  useEffect(() => {
    if (actionData?.outcome === "quiz_partial") {
      setProgress((current) => ({
        ...current,
        ...actionData.progressSummary,
        totalPoints: actionData.progressSummary?.totalPoints ?? current.totalPoints + (actionData.pointsAwarded || 0),
      }));
      return;
    }
    if (
      actionData?.outcome === "points_awarded" ||
      actionData?.outcome === "pending_review" ||
      actionData?.outcome === "feedback_submitted"
    ) {
      if (actionData.outcome === "points_awarded" || actionData.outcome === "feedback_submitted") {
        setProgress((current) => ({
          ...current,
          ...actionData.progressSummary,
          totalPoints: actionData.progressSummary?.totalPoints
            ?? current.totalPoints + (actionData.pointsAwarded || 0),
        }));
        if (actionData.completedLevelId || actionData.completedLevelNumber) {
          setLevels((current) => current.map((level) =>
            level.id === actionData.completedLevelId || level.levelNumber === actionData.completedLevelNumber
              ? { ...level, state: "COMPLETED" as const }
              : level,
          ));
        }
      }
      setActiveLevelModal(null);
      setSubmissionFeedback({
        outcome: actionData.outcome,
        pointsAwarded:
          (actionData.outcome === "points_awarded" || actionData.outcome === "feedback_submitted") ? actionData.pointsAwarded : undefined,
        quizPointsTotal: actionData.quizPointsTotal,
        message: actionData.message || "Your challenge submission was received.",
        prizeLabel: actionData.outcome === "points_awarded" ? actionData.prizeLabel : undefined,
        discountCode: actionData.outcome === "points_awarded" ? actionData.discountCode : undefined,
        discountPercent: actionData.outcome === "points_awarded" ? actionData.discountPercent : undefined,
        useNowUrl: actionData.outcome === "points_awarded" ? actionData.useNowUrl : undefined,
        offerMessage: actionData.outcome === "points_awarded" ? actionData.offerMessage : undefined,
      });
      fetchLiveUpdates();
    }
  }, [actionData, fetchLiveUpdates]);

  // Keep special-game actions on their own fetcher. A fetcher response is
  // scoped to this submission, so unrelated/revalidated route data cannot
  // swallow the points-awarded response after a mini-game finishes.
  useEffect(() => {
    const result = activityFetcher.data;
    if (!result || !("outcome" in result)) return;
    if (result.outcome === "quiz_partial") {
      // Quiz actions use this fetcher, not useActionData. Reflect 50-point
        // per-question awards immediately while keeping the quiz open for retries.
        // Ignore in-flight polling responses that started before this award.
        liveSyncSequence.current += 1;
      setProgress((current) => ({
        ...current,
        ...("progressSummary" in result ? result.progressSummary : {}),
        totalPoints: "progressSummary" in result && result.progressSummary?.totalPoints != null
          ? result.progressSummary.totalPoints
          : current.totalPoints + ("pointsAwarded" in result ? result.pointsAwarded || 0 : 0),
      }));
      return;
    }
    if (result.outcome === "pending_review" || result.outcome === "feedback_submitted") {
      if (result.outcome === "feedback_submitted") {
        setProgress((current) => ({
          ...current,
          ...("progressSummary" in result ? result.progressSummary : {}),
        }));
      }
      setActiveLevelModal(null);
      setSubmissionFeedback({
        outcome: result.outcome,
        pointsAwarded: result.outcome === "feedback_submitted" && "pointsAwarded" in result ? result.pointsAwarded : undefined,
        message: ("message" in result && result.message) || "Your response was submitted for review.",
      });
      void fetchLiveUpdates();
      return;
    }
    if (result.outcome !== "points_awarded") return;
    // Invalidate any live-progress poll that began before this award response.
    liveSyncSequence.current += 1;
    setProgress((current) => ({
      ...current,
      ...result.progressSummary,
      totalPoints: result.progressSummary?.totalPoints ?? current.totalPoints + (result.pointsAwarded || 0),
    }));
    if (result.completedLevelId || result.completedLevelNumber) {
      setLevels((current) => current.map((level) =>
        level.id === result.completedLevelId || level.levelNumber === result.completedLevelNumber
          ? { ...level, state: "COMPLETED" as const }
          : level,
      ));
    }
    setActiveLevelModal(null);
    setSubmissionFeedback({
      outcome: "points_awarded",
      pointsAwarded: result.pointsAwarded,
      quizPointsTotal: "quizPointsTotal" in result ? result.quizPointsTotal : undefined,
      message: result.message || "Challenge complete! Points added.",
      prizeLabel: "prizeLabel" in result ? result.prizeLabel : undefined,
      discountCode: "discountCode" in result ? result.discountCode : undefined,
      discountPercent: "discountPercent" in result ? result.discountPercent : undefined,
      useNowUrl: "useNowUrl" in result ? result.useNowUrl : undefined,
      offerMessage: "offerMessage" in result ? result.offerMessage : undefined,
    });
    fetchLiveUpdates();
  }, [activityFetcher.data, fetchLiveUpdates]);

  const sendSpinRequest = useCallback(async (form: FormData, preparing: boolean) => {
    setIsSpinSubmitting(true);
    setSpinError(null);
    try {
      const endpoint = `${proxyBasePath}/api/campaigns/${encodeURIComponent(campaign.slug)}/spin`;
      const response = await fetch(endpoint, {
        method: "POST",
        body: form,
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const result = await response.json() as {
        success?: boolean;
        outcome?: "spin_prepared" | "points_awarded";
        error?: string;
        spinPrize?: { label: string; discountPercent: number; index: number; token: string };
        pointsAwarded?: number;
        completedLevelId?: string;
        progressSummary?: Partial<typeof progress>;
        prizeLabel?: string;
        discountCode?: string;
        discountPercent?: number;
        useNowUrl?: string;
        offerMessage?: string;
        message?: string;
      };

      if (!response.ok || result.success !== true) {
        throw new Error(result.error || `Spin request failed (${response.status}). Please try again.`);
      }

      if (preparing && result.outcome === "spin_prepared" && result.spinPrize) {
        setSpinPrize(result.spinPrize);
        return;
      }

      if (!preparing && result.outcome === "points_awarded") {
        if (result.progressSummary) setProgress((current) => ({ ...current, ...result.progressSummary }));
        if (result.completedLevelId) {
          setLevels((current) => current.map((level) => level.id === result.completedLevelId
            ? { ...level, state: "COMPLETED" as const }
            : level));
        }
        setActiveLevelModal(null);
        setSubmissionFeedback({
          outcome: "points_awarded",
          pointsAwarded: result.pointsAwarded,
          message: result.message || "Your challenge is complete!",
          prizeLabel: "prizeLabel" in result ? result.prizeLabel : undefined,
          discountCode: "discountCode" in result ? result.discountCode : undefined,
          discountPercent: "discountPercent" in result ? result.discountPercent : undefined,
          useNowUrl: "useNowUrl" in result ? result.useNowUrl : undefined,
          offerMessage: "offerMessage" in result ? result.offerMessage : undefined,
        });
        return;
      }

      throw new Error("The server returned an incomplete Spin & Win result. Please try again.");
    } catch (error) {
      setSpinPrize(null);
      setSpinError(error instanceof Error ? error.message : "The spin could not be completed. Please try again.");
    } finally {
      setIsSpinSubmitting(false);
      setIsSpinFlowBusy(false);
    }
  }, [campaign.slug, proxyBasePath]);

  const pointsBarMax = 1500;
  const percentage = Math.min(100, Math.round((progress.totalPoints / pointsBarMax) * 100));

  const [showWinnerPopup, setShowWinnerPopup] = useState(false);

  useEffect(() => {
    if (initialData.isWinner) {
      const dismissed = typeof window !== "undefined"
        ? window.sessionStorage.getItem(`navratri_winner_dismissed_${campaign.slug}`)
        : null;
      if (!dismissed) {
        setShowWinnerPopup(true);
      }
    }
  }, [initialData.isWinner, campaign.slug]);

  const handleCloseWinnerPopup = useCallback(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(`navratri_winner_dismissed_${campaign.slug}`, "true");
    }
    setShowWinnerPopup(false);
  }, [campaign.slug]);

  const resolvedLogoutUrl = getLogoutUrl({
    slug: campaign.slug,
    isDev: initialData.isDev,
    storefrontUrl: initialData.storefrontUrl,
  });

  // The triggerLogin function is removed because synthetic clicks are not intercepted by KwikPass.
  // Instead, native <a> tags are rendered.

  const handleOpenLevel = (lvl: (typeof levels)[0]) => {
    if (lvl.state !== "AVAILABLE" && lvl.state !== "REJECTED") return;
    if (!isAuthenticated) {
      // Native anchor navigation for unauthenticated clicks
      if (typeof window !== "undefined") {
        window.location.href = loginUrl;
      }
      return;
    }
    setActiveLevelModal(lvl);
    setSpinPrize(null);
    setSpinError(null);
    setSpecialActivityError(null);
  };

  // React Router app-proxy action requests can lose Shopify's signed query
  // parameters. Forward only the verified Liquid HMAC bridge from the loader.
  const addCustomerBridge = (form: FormData) => {
    form.set("shop", initialData.shopDomain);
    if (!initialData.customerBridge) return;
    form.set("customer_id_from_liquid", initialData.customerBridge.customerId || "");
    form.set("customer_sig", initialData.customerBridge.signature || "");
  };

  const submitCampaignForm = async (form: FormData) => {
    const endpoint = `${proxyBasePath}/api/campaigns/${encodeURIComponent(campaign.slug)}/submit`;
    const response = await fetch(endpoint, {
      method: "POST",
      body: form,
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const result = await response.json() as {
      success?: boolean;
      outcome?: string;
      error?: string;
      message?: string;
      pointsAwarded?: number;
      quizPointsTotal?: number;
      correctCount?: number;
      totalCorrect?: number;
      completedLevelId?: string;
      completedLevelNumber?: number;
      progressSummary?: Partial<typeof initialData.progress>;
    };
    if (!response.ok || result.success !== true || !result.outcome) {
      throw new Error(result.error || result.message || `Submission failed (${response.status}). Please try again.`);
    }
    return result;
  };

  const handleQuizSubmit = async (selectedOption: string) => {
    if (!activeLevelModal || !customerId || isQuizSubmitting) return;
    setIsQuizSubmitting(true);
    setQuizError(null);
    const form = new FormData();
    form.append("levelId", activeLevelModal.id);
    form.append("customerId", customerId);
    form.append("activityType", "quiz");
    form.append("selectedOption", selectedOption);
    addCustomerBridge(form);
    try {
      const result = await submitCampaignForm(form);
      if (result.outcome !== "points_awarded") throw new Error(result.message || "Quiz answers could not be scored.");
      liveSyncSequence.current += 1;
      setProgress((current) => ({
        ...current,
        ...result.progressSummary,
        totalPoints: result.progressSummary?.totalPoints ?? current.totalPoints + (result.pointsAwarded || 0),
      }));
      setLevels((current) => current.map((level) =>
        level.id === result.completedLevelId || level.levelNumber === result.completedLevelNumber
          ? { ...level, state: "COMPLETED" as const }
          : level,
      ));
      setActiveLevelModal(null);
      setSubmissionFeedback({
        outcome: "points_awarded",
        pointsAwarded: result.pointsAwarded,
        quizPointsTotal: result.quizPointsTotal,
        message: result.message || `Quiz complete. You earned ${result.quizPointsTotal || 0} points.`,
      });
      void fetchLiveUpdates();
    } catch (error) {
      setQuizError(error instanceof Error ? error.message : "Quiz submission failed. Please try again.");
    } finally {
      setIsQuizSubmitting(false);
    }
  };

  const handlePhotoSubmit = async (file: File, note?: string) => {
    if (!activeLevelModal || !customerId || isPhotoUploading) return;
    setPhotoUploadError(null);
    setIsPhotoUploading(true);
    try {
      const result = await uploadImageToR2(file, activeLevelModal.id, "photo_upload", note);
      setActiveLevelModal(null);
      setSubmissionFeedback({ outcome: "pending_review", message: result.message || "Your photo was submitted successfully and is waiting for review." });
      void fetchLiveUpdates();
    } catch (error) {
      setPhotoUploadError(error instanceof Error ? error.message : "Photo submission failed. Please try again.");
    } finally {
      setIsPhotoUploading(false);
    }
  };

  const uploadImageToR2 = async (
    file: File,
    levelId: string,
    submissionType: "photo_upload" | "final_submission",
    textResponse?: string,
  ) => {
    const endpoint = `${proxyBasePath}/api/campaigns/${encodeURIComponent(campaign.slug)}/upload`;
    const authorizeResponse = await fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ intent: "authorize", levelId, submissionType, fileName: file.name, contentType: file.type, size: file.size }),
    });
    const authorization = await authorizeResponse.json() as {
      success?: boolean; error?: string; uploadUrl?: string; finalizeToken?: string; requiredHeaders?: Record<string, string>;
    };
    if (!authorizeResponse.ok || !authorization.success || !authorization.uploadUrl || !authorization.finalizeToken) {
      throw new Error(authorization.error || "Could not authorize the image upload.");
    }

    let uploadResponse;
    try {
      uploadResponse = await fetch(authorization.uploadUrl, {
      method: "PUT",
      credentials: "omit",
      headers: authorization.requiredHeaders,
      body: file,
    });
    } catch (error) {
      throw new Error("Upload failed due to CORS. Please add a CORS rule to your Cloudflare R2 bucket allowing PUT from this domain.");
    }
    if (!uploadResponse.ok) throw new Error("The image could not be uploaded to storage. Please try again.");

    const finalizeResponse = await fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ intent: "finalize", finalizeToken: authorization.finalizeToken, textResponse }),
    });
    const result = await finalizeResponse.json() as { success?: boolean; error?: string; message?: string };
    if (!finalizeResponse.ok || !result.success) throw new Error(result.error || "The uploaded image could not be finalized.");
    return result;
  };

  const handleTextSubmit = async (text: string) => {
    if (!activeLevelModal || !customerId || isTextSubmitting) return;
    setIsTextSubmitting(true);
    setTextError(null);
    const form = new FormData();
    form.append("levelId", activeLevelModal.id);
    form.append("activityType", "text_submission");
    form.append("customerId", customerId);
    form.append("textResponse", text);
    addCustomerBridge(form);
    try {
      const result = await submitCampaignForm(form);
      if (result.outcome === "pending_review") {
        setLevels((current) => current.map((level) => level.id === activeLevelModal.id ? { ...level, state: "PENDING" as const } : level));
        setActiveLevelModal(null);
        setSubmissionFeedback({ outcome: "pending_review", message: result.message || "Your response was submitted for review." });
        void fetchLiveUpdates();
      } else if (result.outcome === "points_awarded" || result.outcome === "feedback_submitted") {
        if (result.progressSummary) setProgress((current) => ({ ...current, ...result.progressSummary }));
        if (result.completedLevelId || result.completedLevelNumber) {
          setLevels((current) => current.map((level) => level.id === result.completedLevelId || level.levelNumber === result.completedLevelNumber ? { ...level, state: "COMPLETED" as const } : level));
        }
        setActiveLevelModal(null);
        setSubmissionFeedback({
          outcome: result.outcome,
          pointsAwarded: result.pointsAwarded,
          message: result.message || "Your response was submitted successfully.",
        });
        void fetchLiveUpdates();
      } else {
        throw new Error(result.message || "Your response could not be submitted.");
      }
    } catch (error) {
      setTextError(error instanceof Error ? error.message : "Text submission failed. Please try again.");
    } finally {
      setIsTextSubmitting(false);
    }
  };

  const handleFinalSubmit = async (data: { file?: File; text: string }) => {
    if (!activeLevelModal || !customerId) return;
    if (data.file) {
      if (isPhotoUploading) return;
      setPhotoUploadError(null);
      setIsPhotoUploading(true);
      try {
        const result = await uploadImageToR2(data.file, activeLevelModal.id, "final_submission", data.text);
        setActiveLevelModal(null);
        setSubmissionFeedback({ outcome: "pending_review", message: result.message || "Your finale submission was received and is waiting for review." });
        void fetchLiveUpdates();
      } catch (error) {
        setPhotoUploadError(error instanceof Error ? error.message : "Finale submission failed. Please try again.");
      } finally {
        setIsPhotoUploading(false);
      }
      return;
    }
    const form = new FormData();
    form.append("levelId", activeLevelModal.id);
    form.append("customerId", customerId);
    form.append("activityType", "final_submission");
    form.append("textResponse", data.text);
    addCustomerBridge(form);
    submit(form, { method: "post", encType: "multipart/form-data" });
  };

  const handleSpecialActivity = useCallback((activityType: string, values: Record<string, string> = {}) => {
    if (!activeLevelModal || !customerId) return;
    const form = new FormData();
    form.append("actionType", "complete_activity");
    form.append("levelId", activeLevelModal.id);
    form.append("activityType", activityType);
    form.append("customerId", customerId);
    for (const [key, value] of Object.entries(values)) form.append(key, value);
    addCustomerBridge(form);
    if (activityType === "memory_game" || activityType === "movie_guess" || activityType === "audio_guess") {
      if (activityType === "movie_guess" || activityType === "audio_guess") setMovieGuessFeedback(null);
      setSpecialActivityError(null);
      setIsSpecialActivitySubmitting(true);
      const endpoint = `${proxyBasePath}/api/campaigns/${encodeURIComponent(campaign.slug)}/activity`;
      void fetch(endpoint, {
        method: "POST",
        body: form,
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      }).then(async (response) => {
        const result = await response.json() as {
          success?: boolean;
          outcome?: "points_awarded";
          isCorrect?: boolean;
          error?: string;
          attemptsRemaining?: number;
          pointsAwarded?: number;
          completedLevelId?: string;
          completedLevelNumber?: number;
          progressSummary?: Partial<typeof progress>;
          message?: string;
        };
        if ((activityType === "movie_guess" || activityType === "audio_guess") && result.success && result.isCorrect === false) {
          setMovieGuessFeedback({
            levelId: activeLevelModal.id,
            correct: false,
            message: result.error || "That movie guess was incorrect.",
            attemptsRemaining: Math.max(0, Number(result.attemptsRemaining) || 0),
          });
          return;
        }
        if (!response.ok || result.success !== true || result.outcome !== "points_awarded") {
          throw new Error(result.error || `Game submission failed (${response.status}). Please try again.`);
        }
        if (activityType === "movie_guess" || activityType === "audio_guess") {
          setMovieGuessFeedback({
            levelId: activeLevelModal.id,
            correct: true,
            message: `Correct! +${result.pointsAwarded || 0} points awarded. Challenge completed.`,
            attemptsRemaining: Math.max(0, Number(result.attemptsRemaining) || 0),
          });
        }
        liveSyncSequence.current += 1;
        setProgress((current) => ({
          ...current,
          ...result.progressSummary,
          totalPoints: result.progressSummary?.totalPoints ?? current.totalPoints + (result.pointsAwarded || 0),
        }));
        setLevels((current) => current.map((level) =>
          level.id === result.completedLevelId || level.levelNumber === result.completedLevelNumber
            ? { ...level, state: "COMPLETED" as const }
            : level,
        ));
        setActiveLevelModal(null);
        setSubmissionFeedback({
          outcome: "points_awarded",
          pointsAwarded: result.pointsAwarded,
          message: result.message || "Challenge complete! Points added.",
        });
        void fetchLiveUpdates();
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Could not submit the completed game. Please try again.";
        if (activityType === "movie_guess" || activityType === "audio_guess") {
          setMovieGuessFeedback({
            levelId: activeLevelModal.id,
            correct: false,
            message,
            attemptsRemaining: Math.max(0, 3 - (activeLevelModal.movieGuessAttemptsUsed || 0)),
          });
        } else {
          setSpecialActivityError(message);
        }
      }).finally(() => setIsSpecialActivitySubmitting(false));
      return;
    }
    if (activityType === "spin_wheel") {
      setIsSpinFlowBusy(true);
      void sendSpinRequest(form, false);
      return;
    }
    activityFetcher.submit(form, {
      method: "post",
      action: `${proxyBasePath}/campaigns/${encodeURIComponent(campaign.slug)}`,
      encType: "application/x-www-form-urlencoded",
    });
  }, [activeLevelModal, activityFetcher, campaign.slug, customerId, fetchLiveUpdates, progress, proxyBasePath, sendSpinRequest]);

  const handlePrepareSpin = useCallback(() => {
    if (!activeLevelModal || !customerId) return;
    setSpinError(null);
    const form = new FormData();
    form.append("actionType", "prepare_spin");
    form.append("levelId", activeLevelModal.id);
    form.append("customerId", customerId);
    setIsSpinFlowBusy(true);
    void sendSpinRequest(form, true);
  }, [activeLevelModal, customerId, sendSpinRequest]);

  useEffect(() => {
    if (!activeLevelModal && !submissionFeedback) return;
    const bodyOverflow = document.body.style.overflow;
    const rootOverflow = document.documentElement.style.overflow;
    const bodyOverscroll = document.body.style.overscrollBehavior;
    const rootOverscroll = document.documentElement.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    document.documentElement.style.overscrollBehavior = "none";
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = rootOverflow;
      document.body.style.overscrollBehavior = bodyOverscroll;
      document.documentElement.style.overscrollBehavior = rootOverscroll;
    };
  }, [activeLevelModal, submissionFeedback]);

  // Keep Levels 1–9 in the challenge grid and feature the final announcement separately.
  const row1Levels = levels.slice(0, 5);
  const row2Levels = levels.slice(5, 9);
  const finalLevel = levels.find((level) => level.levelNumber === 10);
  const activeChallengeConfig = activeLevelModal?.config && typeof activeLevelModal.config === "object" && !Array.isArray(activeLevelModal.config)
    ? activeLevelModal.config as Record<string, unknown>
    : {};
  const challengeSteps = Array.isArray(activeChallengeConfig.steps)
    ? activeChallengeConfig.steps.filter((step): step is string => typeof step === "string")
    : [];

  return (
    <AppProxyProvider appUrl={initialData.appUrl}>
    <div className="navratri-game-root">
      {navigation.state === "loading" && !activeLevelModal && !submissionFeedback && <CampaignLoadingScreen message="Opening your Navratri challenge…" />}
      {/* Hidden React Router submission forms */}
      <Form id="action-form" method="post" style={{ display: "none" }} />
      <Form id="multipart-form" method="post" encType="multipart/form-data" style={{ display: "none" }} />

      {/* Temporarily disabled side videos; uncomment this block and the imports above to restore them.
      <div className="campaign-side-dancers" aria-hidden="true">
        <img className="campaign-side-dancer campaign-side-dancer-left" src={dancerVideoV1} alt="" />
        <img className="campaign-side-dancer campaign-side-dancer-right" src={dancerVideoV2} alt="" />
      </div>
      */}

      <div className="navratri-content-container">
        {/* ================= TOP HEADER BAR ================= */}
        <header className="nav-top-header" style={{ justifyContent: "space-between" }}>
          <div className="nav-header-left">
            <div className="live-pill">
              <span className="live-dot" />
              <span>{isLive ? "Live" : "Reconnecting"}</span>
            </div>

            <div className="user-greeting-pill">
              <span>
                {isAuthenticated
                  ? `Welcome, ${initialData.progress.displayName || "Player"}`
                  : "Welcome, Festive Guest"}
              </span>
              <span style={{ fontSize: "10px", color: "#fbbf24" }}>▾</span>
            </div>

          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", justifyContent: "flex-end" }}>
            {isAuthenticated && (
              <a href={resolvedLogoutUrl} target="_top" rel="noreferrer" className="back-to-store-link" aria-label="Log out of your store account">
                Log out
              </a>
            )}
            <a href="https://aghoristore.com" target="_top" rel="noreferrer" className="back-to-store-link" aria-label="Shop now on Aghori Store">
              🛍️ Shop Now
            </a>
          </div>

        </header>

        {/* ================= HERO TITLE BANNER ================= */}
        <div className="nav-hero-section">
          <LotusOrnament />
          <h1 className="hero-main-title">Navratri 2026</h1>
          <div className="hero-subtitle">
            10 Challenges • 1000 Points • Exclusive Rewards
          </div>
          <p className="hero-description">
            Unlock each day, complete the challenge, earn points and win amazing rewards!
          </p>
          <div style={{ marginTop: "14px" }}>
            <LotusOrnament />
          </div>
        </div>

        {/* ================= LOGIN CARD (Unauthenticated Visitors) ================= */}
        {!isAuthenticated && (
          <div className="navratri-login-card">
            <div className="login-card-icon">🪔</div>
            <h2 className="login-card-title">Login to join Navratri 2026</h2>
            <p className="login-card-desc">
              Sign in with your store account to start Day 1, collect 1,000 points across 9 daily challenges, and unlock exclusive festive rewards!
            </p>
            <a href={loginUrl} className="login-card-cta" data-gokwik-login="true" data-redirect-url={typeof window !== "undefined" ? window.location.pathname + window.location.search : returnPath} style={{ display: "inline-block", textDecoration: "none" }}>
              Login to Continue →
            </a>
          </div>
        )}

        {/* Action Flash Feedback */}
        {actionData?.message && (
          <div
            style={{
              maxWidth: "680px",
              margin: "0 auto 20px auto",
              padding: "12px 20px",
              borderRadius: "14px",
              background: "rgba(16, 54, 119, 0.92)",
              border: "1.5px solid #93c5fd",
              color: "#fef08a",
              fontWeight: 700,
              fontSize: "14px",
              textAlign: "center",
              boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
            }}
          >
            {actionData.message}
          </div>
        )}

        {actionData?.error && (
          <div
            style={{
              maxWidth: "680px",
              margin: "0 auto 20px auto",
              padding: "12px 20px",
              borderRadius: "14px",
              background: "rgba(127, 29, 29, 0.9)",
              border: "1.5px solid #fca5a5",
              color: "#fff",
              fontWeight: 700,
              fontSize: "14px",
              textAlign: "center",
              boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
            }}
          >
            {actionData.error}
          </div>
        )}

        {/* ================= POINTS / HUD CARD ================= */}
        <div className="points-hud-wrapper">
          <div className="points-hud-card">
            {/* Left: Your Points */}
            <div className="hud-stat-left">
              <div className="hud-icon-circle hud-points-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" role="presentation"><path d="m12 2.8 2.78 5.64 6.22.9-4.5 4.39 1.06 6.19L12 17l-5.56 2.92 1.06-6.19L3 9.34l6.22-.9L12 2.8Z" /></svg>
              </div>
              <div>
                <div className="hud-stat-label">Your Points</div>
                <div className="hud-stat-val">
                  {progress.totalPoints} <span className="pts-unit">/ {pointsBarMax} pts</span>
                </div>
              </div>
            </div>

            {/* Center: Progress Bar */}
            <div className="hud-progress-center">
              <div className="hud-progress-bar-bg">
                <div className="hud-progress-bar-fill" style={{ width: `${percentage}%` }} />
              </div>
              <div className="hud-progress-percent">{percentage}%</div>
              <div style={{ fontSize: "11px", color: "#cbd5e1", marginTop: "8px", textAlign: "center", lineHeight: 1.3 }}>
                Complete 1,000 points to become eligible<br />for the ₹1,500–₹2,000 gift.
              </div>
            </div>

            {/* Right: Reward */}
            <div className="hud-stat-right">
              <div className="hud-icon-circle">🏆</div>
              <div>
                <div className="hud-reward-copy">
                  <div className="hud-stat-label">Reward</div>
                  <div className="hud-stat-val" style={{ color: "#fbbf24", fontSize: "14px" }}>
                    {reward?.discountCode ? <><span className="hud-reward-code-label">Code: </span>{reward.discountCode}</> : "₹1,500–₹2,000 Gift"}
                  </div>
                </div>
                {reward?.discountCode && <button
                  type="button"
                  className="hud-copy-code"
                  aria-label={rewardCodeCopied ? "Reward code copied" : "Copy reward code"}
                  title={rewardCodeCopied ? "Copied" : "Copy reward code"}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(reward.discountCode!);
                      setRewardCodeCopied(true);
                      window.setTimeout(() => setRewardCodeCopied(false), 1800);
                    } catch {
                      setRewardCodeCopied(false);
                    }
                  }}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="7" width="12" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2" /></svg>
                </button>}
              </div>
            </div>
          </div>
        </div>

        {/* ================= 10 CHALLENGE MAP SECTION ================= */}
        {/* Responsive 5 + 4 Card Grid */}
        <div className="challenge-grid-5plus4">
          <div className="challenge-row-1">
            {row1Levels.map((lvl) => renderGameCard(lvl))}
          </div>
          <div className="challenge-row-2">
            {row2Levels.map((lvl) => renderGameCard(lvl))}
          </div>
        </div>
        {finalLevel && <div className="final-level-feature">{renderGameCard(finalLevel)}</div>}
        {/* Footer Flourish */}
        <div className="nav-footer-flourish">
          <span>✦ Play</span>
          <span>✦ Participate</span>
          <span>✦ Win ✦</span>
        </div>

        {/* Leaderboard and points feed */}
        {isAuthenticated && (
          <div className="customer-insights-row">
            <div className="customer-insights-leaderboard">
              <LeaderboardSection leaderboard={leaderboard} />
            </div>

            {/* Points Activity Feed */}
            <div
              className="customer-insights-activity"
              style={{
                background: "rgba(4, 25, 67, 0.9)",
                borderRadius: "20px",
                padding: "24px",
                border: "1.5px solid rgba(245, 158, 11, 0.3)",
                backdropFilter: "blur(10px)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <h3 style={{ fontSize: "16px", fontWeight: 800, color: "#fef08a", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
                  <span>🪙</span> Your Activity & Points Feed
                </h3>
                <span style={{ fontSize: "11px", color: "#94a3b8" }}>Real-time updates</span>
              </div>

              {transactions.length === 0 ? (
                <div style={{ textAlign: "center", color: "#94a3b8", fontSize: "13px", padding: "20px 0" }}>
                  Complete challenges to start earning your points history!
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {transactions.map((t) => (
                    <div
                      key={t.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "12px 16px",
                        background: "rgba(15, 23, 42, 0.5)",
                        borderRadius: "10px",
                        border: "1px solid rgba(255, 255, 255, 0.06)",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "13px", color: "#e2e8f0" }}>
                          {t.description || t.transactionType}
                        </div>
                        <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "2px" }}>
                          {new Date(t.createdAt).toLocaleDateString()} at{" "}
                          {new Date(t.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </div>
                      <div style={{ fontWeight: 800, color: "#60a5fa", fontSize: "14px" }}>
                        +{t.points} pts
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ================= ACTIVITY MODAL ================= */}
      {activeLevelModal && typeof document !== "undefined" && createPortal(
        <div className="festive-modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setActiveLevelModal(null); }} onKeyDown={(event) => { if (event.key === "Escape") setActiveLevelModal(null); }}>
          {/* Submission loading overlay */}
          {(isSubmitting || isSpinSubmitting || isSpinFlowBusy) && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(3, 16, 46, 0.9)",
                zIndex: 10001,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "16px",
                borderRadius: "24px",
              }}
            >
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  border: "4px solid rgba(254,240,138,0.3)",
                  borderTopColor: "#fef08a",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                }}
              />
              <span style={{ color: "#fef08a", fontWeight: 800, fontSize: "15px" }}>{isSpinFlowBusy ? "Submitting your spin…" : "Submitting Challenge…"}</span>
              <style>{"@keyframes spin { to { transform: rotate(360deg); } }"}</style>
            </div>
          )}

          <div className={`festive-modal-card festive-challenge-dialog festive-modal-card--${activeLevelModal.activityType} festive-modal-card--day-${activeLevelModal.levelNumber}`} role="dialog" aria-modal="true" aria-labelledby="active-challenge-title">
            <button
              type="button"
              className="festive-modal-close-btn"
              onClick={() => setActiveLevelModal(null)}
              title="Close"
              aria-label="Close challenge"
            >
              ✕
            </button>

            <div className="festive-modal-content">
            <div className="festive-modal-heading">
              <span
                className="challenge-reward-badge"
                style={{
                  fontSize: "11px",
                  fontWeight: 800,
                  padding: "4px 10px",
                  borderRadius: "12px",
                  color: "#ffffff",
                  letterSpacing: "0.5px",
                }}
              >
                DAY {activeLevelModal.levelNumber} CHALLENGE
              </span>
              <h3 id="active-challenge-title" style={{ margin: "10px 0 4px 0", fontSize: "20px", fontWeight: 800, color: "#fef08a", fontFamily: "var(--font-serif)" }}>
                {activeLevelModal.title}
              </h3>
              {activeLevelModal.description && (
                <p className="challenge-intro">
                  {activeLevelModal.description}
                </p>
              )}
              {(challengeSteps.length > 0 || typeof activeChallengeConfig.requirement === "string") && (
                <section className="challenge-guidance" aria-label="Challenge instructions and requirement">
                  {challengeSteps.length > 0 && (
                    <>
                      <h4>How to Complete</h4>
                      <ol>
                        {challengeSteps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}
                      </ol>
                    </>
                  )}
                  {typeof activeChallengeConfig.requirement === "string" && (
                    <p className="challenge-requirement"><strong>Challenge Requirement:</strong> {activeChallengeConfig.requirement}</p>
                  )}
                </section>
              )}
              {activeLevelModal.state === "REJECTED" && activeLevelModal.submission?.adminNote && (
                <p role="alert" style={{ margin: "10px 0 0", padding: 10, borderRadius: 8, background: "#fff7ed", border: "1px solid #fdba74", color: "#9a3412", fontSize: 13 }}>
                  Reviewer feedback: {activeLevelModal.submission.adminNote}. Update your response and submit again.
                </p>
              )}
            </div>

            {/* Render Resolved Activity */}
            {activeLevelModal.activityType === "quiz" && (
              <QuizActivity
                levelId={activeLevelModal.id}
                points={activeLevelModal.points}
                config={(activeLevelModal.config as QuizConfig) || {}}
                onSubmit={handleQuizSubmit}
                isSubmitting={isQuizSubmitting}
                error={quizError}
              />
            )}

            {activeLevelModal.activityType === "photo_upload" && (
              <PhotoUploadActivity
                levelId={activeLevelModal.id}
                config={(activeLevelModal.config as PhotoConfig) || {}}
                onSubmit={handlePhotoSubmit}
                isSubmitting={isSubmitting || isPhotoUploading}
                error={photoUploadError || actionData?.error}
              />
            )}

            {activeLevelModal.activityType === "text_submission" && (
              <TextSubmissionActivity
                levelId={activeLevelModal.id}
                config={(activeLevelModal.config as TextConfig) || {}}
                onSubmit={handleTextSubmit}
                isSubmitting={isTextSubmitting}
                error={textError}
                winnerAnnouncements={initialData.winnerAnnouncements}
              />
            )}

            {activeLevelModal.activityType === "final_submission" && (
              <FinalSubmissionActivity
                levelId={activeLevelModal.id}
                points={activeLevelModal.points}
                config={(activeLevelModal.config as FinalConfig) || {}}
                onSubmit={handleFinalSubmit}
                isSubmitting={isSubmitting}
                error={actionData?.error}
              />
            )}

            {["spin_wheel", "treasure_hunt", "memory_game", "movie_guess", "audio_guess", "purchase"].includes(activeLevelModal.activityType) && (
              <SpecialActivity
                activityType={activeLevelModal.activityType}
                levelNumber={activeLevelModal.levelNumber}
                campaignSlug={initialData.campaign.slug}
                points={activeLevelModal.points}
                config={(activeLevelModal.config as Record<string, unknown>) || {}}
                onComplete={handleSpecialActivity}
                onPrepareSpin={handlePrepareSpin}
                spinPrize={spinPrize}
                attemptsRemaining={activeLevelModal.activityType === "movie_guess"
                  ? (movieGuessFeedback?.levelId === activeLevelModal.id
                    ? movieGuessFeedback.attemptsRemaining
                    : Math.max(0, 3 - (activeLevelModal.movieGuessAttemptsUsed || 0)))
                  : undefined}
                isSubmitting={activeLevelModal.activityType === "memory_game" || activeLevelModal.activityType === "movie_guess" || activeLevelModal.activityType === "audio_guess"
                  ? isSpecialActivitySubmitting
                  : isSubmitting || activityFetcher.state !== "idle" || isSpinSubmitting}
                error={activeLevelModal.activityType === "spin_wheel"
                  ? spinError
                  : activeLevelModal.activityType === "memory_game"
                    ? specialActivityError
                    : activityFetcher.data && "error" in activityFetcher.data ? activityFetcher.data.error : actionData?.error}
                answerFeedback={(activeLevelModal.activityType === "movie_guess" || activeLevelModal.activityType === "audio_guess") && movieGuessFeedback?.levelId === activeLevelModal.id
                  ? { correct: movieGuessFeedback.correct, message: movieGuessFeedback.message }
                  : undefined}
                storefrontUrl={storefrontUrl}
              />
            )}

            {!new Set(["quiz", "photo_upload", "text_submission", "final_submission", "spin_wheel", "treasure_hunt", "memory_game", "movie_guess", "audio_guess", "purchase"]).has(activeLevelModal.activityType) && (
              <p role="status" style={{ textAlign: "center", padding: "20px", color: "#7c2d12" }}>
                This saved challenge type is no longer supported. Please contact the store team to update this level.
              </p>
            )}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {submissionFeedback && (
        <div className="festive-modal-overlay" role="presentation">
          <section
            className={`festive-modal-card festive-modal-card--${submissionFeedback.outcome}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="submission-feedback-title"
            style={{ textAlign: "center", maxWidth: "440px" }}
          >
            <button
              type="button"
              className="festive-modal-close-btn"
              onClick={() => setSubmissionFeedback(null)}
              title="Close"
              aria-label="Close submission confirmation"
            >
              ✕
            </button>
            <div style={{ fontSize: "42px", margin: "8px 0 12px" }} aria-hidden="true">
              {submissionFeedback.outcome === "pending_review" ? "⏳" : "🎉"}
            </div>
            <h2
              id="submission-feedback-title"
              style={{ margin: "0 0 10px", color: "#fef08a", fontFamily: "var(--font-serif)" }}
            >
              {submissionFeedback.prizeLabel ? "You got this offer!" : submissionFeedback.outcome === "feedback_submitted" ? "Feedback saved" : submissionFeedback.outcome === "points_awarded" ? "Points earned!" : "Submission received"}
            </h2>
            {submissionFeedback.outcome === "points_awarded" ? (
              <>
                <p style={{ color: "#d1fae5", margin: "0 0 8px" }}>
                  {submissionFeedback.offerMessage || submissionFeedback.message || (submissionFeedback.prizeLabel ? `Congratulations! You won ${submissionFeedback.prizeLabel}.` : "Your challenge is complete!")}
                </p>
                <div style={{ color: "#fbbf24", fontSize: "32px", fontWeight: 900, marginBottom: "10px" }}>
                  +{submissionFeedback.quizPointsTotal ?? submissionFeedback.pointsAwarded ?? 0} points{submissionFeedback.quizPointsTotal != null ? " for this quiz" : ""}
                </div>
                {submissionFeedback.discountCode ? (
                  <div style={{ display: "grid", gap: 10, margin: "0 0 18px" }}>
                    <div style={{ color: "#ffe7a5", fontSize: 12, fontWeight: 800, textTransform: "uppercase" }}>
                      Your personal {submissionFeedback.discountPercent}% discount code
                    </div>
                    <code style={{ padding: "11px 14px", border: "1px dashed #fbbf24", borderRadius: 10, color: "#fff", fontSize: 20, letterSpacing: 2, background: "#210f18" }}>{submissionFeedback.discountCode}</code>
                    <div style={{ maxWidth: 340, color: "#fff4ce", fontSize: 14, lineHeight: 1.5 }}>Copy this code and enter it at checkout to apply your offer. It is valid for one use.</div>
                    <a href={submissionFeedback.useNowUrl} target="_top" rel="noreferrer" style={{ padding: "12px 18px", borderRadius: 12, background: "linear-gradient(135deg,#8d101e,#bc7a1c)", border: "1px solid #e8bb5f", color: "#fff4ce", fontWeight: 900, textDecoration: "none" }}>Shop now — apply my code</a>
                    <a href="https://aghoristore.com" target="_top" rel="noreferrer" style={{ color: "#ffe7a5", fontWeight: 800 }}>Shop now</a>
                  </div>
                ) : <p style={{ color: "#cbd5e1", margin: "0 0 20px" }}>Your points have been added to your score.</p>}
              </>
            ) : (
              <>
                <p style={{ color: "#d1fae5", lineHeight: 1.6, margin: "0 0 8px" }}>
                  {submissionFeedback.message}
                </p>
                <p style={{ color: "#cbd5e1", lineHeight: 1.6, margin: "0 0 22px" }}>
                  {submissionFeedback.outcome === "feedback_submitted" ? "No points are awarded for Level 10 feedback." : "Points will be added if your entry is approved."}
                </p>
              </>
            )}
            <button
              type="button"
              onClick={() => setSubmissionFeedback(null)}
              style={{
                padding: "12px 28px",
                borderRadius: "12px",
                border: "1px solid #fbbf24",
                background: "linear-gradient(135deg, #d97706 0%, #b45309 100%)",
                color: "#fff",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              {submissionFeedback.outcome === "points_awarded" ? "Got it — level complete" : "Continue"}
            </button>
          </section>
        </div>
      )}

      {/* Winner Popup Modal */}
      <WinnerPopupModal
        isOpen={showWinnerPopup}
        onClose={handleCloseWinnerPopup}
        rank={initialData.winnerDetails?.rank}
        prizeValue={initialData.winnerDetails?.prizeValue}
      />
    </div>
    </AppProxyProvider>
  );

  /**
   * Helper function to render a Game Card based on its state
   */
  function renderGameCard(lvl: (typeof levels)[0]) {
    const quizQuestionCount = Array.isArray((lvl.config as QuizConfig | undefined)?.questions)
      ? (lvl.config as QuizConfig).questions?.length || 0
      : 0;
    const displayPoints = lvl.levelNumber === 10 ? 0 : lvl.activityType === "quiz" ? Math.max(1, quizQuestionCount) * 50 : lvl.points;
    const isCompleted = lvl.state === "COMPLETED";
    const isPending = lvl.state === "PENDING";
    const isRejected = lvl.state === "REJECTED";
    const isLocked = lvl.state === "LOCKED" || (lvl.levelNumber > currentAvailableLevel && !isCompleted && !isPending && !isRejected);

    // LOCKED / SURPRISE MYSTERY CARD (Deep Navy-Purple)
    if (isLocked) {
      let countdownStr = "";
      if (lvl.availableFrom) {
        const availableFromMs = new Date(lvl.availableFrom).getTime();
        const diff = Math.max(0, availableFromMs - now);
        if (diff > 0 && diff < 14 * 24 * 60 * 60 * 1000) { // Only show if less than 14 days
          const hrs = Math.floor(diff / (1000 * 60 * 60));
          const mins = Math.floor((diff / (1000 * 60)) % 60);
          const secs = Math.floor((diff / 1000) % 60);
          countdownStr = `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
      }

      return (
        <div
          key={lvl.id}
          className="game-card-mystery"
          onClick={() => { if (lvl.state === "AVAILABLE") handleOpenLevel(lvl); }}
          title={`Day ${lvl.levelNumber} - Surprise Challenge`}
        >
          <div className="mystery-card-top-bar">
            <span className="day-badge-purple">DAY {lvl.levelNumber}</span>
            <span className="lock-icon-gold" aria-label="Locked">
              <img src={lockImage} alt="" />
            </span>
          </div>

          <div className="mystery-center-graphic">
            <MysteryMandalaPattern />
            <div className="gift-box-artwork" role="img" aria-label="Mystery gift box" />
          </div>

          <div className="mystery-ribbon-banner">
            {countdownStr ? `UNLOCKS IN ${countdownStr}` : "SURPRISE CHALLENGE"}
          </div>
        </div>
      );
    }

    // ACTIVE / AVAILABLE CARD (Cream / Festive Gold)
    if (lvl.levelNumber === 10) {
      return (
        <div
          key={lvl.id}
          className="game-card-active final-level-card"
          onClick={() => handleOpenLevel(lvl)}
          id={`level-card-day-${lvl.levelNumber}`}
        >
          <div className="active-card-top-bar final-card-top-bar">
            <span className="day-badge-orange final-day-badge">✦ LEVEL 10 ✦</span>
            {isCompleted ? (
              <div className="check-circle-green">✓</div>
            ) : isPending ? (
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#d97706" }}>⏳ Reviewing</span>
            ) : isRejected ? (
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#dc2626" }}>Submission closed</span>
            ) : (
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#fef08a" }}>FINAL CHALLENGE</span>
            )}
          </div>

          <div className="final-level-ornament">
             <KalashArtwork />
          </div>

          <div className="active-card-body">
            <h3 className="active-card-title final-card-title">{lvl.title}</h3>
            <p className="active-card-desc final-card-desc">
              {lvl.description || `Complete the final challenge and reach the reward milestone.`}
            </p>
          </div>

          <div>
            {isCompleted ? (
              <button type="button" className="active-card-btn completed" disabled>
                Feedback submitted ✓
              </button>
            ) : isPending ? (
              <button type="button" className="active-card-btn" disabled style={{ background: "#fef3c7", color: "#92400e", borderColor: "#fde68a", cursor: "not-allowed" }}>
                Under Review ⏳
              </button>
            ) : isRejected ? (
              <button type="button" className="active-card-btn" onClick={(event) => { event.stopPropagation(); handleOpenLevel(lvl); }} style={{ background: "#fff7ed", color: "#9a3412", borderColor: "#fdba74" }}>
                Update &amp; Resubmit
              </button>
            ) : (
              <button
                type="button"
                id={`start-level-${lvl.levelNumber}-btn`}
                className="active-card-btn final-card-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenLevel(lvl);
                }}
              >
                Start Final Challenge ➔
              </button>
            )}
          </div>

          <ActiveCardSideDecor />
          <CardCornerDecor />
        </div>
      );
    }

    return (
      <div
        key={lvl.id}
        className="game-card-active"
        onClick={() => handleOpenLevel(lvl)}
        id={`level-card-day-${lvl.levelNumber}`}
      >
        <div className="active-card-top-bar">
          <span className="day-badge-orange">DAY {lvl.levelNumber}</span>
          {isCompleted ? (
            <div className="check-circle-green">✓</div>
          ) : isPending ? (
            <span style={{ fontSize: "11px", fontWeight: 700, color: "#d97706" }}>⏳ Reviewing</span>
          ) : isRejected ? (
            <span style={{ fontSize: "11px", fontWeight: 700, color: "#dc2626" }}>Submission closed</span>
          ) : (
            <span style={{ fontSize: "11px", fontWeight: 700, color: "#1d4ed8" }}>{lvl.levelNumber === 10 ? null : `+${displayPoints} pts`}</span>
          )}
        </div>

        {/* Festive Artwork (Kalash on Day 1, or dynamic icon) */}
        <KalashArtwork />

        <div className="active-card-body">
          <h3 className="active-card-title">{lvl.title}</h3>
          <p className="active-card-desc">
            {lvl.description || `Complete Day ${lvl.levelNumber} activity to collect ${displayPoints} points.`}
          </p>
        </div>

        <div>
          {isCompleted ? (
            <button type="button" className="active-card-btn completed" disabled>
              {lvl.levelNumber === 10 ? "Feedback submitted ✓" : `Earned ✓ (+${displayPoints} pts)`}
            </button>
          ) : isPending ? (
            <button type="button" className="active-card-btn" disabled style={{ background: "#fef3c7", color: "#92400e", borderColor: "#fde68a", cursor: "not-allowed" }}>
              Under Review ⏳
            </button>
          ) : isRejected ? (
            <button type="button" className="active-card-btn" onClick={(event) => { event.stopPropagation(); handleOpenLevel(lvl); }} style={{ background: "#fff7ed", color: "#9a3412", borderColor: "#fdba74" }}>
              Update &amp; Resubmit
            </button>
          ) : (
            <button
              type="button"
              id={`start-level-${lvl.levelNumber}-btn`}
              className="active-card-btn"
              onClick={(e) => {
                e.stopPropagation();
                handleOpenLevel(lvl);
              }}
            >
              Start Challenge ➔
            </button>
          )}
        </div>

        {/* Decorative side leaf/flower embellishments */}
        <ActiveCardSideDecor />

        {/* Decorative corner embellishments */}
        <CardCornerDecor />
      </div>
    );
  }
}

function CampaignLoadingScreen({ message }: { message: string }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "radial-gradient(circle at 50% 20%, #123872 0%, #07183c 50%, #030b20 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        padding: "20px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          background: "linear-gradient(180deg, #123872 0%, #07183c 100%)",
          borderRadius: "50%",
          width: 116,
          height: 116,
          display: "grid",
          placeItems: "center",
          position: "relative",
          flex: "0 0 auto",
          boxShadow: "0 0 38px rgba(245, 158, 11, 0.3)",
          border: "2px solid #f59e0b",
          color: "#ffffff",
        }}
      >
        <div className="navratri-loading-ring" aria-hidden="true" />
        <div style={{ fontSize: 44, lineHeight: 1 }} aria-hidden="true">🪔</div>
        <span className="navratri-visually-hidden" role="status" aria-live="polite">{message}</span>
      </div>
      <p
        style={{
          position: "absolute",
          top: "calc(50% + 82px)",
          left: 16,
          right: 16,
          margin: 0,
          textAlign: "center",
          color: "#fef08a",
          fontFamily: "var(--font-serif)",
          fontSize: 17,
          fontWeight: 800,
        }}
      >
        {message}
      </p>
    </div>
  );
}

export function HydrateFallback() {
  return <CampaignLoadingScreen message="Preparing your Navratri challenge…" />;
}

/** Retry transient storefront/app-proxy load failures before showing an action. */
export function ErrorBoundary() {
  const error = useRouteError();
  const [retryCount, setRetryCount] = useState<number | null>(null);

  useEffect(() => {
    console.error("Navratri campaign route failed to load:", error);
    let retries = 0;
    try {
      retries = Number(window.sessionStorage.getItem("navratri-campaign-load-retries") || 0);
      setRetryCount(retries);
      if (retries < 2) {
        window.sessionStorage.setItem("navratri-campaign-load-retries", String(retries + 1));
        const timer = window.setTimeout(() => window.location.reload(), 900);
        return () => window.clearTimeout(timer);
      }
    } catch {
      setRetryCount(2);
    }
  }, [error]);

  if (retryCount === null || retryCount < 2) {
    return <CampaignLoadingScreen message="Preparing your Navratri challenge…" />;
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at 50% 20%, #123872 0%, #07183c 50%, #030b20 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        padding: 20,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          background: "linear-gradient(180deg, #123872 0%, #07183c 100%)",
          borderRadius: 24,
          padding: "36px 30px",
          maxWidth: 440,
          width: "100%",
          textAlign: "center",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6), 0 0 30px rgba(245,158,11,.25)",
          border: "2px solid #f59e0b",
          color: "white",
        }}
      >
        <div style={{ fontSize: 42, marginBottom: 12 }} aria-hidden="true">🪔</div>
        <h1 style={{ fontSize: 21, fontWeight: 800, color: "#fef08a", margin: "0 0 10px", fontFamily: "var(--font-serif)" }}>
          We’re reconnecting your challenge
        </h1>
        <p style={{ color: "#cbd5e1", fontSize: 14, margin: "0 0 22px", lineHeight: 1.6 }}>
          The challenge could not connect after a few attempts. Please try loading it again.
        </p>
        <button
          onClick={() => {
            try { window.sessionStorage.removeItem("navratri-campaign-load-retries"); } catch { /* ignore */ }
            window.location.reload();
          }}
          style={{
            padding: "12px 26px",
            borderRadius: 20,
            background: "linear-gradient(135deg,#d97706,#b45309)",
            border: "1px solid #fde047",
            color: "white",
            fontWeight: 800,
            fontSize: 14,
            cursor: "pointer",
            boxShadow: "0 4px 16px rgba(217,119,6,.4)",
          }}
        >
          Try loading again
        </button>
      </div>
    </div>
  );
}
