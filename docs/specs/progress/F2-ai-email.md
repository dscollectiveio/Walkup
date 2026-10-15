# F2-ai-email: src/lib/ai, email draft kit, dates, shared AI components

Step owner: Foundation. Date: 2026-10-14. No git commands run; no migrations
touched or applied; no dependencies added; no dev server started or stopped.
Upload code (foundation-spec §6) untouched (F3's).

## Built

| File | What |
|---|---|
| `src/lib/ai/kinds.ts` | **New, pure** (see deviation 1): `AiKind` (10 kinds incl. `coi_read`), `AI_KINDS`, `AI_DAILY_LIMITS` (= SQL: 20/20/6/40 insurance, `coi_read` 25, rest as §4.3), `AI_PERSON_TRIAGE_LIMIT`, `AI_KIND_LABEL`, `AI_KIND_UNIT`, `remainingLine(kind, left)` ("3 web searches left today" / at-zero copy, §10.3). |
| `src/lib/ai/client.ts` | §4.1 verbatim: `AI_MODEL`, `AI_FALLBACK_BETA`, `AI_STRUCTURED_BETA`, `AiNotConfiguredError`, `aiConfigured`, `fallbacksEnabled`, `placesConfigured`, `anthropic()`, `baseParams()` (`betas` typed `AnthropicBeta[]`). |
| `src/lib/ai/errors.ts` | `AiErrorCode`, `AiQuotaScope`, `AiQuotaError`, `AiFailure`, `aiFailure` (all §10.2 copy, kind-specific bad_request/too_long/quota), `COUNTED_FAILURES`, `classifyAiError`, `describeParseError`. |
| `src/lib/ai/usage.ts` | Re-exports kinds.ts; `Supabase`, `AiClaim`, `AiUsageRecord`, `claimAiCall`, `finishAiCall`, `logAiFollowup`, `logAiCall`, `assertAiQuota`, `aiUsageToday`, `usageFromMessages`. |
| `src/lib/ai/internal.ts` | `finalText`, `callStructured`, `runStructuredUnmetered`. |
| `src/lib/ai/structured.ts` | `RunStructuredOptions`, `AiSuccess`, `runStructured`, `assertClaimMatches`. |
| `src/lib/ai/native-input.ts` | Pure: constants, `base64DecodedBytes`, `nativeInputProblem`. |
| `src/lib/ai/verify.ts` | Pure: every §4.5 function (`normaliseUrl`, `normaliseUrlExact`, `hostOf`, `AGGREGATOR_HOSTS`, `isAggregatorHost`, `hostInSearch`, `verifyWebsite`, `appearsInCitations`, `normaliseBusinessName`, `nameAppears`, `verifyRating`, `lintMarketingCopy`, `verifyClaims`, `scrubWebTask`, `collectEvidence`, `citationsFor`, `verifyItems`) plus helpers `phoneDigits`, `phonesIn`, `normaliseText`. |
| `src/lib/ai/redaction.ts` | `loadRedactionTerms` (§4.5) and pure `nameTerms`. |
| `src/lib/ai/web-research.ts` | `webResearch` per §4.6 steps 1-15, `echoable`, `ResearchResult`, `WebResearchOptions`, constants; re-exports verify.ts and `loadRedactionTerms`. |
| `src/lib/ai/draft.ts` / `draft-check.ts` | `DRAFT_EMAIL_SCHEMA`, `draftEmail`, `draftUserMessage`, `finishDraftText`; pure `stripUnknownLinks`, `checkDraftAgainstFacts`, `haystackOf`, `DraftFacts`, `DraftCheckContext`. |
| `src/lib/ai/jobs.ts` | `AI_JOB_SECONDS`, `AI_STALE_AFTER_SECONDS`, `aiRunStatus`, `claimAiRun`, `finishAiRun`. |
| `src/lib/ai/prompts.ts` | `RESEARCH_SYSTEM`, `STRUCTURE_SYSTEM`, `DRAFT_SYSTEM`, `HONESTY_RULES` (verbatim §4.9), `researchUserMessage`, `structureUserMessage`. |
| `src/lib/email/mailto.ts` | §7.1 in full plus `composeHref(app, ...)` and `MAIL_APPS`. |
| `src/components/email/draft-email.tsx` | `DraftEmail` per §7.2 with §17 props `cc`, `bcc`, `onChange`, `onOpenMailApp` (called by every open path incl. copy-and-open), `title`, `note`, `attachments` (via existing `getDownloadUrl`), `warnings`, `onSave`. Remembered app via `useSyncExternalStore` over localStorage (try/catch, in-memory fallback). Blank highlighting via a mirrored layer; read-only uses `<mark>`. Mobile sticky bar with "More". |
| `src/components/email/draft-email-state.ts` | Pure: `primaryState`, `nextPromptState`, `parseMailApp`, `otherApps`, `otherAppLabel`, `blanksMessage`, `invalidMessage`, `draftChanged`, `blankSegments`, `DRAFT_COPY`. |
| `src/components/ai/ai-status-note.tsx` | `AiStatusNote` (§10.1) + exported `statusNoteStyle`. |
| `src/components/ai/poll-while-running.tsx` / `poll-state.ts` | `PollWhileRunning` (§5.4) + pure `pollPhase`, `elapsedSeconds`, `formatElapsed`, `POLL_COPY`. |
| `src/components/ai/found-on-web.tsx` | `FoundOnWeb` (§10.4) + pure `foundOnWebLines`. |
| `src/components/ai/ai-written.tsx` | `AiWritten` (§10.5) + pure `aiWrittenText`. |
| `src/lib/dates.ts` | Added `buildingTodayIso`, `longDate` (§8). Existing functions unchanged. |
| §7.4 replacements | `src/lib/tax/accountant-email.ts` (local `mailtoHref` replaced by a re-export), `src/app/tax/page.tsx` (`mailtoMany` removed), `src/app/dues/needs-you.tsx`, `src/app/delinquency/reminder-letter-button.tsx`, `src/app/financial-statements/report.ts`. No copy changes. |
| `.env.local.example` | `WALKUP_AI_DISABLED`, `WALKUP_AI_FALLBACKS` under the Anthropic line. |

Tests (all new unless noted): `tests/unit/ai-verify.test.ts` (39), `ai-structured.test.ts` (12),
`ai-web-research.test.ts` (10), `ai-usage.test.ts`, `ai-errors.test.ts`, `ai-jobs.test.ts`,
`ai-internal-imports.test.ts`, `ai-max-duration.test.ts`, `ai-draft.test.ts`, `ai-draft-check.test.ts`,
`ai-redaction.test.ts`, `ai-components.test.ts`, `email-mailto.test.ts`, `native-input.test.ts`,
`draft-email-state.test.ts`, `poll-state.test.ts`; `dates.test.ts` (additions). The SDK is mocked
throughout (`vi.mock("@/lib/ai/client")` keeping the real `baseParams`/`aiConfigured`, fake
`beta.messages.create`); no test calls the API.

SDK names verified against `node_modules/@anthropic-ai/sdk` 0.115.0: `betaZodOutputFormat`
(`helpers/beta/zod`), `BetaMessage`, `BetaContentBlock`, `BetaContentBlockParam`, `BetaMessageParam`,
`BetaUserLocation`, `BetaWebSearchTool20260209`, `AnthropicBeta` (`resources/beta/beta`),
`usage.iterations` entry types (`fallback_message`), `stop_details.category`, `container`, and the
error classes on `Anthropic.*`. `tsc` passes.

## Deliberate differences from the spec, and why

1. **`src/lib/ai/kinds.ts` (pure) holds the kind constants; `usage.ts` re-exports them.** errors.ts
   needs the labels at runtime and usage.ts needs `aiFailure`, so this avoids a runtime import cycle,
   and lets client UI show "3 web searches left today" without importing a server-only module. All
   contract names still resolve from `@/lib/ai/usage`.
2. **`callStructured` parses with `JSON.parse` + `opts.schema.parse`, not `format.parse`.** The SDK
   helper's `parse()` wraps zod failures in an `AnthropicError` whose message embeds zod's messages, so
   `describeParseError` would see `AnthropicError` instead of `ZodError fields.0.value:invalid_type`
   (the §12.2 expectation). The schema is still produced by `betaZodOutputFormat`; only `{ type, schema }`
   is sent.
3. **Pre-claimed runs that never call the model are closed as `not_started`.** When `runStructured` /
   `webResearch` get `opts.claim` and then bail before any call (not configured, or
   `nativeInputProblem`), the claim is finished with `error_code: "not_started"` instead of being left
   `in_flight` for 330 s. Without a pre-claim, behaviour is exactly §4.4 (no claim, no row).
4. **`aiFailure(code, kind, quota)` also accepts a bare number** as the building limit, because
   repairs-spec §9 calls `aiFailure("quota", "contractor_search", limit)`. Without a limit, the kind's
   `AI_DAILY_LIMITS` value is used. Superset of the contract.
5. **`scrubWebTask` unit-reference rule tightened.** The spec's regex
   (`\b(?:unit|...)\s*#?\s*[a-z0-9-]{1,6}\b`) also matches "units" and "unit count", which would scrub
   the unit count decision 4 explicitly allows. The token after unit/apt/suite must now be separated by
   whitespace or `#` and contain a digit (or be a single letter). Spec cases (`Unit 2B`, `apt 3`, `#4`)
   still go; "12 units", "6-unit building" stay (tested). The dollar regex gained a trailing `\b` so
   "$5 more" doesn't eat the "m".
6. **`lintMarketingCopy` ignores "AM Best" / "A.M. Best"** (the rating agency), so an insurer field
   naming it isn't nulled for "best". `#1` is matched without a word boundary before `#`.
7. **`appearsInCitations` email mode treats a sentence-ending full stop as a boundary** ("write to
   bob@acme.com.").
8. **`verifyWebsite` / `VerifyContext` carry an optional `urlSpelling` map** (normalised -> the
   search's spelling), filled by `verifyItems`, so "keep the search's own spelling" is possible with the
   contract's `Set` inputs. Without it, the given URL is returned trimmed.
9. **`aiRunStatus("running", null)` returns `stalled`** (a running row with no start time can't be
   trusted); `pollPhase` likewise treats a missing `startedAt` as past the deadline. Nothing can spin.
10. **`checkDraftAgainstFacts` name warnings skip greeting/sentence openers** ("Hi", "Dear", "Thank",
    "Please", "We", ...) at the start of a capitalised run, so "Hi Pat" isn't warned when "Pat" is the
    recipient. Overlaps between money/date/phone/number matches are resolved by priority in one pass
    (a passing money or date match claims its span, so its digits aren't re-flagged as a number).
11. **`webResearch` ok rows carry a note code**: `timeout` for a deadline-partial run, `incomplete` for
    a pause-cap partial, `too_long` for a research turn that hit max_tokens (all `ok: true`, as
    `finish_ai_call` allows).
12. **`PollWhileRunning` indeterminate bar** uses a React 19 hoisted `<style href precedence>` with its
    own keyframes and a `prefers-reduced-motion` rule (there is no moving-bar keyframe in globals.css,
    which isn't foundation-owned).
13. **`FoundOnWeb` / `AiStatusNote` are client components** (`"use client"`) because they take
    function props (`onSearchAgain`, `onRetry`); both render fine from server components when those
    props are omitted. `FoundOnWeb` takes an optional `now` and otherwise uses its mount time (React
    purity lint forbids `Date.now()` in render).
14. **`DraftEmail` long drafts:** other-app buttons follow the same rule as the primary (copy-and-open
    when too long, labelled "Copy and open in Gmail"). After "Mark as sent" the status region shows the
    sent line instead of a duplicate status message.
15. **`draftUserMessage`** strips `<facts>`/`</facts>` from fact values so a fact can't close the block;
    booleans render "yes"/"no", empty arrays "none".

## Left undone

- §2.8 / 12.3 #11 manual check (open Gmail and Outlook.com links with a Bcc and two paragraphs) and
  12.3 #9 (`scripts/ai-smoke.ts` against the real API) need a browser and a key: lead engineer.
- §9 privacy page is not in this step (F3's note covers it).
- `classify.ts` untouched (brief decision 11).

## Cross-workstream notes

- **Insurance:** insurance-spec §7 assumes `runStructured` takes `step: "main" | "followup"`. Per
  foundation-spec §1.3 there is no `step` option; a multi-call read should claim once with
  `claimAiCall` and pass `claim` to the first `runStructured`. Follow-up calls inside one read are not
  available to area code (only `webResearch` gets `runStructuredUnmetered`). If Insurance needs several
  model calls per read under one quota unit, ask the lead for a metered `runStructuredFollowup(parent)`
  in `structured.ts`.
- **All areas:** pages that host AI actions must add their path to `PAGES` in
  `tests/unit/ai-max-duration.test.ts` along with `export const maxDuration = 300;`.
- **All areas:** use `remainingLine(kind, limit - used)` from `@/lib/ai/kinds` (client-safe) or
  `@/lib/ai/usage` for the "{n} web searches left today" line.
- **Repairs:** `aiFailure("quota", "contractor_search", limit)` works as written in repairs-spec.

## Commands run

- `npx tsc --noEmit` (several times while building; final): exit 0, no errors in the whole project.
- `npx eslint src/lib/ai src/lib/email src/components/ai src/components/email src/lib/dates.ts src/app/tax/page.tsx src/app/dues/needs-you.tsx src/app/delinquency/reminder-letter-button.tsx src/app/financial-statements/report.ts src/lib/tax/accountant-email.ts tests/unit/ai-*.ts tests/unit/email-mailto.test.ts tests/unit/native-input.test.ts tests/unit/dates.test.ts tests/unit/draft-email-state.test.ts tests/unit/poll-state.test.ts`: clean (exit 0). Two lint findings fixed on the way (`window.location.href =` -> `assign`; `Date.now()` in render).
- `npx vitest run tests/unit/ai-verify.test.ts`: first run 1 failure (email followed by a full stop), fixed (deviation 7); 39 passed.
- `npx vitest run tests/unit/ai-errors.test.ts tests/unit/ai-usage.test.ts`: first run 2 failures in my test fixtures (APIError with a `{}` body ignores the message), fixtures fixed; all passed.
- `npx vitest run tests/unit` (final): 63 files, 651 tests passed (includes the untouched `tax-accountant-email.test.ts`, `home-snapshot`, `setup-guide` and F3's unit tests).
- DB tests not re-run: no migration or SQL changed in this step.
