# Verifying the due-date rules (for Doug and your CPA)

Walkup dates each form from a stored rule. A rule shows "Estimated, not yet checked" on the Taxes tab until a person
verifies it. Nothing in the code marks a rule verified. This page lists the three rules to check, where each comes
from, and the clicks to make it official. Walkup prepares and reminds; your CPA decides what applies.

## What to do, per form

1. Open **/admin/tax-templates**.
2. Under the suggested templates, **Install** the one listed below (it is inactive when installed).
3. Open the IRS page named in "Source" and the instructions, and compare **only the sentence about when to file**
   with the rule below.
4. If they agree, **Verify and activate** it. From then on the cards show the date without "Estimated".
5. If they don't, don't verify it. Tell Walkup what the instructions say and the rule gets changed first.

## The three rules

### Form 1120-H (template `irs_1120h_2025`)
- **Rule:** the 15th day of the 4th month after the fiscal year ends (`FY_END + 4 MONTHS, DAY 15`). A calendar year
  ends December 31, so April 15.
- **Source:** Instructions for Form 1120-H (2025), "When To File". https://www.irs.gov/instructions/i1120h
- **Check:** the sentence about the 15th day of the 4th month. Also that the notes still say a due date on a weekend or
  holiday moves to the next business day, and that the election is made by filing the form on time.
- **Left to your CPA:** whether the association qualifies for and should elect 1120-H at all (the two tests on the
  Taxes tab are Walkup's reading, not advice). A fiscal year ending June 30 gets no date from Walkup, on purpose.

### Form 1120 (template `irs_1120_2025`, new)
- **Rule:** the 15th day of the 4th month after the tax year ends (`FY_END + 4 MONTHS, DAY 15`).
- **Source:** Instructions for Form 1120 (2025), "When To File". https://www.irs.gov/instructions/i1120
  Form page: https://www.irs.gov/forms-pubs/about-form-1120
- **Check:** the same sentence. Walkup never fills Form 1120, so this only dates it. A June 30 year end follows its own
  rule in the instructions, so Walkup shows no date for it.
- **Left to your CPA:** whether 1120 or 1120-H is right this year.

### Form 1099-NEC (template `irs_1099_nec_2026`)
- **Rule:** January 31 after the calendar year of payment (`CAL_YEAR_END + 1 MONTHS, DAY 31`). It applies to the copy
  given to the contractor and the copy filed with the IRS.
- **Source:** Instructions for Forms 1099-MISC and 1099-NEC, "Filing dates" and "When To File".
  https://www.irs.gov/instructions/i1099mec
- **Also check, while you are there:** the reporting threshold. Walkup keeps it as a separate number with its own
  "verified" mark (the $2,000 row for 2026 is not verified yet). Check it on /admin/tax-templates under the thresholds.
- **Left to your CPA:** how 1099s are filed with the IRS (paper with Form 1096, or IRIS). Walkup doesn't ask anymore and
  doesn't show Form 1096: it prepares the contractor's copies only.

## After verifying

- The Taxes tab, the Dashboard reminders and the calendar all use the verified date.
- If the IRS changes a rule later, the rule gets a new revision and a new check. A verified mark doesn't carry over to
  a republished form.
