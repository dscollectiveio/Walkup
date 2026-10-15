# I2-pure-libs: insurance-spec §15 step 2 (pure libs and their unit tests)

Step owner: Insurance. Date: 2026-10-14. No git commands run; no migrations
touched or applied; no dev server started or stopped; no dependencies added.

## Built

| File | What |
|---|---|
| `src/lib/insurance/coverage.ts` | §6.1 verbatim, plus `COVERAGE_VALUES` (tuple for `z.enum`), `isCoverageType`, `coverageLabel`, `coverageShort`, `isSectionKey`, `LINE_COVERAGE`, `lineForCoverage`. |
| `src/lib/insurance/fields.ts` | §6.2: the 89 `FIELD_DEFS` (match the SQL allowlists; the I1 DB test now runs and passes), option lists, `fieldsFor`, `policySelect`/`quoteSelect` (money and percent `::text`), list schemas, `POLICY_EDITABLE_COLUMNS` (TS mirror), `POLICY_EXTRA_COLUMNS`/`QUOTE_EXTRA_COLUMNS`, `FIELD_BY_KEY`, `optionLabel`, and the shared row types `StatusInput`, `PolicyRow` plus `rowText`/`rowBool`. |
| `src/lib/insurance/declarations.ts` | §6.3: `parseMoney` (unchanged), `parseMoneyLoose`, `parsePercent`, `parseDate` (written dates), `parseBoolean(raw, key)`, `parseFieldValue` (money built from digits, no float), `resolveField` (short-form review with `suggested`, `forceReview`), `resolveAll(raw, defs)`, `fromRecord`. Old names re-exported from fields.ts; `GROUP_LABEL`, `policyWarnings` kept for the legacy screens. |
| `src/lib/insurance/format.ts` | §6.5, plus `centsOrNull`, `bp4OrNull`. `mulCentsBp4` is BigInt. |
| `src/lib/insurance/status.ts` | §6.4: `policyStatus`, `withStatus`, `inForce`, `renewalFor`, `effectiveSections`, `legacyValuesOutside`, `linesInForce`, `deductibleHint` (R-5), plus `daysBetween`, `displayValue`. |
| `src/lib/insurance/premium.ts` | §6.6: `frequencyFor`, `addMonthsClamped`, `premiumSchedule`, `premiumBillRetires`, `premiumTotals`, `perUnitCost`, `changePercent`. Passes I1's `premium advance matches premiumSchedule` DB test. |
| `src/lib/insurance/statute.ts` | §6.7: 24 `CITATIONS` (23 + `ICPA_12_A1_PROPERTY`), `STATUTE_VERIFIED_ON = "2026-10-14"`, URLs, `LOOKUPS`, `sectionNumber`, `actLinkText`. |
| `src/lib/insurance/facts.ts` | §6.10: `BuildingFacts`, `FACT_KEYS`/`FactKey`, `FACT_LABEL`, `emptyFacts`, `factUnknown`, `factsSchema`, `parseFactsInput` (keeps only posted keys), `FLOOD_ZONES`, `REPLACEMENT_COST_SOURCES`, `DECLARATION_COVERAGE_FORMS`, `REQUIRED_LINE_VALUES`, `CONSTRUCTION_TYPES`/`constructionLabel`. |
| `src/lib/insurance/guesses.ts` | `factGuesses`, `guessNote`. |
| `src/lib/insurance/duplicates.ts` | `findDuplicatePolicy`, `carrierKey`, `policyNumberKey`. |
| `src/lib/insurance/coverage-check.ts` | §6.8: the 36 rules and `runCoverageCheck` (state gate, condo gate, not-on-file, missing facts, dismissals, order, counts), `legalChecksFor`, `findingLineLabel`, `coverageFormWords`. |
| `src/lib/insurance/compare.ts` | §9.10: `compareRows`, `CompareCell` (with `ariaLabel`), `Change`, `chipText`, `isDeductibleKey`. |
| `src/lib/insurance/owner-summary.ts` | §6.9: schema, `buildOwnerSummaryDraft`, `ownerSummarySourceHash`, `ownerSummaryStaleness`, `LEFT_TO_OWNERS`, `COVERAGE_FORM_OWNER_WORDS`, `certificateInstructions`, `Contact`. |
| `src/lib/insurance/emails.ts` | §7.4/§9.10a: `EMAIL_KINDS`, `PLACEHOLDERS`, `draftFacts`, `requiredPlaceholders`, `checkModelDraft`, `fillPlaceholders`, `templateDraft`, `detailsBlock`, `QuoteRequestPayloadV2`, `switchingChecklist`, helpers `buildingDescription`, `policyReference`, `senderContact`, `coverageWords`. |
| `src/lib/insurance/read-schema.ts` | §7.1.2 to §7.1.6: `READ_LIMITS`, `READ_DEADLINE_MS`, `chooseReadMethod`, `joinTextPages`, `READ_SYSTEM`, `OUTLINE_PROMPT`, `NATIVE_NOTE`, `IMAGE_NOTE`, `buildDetailPrompt`, `OutlineSchema`, `PolicyDetailSchema`, `StoredRead`/`StoredPolicy`, `DetailOutcome`, `postProcessRead`, `readerNotes`, `truncatedNote`, `UNREADABLE`. |
| `src/lib/insurance/market-verify.ts` | §7.3: `MARKET_LINES`, `AgencyItem`, `InsurerItem`, `verifyAgency`, `verifyInsurer`, `itemKey`, `nameKey`, `marketInputs`, `queryKey`, `marketUserLocation`, `agencyTask`, `insurerTask`, `ITEM_GUIDANCE`, `finalizeMarketItems` (step 13), `stateNameFor`. |
| `src/lib/insurance/summary-check.ts` | §7.2: `summaryFacts`, `checkSummary`. |
| `src/lib/insurance/photos-pdf.ts` | §6.5b: `reencodeImage` (Foundation's `normaliseImage`, 2400 px, 0.85), `imagesToPdf` (byte assembly, DCTDecode), `jpegInfo`, `photosPdfName`, `ImageDecodeError`. |
| Tests | `tests/unit/insurance-{fields,declarations,format,statute,premium,status,duplicates,guesses,coverage-check,compare,market-verify,emails,summary-check,owner-summary,read,photos-pdf}.test.ts` (`insurance-declarations` extended; legacy expectations kept except `parseDate("March 1, 2026")`, which §6.3 now parses). `tests/fixtures/insurance-jpegs.ts` (two tiny JPEGs). 267 tests. |
| `src/app/insurance/page.tsx` | Compile fix only (see deviation 1). |

## Statute re-verification (§2.2, §2.2a, §15 step 2)

Fetched on 2026-10-14 with `curl` and a browser user agent (HTTP 200):
`https://www.ilga.gov/Legislation/ILCS/Articles?ActID=2200&ChapterID=62` (Condominium
Property Act, 623 KB) and the CICAA details URL of §2.1 (206 KB). HTML stripped to
text; a script checked each quote verbatim: **all 23 quotes of §2.2 found
verbatim**. Section 12's source note still reads "P.A. 98-762, eff. 6-1-15".
`STATUTE_VERIFIED_ON` stays "2026-10-14" (today).

- **`ICPA_12_A1_PROPERTY` added** (§2.2 item 8): 12(a)(1) reads "Property insurance
  (i) on the common elements and the units, including the limited common elements
  …". Quote stored: "on the common elements and the units, including the limited
  common elements" (12 words). IL-PROP-01 now cites it, with the §6.8 alternative
  detail "If you have one, add it. The Act requires property insurance covering the
  common elements and the units." So `statute.test` expects 24 keys.
- **IDOI lookup URL changed**: `https://idoi.illinois.gov/consumers/agent-lookup.html`
  now 302-redirects to `https://idoi.illinois.gov/companies/agent-lookup.html`
  (HTTP 200, page "SBS Lookup: How to find an agent in Illinois"). The final URL is
  stored.
- **NAIC CIS** (`content.naic.org/cis_consumer_information.htm`): curl gets a
  Cloudflare 403 challenge; WebFetch loaded it ("Consumer Insurance Search Results -
  CIS", company search with report options). URL kept as in the spec.

## Deliberately different from the spec, and why

1. **Legacy screens keep compiling.** `declarations.ts` re-exports the new 89-field
   `FIELD_DEFS`, so the legacy `src/app/insurance/page.tsx` (to be replaced in §15
   step 5) had `def.group === "limits"`, a type error. Minimal fix: its quote table
   uses an explicit set of the 0041 keys (`LEGACY_COMPARE_KEYS`) and "lower than your
   current coverage" applies to non-deductible money fields. `ResolvedField.suggested`
   is optional (`suggested?: string | null`; `resolveField`/`fromRecord` always set it)
   so the legacy review page's hand-built blanks type-check. Both go when the UI
   step deletes those files.
2. **`fieldsFor(..., "quote")` returns defs rewritten for quotes**: `column` is the
   quote column, `label` the quote label ("Quote number", "Ends"), and
   `required: "policy"` is lifted. `quoteColumn` is unchanged, so code can always save
   to `def.column`.
3. **`PolicyRow` and `StatusInput` live in `fields.ts`** (the spec names `PolicyRow`
   without placing it). `PolicyRow` = `StatusInput` + `carrier_name`, `annual_premium`,
   `included_sections?` and an `unknown` index signature; read other columns with
   `rowText`/`rowBool`.
4. **`fromRecord(row, defs, source)`**: `source` takes any provenance value; a
   `"quote"` source reads each def's `quoteColumn` (so policy-mode defs work for "start
   from a quote"), anything else reads `column`.
5. **Parsers.** `parseMoneyLoose` returns null when another figure follows the first
   ("1,000,000 / 2,000,000", ranges): never guess between figures. `parsePercent`
   refuses finer than a hundredth of a percent (`numeric(6,4)`). `parseFieldValue`
   money is built from the digits (no float), so `99,999,999,999,999.99` is exact.
6. **Coverage check choices** (copy, where the spec had none or a placeholder):
   - Non-statute findings show their Illinois citation only when `legalChecks ===
     "illinois"` (outside Illinois, or for a non-condo, citing the Condo Act would be
     wrong). The citations test runs in Illinois.
   - `CheckInput.quotes?` added (received quotes' coverage, carrier, declined):
     CP-DO-01 needs "a D&O quote from a different carrier", which the spec's input
     didn't carry. Absent = the rule never fires. **`loadCheckInput` must fill it.**
   - DOC-REQ-01 ids are `DOC-REQ-01:{coverage}` (several per run). Dismissal is by
     rule + null policy as specified, so dismissing one dismisses all of them.
   - Missing facts come only from rules that name them (IL-PROP-03, YD-COINS-01,
     IL-FID-03, CP-WB-01, CP-FL-01, CP-EB-01, CP-WC-01), only when the rule's
     other inputs apply (e.g. IL-FID-03 only with a crime line, CP-WB-01 only with a
     master), and none when there are no policies.
   - IL-PROP-04: `ordinance_or_law=false` says "Walkup sees no ordinance or law
     coverage on the policy."; with no building limit, `{required}` reads "the lesser
     of 10% of the building limit or $500,000". IL-DO-02's gap case adds "Walkup's
     records say it doesn't cover: {list}." YD-WH-01 without a building limit drops
     the dollars. YD-PREM-01 without a previous premium says "It is now {x}."
     CP-WC-02, CP-EPLI-01 and CP-COMM-01 got one-sentence details; CP-DO-01 got a
     question. CP-DED-01's `{page}` is omitted (no page data in `CheckInput`).
   - YD-EXP-01 reports only the latest-ending expired policy per coverage.
   - `counts` excludes not-on-file findings from every severity (they're all gaps).
7. **Market verification**: `nameKey` strips suffixes longest-first, one at a time
   ("Acme Insurance Agency, Inc." and "ACME insurance agency" both give "acme").
   The AM Best token test removes the "A.M. Best" name from the text first, or its
   "A" passes as a rating. `marketUserLocation`, `agencyTask`, `insurerTask`,
   `ITEM_GUIDANCE` and step 13 (`finalizeMarketItems`) are in pure
   `market-verify.ts`, not server-only `market.ts`, so tests don't import
   `server-only`; `market.ts` should import (or re-export) them.
8. **Prompts in `read-schema.ts`** (`READ_SYSTEM`, `OUTLINE_PROMPT`, notes,
   `buildDetailPrompt`), so the string tests don't touch server-only code.
   `buildDetailPrompt` takes an optional 4th argument `{ coverage, carrierName,
   policyNumber }` for the header the spec shows. `postProcessRead` takes
   `details: DetailOutcome[]` aligned with the outline, and an optional `readAt`.
   Redactions in snippets count too (an SSN in value and snippet = 2).
9. **`summary-check`** money regex adds `\b` after million/M/K ("$5,000 may" is not
   "$5,000 m"), and trailing commas are trimmed from tokens.
10. **`premiumSchedule`** keeps only installments before `effective_to` (a short
    term has fewer installments). `changePercent` rounds half away from zero, BigInt.
11. **Compare**: identity fields and agent details aren't compared; only start, end
    and payment schedule from the basics. Non-deductible percents other than
    extended replacement read "Different"; extended replacement compares like a
    limit. Premium change is a whole percent ("12"). Section "Premium" first.
12. **Facts form**: "Not sure" for "Is it a condominium?" keeps `true` (the column
    is NOT NULL; the Act is the safer assumption).
13. **Owner summary**: the deductible tip lists water, wind/hail ("2% of the
    building value (at least $10,000)") and per-unit deductibles in parentheses
    after the all-perils figure; `Contact` (`name`, `person_name`, `email`, `phone`)
    is defined there.
14. **Photos PDF test** runs in node with `createImageBitmap`/`OffscreenCanvas`
    stubbed (no jsdom installed; no dependency added). `reencodeImage` reuses
    Foundation's `normaliseImage` instead of a second canvas pipeline.
15. `policyWarnings` (legacy) no longer names Chicago.
16. The shared premium cases are `tests/fixtures/premium-cases.ts` (I1), not `.json`.

## Not in this step (later Insurance steps)

- `insurance-max-duration.test.ts` (needs the pages, §15 step 5).
- The `runInsuranceRead` part of `insurance-read.test.ts` (mocked `runStructured`,
  fake supabase): belongs with `read.ts` (step 3).

## Cross-workstream / later-step notes

- **Insurance step 3 (server libs):** read.ts: `chooseReadMethod` → `joinTextPages(pages,
  outline.policies[i].pages)` for text, `NATIVE_NOTE`/`IMAGE_NOTE`, then
  `postProcessRead(outline, outcomes, { pageCount, method, mode })`;
  `READ_DEADLINE_MS` is exported. Foundation's `runStructured` has no `step` option
  (F2 note): claim once and pass `claim`. market.ts: use `marketInputs`, `queryKey`,
  `agencyTask`/`insurerTask`, `marketUserLocation`, `verifyAgency`/`verifyInsurer`
  (`where` = the association's state and name), then `finalizeMarketItems`.
  queries.ts `loadCheckInput` should set `CheckInput.quotes`.
- **Insurance step 4 (actions):** `QuoteRequestPayloadV2` is exported from
  `emails.ts`; `request-actions.ts` should import it (re-export the type if wanted).
  Facts: `parseFactsInput(Object.fromEntries(...))` with `declaration_required_lines`
  from `getAll`.
- **Repairs (R-5):** `deductibleHint(ticket, master)` takes `ticket = { trade,
  emergency_kind, actual_cost, estimated_cost, has_claim }` (money `::text`) and
  `master = { id, property_deductible, water_damage_deductible }` (from `inForce()`);
  returns `{ kind, deductible, policyId, text }` or null. R-3: `CITATIONS.ICPA_12_I_COI`.
- **Integration (I-9):** `src/lib/documents/pipeline.ts` still imports `FIELD_DEFS`
  from `declarations.ts`; it now gets the 89 v2 fields.

## Commands run

- `curl` (browser UA) for the two ilga.gov pages, the IDOI lookup and its redirect;
  WebFetch for NAIC CIS; a Python script checked the 23 quotes: all OK.
- `npx tsc --noEmit`: first run 4 errors in the legacy insurance pages (deviation 1),
  fixed; every later run clean (whole project).
- `npx eslint src/lib/insurance src/app/insurance/page.tsx tests/unit/insurance-*.test.ts tests/fixtures/insurance-jpegs.ts`: clean.
- `npx vitest run tests/unit/insurance-*.test.ts`: along the way, failures in my own
  tests fixed (a float assertion, coverage-check scenarios that left implied section
  values, an over-adversarial AM Best fixture, nameKey order, redaction count);
  final 17 files, 267 passed.
- `npx vitest run tests/db/insurance-v2.test.ts tests/db/insurance.test.ts`: 2 files,
  135 passed, 0 skipped (I1's `fields-match-sql` against `FIELD_DEFS` and `premium
  advance matches premiumSchedule` now run and pass).
- `npx vitest run tests/unit`: 79 files, 910 passed.
