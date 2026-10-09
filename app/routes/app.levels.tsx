import { useState, useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getActiveCampaign } from "../services/campaign.server";
import prisma from "../db.server";
import { campaignLevelTemplate } from "../services/campaign-level-template";
import { QuizQuestionEditor } from "../components/activities/QuizQuestionEditor";
import type { Prisma } from "@prisma/client";

const defaultActivityConfig: Record<string, Record<string, unknown>> = {
  spin_wheel: { rewards: ["10% OFF", "15% OFF", "20% OFF"], discountPercent: 10, wheelTitle: "SPIN TO WIN", wheelRibbonText: "FORTUNE WHEEL", spinButtonText: "Spin & Win", instructions: "Spin the wheel and unlock your Navratri surprise!", offerMessage: "Congratulations! You got this offer. Your code is ready to use at checkout." },
  treasure_hunt: { eligibleProductHandles: [], eligibleCategories: [], buttonLabel: "Claim the Navratri treasure", buttonIcon: "🎁", buttonPosition: "relative", maxAttempts: 3 },
  memory_game: { pairs: 8, cards: ["🪔", "🥁", "🪘", "💃", "👗", "🌸", "🛕", "🎶"], timerSeconds: 90, maxAttempts: 30, difficulty: "medium" },
  movie_guess: { clue: "👨‍👨‍👦👶🏠😂", answer: "Golmaal 3", acceptedAnswers: ["Golmaal Three", "Golmaal III"], options: [] },
  audio_guess: { audioUrl: "", prompt: "Listen to the clip and enter the song or tune name.", answer: "", acceptedAnswers: [] },
  purchase: { eligibleProductIds: [], minimumOrderValue: 299, verification: "paid_order" },
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const campaign = await getActiveCampaign(session.shop);

  if (!campaign) {
    return { campaign: null, levels: [], products: [], collections: [] };
  }

  const [levels, catalog] = await Promise.all([
    prisma.level.findMany({ where: { campaignId: campaign.id }, orderBy: { levelNumber: "asc" } }),
    admin.graphql(`#graphql
      query NavratriTreasureCatalog {
        products(first: 100) { nodes { id title handle } }
        collections(first: 100) { nodes { id title handle } }
      }
    `).then((response) => response.json()).catch(() => null),
  ]);
  const catalogData = catalog as {
    data?: {
      products?: { nodes?: Array<{ id: string; title: string; handle: string }> };
      collections?: { nodes?: Array<{ id: string; title: string; handle: string }> };
    };
  } | null;

  return {
    campaign: {
      id: campaign.id,
      shop: campaign.shop,
      name: campaign.name,
      slug: campaign.slug,
      maxPoints: campaign.maxPoints,
    },
    themeEmbedSetupUrl: (() => {
      const url = new URL(`https://${session.shop}/admin/themes/current/editor`);
      url.searchParams.set("context", "apps");
      url.searchParams.set("template", "product");
      url.searchParams.set("activateAppId", "d6df797638ae5c7f928c25df490169d3/treasure_embed");
      return url.toString();
    })(),
    levels,
    products: catalogData?.data?.products?.nodes || [],
    collections: catalogData?.data?.collections?.nodes || [],
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const actionType = String(formData.get("actionType") || "save");
  const campaignId = String(formData.get("campaignId") || "");
  const levelId = String(formData.get("levelId") || "");
  const levelNumber = Number(formData.get("levelNumber"));
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const activityType = String(formData.get("activityType") || "quiz");
  const points = Number(formData.get("points")) || 100;
  const isActive = formData.get("isActive") === "true";

  if (!campaignId) {
    return { success: false, error: "Campaign ID missing." };
  }
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, shop: session.shop } });
  if (!campaign) return { success: false, error: "Campaign not found for this Shopify store." };

  if (actionType === "reset_campaign_data") {
    if (String(formData.get("resetConfirmation") || "").trim() !== "RESET") {
      return { success: false, error: "Type RESET exactly to confirm clearing all data for this campaign." };
    }
    const requestedProductImageUrl = String(formData.get("templateProductImageUrl") || "").trim();
    if (requestedProductImageUrl) {
      try {
        const imageUrl = new URL(requestedProductImageUrl);
        if (!["https:", "http:"].includes(imageUrl.protocol)) throw new Error();
      } catch {
        return { success: false, error: "Enter a valid HTTPS or HTTP product image URL for Level 7." };
      }
    }

    try {
      await prisma.$transaction(async (tx) => {
      const existingAudio = await tx.level.findFirst({ where: { campaignId, activityType: "audio_guess" }, select: { config: true } });
      const existingProductLevel = await tx.level.findFirst({ where: { campaignId, levelNumber: 7 }, select: { config: true } });
      const existingAudioConfig = existingAudio?.config && typeof existingAudio.config === "object" && !Array.isArray(existingAudio.config)
        ? existingAudio.config as Record<string, unknown>
        : {};
      const existingProductConfig = existingProductLevel?.config && typeof existingProductLevel.config === "object" && !Array.isArray(existingProductLevel.config)
        ? existingProductLevel.config as Record<string, unknown>
        : {};
      const productImageUrl = requestedProductImageUrl || String(existingProductConfig.imageUrl || existingProductConfig.productImageUrl || "");

      await tx.notification.deleteMany({ where: { campaignId } });
      await tx.auditEvent.deleteMany({ where: { campaignId } });
      await tx.referral.deleteMany({ where: { campaignId } });
      await tx.submission.deleteMany({ where: { campaignId } });
      await tx.customerProgress.deleteMany({ where: { campaignId } });

      for (const level of campaignLevelTemplate) {
        const config = level.levelNumber === 6
          ? {
              ...level.config,
              ...(typeof existingAudioConfig.audioUrl === "string" && existingAudioConfig.audioUrl ? { audioUrl: existingAudioConfig.audioUrl } : {}),
              ...(typeof existingAudioConfig.answer === "string" && existingAudioConfig.answer ? { answer: existingAudioConfig.answer } : {}),
              ...(Array.isArray(existingAudioConfig.acceptedAnswers) ? { acceptedAnswers: existingAudioConfig.acceptedAnswers } : {}),
            }
          : level.levelNumber === 7
            ? { ...level.config, imageUrl: productImageUrl }
            : level.config;
        await tx.level.upsert({
          where: { campaignId_levelNumber: { campaignId, levelNumber: level.levelNumber } },
          update: { title: level.title, description: level.description, activityType: level.activityType, points: level.points, config: config as Prisma.InputJsonObject, isActive: true, availableFrom: null, availableUntil: null },
          create: { campaignId, ...level, config: config as Prisma.InputJsonObject, isActive: true },
        });
      }
      await tx.level.deleteMany({ where: { campaignId, OR: [{ levelNumber: { gt: 10 } }, { levelNumber: { lt: 1 } }] } });
        await tx.campaign.update({ where: { id: campaignId }, data: { maxPoints: 1000, unlockMode: "sequential", unlockIntervalHours: 24, description: "Complete 10 festive challenges, collect 1,000 points, and unlock exclusive rewards." } });
      }, { maxWait: 15000, timeout: 30000 });
    } catch (error) {
      console.error("Campaign reset failed:", error);
      return { success: false, error: "The campaign reset did not finish; no partial reset was saved. Check the database connection and try again." };
    }

    return { success: true, message: "Campaign reset complete. Player progress, points, submissions, referrals, rewards, winners, and campaign notifications were cleared; the 10-level flow was restored." };
  }

  if (actionType === "apply_10_level_template") {
    const existingAudio = await prisma.level.findFirst({ where: { campaignId, activityType: "audio_guess" }, select: { config: true } });
    const existingAudioConfig = existingAudio?.config && typeof existingAudio.config === "object" && !Array.isArray(existingAudio.config)
      ? existingAudio.config as Record<string, unknown>
      : {};
    const productImageUrl = String(formData.get("templateProductImageUrl") || "").trim();
    try {
      const imageUrl = new URL(productImageUrl);
      if (!(["https:", "http:"].includes(imageUrl.protocol))) throw new Error();
    } catch {
      return { success: false, error: "Enter a valid HTTPS or HTTP product image URL before applying the 10-level flow." };
    }
    for (const level of campaignLevelTemplate) {
      const config = level.levelNumber === 6
        ? {
            ...level.config,
            ...(typeof existingAudioConfig.audioUrl === "string" && existingAudioConfig.audioUrl ? { audioUrl: existingAudioConfig.audioUrl } : {}),
            ...(typeof existingAudioConfig.answer === "string" && existingAudioConfig.answer ? { answer: existingAudioConfig.answer } : {}),
            ...(Array.isArray(existingAudioConfig.acceptedAnswers) ? { acceptedAnswers: existingAudioConfig.acceptedAnswers } : {}),
          }
        : level.levelNumber === 7
          ? { ...level.config, imageUrl: productImageUrl }
          : level.config;
      await prisma.level.upsert({
        where: { campaignId_levelNumber: { campaignId, levelNumber: level.levelNumber } },
        update: { title: level.title, description: level.description, activityType: level.activityType, points: level.points, config: config as Prisma.InputJsonObject, isActive: true, availableFrom: null, availableUntil: null },
        create: { campaignId, ...level, config: config as Prisma.InputJsonObject, isActive: true },
      });
    }
    await prisma.level.updateMany({ where: { campaignId, levelNumber: { gt: 10 }, isActive: true }, data: { isActive: false } });
    await prisma.campaign.update({ where: { id: campaignId }, data: { maxPoints: 1000, description: "Complete 10 festive challenges, collect 1,000 points, and unlock exclusive rewards." } });
    return { success: true, message: "The active campaign now uses the requested 10-level flow. Existing submissions, points, and winner records were preserved." };
  }

  if (actionType === "toggle_active") {
    if (!levelId) return { success: false, error: "Level ID missing" };
    const current = await prisma.level.findUnique({ where: { id: levelId } });
    if (!current || current.campaignId !== campaignId) return { success: false, error: "Level not found in this campaign." };

    const updated = await prisma.level.update({
      where: { id: levelId },
      data: { isActive: !current.isActive },
    });
    return {
      success: true,
      message: `Level ${updated.levelNumber} is now ${updated.isActive ? "active" : "disabled"}.`,
    };
  }

  if (!title) {
    return { success: false, error: "Level title cannot be empty." };
  }

  if (isNaN(levelNumber) || levelNumber < 1 || levelNumber > 10) {
    return { success: false, error: "Level number must be between 1 and 10." };
  }
  const validActivityTypes = ["quiz", "photo_upload", "text_submission", "final_submission", "spin_wheel", "treasure_hunt", "memory_game", "movie_guess", "audio_guess", "purchase"];
  if (!validActivityTypes.includes(activityType)) return { success: false, error: "Choose a supported campaign activity type." };
  if (!Number.isInteger(points) || points < 0 || points > campaign.maxPoints) {
    return { success: false, error: `Points must be between 0 and ${campaign.maxPoints}.` };
  }

  // Build activity config object based on activityType
  let config: Record<string, unknown> = {};

  if (activityType === "quiz") {
    config = {
      question: String(formData.get("quiz_question") || "").trim(),
      optionA: String(formData.get("quiz_optionA") || "").trim(),
      optionB: String(formData.get("quiz_optionB") || "").trim(),
      optionC: String(formData.get("quiz_optionC") || "").trim(),
      optionD: String(formData.get("quiz_optionD") || "").trim(),
      correctOption: String(formData.get("quiz_correctOption") || "A").trim().toUpperCase(),
    };
    const questionsJson = String(formData.get("quiz_questions_json") || "").trim();
    if (questionsJson) {
      try {
        const questions = JSON.parse(questionsJson);
        if (!Array.isArray(questions) || questions.some((question) =>
          !question || typeof question.question !== "string" || !question.question.trim() ||
          !Array.isArray(question.options) || question.options.length < 2 ||
          question.options.some((option: unknown) => typeof option !== "string" || !option.trim()) ||
          !/^[A-D]$/.test(String(question.answer || "").toUpperCase()) ||
          String(question.answer).toUpperCase().charCodeAt(0) - 65 >= question.options.length
        )) {
          return { success: false, error: "Each quiz question needs a prompt, at least two options, and a valid correct answer." };
        }
        config.questions = questions;
        config.passingScore = questions.length;
      } catch {
        return { success: false, error: "Quiz questions must contain valid JSON." };
      }
    } else if (!config.question || !config.optionA || !config.optionB || !config.correctOption) {
      return { success: false, error: "Add at least one quiz question with answer options and a correct answer." };
    }
  } else if (activityType === "photo_upload") {
    config = {
      instructions: String(formData.get("photo_instructions") || "").trim(),
      maxFileSizeMb: Number(formData.get("photo_maxSize")) || 10,
      allowedTypes: ["image/jpeg", "image/png", "image/webp"],
    };
  } else if (activityType === "text_submission") {
    const imageUrl = String(formData.get("text_imageUrl") || "").trim();
    const imageFile = formData.get("text_imageFile");
    if (imageFile instanceof File && imageFile.size > 0) return { success: false, error: "Upload the product image first; the form only accepts the finalized image URL." };
    config = {
      instructions: String(formData.get("text_instructions") || "").trim(),
      minCharacters: Number(formData.get("text_minChars")) || 20,
      maxCharacters: Number(formData.get("text_maxChars")) || 500,
      imageUrl,
      imageAlt: String(formData.get("text_imageAlt") || "Product image").trim(),
      showWinnerAnnouncements: formData.getAll("text_showWinners").includes("true"),
    };
  } else if (activityType === "final_submission") {
    config = {
      instructions: String(formData.get("final_instructions") || "").trim(),
      maxFileSizeMb: Number(formData.get("final_maxSize")) || 15,
      minCharacters: Number(formData.get("final_minChars")) || 10,
      allowedTypes: ["image/jpeg", "image/png", "image/webp"],
    };
  } else if (activityType === "movie_guess") {
    const answer = String(formData.get("movie_answer") || "").trim();
    const options = String(formData.get("movie_options") || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    const acceptedAnswers = String(formData.get("movie_accepted_answers") || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    if (!answer) return { success: false, error: "Enter the correct movie answer." };
    if (options.length === 1) return { success: false, error: "Add at least two movie choices, or leave choices empty to use a text answer." };
    const normalizeOption = (value: string) => value.normalize("NFKD").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
    if (options.length > 0 && !options.some((option) => normalizeOption(option) === normalizeOption(answer))) return { success: false, error: "The correct movie answer must also appear in the choices." };
    config = { clue: String(formData.get("movie_clue") || "🎬❓").trim(), answer, options, acceptedAnswers };
  } else if (activityType === "audio_guess") {
    const existingLevel = levelId ? await prisma.level.findFirst({ where: { id: levelId, campaignId }, select: { config: true } }) : null;
    const previousConfig = existingLevel?.config && typeof existingLevel.config === "object" ? existingLevel.config as Record<string, unknown> : {};
    const audioFile = formData.get("audio_file");
    if (audioFile instanceof File && audioFile.size > 0) return { success: false, error: "Upload the audio clip first; the form only accepts the finalized audio URL." };
    let audioUrl = String(formData.get("audio_uploadedUrl") || "").trim();
    if (!audioUrl) audioUrl = typeof previousConfig.audioUrl === "string" ? previousConfig.audioUrl : "";
    const answer = String(formData.get("audio_answer") || "").trim();
    if (!audioUrl) return { success: false, error: "Upload an audio clip before saving this activity." };
    if (!answer) return { success: false, error: "Enter the correct song or tune answer." };
    const acceptedAnswers = String(formData.get("audio_accepted_answers") || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    config = { audioUrl, prompt: String(formData.get("audio_prompt") || "Listen to the clip and enter the song or tune name.").trim(), answer, acceptedAnswers };
  }

  const advancedConfig = String(formData.get("activity_config_json") || "").trim();
  if (["spin_wheel", "treasure_hunt", "memory_game", "purchase"].includes(activityType)) {
    try {
      const parsed = JSON.parse(advancedConfig || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { success: false, error: "Activity configuration must be a JSON object." };
      }
      config = parsed as Record<string, unknown>;
      if (activityType === "spin_wheel") {
        const labels = String(formData.get("spin_rewards_lines") || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
        const discountPercent = Number(formData.get("spin_discount_percent"));
        if (labels.length) config.rewards = labels;
        config.discountPercent = Number.isFinite(discountPercent) && discountPercent >= 1 && discountPercent <= 100 ? discountPercent : 10;
        config.wheelTitle = String(formData.get("spin_wheel_title") || "SPIN TO WIN").trim();
        config.wheelRibbonText = String(formData.get("spin_ribbon_text") || "FORTUNE WHEEL").trim();
        config.spinButtonText = String(formData.get("spin_button_text") || "Spin & Win").trim();
        config.instructions = String(formData.get("spin_instructions") || "Spin the wheel and unlock your Navratri surprise!").trim();
        config.offerMessage = String(formData.get("spin_offer_message") || "Congratulations! You got this offer. Your code is ready to use at checkout.").trim();
      }
      if (activityType === "treasure_hunt") {
        config.eligibleProductHandles = formData.getAll("eligibleProductHandles").map(String).filter(Boolean);
        config.eligibleCategories = formData.getAll("eligibleCategories").map(String).filter(Boolean);
      }
      if (activityType === "purchase") {
        config.eligibleProductIds = formData.getAll("eligiblePurchaseProducts").map(String).filter(Boolean);
        config.minimumOrderValue = Math.max(299, Number(formData.get("purchase_minimum_value")) || 299);
      }
    } catch {
      return { success: false, error: "Activity configuration must contain valid JSON." };
    }
  }

  const jsonConfig = config as Prisma.InputJsonObject;

  try {
    if (levelId) {
      const current = await prisma.level.findUnique({ where: { id: levelId } });
      if (!current || current.campaignId !== campaignId) return { success: false, error: "Level not found in this campaign." };
      const occupyingLevel = levelNumber === current.levelNumber
        ? null
        : await prisma.level.findFirst({ where: { campaignId, levelNumber, id: { not: levelId } } });

      // Config can include an uploaded audio file. Persist the potentially large
      // JSON outside the short transaction so Prisma's default 5s interactive
      // transaction timeout only covers the quick level-number swap.
      await prisma.level.update({
        where: { id: levelId },
        data: { title, description, activityType, points, isActive, config: jsonConfig },
      });

      if (occupyingLevel) {
        await prisma.$transaction(async (tx) => {
          await tx.level.update({ where: { id: occupyingLevel.id }, data: { levelNumber: 0 } });
          await tx.level.update({ where: { id: levelId }, data: { levelNumber } });
          await tx.level.update({ where: { id: occupyingLevel.id }, data: { levelNumber: current.levelNumber } });
        });
      } else if (levelNumber !== current.levelNumber) {
        await prisma.level.update({ where: { id: levelId }, data: { levelNumber } });
      }

      return { success: true, message: `Level ${levelNumber} updated successfully!` };
    } else {
      const created = await prisma.level.create({
        data: {
          campaignId,
          levelNumber,
          title,
          description,
          activityType,
          points,
          isActive: true,
          config: jsonConfig,
        },
      });
      return { success: true, message: `Level ${created.levelNumber} created successfully!` };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to save level";
    return { success: false, error: msg };
  }
};

export default function LevelsPage() {
  const { campaign, levels, products, collections, themeEmbedSetupUrl } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  const [editingLevel, setEditingLevel] = useState<(typeof levels)[0] | null>(null);
  const [selectedActivityType, setSelectedActivityType] = useState<string>("quiz");
  const [activityConfigText, setActivityConfigText] = useState("{}");
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [mediaUploadMessage, setMediaUploadMessage] = useState("");

  const isSubmitting = navigation.state === "submitting";
  const levelSeven = levels.find((level) => level.levelNumber === 7);
  const levelSevenConfig = levelSeven?.config && typeof levelSeven.config === "object" ? levelSeven.config as Record<string, unknown> : {};
  const configuredProductImageUrl = String(levelSevenConfig.imageUrl || levelSevenConfig.productImageUrl || "");
  const currentProductImageUrl = configuredProductImageUrl.startsWith("r2:")
    ? `/api/media${configuredProductImageUrl.slice(3)}`
    : configuredProductImageUrl;

  const uploadAdminMedia = async (file: File, kind: "image" | "audio", form: HTMLFormElement): Promise<void> => {
    setUploadingMedia(true);
    setMediaUploadMessage(`Uploading ${kind}…`);
    try {
      const values = new FormData(form);
      const campaignId = String(values.get("campaignId") || "");
      const levelId = String(values.get("levelId") || "");
      const authorizeResponse = await fetch("/app/upload-media", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "authorize", campaignId, levelId, contentType: file.type, size: file.size }),
      });
      const authorization = await authorizeResponse.json() as { uploadUrl?: string; ticket?: string; error?: string };
      if (!authorizeResponse.ok || !authorization.uploadUrl || !authorization.ticket) throw new Error(authorization.error || "Could not authorize the upload.");
      const putResponse = await fetch(`/api/proxy-upload?target=${encodeURIComponent(authorization.uploadUrl)}`, {
        method: "PUT", credentials: "omit", headers: { "Content-Type": file.type }, body: file,
      });
      if (!putResponse.ok) throw new Error(`Storage rejected the upload (${putResponse.status}). Check the R2 bucket CORS settings.`);
      const finalizeResponse = await fetch("/app/upload-media", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "finalize", campaignId, levelId, ticket: authorization.ticket }),
      });
      const finalized = await finalizeResponse.json() as { url?: string; error?: string };
      if (!finalizeResponse.ok || !finalized.url) throw new Error(finalized.error || "Could not verify the uploaded media.");
      const field = form.elements.namedItem(kind === "image" ? "text_imageUrl" : "audio_uploadedUrl");
      if (!(field instanceof HTMLInputElement)) throw new Error("The form field for the media URL was not found.");
      field.value = finalized.url;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      setMediaUploadMessage(`${kind === "image" ? "Image" : "Audio clip"} uploaded and verified. Save the level to apply it.`);
    } catch (error) {
      setMediaUploadMessage(error instanceof Error ? error.message : "Media upload failed.");
    } finally {
      setUploadingMedia(false);
    }
  };

  useEffect(() => {
    if (actionData?.success) {
      shopify.toast.show(actionData.message || "Saved successfully!");
      setEditingLevel(null);
    } else if (actionData?.error) {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData, shopify]);

  const openEditor = (lvl: (typeof levels)[0]) => {
    setEditingLevel(lvl);
    setSelectedActivityType(lvl.activityType);
    setActivityConfigText(JSON.stringify(lvl.config || defaultActivityConfig[lvl.activityType] || {}, null, 2));
  };

  if (!campaign) {
    return (
      <s-page heading="10 Levels Management">
        <s-section heading="No Active Campaign">
          <div style={{ padding: "32px", textAlign: "center", background: "#ffffff", borderRadius: "10px", border: "1px solid #e1e3e5" }}>
            <div style={{ fontSize: "16px", fontWeight: "bold", color: "#202223" }}>No active campaign found</div>
          </div>
        </s-section>
      </s-page>
    );
  }

  // Calculate total points across all 10 levels
  const totalPointsConfigured = levels.reduce((sum, l) => sum + (l.isActive ? l.points : 0), 0);

  return (
    <s-page heading="10 Levels Management">
      {/* Header Banner */}
      <div
        style={{
          background: "#ffffff",
          borderRadius: "10px",
          padding: "20px 24px",
          border: "1px solid #e1e3e5",
          marginBottom: "24px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <div style={{ fontSize: "18px", fontWeight: "bold", color: "#202223" }}>
              🪔 10-Level Campaign Progression
            </div>
            <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "2px" }}>
              Sequential unlocking: Customers must complete Day N to unlock Day N+1.
            </div>
          </div>
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <Form method="post" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input type="hidden" name="actionType" value="apply_10_level_template" />
              <input type="hidden" name="campaignId" value={campaign.id} />
              <input type="url" name="templateProductImageUrl" placeholder="Level 7 product image URL (required)" aria-label="Product image URL for the Product Benefits challenge" defaultValue={currentProductImageUrl} required style={{ width: 250, padding: "7px 9px", border: "1px solid #d1d5db", borderRadius: 6 }} />
              <button type="submit"  disabled={isSubmitting} style={{ background: "#000", color: "#fff", padding: "10px 20px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: 600 }}>Apply 10-Level Flow</button>
            </Form>
            <span
              style={{
                background: totalPointsConfigured === 1000 ? "#dcfce7" : "#fef3c7",
                color: totalPointsConfigured === 1000 ? "#166534" : "#92400e",
                padding: "4px 12px",
                borderRadius: "12px",
                fontSize: "13px",
                fontWeight: 700,
              }}
            >
              Total Points: {totalPointsConfigured} / {campaign.maxPoints} pts
            </span>
          </div>
        </div>

        {/* 1 → 10 Sequence Visualization Flow */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginTop: "16px",
            padding: "12px",
            background: "#f9fafb",
            borderRadius: "8px",
            overflowX: "auto",
          }}
        >
          {levels.map((lvl, idx) => (
            <div key={lvl.id} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div
                onClick={() => openEditor(lvl)}
                style={{
                  cursor: "pointer",
                  padding: "6px 12px",
                  borderRadius: "6px",
                  background: lvl.isActive ? "#059669" : "#9ca3af",
                  color: "#ffffff",
                  fontSize: "12px",
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                }}
              >
                Day {lvl.levelNumber} ({lvl.points}p)
              </div>
              {idx < levels.length - 1 && <span style={{ color: "#d1d5db", fontWeight: "bold" }}>→</span>}
            </div>
          ))}
        </div>
      </div>

      <details style={{ margin: "0 0 20px", padding: "12px 16px", border: "1px solid #f0b8b8", borderRadius: 8, background: "#fffafa" }}>
        <summary style={{ cursor: "pointer", color: "#9b1c1c", fontWeight: 700 }}>Reset all campaign player data and restore these 10 levels</summary>
        <p style={{ margin: "10px 0", color: "#6b3030", fontSize: 13 }}>This permanently clears every participant&apos;s progress, points, submissions, referrals, rewards, winner entries, notifications, and campaign audit history, and removes levels outside 1–10. Type RESET to confirm. Shopify customers, orders, and existing Shopify discount codes are not deleted. The current Level 7 picture is kept; add its URL here if you want to replace it.</p>
        <Form method="post" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input type="hidden" name="actionType" value="reset_campaign_data" />
          <input type="hidden" name="campaignId" value={campaign.id} />
          <input type="url" name="templateProductImageUrl" placeholder="Replace Level 7 image (optional)" aria-label="Optional replacement product image URL for the Product Benefits challenge" defaultValue={currentProductImageUrl} style={{ width: 250, padding: "7px 9px", border: "1px solid #d1d5db", borderRadius: 6 }} />
          <input type="text" name="resetConfirmation" placeholder="Type RESET to confirm" aria-label="Type RESET to confirm data deletion" pattern="RESET" required style={{ width: 200, padding: "7px 9px", border: "1px solid #d1d5db", borderRadius: 6 }} />
          <button type="submit" disabled={isSubmitting} style={{ background: "#000", color: "#fff", padding: "10px 20px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: 600 }}>Reset Levels &amp; All Player Data</button>
        </Form>
      </details>

      {/* Grid of 10 Level Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: "16px",
          marginBottom: "32px",
        }}
      >
        {levels.map((lvl) => {
          const cfg = (lvl.config as Record<string, unknown>) || {};
          return (
            <div
              key={lvl.id}
              style={{
                background: "#ffffff",
                borderRadius: "10px",
                border: lvl.isActive ? "1px solid #e1e3e5" : "1px dashed #d1d5db",
                padding: "20px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                opacity: lvl.isActive ? 1 : 0.65,
              }}
            >
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                  <span
                    style={{
                      background: "#f3f4f6",
                      color: "#374151",
                      fontSize: "11px",
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: "6px",
                      textTransform: "uppercase",
                    }}
                  >
                    LEVEL {lvl.levelNumber}
                  </span>
                  <span
                    style={{
                      background:
                        lvl.activityType === "quiz"
                          ? "#e0e7ff"
                          : lvl.activityType === "photo_upload"
                            ? "#ecfdf5"
                            : "#fef3c7",
                      color:
                        lvl.activityType === "quiz"
                          ? "#3730a3"
                          : lvl.activityType === "photo_upload"
                            ? "#065f46"
                            : "#92400e",
                      fontSize: "11px",
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: "6px",
                      textTransform: "uppercase",
                    }}
                  >
                    {lvl.activityType.replace("_", " ")}
                  </span>
                </div>

                <div style={{ fontSize: "16px", fontWeight: "bold", color: "#1f2937", marginBottom: "4px" }}>
                  {lvl.title}
                </div>
                <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "12px", minHeight: "36px", lineHeight: "1.4" }}>
                  {lvl.description || "No description specified."}
                </div>

                {/* Activity Config Snippet */}
                <div
                  style={{
                    background: "#f9fafb",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    fontSize: "11px",
                    color: "#4b5563",
                    marginBottom: "16px",
                  }}
                >
                  {lvl.activityType === "quiz" && (
                    <div>
                      <strong>Q:</strong> {String(cfg.question || "N/A")}
                    </div>
                  )}
                  {lvl.activityType === "photo_upload" && (
                    <div>
                      <strong>Max Size:</strong> {String(cfg.maxFileSizeMb || 10)}MB • <strong>Types:</strong> JPG, PNG, WEBP
                    </div>
                  )}
                  {lvl.activityType === "text_submission" && (
                    <div>
                      <strong>Length:</strong> {String(cfg.minCharacters || 20)} – {String(cfg.maxCharacters || 500)} chars
                    </div>
                  )}
                  {lvl.activityType === "final_submission" && (
                    <div>
                      <strong>Grand Finale Challenge:</strong> +{lvl.points} pts
                    </div>
                  )}
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingTop: "12px",
                  borderTop: "1px solid #f3f4f6",
                }}
              >
                <span style={{ fontSize: "14px", fontWeight: "bold", color: "#059669" }}>
                  +{lvl.points} PTS
                </span>
                <div style={{ display: "flex", gap: "8px" }}>
                  <Form method="post" style={{ display: "inline" }}>
                    <input type="hidden" name="actionType" value="toggle_active" />
                    <input type="hidden" name="campaignId" value={campaign.id} />
                    <input type="hidden" name="levelId" value={lvl.id} />
                    <button type="submit"  style={{ background: "#000", color: "#fff", padding: "10px 20px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: 600 }}>
                      {lvl.isActive ? "Disable" : "Enable"}
                    </button>
                  </Form>
                  <button  style={{ background: "#000", color: "#fff", padding: "10px 20px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: 600 }} onClick={() => openEditor(lvl)}>
                    Edit
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Visual Level Editor Modal / Drawer */}
      {editingLevel && (
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
              maxWidth: "600px",
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
              padding: "24px",
              boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div style={{ fontSize: "18px", fontWeight: "bold", color: "#111827" }}>
                Edit Level {editingLevel.levelNumber}: {editingLevel.title}
              </div>
              <button
                type="button"
                onClick={() => setEditingLevel(null)}
                style={{ background: "none", border: "none", fontSize: "18px", cursor: "pointer", color: "#6b7280" }}
              >
                ✕
              </button>
            </div>

            <Form method="post">
              <input type="hidden" name="actionType" value="save" />
              <input type="hidden" name="campaignId" value={campaign.id} />
              <input type="hidden" name="levelId" value={editingLevel.id} />
              <input type="hidden" name="isActive" value={String(editingLevel.isActive)} />

              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "4px" }}>
                    Level Title *
                  </label>
                  <input
                    type="text"
                    name="title"
                    defaultValue={editingLevel.title}
                    required
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      border: "1px solid #d1d5db",
                      fontSize: "14px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "4px" }}>
                    Instructions / Description
                  </label>
                  <textarea
                    name="description"
                    defaultValue={editingLevel.description || ""}
                    rows={2}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      border: "1px solid #d1d5db",
                      fontSize: "14px",
                      boxSizing: "border-box",
                      fontFamily: "inherit",
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "4px" }}>
                    Level Order
                  </label>
                  <input
                    type="number"
                    name="levelNumber"
                    defaultValue={editingLevel.levelNumber}
                    min={1}
                    max={10}
                    required
                    style={{ width: "120px", padding: "8px 12px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "14px", boxSizing: "border-box" }}
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "4px" }}>
                      Activity Type
                    </label>
                    <select
                      name="activityType"
                      value={selectedActivityType}
                      onChange={(e) => {
                        setSelectedActivityType(e.target.value);
                        setActivityConfigText(JSON.stringify(defaultActivityConfig[e.target.value] || {}, null, 2));
                      }}
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        borderRadius: "6px",
                        border: "1px solid #d1d5db",
                        fontSize: "14px",
                        boxSizing: "border-box",
                      }}
                    >
                      <option value="quiz">Navratri Quiz</option>
                      <option value="photo_upload">Photo Upload Challenge</option>
                      <option value="text_submission">Text Submission / Product Benefits / Feedback</option>
                      <option value="final_submission">Grand Finale Submission</option>
                      <option value="spin_wheel">Spin the Wheel</option>
                      <option value="treasure_hunt">Treasure Hunt</option>
                      <option value="memory_game">Memory Card Game</option>
                      <option value="movie_guess">Movie / Emoji Guess</option>
                      <option value="audio_guess">Audio / Tune Guess</option>
                      <option value="purchase">Verified Purchase</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "4px" }}>
                      Points Value
                    </label>
                    <input
                      type="number"
                      name="points"
                      defaultValue={editingLevel.points}
                      min={10}
                      max={1000}
                      step={10}
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        borderRadius: "6px",
                        border: "1px solid #d1d5db",
                        fontSize: "14px",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                </div>

                {/* Dynamic Configuration based on selected Activity Type */}
                {selectedActivityType === "quiz" && (
                  <div style={{ background: "#f9fafb", padding: "16px", borderRadius: "8px", border: "1px solid #e5e7eb" }}>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: "#374151", marginBottom: "12px" }}>
                      Quiz Questions (50 points per correct answer)
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      <QuizQuestionEditor initialQuestions={((editingLevel.config as Record<string, unknown>)?.questions as unknown[])?.length ? (editingLevel.config as Record<string, unknown>)?.questions : [{ question: String((editingLevel.config as Record<string, unknown>)?.question || ""), options: [String((editingLevel.config as Record<string, unknown>)?.optionA || ""), String((editingLevel.config as Record<string, unknown>)?.optionB || ""), String((editingLevel.config as Record<string, unknown>)?.optionC || ""), String((editingLevel.config as Record<string, unknown>)?.optionD || "")], answer: String((editingLevel.config as Record<string, unknown>)?.correctOption || "A") }]} />
                    </div>
                  </div>
                )}

                {selectedActivityType === "photo_upload" && (
                  <div style={{ background: "#f9fafb", padding: "16px", borderRadius: "8px", border: "1px solid #e5e7eb" }}>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: "#374151", marginBottom: "8px" }}>
                      Photo Upload Challenge Settings
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      <div>
                        <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#4b5563" }}>Instructions for Customer</label>
                        <input
                          type="text"
                          name="photo_instructions"
                          defaultValue={String((editingLevel.config as Record<string, unknown>)?.instructions || "")}
                          style={{ width: "100%", padding: "6px 10px", borderRadius: "4px", border: "1px solid #d1d5db", boxSizing: "border-box" }}
                        />
                      </div>
                      <div>
                        <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#4b5563" }}>Max File Size (MB)</label>
                        <input
                          type="number"
                          name="photo_maxSize"
                          defaultValue={Number((editingLevel.config as Record<string, unknown>)?.maxFileSizeMb || 10)}
                          style={{ width: "100%", padding: "6px 10px", borderRadius: "4px", border: "1px solid #d1d5db", boxSizing: "border-box" }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {selectedActivityType === "text_submission" && (
                  <div style={{ background: "#f9fafb", padding: "16px", borderRadius: "8px", border: "1px solid #e5e7eb" }}>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: "#374151", marginBottom: "8px" }}>
                      Text Submission Settings
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      <div>
                        <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#4b5563" }}>Prompt / Question</label>
                        <input
                          type="text"
                          name="text_instructions"
                          defaultValue={String((editingLevel.config as Record<string, unknown>)?.instructions || "")}
                          style={{ width: "100%", padding: "6px 10px", borderRadius: "4px", border: "1px solid #d1d5db", boxSizing: "border-box" }}
                        />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                        <div>
                          <label style={{ fontSize: "11px", fontWeight: 600, color: "#4b5563" }}>Min Chars</label>
                          <input
                            type="number"
                            name="text_minChars"
                            defaultValue={Number((editingLevel.config as Record<string, unknown>)?.minCharacters || 20)}
                            style={{ width: "100%", padding: "6px 10px", borderRadius: "4px", border: "1px solid #d1d5db", boxSizing: "border-box" }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: "11px", fontWeight: 600, color: "#4b5563" }}>Max Chars</label>
                          <input
                            type="number"
                            name="text_maxChars"
                            defaultValue={Number((editingLevel.config as Record<string, unknown>)?.maxCharacters || 500)}
                            style={{ width: "100%", padding: "6px 10px", borderRadius: "4px", border: "1px solid #d1d5db", boxSizing: "border-box" }}
                          />
                        </div>
                      </div>
                      <div>
                        <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#4b5563" }}>Upload product image</label>
                        <input type="file" name="text_imageFile" accept="image/jpeg,image/png,image/webp" disabled={uploadingMedia} onChange={(event) => { const file = event.currentTarget.files?.[0]; const form = event.currentTarget.form; if (file && form) void uploadAdminMedia(file, "image", form); event.currentTarget.value = ""; }} style={{ display: "block", width: "100%", marginBottom: 8 }} />
                        <small style={{ display: "block", marginBottom: 8, color: "#6b7280" }}>JPEG, PNG, or WebP · max 10 MB. You can also paste an existing public image URL below.</small>
                        <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#4b5563" }}>Product image URL (optional)</label>
                        <input type="url" name="text_imageUrl" defaultValue={String((editingLevel.config as Record<string, unknown>)?.imageUrl || (editingLevel.config as Record<string, unknown>)?.productImageUrl || "")} placeholder="https://cdn.shopify.com/..." style={{ width: "100%", padding: "6px 10px", borderRadius: "4px", border: "1px solid #d1d5db", boxSizing: "border-box" }} />
                        <input type="hidden" name="text_imageAlt" value={String((editingLevel.config as Record<string, unknown>)?.imageAlt || (editingLevel.config as Record<string, unknown>)?.productImageAlt || "Product image")} />
                      </div>
                      <input type="hidden" name="text_showWinners" value="false" />
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                        <input type="checkbox" name="text_showWinners" value="true" defaultChecked={Boolean((editingLevel.config as Record<string, unknown>)?.showWinnerAnnouncements)} />
                        Show finalized winner announcements with this activity
                      </label>
                    </div>
                  </div>
                )}

                {selectedActivityType === "final_submission" && (
                  <div style={{ background: "#f9fafb", padding: "16px", borderRadius: "8px", border: "1px solid #e5e7eb" }}>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: "#374151", marginBottom: "8px" }}>
                      Grand Finale Level Settings
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#4b5563" }}>Final Instructions</label>
                      <input
                        type="text"
                        name="final_instructions"
                        defaultValue={String((editingLevel.config as Record<string, unknown>)?.instructions || "")}
                        style={{ width: "100%", padding: "6px 10px", borderRadius: "4px", border: "1px solid #d1d5db", boxSizing: "border-box" }}
                      />
                    </div>
                  </div>
                )}

                {["movie_guess", "audio_guess"].includes(selectedActivityType) && (
                  <div style={{ background: "#f9fafb", padding: 16, borderRadius: 8, border: "1px solid #e5e7eb", display: "grid", gap: 12 }}>
                    <strong>{selectedActivityType === "movie_guess" ? "Movie Guess Setup" : "Audio / Tune Guess Setup"}</strong>
                    {selectedActivityType === "movie_guess" ? <>
                      <label style={{ display: "grid", gap: 5 }}>Clue or emoji<input name="movie_clue" defaultValue={String((editingLevel.config as Record<string, unknown>)?.clue || "🎬❓")} style={{ width: "100%", padding: 8, boxSizing: "border-box" }} /></label>
                      <label style={{ display: "grid", gap: 5 }}>Correct movie answer<input name="movie_answer" required defaultValue={String((editingLevel.config as Record<string, unknown>)?.answer || "")} style={{ width: "100%", padding: 8, boxSizing: "border-box" }} /></label>
                      <label style={{ display: "grid", gap: 5 }}>Choices (optional; leave empty to let customers type the movie name)<textarea name="movie_options" rows={4} defaultValue={Array.isArray((editingLevel.config as Record<string, unknown>)?.options) ? ((editingLevel.config as Record<string, unknown>).options as unknown[]).map(String).join("\n") : ""} style={{ width: "100%", padding: 8, boxSizing: "border-box" }} /></label>
                      <label style={{ display: "grid", gap: 5 }}>Accepted spelling variants (optional, one per line)<textarea name="movie_accepted_answers" rows={2} defaultValue={Array.isArray((editingLevel.config as Record<string, unknown>)?.acceptedAnswers) ? ((editingLevel.config as Record<string, unknown>).acceptedAnswers as unknown[]).map(String).join("\n") : ""} style={{ width: "100%", padding: 8, boxSizing: "border-box" }} /></label>
                    </> : <>
                      <label style={{ display: "grid", gap: 5 }}>Audio clip (MP3, M4A, AAC, OGG, WAV, WebM; max 25MB)<input type="file" name="audio_file" accept="audio/mpeg,audio/mp4,audio/aac,audio/ogg,audio/wav,audio/webm,audio/x-m4a" disabled={uploadingMedia} onChange={(event) => { const file = event.currentTarget.files?.[0]; const form = event.currentTarget.form; if (file && form) void uploadAdminMedia(file, "audio", form); event.currentTarget.value = ""; }} /></label>
                      <input type="hidden" name="audio_uploadedUrl" defaultValue="" />
                      {typeof (editingLevel.config as Record<string, unknown>)?.audioUrl === "string" && Boolean((editingLevel.config as Record<string, unknown>).audioUrl) && <audio controls preload="metadata" src={`/api/campaigns/${encodeURIComponent(campaign.slug)}/audio?levelId=${encodeURIComponent(editingLevel.id)}&shop=${encodeURIComponent(campaign.shop)}`} style={{ width: "100%" }}>Audio preview</audio>}
                      <label style={{ display: "grid", gap: 5 }}>Question prompt<input name="audio_prompt" defaultValue={String((editingLevel.config as Record<string, unknown>)?.prompt || "Listen to the clip and enter the song or tune name.")} style={{ width: "100%", padding: 8, boxSizing: "border-box" }} /></label>
                      <label style={{ display: "grid", gap: 5 }}>Correct song / tune answer<input name="audio_answer" required defaultValue={String((editingLevel.config as Record<string, unknown>)?.answer || "")} style={{ width: "100%", padding: 8, boxSizing: "border-box" }} /></label>
                      <label style={{ display: "grid", gap: 5 }}>Accepted answer variants (optional, one per line)<textarea name="audio_accepted_answers" rows={2} defaultValue={Array.isArray((editingLevel.config as Record<string, unknown>)?.acceptedAnswers) ? ((editingLevel.config as Record<string, unknown>).acceptedAnswers as unknown[]).map(String).join("\n") : ""} style={{ width: "100%", padding: 8, boxSizing: "border-box" }} /></label>
                    </>}
                  </div>
                )}

                {["spin_wheel", "treasure_hunt", "memory_game", "purchase"].includes(selectedActivityType) && (
                  <div style={{ background: "#f9fafb", padding: "16px", borderRadius: "8px", border: "1px solid #e5e7eb" }}>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: "#374151", marginBottom: "8px" }}>
                      {selectedActivityType.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase())} Configuration
                    </div>
                    <p style={{ margin: "0 0 8px", color: "#6b7280", fontSize: "12px" }}>
                      Edit the activity settings as a JSON object. Keep answer keys private to the server.
                    </p>
                    {selectedActivityType === "treasure_hunt" && (
                      <>
                      <div style={{ gridColumn: "1 / -1", marginBottom: 12, padding: 12, background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, fontSize: 12, lineHeight: 1.5 }}>
                        The storefront button appears after you enable the app embed. <a href={themeEmbedSetupUrl} target="_top" rel="noreferrer" style={{ fontWeight: 700 }}>Open your store&apos;s theme editor</a>, enable <strong>Treasure hunt button</strong>, then set campaign <code>{campaign.slug}</code> and level <code>{editingLevel.levelNumber}</code>. Shopify keeps this embed off until it is enabled in the theme editor.
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                        <div>
                          <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 5 }}>Eligible products</label>
                          <input type="hidden" name="eligibleProductHandles" value="" />
                          <select multiple name="eligibleProductHandles" defaultValue={Array.isArray((editingLevel.config as Record<string, unknown>)?.eligibleProductHandles) ? (editingLevel.config as Record<string, unknown>).eligibleProductHandles as string[] : []} size={6} style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 6, padding: 6 }}>
                            {products.map((product) => <option key={product.id} value={product.handle}>{product.title} · {product.handle}</option>)}
                          </select>
                          {products.length === 0 && <small>Product list unavailable. Check the app&apos;s product access scope.</small>}
                        </div>
                        <div>
                          <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 5 }}>Eligible collections</label>
                          <input type="hidden" name="eligibleCategories" value="" />
                          <select multiple name="eligibleCategories" defaultValue={Array.isArray((editingLevel.config as Record<string, unknown>)?.eligibleCategories) ? (editingLevel.config as Record<string, unknown>).eligibleCategories as string[] : []} size={6} style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 6, padding: 6 }}>
                            {collections.map((collection) => <option key={collection.id} value={collection.handle}>{collection.title} · {collection.handle}</option>)}
                          </select>
                          {collections.length === 0 && <small>Collection list unavailable. Check the app&apos;s product access scope.</small>}
                        </div>
                      </div>
                      </>
                    )}
                    {selectedActivityType === "spin_wheel" && (
                      <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                          <label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 700 }}>Wheel title
                            <input name="spin_wheel_title" defaultValue={String((editingLevel.config as Record<string, unknown>)?.wheelTitle || "SPIN TO WIN")} style={{ width: "100%", padding: "7px 9px", border: "1px solid #d1d5db", borderRadius: 6 }} />
                          </label>
                          <label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 700 }}>Wheel ribbon
                            <input name="spin_ribbon_text" defaultValue={String((editingLevel.config as Record<string, unknown>)?.wheelRibbonText || "FORTUNE WHEEL")} style={{ width: "100%", padding: "7px 9px", border: "1px solid #d1d5db", borderRadius: 6 }} />
                          </label>
                          <label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 700 }}>Spin button text
                            <input name="spin_button_text" defaultValue={String((editingLevel.config as Record<string, unknown>)?.spinButtonText || "Spin & Win")} style={{ width: "100%", padding: "7px 9px", border: "1px solid #d1d5db", borderRadius: 6 }} />
                          </label>
                          <label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 700 }}>Default discount (%) for labels without a percent
                            <input name="spin_discount_percent" type="number" min="1" max="100" defaultValue={Number((editingLevel.config as Record<string, unknown>)?.discountPercent) || 10} style={{ width: "100%", padding: "7px 9px", border: "1px solid #d1d5db", borderRadius: 6 }} />
                          </label>
                        </div>
                        <label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 700 }}>Wheel segment text (one offer per line)
                          <textarea name="spin_rewards_lines" rows={4} defaultValue={Array.isArray((editingLevel.config as Record<string, unknown>)?.rewards) ? ((editingLevel.config as Record<string, unknown>).rewards as unknown[]).map((item) => typeof item === "string" ? item : String((item as Record<string, unknown>)?.label || "")).join("\n") : "10% OFF\n15% OFF\n20% OFF"} style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, boxSizing: "border-box" }} />
                        </label>
                        <label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 700 }}>Wheel instructions
                          <textarea name="spin_instructions" rows={2} defaultValue={String((editingLevel.config as Record<string, unknown>)?.instructions || "Spin the wheel and unlock your Navratri surprise!")} style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, boxSizing: "border-box" }} />
                        </label>
                        <label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 700 }}>Offer message shown after the win
                          <textarea name="spin_offer_message" rows={2} defaultValue={String((editingLevel.config as Record<string, unknown>)?.offerMessage || "Congratulations! You got this offer. Your code is ready to use at checkout.")} style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, boxSizing: "border-box" }} />
                        </label>
                      </div>
                    )}
                    {selectedActivityType === "purchase" && (
                      <div style={{ marginBottom: 12 }}>
                        <label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Minimum paid order value (₹)
                          <input name="purchase_minimum_value" type="number" min="299" defaultValue={Math.max(299, Number((editingLevel.config as Record<string, unknown>)?.minimumOrderValue) || 299)} style={{ width: 180, padding: "7px 9px", border: "1px solid #d1d5db", borderRadius: 6 }} />
                        </label>
                        <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 5 }}>Eligible purchase products</label>
                        <input type="hidden" name="eligiblePurchaseProducts" value="" />
                        <select multiple name="eligiblePurchaseProducts" defaultValue={Array.isArray((editingLevel.config as Record<string, unknown>)?.eligibleProductIds) ? (editingLevel.config as Record<string, unknown>).eligibleProductIds as string[] : []} size={6} style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 6, padding: 6 }}>
                          {products.map((product) => <option key={product.id} value={product.id}>{product.title} · {product.handle}</option>)}
                        </select>
                        <small style={{ color: "#6b7280" }}>Leave empty to allow any paid product. The paid order must be at least ₹299.</small>
                      </div>
                    )}
                    <textarea
                      name="activity_config_json"
                      value={activityConfigText}
                      onChange={(event) => setActivityConfigText(event.target.value)}
                      rows={12}
                      spellCheck={false}
                      required
                      style={{ width: "100%", padding: "8px 10px", borderRadius: "4px", border: "1px solid #d1d5db", boxSizing: "border-box", fontFamily: "monospace", fontSize: "12px" }}
                    />
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
                  {mediaUploadMessage && <p role="status" style={{ margin: "12px 0", color: mediaUploadMessage.toLowerCase().includes("failed") || mediaUploadMessage.includes("Could not") ? "#b42318" : "#475467" }}>{mediaUploadMessage}</p>}
                  <button type="button" style={{ background: "#000", color: "#fff", padding: "10px 20px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: 600 }} onClick={() => setEditingLevel(null)}>
                    Cancel
                  </button>
                  <button type="submit"  disabled={isSubmitting || uploadingMedia} style={{ background: "#000", color: "#fff", padding: "10px 20px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: 600 }}>
                    {uploadingMedia ? "Uploading media..." : isSubmitting ? "Saving..." : "Save Level Changes"}
                  </button>
                </div>
              </div>
            </Form>
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



