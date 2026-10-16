# Billing setup checklist (for Doug)

Everything that does not need your Stripe account is built and switched off
(see "Built so far" in `docs/specs/subscriptions-plan.md`). Until you flip
`BILLING_ENABLED`, nobody sees any change: every existing building is comped
"Early access", and the billing pages say Walkup is free during early access.

Do the steps in order. Test mode first; live mode only after it all works.

## 1. Before anything in Stripe

- [ ] Approve the new service-role entry point (the Stripe webhook, plan 2.6)
      as a DECISIONS entry, as you did for #37. It can call five `billing_*`
      functions and nothing else.
- [ ] Have the lead apply `supabase/migrations/0062_billing.sql` to production
      (it is applied to dev already). It comps every existing building.
- [ ] Make sure your `platform_admins` row exists in production (DECISIONS #31)
      so `/admin/billing` opens for you.
- [ ] Fill in `LEGAL_ADDRESS` in `src/lib/site-config.ts` (Stripe needs DS
      Collective LLC's real address).

## 2. Stripe, in TEST mode

- [ ] Create the Stripe account for DS Collective LLC. Turn on two-step login.
      Settings > Public details: statement descriptor `WALKUP HOA`, support
      email `support@walkuphoa.com`, Terms URL `https://www.walkuphoa.com/terms`
      and Privacy URL `https://www.walkuphoa.com/privacy` (Checkout's
      required Terms checkbox needs the Terms URL set).
- [ ] Products > create three products with a monthly and a yearly recurring
      price each (current landing prices; change them if you decide otherwise):
      - Starter (2 to 6 units): $19/month, $190/year
      - Building (7 to 12 units): $35/month, $350/year
      - Association (13 to 20 units): $55/month, $550/year
      Copy each price id (`price_...`).
- [ ] Settings > Billing > Customer portal: allow updating the payment method,
      viewing invoices, and cancelling **at end of period**. Do **not** allow
      switching plans (the tier follows the unit count). Set the default return
      link to `https://www.walkuphoa.com/billing`.
- [ ] Settings > Billing > Subscriptions and emails: turn on receipts,
      failed-payment emails and card-expiring emails, and Smart Retries.
- [ ] Developers > API keys: create a **restricted key** with write access to
      Checkout Sessions, Customers, Customer portal sessions and
      Subscriptions, and read access to Prices and Invoices. Use it as
      `STRIPE_SECRET_KEY`.
- [ ] Developers > Webhooks > Add endpoint:
      `https://www.walkuphoa.com/api/stripe/webhook`, events:
      - `checkout.session.completed`
      - `customer.subscription.created`
      - `customer.subscription.updated`
      - `customer.subscription.deleted`
      - `invoice.paid`
      - `invoice.payment_failed`
      Copy its signing secret (`whsec_...`).
- [ ] Decide on sales tax with the CPA (Chicago lease transaction tax); turn on
      Stripe Tax only if told to.

## 3. Vercel environment variables (Production; Preview too if you test there)

Names only; values from Stripe. All server only, none start with `NEXT_PUBLIC_`.

| Name | Value |
|---|---|
| `STRIPE_SECRET_KEY` | the restricted key (`rk_test_...` now, `rk_live_...` later) |
| `STRIPE_WEBHOOK_SECRET` | the endpoint's `whsec_...` |
| `STRIPE_PRICE_STARTER_MONTH`, `STRIPE_PRICE_STARTER_YEAR` | price ids |
| `STRIPE_PRICE_BUILDING_MONTH`, `STRIPE_PRICE_BUILDING_YEAR` | price ids |
| `STRIPE_PRICE_ASSOCIATION_MONTH`, `STRIPE_PRICE_ASSOCIATION_YEAR` | price ids |
| `BILLING_ENABLED` | leave unset until step 4 |
| `BILLING_ENFORCE` | leave unset until step 6 |

`SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_URL` are already set in
Production; the webhook uses them through its five-function allowlist. A live
key is refused anywhere except `VERCEL_ENV=production`.

## 4. Try it in test mode

- [ ] Set `BILLING_ENABLED=1` and redeploy. (Existing buildings are comped, so
      their board admins see "complimentary access" and no button.)
- [ ] On `/admin/billing`, end the comp on a test building (or use a fresh
      sign-up, which gets a 30-day trial).
- [ ] As that building's board admin, open `/billing`, Choose a plan, pay with
      Stripe's test card `4242 4242 4242 4242`. Back on `/billing` the plan
      should show within a minute. Check Developers > Webhooks shows 200s.
- [ ] Try a declined card (`4000 0000 0000 0341` to fail a renewal), the
      portal (Manage billing), and cancelling. Use Stripe test clocks to move
      through renewal, a failed payment and cancellation.
- [ ] If a webhook was missed, use "Refresh from Stripe" on `/admin/billing`.
- [ ] Give the test building its comp back when done.

## 5. Before going live

- [ ] Billing terms in `src/app/terms/page.tsx` (section 7), Stripe named in the
      Privacy Policy, landing copy changed from "free during early access" to
      the trial wording, `docs/OFFBOARDING.md` row for Stripe. Not done yet: they
      are copy you should approve, ideally after a lawyer reads the terms.
- [ ] Tell existing buildings what is coming, personally.
- [ ] Repeat step 2 in **live** mode (products, prices, portal, restricted key,
      webhook endpoint) and replace the six price ids, the key and the webhook
      secret in Production. Same webhook URL.

## 6. Later: read-only mode

- [ ] Before setting `BILLING_ENFORCE=1`, look at `/admin/billing` for buildings
      whose trial already ended while billing was off (anyone who signed up
      since 0062). Extend their trial or comp them first.
- [ ] Wire `assertCanWrite()` (`src/lib/billing/entitlement.ts`) into the write
      server actions, with the static test from plan 2.7. Not done yet on
      purpose: it touches about 270 actions and should land with enforcement.
- [ ] Then set `BILLING_ENFORCE=1`. Turning either switch off again is an
      instant rollback.

## Open decisions (plan Part 3) and the defaults used

| # | Decision | Default built |
|---|---|---|
| 1 | Provider | Stripe (hosted Checkout and Portal, no card data on our pages) |
| 2 | Prices | Tiers by unit count from `PLANS` in `site-config.ts`; above 20 units: "email sales" |
| 3 | Founding offer | Not built. Use a Stripe promotion code if you keep it (Checkout allows codes) |
| 4 | Trial | 30 days, no card, starts when a building is created (`0062` trigger, `TRIAL_DAYS`) |
| 5 | Early-access buildings | Comped "Early access" with no end date; you can set an end date per building |
| 6 | Grace period | 14 days after the first failed payment or after a trial or plan ends (`GRACE_DAYS`) |
| 7 | What read-only pauses | Nothing yet: enforcement is off and not wired into actions |
| 8 | After cancelling | Data stays, view and download always available; no deletion built |
| 9 | Payment methods | Whatever you enable in Stripe (card by default; ACH can be turned on there) |
| 10 | Sales tax | Off; ask the CPA |
| 11 | Refunds and changes | Cancel at period end via the portal; tier changes by hand at renewal |
| 12 | Who can pay | Board admins only; board members see status only |
| 13 | Comp codes | Not built; comp each building by hand on `/admin/billing` |
| 14 | Enforcement depth | App-level only, off by default |
| 15 | Billing emails | Stripe sends receipts and failed-payment emails |
| 16 | Fifth service-role path | Built, needs your approval (step 1) |
| 17 | Business details | Needed from you: address, descriptor, support email (step 2) |
