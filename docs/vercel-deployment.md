# Vercel runtime audit

This is a local compatibility audit only. No deployment, production database
access, Shopify store changes, or R2 operations were performed.

## Runtime findings

- React Router 7 uses `@vercel/react-router` through `reactRouter.config.ts` and
  the Vite preset. The production SSR server is Node-based.
- `package.json` allows Node `>=20.19 <22 || >=22.12`; use Node 22.12+ on Vercel.
- Media writes go directly from browser to R2 through short-lived signed PUTs.
  The server validates and processes the staged file, then stores metadata in
  MongoDB. Vercel does not need persistent media filesystem storage.
- Sharp is used server-side for image decode, orientation, resizing, and WebP
  output. This audit verified build configuration, not a deployed Vercel Sharp
  runtime.
- `app/db.server.ts` caches one Prisma Client on `globalThis` per warm Node
  process. Each serverless instance may still have a separate MongoDB pool.
- Shopify app configuration is file-based. Production deployment uses
  `shopify.app.production.toml`; local dev uses `shopify.app.dev.toml` as
  selected by the `dev` package script. Never deploy the default/dev config to
  Production.
- Existing Shopify route families include `/auth/*`, `/app/*`, `/apps/navratri/*`,
  `/api/*`, and `/webhooks/*`. Admin routes authenticate via `authenticate.admin`,
  App Proxy routes call `authenticate.public.appProxy`, and webhook routes call
  `authenticate.webhook`.
- Vercel Functions currently impose a 4.5 MB request-body limit. Current image
  uploads do not pass through the function: the browser PUTs directly to R2.
  The app sends small JSON authorization/finalize requests, and legacy form
  routes explicitly reject image uploads. Do not restore multipart media
  uploads through a Vercel Function. See Vercel's
  [function limitations](https://vercel.com/docs/functions/limitations).
- No runtime local-file persistence, long-lived background worker, or local
  media write was found in the application routes/services inspected. Migration
  scripts intentionally retain PostgreSQL/Supabase source tooling.
- Current runtime still has optional read-only legacy audio URL rewriting via
  `SUPABASE_URL`. It does not instantiate a Supabase client or use Supabase
  Storage for new writes. Remove that optional variable after confirming no live
  audio reference depends on it.

## Security and readiness findings

- `SHOPIFY_API_KEY` is public by design and returned by the authenticated admin
  loader to initialize App Bridge. Shopify secret, Mongo URI, and R2 credentials
  are server-only. No `VITE_`, `NEXT_PUBLIC_`, or `PUBLIC_` environment variable
  is used in the app runtime.
- The campaign route emits a Shopify `application/liquid` response that uses
  Shopify's `hmac_sha256` Liquid filter with the app secret to sign customer
  values. Shopify renders `application/liquid` for an App Proxy response, and
  this response is available only after app-proxy authentication. Do not expose
  the returned Liquid template to ordinary browser routes; verify the final
  rendered browser response on Preview before Production. No secret value was
  read or printed during this audit.
- The active customer upload uses App Proxy authentication, server-issued HMAC
  tickets bound to shop/customer/campaign/level/key/type/size, a random staging
  key, short-lived R2 PUT, metadata/length verification, and Sharp decoding.
  Customer finalize keys are not client-selectable. MongoDB upsert now has
  best-effort cleanup for its uniquely named permanent R2 object if persistence
  fails.
- The admin upload route similarly authorizes by Shopify admin session and
  store-scoped campaign/level. A user who finalizes an admin asset and then
  abandons the form can leave a permanent unreferenced asset; do not put an
  expiry rule on permanent media. Periodic reference-aware orphan review is
  still needed if this abandonment occurs materially often.
- R2 buckets can remain private, but `api.media` and its App Proxy alias
  currently validate object-key syntax and do not authenticate the viewer.
  A known media URL is therefore a bearer URL. Confirm that customer-submitted
  photos are intentionally viewable by anyone with the URL; if not, add
  authenticated/authorized media delivery before production.
- Shopify's mandatory privacy webhooks are not implemented or registered.
  Customer and shop deletion behavior must wait for an explicit retention and
  data-handling policy.
- The production TOML uses a visible `replace-with-vercel-host` sentinel, not a
  real host. Production URLs, Atlas network access, and R2 CORS/lifecycle have
  not been verified here.

See [VERCEL_DEPLOYMENT_CHECKLIST.md](../VERCEL_DEPLOYMENT_CHECKLIST.md) for the
operator's configuration sequence and [PRODUCTION_SMOKE_TEST.md](../PRODUCTION_SMOKE_TEST.md)
for the unexecuted smoke-test matrix.
