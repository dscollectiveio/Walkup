# Build spec — Tax Center v2 (links, day-one autofill, accountant handoff, deadline reminders)

Written 2026-10-11 from a reader/designer/judge pass over the codebase and the official
IRS / Illinois sources. This is the contract every build slice follows. Where this file and
docs/DECISIONS.md disagree, DECISIONS wins — #33 (added by slice C5) records the amendments
this build makes to #32.

## 0. Goals (Doug, verbatim intent)

1. Show the most recent **official links** to the forms the building needs, based on its state
   and qualities (incorporated? contractors over the threshold? 1120-H tests).
2. **Auto-populate** those forms and let the board **download** the filled version.
3. **Draft an email** to the association's tax accountant.
4. **Remind** board members when tax forms and related things are due.

## 1. Guardrails that bind every slice

- No tax advice, no filing, no fabricated figures or rules. Every link, date, threshold and
  filled figure carries its source and whether a **person** has checked it. Where a rule can't be
  sourced, the answer is "ask your CPA" — never a guess. "Estimated" dates say so in words.
- Official PDFs only (irs.gov / tax.illinois.gov / ilsos.gov), fetched into the private
  `tax-templates` bucket by a signed-in platform admin, **verified and activated by a person**
  before anything fills from them. Nothing in this build sets `active` or `verified_at` from code.
- Walkup has **no email-sending service**: every email is a `mailto:` draft the person opens; a
  draft cannot carry attachments, so the UI orders the downloads first and the body names the files.
- No new cron, no service-role use (DECISIONS #28). Reminders are in-app + an `.ics` download +
  mailto drafts.
- Recipient TINs are never stored or filled (DECISIONS #4). The 1099-NEC map has no TIN field.
- Personal data lives in `persons` (DECISIONS #30). The accountant is a `persons` row.
- RLS is the only authorization; new SECURITY DEFINER functions pin `search_path = ''`, revoke
  from public/anon, grant to authenticated (pattern: 0043). Platform-admin writes also require
  `session_is_aal2()`.
- Money in integer cents in TS; DB numerics 14,2 / 9,6 / 6,4 / 14,6 only (tests/db/migrations.test.ts).
- Do **not** `git commit` or push. Doug releases with "General Kenobi". Running `npx tsc --noEmit`,
  `npm run lint` and `npx vitest run <files>` is expected while building.
- House style: plain words, an `Answer` headline first, one obvious next action, `TAX_FOOTER` last.
  Copy says "ask your CPA", "not yet checked", "estimated". Never "verified by Walkup" for a tax rule.

## 2. Facts established on 2026-10-11 (official sources; still "not yet checked by a person" in-app)

- Form 1120-H: current revision **2025** (no 2026 yet). PDF `https://www.irs.gov/pub/irs-pdf/f1120h.pdf`
  is byte-identical to `https://www.irs.gov/pub/irs-prior/f1120h--2025.pdf`;
  sha256 `dffaa4d3079cc0ba14e7f50c823bf19ff9595c54c274d03ffe859c60382eab6f`; XMP title `2025 Form 1120-H`;
  1 page; 70 AcroForm fields under pdf-lib (XFA stripped). Due: 15th day of the 4th month after the
  tax year ends; June-30 year ends: 3rd month; weekend/holiday → next business day; extension Form 7004;
  e-file mandatory for filers of 10+ returns of any type in the calendar year.
- Form 1099-NEC: current PDF `https://www.irs.gov/pub/irs-pdf/f1099nec.pdf` is **Rev. December 2026**
  (for CY2026 payments, filed from Jan 2027); sha256 `68a8f00078be6dd6a4912cc4209df317b31840d5fe19560222d39df9f2f7ff49`;
  title `Form 1099-NEC (Rev. December 2026)`; 6 pages: 1 Attention, 2 Copy A, 3 Copy 1, 4 Copy B,
  5 Instructions for Recipient, 6 Copy 2; 140 fields. Self-printed **Copy A must not be filed**
  (not scannable; penalty) — same for Form 1096. Threshold: **$600 for payments made in 2025**,
  **$2,000 for payments made after 2025-12-31** (P.L. 119-21 §70433; Rev. Dec 2026 instructions
  "What's New"), inflation-indexed from 2027 (amount unpublished; final regs not confirmed). Due Jan 31
  (IRC 6071(c)). IRIS: no Form 1096 needed; needs a Transmitter Control Code (weeks).
- Form W-9: Rev. March 2024. Form 1096: 2026 revision, paper filing only.
- Illinois: DOR says an 1120-H filer **must file IL-1120** (Step 2 Line 1 = 1120-H line 19); due same
  as federal; automatic 7-month filing extension (payment still due). SOS NFP annual report: filed on
  `https://apps.ilsos.gov/nfpannualreports/` (needs the corporation file number), fee $10 ($25
  expedited), **delivered within the 60 days before the first day of the anniversary month**
  (805 ILCS 105/114.10); $3 penalty; administrative dissolution ground. Condo Act / CICAA impose no
  other state registration. ilsos.gov blocks non-browser clients (link checks must record "blocked").
- Live DB state: dev and production both have **0 templates**, 1 platform admin each, all five
  `tax_parameters` unverified, 1099 threshold still 600. Production has an IL building and a **NH**
  building, so non-Illinois buildings must get an honest "state filings not on file" answer.

## 3. Product decisions (settled; record in DECISIONS #33)

1. **Links registry**: new global table `tax_form_links`, seeded with the URLs above, each row
   `verified_at = null` and `retrieved_on = '2026-10-11'` — the exact precedent of `tax_parameters`
   in 0005. Boards see links on day one labeled "retrieved 2026-10-11 · not yet checked by a person";
   a platform admin clicks "I opened this and it's current" to set `verified_at`. Board-facing
   "latest" links are the IRS "About Form …" landing pages (always current); pinned PDFs are for the
   fill template only. A verified active template's `source_url`/`instructions_url` outranks the
   registry for that form+year.
2. **Day-one autofill**: a code-side **suggested registry** (`src/lib/tax/suggested/`) with a cited
   field map authored against the real 2025 1120-H and Dec-2026 1099-NEC (names verified from the
   labeled render on 2026-10-11 — see §7). An admin one-click `applySuggestedTemplate()` fetches the
   pinned PDF through the existing `fetchOfficialPdf` → `storeTemplate` path, **refuses** to apply the
   map unless the PDF's sha256 equals `authoredAgainstSha256` and its title equals `expectedTitle`
   (otherwise stores the template inactive with a note and no map), validates the map exactly as
   `saveFieldMap` does, and lands on the detail page. Doug then opens the labeled preview and clicks
   Verify and activate. `tax_form_templates` still ships with zero rows.
3. **Link-only templates** (`kind = 'link_only'`, no PDF) carry a cited due rule, filing instructions
   and notes for forms Walkup never fills (Illinois SOS annual report, IL-1120, Form 1096). Same
   verify/activate gate.
4. **No-template fallback** is never a dead end: the worksheet always carries the figures from the
   records (figures pack), the official form link is one click away, "Send to your accountant" works,
   and a form with nothing to confirm in Walkup can be **marked filed by hand**.
5. **1120-H is an election, not "Required"**: when both tests pass the determination is the new
   value `eligible` ("You qualify — elect it by filing. Ask your CPA whether 1120-H or Form 1120 is
   better this year."). `likely_required` stays for Form 1120 when a test fails.
6. **Form 1096** is driven by a stored answer to "How do you file 1099s with the IRS?"
   (`associations.information_returns_filing`: `paper` → required, `electronic` → not_required,
   null → ask_cpa). Never "optional".
7. **1099-NEC exports are recipient copies only** (pages 4, 5, 6: Copy B, recipient instructions,
   Copy 2); Copy A and Form 1096 are never produced; the cover sheet says to file through IRIS or on
   official forms; the contractor's TIN prints blank by design.
8. **Threshold as of the period**: `tax_parameters` gets a `$2,000` `form_1099_nec_threshold` row
   effective 2026-01-01 (unverified, cited) and the `$600` row ends there; readers resolve the 1099
   threshold **as of Dec 31 of the payment year** and the 1120-H parameters **as of the fiscal year
   end**, with the half-open boundary `effective_to > date`. `compute_and_save_tax_filing()` is
   replaced to use the fiscal year end too.
9. **Accountant contact** = `associations.accountant_person_id` → `persons` (+ `accountant_firm`),
   set through an `is_board` RPC; `redact_person()` refuses while the person is the accountant.
   Independent of the expiring `accountant` role grant ("Give them read access" stays a separate link).
10. **Reminders** come from one pure module `lib/tax/deadlines.ts` (verified template rule, else a
    built-in estimate labeled estimated, else none) feeding the Taxes tab, Home's "Coming up", the
    Next-filing tile, urgent items, and a `.ics` download with alarms. Estimates: 1120-H and IL-1120 =
    15th of the 4th month after the fiscal year end (**none** for June-30 years: "ask your CPA");
    1099-NEC and 1096 = Jan 31 after the payment year; Illinois annual report = **last day of the
    month before the anniversary month** (earlier than today's anniversary-date estimate; safer). The
    due-rule grammar gains `INCORPORATION_ANNIVERSARY_MONTH - 1 MONTHS, DAY LAST`.
11. **Filing year**: the tab, the deadlines and autofill describe the fiscal year whose return is next
    to file — `filingYearFor()`: the newest fiscal year that has **ended**, ended within the last 12
    months, and whose 1120-H is not filed/locked; otherwise the year containing today; a `?fy=` param
    overrides. Autofill always loads the context for the **form's own** fiscal year / tax year.
12. One "filed" concept: `markFormFiled` on the form page (creates the 1120-H `tax_filings` snapshot
    if missing, then locks it). The tab's FilingStatus keeps "Save this year's figures" only.
13. The editable PDF for a CPA gets a one-page "Draft from Walkup — figures not yet confirmed by the
    board" cover while the form is `draft`/`in_review`; the worksheet already marks confirmation.
14. `is_platform_admin()` now also requires `session_is_aal2()`.

## 4. Migration `supabase/migrations/0048_tax_center_v2.sql` (slice A1)

Header comment in the house style (why, what, how to apply). Apply to dev/staging only; production
waits for "General Kenobi".

A. `public.tax_form_links` (global; add `'tax_form_links'` to the scoping-lint exceptions in
   tests/db/migrations.test.ts; not audited):
   ```
   id uuid pk default gen_random_uuid()
   form_code text not null check (form_code in ('irs_1120h','irs_1120','il_1120','irs_1099_nec','irs_1096','il_sos_annual_report','irs_w9'))
   kind text not null check (kind in ('about','form','instructions','file_online','order_paper','guidance','law'))
   label text not null check (btrim(label) <> '')
   url text not null check (url ~ '^https://([a-z0-9-]+\.)*(irs\.gov|illinois\.gov|ilsos\.gov|ilga\.gov)/')
   state_code text check (state_code is null or state_code ~ '^[A-Z]{2}$')
   retrieved_on date not null
   retrieved_note text
   verified_at timestamptz, verified_by uuid references auth.users(id)
   last_checked_at timestamptz, last_check_status text   -- '200' | 'blocked' | 'error: …'
   active boolean not null default true
   sort_order smallint not null default 100
   created_at timestamptz not null default now()
   unique (form_code, kind, url)
   ```
   RLS: select to authenticated using (true); insert with check `is_platform_admin()`; update
   using/with check `is_platform_admin()`; delete using `is_platform_admin()`.
   Seed (every row `retrieved_on '2026-10-11'`, `retrieved_note 'Retrieved by Walkup research on 2026-10-11 (HTTP 200 by GET; ilsos.gov opened in a browser). Not yet checked by a person.'`, `verified_at null`):
   | form_code | kind | label | url | state |
   |---|---|---|---|---|
   | irs_1120h | about | About Form 1120-H | https://www.irs.gov/forms-pubs/about-form-1120-h | |
   | irs_1120h | instructions | Instructions for Form 1120-H | https://www.irs.gov/instructions/i1120h | |
   | irs_1120h | form | Form 1120-H (PDF, current revision) | https://www.irs.gov/pub/irs-pdf/f1120h.pdf | |
   | irs_1120 | about | About Form 1120 | https://www.irs.gov/forms-pubs/about-form-1120 | |
   | irs_1099_nec | about | About Form 1099-NEC | https://www.irs.gov/forms-pubs/about-form-1099-nec | |
   | irs_1099_nec | instructions | Instructions for Forms 1099-MISC and 1099-NEC | https://www.irs.gov/instructions/i1099mec | |
   | irs_1099_nec | guidance | General Instructions for Certain Information Returns | https://www.irs.gov/instructions/i1099gi | |
   | irs_1099_nec | file_online | File 1099s online with IRIS (free) | https://www.irs.gov/filing/e-file-information-returns-with-iris | |
   | irs_1099_nec | order_paper | Order official paper forms from the IRS | https://www.irs.gov/businesses/order-paper-information-returns-and-employer-returns | |
   | irs_1096 | about | About Form 1096 | https://www.irs.gov/forms-pubs/about-form-1096 | |
   | irs_w9 | about | About Form W-9 | https://www.irs.gov/forms-pubs/about-form-w-9 | |
   | irs_w9 | form | Form W-9 (PDF) | https://www.irs.gov/pub/irs-pdf/fw9.pdf | |
   | il_1120 | about | Illinois corporate income tax forms (IL-1120) | https://tax.illinois.gov/forms/incometax/currentyear/business-corporate.html | IL |
   | il_1120 | guidance | Illinois DOR: which return a homeowners association files | https://tax.illinois.gov/questionsandanswers/answer.458.html | IL |
   | il_1120 | instructions | Illinois corporate income tax — due dates and extensions | https://tax.illinois.gov/research/taxinformation/income/corporate.html | IL |
   | il_sos_annual_report | file_online | File the annual report online (ILSOS) | https://apps.ilsos.gov/nfpannualreports/ | IL |
   | il_sos_annual_report | instructions | How to file an NFP annual report | https://www.ilsos.gov/departments/business-services/annual-reports/nfp-instructions.html | IL |
   | il_sos_annual_report | about | ILSOS annual reports | https://www.ilsos.gov/departments/business-services/annual-reports.html | IL |
   | il_sos_annual_report | law | General Not For Profit Corporation Act (805 ILCS 105) | https://www.ilga.gov/Legislation/ILCS/Articles?ActID=2280&ChapterID=65 | IL |
   `sort_order`: about 10, form 20, instructions 30, file_online 40, order_paper 50, guidance 60, law 70.

B. `tax_form_templates`: add `kind text not null default 'pdf' check (kind in ('pdf','link_only'))`;
   `storage_path`, `sha256` become nullable with
   `check ((kind = 'pdf') = (storage_path is not null and sha256 is not null))`;
   add `include_pages smallint[]` (1-based page numbers kept in PDF exports; null = all; each ≥ 1),
   `mirror_json jsonb not null default '[]'` (`[{ "from": "CopyB[0]", "to": "Copy2[0]" }]` — at export,
   every filled value whose name contains `from` is also written to the twin name with `to`),
   `revision_title text` (PDF title captured at fetch), `instructions_url text check (… same host
   regex as source_url …)`, `suggested_from text`. The form_code CHECK is unchanged (W-9 is never a template).

C. `tax_forms`: add `sent_to_accountant_at timestamptz`, `sent_to_accountant_by uuid references auth.users(id)`,
   `sent_snapshot_json jsonb` (subject, body, attachment filenames, figures at send time);
   `check (sent_to_accountant_by is null or sent_to_accountant_at is not null)`.
   Re-create the `determination` CHECK adding `'eligible'`.

D. `associations`: add `accountant_person_id uuid references public.persons(id) on delete set null`,
   `accountant_firm text`, `il_sos_file_number text`,
   `information_returns_filing text check (information_returns_filing is null or information_returns_filing in ('paper','electronic'))`.
   Trigger function `tg_association_accountant_same_association()` (SECURITY DEFINER, pinned, revoked
   from public/anon) BEFORE INSERT OR UPDATE OF accountant_person_id: raise 42501 unless the person's
   `association_id = new.id`.
   RPC `set_accountant(p_association_id uuid, p_person_id uuid, p_firm text) returns void` SECURITY
   DEFINER: 42501 unless `public.is_board(p_association_id)`; sets both columns (null person clears both).
   RPC `set_tax_filing_settings(p_association_id uuid, p_information_returns_filing text, p_il_sos_file_number text) returns void`
   SECURITY DEFINER: 42501 unless is_board; validates the method value; trims the file number (null when empty).

E. `redact_person(p_person_id)`: CREATE OR REPLACE with the **full** 0037 body plus one refusal after
   the unit-owner check: `if exists (select 1 from public.associations a where a.accountant_person_id = p.id) then raise exception 'this person is recorded as your tax accountant — choose another accountant first'; end if;`

F. `tax_parameters`: `update … set effective_to = '2026-01-01' where key = 'form_1099_nec_threshold' and effective_to is null;`
   then insert `form_1099_nec_threshold`, `2000.00`, `effective_from '2026-01-01'`, `effective_to null`,
   `source_url 'https://www.irs.gov/instructions/i1099mec'`, `verified_on null`, notes:
   `'Per contractor per calendar year, for services, for payments made after 2025-12-31 (P.L. 119-21 §70433 as described in Federal Register REG-113229-25; Instructions for Forms 1099-MISC and 1099-NEC, Rev. December 2026, What''s New). Indexed for inflation from calendar year 2027 — add a new row when the IRS publishes the amount. Retrieved 2026-10-11; not CPA-checked.'`
   RPC `verify_tax_parameter(p_id uuid) returns void` SECURITY DEFINER: 42501 unless
   `public.is_platform_admin()`; sets `verified_on = current_date`. (Select-only policies unchanged.)

G. `is_platform_admin()`: CREATE OR REPLACE to `select public.session_is_aal2() and exists (…)`.

H. `compute_and_save_tax_filing(p_association_id, p_fiscal_year_id)`: CREATE OR REPLACE with the
   same signature/behaviour as 0022 except the four parameter lookups use the fiscal year's `ends_on`
   (`effective_from <= v_as_of and (effective_to is null or effective_to > v_as_of)`) and
   `parameters_snapshot` gains `"as_of"`. Read 0022 lines 244–423 and 0024 before rewriting; keep every
   provenance row.

I. Add `'tax_forms'` to `LINKABLE_TABLES` in src/app/documents/link-actions.ts (the DB CHECK already allows it).

## 5. Pure modules (contracts)

### 5.1 `src/lib/tax/deadlines.ts` (slice A2)
```ts
export type DeadlineBasis = "verified" | "estimated" | "none";
export type DeadlineStatus = "not_started" | "started" | "with_accountant" | "ready_to_sign" | "filed";
export interface DeadlineTemplate { formCode: string; taxYear: number; dueRule: string | null; dueRuleCitation: string | null; notes: string | null; verified: boolean; active: boolean }
export interface DeadlineForm { formCode: string; taxYear: number; vendorId: string | null; status: string; filedOn: string | null; sentToAccountantAt: string | null; id: string }
export interface DeadlineInput {
  today: string;                                   // ISO date (local), computed once by the caller
  association: { stateCode: string; fiscalYearEndMonth: number | null; incorporatedOn: string | null; informationReturnsFiling: "paper" | "electronic" | null };
  fiscalYear: { id: string; label: string; startsOn: string; endsOn: string; taxYear: number }; // the filing year (see filingYearFor)
  contractorYear: number;
  templates: DeadlineTemplate[];
  forms: DeadlineForm[];
  locked1120hFiscalYearIds: string[];
  outcomes: { formCode: string; taxYear: number; vendorId?: string; determination: string; name?: string }[]; // from determineForms; drives which forms appear (not_required ones never do)
  accountantSet: boolean;
}
export interface Deadline {
  key: string;                 // `${formCode}:${taxYear}` or `${formCode}:${taxYear}:${vendorId}`
  formCode: FormCode; taxYear: number; vendorId?: string;
  name: string;                // "Form 1120-H" / "1099-NEC — Acme Plumbing" / "Illinois annual report"
  kind: string;                // "Federal tax return" / "Federal filing" / "Illinois return" / "Secretary of State"
  dueOn: string | null; basis: DeadlineBasis; citation: string | null; note: string | null;
  status: DeadlineStatus; formId: string | null; overdue: boolean; daysLeft: number | null;
  href: string;                // /tax#forms or /tax/forms/{id}
  milestones: { key: "send" | "start"; label: string; on: string }[];
}
export function taxDeadlines(input: DeadlineInput): Deadline[];
export function nextDeadline(deadlines: Deadline[]): Deadline | null;  // soonest undone with a date
export function filingYearFor(fiscalYears: {id,label,starts_on,ends_on}[], forms: DeadlineForm[], locked1120hFiscalYearIds: string[], todayIso: string): FiscalYear;
export function filingYearForFiscal(...)   // not needed — one function above
```
Rules: a verified active template for (formCode, taxYear) with a parsable `due_rule` wins
(`dueDate()` from due-rules.ts; for `irs_1099_nec`/`irs_1096` match `taxYear === contractorYear`;
for `il_sos_annual_report` any year, newest verified). Otherwise the built-in estimate in §3.10
(`basis: "estimated"`, `note: "Estimated — not yet checked against this year's instructions."`), or
`basis: "none"` with the June-30 note. A deadline whose form is `filed`, or whose 1120-H fiscal year
is locked, is **dropped**. `overdue` = dueOn < today and not filed; overdue deadlines stay for 120 days
after the date, then roll to the next instance. Milestones: `send` at due − 60 days while
`accountantSet && !sentToAccountantAt && status !== 'filed'`; else `start` at due − 45 days while
`not_started`. Output sorted by dueOn ascending, `none` last. Dates are ISO strings throughout — no
`Date` objects, no UTC/local mixing. `filingYearFor`: newest fiscal year with `ends_on < today`,
`ends_on >= today − 365 days`, no filed `irs_1120h` form for it and not locked; else the year containing
today; else the newest.

### 5.2 `src/lib/tax/ics.ts` (slice A2)
`buildCalendar({ associationId, associationName, deadlines, generatedAt }: {…; generatedAt: string /*ISO datetime*/}): string`.
RFC 5545: `BEGIN:VCALENDAR`, `VERSION:2.0`, `PRODID:-//Walkup//Taxes//EN`, `CALSCALE:GREGORIAN`,
`METHOD:PUBLISH`, `X-WR-CALNAME:Walkup — {associationName} taxes`; one all-day `VEVENT` per deadline
with a date (`DTSTART;VALUE=DATE:YYYYMMDD`, `DTEND` next day), `UID:walkup-tax-{associationId}-{key}@walkup.app`
(stable), `DTSTAMP` and `SEQUENCE` = minutes since 2026-01-01 of `generatedAt` (so re-imports update),
`SUMMARY:Walkup: {name} due` (+ ` (estimated)` when basis ≠ verified), `STATUS:CONFIRMED|TENTATIVE`,
`DESCRIPTION` = kind, citation or the estimated note, and `https://…/tax` (caller passes the app URL;
default `/tax`), `VALARM`s `-P30D` and `-P7D` (`ACTION:DISPLAY`), plus `-P60D` for `irs_1120h`,
`irs_1120`, `il_1120`. One all-day event per milestone (`UID …-{key}-{milestone}`, `SUMMARY:Walkup: {label}`,
single `-P0D` alarm). CRLF line endings, 75-octet folding, TEXT escaping of `\ ; , \n`.

### 5.3 `src/lib/tax/accountant-email.ts` (slice A3)
```ts
export type EmailVariant = "1120h" | "1099" | "heads_up";
export interface AccountantEmailInput { variant; association: { legalName; displayName }; accountant: { firstName: string | null; email: string | null } | null; fiscalYear: { label; startsOn; endsOn }; taxYear: number; figures: { exemptIncomeCents; nonexemptIncomeCents; grossIncomeCents; exemptExpendituresCents; totalExpendituresCents; nonexemptByAccount: {name; cents}[] }; tests: { income: {ratio|null; threshold; passed; verified}; expenditure: {…} } | null; estimatedTaxCents: number | null; parametersVerified: boolean; due: { on: string | null; basis: DeadlineBasis; citation: string | null }; contractors: { name; totalCents; w9OnFile }[]; openItems: string[]; attachments: string[]; senderName: string; }
export function accountantEmail(input): { subject: string; body: string };
export function mailtoHref(to: string | null, subject: string, body: string): string;
```
Subject `1120h`: `{displayName} — Form 1120-H {taxYear}: figures for your review`; `1099`:
`{displayName} — 1099-NEC contractor list for {taxYear}`; `heads_up`: `{displayName} — what's coming this tax season`.
Body `1120h` (≤ 1,800 characters; figures via `formatMoney`; never a TIN/EIN/account number):
```
Hi {firstName|there},
Here are {legalName}'s figures for Form 1120-H, fiscal year {startsOn} to {endsOn}, worked out on a cash basis from our books in Walkup. Nobody has checked them against this year's IRS instructions yet — that's what we're asking you to do.
Owner fees (exempt function income): $X — Y% of gross income (needs 60%)
Spending on the building (exempt function expenditures): $A — B% of total spending (needs 90%)
Income that isn't owner fees: $N (Interest $…, Laundry $…)
Walkup's estimate of tax due before any deductions: $T (provisional; the 30% rate and $100 deduction are {checked|not yet checked against this year's instructions})
Due date on file: {Month D, YYYY} ({citation}) | {Month D, YYYY} (estimated — please confirm) | Not on file — can you confirm it?
Open items: {up to five, "- …"}
I'm attaching: {filenames, one per line}. (Our contractor payment totals include every payment we recorded; tell us if any were by card, which the processor reports instead.)
Nothing has been filed. The board will review your changes before signing.
Thanks,
{senderName}, {displayName}
```
`1099`: the contractor list (name, total, W-9 on file yes/no, up to eight then "and N more"), the
threshold sentence with its checked/not-checked status and payment year, and "Their TINs are on the
W-9s, which I'll send separately — Walkup stores only the last four digits. Copy A can't be printed
from the IRS PDF — should we file through IRIS or do you handle that?". `heads_up`: the deadlines
list with "(estimated)" marks, number of contractors over the threshold and W-9s outstanding, and
"we'll send the 1120-H figures by {due − 60 days}".

### 5.4 `src/lib/tax/links.ts` (slice A3)
```ts
export type LinkFormCode = FormCode | "irs_w9";
export interface LinkRow { id; form_code; kind; label; url; state_code: string | null; retrieved_on; verified_at: string | null; last_checked_at: string | null; last_check_status: string | null; active: boolean; sort_order: number }
export interface LinkView { id; kind; label; url; checked: "verified" | "unverified" | "stale" | "blocked"; checkedOn: string | null; retrievedOn: string }
export function linksFor(rows: LinkRow[], formCode: LinkFormCode, stateCode: string, todayIso: string): LinkView[];
export function linkStatusWords(v: LinkView): string;   // "checked Oct 11, 2026" | "retrieved Oct 11, 2026 · not yet checked by a person" | "last checked over a year ago" | "couldn't be checked automatically — opened by a person on …"
export function isOfficialLinkUrl(raw: string): boolean; // mirrors the DB regex
```
`stale` = verified more than 12 months before today. Filter `active` and `state_code null or === stateCode`.
A verified active `pdf` template's `source_url` (kind form) and `instructions_url` (kind instructions)
are merged in by the caller with `checked: "verified"` and outrank registry rows of the same kind.

### 5.5 `src/lib/tax/figures.ts` (slice A3) — the figures pack
`figuresPack(ctx: TaxContext, form: { formCode; taxYear; vendorId: string | null }): FiguresSection[]`
where `FiguresSection = { title: string; rows: { label: string; value: string; note?: string }[] }`.
Sections: "About the association" (legal name, EIN, address, incorporated on, fiscal year);
"1120-H figures (cash basis)" (the five figures with transaction counts); "Income that isn't owner
fees, by account"; "1120-H tests" (ratio, threshold, pass/fail, checked/not); "Estimated tax
(provisional)"; for 1099 forms: "Contractor" (name, address, total paid, payments, W-9 on file — no
TIN). Used by the worksheet export (always) and the no-template form page.

### 5.6 `src/lib/tax/autofill.ts` changes (slice A4)
- `MapEntry` gains optional `kind?: "money" | "text" | "date" | "checkbox"`, `review?: boolean`
  (confidence capped at `review`), `zeroOk?: boolean` (UI shows "Enter 0"), `hint?: string`.
- `SETTING_KEYS` adds `"association.incorporated_on_us"` (MM/DD/YYYY), `"fiscal_year.starts_on_mmdd_noncalendar"`,
  `"fiscal_year.ends_on_mmdd_noncalendar"`, `"fiscal_year.ends_on_yy_noncalendar"` (all null for a
  calendar fiscal year), `"form.tax_year"`.
- `AutofillInput` gains `entered: Record<string, { value: string | null; leaveBlank: boolean }>`.
  Calculated operands resolve: a mapped `ledger`/`setting`/`contractors`/`calculated` field as today;
  a `manual` field → `entered[name].value` (numeric), or **0 when `leaveBlank`** (a blank money line on
  a tax form means zero), or null (→ the calculation stays blank).
- A `calculated` result with a non-null value is returned with `confidence: "high"` (or `review` if an
  operand is review) and the caller auto-confirms it (derived figures need no click).
- `mergeWithExisting`: for `source === "calculated"` always take the fresh value; keep confirmation
  only if unchanged. Unchanged for other sources.
- `isReadyToSign` unchanged.

### 5.7 `src/lib/tax/due-rules.ts` (A4): grammar adds `INCORPORATION_ANNIVERSARY_MONTH [+|-] <n> MONTH[S], DAY <d|LAST>`;
next occurrence on/after today; January anniversary − 1 → December 31 of the prior year handled.

### 5.8 `src/lib/tax/determine.ts` (A4)
- `Determination` adds `"eligible"`. 1120-H both tests pass → `eligible` with the reason in §3.5.
- `FormOutcome` gains `note: string | null` (the verified template's notes) and `name: string`.
- Form 1096 per §3.6 (only when at least one 1099 is determined).
- `DetermineInput.association` gains `informationReturnsFiling`. `templateFor` for
  `il_sos_annual_report` ignores year (newest verified).
- `nextDeadline` moves to deadlines.ts (keep a thin re-export to avoid churn).
- Parameters arrive already resolved as-of (data.ts does the date filtering); determine.ts does
  not filter by date.

### 5.9 `src/lib/tax/pdf.ts` (A4)
`keepPages(bytes, pages1Based: number[]): Promise<Uint8Array>` (load, `removePage` from the end for
pages not listed — never `copyPages` into a new doc, which drops the AcroForm); `getTitle(bytes)`;
`draftCover({ formLabel, associationName, taxYear })` one page: "Draft from Walkup — figures not yet
confirmed by the board. Not the official filing."; `mirrorValues(values, mirror: {from,to}[])`.

### 5.10 `src/lib/tax/suggested/` (slice A5) — see §7 for the maps
```ts
export interface SuggestedTemplate {
  key: string;                       // "irs_1120h_2025"
  formCode: FormCode; taxYear: number; kind: "pdf" | "link_only";
  sourceUrl: string;                 // pdf: pinned official PDF; link_only: the official page the rule comes from
  instructionsUrl: string | null;
  expectedTitle: string | null;      // pdf only; must equal the PDF title
  authoredAgainstSha256: string | null;
  revision: string;                  // "2025" / "Rev. December 2026"
  fieldMap: FieldMap;                // {} for link_only
  includePages: number[] | null; mirror: { from: string; to: string }[];
  dueRule: string | null; dueRuleCitation: string | null;
  filingInstructions: string | null; filingCitation: string | null;
  notes: string | null;
  authoredOn: string;                // "2026-10-11"
}
export const SUGGESTED: SuggestedTemplate[];
```
Fixtures: `tests/fixtures/tax/f1120h-2025.pdf`, `f1099nec-2026.pdf` (already copied; public-domain US
government works) and `f1120h-2025-fields.json`, `f1099nec-2026-fields.json` produced by
`scripts/enumerate-pdf-fields.mjs <pdf>` (pdf-lib only; prints `{name,type,page,maxLength}` and the sha256).
`tests/unit/tax-suggested.test.ts`: every mapped name exists in the fixture; every entry has label,
section, citation; rules validate like `saveFieldMap`; calculated rules parse and reference mapped
names or `param:`; due rules parse; `includePages` within the page count; the 1099 map names no
`CopyA[0]`/`Copy1[0]` field and no `f2_11` (TIN); `authoredAgainstSha256` equals the fixture's sha;
`fillForm` on the fixture with sample values round-trips (checkbox from "Yes").

## 6. App layer (contracts)

### 6.1 `src/app/tax/data.ts` (slice B1)
`loadTaxContext(supabase, opts?: { fiscalYearId?: string; contractorYear?: number; today?: Date })`.
- Fiscal year = `opts.fiscalYearId` else `filingYearFor(...)`. `contractorYear` = opts or the
  existing Jan/Feb rule.
- Parameters: fetch all rows; `parametersAsOf(rows, date)` with `effective_from <= date && (effective_to === null || effective_to > date)`;
  1099 threshold as of `${contractorYear}-12-31`; 1120-H keys as of `fiscalYear.ends_on`. Expose
  `parametersAll` (for "Where these rules come from") and `input.parameters` (resolved).
- Templates: select `id, form_code, tax_year, kind, due_rule, due_rule_citation, filing_instructions, filing_citation, notes, verified_at, active, source_url, instructions_url, include_pages, mirror_json, revision, revision_title`.
- Also load: `links` (tax_form_links, active), `startedForms` (tax_forms with the new columns),
  `locked1120hFiscalYearIds`, `accountant` (`{ personId, fullName, email, firm } | null` via
  `associations.accountant_person_id` → persons), `settings` (`informationReturnsFiling`, `ilSosFileNumber`),
  `fiscalYears` (all), `nonexemptByAccount` (tax_receipts_by_account where not is_exempt).
- `TaxContext` gains those plus `deadlines: Deadline[]` (from `taxDeadlines`) and `forms` keeps
  `determineForms(input)`.

### 6.2 `src/app/tax/form-actions.ts` (B1)
- `runAutofill(supabase, formId)`: loads the form; `loadTaxContext(supabase, { fiscalYearId: form.fiscal_year_id ?? undefined, contractorYear: form.form_code in 1099/1096 ? form.tax_year : undefined })`;
  active template must be `kind = 'pdf'` (link_only → treated as noTemplate for fields, but due_on
  still refreshed); passes `entered` from existing rows; calculated rows stored with
  `confirmed_at = now()` when non-null; refreshes `tax_forms.due_on`, `determination`, `determination_reason` from ctx.
- `confirmField`, `editField`, `leaveFieldBlank`, `resolveProposed` call `runAutofill` after the write
  (so the chain recomputes), then `recomputeStatus`.
- `startForm`: due_on from `ctx.deadlines` (verified or estimated date; null for none); `'eligible'`
  allowed in `determination`.
- `markFormFiled`: allowed when `status === 'ready_to_sign'` **or** (no `pdf` template and zero fields).
  For `irs_1120h` with a fiscal year: if no `tax_filings` row, call `compute_and_save_tax_filing`
  first; then `lock_tax_filing`.
- New: `setAccountant(formData)` (name, firm, email → find or create the `persons` row by
  `(association_id, lower(email))`, then `rpc set_accountant`); `clearAccountant()`;
  `markSentToAccountant(formId, snapshot: { subject; body; attachments: string[] })` → sets the three
  columns (board, through RLS); `setFilingSettings(formData)` → `rpc set_tax_filing_settings`.
- `revalidateTax` also revalidates `/` (already) — keep.

### 6.3 `src/app/tax/actions.ts` (B1): remove `markTaxFilingFiled`; keep the rest.

### 6.4 Taxes tab `src/app/tax/page.tsx` + `tax-client.tsx` + new `this-year.tsx`, `accountant-card.tsx`, `filing-settings.tsx` (slice C1)
Top to bottom:
1. H1 "Taxes"; subtitle `Fiscal year {label} ({starts_on} to {ends_on}) — which forms you need, why, and when.`
   plus a small fiscal-year chooser (links `?fy=`) when more than one fiscal year exists.
2. **This year** — one `Answer` (first match wins): no EIN → attention "Needs you: add your EIN"
   (button → /building); unconfirmed income → "Needs you: classify {n} income account(s)" (→ #income);
   contractor over threshold without W-9 → "Needs you: get a W-9 from {name}" (→ /contractors);
   an overdue **verified** deadline → bad "Overdue: {form} was due {date}" (estimated past dates read
   "may be overdue — estimated"); next deadline within 90 days → neutral "{name} is due {Month D, YYYY} — {n} days"
   with detail "From the {year} instructions ({citation})." or "Estimated — not yet checked against this
   year's instructions." and "Next step: …" (start / send to your accountant / confirm each line /
   export, sign and file / mark as filed) with that step as the button; else good "Nothing to do until {Month}".
   Always: secondary buttons "Add these dates to your calendar" (`/tax/calendar`) and "Send the dates
   to the board" (mailto to the other current board members' emails — persons with active
   board_admin/board_member grants — subject `{displayName}: tax dates for {year}`, body = the list
   with "(estimated)" marks and the /tax link), and a text link "See every date →".
3. **Your forms** — grid of `FormCard`s, one per outcome (not_required included but muted), sorted
   by deadline date (soonest first, none last). Card: title; determination pill (`eligible` →
   "You qualify"); plain line; reason; due line ("Due {date} ({citation})" / "Estimated {date} —
   not yet checked" / "Due date not on file — ask your CPA"); note line from the template; links line
   ("Official form ↗ · Instructions ↗ · File online ↗ — checked {date}" / "… — not yet checked by a
   person" / "Walkup has no links on file for this form yet"); status line ("Not started" / "Figures
   ready — nothing to confirm in Walkup" / "Needs you: {k} lines to confirm" / "Sent to {first name} on
   {date}" / "Ready to sign" / "Filed on {date}"); one action (Start / Continue / Export to sign /
   Open / File online ↗ + Mark as filed for link-only / Filed link). Below: "Other filings may apply.
   Ask your CPA." and, when `state_code !== "IL"`, an `Answer` (neutral) "Walkup only knows Illinois'
   state filings so far" / "Your building is in {state}. The federal forms above still apply; ask your
   CPA which {state} filings do." For IL + no `incorporated_on`: a nudge to add it in Building Info.
4. **Your accountant** card: contact or a three-field form (Name, Firm, Email), "Change"/"Remove";
   quiet link "Give them read access to the books →" (/building); when set, a button "Email a heads-up
   about this tax season" (mailto `heads_up`).
5. **Your income, classified** (unchanged).
6. **1120-H check** (unchanged, except FilingStatus loses "Mark as filed" and says "Filed from the
   1120-H form page").
7. **Where these tax rules come from**: all `parametersAll` rows with effective ranges
   ("$600 … through Dec 31, 2025", "$2,000 … from Jan 1, 2026"), checked/not, source link.
8. **Contractors and 1099s — payments in {year}**: unchanged table plus (a) a one-question chooser
   "How do you file 1099s with the IRS?" [On paper] [Electronically (IRIS)] [Not sure yet] with the
   line "Form 1096 is only needed with paper 1099s. Copy A and Form 1096 printed from the IRS website
   can't be filed." (`setFilingSettings`); (b) per row missing a W-9: "Ask for a W-9" mailto to the
   vendor's email (subject `{displayName}: W-9 request`, body with the W-9 link from the registry);
   (c) for IL: "Illinois SOS file number: {n} [Change]" / "Add your file number — the portal asks for
   it" beside the SOS card's File online link (same `setFilingSettings`); (d) the threshold hint reads
   from the as-of parameter ("The threshold for payments made in {year} is {$} — {checked|not yet checked}").
9. **Past years** (unchanged). 10. `TAX_FOOTER`.

### 6.5 Form page `src/app/tax/forms/[formId]/*` + exports + calendar (slice C2)
- Header: back link; title; plain; status pill + reason; due line live from `ctx.deadlines` (by key);
  links line; a 5-step strip "Check the figures → Send to your accountant → Confirm each line → Export
  to sign → Mark as filed" with the current step bold.
- No `pdf` template: box "Walkup hasn't checked the {year} official form yet." / "You can still
  download your figures, open the official form, and send both to your accountant. Walkup fills the
  official form only after a person has checked it." Buttons: "Download your figures (Excel)",
  "Open the official form ↗" (registry/template link), "Send to your accountant" (panel below),
  board-only "Mark as filed — filed by hand or by your accountant". Then a read-only "Your figures"
  list from `figuresPack`.
- With a template: buttons "Refresh from your records", "Send to your accountant", "Export to sign"
  (ready_to_sign/filed; 1099: "Export the contractor's copies"), "Editable PDF for a CPA", "Figures
  worksheet (Excel)", "Mark as filed" (ready_to_sign). Sections in map order (sections are named with
  numeric prefixes, see §7, and sorted by that prefix), "Needs you" rows first.
- `FieldRow` kinds: `checkbox` → value "Yes" via "Check this box" / "Leave unchecked" (= leave_blank);
  `money` with `zeroOk` → extra "Enter 0" button; `hint` text under the label; for 1120-H lines 1–7
  the page shows the by-account hint "Your records show {$N} of income that isn't owner fees:
  {Interest $…, Laundry $…}. Enter it on the matching lines." and a warning when lines 1–7 add up to a
  different total than the ledger. Calculated rows show "Calculated" and no buttons.
- `send-panel.tsx`: step 1 download buttons (editable PDF when a pdf template exists, worksheet
  always), step 2 "Open the email draft" (mailto `1120h` or `1099`), step 3 "Mark as sent" →
  `markSentToAccountant` with the subject/body/attachments snapshot; footnote "Opens a draft in your
  email app — nothing is sent. Attach the files you just downloaded; Walkup can't attach them for
  you." After: "Sent to {first name} on {date}." If no accountant: "Add your accountant on the Taxes
  tab so the draft is addressed to them" + the draft still opens with no recipient.
- `export/route.ts`: worksheet = "Figures" sheet(s) from `figuresPack` first, then "Fields" (when any),
  then "1120-H tests"; PDF kinds: link_only template → 409 "This form is filed online; there is no PDF
  to fill."; apply `mirrorValues`, fill, then `keepPages(include_pages)`; editable gets `draftCover`
  while status is draft/in_review; signable unchanged (cover + flattened). Load the ctx for the form's
  own year. Filenames: `{label} {year}[ {vendor}] to sign.pdf` / `editable.pdf` / `worksheet.xlsx`
  (ASCII-safe Content-Disposition as in financial-statements).
- `src/app/tax/calendar/route.ts`: GET, `can_read_financials` else 403, builds `ctx.deadlines` →
  `buildCalendar`, `Content-Type: text/calendar; charset=utf-8`, `Content-Disposition: attachment; filename="Walkup tax dates.ics"`.

### 6.6 Admin `src/app/admin/tax-templates/*` (slice C3)
- Page: new card **"Set up from Walkup's suggestions"** (one row per `SUGGESTED` entry not yet
  present as a template with the same `suggested_from`; button "Set up {label} · {year}"), card
  **"Official links"** (all `tax_form_links` rows: label, url, state, retrieved/verified/last-checked,
  buttons "I opened this and it's current" → `verifyLink(id)`, "Deactivate", an add-link form, and
  "Check all links" → `checkLinks()` which GETs each URL with a browser-like UA and 10 s timeout and
  records `200`, `blocked` (403/connection failure on ilsos.gov) or `error: …`), card **"Rules and
  thresholds"** (all `tax_parameters` with effective ranges, checked/not, "Mark checked today" →
  `verifyParameter(id)`), and a **"Add a link-only template"** form (form code, tax year, official
  source URL, due rule + citation, filing instructions + citation, notes).
- `actions.ts`: `applySuggestedTemplate(key)` (§3.2 guards; stores `revision_title`, `instructions_url`,
  `include_pages`, `mirror_json`, `suggested_from`, due/filing/notes; applies the map through the same
  validation as `saveFieldMap`; redirects to the detail page with a banner note); `createLinkOnlyTemplate`;
  `verifyLink`, `addLink`, `deactivateLink`, `checkLinks`; `verifyParameter`; `checkForUpdates` skips
  `link_only`, captures and compares `revision_title` ("Title changed from X to Y — probably next
  year's form; set its tax year by hand"); `storeTemplate` drops `upsert: true` and records `revision_title`.
- `[templateId]/page.tsx`: link-only layout (no preview; rules only); `FieldMapForm` shows `kind`,
  `review`, `zeroOk`, `hint` columns (free text, optional) and `include_pages`/`mirror` fields;
  the attestation copy adds "I opened the labeled preview and the filled test export in a PDF viewer
  and checked every mapped line, the due rule and the links."

### 6.7 Home (slice C4)
- `src/app/page.tsx`: replace the `dueTemplates`/`verifiedTaxDeadlines` block: fetch active templates
  (all codes, columns as in 6.1), `tax_forms` (id, form_code, tax_year, vendor_id, status, filed_on,
  sent_to_accountant_at), locked 1120-H filings, `associations.information_returns_filing` and
  `accountant_person_id`, `tax_parameters` (threshold as of Dec 31 of the contractor year) and
  `vendor_1099_calendar_totals` for the contractor year (Jan/Feb → prior year), then
  `taxDeadlines({ … outcomes: a light list built from those rows: irs_1120h (or none when the FY is
  not known), il_1120 + il_sos_annual_report for IL, one irs_1099_nec per contractor over the
  threshold, irs_1096 per §3.6 })` — **Home never calls `loadTaxContext`**. Pass `taxDeadlines` to
  `assembleReminders`, feed `nextFiling` by key (not name), `urgentItems.nec1099Due` from the 1099
  deadline (fallback Jan 31), W-9 count from the same contractor-year rows (threshold applied).
- `src/lib/home/reminders.ts`: `ReminderInputs` drops `verifiedTaxDeadlines`, gains
  `taxDeadlines?: Deadline[]`; the tax block becomes: group 1099 deadlines into one reminder
  "{n} 1099-NEC{s} to contractors" with the earliest date; one reminder per other deadline with a date;
  milestones within the 120-day horizon ("Send Form 1120-H to your accountant"); `unverified` =
  basis ≠ verified; keep the W-9 Dec 1 nudge and everything else. Update
  tests/unit/insurance-reminder.test.ts, access-review-reminder.test.ts, home-snapshot.test.ts,
  tests/unit/tax-rules.test.ts as needed.
- `src/components/home/coming-up.tsx`: wording "estimated — not yet checked against this year's
  instructions" from a shared string in `lib/tax/copy.ts`.
- `src/app/building/actions.ts`: `revalidateBuilding()` also revalidates `/tax`.
- `src/lib/home/setup-guide.ts`: the Taxes step is done when a `tax_forms` row exists for the latest
  fiscal year OR `taxFilingComputedAt` (keep the input, add `taxFormsStarted: number`).

### 6.8 Docs (slice C5)
- `docs/DECISIONS.md` **#33 "Taxes: links registry, suggested templates, accountant handoff, deadlines"**
  recording every item in §3 with the why and "How to apply", dated 2026-10-11, decided by Doug
  (direction) and Claude (details), and noting the still-open CPA review (open question A).
- `public/walkthrough.txt`: Taxes mentions (classify income once; threshold wording no longer "$600";
  "Add these dates to your calendar"; "Send to your accountant"; the admin's one-time template setup).

## 7. The suggested maps (authored 2026-10-11 against the labeled renders)

Name prefix for 1120-H: `topmostSubform[0].Page1[0].` (write full names). Sections use numeric
prefixes so they sort: `1. About your association`, `2. Lines B–E (the two tests)`,
`3. Gross income (lines 1–8)`, `4. Deductions (lines 9–17)`, `5. Tax and payments (lines 19–26)`.
Citations name the printed line on Form 1120-H (2025) and "Instructions for Form 1120-H (2025),
Specific Instructions" for that line.

**irs_1120h_2025** — `sourceUrl https://www.irs.gov/pub/irs-prior/f1120h--2025.pdf`,
`instructionsUrl https://www.irs.gov/instructions/i1120h`, `expectedTitle "2025 Form 1120-H"`,
`authoredAgainstSha256 dffaa4d3079cc0ba14e7f50c823bf19ff9595c54c274d03ffe859c60382eab6f`, `revision "2025"`,
`dueRule "FY_END + 4 MONTHS, DAY 15"`, `dueRuleCitation "Instructions for Form 1120-H (2025), When To File"`,
`filingInstructions "Sign and date page 1 (an officer of the association). Mail it to the address under 'Where To File' in the instructions for your state, or e-file. An association that files 10 or more returns of any type in the calendar year (1099s count) must e-file — don't mail this packet in that case."`,
`filingCitation "Instructions for Form 1120-H (2025), Where To File; Electronic Filing"`,
`notes "Fiscal years ending June 30 are due in the 3rd month, not the 4th. A due date on a Saturday, Sunday or legal holiday moves to the next business day. Extension: Form 7004. The election to file 1120-H is made each year by filing it on time."`

| field (after prefix) | section | label | source | rule | kind / flags |
|---|---|---|---|---|---|
| PgHeader[0].f1_01[0] | 1 | Tax year beginning (fiscal-year filers only) | setting | fiscal_year.starts_on_mmdd_noncalendar | text |
| PgHeader[0].f1_02[0] | 1 | Tax year ending (fiscal-year filers only) | setting | fiscal_year.ends_on_mmdd_noncalendar | text |
| PgHeader[0].f1_03[0] | 1 | Tax year ending — last two digits of the year | setting | fiscal_year.ends_on_yy_noncalendar | text |
| NameAddress[0].f1_04[0] | 1 | Name | setting | association.legal_name | text |
| f1_11[0] | 1 | Employer identification number | setting | association.ein | text |
| NameAddress[0].f1_05[0] | 1 | Number and street | setting | association.street_address | text |
| NameAddress[0].f1_07[0] | 1 | City or town | setting | association.city | text |
| NameAddress[0].f1_08[0] | 1 | State | setting | association.state_code | text |
| NameAddress[0].f1_10[0] | 1 | ZIP code | setting | association.postal_code | text |
| f1_12[0] | 1 | Date association formed | setting | association.incorporated_on_us | date |
| c1_5[0] | 1 | A — Condominium management association | manual | — | checkbox; hint "Check exactly one of the three. Walkup's 30% rate assumes a condominium or residential association; timeshares use 32% — ask your CPA if unsure." |
| c1_5[1] | 1 | A — Residential real estate association | manual | — | checkbox |
| c1_5[2] | 1 | A — Timeshare association | manual | — | checkbox |
| f1_13[0] | 2 | Line B — Total exempt function income (60% test) | ledger | exempt_income | money |
| f1_14[0] | 2 | Line C — Expenditures for purposes in the 90% test | ledger | exempt_expenditures | money |
| f1_15[0] | 2 | Line D — Association's total expenditures | ledger | total_expenditures | money |
| f1_16[0] | 2 | Line E — Tax-exempt interest received or accrued | manual | — | money, zeroOk; hint "Interest on state or municipal bonds. Most associations have none." |
| f1_17[0] … f1_23[0] | 3 | Line 1 Dividends · 2 Taxable interest · 3 Gross rents · 4 Gross royalties · 5 Capital gain net income · 6 Net gain or (loss) from Form 4797 · 7 Other income (excluding exempt function income) | manual | — | money, zeroOk; hint on 2 "Bank interest goes here."; on 7 "Laundry, parking, rentals to outsiders and similar." |
| f1_24[0] | 3 | Line 8 — Gross income (excluding exempt function income): lines 1–7 | calculated | add(f1_17…f1_23 full names) | money |
| f1_25[0] … f1_31[0] | 4 | Line 9 Salaries and wages · 10 Repairs and maintenance · 11 Rents · 12 Taxes and licenses · 13 Interest · 14 Depreciation · 15 Other deductions | manual | — | money, zeroOk; hint "Only costs directly connected to the income on lines 1–7 (for example bank fees on an interest-bearing account). Building expenses don't go here." |
| f1_32[0] | 4 | Line 16 — Total deductions: lines 9–15 | calculated | add(f1_25…f1_31) | money |
| f1_33[0] | 4 | Line 17 — Taxable income before the specific deduction: line 8 minus line 16 | calculated | sub(f1_24, f1_32) | money |
| f1_35[0] | 5 | Line 19 — Taxable income: line 17 minus the $100 specific deduction (line 18 is preprinted) | calculated | max0(sub(f1_33, param:form_1120h_specific_deduction)) | money |
| f1_36[0] | 5 | Line 20 — 30% of line 19 (timeshare associations: 32% — ask your CPA) | calculated | mul(f1_35, param:form_1120h_rate_condo) | money |
| f1_37[0] | 5 | Line 21 — Tax credits | manual | — | money; hint "Rare for an association. Leave blank if none." |
| f1_38[0] | 5 | Line 22 — Total tax: line 20 minus line 21 | calculated | sub(f1_36, f1_37) | money |
| f1_39[0] … f1_44[0] | 5 | 23a Preceding year's overpayment credited · 23b Current year's estimated tax payments · 23c Tax deposited with Form 7004 · 23d Credit for tax on undistributed capital gains · 23e Credit for federal tax on fuels · 23f Elective payment election amount | manual | — | money (no zeroOk); hint "Leave blank if none." |
| f1_45[0] | 5 | Line 23g — Total payments and credits | calculated | add(f1_39…f1_44) | money |
| f1_46[0] | 5 | Line 24 — Amount owed: line 22 minus line 23g | calculated | max0(sub(f1_38, f1_45)) | money |
| f1_47[0] | 5 | Line 25 — Overpayment: line 23g minus line 22 | calculated | max0(sub(f1_45, f1_38)) | money |
| f1_48[0] | 5 | Line 26a — Overpayment credited to next year's estimated tax | manual | — | money; hint "Leave blank if none." |
| f1_49[0] | 5 | Line 26b — Overpayment refunded | manual | — | money; hint "Leave blank if none." |

Unmapped (print blank): f1_06 (room/suite), f1_09 (country), the four header checkboxes
(c2_1 final return, c1_2 name change, c1_3 address change, c1_4 amended), f1_34 (line 18, 1 pt wide
— the $100 is preprinted), c1_11/f1_51/f1_52 (direct deposit), f1_53 (title), c1_6, c1_7,
f1_54–f1_59 (paid preparer). Say so in `notes` on the admin page.

**irs_1099_nec_2026** — `sourceUrl https://www.irs.gov/pub/irs-pdf/f1099nec.pdf`,
`instructionsUrl https://www.irs.gov/instructions/i1099mec`, `expectedTitle "Form 1099-NEC (Rev. December 2026)"`,
`authoredAgainstSha256 68a8f00078be6dd6a4912cc4209df317b31840d5fe19560222d39df9f2f7ff49`,
`revision "Rev. December 2026"`, `taxYear 2026`, `includePages [4, 5, 6]`,
`mirror [{ from: "CopyB[0]", to: "Copy2[0]" }]`, `dueRule "CAL_YEAR_END + 1 MONTHS, DAY 31"`,
`dueRuleCitation "Instructions for Forms 1099-MISC and 1099-NEC (Rev. December 2026), When To File — IRC section 6071(c): January 31"`,
`filingInstructions "Give Copy B (with the instructions page) to the contractor by the due date and keep Copy 2 for your records. Do not print and file Copy A from this PDF — it isn't scannable and the IRS can penalize it. File with the IRS online through IRIS (free; you need a Transmitter Control Code, which takes weeks — apply well before January) or on official red-ink forms ordered from the IRS. If you file 10 or more information returns in total, you must e-file. The contractor's taxpayer ID is left blank on purpose — write it on their copy from their W-9."`,
`filingCitation "Form 1099-NEC (Rev. December 2026), page 1 'Attention'; General Instructions for Certain Information Returns, Part O; Regulations section 301.6011-2"`,
`notes "Copy A and Form 1096 are never produced by Walkup. Boxes 1b–1d (tips, TTOC, overtime) and the state boxes are left blank — ask your CPA if they apply."`
Sections: `1. Your association (payer)`, `2. Contractor (recipient)`, `3. Amounts`. Prefix `topmostSubform[0].CopyB[0].`:

| field | section | label | source | rule | kind |
|---|---|---|---|---|---|
| PgHeader[0].CalendarYear[0].f2_1[0] | 1 | Calendar year | setting | form.tax_year | text |
| LeftCol[0].f2_2[0] | 1 | Payer's name | setting | association.legal_name | text |
| LeftCol[0].f2_3[0] | 1 | Payer's street address | setting | association.street_address | text |
| LeftCol[0].f2_5[0] | 1 | Payer's city | setting | association.city | text |
| LeftCol[0].f2_7[0] | 1 | Payer's state | setting | association.state_code | text |
| LeftCol[0].f2_9[0] | 1 | Payer's ZIP | setting | association.postal_code | text |
| LeftCol[0].f2_10[0] | 1 | Payer's TIN (your EIN) | setting | association.ein | text |
| LeftCol[0].f2_12[0] | 2 | Recipient's name | contractors | contractor.name | text |
| LeftCol[0].f2_13[0] | 2 | Recipient's street address | contractors | contractor.address | text, review; hint "Walkup keeps one address line — split it across the street, city, state and ZIP boxes if you can." |
| LeftCol[0].f2_15[0] | 2 | Recipient's city | manual | — | text |
| LeftCol[0].f2_16[0] | 2 | Recipient's state | manual | — | text |
| LeftCol[0].f2_18[0] | 2 | Recipient's ZIP | manual | — | text |
| RightCol[0].f2_20[0] | 3 | Box 1a — Nonemployee compensation | contractors | contractor.total_paid | money |

Unmapped: `LeftCol[0].f2_11[0]` (recipient's TIN — **never**), f2_4, f2_6 (telephone), f2_8, f2_14,
f2_17, f2_19 (account number), all RightCol boxes other than 1a, the checkbox, and every `CopyA[0]`,
`Copy1[0]` and `Copy2[0]` field (Copy 2 is filled by mirroring at export).

**Link-only entries** (kind `link_only`, `fieldMap {}`):
- `il_sos_annual_report` (taxYear 2026): `sourceUrl https://www.ilsos.gov/departments/business-services/annual-reports.html`,
  `dueRule "INCORPORATION_ANNIVERSARY_MONTH - 1 MONTHS, DAY LAST"`, citation
  `"805 ILCS 105/114.10 — the annual report is delivered within the 60 days immediately preceding the first day of the anniversary month"`,
  filingInstructions `"File online at apps.ilsos.gov/nfpannualreports — you'll need the corporation file number. Fee $10 ($25 expedited). A $3 penalty applies if it isn't filed before the first day of the anniversary month, and not filing is a ground for administrative dissolution."`,
  citation `"805 ILCS 105/115.10(m), 105/112.35; ILSOS 'File an Annual Report'"`, notes
  `"Illinois not-for-profit corporations only. ilsos.gov blocks automated checks — a person confirms these links."`
- `il_1120` (taxYear 2025): `sourceUrl https://tax.illinois.gov/forms/incometax/currentyear/business-corporate.html`,
  `dueRule "FY_END + 4 MONTHS, DAY 15"`, citation `"2025 Form IL-1120 Instructions — due the 15th day of the 4th month after the close of the tax year (same as federal); June 30 year ends: 3rd month"`,
  notes `"Illinois DOR: an association that files federal Form 1120-H must file Form IL-1120 (Step 2, Line 1 = Form 1120-H line 19) and attach a copy of the 1120-H. Illinois grants an automatic 7-month filing extension; any payment is still due on the original date. Walkup doesn't fill IL-1120."`
- `irs_1096` (taxYear 2026): `sourceUrl https://www.irs.gov/forms-pubs/about-form-1096`,
  `dueRule "CAL_YEAR_END + 1 MONTHS, DAY 31"`, citation `"Form 1096 (2026): 'With Forms 1099-NEC, file by January 31'"`,
  notes `"Only with paper 1099s; not used when filing through IRIS. Do not print and file the PDF from irs.gov — order official forms."`

## 8. Tests (summary — each slice writes its own; D runs everything)

Unit: tax-deadlines, tax-ics, tax-accountant-email, tax-links, tax-figures, tax-suggested,
due-rules additions, autofill (entered operands, leaveBlank = 0, review cap, calculated overwrite),
determine (eligible, 1096 three-way, notes), reminders/home updates.
DB (PGlite, tests/db/tax-center-v2.test.ts): 0048 constraints; links seeded unverified and
admin-only writes; link_only template accepted/pdf-without-file refused; `eligible` accepted;
`set_accountant` by board member OK, owner 42501, cross-association person refused by the trigger;
`redact_person` refusal while accountant; `set_tax_filing_settings` validation; parameter rows
$600→$2,000 non-overlapping and resolved as-of; `verify_tax_parameter` admin-only;
`is_platform_admin` false at aal1; `compute_and_save_tax_filing` reads as of the fiscal year end;
`tax_form_templates` still ships with zero rows; migrations lint passes.
Manual on dev Supabase (after Doug applies/approves): admin one-click installs 1120-H 2025 and
1099-NEC 2026, labeled preview opens, Verify and activate, Start fills header + B/C/D, editing line 2
recomputes 8/17/19/20, Export to sign, 1099 export has only pages 4–6 with Copy 2 mirrored,
/tax/calendar imports into Apple Calendar, mailto opens with the body intact.

## 9. File ownership (slices)

- **A1** migration 0048, tests/db/tax-center-v2.test.ts, tests/db/migrations.test.ts (exception),
  src/app/documents/link-actions.ts.
- **A2** src/lib/tax/deadlines.ts, src/lib/tax/ics.ts, tests/unit/tax-deadlines.test.ts, tests/unit/tax-ics.test.ts.
- **A3** src/lib/tax/accountant-email.ts, links.ts, figures.ts (+ tests), src/lib/tax/copy.ts.
- **A4** src/lib/tax/autofill.ts, due-rules.ts, determine.ts, pdf.ts (+ tests/unit/tax-rules.test.ts, tax-pdf.test.ts).
- **A5** src/lib/tax/suggested/*, scripts/enumerate-pdf-fields.mjs, tests/fixtures/tax/*.json, tests/unit/tax-suggested.test.ts.
- **B1** src/app/tax/data.ts, form-actions.ts, actions.ts.
- **C1** src/app/tax/page.tsx, tax-client.tsx, this-year.tsx, accountant-card.tsx, filing-settings.tsx, filing-status.tsx.
- **C2** src/app/tax/forms/[formId]/{page.tsx, field-row.tsx, form-controls.tsx, send-panel.tsx, export/route.ts}, src/app/tax/calendar/route.ts.
- **C3** src/app/admin/tax-templates/* (+ [templateId]/*).
- **C4** src/app/page.tsx (tax block only), src/lib/home/reminders.ts, snapshot.ts, urgent-items.ts, setup-guide.ts, src/components/home/coming-up.tsx, src/app/building/actions.ts (revalidate), related unit tests.
- **C5** docs/DECISIONS.md, public/walkthrough.txt.
