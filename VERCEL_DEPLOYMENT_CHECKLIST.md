# Vercel Deployment Checklist

**State: preparation only. No Vercel or Shopify deployment has been performed.**

Do not continue to a production deployment while any blocker in this checklist
is unresolved. In particular, Shopify privacy webhooks are not implemented yet
because the data-erasure and retention policy needs the app owner's decision.

## Step 1 — Create/configure the Vercel project

1. Import this repository into Vercel and set the project root to the directory
   containing `package.json`.
2. Select Node.js 22.x (22.12 or newer) or 20.x (20.19 or newer), matching the
   `engines` range in `package.json`.
3. Use `npm ci` as Install Command and `npm run build` as Build Command. The
   build script runs `prisma generate` before `react-router build`.
4. Do not configure a persistent filesystem or upload media to the Vercel
   filesystem. Customer media is uploaded directly to R2.
5. Keep Preview isolated from Production: use a non-production Atlas database
   and a separate R2 bucket or a dedicated preview prefix and credentials.

## Step 2 — Set production environment variables

Set these as **server-side Vercel Production variables**. Do not prefix any
secret with `VITE_`, `NEXT_PUBLIC_`, or `PUBLIC_`.

Required:

- `SHOPIFY_API_KEY` — Shopify app client ID; public by design and also returned
  to the authenticated App Bridge loader.
- `SHOPIFY_API_SECRET` — Shopify app secret; server only.
- `SHOPIFY_APP_URL` — exact permanent HTTPS Vercel origin, no trailing slash;
  set only after Vercel assigns the production domain.
- `SCOPES` — exactly match `shopify.app.production.toml`, including
  `write_app_proxy`.
- `MONGODB_DATABASE_URL` — production Atlas URI with an explicit database name.
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  `R2_BUCKET_NAME` — server-only R2 credentials and target bucket.

Optional:

- `SHOP_CUSTOM_DOMAIN` — only if configured for the Shopify shop.
- `SUPABASE_URL` — only for legacy Supabase audio URL compatibility; not needed
  for new uploads. Remove after verifying no active runtime media reference
  depends on it.

Do not add `DATABASE_URL` or `DIRECT_URL` to Vercel. They are for the retained
PostgreSQL rollback/migration tooling, not the active MongoDB runtime. Keep the
PostgreSQL backup and rollback resources unchanged and outside Vercel.

## Step 3 — Deploy a Preview

1. Configure Vercel Preview variables separately from Production. Use a
   non-production Shopify app/store, MongoDB database, and R2 bucket.
2. Push a preview branch and let Vercel create a Preview deployment. This is a
   deployment action; do not use the production domain or production data for
   these checks.
3. Run the applicable cases in [PRODUCTION_SMOKE_TEST.md](./PRODUCTION_SMOKE_TEST.md).
   Mark each outcome and deployment URL; do not copy a production session or
   customer data into Preview.

## Step 4 — Configure MongoDB Atlas

1. Set `MONGODB_DATABASE_URL` with an explicit database name and a least-
   privilege database user.
2. Verify connectivity from the Preview runtime first.
3. Vercel outbound IPs can be dynamic. Prefer Vercel Static IPs (plan/add-on
   dependent) or a private connectivity design and allowlist only those known
   addresses. Do not add `0.0.0.0/0` as a convenience workaround. Confirm the
   Atlas network rule and TLS settings with the deployment operator before
   Production is enabled.
4. The app caches one Prisma client on `globalThis` per warm Node process. Atlas
   still needs capacity for the aggregate of Vercel instances and Preview
   deployments; monitor connection counts during verification.

## Step 5 — Configure Cloudflare R2 CORS

The browser sends presigned `PUT` requests to the R2 S3 endpoint. The app serves
media through its own `/api/media` routes, so direct browser `GET` from R2 is
not required by the current architecture. Configure exact browser origins only;
do not use `*`.

After the real production and storefront origins are known, set the bucket CORS
policy to this shape, replacing every sentinel with a complete exact origin
(scheme and hostname, no path):

```json
[
  {
    "AllowedOrigins": [
      "https://replace-with-vercel-production-host.vercel.app",
      "https://replace-with-storefront-custom-domain",
      "https://replace-with-store.myshopify.com"
    ],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": [],
    "MaxAgeSeconds": 3600
  }
]
```

Only include the custom storefront domain and/or `*.myshopify.com` origin that
actually hosts the campaign and initiates customer uploads. Add a Vercel Preview
origin only to the Preview bucket/policy. R2 CORS is independent from bucket
access control; keep the bucket private. Do not add `GET` unless the application
is deliberately changed to fetch objects directly from R2 in the browser.

## Step 6 — Configure R2 lifecycle for temporary uploads

Successful finalization deletes staging objects immediately. Add expiry rules
only for abandoned temporary objects. Never apply an expiry rule to
`navratri/submissions/images/` or other permanent media prefixes.

With Wrangler, after confirming the exact bucket name, the narrowly scoped
one-day rules are:

```sh
npx wrangler r2 bucket lifecycle add <BUCKET> navratri-admin-staging navratri/admin-staging/ --expire-days 1
npx wrangler r2 bucket lifecycle add <BUCKET> navratri-submission-uploads navratri/submissions/uploads/ --expire-days 1
```

Review the resulting rules before applying them to the production bucket. R2
lifecycle deletion is asynchronous (objects are typically removed within 24
hours). Permanent image objects are deliberately excluded. See Cloudflare's
[R2 lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
and [CORS documentation](https://developers.cloudflare.com/r2/buckets/cors/).

## Step 7 — Get the real Vercel production URL

Select/assign the permanent Vercel domain. Record its origin exactly, for
example `https://<assigned-host>.vercel.app`; do not use a temporary preview
deployment URL. The project owner must provide/confirm this value.

## Step 8 — Update Shopify production configuration

Replace `https://replace-with-vercel-host.vercel.app` in
`shopify.app.production.toml` with the exact permanent Vercel origin and set
`SHOPIFY_APP_URL` to the same value. The production config currently has one
OAuth callback, `/auth/callback`, matching `authPathPrefix: "/auth"` in
`app/shopify.server.ts`.

Production URL map:

| Purpose | URL after replacing the host | Current state |
|---|---|---|
| Application/embedded app origin | `https://<VERCEL_PRODUCTION_HOST>` | Sentinel in TOML; also set `SHOPIFY_APP_URL` to the same origin |
| OAuth callback | `https://<VERCEL_PRODUCTION_HOST>/auth/callback` | Existing `auth.$` route and React Router Shopify auth prefix |
| App Proxy destination | `https://<VERCEL_PRODUCTION_HOST>/apps/navratri` | TOML uses relative `url = "/apps/navratri"`; Shopify prepends the application origin |
| Storefront App Proxy entry | `https://<SHOPIFY_STOREFRONT_HOST>/apps/navratri` | Storefront host is the shop's `*.myshopify.com` host or its configured custom domain |
| Uninstall webhook | `https://<VERCEL_PRODUCTION_HOST>/webhooks/app/uninstalled` | Configured in production TOML |
| Scope update webhook | `https://<VERCEL_PRODUCTION_HOST>/webhooks/app/scopes_update` | Configured in production TOML |
| Paid order webhook | `https://<VERCEL_PRODUCTION_HOST>/webhooks/orders/paid` | Configured in production TOML |
| Customer data request/redact and shop redact | Not yet defined | No privacy routes exist; do not register until policy-backed handlers are implemented |

The App Proxy is configured in the same TOML file:

- App origin URL: `SHOPIFY_APP_URL`
- App-side proxy URL: `/apps/navratri`
- Storefront URL: `https://<store-domain>/apps/navratri`
- Route files under `/apps/navratri/...` are the `apps.navratri.*` routes.

Keep the `production` config selected for production deployment. `npm run deploy`
explicitly calls `shopify app deploy --config production`; local development
uses `shopify app dev --config dev`. Do not run the production config deploy
until the host is assigned and all blockers are cleared. Shopify's CLI applies
TOML changes to production only when its config deploy is run; no CLI deploy was
run for this preparation.

The production scope includes `write_app_proxy`, required by Shopify's current
App Proxy configuration guidance. Review the scope change and expected merchant
reauthorization before enabling it.

## Step 9 — Configure Shopify privacy webhooks

**Blocked pending owner policy decisions.** The required topics are
`customers/data_request`, `customers/redact`, and `shop/redact`. Do not register
topics to nonexistent handlers and do not deploy a “success” handler that
doesn't fulfill the request. The app currently manages ordinary webhook
subscriptions in `shopify.app.production.toml`; there is no runtime
`registerWebhooks()` invocation. The three privacy topics are not yet present.

Before implementation, decide:

1. What customer data should `customers/data_request` return, and how is the
   report delivered to the merchant within Shopify's required process?
2. On `customers/redact`, should customer progress, points, audit history,
   referral edges, reward/discount identifiers, purchase evidence, and
   free-text submissions be deleted, anonymized, or retained under a documented
   lawful basis? Define how R2 photos and thumbnails are found and removed when
   references are shared or stale.
3. On `shop/redact`, should the app delete all shop-scoped campaign/game
   configuration and associated R2 content, or retain any records under an
   explicit exception? Admin media keys currently are not shop-prefixed, so
   safe shop-level object selection needs its own mapping/policy.
4. Define audit-log retention and what minimum non-identifying data may remain.

Once policy is approved and handlers are implemented/tested, add the routes and
`compliance_topics` registration to the existing TOML webhook architecture,
then validate and deploy the Shopify app configuration. Shopify describes these
topics in its [privacy compliance guide](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance).

## Step 10 — Deploy production

Only after preview checks and all blockers are resolved:

1. Set the reviewed Production environment variables in Vercel.
2. Confirm `SHOPIFY_APP_URL`, production TOML URLs, Atlas access, R2 CORS, and
   lifecycle rules match the approved production resources.
3. Deploy the production Vercel build using the configured project workflow.
4. Deploy the Shopify production app configuration separately:

```sh
shopify app config validate --json --config production
shopify app deploy --config production
```

These commands are documented for the operator; they were not run here. Shopify
configuration deployment is a production-side effect.

## Step 11 — Install/reinstall only on the intended live store

Install or reinstall the production app only on the exact Shopify store chosen
by the owner. Confirm OAuth, scopes, callback, App Proxy, and webhook delivery
there. Do not install Preview on the live store.

## Step 12 — Run smoke tests

Run every case in [PRODUCTION_SMOKE_TEST.md](./PRODUCTION_SMOKE_TEST.md), record
evidence and failures, and test privacy webhooks only after their policy-backed
handlers are implemented. Monitor Vercel function logs, Atlas connections,
Cloudflare R2 usage, and Shopify webhook delivery without logging credentials,
customer identifiers, or uploaded content.

## Remaining deployment steps

- **Domain Configuration**: The final Vercel production origin must be provisioned. Replace `https://replace-with-vercel-host.vercel.app` in `shopify.app.production.toml` with the assigned host.
- **R2 CORS**: Apply the CORS rules with the exact final Vercel and storefront domains.
- **Environment Variables**: Configure all required Production environment variables in Vercel (`MONGODB_DATABASE_URL`, Shopify keys, and R2 credentials).
- **App Deploy**: After replacing the URLs, run `shopify app deploy --config production` to synchronize the app configuration and webhooks with Shopify.
