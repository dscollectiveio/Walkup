# Insurance & Repairs overhaul: master brief

Doug, 2026-10-14: "a complete overhaul of how the insurance marketplace and the
repairs and upkeep sections work … bypass anything that requires my input but
try to do everything." This brief records the decisions taken on his behalf,
the scope, and the contracts the build follows. Detailed per-area specs are
`docs/specs/insurance-spec.md` and `docs/specs/repairs-spec.md`; they elaborate
this brief and may not contradict it.

The code map that informed this brief (current schema, flows and bugs) was
produced by reading the codebase on 2026-10-14; the key facts are repeated
where they matter.

---

## 1. Decisions taken on Doug's behalf (to become DECISIONS #35)

1. **"Marketplace" is allowed, brokering is still not.** Doug asked for an
   insurance marketplace by name, so the earlier build prompt's ban on the word
   is superseded. DECISIONS #22 "No brokering" still holds in substance:
   Walkup **informs, organises and drafts**; it never places a policy, never
   says "buy X", never quotes a price it was not given, and never presents an
   opinion as advice. Every insurer/agency shown is *found*, with its sources
   linked, not *endorsed*. Copy uses "found", "worth asking about", "commonly
   carried", never "best", "you should", "we recommend you buy".
2. **Coverage check = cited findings, not advice.** Gap detection compares the
   building's facts with its policies and reports *findings*, each with a
   stated **basis**: `statute` (Illinois Condominium Property Act, cited to the
   section and URL, verified against ilga.gov during the build, with a
   `verified_on` date in code), `your_documents` (the declaration's insurance
   article as recorded by the board), `common_practice` (labelled as such,
   phrased as a question for the agent), or `your_data` (e.g. limit below the
   board's own replacement-cost estimate). No statute text from memory: if it
   cannot be verified on the web during the build, the rule ships as
   `common_practice` wording instead.
3. **Prices are never invented.** "Less expensive" is served by: the
   building's own premium history (per-unit cost, year-over-year change), the
   quote-comparison table built from quotes the board actually received, and
   prompts to get more quotes. Web research may surface published facts (e.g.
   an AM Best rating) only when the cited source text contains them.
4. **Web research goes through Anthropic's web search, server-side only.**
   What leaves Walkup: city, state, postal code, unit count, stories, year
   built, construction type, coverage types, trade/job description text
   written by the board or reporter. Never owner names, emails, phone numbers,
   unit numbers, financial figures or policy numbers. The privacy page lists
   Anthropic (it is missing today even though document text already goes
   there).
5. **Anti-fabrication is enforced in code, not just in prompts.** A web-found
   provider/contractor is kept only if its website or source URL is among the
   URLs actually returned by the search tool in that response. A phone number,
   email or rating is kept only if it appears (normalised) in the cited text
   of a citation from that response; otherwise it is dropped and the UI says
   "see their website". Results store their source URLs and `fetched_at`.
6. **Contractor recommendations are allowed and ranked transparently.**
   Ranking shows *why* (trade match, distance, rating with review count,
   your board's history, insured/licensed on file). Rating sorts use a
   review-count-weighted (Bayesian) score so 5.0 from one review does not
   outrank 4.8 from 900. Google Places is used when `GOOGLE_PLACES_KEY` is
   set; Anthropic web search is the fallback and complement (works with only
   `ANTHROPIC_API_KEY`).
7. **Insurance documents may be read natively (PDF/image) by the model when
   they have no text layer.** This is a narrow exception to DECISIONS #25:
   only for documents filed as insurance declarations or quotes, because a
   declarations page carries no personal tax IDs. Every value and snippet the
   model returns is passed through `redactTaxIds()` before storage, so the
   database invariant (#4, #25) still holds. Text-layer PDFs keep the existing
   redact-before-prompt path.
8. **Nothing is sent automatically (#22).** Every email (broker, agent,
   contractor, owner notice) is a draft the board edits, opens in their own
   mail app via `mailto:` (with a copy-to-clipboard fallback for long
   bodies), and marks as sent. Drafts may be written by the model, from
   structured facts only, and are always shown for editing first.
9. **Owners get a real view** instead of empty pages: their own and shared
   tickets with photos, status history, scheduled date and the name of the
   assigned contractor; and a board-published "what the master policy means
   for you" summary (coverage form, master deductible, what an HO-6 should
   cover, agent contact for certificates). Owners still never read `vendors`
   or `insurance_*` tables directly; owner reads go through narrow SECURITY
   DEFINER functions that return only the published fields.
10. **AI usage is metered.** Every model call is logged (`ai_calls`) and
    daily per-association limits are enforced in the database before a call
    is made. Results are cached (market research 30 days, contractor web
    search 7 days, Places 24 h as today).
11. **Model:** new code uses `claude-opus-5-5` with adaptive thinking (the
    default) and an explicit `output_config.effort`, plus the server-side
    refusal fallback (`fallbacks: "default"`, beta
    `server-side-fallback-2026-07-01`) where the SDK supports it on the call
    shape used. Existing `classify.ts` stays as is except where this build
    needs to touch it.

## 2. Scope

### Shared foundation (migration `0051_ai_and_uploads`)
- `src/lib/ai/`: one client factory; `runStructured()` (messages.parse +
  zod, refusal/pause handling, timeout); `webResearch()` (web_search_20260209,
  pause_turn loop, collects search-result URLs and citations, then a second
  structured call that turns the cited research into JSON, then the
  verification pass from decision 5); `logAiCall()` + `assertAiQuota()`.
- `ai_calls` table (association-scoped, board-readable, insert via SECURITY
  DEFINER `record_ai_call`, quota check via SECURITY DEFINER
  `ai_calls_today(kind)`).
- **Direct uploads**: files go browser → Supabase Storage with a signed
  upload URL issued by a server action, then a second action registers the
  `documents` row (re-verifies type from the stored bytes, checksum dedupe,
  size). Removes the 1 MB server-action ceiling for every upload in the app
  that adopts it (insurance import, ticket photos, and the document hub
  uploader). Also set `serverActions.bodySizeLimit` to `4mb` as a safety net.
- Shared email draft kit: `src/lib/email/mailto.ts` (CRLF, length guard) and a
  `DraftEmail` client component (edit, copy, open in mail app, mark sent).
- Shared `src/lib/dates.ts` usage (local `todayIso()`), human dates in UI.
- Privacy page: Anthropic (document reading, drafting, web research) and the
  web-search data list from decision 4.

### Insurance (migration `0052_insurance_v2`) — see insurance-spec.md
- Import: drag-and-drop or pick a declarations/quote PDF or photo; direct
  upload; a dedicated reader that skips the general classifier when the board
  already said it's insurance; text layer → redacted text prompt; no text
  layer → native PDF/image input (decision 7); detects **multiple policies in
  one package** and lets the board save each; progress UI that can't spin
  forever (attempt cap, timeout state, retry).
- Richer policy model: new coverage types (fidelity/crime, equipment
  breakdown, cyber, earthquake, employment practices), percentage deductibles,
  valuation basis, coinsurance, ordinance or law A/B/C, endorsements and
  exclusions lists, premium breakdown; per-coverage relevant fields only.
- Policy lifecycle: edit, renew (prefill from the expiring policy or from an
  accepted quote), archive/delete (admin), transactional save via RPC,
  field provenance shown ("page 2 of your declarations").
- Plain-English policy summary (model-written from extracted fields, stored,
  editable) and an owner summary the board can publish.
- Coverage check (decision 2) with a building-facts form for the extra facts
  it needs (replacement cost estimate and date, flood zone, basement/garden
  units, boiler/elevator, employees, commercial space, manager handles funds,
  declaration's required coverage form).
- Marketplace: insurers and agencies found for this building (decision 3–5),
  saved insurance contacts (the board's own agent plus found ones), quote
  requests to any contact (not only platform partners), manual quote entry and
  quote PDF reading, side-by-side comparison with differences highlighted,
  choose-a-quote → renew flow that keeps the current policy active until the
  new one starts.
- Drafted emails: request quotes, ask about a coverage finding, request a
  certificate of insurance, report a claim, request a change/endorsement.
- Across the app: premium → recurring bill (deduped, linked to the policy,
  next due advanced), budget insurance line vs premium, Home reminders honour
  `renewal_reminder_days`, claims ⇄ tickets both directions, documents linked
  and shown on the policy, tour step, Building Info shows the insurance facts.

### Repairs & upkeep (migration `0053_repairs_v2`) — see repairs-spec.md
- Security fixes first: the cross-association ticket leak and comment
  injection; same-association guards on every repairs FK; reporter/author set
  from the caller (`current_person_id`), not from the client; ticket numbering
  with a per-association advisory lock.
- Tickets: trade/category, location detail, access/availability notes,
  photos at report time (owners too), scheduled visit date, due date, board
  assignee, estimated vs actual cost, expense link, internal (board-only)
  notes, status history timeline (trigger-written events), edit, reopen,
  close-out (final cost, review prompt, resolution note visible to the
  reporter), filters/search/sort, a board pipeline view.
- AI triage on report: suggested trade, urgency and a safety banner for
  emergencies (gas smell, fire, active flooding, no heat in winter, sparking)
  with static "call 911 / your utility" guidance that does not depend on the
  model.
- Bids: request quotes from several contractors per ticket (drafted emails),
  record bids (amount, document), compare, accept → assigns contractor and
  estimate.
- Recommended contractors for a job: saved contractors matching the trade
  first (preferred, insured, licensed, reviews), then Google Places (if key)
  and web research (decision 5–6), each with "why", save, and "ask for a
  quote".
- Contractor directory v2: search, sort, clickable contact, archive, edit and
  delete reviews, a comments/notes log with authors and dates, compliance
  (certificate and license expiring soon), request a W-9 or certificate from
  the profile, write to them, assign to a problem, full job history including
  upkeep and payments; fix the broken Google refresh.
- Expanded trade list (windows, chimney, garage door, concrete, handyman,
  flooring, waterproofing, tree service, engineer, backflow testing, sewer
  rodding, dryer vent, fire safety, gutters, elevator) mapped from the upkeep
  templates so "find someone" works from any task.
- Upkeep: fix `nextDueAfter`/`initialNextDue`, transactional mark-done RPC,
  per-task history, edit/delete log rows, "turn into a problem", calendar
  export (.ics) of upkeep and insurance renewals, overdue items on Home.
- Bills: edit, pause, mark paid (advances next due).
- Owner view per decision 9.

### Foundation API contract (fixed; area specs build on these names)

```ts
// src/lib/ai/client.ts  (server-only)
export const AI_MODEL = "claude-opus-5-5";
export function aiConfigured(): boolean;                 // ANTHROPIC_API_KEY present
export function anthropic(): Anthropic;                  // throws AiNotConfiguredError

// src/lib/ai/usage.ts  (server-only)
export type AiKind =
  | "insurance_read" | "insurance_summary" | "insurance_market" | "insurance_draft"
  | "ticket_triage" | "contractor_search" | "contractor_draft" | "bid_read";
export const AI_DAILY_LIMITS: Record<AiKind, number>;    // per association per day
export async function assertAiQuota(supabase, associationId, kind): Promise<void>; // throws AiQuotaError
export async function logAiCall(supabase, associationId, kind, usage: {model, input_tokens, output_tokens, web_searches?, ok: boolean, error?: string}): Promise<void>;

// src/lib/ai/structured.ts  (server-only)
export async function runStructured<T>(opts: {
  kind: AiKind; supabase; associationId: string;
  system: string; content: Anthropic.MessageParam["content"]; // text, document or image blocks
  schema: z.ZodType<T>; effort?: "low" | "medium" | "high"; maxTokens?: number; timeoutMs?: number;
}): Promise<{ ok: true; data: T } | { ok: false; reason: string; configured: boolean; quota?: boolean }>;

// src/lib/ai/web-research.ts  (server-only)
export interface Citation { url: string; title: string | null; citedText: string }
export interface ResearchResult<T> { items: T[]; sources: { url: string; title: string | null }[]; fetchedAt: string }
export async function webResearch<T extends { sourceUrls: string[] }>(opts: {
  kind: AiKind; supabase; associationId: string;
  task: string;                    // what to find, already free of personal data
  itemSchema: z.ZodType<T>;        // per-item schema; must include sourceUrls
  verify: (item: T, ctx: { searchUrls: Set<string>; citations: Citation[] }) => T | null; // drop or scrub unverifiable fields
  maxSearches?: number; userLocation?: { city?: string; region?: string; country?: string; postal_code?: string };
}): Promise<{ ok: true; result: ResearchResult<T> } | { ok: false; reason: string; configured: boolean; quota?: boolean }>;
export function appearsInCitations(value: string, citations: Citation[], kind: "phone" | "email" | "text"): boolean;
export function normaliseUrl(url: string): string;      // for searchUrls membership checks (host + path, no query/hash, no trailing slash, no www)

// src/lib/email/mailto.ts
export function mailtoHref(to: string | string[], subject: string, body: string): string; // CRLF bodies
export const MAILTO_SAFE_LENGTH: number;                // ~1800; beyond it the UI offers copy instead
// src/components/email/draft-email.tsx  (client)
export function DraftEmail(props: {
  to: string[]; subject: string; body: string; editable?: boolean;
  onMarkSent?: () => Promise<{ ok: true } | { error: string }>; sentAt?: string | null;
}): JSX.Element;

// direct uploads: src/app/documents/upload/actions.ts + src/components/upload/direct-upload.tsx
export async function createUploadTarget(input: { filename: string; size: number; mime: string; purpose: "document" | "ticket_photo"; ticketId?: string }):
  Promise<{ ok: true; path: string; token: string } | { error: string }>;
export async function registerUpload(input: { path: string; filename: string; categorySlug?: string; purpose: "document" | "ticket_photo"; ticketId?: string; title?: string }):
  Promise<{ ok: true; documentId: string; duplicateOf?: string } | { error: string }>;
export function DirectUpload(props: { purpose; categorySlug?; ticketId?; accept?: string; multiple?: boolean; label?: string;
  onUploaded: (docs: { documentId: string; filename: string; duplicateOf?: string }[]) => void }): JSX.Element;
```

Ticket photos: storage path `<association_id>/tickets/<ticket_id>/<ts>-<name>`;
a member who can see the ticket may upload there (storage policy) and
register it through SECURITY DEFINER `attach_ticket_photo(...)` (in 0051),
which inserts a `documents` row (category `maintenance`, visibility pinned to
the ticket's unit or `all_owners` for shared-area tickets) and the
`document_links` row (`tickets`, relation `photo`).

## 3. Ownership boundaries (to avoid edit collisions)

| Workstream | Owns |
|---|---|
| Foundation | `src/lib/ai/**`, `src/lib/email/**`, direct-upload actions/components under `src/app/documents/upload/**`, `supabase/migrations/0051_*`, `next.config.ts` (body size only), `src/app/privacy/page.tsx` |
| Insurance | `src/app/insurance/**`, `src/lib/insurance/**`, `src/app/admin/partners/**`, `supabase/migrations/0052_*`, insurance tests |
| Repairs | `src/app/repairs/**`, `src/app/maintenance/**`, `src/app/contractors/**`, `src/lib/contractors/**`, `src/lib/upkeep/**`, `src/lib/google/**`, `src/app/bills/**`, `supabase/migrations/0053_*`, repairs tests |
| Integration (last) | `src/app/page.tsx`, `src/lib/home/**`, `src/components/home/**`, `src/components/sidebar/**`, `src/lib/tour/**`, `src/app/building/**`, `docs/DECISIONS.md`, `src/lib/documents/**` changes beyond what foundation needs |

A workstream that needs a change in another's files records it in its
report instead of making it.

## 4. Quality bar

- Every new table: `association_id … on delete restrict`, RLS, audit trigger
  (unless a cache/log), same-association guard trigger for every FK to another
  association-scoped table, comment on table. Every SECURITY DEFINER function:
  `set search_path = ''`, revoked from public/anon, granted to authenticated.
  Anything guarded by `session_is_aal2()` must survive the dev DB that lacks
  it (`to_regprocedure` guard) — but RLS helpers already include it, so new
  code should call the helpers, not `session_is_aal2()` directly.
- Numeric columns only `(14,2)`, `(9,6)`, `(6,4)`, `(14,6)`. Money crosses the
  API as text (DECISIONS #20); arithmetic on money in TypeScript goes through
  `src/lib/money`.
- DB tests in `tests/db/` (PGlite harness, `asUser`) for every policy and
  RPC, including the cross-association cases; unit tests for every pure
  function (coverage check rules, ranking, schedule math, verification of
  web results, mailto builder).
- UI: existing tokens and components (`Card`, `Answer`, `Stat`, pill tabs),
  human-readable dates, mobile-first (forms not crammed into card headers),
  empty states that say what to do next, owners never see an empty board
  page pretending there's no data (show `Restricted` or the owner view).
- Copy: plain English, no em dashes in new user-facing copy, "contractor"
  never "vendor", no "best"/"you should buy", disclaimers short and placed
  where the decision is made.
- `npx tsc --noEmit`, `npm run lint`, `npx vitest run` all green. Migrations
  applied to the dev project (`xhrivmdkrcfkhjyhkhye`) only; production waits
  for "General Kenobi". No commits until then.
