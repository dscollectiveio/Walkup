/**
 * What each AI call is for, and how many a building may make a day.
 *
 * Pure and client-safe so UI can say "3 web searches left today" without
 * importing a server-only module; `usage.ts` re-exports everything here, and
 * that is the name area code should use on the server.
 *
 * The limits are mirrored in SQL (`ai_daily_limit()` in 0051), which is
 * where they are enforced. tests/unit/ai-usage.test.ts keeps the two equal.
 */

export type AiKind =
  | "insurance_read" | "insurance_summary" | "insurance_market" | "insurance_draft"
  | "ticket_triage" | "contractor_search" | "contractor_draft" | "bid_read"
  | "coi_read" | "document_classify";

export const AI_KINDS: readonly AiKind[] = [
  "insurance_read", "insurance_summary", "insurance_market", "insurance_draft",
  "ticket_triage", "contractor_search", "contractor_draft", "bid_read",
  "coi_read", "document_classify",
];

/** Per association per day (America/Chicago). Must equal SQL ai_daily_limit() (unit test 12.2). */
export const AI_DAILY_LIMITS: Record<AiKind, number> = {
  insurance_read: 20,
  insurance_summary: 20,
  insurance_market: 6,
  insurance_draft: 40,
  ticket_triage: 60,
  contractor_search: 12,
  contractor_draft: 40,
  bid_read: 25,
  coi_read: 25,
  document_classify: 200,
};

/** Owners' and accountants' own triage cap per day. Must equal SQL ai_person_triage_limit(). */
export const AI_PERSON_TRIAGE_LIMIT = 10;

/** Used in quota messages: "today's limit for {label}". */
export const AI_KIND_LABEL: Record<AiKind, string> = {
  insurance_read: "reading insurance documents",
  insurance_summary: "policy summaries",
  insurance_market: "insurer and agency searches",
  insurance_draft: "insurance email drafts",
  ticket_triage: "problem triage",
  contractor_search: "contractor searches",
  contractor_draft: "contractor email drafts",
  bid_read: "reading contractor quotes",
  coi_read: "reading insurance certificates",
  document_classify: "document filing",
};

/** Countable unit for "{n} {unit} left today". Only the scarce kinds show it (10.3). */
export const AI_KIND_UNIT: Partial<Record<AiKind, [singular: string, plural: string]>> = {
  insurance_market: ["web search", "web searches"],
  contractor_search: ["web search", "web searches"],
};

/** "3 web searches left today" / "1 web search left today" / the at-zero line. Null for kinds without a unit. */
export function remainingLine(kind: AiKind, left: number): string | null {
  const unit = AI_KIND_UNIT[kind];
  if (!unit) return null;
  const n = Math.max(0, Math.floor(left));
  if (n === 0) return `No ${unit[1]} left today. They reset at midnight.`;
  return `${n} ${n === 1 ? unit[0] : unit[1]} left today`;
}
