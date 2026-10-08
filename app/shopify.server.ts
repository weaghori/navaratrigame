import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import type { PrismaClient as ShopifyPrismaClient } from "@prisma/client";
import prisma from "./db.server";

const isProduction = process.env.NODE_ENV === "production";
const missingProductionConfig = [
  ["SHOPIFY_API_KEY", process.env.SHOPIFY_API_KEY],
  ["SHOPIFY_API_SECRET", process.env.SHOPIFY_API_SECRET],
  ["SHOPIFY_APP_URL", process.env.SHOPIFY_APP_URL],
  ["SCOPES", process.env.SCOPES],
].filter(([, value]) => !value?.trim()).map(([name]) => name);

if (isProduction && missingProductionConfig.length > 0) {
  throw new Error(`Missing required production configuration: ${missingProductionConfig.join(", ")}.`);
}

const appUrl = process.env.SHOPIFY_APP_URL || "http://localhost:3000";
if (isProduction) {
  let parsedAppUrl: URL;
  try {
    parsedAppUrl = new URL(appUrl);
  } catch {
    throw new Error("SHOPIFY_APP_URL must be a valid public HTTPS URL in production.");
  }
  if (parsedAppUrl.protocol !== "https:" || ["localhost", "example.com"].includes(parsedAppUrl.hostname)) {
    throw new Error("SHOPIFY_APP_URL must be a valid public HTTPS URL in production.");
  }
}

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY || "dummy_api_key",
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "dummy_api_secret",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(",") || ["read_products", "read_orders"],
  appUrl,
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma as unknown as ShopifyPrismaClient),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
