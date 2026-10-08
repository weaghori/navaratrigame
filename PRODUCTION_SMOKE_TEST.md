# Production Smoke Test Plan

**No tests in this file have been executed against Vercel or a live Shopify
store.** Run first on an isolated Preview environment with non-production
Shopify, MongoDB, and R2 resources. Use the exact test matrix below and record
the date, deployment URL, test account, result, and evidence without including
secrets or customer media.

| # | Test | Expected result | Result |
|---|---|---|---|
| 1 | Shopify OAuth install on the dedicated test store | `/auth/callback` completes, session is persisted in the Preview MongoDB database, and browser returns to embedded app | Not run |
| 2 | Embedded admin load | App Bridge initializes inside Shopify Admin; no iframe/connectivity error or missing asset | Not run |
| 3 | Campaign load | Correct campaign is shown for the test shop; another shop's campaign is never returned | Not run |
| 4 | Levels load | Configured levels, availability, and challenge copy load; locked levels remain locked | Not run |
| 5 | Customer authentication | Logged-out visitor sees public preview; logged-in test customer resolves only their own progress | Not run |
| 6 | Customer image authorization | A valid logged-in customer and available photo level receive a short-lived presigned PUT; invalid shop/customer/level is rejected | Not run |
| 7 | Browser-to-R2 upload | Small test image is PUT directly to the Preview R2 bucket with the signed headers; the Vercel request carries JSON only | Not run |
| 8 | Image verification/optimization | Finalize rejects malformed, mismatched, or over-limit objects; valid image is decoded by Sharp and final object is WebP with orientation applied and dimensions capped | Not run |
| 9 | MongoDB submission creation | The submission references the finalized app media URL and has the expected campaign, level, customer, and pending-review status | Not run |
| 10 | Points awarding | Points remain unchanged while a photo is pending; approval awards the configured amount once; retries do not double-award | Not run |
| 11 | Referral | Test referral code is attributed to the test campaign/customer and duplicate/repeated requests do not double-award | Not run |
| 12 | Rewards | Eligible test customer sees the correct reward; issued/used status is consistent and discount code is not leaked to another customer | Not run |
| 13 | Admin submission review | Authorized shop admin can review their shop's submission; unauthorized shop/admin cannot | Not run |
| 14 | Media retrieval | `/api/media` and App Proxy media route serve the finalized image with correct type, cache, and range behavior; missing/invalid keys return 404 | Not run |
| 15 | Ordinary webhook delivery | Shopify-signed `app/uninstalled`, `app/scopes_update`, and `orders/paid` test deliveries are authenticated and idempotent | Not run |
| 16 | Privacy webhook behavior | **Blocked:** do not send live erasure events until policy-backed `customers/data_request`, `customers/redact`, and `shop/redact` handlers exist and pass isolated tests | Not run |
| 17 | Logout/session behavior | Shopify logout returns to the intended campaign route; session expiration/re-auth works without exposing tokens | Not run |

## Test hygiene

- Never use a real customer or order in Preview.
- Use a dedicated temporary test customer and test campaign; keep the test
  object under the Preview bucket/prefix and delete it after verification.
- Verify R2 object contents and database references without printing tokens,
  signed URLs, connection strings, or private customer data.
- Exercise a failed MongoDB submission write in Preview and confirm the unique
  permanent R2 object created for that finalize attempt is cleaned up.
- Exercise abandoned staging uploads and confirm the lifecycle rules are
  configured only for `navratri/admin-staging/` and
  `navratri/submissions/uploads/`.
- Stop if any test points at Production resources or the live store.
