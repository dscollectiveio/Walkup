# Online dues payments (Stripe Connect, ACH): build plan

Decision: DECISIONS #57. Status: Phase 1 built 2026-11-12 (migration 0097,
tests/db/online-dues-payments.test.ts), applied to dev, not prod. Phase 2 built
2026-11-12 (src/lib/payments/, src/app/dues/online-payments-*,
/api/stripe/connect/callback, tests/unit/payments-connect.test.ts). Phase 3 built
2026-11-12 (/owner/pay "Pay online" card, src/lib/payments/checkout.ts,
reconcile.ts, owner-view.ts, /api/stripe/connect/checkout-return,
tests/unit/payments-owner.test.ts). Phase 4 built 2026-11-12
(/api/stripe/connect/webhook, src/lib/payments/stripe-objects.ts,
tests/unit/stripe-connect-webhook-route.test.ts). Phase 5 built 2026-11-12 (Dues
tab badges and "Online payments to look at", bank feed "Online dues to confirm",
src/lib/payments/board-view.ts, payout-match.ts, payouts-load.ts,
tests/unit/payments-board.test.ts). Phase 7 code side done: Terms, Privacy and
Security wording written behind DUES_PAYMENTS_ENABLED (still false). Phase 0 and
the sandbox round trips are done (2026-11-12); live mode and the lawyer review
remain, see the checklist below. Doug's answers: owners always pay the full
open balance; a failed payment counts as not paid.

## Launch checklist (what is left, in order)

Status 2026-11-12: Phase 0 and the sandbox run are done (connect, success,
failure, expired Checkout, pending states, confirming a payout into the books
with the fee, and undo). The Terms were expanded (DECISIONS #58) and wait on a
real lawyer. Migrations 0097 and 0098 are on dev only. Nothing is committed
since `2debd59`.

**A. Finish sandbox**
1. Keep `stripe listen --events ... --forward-connect-to localhost:3100/api/stripe/connect/webhook`
   running until Stripe's real `payout.paid` arrives (the platform cannot create
   payouts for a Standard account, so it only comes from Stripe's schedule).
   Confirm a `stripe_payouts` row linked to the payment and the "Online dues to
   confirm" card (waiting for a deposit, since dev has no Plaid deposit).
2. Clean up the dev test data (the temporary Unit 4 charge and its journal
   entry, `online_dues_payments`, `stripe_payouts`).

**B. Legal (Doug)**
3. A real lawyer reviews `src/app/terms/page.tsx` (section 7 shows in full only
   when the flag is on) and the Privacy and Security wording behind
   `DUES_PAYMENTS_ENABLED`. Open items are in DECISIONS #58.
4. Ask counsel whether owners need to accept anything beyond Stripe's page, and
   whether the board needs a resolution to take dues electronically.

**C. Stripe live mode (Doug; never paste secrets in chat)**
5. Check what Stripe requires before Connect works live (platform profile,
   business details, review).
6. Live Connect client ID, live secret key, and the live OAuth redirect URI for
   the production site.
7. Live Connect webhook ("events on connected accounts") at
   `/api/stripe/connect/webhook` with the event types in `CONNECT_HANDLED`.
   Copy its `whsec_`.
8. Vercel production env vars: `STRIPE_SECRET_KEY` (live),
   `STRIPE_CONNECT_CLIENT_ID`, `STRIPE_CONNECT_WEBHOOK_SECRET`,
   `SUPABASE_SERVICE_ROLE_KEY` (needed by `paymentsServiceRpc`).

**D. Release ("General Kenobi")**
9. Run the full test suite, including `tests/unit/payment-details.test.ts` and
   `tests/unit/dues-status.test.ts` (written, not yet run).
10. Commit and push.
11. Apply 0097 (about 36 KB, two or more chunks) and 0098 to prod, verified by
    fingerprint.
12. Flip `DUES_PAYMENTS_ENABLED` to true and the test in
    `tests/unit/billing-isolation.test.ts` that pins it false. Deploy.

**E. First live use (Doug)**
13. The board admin connects 2158 N Damen's real Stripe account on HOA Dues.
14. One real $1 payment by an owner, then refund it in the association's Stripe
    account. Check the webhooks, the pending state and, once the payout and the
    Plaid deposit arrive, the confirm in the bank feed.
15. Open it to owners only after step 14 works.

**F. Not built, decided later if wanted:** emailing the owner and the board when
a payment fails (today it shows on both pages), partial refunds, autopay (needs
a new decision and new Terms wording).

## Known gap against #57

The owner functions `start_online_dues_payment` and `my_open_online_checkouts`
return the connected account id to the owner's own session, because Walkup's
server needs it to call Stripe. It is never shown on a page, but a technical
owner could read it by calling the database directly. Stripe does not treat
account ids as secret. If this should be strict, move those lookups behind the
payments service key.

Owners pay dues by ACH from the HOA Dues tab. Each association connects its own
Stripe account (Standard). The association pays Stripe's fee. Walkup never holds
money, never sees bank numbers, and takes no cut. Nothing reaches the ledger
until a board member confirms the Stripe payout in the bank feed (#29).

## How money and records move

```
Owner presses "Pay $400"  ->  Stripe Checkout (ACH, hosted)  ->  association's Stripe balance
      |                                                               |
      | webhook: checkout.session.completed                           | ~4 business days later
      v                                                               v
online_dues_payments: processing -> succeeded (or failed)      Stripe payout (net of fees)
unit shows "Paid online, pending deposit"                       lands in the association's bank
                                                                      |
                                                     Plaid bank feed shows one deposit
                                                                      |
                                    Board clicks "Confirm Stripe payout" (one click)
                                                                      v
                       One journal entry: bank +net, Bank & Merchant Fees +fees,
                       each unit's receivable -gross. Payments marked "deposited".
```

## Phase 0. Accounts and keys (Doug, outside the code)

1. In Walkup's Stripe dashboard (test mode first): Settings, Connect. Turn on
   Connect, choose **Standard accounts** with **OAuth**. Set the platform name,
   icon and support email that owners and boards see.
2. Add the OAuth redirect URIs: `http://localhost:3100/api/stripe/connect/callback`
   and the production one.
3. Create a second webhook endpoint, **listening to events on connected
   accounts**, pointed at `/api/stripe/connect/webhook`. Copy its signing secret.
4. New env vars: `STRIPE_CONNECT_CLIENT_ID` (`ca_...`) and
   `STRIPE_CONNECT_WEBHOOK_SECRET`. The existing `STRIPE_SECRET_KEY` makes the
   API calls (with the `Stripe-Account` header).
5. Your building's Stripe account (2158 N Damen) is the first connected account.
   Stripe asks the association for its EIN, a board member's identity and the
   bank account. That happens on Stripe's pages, not in Walkup.

## Phase 1. Database (migration 0097)

- `association_payment_accounts`: `association_id` (unique), `stripe_account_id`,
  `livemode`, `charges_enabled`, `payouts_enabled`, `connected_by`,
  `connected_at`, `disconnected_at`. RLS: the board and the accountant can read.
  Writes only through security-definer functions that check board_admin, and
  the service role for the webhook's status updates.
- `online_dues_payments`: `id`, `association_id`, `unit_id`, `person_id`
  (who paid), `amount_cents`, `fee_cents` (filled in when known),
  `stripe_checkout_session_id` (unique), `stripe_payment_intent_id` (unique),
  `stripe_payout_id`, `status`
  (`processing | succeeded | failed | refunded | disputed | deposited`),
  `failure_reason`, `journal_entry_id`, timestamps. RLS: an owner reads their own
  unit's rows. The board and the accountant read all of them. No direct writes.
- `stripe_connect_events`: event id primary key, the idempotency claim (same
  pattern as the subscription webhook).
- `post_stripe_payout(bank_transaction_id, payout_id)`: security definer,
  board_member or board_admin. It checks that the payout's net amount equals the
  bank deposit, then posts one balanced journal entry (bank debit net, Bank &
  Merchant Fees debit total fees, each unit's dues receivable credit gross),
  marks the bank transaction posted, and sets the payments to `deposited`. All
  in one transaction. Refuses if already posted.
- `association_payment_accounts.stripe_account_id` never reaches an owner.

## Phase 2. Setup on the HOA Dues tab (board admin)

The "How to pay" card gets a second section, **Online payments**:

- **Not connected:** "Let owners pay dues by bank transfer (ACH) here.
  The association pays Stripe's fee: 0.8% per payment, never more than $5.
  Money goes straight to the association's Stripe account and then its bank.
  Walkup never holds it." Button: **Set up online payments**. Board admin only,
  MFA required. Others see "The board hasn't turned on online payments."
- **Connecting:** the button goes to Stripe's OAuth page with a signed `state`
  (association id, user id, expiry, HMAC), so a callback can't be replayed or
  forged. `/api/stripe/connect/callback` checks the state and that the user is
  still board_admin, exchanges the code, stores only `acct_...`, then returns to
  `/dues?connected=1`.
- **Connected, Stripe still needs details:** "Stripe needs a few more details
  before owners can pay." Link to the Stripe dashboard. Driven by
  `charges_enabled` and `payouts_enabled` from the `account.updated` webhook.
- **Connected and ready:** "Online payments are on. Owners see a Pay button."
  A **Turn off** link (board admin) hides the Pay button and deauthorizes the
  account at Stripe (`/oauth/deauthorize`). Payments already in flight still
  finish and still show.
- The card's hint ("No processor, no fee for anyone") changes when online
  payments are on, since that would no longer be true.

## Phase 3. Owner Pay button

- On the owner's dues view, next to the balance: **Pay $400 by bank transfer**.
  Shown only when the association is connected and ready, the unit has a balance
  over zero, and there is no payment for that unit already `processing`.
- The amount is the unit's open balance, computed on the server. The owner can't
  edit it in v1 (partial payments come later if wanted).
- A server action creates a Checkout session on the connected account:
  `mode=payment`, `payment_method_types[]=us_bank_account`, amount, a line item
  "HOA dues, Unit 2", `client_reference_id` = the unit id, metadata (association
  id, unit id, person id, and our `online_dues_payments` id), success and cancel
  URLs back to `/dues`. Insert the `processing` row first so a double click
  can't create two.
- Copy after paying: "Payment started. Bank transfers take about 4 business
  days. We'll show it as paid once it clears."
- CSP: Checkout is a redirect to `checkout.stripe.com`, so no new script source.

## Phase 4. Connect webhook (`/api/stripe/connect/webhook`)

A separate route from the subscription webhook, with the same discipline:
verify the signature over the raw body, use an allowlist, claim the event id once,
fetch the object fresh from Stripe, and act through a service-role RPC that can
touch only these tables.

| Event | What it does |
|---|---|
| `checkout.session.completed` | Link the payment intent. Status stays `processing`. |
| `checkout.session.async_payment_succeeded` / `payment_intent.succeeded` | Status `succeeded`. Read the fee from the balance transaction. |
| `checkout.session.async_payment_failed` / `payment_intent.payment_failed` | Status `failed` with the reason. Email the owner and the board (through the approved email paths in #36). |
| `charge.refunded` | Status `refunded`. If already deposited, flag it for the board to reverse. |
| `charge.dispute.created` | Status `disputed`. Flag it for the board. |
| `payout.paid` | Record which payments are in the payout (balance transactions by payout). |
| `account.updated` | Refresh `charges_enabled` and `payouts_enabled`. |
| `account.application.deauthorized` | Mark the account disconnected. |

The webhook never posts to the ledger.

## Phase 5. Board side: seeing it and posting it

- The dues roster shows a "Paid online, pending" badge for units with a
  `processing` or `succeeded` payment. That unit's balance still shows owed until
  posted, with the pending amount beside it, so nobody double-chases.
- **Bank feed:** when a deposit matches a Stripe payout by amount and date (Plaid
  descriptions usually read "STRIPE TRANSFER"), the row suggests **Confirm
  Stripe payout: 3 dues payments, $1,200 less $9.60 fees**. One click calls
  `post_stripe_payout`. The breakdown shows each unit and the fee.
- Failed, refunded and disputed payments show under "Needs you".
- The budget page needs nothing new: the fees post to Bank & Merchant Fees.

## Phase 6. Tests

- Unit: the state token (sign, verify, expiry, tamper), the Checkout parameters
  (ACH only, amount from the server, metadata), the webhook allowlist and
  idempotency, the status transitions (no `succeeded` -> `processing`), and the
  copy (no em dashes, fee wording).
- DB (PGlite): RLS so an owner sees only their unit's payments and no
  `acct_...`, and only board_admin can connect or disconnect. `post_stripe_payout`
  balances, refuses a net mismatch, refuses a second post, and leaves the unit
  balance right.
- Webhook route: a bad signature gives 400 with no database call, a repeat event
  is a no-op, and an unknown event gives 200 and is ignored.
- End to end in Stripe test mode: connect a test account, pay with Stripe's test
  bank account (success, then the failing test account), trigger a payout, and
  confirm it in the bank feed.

## Phase 7. Before going live

- Update the Terms, Privacy and Security pages: Stripe processes the payments,
  Walkup never holds funds, and the association is the merchant. This needs a
  lawyer to review the Terms change, like #56.
- Update the "How to pay" hint, the features list, the walkthrough and the tour
  (the dues step).
- Switch the keys to live, register the live Connect webhook, and connect
  2158 N Damen's live account. Run one real $1 payment and refund it.
- Then open it to other associations.

## Not in v1

Autopay or recurring debits (a new decision), cards, partial or custom amounts,
paying another unit's dues, and Walkup application fees.

## Open questions for Doug

- Should the owner choose the amount (partial payments, prepaying next month), or
  always pay the full open balance? The plan assumes the full balance.
- When a payment fails, should the late fee clock ignore the attempt? The plan
  assumes yes: a failed payment counts as not paid.
