# PL3: Plaid webhook receiver, sync robustness, SDK 48 (2026-10-14)

Uncommitted, nothing applied to any Supabase project, no dev server touched. Follows PL1 and PL2.
`docs/DECISIONS.md` and `docs/SECURITY_POLICY.md` were NOT edited; proposed text is at the end.

## Built

1. **PL1 gap 6 remainder** (`src/lib/plaid/sync.ts`, `src/lib/plaid.ts`)
   - `syncOneConnection` now processes one Plaid page at a time (`applyBatch`: retractions, upserts/adoptions,
     rule categorisation, optional auto-post), then saves `sync_cursor`. A failure or timeout on page N keeps
     the cursor from page N-1. `last_synced_at` and `status='active'` are written only when the run ends.
   - `MAX_PAGES_PER_RUN = 20` (overridable with `options.maxPages`). If the cap is hit, the result carries
     `more: true`; the manual action appends "Imported part of the history. Sync again to continue."; the
     daily cron resumes next day. `count` is now distinct transaction ids touched in the run.
   - `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION`: restart from the cursor the run began with, up to
     `MAX_PAGINATION_RESTARTS = 3`, then return the error. Replays are idempotent (upserts keyed on Plaid id,
     retraction only sets `removed_at`, categorisation only fills uncategorised rows).
   - Dead tokens: `deadConnectionReason()` (ITEM_NOT_FOUND, INVALID_ACCESS_TOKEN, USER_PERMISSION_REVOKED,
     INVALID_PRODUCT) and `isSyncMutationDuringPagination()` in `src/lib/plaid.ts`. A dead token sets
     `status='error'` (the cron only syncs `active`, so it stops retrying) and returns `deadConnection: true`
     with a distinct "Disconnect it and connect the bank again" message. `needsReconnect` stays only for login
     problems. The check constraint (0016) allows only `active/error/disconnected` and there is no message
     column, so the distinct text is returned to the caller and the Plaid code goes to the log, not the DB.
2. **Gap 8**: `client_user_id` is `sha256("walkup:plaid-client-user:" + auth uid)` (`src/lib/plaid/client-user-id.ts`),
   used in `createLinkToken` and `createUpdateLinkToken`. Not PII, not the association id.
3. **Gap 3, webhook**
   - `src/app/api/plaid/webhook/route.ts` (POST, Node, force-dynamic): raw body via `request.text()`, verify,
     then allow-list, then one RPC. 401 for any verification failure; 503 if the Plaid key fetch fails and 500
     if the RPC or env fails (so Plaid retries); 200 for every verified delivery, including no-ops and repeats.
     Logs type, code and item id only. Service-role client created inside the route, used only for the RPC.
   - `src/lib/plaid/webhook-verify.ts` (pure, `fetchKey` injected): ES256 only, key by `kid`, reject expired
     key, `node:crypto` JWK public key with `ieee-p1363`, `iat` within 300 s (also rejects future-dated), SHA-256
     of the raw body compared with `timingSafeEqual`. `cachedKeyFetcher` caches by `kid` (1 h, max 20, never
     caches a miss).
   - `src/lib/plaid/webhook-events.ts`: allow-list `ITEM/ERROR` (only `ITEM_LOGIN_REQUIRED`),
     `PENDING_DISCONNECT`, `USER_PERMISSION_REVOKED`, `USER_ACCOUNT_REVOKED`; item id must match
     `^[A-Za-z0-9_-]{1,128}$`. Nothing else in the body is read.
   - `supabase/migrations/0058_plaid_webhook_flag.sql`: `flag_bank_item_for_attention(p_item_id text) returns
     integer`, SECURITY DEFINER, `search_path = ''`, updates `active -> error` only, revoked from
     public/anon/authenticated, granted to `service_role`. No test rule needed an exception: the "anon cannot
     execute any SECURITY DEFINER function" lint still lists only `join_state_waitlist`.
   - `PUBLIC_PATHS` gains the exact `"/api/plaid/webhook"` (the `/api/cron` and `/terms` entries are kept).
   - `PLAID_WEBHOOK_URL` is added to `linkTokenCreate` (both create and update mode) when set; documented in
     `.env.local.example` (Production only).
   - `registerBankWebhook(connectionId)` server action in `bank-feed/actions.ts` for the one-off
     `itemWebhookUpdate` on existing Items (board admin through the RLS token path, one connection per call).
     No button calls it yet.
4. **Gap 9, SDK**: `plaid` 45.0.0 to 48.0.0 (`package.json`, `package-lock.json`; the lock also moved the
   transitive `uuid` 8.3.2 to 11.1.1). Release notes for 46, 47, 48: breaking changes are limited to
   `/link_delivery/*` removal, Protect and processor-token enums, CRA webhook models, and `street` in address
   data. None is used by Walkup. `tests/unit/plaid-sdk-surface.test.ts` type-checks (`satisfies`) the request
   shapes for linkTokenCreate, itemPublicTokenExchange, transactionsSync, accountsBalanceGet, accountsGet,
   itemRemove, itemWebhookUpdate and webhookVerificationKeyGet. Not reverted.

## Tests and commands (all run from the repo root)

- `npx tsc --noEmit`: clean (no errors anywhere, including other engineers' files at the time of the run).
- `npx eslint` on `src/lib/plaid.ts src/lib/plaid src/app/api/plaid src/app/bank-feed/actions.ts
  src/lib/supabase/proxy.ts tests/unit tests/db/plaid-webhook-flag.test.ts`: clean.
- `npx vitest run tests/unit tests/db/migrations.test.ts tests/db/bank-feed.test.ts
  tests/db/bank-feed-posting.test.ts tests/db/bank-feed-speed.test.ts tests/db/bank-token-reseal.test.ts
  tests/db/plaid-webhook-flag.test.ts`: 123 files, 1479 tests passed.
- New: `tests/unit/plaid-webhook-verify.test.ts` (valid, tampered, stale and future iat, wrong alg, bad signature,
  unknown kid, expired key, key-fetch failure, malformed, repeat; key cache; allow-list),
  `tests/unit/plaid-webhook-route.test.ts` (route with real ES256 signatures and a mocked RPC: flag, 401 cases,
  no-op, unknown item, repeat, 500/503, no body in logs), `tests/unit/plaid-sync-loop.test.ts` (mocked Plaid
  client and Supabase: cursor per page and ordering, page cap, partial failure, mutation restart and its limit,
  four dead-token codes, login still reconnectable, no token in logs), `tests/unit/plaid-client-user-id.test.ts`,
  `tests/unit/plaid-sdk-surface.test.ts`, `tests/db/plaid-webhook-flag.test.ts` (flip once, repeat, unknown
  item, disconnected untouched, anon/authenticated/board admin denied, definer + pinned path + grantee).
  Extended: `plaid-errors.test.ts`, `proxy-public-paths.test.ts`.
- Not run: the full `tests/db` suite and e2e (other engineers' migrations 0051-0053 and files are in flight).

## Left / open

- Gap 10 (show failed `/item/remove` on the Bank feed page) and gap 11 (closing an association must disconnect
  banks): OPEN. Both need a product decision (10 reverses nothing but adds a visible admin notice; 11 chooses
  between a checklist step and a closure guard). Not started.
- Gap 5 (docs and published text), gap 12 (optional email on `error`) untouched.
- A `status='error'` connection from a dead token still shows the "Reconnect" button, which will fail because
  update mode needs a live token. Distinguishing needs a persisted reason (a nullable `status_reason` column on
  `bank_connections`, or a fourth status) and a Bank feed UI branch; deferred because adding the column before
  the app deploys would break updates if the order is wrong. Today the message appears in the Sync-now result.
- The cron route returns a result row per connection with `count`/`categorized`; it does not yet surface
  `more` or `deadConnection` (it is another engineer's recently edited file; one-line addition when wanted).
- Doug, before enabling in production: apply 0058 to production, set `PLAID_WEBHOOK_URL` (Production only),
  confirm `SUPABASE_SERVICE_ROLE_KEY` is present, redeploy, run `registerBankWebhook` for the BMO connection (or
  reconnect), then use Plaid's `/sandbox/item/fire_webhook` in sandbox to see a 200 and the connection flip.
  Dev-DB caveat (no `session_is_aal2`) does not apply: 0058 never calls it.
- Plaid majors are reviewed quarterly: not yet written into `.github/dependabot.yml` or the policy.

## Proposed doc text (not applied)

### DECISIONS.md, new entry (suggest #35), after #34

> ## 35. A second narrow service-role path: the Plaid webhook receiver
>
> *Proposed: 2026-10-14. Needs Doug's approval before merge.*
>
> #28 allowed exactly one service-role path (the daily bank sync cron). Plaid's webhooks have no signed-in
> user, so a second is needed to learn, without waiting for the next cron, that a bank needs attention
> (login required, pending disconnect, permission revoked). It is kept as small as #28's:
>
> - `src/app/api/plaid/webhook/route.ts` creates a service-role client inside the route, in the same way the
>   cron does, and uses it only to call `flag_bank_item_for_attention(p_item_id)` (0058). The client is not
>   exported or shared.
> - The route trusts nothing until Plaid's `Plaid-Verification` signature (ES256, key fetched from Plaid by
>   `kid`, issued within 5 minutes, body hash equal to the raw body) verifies. Anything else is a 401. Only
>   four item events are acted on; every other verified webhook is a 200 no-op, and `SYNC_UPDATES_AVAILABLE`
>   is ignored on purpose (the cron remains the only unattended sync).
> - The function is SECURITY DEFINER with a pinned search_path, executable by `service_role` only, and does
>   exactly one thing: `active` to `error` on the matching connection. It reads and writes no token and no
>   ledger row, cannot touch a disconnected connection, and is idempotent.
> - `PLAID_WEBHOOK_URL` is set in Production only. `/api/plaid/webhook` (exact path) is in `PUBLIC_PATHS`.
>
> What it does not change: #18's rule everywhere else, #24's token handling, #29's rule that only a board
> member's action posts to the ledger.

### SECURITY_POLICY.md section 8 (replace the "No Plaid webhook ... surfaces only as a sync error" wording)

> Plaid webhooks: Walkup receives Plaid's item webhooks at `/api/plaid/webhook` (Production only). Each is
> verified against Plaid's published signing key (ES256, five-minute freshness, body hash) before anything is
> read; unverified requests are rejected and logged without their content. Only four item events act, and
> they only mark a bank connection as needing attention so the board sees "Reconnect"; the webhook never reads
> a token, never syncs, never touches the ledger. Transactions are still fetched by the daily sync and the
> board's own Sync now. The receiver uses the service role through a single function (DECISIONS #35). A sync
> that finds a revoked or deleted connection stops retrying it and tells the board to disconnect and
> reconnect; syncs are capped at 20 pages per run and resume from a saved cursor.

### Plaid questionnaire, answer 13 (webhooks / ongoing transaction access)

> Yes. We register a webhook URL on every Link token in production. Our receiver verifies the
> `Plaid-Verification` JWT on every request: algorithm ES256 only, the signing key fetched from
> `/webhook_verification_key/get` and cached by key id, signature checked over the header and payload,
> `iat` no older than five minutes, and the SHA-256 of the raw request body compared in constant time with
> `request_body_sha256`. Requests that fail are rejected with 401 and not processed. We act on ITEM `ERROR`
> (`ITEM_LOGIN_REQUIRED`), `PENDING_DISCONNECT`, `USER_PERMISSION_REVOKED` and `USER_ACCOUNT_REVOKED` by
> flagging the connection for the customer to reconnect; all other webhooks are acknowledged without action.
> Transactions are retrieved with `/transactions/sync` on a daily schedule and on demand, using a persisted
> cursor and per-page commits, and a revoked or removed Item is retired instead of retried.
