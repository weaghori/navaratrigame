# PostgreSQL/Supabase to MongoDB Atlas/Cloudflare R2

## Current state

- The app runtime now uses MongoDB through `prisma/schema.prisma` and `MONGODB_DATABASE_URL`. PostgreSQL remains available through `prisma/schema.postgresql.prisma`, `DATABASE_URL`, and `DIRECT_URL` for rollback and migration reads.
- MongoDB Atlas contains the migrated records. The verified counts are Campaign 1, Session 1, Level 10, CustomerProgress 37, PointTransaction 1, Reward 13, and Notification 7; the remaining migrated models have zero rows. IDs and fields matched before media-reference updates.
- Shopify sessions continue to use `PrismaSessionStorage`. A temporary session store/load/delete check passed against MongoDB, and the temporary record was removed.
- Cloudflare R2 is the only active media write/delete provider in the runtime. There is no `MEDIA_STORAGE_PROVIDER` runtime switch and Supabase is not a media-write rollback option. Media references use portable `r2:` keys and the app serves them through `/api/media` and `/apps/navratri/api/media`; `R2_PUBLIC_URL` is not used as the S3 endpoint.
- One 8,005,590-byte inline audio object was copied to R2 and SHA-256 verified before its MongoDB reference was changed. The external product image URL was not eligible for copying and remains unchanged. Supabase files were not modified.
- There are seven PostgreSQL SQL migration directories. MongoDB does not use Prisma Migrate; it uses `prisma db push` and MongoDB indexes.
- There are twelve Prisma models, no enums, no raw SQL calls, no PostgreSQL arrays, and no raw PostgreSQL-specific types in the schema. Values include JSON, dates, a BigInt Shopify user id, and a Float order total.
- The application has multi-record `$transaction` calls for progression, approvals, campaigns, rewards, referrals, purchases, and winners. MongoDB Atlas must provide a replica set for Prisma's transactional operations.

## Model migration map

| Model | Main references | Constraints and migration treatment |
| --- | --- | --- |
| `Session` | Shopify session storage; no relation fields | Preserve Shopify session `id` as a unique string. Mongo schema uses a separate generated `_id` so the Prisma session adapter does not update MongoDB's immutable `_id`. |
| `Campaign` | Parent of levels, progress, submissions, referrals, rewards, winners, purchases | Keep CUID string IDs, map them to Mongo `_id`, retain `(shop, slug)` uniqueness and shop index. |
| `Level` | Campaign; point transactions and submissions | Keep CUID ID and campaign relation. Retain `(campaignId, levelNumber)` uniqueness. |
| `CustomerProgress` | Campaign; transactions, submissions, rewards, winner, purchases | Keep CUID ID and `(campaignId, shopifyCustomerId)` uniqueness; retain ranking indexes. |
| `PointTransaction` | Required progress; optional level | Keep CUID ID and scalar reference IDs. PostgreSQL's nullable compound uniqueness is represented by a Mongo partial unique index over string `levelId` values. |
| `Submission` | Campaign, level, progress | Keep CUID ID and `(levelId, customerProgressId)` uniqueness. `fileUrl` remains metadata; media bytes go to R2. |
| `Referral` | Campaign; customer IDs are stored as strings | Keep IDs, values, and `(campaignId, referralCode)` uniqueness. |
| `Reward` | Campaign, progress | Keep CUID ID and `(campaignId, customerProgressId, rewardType)` uniqueness. Optional `discountCode` uniqueness is represented as a partial unique index for string values. |
| `Winner` | Campaign, progress | Keep CUID ID, unique progress ID, and `(campaignId, rank)` uniqueness. |
| `PurchaseVerification` | Campaign, progress | Keep CUID ID and `(shop, shopifyOrderId)` uniqueness. |
| `Notification` | Campaign ID is a scalar, not a Prisma relation | Keep CUID ID and existing recipient/campaign indexes. |
| `AuditEvent` | Campaign ID is a scalar, not a Prisma relation | Keep CUID ID and existing campaign/time and event indexes. |

MongoDB fields retain their existing application names and string IDs; ordinary CUID IDs map directly to the MongoDB `_id` field. `DateTime`, `Json`, `BigInt`, and `Float` remain represented by the Prisma MongoDB connector. No ObjectId conversion is planned.

## Prepared migration assets

- `prisma/schema.postgresql.prisma`: rollback schema and source client.
- `prisma/schema.mongodb.prisma`: migration schema/client; `prisma/schema.prisma` is now the active MongoDB runtime schema.
- `scripts/migrate-postgres-to-mongodb.ts`: resumable-by-upsert per-model data copy in dependency order, preserving IDs, then count comparison. It reports counts and failures and does not delete source rows.
- `app/services/r2.server.ts`: server-only Cloudflare R2 S3-compatible client, app media URL/key helpers, upload, delete, and HEAD verification.
- `app/services/storage.server.ts`: uploads are optimized and stored in R2; there is no Supabase fallback provider. Image WebP conversion and thumbnail handling are kept.
- `app/routes/api.media.tsx`: validates content-addressed media keys and streams R2 objects with byte-range support for audio/video.
- `scripts/migrate-media-to-r2.ts`: copies Supabase public objects and inline media once per unique source URL, optimizes images through the centralized upload path, verifies R2 object sizes, updates MongoDB references only after verification, and records progress without storing source URLs in its report. Supabase files remain untouched.

## Cutover gates

The repository is configured for MongoDB/R2 runtime use. The application has not been deployed to production from this checkout, and live Shopify OAuth, webhook delivery, customer gameplay, and store traffic were not exercised during this local verification. `shopify.app.production.toml` contains an explicit `replace-with-vercel-host` sentinel that must be replaced with the actual permanent host before Shopify config deployment. Do not remove the PostgreSQL schema, backup, or Supabase source files. Before production deployment, confirm:

1. A protected PostgreSQL backup and a working `POSTGRES` source connection.
2. A MongoDB Atlas replica-set connection with `MONGODB_DATABASE_URL`.
3. Cloudflare R2 credentials and the app's `/api/media` route deployed on the app domain and Shopify app proxy.
4. Whether any active audio URL still depends on the optional legacy `SUPABASE_URL` rewrite; migration scripts remain available for any separately approved historical copy.
5. Target counts match, R2 objects are verified, and Shopify session/game/upload flows pass against staging before production points to the new services.

Keep these only in the local/deployment secret store:

See the root `.env.example` and `VERCEL_DEPLOYMENT_CHECKLIST.md` for the current server-only runtime variable list. `MEDIA_STORAGE_PROVIDER` is not a recognized runtime variable.

Keep `DATABASE_URL` and `DIRECT_URL` available for rollback and PostgreSQL-to-R2 migration scripts. The runtime Prisma schema reads only `MONGODB_DATABASE_URL`.

## Rollback

Keep the original PostgreSQL database, protected backup, and all Supabase objects unchanged. A PostgreSQL database rollback requires a separately reviewed procedure to switch the Prisma schema/client and restore or reconnect to PostgreSQL; do not change the active provider by setting an environment variable alone. Media writes currently target R2 only; rollback to Supabase requires a code change and a separate review. If an R2 copy is partial, retry from the protected migration report; do not delete source media.

## References

- [Prisma ORM 6 MongoDB connector](https://www.prisma.io/docs/orm/v6/overview/databases/mongodb)
- [Cloudflare R2 with AWS SDK for JavaScript v3](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/)
- [Shopify MongoDB session storage package](https://github.com/Shopify/shopify-app-js/tree/main/packages/apps/session-storage/shopify-app-session-storage-mongodb)
