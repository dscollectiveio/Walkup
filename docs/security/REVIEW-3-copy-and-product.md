# Review 3: copy, product claims, roles and legal citations

Reviewer: product and compliance pass, read-only. Date of review: 2026-10-14 (evening).
Standards: `docs/specs/insurance-repairs-overhaul.md` section 1, DECISIONS #22, #35, #36, and the house rules.

Method: read the changed and new user-facing files in `src/app/{insurance,repairs,maintenance,contractors,bills,owner,delinquency,dues,building/import,unsubscribe,documents/upload,announcements,statements,privacy,terms,security}`, `src/components/{ai,email,home,upload,landing,auth,repairs,owner}`, `src/lib/{insurance,repairs,email-outbox/templates,home,owner,upkeep,collections,statements,import}`, and the landing page and FAQ. Ran grep scans (em dashes, vendor, best, guarantee, recommend, TODO, exclamation marks, "never sends"). Ran the emergency rules against 82 realistic phrases (62 that should fire, 20 that should not) (scratch script outside the repo). Fetched the Illinois Condominium Property Act (765 ILCS 605) from ilga.gov and compared every quote in `statute.ts`.

Note on timing: other edits landed in the tree while this review ran (Terms section 3, Privacy "Email from Walkup", Security "Email from Walkup", the usage tip and the draft-email footer were updated between 20:38 and 20:43). Findings below were re-checked against the tree at about 20:45. Anything already fixed by those edits is in the "checked and fine" list.

Counts: 5 blockers, 16 majors (6 to 21), 16 minors (22 to 37).

---

## BLOCKERS

### 1. Landing page still says Walkup never sends email (stale after #36)
- File: `src/components/landing/landing.tsx:420`
- Current text: `["Never sends anything without you.", "Reminders and accountant emails open as drafts in your own inbox. You press send."]`
- Why wrong: with #36, Walkup sends dues reminders, late fee notices, statements and announcements itself once a board admin approves a batch or switches on a rule. The Terms (section 3), Privacy and Security pages now say so; the public sales page contradicts them. Accountant emails are still drafts, but "Reminders ... open as drafts ... You press send" is no longer true.
- Replace with: `["Never emails anyone without a board admin's approval.", "Reminders and statements go out only after a board admin approves them. Messages to contractors, agents and your accountant open as drafts in your own email app."]`

### 2. "Export the ledger, documents and owner list" is not true today
- Files and lines: `src/components/landing/landing.tsx:424` and `:614`, `src/lib/site-config.ts:157` (FAQ, also rendered into FAQPage structured data), `src/app/terms/page.tsx:77`.
- Current text:
  - landing 424: `"Your data leaves when you do."` / `"Export the ledger, documents and owner list any time. No contract."`
  - landing 614: `No card. Read-only bank access. Your data, always exportable.`
  - site-config 157: `It's yours. Export the ledger, documents and owner list any time. There's no contract.`
  - terms 77: `You can export your ledger, documents and owner list at any time, and ask us to delete your information.`
- Why wrong: the only exports in the app are the Profit and Loss workbook and PDF (`src/app/financial-statements/export`), the budget (`src/app/budget/export`), tax form packets, statement PDFs, and single-document download. There is no ledger or journal export, no owner list export and no bulk document export (`find src -path '*export*'`, no `text/csv` response anywhere except the import error file). A contractual promise (Terms) and a marketing claim that the product cannot keep. Either build the exports or change the words.
- Replace with (if the exports are not built before launch):
  - landing 424: `"Your records stay yours."` / `"Download your financial statements, budget, tax forms and every document you uploaded. Ask us for anything else. No contract."`
  - landing 614: `No card. Read-only bank access. Your records stay yours.`
  - site-config 157: `It's yours. Download your financial statements, budget, tax forms and documents any time, and email us for a copy of the rest. There's no contract.`
  - terms 77: `You can download your financial statements, budget, tax forms and documents at any time, ask us for a copy of the rest of your association's records, and ask us to delete your information.`

### 3. Emergency detection misses common, unambiguous phrasings
- File: `src/lib/repairs/emergency.ts` (`EMERGENCY_RULES`, lines 54 to 140).
- Why wrong: the banner is the only safety content and it must not depend on a model (spec). A reporter who types any of these gets no safety steps and a normal priority. Test results (winter date, rules as shipped):
  - Not detected (false negatives): `I can smell natural gas`, `Smell of propane in garage`, `The whole building smells like natural gas`, `CO alarm went off last night`, `CO detector is beeping nonstop and I feel dizzy`, `I see smoke in the stairwell`, `I see smoke`, `smoke detector going off and I smell smoke`, `Smell something burning in hall`, `Wire is hanging loose and exposed`, `A pipe broke and water is everywhere`, `Water heater leaking all over floor`, `Water running down the walls from upstairs`, `Floor drain is backing up`, `Furnace stopped working`, `Heat has been out since yesterday`, `Boiler died`, `Heating system failed`.
  - Detected correctly: 44 of the 62 positive phrases (for example `I smell gas in the hallway`, `Smoke is coming from the basement`, `Pipe burst in unit 2`, `Sewage in the basement`, `No heat in the building`).
  - Correctly suppressed (no false positive): fire extinguisher inspection, smoke detector battery, chirping CO detector, old water stain, spark plug, flood lights, fire door, elevator door stuck open, `Gas leak was fixed last week`.
  - One false positive: `Dishwasher smells like rotten eggs` fires the gas banner (the `rotten eggs?` pattern has no context). `Hot water smells like rotten eggs` will do the same. Erring safe is acceptable, but the banner says "If you smell gas, leave first", which will alarm for a water-heater smell. See minor 24.
- Fix (add to the matching rules; keep `exclude` as is):
  - gas: `/\b(smell|smells|smelled|smelling)\b.{0,25}\b(natural gas|propane|gas)\b/i`, `/\b(natural gas|propane)\b.{0,15}\b(smell|odou?r|leak|leaking)\b/i`
  - carbon_monoxide: `/\b(co|carbon monoxide) (alarm|detector)s? (is |are |has |have )?(went off|gone off|going off|sounding|alarming|beeping)\b/i` (the existing `exclude` for battery or chirp still applies)
  - fire: `/\b(i )?(see|saw|smell|smelled|smelling|there'?s|there is) (a lot of |some )?(smoke|something burning)\b/i`, `/\bsmoke (in|from|under|near|filling)\b/i`
  - electrical: `/\bwires? (is |are )?(hanging|dangling|loose|bare|sparking)\b/i`
  - flooding: `/\b(pipe|line|water heater|supply line|hose)\b.{0,20}\b(broke|snapped|split|failed|burst)\b/i`, `/\bwater\b.{0,25}\b(all over|everywhere|running down)\b/i`, `/\bwater heater\b.{0,20}\b(leaking|leaks)\b/i`
  - sewage: `/\bfloor drains?\b.{0,20}\bback(ing|ed)? ?up\b/i`
  - no_heat: `/\b(heat|heating|boiler|furnace)( system)? (has been |is |was )?(stopped working|died|quit|failed|is out|has been out|has failed)\b/i`
  - Add a test file of the phrases above (they are in the scratch script `review-c/em-test.mjs` if wanted) and assert each fires.

### 4. Emergency guidance gives engineering advice that can hurt someone (electrical), and goes well beyond "call 911 / the utility"
- File: `src/lib/repairs/emergency.ts:187-197` (and see 142-150, 198-208, 209-219, 220-232).
- Current text (electrical): `"If it's safe to reach, switch off that circuit at the breaker panel."`
- Why wrong: standard electrical safety advice for sparking or burning equipment is to stay back and call 911 or an electrician; sending people to a panel when equipment is sparking, burning or near water is a hazard. The brief and the review standard say no engineering or medical advice beyond "call 911 / the gas company".
- Replace the electrical entry with:
  - headline `Stay away from sparking or burning equipment.`
  - steps `["Keep everyone away from it. Don't touch it.", "If there is smoke, flames or a burning smell, leave the building and call 911 from outside.", "Otherwise call an electrician now and tell the board."]`
- See major 7 for the other kinds that also give practical instructions.

### 5. The owner insurance page tells owners what they must insure, as fact, from one dropdown, and contradicts the coverage check
- Files: `src/lib/insurance/owner-summary-text.ts:12-29` (`LEFT_TO_OWNERS`) and `:43-48` (`COVERAGE_FORM_OWNER_WORDS`), rendered by `src/app/insurance/components/owner-summary-view.tsx` ("What the master policy leaves to you").
- Current text (bare walls): `"Everything inside your unit's bare walls, floors and ceilings: cabinets, counters, fixtures, plumbing and electrical fixtures, flooring and wall coverings"` and `"The association insures the building's structure. Everything inside your unit's walls is left to you."`
- Why wrong: this is a statement about coverage and about what the owner must buy, generated only from the board's `coverage_form` choice. It conflicts with the Condominium Property Act, which the product itself cites: Sec. 12(a)(1)(i) puts the bare walls, floors and ceilings in the master policy "except as otherwise determined by the board", and Sec. 12(b) says common elements "include fixtures located within the unfinished interior surfaces of the perimeter walls ... initially installed by the developer". The coverage check rule `IL-FORM-01` (`coverage-check.ts:371`) says exactly that and asks the agent about it, while the owner page states the opposite flatly. Owners may skip insurance they need or buy cover they do not. Rule: no advice, no invented facts.
- Replace the fixed lists with hedged, source-pointing wording, board-editable (the editor already allows edits), for example for `bare_walls`:
  - `"Under a bare-walls policy the association usually insures the building's structure and the unfinished walls, floors and ceilings. Cabinets, fixtures, appliances, floor and wall coverings and your belongings are usually the owner's to insure."`
  - `"Your declaration and the Illinois Condominium Property Act (Sec. 12) decide the details. Ask the board or your own agent to confirm."`
  - and `COVERAGE_FORM_OWNER_WORDS.bare_walls` → `"The board recorded this as a bare-walls policy. That usually means the association insures the building's structure and the unfinished walls, and owners insure what is inside. Check the declaration."` (same hedge for `single_entity` and `all_in`).

---

## MAJOR

### 6. "One-click unsubscribe" is promised; the visible link opens a form that needs a Save
- Files: `src/app/terms/page.tsx:76` (`Owners can unsubscribe from any email in one click.`), `src/app/security/page.tsx:215` (`Every message carries a one-click unsubscribe link`), `src/app/privacy/page.tsx:233` (`we stop sending as soon as you use it`), `src/lib/email-outbox/templates/layout.ts:44` (`Unsubscribe from ${category}: ${url}`).
- Why wrong: the link in the email body opens `/unsubscribe/[token]`, which shows all boxes ticked and a Save button (`unsubscribe-form.tsx`); nothing is unsubscribed until the person unticks and saves. The true one-click path is the `List-Unsubscribe-Post` header route, which the person never sees. The footer label "Unsubscribe from dues reminders" implies the link does it.
- Replace, either:
  - behaviour: make the footer link's page unsubscribe from that email's category on arrival with an "Undo" and "Change my choices" (reading must stay side-effect free for mail scanners, so use a POST button labelled `Unsubscribe from dues reminders` pre-selected), or
  - words: Terms `Every email has an unsubscribe link at the bottom that works without signing in.` Security `Every message carries an unsubscribe link and the standard one-click unsubscribe header.` Footer `Stop these emails or change your choices: ${url}` (drop the duplicate second line, which is the same URL).

### 7. Emergency steps go beyond "call 911 / the utility" for gas, water, sewage and cold
- File: `src/lib/repairs/emergency.ts:142-232`.
- Current text: gas `"Get everyone out of the building now. Leave doors open on the way."` and `"Don't switch lights or appliances on or off, and don't use a phone until you're outside."`; flooding `"Shut off the water at the nearest valve, or at the main shut-off."`; sewage `"Don't run water, flush toilets or use the washer until it's cleared."`; no heat `"Pipes can freeze within hours in very cold weather. Open cabinet doors under sinks on outside walls."`
- Why wrong: engineering instructions and an unsupported fact ("within hours") from Walkup, not from the utility. Some are standard utility advice; if Doug wants to keep them, they need the utility's wording and a stated source on the page.
- Replace:
  - gas steps `["Get everyone out of the building now.", "From outside, call 911 or the gas company's emergency number.", "Don't go back in until you are told it is safe.", "Then tell the board here."]`
  - flooding headline `Water coming in is urgent.`, steps `["Keep away from water near outlets, cords or the electrical panel.", "If anyone is in danger, call 911.", "Call a plumber now and tell the board. Take photos for the insurance claim."]` (the building's own "Main water shut-off" line from the board still shows under the steps).
  - sewage steps `["Keep people and pets away from the backed-up water.", "Call a sewer or drain service now and tell the board. Take photos for the insurance claim."]`
  - no heat steps `["Call the heating contractor today.", "If anyone is at risk from the cold, call 911."]`

### 8. Choosing "No, it's already under control" removes all safety steps for a reported gas leak or fire
- File: `src/app/repairs/report/report-form.tsx:158` and `:366`.
- Current text: `Thanks. We won't mark it as an emergency.` / `No, it's already under control`
- Why wrong: the answer is self-reported and the banner (including "Call 911 from outside") vanishes, even for kinds where "under control" is not something a reporter can judge (gas, carbon monoxide, fire).
- Fix: when the reporter says no, keep the headline and the `Call 911` button visible, collapsed into a `<details>`, and only drop the priority bump. Text: `Thanks. We won't mark it urgent. If anything changes, the safety steps are here.`

### 9. Privacy page overstates how much the board sees before an insurance web search
- File: `src/app/privacy/page.tsx:193`
- Current text: `Your board sees exactly what will be searched before it runs.`
- Why wrong: true for the contractor search (the phrase and `Use it`), not for the insurance Marketplace. `src/app/insurance/tabs/market.tsx:184` only shows a generic sentence (`It sends only your city, ZIP, unit count, stories, year built, construction type and the coverage you carry.`), not the actual values.
- Replace: `Your board is told what kinds of details will be used before a search runs, and sees the exact phrase for a contractor search before it runs.` (or show the real values in the Marketplace card and keep the sentence).

### 10. Tax-flavoured claim on Home: unpaid dues "count against the 60% income test"
- File: `src/lib/home/urgent-items.ts:207` and `:220`
- Current text: `Unpaid dues hurt cash flow now and count against the 60% income test in April.`
- Why wrong: Walkup is not a tax adviser. The books are cash basis, so unpaid dues are not income and do not enter the test either way; the sentence states a tax consequence with no basis. It also appears in a nudge to a volunteer treasurer.
- Replace: `Unpaid dues hurt cash flow. Collections shows who is behind and what has been sent.` (both places, with the unit list kept in the second).

### 11. Owner "ahead" message promises an outcome
- File: `src/lib/owner/standing.ts:89`
- Current text: `That is money you paid that has not been applied to a charge yet. It will cover your next charges.`
- Why wrong: the board decides how a credit is applied; "will" is a promise Walkup cannot make.
- Replace: `That is money you paid that has not been applied to a charge yet. The board usually applies it to your next charges. Ask the board if you are unsure.`

### 12. "What you're covered for" and "Nothing in your facts suggests you need these"
- File: `src/app/insurance/tabs/overview.tsx:309` and `:346`
- Current text: card title `What you're covered for`; note `Not on file. Nothing in your facts suggests you need these.`
- Why wrong: the first reads as "you are covered" (rule 2); the records show only what is on file, and the second is a reassurance Walkup cannot give (the facts form is optional, and most findings are suppressed when facts are unknown).
- Replace: title `Coverage on file`; note `Not on file. The coverage check asks about these only when your answers point to them.`

### 13. Owner insurance tips assert the association's rules
- Files: `src/lib/insurance/owner-summary.ts:78` and `src/lib/insurance/coverage-check.ts:570`
- Current text: `Under your association's rules, an owner may be charged up to that amount.` / `Owners may be charged their share under your rules.`
- Why wrong: Walkup does not hold the rules. Illinois Sec. 12(c) lets the board choose among paying the deductible as a common expense, assessing it after notice and a hearing, or requiring the affected owners to pay; which applies depends on the declaration and rules.
- Replace: `Depending on your declaration and rules, the association may be able to charge an owner part or all of that amount. Ask the board, and ask your agent whether your policy's loss assessment or master deductible coverage would pay it.` (coverage-check: `Your declaration and rules decide whether owners can be charged.`)

### 14. Owner payment page makes unverifiable claims about banks
- File: `src/app/owner/pay/page.tsx:28`
- Current text: `Set this up once in your bank's bill pay, and it runs on its own. No fee for anyone.`
- Why wrong: banks and Zelle limits vary; Walkup cannot know there is no fee, nor that a recurring payment "runs on its own". The board might also have told owners to pay another way.
- Replace: `You can pay however the board has set up, for example through your bank's bill pay. Check with your bank about any fees.`

### 15. Security page and Privacy do not match how model-written text is used
- File: `src/app/security/page.tsx:213` (`No AI model writes any email`) against `:174` (`writing drafts and policy summaries your board edits before anything is sent`) and `src/lib/insurance/emails.ts:150` (model drafts of agent emails).
- Why wrong: both statements sit on one page. The first is true only of emails Walkup itself sends.
- Replace: `No AI model writes any email that Walkup itself sends.`

### 16. "Third parties are SOC 2 audited" and "not used to train" are unverified claims about other companies
- Files: `src/app/security/page.tsx:156-160` (`Supabase and Vercel are SOC 2 Type II audited, and Plaid maintains its own SOC 2 program`), `src/app/privacy/page.tsx:150` and `src/app/security/page.tsx:187` (`Under Anthropic's commercial terms, what Walkup sends is not used to train its models.`).
- Why wrong: the house rule bars wording that names unverified third-party facts. I did not verify these from the providers' own pages in this review; nothing in the repo cites them.
- Fix: link to each provider's trust page, or reword: `Each provider publishes its own security documentation: [links].` and `Anthropic's terms for its business API describe how it handles what Walkup sends; read them at [link].` Keep only claims with a link and a checked date.

### 17. Founder wording and "Vendors" heading on legal pages use the banned word
- Files: `src/app/privacy/page.tsx:67` (`budgets, vendor information, and tax filing figures`), `src/app/security/page.tsx` section title `Vendors`, and the same page's `Walkup's infrastructure vendors`.
- Rule: "contractor", never "vendor", in UI copy.
- Replace: `budgets, contractor information, and tax filing figures`; section title `Service providers`.

### 18. Landing price comparison cites other companies' prices
- File: `src/components/landing/landing.tsx:569` (`Based on published vendor pricing and management fees, September 2026.`) with the `COMPARE` rows in `landing.tsx`/`site-config.ts` (`typical` column).
- Why wrong: names third-party facts with no source and uses "vendor". Either source each row or soften.
- Replace: `Typical ranges for small associations; your quotes will vary.` and add the source behind each row on the page, or delete the "Typical cost" column for any row without one.

### 19. FAQ headline and answer use "best" and read as a recommendation
- File: `src/lib/site-config.ts:89`
- Current text: `What is the best software for a small self-managed condo association?`
- Why wrong: the brief bans "best" in product copy; as an FAQPage question it is also structured data that search engines quote.
- Replace: `What should a small self-managed condo association look for in software?` (answer unchanged).

### 20. Sewer rodding upkeep template makes a cost claim; backflow template asserts what "the city" asks
- File: `src/lib/upkeep/schedule.ts:159-160`
- Current text: `Annual test by a licensed plumber; the city asks for the certificate.` / `Preventive rodding of the main line. Cheaper than a backup.`
- Replace: `Annual test by a licensed plumber. Many cities ask for the certificate; check yours.` / `Preventive rodding of the main line, so a clog does not become a backup.`

### 21. "An uninsured contractor ... becomes the association's problem" is a legal conclusion
- File: `src/lib/home/urgent-items.ts:172`
- Replace: `If an uninsured contractor is hurt on the property, the association may be exposed. Ask for a current certificate.`

---

## MINOR

### 22. Em dashes in user-facing copy
New in this work:
- `src/app/login/actions.ts:208` `... not yours — try again in a few minutes ...` → `... not yours. Try again in a few minutes, and if it keeps happening email ${SUPPORT_EMAIL} ${ref}.`

Present in files this work touched (not introduced by it, but the rule says everywhere): `src/app/privacy/page.tsx` (`&mdash;` at 74, 202, 203, 214, 215, 235), `src/app/security/page.tsx` (`&mdash;` 12 places: lines 54, 65, 77, 88, 104, 105, 113, 114, 154, 188, 212, 213), `src/app/policies/access-controls/page.tsx` (7), `src/app/dues/needs-you.tsx:171,238,343,356,365` (including the email subject `${label} — dues balance of ...` and the mailto title), `src/lib/home/setup-guide.ts` (10, for example lines 240, 253, 264, 319, 345, 365, 381, 439, 444, 539), `src/app/login/page.tsx` (7, 27, 33, 40), `src/app/signup/page.tsx:7,14`, `src/components/auth/auth-shell.tsx:28,88`, `src/components/home/greeting.tsx:40`, `src/app/documents/page.tsx:127,228,235`, `src/app/building/generate-invite-form.tsx:7-10`, `src/app/building/actions.ts:527`, `src/app/budget/page.tsx:644`, and 18 in `src/lib/tax/accountant-email.ts` (these go into the emails to the accountant: subjects `2158 N. Damen — Form 1120-H 2026: figures ...`). Replace each with a period, comma or colon. The new email templates (`src/lib/email-outbox/templates/*`), the repairs and insurance copy, and the owner portal have none. Page `<title>`s with `— Walkup` should use `| Walkup` like Terms does.

### 23. Public pages' "Last updated" and dates
`src/app/terms/page.tsx:22`, `src/app/privacy/page.tsx`, `src/app/security/page.tsx:48` all now say 2026-10-14; keep them in step with each later change (Terms section 3 and Privacy changed within the hour).

### 24. Gas banner fires for a water smell
`src/lib/repairs/emergency.ts:62` pattern `\brotten eggs?\b`. Add an `exclude` of `/dishwasher|hot water|tap water|shower|drain|sink|garbage|fridge/i` tested on the surrounding text, or require `gas|furnace|stove|meter|basement|hall` within 30 characters. Accept leaving it if Doug prefers over-warning; the banner wording is calm enough.

### 25. Fire rule also fires on old events
`emergency.ts:79` `\bfire\b` matches `There was a fire last year in unit 2` and shows "If there's fire or smoke, get out and call 911". The reporter can answer "No" to "Is this happening right now?", so this is low impact; consider adding `last (week|month|year)|years? ago|previous` to the fire rule's `exclude`.

### 26. Emergency banner footnote is 11px at 80% opacity on a tinted red background
`src/components/repairs/emergency-banner.tsx:138` `className="mt-3 text-[11px] opacity-80"`. Likely under 4.5:1. Use `text-[12px]` and no opacity.

### 27. Safety banner announced politely
`src/app/repairs/report/report-form.tsx:144` wraps the emergency banner in `aria-live="polite"`. A newly appearing emergency instruction should be `role="alert"`. Keep the container always in the DOM, change the inner banner wrapper for `live` to `role="alert"` when `happeningNow` first becomes true.

### 28. Visit feedback says "Send to the board" but is readable by everyone on the problem
`src/app/maintenance/[ticketId]/owner-actions.tsx:141` button `Send to the board`, success text `Sent to the board. Thank you.`, with the hint `Anyone who can see this problem can read this.` For a shared-area problem that is every owner. Replace button `Post this note`, success `Posted. The board and anyone who can see this problem can read it.`

### 29. Report form hint addresses the wrong reader
`src/app/repairs/report/report-form.tsx:204` `Some problems inside a unit are the owner's to fix under your declaration. The board will let you know.` also shows to a board member filing a report. Show only when `!props.isBoard`. Also "under your declaration" is Walkup asserting the declaration's content; use `depending on your declaration`.

### 30. Canned note presumes the declaration
`src/app/maintenance/[ticketId]/next-step-card.tsx:31` `Under the declaration, repairs inside a unit like this are the owner's responsibility.` The board can edit it, but the default states a fact Walkup does not hold. Replace: `Our reading of the declaration is that repairs inside a unit like this are the owner's responsibility. If it is affecting a shared pipe or another unit, reply here.`

### 31. Plain-English slip: delivery state shows the provider's name
`src/lib/email-outbox/reasons.ts:17` `outcome unknown, check Resend`. Volunteer treasurers have no Resend account. Replace: `Walkup could not confirm this was delivered. Email ${SUPPORT_EMAIL} if it matters.` Similarly `src/lib/home/urgent-items.ts:313` `The email service rejected Walkup's key.` is not board-actionable; use `Walkup's email service needs attention. Reminders are paused. Email ${SUPPORT_EMAIL}.`

### 32. Accountant and non-board readers shown actions they cannot take
- `src/app/insurance/tabs/check.tsx:103` `Walkup has no ... policy on file. If you have it, add it.` and `src/app/insurance/tabs/overview.tsx:493` `No agent recorded. Add one from a policy, or in Marketplace.` are shown to the accountant (who cannot add). Append `A board member can add them.` for `!ctx.isBoard`.
- `src/app/insurance/tabs/market.tsx:111` `Only board members can search for insurers or write to agents.` reads fine for owners-type readers and the accountant; keep.

### 33. "Best order" in Import
`src/app/building/import/page.tsx:82` `Best order: units and owners, contractors, opening balances, then transactions.` → `Suggested order: ...`

### 34. Unsupported general claims in helper text
- `src/app/delinquency/page.tsx:170` `The longer a balance sits in the right-hand columns, the harder it usually is to recover.` → `Older balances are in the right-hand columns.`
- `src/app/repairs/bills-view.tsx:178` hint `Worth being clear about, because most bill software works differently.` → delete the hint (names an unverified fact about other products).
- `src/lib/home/urgent-items.ts:158` `Skipped upkeep tends to become a repair.` → `Overdue upkeep is easier to fix before it becomes a repair.`

### 35. Strong reassurances in sign-in copy
`src/app/account/mfa/page.tsx:60` `One extra step keeps the books safe.` and `src/app/login/mfa-challenge/page.tsx:33` `Two-step sign-in keeps your association's records safe, even if a password gets out.`; landing `Is Walkup safe for our association's money? / Yes.` (`landing.tsx:407-410`). "Safe" is a promise. Replace with `Two-step sign-in protects the books if a password is stolen.` and, on the landing, `How does Walkup protect our association's money?` followed by the existing bullets, dropping the one-word "Yes."

### 36. Statute display needs a note on 2027 amendments
`src/lib/insurance/statute.ts` and `finding-card.tsx` show `Checked against the Act on 2026-10-14`. The Act text fetched on that date lists amendments effective 2027-01-01 (P.A. 104-734, 104-797, 104-598, 104-580) to Sections 18, 18.4, 18.12 and 22.1. The two cited provisions in those sections (18.4(f), 22.1(a)(7)) read the same in the new versions, and Section 12 has no pending change, but add a `NEXT_REVERIFY = "2027-01-02"` constant, show it in the dev tests, and remind in `docs/DECISIONS.md` #35 (d).

### 37. Coverage-check approximations worth a word
- `coverage-check.ts` rule `IL-FID-01` counts `unitCount` for the "6 or more dwelling units" test; commercial units are not dwelling units. The finding text says "You have ${n} units". Use `You have ${n} units on record` and let the board correct; or the facts form's commercial-space answer can subtract.
- `IL-PROP-04` computes 10% of the master policy's `building_limit`; the Act says "of each insured building value". For multi-building associations the number is approximate. Add `(about)` before the figure in the detail line.
- `CICAA-FID-01` runs for non-condominium associations with 30 or more units and says `Small associations can be exempt.`; that is accurate (Sec. 1-75: 10 units or fewer, or budgeted assessments of $100,000 or less, unless they opt in), so name the section: `Sec. 1-75 exempts smaller associations.`

(Items 22 and 37 group several sub-items.)

---

## CHECKED AND FINE

Legal citations (verified against the ilga.gov page `Articles?ActID=2200&ChapterID=62`, fetched 2026-10-14, 622,972 bytes, and a second look at ActID=3273 for the CICAA quotes):
- All 22 Condominium Property Act quotes in `statute.ts` (`ICPA_12_A` through `ICPA_22_1_A7`) match the official text character for character, and each section/subsection label is correct: 12(a), 12(a)(1)(i) to (iii), the Coverage B and C sentence under 12(a)(1), 12(a)(2) (two quotes), 12(a)(3)(A) to (D) (three quotes under D), 12(b) (two), 12(c), 12(d), 12(e)(2), 12(h), 12(i), 18.4(f), 22.1(a)(7). (The substring for `ICPA_22_1_A7` also occurs in 18.5(g)(7); the 22.1 occurrence is the cited one, in both the current and the 2027 text.)
- CICAA 1-5 (`real estate other than a condominium or cooperative`) and 1-55 (`An association with 30 or more units shall obtain and maintain fidelity insurance`) match; `Sec. 1-75` supports "Small associations can be exempt".
- Rule wording versus statute: IL-PROP-01/02/03/04, IL-GL-01/02, IL-FID-01/02/03, IL-DO-01/02/03, IL-FORM-01, IL-SUB-01 describe the text accurately and hedge ("Your records don't show", questions for the agent). The $500,000-or-10% arithmetic matches 12(a)(1). "Required by Illinois law" is only used for statute-basis findings and always has the "Why Walkup says this" quote and link.
- `LOOKUPS`: the Illinois DOI agent lookup URL returns 200 and loads. The NAIC consumer search returned 403 to a script (bot protection), so it was not independently confirmed; it is only a link.
- No statute text is stated as law without a citation: common-practice rules are labelled "Commonly carried".

Product claims that are true today: read-only bank access (Plaid copy on landing, auth shell, setup guide, bills view); "Walkup never holds or moves money" (Terms, landing, email footer, statement PDF footer, owner pay page "This does not move money"); owner pay page shows details the board entered and never emails them; emails never contain account numbers (`accessBlock` in `templates/layout.ts`); every email has an unsubscribe link, a stated sender, and the board's reply-to; the Terms and Security sections on #36 match the spec and the settings page; Privacy now lists Resend for approved emails, announcements, spreadsheet imports and column mapping, the 24-month email log and block list, and the retention page has the matching row; Home reminders honour approved-send status; DECISIONS #36 is now appended.

Insurance and repairs standards (brief section 1):
- Found, not recommended: Marketplace, contact pages, Find a contractor and the saved-from-web pages say `Found on the web`, `Found nearby`, `Listing isn't an endorsement`, `Walkup didn't check this business and doesn't endorse it` (`FoundOnWeb`, shown under every list and card), with sources and dates.
- No invented prices: `Walkup never shows prices it wasn't given` (Marketplace), quote comparison words are relative to the board's own policy (`higher than now`), no web item shows a rating unless the source states it, and `Contact details: see their website` is the fallback.
- Disclaimer text (`DISCLAIMER`) is short and sits on Coverage check, Marketplace, Compare and Request quotes.
- Model-written content is labelled where decided: policy summary (`AiWritten summary`), reading (`AiWritten reading`), insurance email drafts (`AiWritten draft`), triage (`Suggested by AI from the report text. Check it.`). Emails sent by Walkup are templates, never model-written. Every draft is editable and marked sent by a person.
- Insurance email templates (`templateDraft`) contain no prices, no advice and no commitments; the model guard (`checkModelDraft`) rejects digits, dollar signs, em dashes, "bind", "purchase", "recommend".
- Owner and accountant role handling: owners get `OwnerView` on Insurance, the owner summary only (no contacts, quotes, findings or costs); the contractor page shows owners a `BoardOnly` screen, not an empty page; Repairs opens on Problems for owners; the owner ticket view shows the contractor's name and visit date only (no ratings, internal notes, costs or other owners' names; notes show roles, `Another owner`); Collections shows `Preparing email is for the board` and `See your own balance`; the accountant gets a read-only ticket page with no triage card, internal notes or write actions; non-admin board members see `Ask a board admin to approve this batch`; the dues email settings page is board-only with an owner-facing "Choose which emails you get".
- Emergency content: guidance is static, headline copy is calm, "Call 911 from outside" is a tel link, building facts only show what the board entered, and the report confirmation says honestly `Walkup doesn't alert anyone, so the board sees it the next time they open Walkup.`
- Emails (`src/lib/email-outbox/templates`): no exclamation marks, no em dashes, no advice, plain wording (`the board's books show`), money from stored text values, statement says `It is not a tax document`, late fee notice avoids saying why the fee was allowed.
- House rules: no `TODO` or lorem text is rendered (the `TODO(doug)` address blocks sending and is replaced by `Walkup's mailing address` in the preview); no exclamation marks in copy anywhere in the scanned set; `vendor` appears only in identifiers and the items above; form labels and button names are present in the bills, contractors, report, unsubscribe and email settings forms; dialogs and tabs use `aria-current`, `role="status"` or `role="alert"`; touch targets use `min-h-[44px]`.
- Home reminders and urgent items read in plain English and do not give insurance advice (apart from items 10 and 21).

## Not covered

- I did not render every page in a browser; the emergency rules, statute quotes and email templates were checked by running code and fetching ilga.gov, the rest by reading source. Heading order and focus handling were sampled, not exhaustively audited.
- Third-party claims (SOC 2, Anthropic training terms) were not verified against the providers' sites; see major 16.
