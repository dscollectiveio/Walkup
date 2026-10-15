# FX3: fixes for REVIEW-3 (copy and product claims)

All 37 findings addressed. Checks: `tsc --noEmit` clean; eslint on `src` and `tests/unit` has only two pre-existing unused-import warnings in files owned by others (`documents/actions.ts`, `documents/link-actions.ts`); targeted vitest (emergency, email, insurance, owner, urgent-items, tax-accountant-email, privacy-page, upkeep) green. Full suite not run.

## Blockers
- 1 Landing "never sends": `components/landing/landing.tsx` trust grid uses the report's text. Also "We recommend an accountant review" became "Have an accountant review".
- 2 Exports: honest copy chosen, no new export built. Landing (trust grid + CTA line), `lib/site-config.ts` FAQ, `app/terms/page.tsx` now list what can be downloaded today (financial statements, budget, tax forms, documents) and offer a copy of the rest on request.
- 3 Emergency rules: `lib/repairs/emergency.ts` has the report's new patterns (gas, CO, fire, electrical, flooding, sewage, no_heat). CO exclude widened to `batt` so "beeping, probably the battery" stays quiet. New `tests/unit/repairs-emergency-phrases.test.ts` asserts all 62 should-fire and 20 should-not-fire phrases.
- 4 Electrical guidance replaced (no breaker advice).
- 5 Owner insurance page: `lib/insurance/owner-summary-text.ts` (hedged, "usually", points to the declaration and Sec. 12, ask the board or agent); section title in `owner-summary-view.tsx` is now "What the master policy usually leaves to owners"; `owner-summary.ts` schema allows 400 chars per line.

## Majors
- 6 Unsubscribe: decided on fixing the words, not behaviour. A GET page that unsubscribes on arrival would be triggered by link scanners; the existing page (ticked boxes plus Save) and the RFC 8058 header route stay. Footer in `email-outbox/templates/layout.ts` is now "Stop {category} or change your choices: url" (duplicate line removed); Terms, Security and Privacy words updated; email-templates test updated.
- 7 Gas, flooding, sewage, no-heat steps replaced with the report's safe text (freezing fact removed).
- 8 "Already under control": `repairs/report/report-form.tsx` keeps the headline and the 911 steps in a collapsed details; only the priority bump is dropped. Also 27 (wrapper is `role="alert"` when it first appears) and 29.
- 9 Privacy search preview sentence reworded.
- 10 `lib/home/urgent-items.ts` 60% test claim removed (both places). 21 uninsured contractor reworded. 34 upkeep sentence reworded.
- 11 `lib/owner/standing.ts` "ahead" message (+ test).
- 12 `insurance/tabs/overview.tsx` "Coverage on file" and new note.
- 13 `owner-summary.ts` deductible tip and `coverage-check.ts` YD-WH-01 line (+ tests).
- 14 `owner/pay/page.tsx`.
- 15 Security page "No AI model writes any email that Walkup itself sends".
- 16 SOC 2 and "not used to train" removed. Security and Privacy now link each provider's own page (Supabase, Vercel, Plaid, Resend security pages and Anthropic's commercial terms; all returned HTTP 200 on 2026-10-14). I did not assert any contents of those pages. Also dropped "widely used" and "purpose-built" for Plaid, Supabase and Vercel.
- 17 "vendor" removed from Privacy and Security; heading is "Service providers".
- 18 Landing price comparison table and its `COMPARE` data deleted (no source for any row, and "5 to 15%" had none either).
- 19 FAQ headline reworded.
- 20 Upkeep templates (`lib/upkeep/schedule.ts`).

## Minors
- 22 Em dashes removed from user-visible strings in login/actions, privacy, security, policies/access-controls, dues/needs-you, home/setup-guide, login, signup, auth-shell, greeting, documents page, generate-invite-form, building/actions (message), budget page, account/mfa, and `tax/accountant-email.ts` (subjects and body; tax-accountant-email tests updated). Page titles now use "| Walkup". NOT done: em dashes inside code comments, and in files outside the report's list (tax pages and templates, bank-feed, admin, money, etc.), many of which are other engineers' files and some are "—" used as an empty-cell placeholder. `invite/[token]/invite-signup-form.tsx:14` also still has one.
- 23 "Last updated" dates are already 2026-10-14 on Terms, Privacy, Security. Not changed again.
- 24 Rotten-eggs rule skips water or kitchen appliance context via lookbehind. 25 Fire rule excludes "last year / years ago / previous".
- 26 Banner footnote 12px, no opacity.
- 28 Visit note button "Post this note", success text per report.
- 30 Canned note reworded. 31 `email-outbox/reasons.ts` ("Walkup could not confirm it was delivered", short phrase so no support address) and the urgent-items email-key text (uses SUPPORT_EMAIL). 32 Check tab and agent line for non-board readers. 33 "Suggested order". 35 MFA copy and landing heading. 36 `NEXT_REVERIFY` in `statute.ts` and a note in DECISIONS #35 (d); no dev test added. 37 "units on record", approximation sentence on IL-PROP-04 (instead of "(about)", to keep the figures testable), "Sec. 1-75 exempts smaller associations".
- 34 bills-view hint removed; delinquency hint reworded.

## Not fixed
- Em dashes outside the report's file list (see 22).
- Item 36 "show it in the dev tests": constant added only.
- No bulk export built (see 2).
