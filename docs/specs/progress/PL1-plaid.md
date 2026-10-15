# PL1-plaid: code gaps from the Plaid production review

Step owner: compliance review. Date: 2026-10-14. Read-only: no git commands, nothing applied to any
Supabase project, no dev server touched, no files edited besides this one and
`docs/security/PLAID-PRODUCTION-REVIEW.md`. Nothing below is implemented. Lead engineer schedules it.
Context, evidence and Plaid citations are in `docs/security/PLAID-PRODUCTION-REVIEW.md`.

Note for whoever picks this up: `src/lib/supabase/proxy.ts` has an uncommitted edit (adds `/terms` to
`PUBLIC_PATHS`); rebase gap 1 onto it rather than overwriting.

Ordered by importance. "Blocks submission" means do not submit the questionnaire before it ships.

## 1. Cron route is redirected to /login (blocks submission)

`src/lib/supabase/proxy.ts`: `PUBLIC_PATHS` lacks `/api/cron`, and `src/proxy.ts`'s matcher covers `/api`, so
an unauthenticated Vercel Cron request gets a 307 to `/login`. Daily sync and
`deprovision_stale_access` (the "automated deprovisioning" attestation) never run.

Change: add `"/api/cron"` to `PUBLIC_PATHS` (the route authenticates itself with `CRON_SECRET`; it already
returns 500 when unset and 401 on mismatch). Add a unit test next to the proxy tests asserting an
unauthenticated `GET /api/cron/sync-bank-feeds` is not redirected, and that `/api/cron/x` without the
bearer is a 401 from the route, not a 307. Keep the match exact enough: `"/api/cron/"` prefix, not `/api`.
After deploy, Doug runs the job once from Vercel and confirms a 200.

## 2. Raw Plaid errors reach the logs (blocks submission)

`src/app/bank-feed/balances.tsx:77,86` and `src/app/bank-feed/page.tsx:371` pass the caught axios error to
`console.error/warn`. That object carries `config.headers["PLAID-SECRET"]` and `config.data` with the
`access_token`.

Change: in `src/lib/plaid.ts` add

```ts
export function plaidErrorLog(cause: unknown) {
  const r = (cause as { response?: { status?: number; data?: Record<string, unknown> } })?.response;
  return {
    status: r?.status,
    error_type: r?.data?.error_type,
    error_code: r?.data?.error_code,
    request_id: r?.data?.request_id,
    message: cause instanceof Error ? cause.name : "unknown",
  };
}
```

Replace the three call sites (and add a log line with `plaidErrorLog` in the `catch` blocks of
`syncOneConnection`, `connectBank`, `createLinkToken`, `createUpdateLinkToken`, `disconnectBank`, which
currently log nothing). Never log `cause` directly. Extend `tests/unit/plaid-errors.test.ts`: build an axios-like
error with a secret in `config.headers` and assert `JSON.stringify(plaidErrorLog(e))` contains no secret
and does contain `request_id`. Add a lint-style grep test or ESLint `no-restricted-syntax` rule forbidding
`console.*(..., cause)` under `src/lib/plaid*` and `src/app/bank-feed`. Doug then checks Vercel log history
and decides whether to rotate `PLAID_SECRET`.

## 3. Webhook receiver (Plaid "strongly recommended" for ongoing transaction access)

Design is in the review doc, section 4. Work list:

- New `src/app/api/plaid/webhook/route.ts` (POST). Raw body via `request.text()`. Verify
  `Plaid-Verification`: `alg === "ES256"`, `kid` -> `plaidClient().webhookVerificationKeyGet({ key_id })`
  cached per `kid`, reject expired key, `node:crypto` `createPublicKey({ key: jwk, format: "jwk" })` and
  `verify("sha256", ..., { key, dsaEncoding: "ieee-p1363" })` over `header.payload`, `iat` within 300 s,
  `timingSafeEqual(sha256(rawBody), request_body_sha256)`. Put the verifier in
  `src/lib/plaid/webhook-verify.ts` (pure, takes `fetchKey` as a parameter) so it is testable.
- Allow-list: `ITEM/ERROR` with `ITEM_LOGIN_REQUIRED`, `ITEM/PENDING_DISCONNECT`,
  `ITEM/USER_PERMISSION_REVOKED`, `ITEM/USER_ACCOUNT_REVOKED` -> call RPC; all else 200 no-op.
- New migration `0051_plaid_webhook_flag.sql`: `public.flag_bank_item_for_attention(p_item_id text)`,
  `security definer set search_path = ''`, `update public.bank_connections set status = 'error' where
  plaid_item_id = p_item_id and status = 'active'`; `revoke all ... from public, anon, authenticated;
  grant execute ... to service_role;`. No token access. Guard for the dev-DB MFA caveat is not needed (no
  call to `session_is_aal2`).
- The route creates a service-role client only to call that RPC. This extends #28: add
  `docs/DECISIONS.md` #35 stating the second narrow use; Doug approves before merge.
- `src/lib/supabase/proxy.ts`: add `"/api/plaid/webhook"` to `PUBLIC_PATHS`.
- `src/app/bank-feed/actions.ts`: in `createLinkToken` and `createUpdateLinkToken` add
  `...(process.env.PLAID_WEBHOOK_URL ? { webhook: process.env.PLAID_WEBHOOK_URL } : {})`. Document
  `PLAID_WEBHOOK_URL` in `.env.local.example` (Production only, unset on Preview).
- One-off for existing Items: server action or script calling `itemWebhookUpdate({ access_token, webhook })`
  per active connection, board admin only. No bulk script that reads all tokens outside the cron path.
- Tests: valid, tampered body, stale `iat`, wrong `alg`, unknown item id, repeat delivery.
- Update `docs/SECURITY_POLICY.md` section 8 and the questionnaire answer 13 after shipping.

## 4. End-user disclosure copy (blocks submission)

- `src/app/bank-feed/page.tsx` (the paragraph at ~line 493, shown before `ConnectBankButton`): replace with a
  notice of this shape, linking `/privacy` and Plaid's policy:
  "Walkup uses Plaid to connect to your bank. You sign in at your bank (or through Plaid); Walkup never sees
  your bank password. Walkup will read your account names, last four digits, balances and up to two years of
  transactions, only to keep the association's books. It cannot move money. You can disconnect at any time
  with Disconnect on this page, which closes the connection at Plaid. Transactions already imported stay in
  the association's books for the retention period. See our Privacy Policy and Plaid's End User Privacy
  Policy (https://plaid.com/legal/#end-user-privacy-policy)."
  Keep the "board admin only" note visible to non-admins.
- `src/app/privacy/page.tsx`, "What we collect" bank paragraph: add account names and last four digits,
  balances, and that Plaid is a separate company handling your data under its own End User Privacy Policy with
  the link. "Who we share it with": state that Plaid sends data to Walkup at the user's direction and
  Walkup sends Plaid only the Link request and the access token. "How long we keep it": add a sentence that
  after disconnect, imported transactions remain as accounting records for the same period as the ledger
  (pending Doug's decision, review checklist item 14). Add a sentence "To disconnect a bank, a board admin
  chooses Disconnect on the Bank feed page." Bump the "Last updated" date.
- Optional: introduce `PRIVACY_EMAIL = "privacy@walkuphoa.com"` in `src/lib/site-config.ts` and use it in the
  Contact and Your rights sections; SECURITY_POLICY section 9 says requests go to "the address on /privacy".
- Mirror the bank wording in `src/app/security/page.tsx` "Bank connections" and
  `src/app/policies/data-retention/page.tsx`.

## 5. Published text and internal docs that disagree with reality or with each other

Do after Doug confirms the facts (review checklist items 6, 9).

- `src/app/policies/access-controls/page.tsx` line ~24: "SMS is not accepted as a second factor on any
  account" is false until SMS is removed (SECURITY_POLICY sections 8, 11). Either soften ("SMS is being
  removed...") or wait until done. Also reconcile "Supabase uses an authenticator app" with SECURITY_POLICY
  section 4c ("every account has... a registered passkey").
- Same page (~line 96) and `src/app/security/page.tsx` "Bank connections" and "Encryption": the "no user role
  can read" token sentence should read "no user role can read it directly; an admin calling the function
  receives only ciphertext", and add: tokens are encrypted by the application with a key held only in the
  server environment (only after Doug confirms `BANK_TOKEN_KEY` and migration 0050 in production).
- `docs/DECISIONS.md` #27 "Known, accepted gaps" and `docs/SECURITY_POLICY.md` section 8 ("No Plaid webhook...
  surfaces only as a sync error"): update mode, `ReconnectButton` and `createUpdateLinkToken` exist now.
  Record #27's addendum rather than rewriting history.
- `docs/OFFBOARDING.md`: replace `walkup-gold.vercel.app/policies/...` with `www.walkuphoa.com/policies/...`.
- `docs/SECURITY_POLICY.md` section 6: add a notification deadline, notify Plaid and affected vendors, a
  backup contact, and "exercised/not exercised"; section 3 table: add the sealing note.
- `.env.local.example`: note that `BANK_TOKEN_KEY` has no rotation procedure and loss means reconnecting
  every bank.

## 6. Sync robustness

- `src/app/api/cron/sync-bank-feeds/route.ts`: `export const maxDuration = 300;`. Wrap each connection's body in
  `try/catch` so a thrown error (for instance `plaidClient()` rejecting a missing env var, or `openSecret`)
  is recorded in `results` and the loop continues, instead of the whole run returning 500.
- `src/lib/plaid/sync.ts` `syncOneConnection`: cap pages per run (for example 20) and persist
  `sync_cursor` after each committed batch so the next run resumes; today a cursor is only saved at the end.
  Handle `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` by restarting the loop from the cursor the run began
  with (Plaid's documented recovery).
- Handle `ITEM_NOT_FOUND`, `INVALID_ACCESS_TOKEN`, `USER_PERMISSION_REVOKED` and `INVALID_PRODUCT` in the
  sync catch: mark the connection `error` with a distinct message (or `disconnected` plus a prompt to
  reconnect for the first two) so the cron does not retry a dead token every day. Extend `isLoginRequired`'s
  sibling helper in `src/lib/plaid.ts` and `tests/unit/plaid-errors.test.ts`.
- `src/lib/plaid/balance-cache.ts` is per server instance; harmless, no change.

## 7. Constant-time cron secret comparison

`src/app/api/cron/sync-bank-feeds/route.ts`: replace `request.headers.get("authorization") !== \`Bearer ${cronSecret}\``
with a `timingSafeEqual` on equal-length buffers (hash both with SHA-256 first so length does not leak).
Reuse the same helper for gap 3 if any shared secret is added. The route's import order also puts
`secret-box` before `server-only`; move `import "server-only"` first.

## 8. client_user_id per person

`src/app/bank-feed/actions.ts:30,75`: use the signed-in person's id (or hashed auth uid), not the
association id, so each board member has a distinct Plaid identity. Not PII. Low risk; only affects the
Returning User Experience and Plaid-side reporting. Note #27's "flagged so it isn't mistaken for an oversight"
and update that line.

## 9. Upgrade the plaid Node SDK (45.0.0 -> 48.0.0)

`package.json` pins `^45.0.0`; Dependabot will not cross majors. Read the plaid-node release notes, bump,
run `npm run test` (unit plus `tests/db` plaid-related) and verify `itemRemove`, `linkTokenCreate`,
`transactionsSync`, `accountsBalanceGet`, `accountsGet`, `itemPublicTokenExchange` signatures. Add a note in
`.github/dependabot.yml` or the policy that Plaid majors are reviewed quarterly. `react-plaid-link` is
already at the latest (5.0.0).

## 10. Make failed `/item/remove` calls visible

`disconnectBank` is fail-open by design (#27). The only trace of an Item still live at Plaid is
`status='disconnected' and plaid_item_removed_at is null`. Add a line on the Bank feed page for board admins
when that count is above zero, with the item ids and the text "Remove these in the Plaid Dashboard". Do not
keep the token to retry; that reverses #27. Needs Doug's agreement if you want a different trade-off.

## 11. Closing an association must disconnect its banks

There is no code path that calls `disconnectBank` when an association is closed or soft-deleted (#8). Add a
board-admin checklist step in the closure flow, or a guard that refuses closure while a bank connection is
active. Document in `docs/SECURITY_POLICY.md` section 9 and `docs/OFFBOARDING.md`.

## 12. Smaller items

- `src/lib/security/csp.ts`: when Plaid ships a new Link origin the CSP breaks silently; keep
  `tests/unit/csp.test.ts` asserting `https://cdn.plaid.com` in `script-src` and `frame-src`, and
  `https://*.plaid.com` in `connect-src`.
- `scripts/check-eol.mjs` hard-codes `POSTGRES_MAJOR = "17"`; fine, but add it to the checklist whenever
  Supabase upgrades.
- Optional email to board admins when the webhook (gap 3) or the cron flags a connection as `error`, via
  the existing Resend integration. Only after gap 3.
