/**
 * Centralized Application URL Configuration for Navratri 2026
 */

export const PRODUCTION_STORE_ORIGIN = "https://aghoristore.com";
export const CAMPAIGN_SLUG = "navratri-2026";
export const PRODUCTION_CAMPAIGN_PATH = `/apps/navratri/campaigns/${CAMPAIGN_SLUG}`;
export const PRODUCTION_CAMPAIGN_URL = `${PRODUCTION_STORE_ORIGIN}${PRODUCTION_CAMPAIGN_PATH}`;

export interface URLOptions {
  slug?: string;
  isDev?: boolean;
  storefrontUrl?: string | null;
  requestUrl?: string;
}

/**
 * Checks if current runtime environment is local development.
 * Safely handles server (Node) and browser contexts.
 */
export function isLocalDevEnv(): boolean {
  if (typeof process !== "undefined" && process.env) {
    if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
      return false;
    }
    if (process.env.NODE_ENV === "development") {
      return true;
    }
  }
  return false;
}

/**
 * Returns the effective Storefront Origin.
 * In production: strictly "https://aghoristore.com".
 * In development: uses storefrontUrl if provided, or current local origin.
 */
export function getStorefrontOrigin(options?: URLOptions): string {
  const isDev = options?.isDev ?? isLocalDevEnv();
  if (!isDev) {
    return PRODUCTION_STORE_ORIGIN;
  }
  if (options?.storefrontUrl && /^https?:\/\//i.test(options.storefrontUrl)) {
    return options.storefrontUrl.replace(/\/$/, "");
  }
  if (typeof window !== "undefined") {
    if (window.location.hostname.includes("aghoristore.com")) {
      return PRODUCTION_STORE_ORIGIN;
    }
    if (window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
      return window.location.origin;
    }
  }
  return options?.storefrontUrl || "http://localhost:3000";
}

/**
 * Returns the full environment-aware Campaign target URL.
 * Production: "https://aghoristore.com/apps/navratri/campaigns/navratri-2026"
 */
export function getCampaignUrl(options?: URLOptions): string {
  const slug = options?.slug || CAMPAIGN_SLUG;
  const isDev = options?.isDev ?? isLocalDevEnv();
  if (!isDev) {
    return `${PRODUCTION_STORE_ORIGIN}/apps/navratri/campaigns/${slug}`;
  }
  const origin = getStorefrontOrigin(options);
  return `${origin}/apps/navratri/campaigns/${slug}`;
}

/**
 * Returns the Login URL with exact return path.
 * Production: "https://aghoristore.com/account/login?return_url=%2Fapps%2Fnavratri%2Fcampaigns%2Fnavratri-2026"
 */
export function getLoginUrl(options?: URLOptions): string {
  const slug = options?.slug || CAMPAIGN_SLUG;
  const origin = getStorefrontOrigin(options);
  const returnPath = `/apps/navratri/campaigns/${slug}`;
  return `${origin}/account/login?return_url=${encodeURIComponent(returnPath)}`;
}

/**
 * Returns the Logout URL with exact return path.
 * Production: "https://aghoristore.com/account/logout?return_url=%2Fapps%2Fnavratri%2Fcampaigns%2Fnavratri-2026"
 */
export function getLogoutUrl(options?: URLOptions): string {
  const slug = options?.slug || CAMPAIGN_SLUG;
  const origin = getStorefrontOrigin(options);
  const returnPath = `/apps/navratri/campaigns/${slug}`;
  return `${origin}/account/logout?return_url=${encodeURIComponent(returnPath)}`;
}

/**
 * Sanitizes and validates redirect URLs against allowlist.
 */
export function sanitizeRedirectUrl(targetUrl?: string | null): string {
  if (!targetUrl || typeof targetUrl !== "string") {
    return PRODUCTION_CAMPAIGN_URL;
  }
  const trimmed = targetUrl.trim();
  if (trimmed.startsWith("/apps/navratri")) {
    const isDev = isLocalDevEnv();
    if (!isDev) {
      return `${PRODUCTION_STORE_ORIGIN}${trimmed}`;
    }
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname.includes("aghoristore.com")) {
      return parsed.toString();
    }
    if (isLocalDevEnv() && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")) {
      return parsed.toString();
    }
  } catch {
    // Ignore invalid URL formatting
  }
  return PRODUCTION_CAMPAIGN_URL;
}
