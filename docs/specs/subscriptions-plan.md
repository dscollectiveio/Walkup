# Subscriptions plan: charging associations for Walkup, with free access for chosen buildings

**Status:** proposal, 2026-10-15. Nothing here is built. Nothing here is decided
until Doug approves it; on approval it becomes a new entry in
`docs/DECISIONS.md` (it would supersede #10, "Pricing: flat annual,
provisional") and the open decisions in Part 3 get answered there.

Part 1 is for Doug, in plain words. Part 2 is the engineering plan. Part 3 is
the list of decisions only Doug can make.

## Built so far (2026-10-15, Phase 0 and the Phase 1 code)

Everything that does not need Doug's Stripe account, switched off. What Doug
must still do is in `docs/billing-setup-checklist.md`. Where the build differs
from Part 2:

- **Migration `0062_billing.sql`** (applied to dev, not production):
  `billing_accounts`, `billing_comps`, `billing_webhook_events`, all RLS on;
  `billing_status`, `billing_admin_overview`, `billing_grant_comp`,
  `billing_revoke_comp`, `billing_extend_trial`, `billing_link_checkout`,
  `billing_apply_subscription`, `billing_record_payment`,
  `billing_claim_event`, `billing_finish_event`, and the new-association trial
  trigger. Every existing association is comped "Early access". Comp codes
  are not built (decision 13). The table stores `stripe_price_id` instead of a
  lookup key, and has no `founding` column.
- **The access rules live in TypeScript only** (`src/lib/billing/entitlement-rules.ts`,
  table-tested); SQL returns facts. There is no `association_access()` in SQL
  yet; add one with database-level enforcement if decision 14 asks for it.
  Statuses: comped, trialing, active, past_due, grace (trial or plan ended,
  still working for 14 days), read_only.
- **Two switches instead of `BILLING_MODE`**: `BILLING_ENABLED` (status and
  buttons) and `BILLING_ENFORCE` (read-only), both off by default. There is no
  separate "shadow" mode: with `BILLING_ENABLED` on and `BILLING_ENFORCE` off,
  the honest status shows and nothing is blocked; `/admin/billing` always
  shows the honest status.
- **No `stripe` package**: `src/lib/billing/stripe.ts` calls the REST API
  with fetch (API version pinned), and `stripe-signature.ts` verifies
  webhooks with HMAC-SHA256 like `email-outbox/svix.ts`. Prices come from
  `STRIPE_PRICE_*` env vars, not lookup keys.
- **Webhook at `/api/stripe/webhook`** (not `/api/billing/webhook`), through
  `src/lib/billing/service-rpc.ts` (five functions).
- **Pages**: `/billing` (board admin acts, board member reads, others go to
  `/account`), `/admin/billing` (platform admin), the sidebar link for board
  admins, and the account page's "Plan and billing" card reading the real
  status. CSP `form-action` allows Stripe's hosted pages.
- **Not built yet**: `assertCanWrite` wired into server actions and its static
  test, the banner in the layout, home urgent items, landing/Terms/Privacy copy,
  `scripts/stripe-check-prices.ts`, the DECISIONS entry.

---

## Part 1. The plan in plain words

### 1.1 What we are building

A way for each building (association) to pay Walkup a subscription, plus a way
for Doug to give any building free access whenever he chooses. Everyone who
uses Walkup today keeps using it for free when billing starts, automatically.

### 1.2 Two kinds of money, kept apart

Walkup's rule is that it never touches the association's money: dues, bills and
reserves stay in the association's own bank account, and Walkup only reads the
bank (DECISIONS #22, #24). That rule does not change.

A subscription is a different thing. It is Walkup's own fee, and the
association pays it to DS Collective LLC the same way it pays its insurance
agent or its water bill. Walkup does not move the money; the board enters its
payment details on Stripe's page and Stripe charges it.

To keep the two from ever mixing:

- The Stripe account is for Walkup's own fee only. It is never used for dues,
  never connected to an association's bank, and owners never pay through it.
  "Dues payments through Walkup" stays switched off
  (`DUES_PAYMENTS_ENABLED = false` in `src/lib/site-config.ts`).
- The billing code lives in its own folder and is tested to make sure it never
  reads or writes the books, the bank feed or the dues.
- Walkup's fee shows up in the association's bank feed like any other bill, and
  the board files it the way they file everything else. Walkup does not post it
  to their books for them.

### 1.3 Who handles the card: Stripe (recommended)

We never see or store a card number or bank account number. The board is sent
to a page hosted by the payment company, enters the details there, and comes
back to Walkup. To change a card, see invoices or cancel, they open a second
hosted page ("Manage billing"). Walkup stores only the payment company's
reference numbers and the plan's status.

**Recommendation: Stripe** (Stripe Checkout for signing up, the Stripe Customer
Portal for managing billing, and Stripe's webhooks to tell Walkup when
something changes).

Why Stripe rather than a "merchant of record" such as Paddle or Lemon Squeezy:

| | Stripe | Merchant of record (Paddle, Lemon Squeezy) |
|---|---|---|
| Who the seller is | DS Collective LLC. The invoice comes from you. | The provider resells Walkup. The board's invoice and bank line name the provider, not Walkup. |
| Sales tax | You are responsible. Stripe Tax can calculate it; you register and file (or your CPA does). | The provider collects, files and remits sales tax everywhere. This is their main selling point. |
| Rough cost on a $35 monthly plan (check current rates at build time) | About $1.70 (card fee plus Billing and Tax fees) | About $2.25 (around 5% plus 50 cents) |
| Paying from the association's bank account (ACH) | Supported | Limited or not offered |
| Hosted signup and self-service billing page | Yes, mature | Yes |

At these prices the cost difference is small. The real question is sales tax.
Walkup sells only in Illinois today, so the tax picture is narrow (the main
item to ask the CPA about is the City of Chicago's lease transaction tax, which
applies to cloud software used in Chicago, and 2158 N. Damen is in Chicago).
Stripe is the better fit while Walkup is one state. If Walkup opens many states
from the waitlist, a merchant of record becomes worth another look, because
several states tax software subscriptions and registering in each is real
work. Stripe has also been rolling out its own merchant-of-record option; check
whether it is available when we build.

### 1.4 What is billed

**One subscription per building (association).** Not per person, not per
owner. Owners never pay and never see billing.

The landing page already shows provisional prices (from
`src/lib/site-config.ts`, "Doug's pricing one-pager, Oct 2026"): three tiers by
unit count (2 to 6, 7 to 12, 13 to 20 units), monthly or yearly with two months
free, plus a founding offer for the first 50 Illinois associations. DECISIONS
#10 still calls pricing provisional, so this plan treats those numbers as
Doug's to confirm, not as settled. The shapes worth choosing between:

1. **Tiered by unit count** (what the landing page shows today). Fair to small
   buildings. Walkup already knows the unit count, so the right tier is picked
   automatically. A building that adds units moves up at renewal, never mid-term
   (the landing page already promises this).
2. **One flat price per building.** Simplest to explain and to build. Small
   buildings pay the same as larger ones.
3. **Per unit per month, with a minimum.** Scales smoothly, but harder to
   explain to a volunteer treasurer and makes every unit change a billing event.

Recommendation: keep shape 1, since it is already public. Final prices are
Doug's decision (Part 3).

### 1.5 Free trial

New buildings get a free trial with **no card required**, which matches the
landing page's "No card" promise. The trial is tracked inside Walkup, so a
building that never picks a plan never becomes a Stripe customer at all. The
length is Doug's choice (Part 3). Near the end of the trial the board admin sees
a reminder on the home page; when it ends without a plan, the building goes
read-only (1.7), it is not locked or deleted.

### 1.6 Free access for chosen buildings

Two tools, for two situations.

**A. Complimentary access ("comp") set by Doug.** On a new platform admin page
(`/admin/billing`), Doug can mark any building as complimentary:

- a reason is required (for example "Early access", "Friend", "Pilot",
  "Nonprofit"), with an optional note;
- an end date is optional (leave it blank for "free until I say otherwise");
- it can be ended at any time, and the history is kept (who granted it, when,
  why, when it ended);
- only a platform admin can do this (today that is only Doug, DECISIONS #31).
  No board admin can give themselves free access.

The board sees a short line on its billing page: "Your building has
complimentary access from Walkup." It does not see Doug's note. If the comp has
an end date, the board admin is reminded 30 days before it ends.

**B. Codes for people who have not signed up yet.** Doug often wants to give
free access to a person before their building exists. Two options:

- **Walkup comp codes** (recommended if Doug expects to do this often): Doug
  creates a code on the admin page ("free for 12 months", "free forever", "good
  for 5 buildings, expires December 31"). The person enters it on the billing
  page and their building is comped, with the code as the reason. No card, no
  Stripe.
- **Stripe promotion codes** for discounts rather than free access: "50% off
  for 3 months", or the founding price. These are entered on Stripe's checkout
  page and Stripe tracks them.

Rule of thumb: free goes through Walkup comps (no card ever asked for);
discounts go through Stripe.

### 1.7 When a payment fails or a plan ends

Nobody loses their records because of a billing problem. The sequence:

1. **Payment fails.** Stripe retries automatically over a few weeks and emails
   the billing contact. Walkup shows the board admin a banner: "We couldn't
   process Walkup's payment. Update your payment details to avoid an
   interruption." Everything keeps working.
2. **Grace period** (length is Doug's choice, Part 3). Still fully working.
3. **Read-only mode** once the grace period ends, a trial ends without a plan,
   or a plan is cancelled and its paid time runs out.

What read-only means:

- **The board can still see everything** and **can still download everything**:
  financial statements, tax forms, owner statements, documents, reports.
  Exports are never blocked.
- **Owners are not affected at all.** They are not the customer. Their owner
  page, their statement, payment instructions, announcements, shared documents
  and repair reports keep working exactly as before.
- **Safety and privacy actions keep working**: removing someone's access, access
  reviews, removing a former member's personal data, two-step sign-in,
  unsubscribe links.
- **Adding people to the board keeps working**, so a new treasurer can get in
  and fix the payment.
- **What pauses** is adding to the books and running Walkup's paid features:
  recording payments and expenses, posting from the bank feed, imports,
  budgets, sending email, and AI features. Each paused button says why and
  links to the billing page.
- **Choosing a plan restores everything immediately.** Nothing needs to be
  re-entered.

Whether the daily bank sync and standing dues reminders continue during
read-only is Doug's call (Part 3), since both cost Walkup money to run but both
help the building.

### 1.8 Existing buildings

At launch, every building that already exists is automatically given
complimentary access with the reason "Early access". Nothing changes for them,
nobody is asked for a card, and nothing is charged. The Terms already promise
"plenty of notice before paid plans begin" and that nobody is charged unless
they choose a plan; this keeps that promise by default. Whether early-access
buildings stay free forever, until a date, or move to founding prices after
notice is Doug's decision (Part 3).

### 1.9 Where people see it

- **Board admin: a Billing page** (`/billing`, linked from Building and the
  sidebar, board admins only). Shows the status in plain words, the plan, the
  unit count, the next charge date, and two buttons: "Choose a plan" (to
  Stripe's checkout) or "Manage billing" (to Stripe's billing page for cards,
  invoices and cancelling). Other board members see the status only. Owners and
  accountants never see billing.
- **Doug: the platform admin billing page** (`/admin/billing`). Every building,
  its status, unit count, plan, trial end, comps; buttons to grant or end a comp,
  extend a trial, create comp codes, and refresh a building's status from Stripe.
- **Everyone signed in as a board member:** a banner only when something needs
  attention (trial ending, payment failed, read-only).
- **The landing page:** the existing pricing section stays, driven by the same
  plan list. At launch the "Free during early access" wording changes to the
  trial wording, and the Terms get real billing terms (payment, renewals,
  refunds, cancelling, what read-only means). The Privacy Policy names Stripe.

### 1.10 Rollout, in phases

| Phase | What happens | What customers notice |
|---|---|---|
| 0. Groundwork | Database tables, every existing building comped, the read-only switch built but off, Doug's admin page, the board's billing page saying "free during early access". | Nothing. |
| 1. Stripe test mode | Stripe account, products and prices in test mode, checkout and billing pages working on preview deployments, the webhook receiving test events. Read-only runs in "shadow" mode: Walkup works out who would be read-only and shows it only to Doug. | Nothing. |
| 2. Terms and notice | Billing terms and privacy text written and reviewed; landing copy prepared; Doug tells existing buildings what is coming, personally. | A notice from Doug. |
| 3. Billing on | Live Stripe keys; new buildings start a trial; read-only switched on. Existing buildings stay comped. | New sign-ups see a trial. |
| 4. Later, optional | Ending some early-access comps (with notice), founding prices, automatic tier changes at renewal, a merchant of record if Walkup goes multi-state. | Depends on Doug's choices. |

---

## Part 2. Engineering plan

### 2.1 Constraints this plan is written against

- **Walkup never moves the association's money** (#22, #24). Billing is
  Walkup's own revenue; no Stripe Connect, no payouts, no dues collection.
  `DUES_PAYMENTS_ENABLED` stays `false`.
- **No card or bank numbers stored or handled.** Hosted Stripe Checkout and the
  Customer Portal only; no Stripe Elements or card fields on our pages (keeps us
  at PCI SAQ A). We do not store card brand or last four either; the portal
  shows them.
- **No em dashes in user-facing copy.**
- **Every new table has RLS on.** Association-scoped tables carry
  `association_id`; anything global is listed in the scoping lint with a reason
  (`tests/db/migrations.test.ts`, "scope every association-owned table").
- **Service role only through a narrow, allowlisted entry point** (#18, #28,
  #36, #37). The billing webhook becomes the fifth such path and needs its own
  DECISIONS entry.
- **SECURITY DEFINER functions pin `search_path` and schema-qualify** (CLAUDE.md
  invariant 11). Platform admin checks use `is_platform_admin()`, which requires
  AAL2 since 0048.
- **Migrations are numbered after the highest existing one.** Today that is
  `0061_unit_type.sql`, so billing starts at **0062**. Renumber if anything
  lands first.
- **GRANT/REVOKE changes are verified against real Supabase over HTTP** (#21),
  not only PGlite.
- **The dev Supabase project lacks `session_is_aal2()`**; any migration that
  redefines a function calling it must follow 0048's guarded pattern.

### 2.2 Stripe setup (done by Doug in the Stripe dashboard, with a checklist)

- One Stripe account for DS Collective LLC. Statement descriptor such as
  `WALKUP HOA` so treasurers recognise the charge on their bank statement.
  Requires the real business address (`LEGAL_ADDRESS` is still a TODO in
  `site-config.ts`).
- Products: one per tier. Prices identified by **lookup keys**, not hardcoded
  IDs: `starter_month`, `starter_year`, `building_month`, `building_year`,
  `association_month`, `association_year`, plus `founding_*` variants if the
  founding offer is a separate price. One set in test mode, one in live mode.
- Customer Portal configured: update payment method, view invoices, cancel at
  period end, no plan switching in the portal at first (tier follows unit count,
  set by us).
- Checkout: `consent_collection.terms_of_service = required`, pointing at the
  Terms. Stripe Tax on if Doug and the CPA decide to collect tax.
- Stripe's customer emails on: receipts, failed payment, card expiring. These
  are Walkup's own transactional emails to its customer, sent by Stripe; they do
  not go through the association email pipeline in #36, which is about email to
  owners on a board's behalf.
- MFA on the Stripe login, and a row added to `docs/OFFBOARDING.md`, which
  currently states "Walkup has no Stripe account".
- Webhook endpoint: `https://www.walkuphoa.com/api/billing/webhook`, subscribed
  to the events in 2.6 only.
- A restricted API key (not the full secret key) with only: Checkout Sessions
  write, Customers write, Customer Portal sessions write, Subscriptions
  read/write, Prices read, Invoices read.

### 2.3 Data model (migration 0062_billing.sql)

All money stays out of these tables: prices live in Stripe and in
`site-config.ts`. If an amount is ever stored, it is `numeric(14,2)` and crosses
the API as text (#20).

**`billing_accounts`**: one row per association.

| Column | Type | Notes |
|---|---|---|
| `association_id` | uuid PK, FK `associations` on delete restrict | |
| `trial_ends_at` | timestamptz null | Walkup-side trial; set when the association is created |
| `stripe_customer_id` | text unique null | written only by the webhook (see 2.5 on why) |
| `stripe_subscription_id` | text unique null | |
| `subscription_status` | text null | check in Stripe's set: `trialing, active, past_due, unpaid, canceled, incomplete, incomplete_expired, paused` |
| `plan_key` | text null | check in `starter, building, association` |
| `price_lookup_key` | text null | |
| `billing_interval` | text null | check in `month, year` |
| `founding` | boolean not null default false | |
| `current_period_end` | timestamptz null | |
| `cancel_at_period_end` | boolean not null default false | |
| `payment_failed_at` | timestamptz null | first failure in the current run; grace counts from here; cleared on `invoice.paid` |
| `terms_accepted_at` | timestamptz null | from the checkout session's consent |
| `stripe_synced_at` | timestamptz null | `created` time of the newest Stripe event applied; older events are ignored |
| `created_at`, `updated_at` | timestamptz | |

RLS on. Select policy: `is_board(association_id)` (board admins and board
members). No insert, update or delete policies; writes only through the
functions below. On `tg_audit()` (no secrets in it, and the board may as well
see when its own billing changed).

**`billing_comps`**: history of complimentary access, like `role_grants`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `association_id` | uuid FK restrict | |
| `kind` | text | check in `early_access, friend, pilot, nonprofit, code, other` |
| `reason` | text not null | 1 to 300 chars; Doug's internal note |
| `comp_code_id` | uuid null FK `billing_comp_codes` | when redeemed from a code |
| `starts_on` | date not null default current_date | |
| `expires_on` | date null | null means no end |
| `granted_by` | uuid null FK `auth.users` | null for the launch backfill |
| `granted_at` | timestamptz | |
| `revoked_at`, `revoked_by` | | ending a comp sets these; rows are never deleted |

RLS on, **no policies**. The board learns only "comped, until when" through
`billing_status()`, never the reason. Not on `tg_audit()`, because the audit log
is readable by board admins and would expose Doug's note; the table's own
grant/revoke columns are the history. At most one active comp per association
(partial unique index on `association_id where revoked_at is null`).

**`billing_comp_codes`** (only if Doug wants codes, Part 3): global.

| Column | Notes |
|---|---|
| `id`, `label` (Doug's name for it) | |
| `code_hash` | SHA-256 of the code; the code itself is shown once on creation |
| `comp_months` | null means no end |
| `max_redemptions`, `redemptions` | |
| `expires_at`, `created_by`, `created_at`, `disabled_at` | |

RLS on, no policies. Added to the scoping-lint exception list (global by
design, platform-admin only), like `insurance_partners`.

**`billing_webhook_events`**: idempotency log. Global (an event may arrive
before we know its association).

| Column | Notes |
|---|---|
| `stripe_event_id` | text PK |
| `type`, `stripe_created` | |
| `association_id` | null, filled when known |
| `received_at`, `processed_at` | |
| `outcome` | `applied, ignored, stale, failed` |

No payload stored (no need, and it avoids keeping billing emails or names). RLS
on, no policies, lint exception with reason. Rows older than 12 months purged by
`billing_purge_events()`, called from the existing daily email-reminders cron
through its allowlist (or left to grow; it is tiny).

**New associations.** An `after insert on associations` trigger inserts the
`billing_accounts` row with `trial_ends_at = now() + interval '<trial days>'`.
A trigger rather than an edit to `create_association_and_owner` (0029) so every
creation path is covered. Trial length lives in the migration; changing it is a
new migration.

**Launch backfill (grandfathering), in the same migration:**

```sql
insert into public.billing_accounts (association_id)
select id from public.associations;

insert into public.billing_comps (association_id, kind, reason)
select id, 'early_access', 'Joined during early access; comped automatically at billing launch'
  from public.associations
 where deleted_at is null;
```

The trigger is created after the backfill, so existing buildings get no trial
date, only the comp. The 2158 N. Damen fixture gets comped like the rest.

### 2.4 Functions

All SECURITY DEFINER, `set search_path = ''`, schema-qualified, `revoke all
from public, anon`, then the specific grant listed.

| Function | Callable by | Does |
|---|---|---|
| `association_access(p_association_id) returns text` | authenticated (any member of the association, via `has_role_in`), service_role | `'full'` or `'read_only'`. Pure function of the row, active comp and `now()`; see the rules below. Returns null for non-members. |
| `billing_status(p_association_id)` | authenticated, board only | Status for the billing page: access, reason (`comp, trial, active, grace, past_due, canceled, trial_ended, none`), trial end, comp end date (not the reason), plan, interval, period end, cancel flag, unit count. |
| `billing_link_checkout(p_association_id, p_customer_id, p_subscription_id, p_terms_accepted_at, p_event_created)` | service_role | Records the customer and subscription from `checkout.session.completed`. Refuses if the customer ID already belongs to a different association. |
| `billing_apply_subscription(p_subscription_id, p_status, p_price_lookup_key, p_interval, p_current_period_end, p_cancel_at_period_end, p_event_created)` | service_role, and platform admin (for "Refresh from Stripe") | Updates the row matched by subscription ID. Ignores the call if `p_event_created < stripe_synced_at`. Derives `plan_key` and `founding` from the lookup key. |
| `billing_record_payment(p_customer_id, p_paid boolean, p_event_created)` | service_role | Sets or clears `payment_failed_at`. |
| `billing_claim_event(p_event_id, p_type, p_created) returns boolean` | service_role | Inserts the event ID; returns false if it was already there. |
| `billing_finish_event(p_event_id, p_outcome, p_association_id)` | service_role | Marks processed. |
| `billing_grant_comp(p_association_id, p_kind, p_reason, p_expires_on)` | authenticated; body requires `is_platform_admin()` | Ends any active comp and inserts the new one. |
| `billing_revoke_comp(p_association_id)` | same | |
| `billing_extend_trial(p_association_id, p_new_end)` | same | |
| `billing_admin_overview()` | same | One row per association: name, state, unit count, status, comp (with reason), trial end, plan. Billing facts only, no financial data. |
| `billing_create_comp_code(...)`, `billing_redeem_comp_code(p_association_id, p_code)` | create: platform admin; redeem: board admin of that association | Redeem hashes the input, checks expiry and count, grants a `code` comp. Rate-limited (5 attempts an hour per association) so codes cannot be guessed. |

**Access rules** (in `association_access`, mirrored by a pure TypeScript
function with table tests):

1. An active comp (`revoked_at is null`, `starts_on <= today`, `expires_on` null
   or `>= today`) gives `full`.
2. Otherwise `subscription_status in ('active', 'trialing')` gives `full`.
3. Otherwise `subscription_status in ('past_due', 'unpaid')` gives `full` while
   `now() < payment_failed_at + grace`, then `read_only`.
4. Otherwise `trial_ends_at > now()` gives `full`.
5. Otherwise `read_only`. This includes `canceled` (Stripe only reports
   `canceled` after the paid period ends when `cancel_at_period_end` was set, so
   the paid time is honoured), `incomplete`, `incomplete_expired`, `paused`, and a
   trial that ended with no plan.

**Global mode.** `BILLING_MODE` env var: `off` (everyone full; Phase 0),
`shadow` (computed, shown only to platform admins and logged; Phase 1),
`on` (enforced). The SQL always computes the honest answer; the app applies the
mode. Keeping the switch in the app means turning billing off in an emergency is
a Vercel env change, not a migration.

### 2.5 Checkout and portal (server actions, signed-in board admin)

`src/app/billing/actions.ts`:

- `startCheckout(interval)`: requires board admin (checked through
  `billing_status` succeeding plus a `has_role_in` check for `board_admin`).
  Counts units, picks the tier's lookup key (refuses above 20 units with "Email
  sales@walkuphoa.com and we'll set you up"), resolves the Stripe price by lookup
  key, and creates a Checkout Session in `subscription` mode with:
  `client_reference_id = association_id`,
  `subscription_data.metadata.association_id`,
  `customer` set to the stored `stripe_customer_id` if there is one, otherwise
  `customer_email` = the admin's email,
  `allow_promotion_codes = true`,
  `consent_collection.terms_of_service = 'required'`,
  success and cancel URLs back to `/billing`. Redirects to the session URL.
- `openPortal()`: board admin, requires a stored customer ID, creates a portal
  session with return URL `/billing`, redirects.

**Why the customer ID is written only by the webhook.** If a signed-in board
admin could store a `stripe_customer_id` (through an RPC callable by
`authenticated`), they could call it directly over PostgREST with someone else's
customer ID and inherit that customer's paid status. Instead, the only trusted
link between an association and a Stripe customer is the
`client_reference_id` on a Checkout Session that our server created with our
secret key, reported back in a signed `checkout.session.completed` event.

**CSP.** Check `src/lib/security/csp.ts`: Chrome applies `form-action` to the
redirect after a server action submits, so `https://checkout.stripe.com` and
`https://billing.stripe.com` may need to be allowed there. No Stripe script is
loaded on our pages, so `script-src` does not change.

### 2.6 Webhook receiver

`src/app/api/billing/webhook/route.ts`, `runtime = "nodejs"`,
`dynamic = "force-dynamic"`. Same shape as the Plaid and Resend receivers.

1. Read the **raw body** (`request.text()`); never re-serialise.
2. If `STRIPE_WEBHOOK_SECRET` is missing, 500 (fail closed, as the Resend route
   does).
3. Verify `Stripe-Signature` with `stripe.webhooks.constructEvent(raw, header,
   secret)` (HMAC-SHA256 over `timestamp.body`, 300-second tolerance). On failure,
   400 with no database call.
4. Ignore any event whose `livemode` does not match the environment (a test
   event reaching production, or the reverse): 200, `ignored`.
5. `billing_claim_event(id, type, created)`. False means a repeat: 200.
6. Act on an allowlist only:
   - `checkout.session.completed` (mode `subscription`): fetch the subscription,
     call `billing_link_checkout` then `billing_apply_subscription`.
   - `customer.subscription.created`, `.updated`, `.deleted`: **fetch the
     subscription fresh from Stripe** and apply that, rather than trusting the
     event's snapshot. Stripe does not guarantee delivery order; fetching the
     current object plus the `stripe_synced_at` guard makes order irrelevant.
   - `invoice.paid`, `invoice.payment_failed`: `billing_record_payment`.
   - Everything else verified: 200, `ignored`.
7. `billing_finish_event(...)`. On our own failure return 500 so Stripe retries
   (it retries for up to three days); the claimed event is released
   (`outcome = failed` rows may be re-claimed) so the retry is not treated as a
   duplicate.
8. Log event type, event ID and outcome only. No emails, names or amounts.

Add `/api/billing/webhook` (exact path) to `PUBLIC_PATHS` in
`src/lib/supabase/proxy.ts`, with a comment like the Plaid entry.

**Service role.** The route calls Supabase only through a new
`src/lib/billing/service-rpc.ts`, a copy of the email allowlist wrapper with its
own list: `billing_claim_event`, `billing_finish_event`,
`billing_link_checkout`, `billing_apply_subscription`,
`billing_record_payment`. It can call nothing else and cannot read or write a
table. Update `tests/unit/email-service-rpc.test.ts`'s list of files allowed to
read `SUPABASE_SERVICE_ROLE_KEY` (one more entry) and add the same "only one
importer" test for the billing wrapper. This is a new DECISIONS entry ("a fifth
narrow service-role path: the Stripe webhook") and needs Doug's approval, as #37
did.

**Missed webhooks.** No extra cron at first (that would be a sixth service-role
path). The platform admin page has "Refresh from Stripe" per association, which
runs as Doug's own session, fetches the subscription and calls
`billing_apply_subscription` (allowed for platform admins). Revisit a nightly
reconcile only if drift is seen.

### 2.7 Where the entitlement check lives

One module, `src/lib/billing/entitlement.ts` (`server-only`):

- `getAccess(associationId)`: wrapped in React `cache()` so a request asks the
  database once; calls `association_access` and applies `BILLING_MODE`.
- `assertCanWrite(associationId)`: throws `BillingReadOnlyError`, which server
  actions turn into the standard form error: "Your building is in read-only mode
  because the Walkup subscription has lapsed. Choose a plan on the Billing page
  to start adding again."
- `accessBanner(associationId)`: what the layout shows, if anything.

Callers:

- **Root layout** (`src/app/layout.tsx`): already loads the association for the
  sidebar on every page; it adds one `getAccess` call and passes the banner to
  `AppFrame`. Board members only; owners never see a billing banner.
- **Every mutating server action** calls `assertCanWrite` first, except an
  explicit allowlist: billing actions, people and access management (invites,
  revoking grants, access review), `redact_person`, MFA and profile, unsubscribe,
  and everything under the owner portal. There are about 50 `"use server"` files
  and about 270 exported actions today, so a static test scans them and fails if
  an exported action neither calls `assertCanWrite` nor appears in the
  allowlist with a reason. That is how we make sure none are missed now and in
  future.
- **AI calls**: `claimAiCall()` checks access too, since AI costs Walkup money.
- **Crons**: the bank sync and reminder crons skip read-only associations or
  not, per Doug's decision (Part 3).
- **Never** in GET routes that export or download (`/financial-statements/export`,
  `/tax/forms/[formId]/export`, statement and late-fee PDFs, calendars,
  documents). A test asserts no file under those routes imports the
  entitlement module.

**App-level, not database-level, at first.** Walkup normally enforces
authorization in the database. Here the plan deliberately does not, at first: a
lapsed subscription is not a confidentiality boundary (the board is entitled to
its data), so the only risk of an app-level check is someone determined calling
PostgREST directly to keep writing without paying. That is a commercial risk,
not a security one, and wiring billing into `has_role_in` would risk locking
owners out by accident. If Doug wants it later, add `association_access(...) =
'full'` checks inside the heavy write functions (`post_journal_entry`,
`record_expense`, bank feed posting, import commit), never into the read
helpers. Listed in Part 3.

### 2.8 Keeping billing away from the association's money (tests)

- A static test: no file in `src/lib/billing/**`, `src/app/billing/**` or
  `src/app/api/billing/**` imports from `@/lib/accounting`, `@/lib/plaid`,
  `@/lib/dues`, `@/lib/money` or calls `post_journal_entry`, `record_expense`
  or any bank-feed RPC.
- A migration test: no `billing_*` function body references `journal_entries`,
  `journal_lines`, `payments`, `bank_*` or `assessment_charges`.
- `DUES_PAYMENTS_ENABLED` stays `false`, and a test pins it (it already drives
  FAQ copy).

### 2.9 UI touchpoints

**`/billing`** (board admin full view; board member status only; others get the
existing `BoardOnly` treatment). States and copy (no em dashes):

| State | Headline | Action |
|---|---|---|
| Comp, no end | "Your building has complimentary access from Walkup." | none |
| Comp, with end | "Your building has complimentary access from Walkup until {date}." | "Choose a plan" (to continue after that date) |
| Trial | "Your free trial ends on {date}." | "Choose a plan" |
| Active | "{Plan} plan, billed {monthly/yearly}. Next charge on {date}." | "Manage billing" |
| Cancelling | "Your plan ends on {date}. Everything stays available to view and download after that." | "Manage billing" |
| Payment failed (grace) | "We couldn't process Walkup's payment. Update your payment details by {date} to avoid an interruption." | "Manage billing" |
| Read-only | "Your building is in read-only mode. Everything is still here, and you can view and download it any time. Owners are not affected." | "Choose a plan" |

Also: unit count and the tier it maps to, "Have a code?" field (if codes are
built), and a line on how Walkup's fee appears on the bank statement.

**Sidebar and Building page:** a "Billing" link for board admins.

**Home page:** trial-ending, payment-failed and read-only items join the
existing urgent items for board admins.

**`/admin/billing`** (platform admin, `Restricted` for anyone else, like
`/admin/partners`): the overview table, comp grant/end, trial extension, comp
codes, "Refresh from Stripe", and the `BILLING_MODE` value shown read-only.

**Landing and policies** (Phase 2, copy only; logic unchanged because the
section already renders from `PLANS`):

- `site-config.ts`: `SITE_DESCRIPTION`, `SHARE_DESCRIPTION` and FAQ answers that
  say "free during early access"; add a `TRIAL_DAYS` constant shared with the
  billing page copy.
- `src/components/landing/landing.tsx`: hero line, the "Start free today"
  callout, the "After early access" label, the CTA ("Start your free trial"),
  founding offer text if it changes.
- `src/app/terms/page.tsx` section 7: replace with billing terms (who bills, what
  is charged, renewals, unit-count true-up at renewal, cancelling at period end,
  refunds, price changes with notice, taxes, read-only after lapse, data
  export always available).
- `src/app/privacy/page.tsx`: Stripe as a processor for the billing contact's
  name and email and payment details; Walkup stores only Stripe reference IDs
  and plan status.
- A test that every `PLANS` entry has lookup keys in `src/lib/billing/plans.ts`,
  and a manual script (`scripts/stripe-check-prices.ts`) that compares Stripe's
  prices to `PLANS` before going live.

### 2.10 Environment variables

| Name | Where | Notes |
|---|---|---|
| `STRIPE_SECRET_KEY` | Preview: test restricted key. Production: live restricted key. | Server only. Fail closed like Plaid (#27): refuse an `rk_live_`/`sk_live_` key outside `VERCEL_ENV=production`, and a test key inside it. |
| `STRIPE_WEBHOOK_SECRET` | Per environment | `whsec_...` for that environment's endpoint. Local dev uses the one printed by `stripe listen`. |
| `BILLING_MODE` | All | `off`, `shadow`, `on`. Missing means `off`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Already set (Production) | Read by the billing wrapper too. Preview would need it for end-to-end webhook tests. |
| `NEXT_PUBLIC_*` | none | Hosted checkout needs no publishable key on our pages. |

Add all of them to the env list in `tests/unit/integration-wiring.test.ts` and
to `.env.local.example` (names only, no values).

Dependency: add the official `stripe` package, pinned, with `apiVersion`
pinned in the client (`src/lib/billing/stripe.ts`, `server-only`).

### 2.11 Files

New: `supabase/migrations/0062_billing.sql`, `src/lib/billing/{stripe,plans,
entitlement,access-rules,service-rpc,webhook-events}.ts`,
`src/app/billing/{page,actions}.tsx`, `src/app/admin/billing/{page,actions}.tsx`,
`src/app/api/billing/webhook/route.ts`, tests listed in 2.12.

Changed: `src/lib/supabase/proxy.ts` (`PUBLIC_PATHS`), `src/app/layout.tsx` and
`src/components/app-frame.tsx` (banner), sidebar, home urgent items, the server
actions (one line each), `src/lib/ai` claim, `src/lib/security/csp.ts` if
needed, `site-config.ts`, landing, Terms, Privacy, `tests/db/migrations.test.ts`
(lint exceptions), `tests/unit/email-service-rpc.test.ts` (key readers),
`docs/OFFBOARDING.md`, `docs/SECURITY_POLICY.md`, `docs/DECISIONS.md` (new
entries on approval).

### 2.12 Testing

**Database (PGlite, `tests/db/billing.test.ts`):**

- RLS: board admin and board member can read their own `billing_accounts` row
  and not another association's; owner and accountant read nothing;
  `billing_comps`, `billing_comp_codes`, `billing_webhook_events` return nothing
  to every API role.
- Function grants: service-role-only functions refuse `authenticated`; platform
  admin functions refuse a board admin and refuse a platform admin at AAL1;
  `billing_redeem_comp_code` refuses a board member and an owner.
- Access rules: a table of cases (comp with and without end, expired comp,
  revoked comp, trial live and ended, each Stripe status, grace inside and
  outside) against `association_access`, and the same table against the
  TypeScript mirror so they cannot drift.
- Idempotency: the same event ID claimed twice returns false the second time;
  an older `event_created` does not overwrite a newer state; a failed event can
  be re-claimed.
- Customer linking refuses a customer ID already on another association.
- Backfill: every existing association has a row and an `early_access` comp;
  a new association gets a trial row and no comp.
- The scoping lint and the "SECURITY DEFINER pins search_path" lint pass with
  the new exceptions.

**Unit (Vitest):**

- Webhook route: bad signature is 400 with no RPC call; missing secret is 500;
  a valid signature (built with Stripe's `generateTestHeaderString`) on an
  allowlisted event calls the expected RPCs; a non-allowlisted event is a 200
  no-op; mismatched `livemode` is ignored; an RPC failure is 500.
- Tier selection from unit count, including 20 and 21.
- Environment fail-closed checks for keys.
- Static tests: service-key readers, wrapper importers, billing code never
  touching money modules, every server action guarded or allowlisted, export
  routes never importing the entitlement module.

**Against real services (the #21 rule):**

- Apply 0062 to the dev Supabase project and exercise every grant over HTTP with
  a real JWT (board admin, owner, platform admin) and the service key.
- Stripe test mode end to end on a Preview deployment, or locally with
  `stripe listen --forward-to localhost:3100/api/billing/webhook`: checkout
  with Stripe's published test cards (success, decline, requires
  authentication), portal update and cancel, and **test clocks** to move time
  through trial end, renewal, a failed renewal, the grace period and
  cancellation.
- Playwright: a board admin sees the billing page states; a read-only building's
  board sees disabled actions with the explanation and can still download every
  export; an owner in a read-only building sees no change.

### 2.13 Rollout detail

- **Phase 0** (no Stripe account needed): 0062, `entitlement.ts` with
  `BILLING_MODE=off`, the server-action guard and its static test, `/billing`
  showing the comp state, `/admin/billing` with comps. Ship and leave it. Insert
  Doug's `platform_admins` rows per environment by hand if not already there
  (#31).
- **Phase 1:** Stripe test account and prices, `stripe.ts`, actions, webhook,
  service wrapper, CSP; Preview env vars; `BILLING_MODE=shadow` in Production so
  Doug can see who would be affected. The webhook DECISIONS entry approved
  before merge.
- **Phase 2:** billing terms (ideally reviewed by a lawyer), privacy text,
  landing copy in a branch, CPA answer on sales tax, notice to existing
  buildings.
- **Phase 3:** live keys and webhook endpoint, Stripe Tax if chosen, copy
  merged, `BILLING_MODE=on`. Watch `billing_webhook_events` outcomes for a week.
- **Phase 4:** comp endings with notice, founding price mechanics, automatic
  tier true-up at renewal (on `invoice.upcoming`, swap the subscription item's
  price with no proration), and a reconcile job if needed.

---

## Part 3. Decisions for Doug

1. **Payment provider.** Stripe (recommended while Walkup is Illinois only) or
   a merchant of record (Paddle, Lemon Squeezy, or Stripe's own if available)
   that handles sales tax for you.
2. **Prices.** Confirm or change the tiers and prices now on the landing page
   (Starter, Building, Association by unit count, monthly or yearly). Keep tiers
   by unit count, or switch to one flat price or per unit. What to do above 20
   units (contact sales, as today, or a fourth tier).
3. **Founding offer.** Keep it? Is it a separate price or a discount code? Who
   counts toward the first 50 (sign-up date, or first payment)? Do early-access
   buildings count automatically?
4. **Trial.** How long, and confirm no card is needed to start.
5. **Early-access buildings.** Free forever, free until a date, or moved to
   founding prices after notice? How much notice ("plenty of notice" is what the
   Terms promise)?
6. **Grace period** after a failed payment before read-only (for example 14 or
   30 days), and how long Stripe keeps retrying.
7. **What read-only pauses.** Confirm the list in 1.7. Specifically: does the
   daily bank sync continue (it costs Walkup a Plaid fee per bank)? Do standing
   dues reminders keep sending (they help owners pay)? Do owners keep reporting
   repairs (recommended yes)?
8. **After cancelling.** How long the data stays available read-only (for
   example 12 months, or indefinitely), and what notice comes before anything is
   ever removed. Export is always available either way.
9. **Payment methods.** Card only, or also paying from the association's bank
   account (ACH), or invoice and check for yearly plans.
10. **Sales tax.** Ask the CPA whether Walkup must collect Chicago's lease
    transaction tax or any Illinois tax on subscriptions, and whether to turn on
    Stripe Tax.
11. **Refunds and changes.** Refunds on yearly plans (none, prorated, or within
    30 days); cancelling at period end (recommended); unit count changes at
    renewal only (already promised on the landing page).
12. **Who can pay.** Board admins only (recommended), or any board member.
13. **Comp codes.** Build Walkup comp codes for giving access to people before
    they sign up, or just comp each building by hand from the admin page.
14. **Enforcement depth.** Read-only enforced in the app only (recommended to
    start), or also inside the database's write functions.
15. **Billing emails.** Let Stripe send receipts, failed-payment and
    card-expiring emails (recommended), or build Walkup's own.
16. **The fifth service-role entry point** (the Stripe webhook, 2.6) needs your
    approval as a DECISIONS entry, as #37 did.
17. **Business details** Stripe needs: DS Collective LLC's postal address (still
    a TODO in `site-config.ts`), the statement descriptor, and the support email
    shown on invoices.
