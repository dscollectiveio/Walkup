# I6-selfcheck: insurance-spec self-check and polish

Step owner: Insurance. Date: 2026-10-14. No git commands run; no migrations
touched or applied; no dev server started or stopped; no dependencies added.
The workstream report for Doug and the other workstreams is
`docs/specs/progress/insurance-report.md`.

## How the spec was walked

- Read every progress note (F1 to F3, I1 to I5, R1 to R4, S1, E1, D1, PL1 to PL3).
- **§1.1 feature map:** each row traced to its code (import pipeline, save RPC and
  links, coverage check, Marketplace, eight email kinds, five tabs). All present.
- **§9, §10, §11 copy:** a throwaway script (scratchpad, not in the repo) pulled
  every quoted string out of §6 to §11 (about 1,050), split them on `{placeholders}`
  and searched `src/app/insurance`, `src/lib/insurance`, `src/components`. Each
  miss was read in context. Nearly all were examples ("West Bend master"),
  pluralised in code, worded per a recorded deviation (I5 #5, the market
  polling), or Foundation/Repairs copy. The real ones are fixed below.
- **§3.1 routes:** every `/insurance…` href in `src` resolves to a page that
  exists; `maxDuration = 300` on every listed page (test green).
- **§12:** each Integration and Repairs task checked against the current tree
  (status in the report).
- **§13:** every test file §13.1 and §13.2 names exists and passes.
- **§15:** steps 1 to 7 done; step 8 is green locally; "apply to dev" is the
  lead's.
- Server action modules: every `"use server"` file under `src/app/insurance` and
  `src/app/admin/partners` exports only async functions (and one type
  re-export), which Next requires and tsc doesn't check.

## Built or changed

| File | Change |
|---|---|
| `tests/db/insurance-select-columns.test.ts` (new) | A guard tsc can't give: reads every `.from("table")` chain in `src/app/insurance`, `src/lib/insurance` and `src/app/admin/partners` and checks the select list (casts, aliases, embedded resources), filter and order columns, and literal insert/update keys against the migrated PGlite schema; and every `.rpc("fn", { … })` against the function's argument names. Plus a parser self-test. Found nothing wrong today (every query names real columns and arguments). |
| `src/app/insurance/components/insurance-uploader.tsx` | The button label was "Drop PDFs or photos here, or choose files", and Foundation's drop zone already prints "Drop files here, or" before the button, so desktop read "Drop files here, or Drop PDFs or photos here, or choose files". Default label now follows the pointer: "Choose files" with a fine pointer (§11.7) and "Take a photo or choose a file" on touch (§11.6). Callers that pass a label are unchanged. |
| `src/lib/insurance/coverage-check.ts`, `components/finding-card.tsx` | §6.8 CP-EB-01: the citation is "shown as 'The Act names equipment breakdown as coverage a declaration may require.'" That line was missing (the card showed only the Act's quote). `Finding.citationNote?` added (set only when the citation itself is shown, i.e. Illinois condo checks); the card prints it above the quote. |
| `src/app/insurance/components/basis-chip.tsx` | `your_data` chip read "Your own numbers"; §6.8 says "Your numbers". |
| `src/app/insurance/message-actions.ts` | The claim email's `{{loss_details}}` now follows §10.8: "Date of loss: {date}. What happened: {description}. Amount claimed: {x}." (was "Date of the loss", "Amount claimed so far", no full stops). |
| `src/app/insurance/page.tsx` | Its own one-entry `STATE_NAMES` replaced by `stateNameFor()` from `market-verify.ts` (the Marketplace already used it), so a non-Illinois association's basis copy names its state like the Marketplace does (§10.14). |
| `src/app/admin/partners/partner-form.tsx` | Em dash removed from user-facing copy ("Active: boards can send requests to them"). |
| `tests/unit/insurance-coverage-check.test.ts`, `tests/unit/insurance-ui-helpers.test.ts` | CP-EB-01 citation note; all four basis labels. |

## Deliberately different from the spec

1. §9.1 names the uploader label "Drop PDFs or photos here, or choose files". With
   Foundation's drop zone printing its own "Drop files here, or", that label
   doubled up, so the button says "Choose files" (§11.7's wording) and, on phones,
   "Take a photo or choose a file" (§11.6). §10.3's flow uses the §9.1 words; this
   is the same control.
2. `citationNote` is optional on `Finding` so nothing else that builds findings
   (tests, fixtures) had to change.

## Not done / can't be done here

- §13.3 manual checks (signed-in browser, iPhone, VoiceOver, printing, live web
  search): 0052 isn't on the dev project and every insurance route 307s to
  `/login` without a session. Left for the lead after applying 0052 to dev.
- Earlier steps' open items stand (listed in the report under Known gaps).

## Cross-workstream requests

All in `insurance-report.md` (Integration I-1 to I-12, Repairs R-1 to R-5,
Foundation). New from this step: none beyond the label note above (Foundation
could let `DirectUpload` print the touch wording itself; Insurance now passes it).

## Commands run

- Baseline: `npx tsc --noEmit` exit 0; `npx vitest run tests/unit/insurance-*.test.ts`
  25 files, 385 passed; `npx eslint src/app/insurance src/lib/insurance src/app/admin/partners tests/unit/insurance-*.test.ts tests/db/insurance*.test.ts` exit 0;
  `npx vitest run tests/db/insurance-v2.test.ts tests/db/insurance.test.ts tests/db/insurance-actions-contract.test.ts` 3 files, 138 passed.
- `python3 -I <scratchpad>/copycheck.py` over spec lines 2484 to 5880 (the copy walk above).
- `npx vitest run tests/db/insurance-select-columns.test.ts`: first run failed on
  my own parser (an alias regex ate `::text`), fixed; then 3 passed.
- `npx vitest run tests/unit/insurance-coverage-check.test.ts tests/unit/insurance-ui-helpers.test.ts`: 86 passed.
- Final: `npx tsc --noEmit` exit 0 (whole project); eslint as above exit 0;
  `npx vitest run tests/unit` 116 files, 1434 passed;
  `npx vitest run tests/db/insurance-v2.test.ts tests/db/insurance.test.ts tests/db/insurance-actions-contract.test.ts tests/db/insurance-select-columns.test.ts`
  4 files, 141 passed; `npx vitest run tests/db/migrations.test.ts tests/db/rls.test.ts` 20 passed.
- `curl -s -o /dev/null -w "%{http_code}"` on `/insurance`, `?view=check`,
  `/insurance/import`, `/insurance/facts`, `/insurance/compare`, `/insurance/sheet`
  at `localhost:3100`: all 307 (to `/login`), no 500.
