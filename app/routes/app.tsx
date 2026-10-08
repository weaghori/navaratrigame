import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    isDev: process.env.NODE_ENV === "development" || !process.env.NODE_ENV,
  };
};

export default function App() {
  const { apiKey, isDev } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Dashboard</s-link>
        <s-link href="/app/campaign">Campaign</s-link>
        <s-link href="/app/levels">10 Levels</s-link>
        <s-link href="/app/submissions">Submissions</s-link>
        <s-link href="/app/participants">Participants</s-link>
        <s-link href="/app/points">Points Log</s-link>
        <s-link href="/app/leaderboard">Leaderboard</s-link>
        <s-link href="/app/winners">Top 25 Winners</s-link>
        <s-link href="/app/rewards">Rewards</s-link>
        {isDev && <s-link href="/app/dev-tools">🧪 Dev Testing</s-link>}
      </s-app-nav>
      <div style={{ minHeight: "100vh", background: "#f6f6f7", paddingBottom: "48px" }}>
        <Outlet />
      </div>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
