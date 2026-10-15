// The plain-English policy summary's input and its guard (insurance-spec
// §7.2). The model sees only "label: value" lines for the policy's recorded
// fields, never the policy number, names, address or the agent's details,
// and its draft is rejected unless every figure and date in it appears in
// that input. Pure.

import { coverageLabel } from "./coverage";
import { PAYMENT_SCHEDULES, optionLabel, type FieldDef, type PolicyRow } from "./fields";
import { longDate } from "./format";
import { displayValue } from "./status";

/** The model's instructions for the plain-English policy summary (§7.2). */
export const SUMMARY_SYSTEM = `You explain one insurance policy to volunteer condo board members in plain English. You receive only the policy's recorded fields as "label: value" lines.

Write 3 to 6 short sentences, no headings, no lists, no em dashes:
- what kind of policy it is, who it is with, and the policy period;
- the main limits;
- the deductibles, especially any an owner might be charged;
- for a master policy with a coverage form, one sentence on what that means for unit owners;
- anything notable that is stated (a separate water deductible, a percentage wind or hail deductible, equipment breakdown included).

Use only figures that appear in the input, written exactly as given, for example $1,000,000, never $1 million. Do not add coverage that is not listed. Do not say whether the coverage is enough, do not recommend changes, do not compare to other policies or prices, and do not give legal advice. Never use the words should, recommend, best, cheaper or advice. For the unit-owner sentence, say what the master policy covers inside units, not what owners ought to buy.`;

/** The retry's extra paragraph after checkSummary rejected the first draft (§7.2). */
export function summaryRetryNote(reasons: string[]): string {
  return `Your previous summary was rejected because: ${reasons.join("; ")}. Write it again without those problems.`;
}

/** Fields that identify or reach someone; not needed to explain coverage. */
const EXCLUDED = new Set([
  "policy_type", "carrier_name", "policy_number", "named_insured", "insured_address", "effective_on", "expires_on",
  "payment_schedule", "claims_phone", "agency_name", "agent_name", "agent_phone", "agent_email",
]);

/**
 * The model input: the coverage type, insurer, period and payment schedule,
 * then "label: formatted value" for every non-null field in `defs` (the
 * policy's sections), then endorsement titles.
 */
export function summaryFacts(policy: PolicyRow, defs: FieldDef[]): string[] {
  const lines = [
    `Kind of policy: ${coverageLabel(policy.coverage)}`,
    `Insurer: ${policy.carrier_name}`,
    `Policy period: ${longDate(policy.effective_from)} to ${longDate(policy.effective_to)}`,
  ];
  const schedule = typeof policy.payment_schedule === "string" ? policy.payment_schedule : null;
  if (schedule && schedule !== "unknown") lines.push(`Paid: ${optionLabel(PAYMENT_SCHEDULES, schedule)}`);
  for (const def of defs) {
    if (EXCLUDED.has(def.key) || def.group === "agent") continue;
    const v = displayValue(def, policy);
    if (v !== null) lines.push(`${def.label}: ${v}`);
  }
  const endorsements = Array.isArray(policy.endorsements) ? (policy.endorsements as { title?: unknown }[]) : [];
  const titles = endorsements.map((e) => (typeof e?.title === "string" ? e.title.trim() : "")).filter(Boolean);
  if (titles.length) lines.push(`Endorsements: ${titles.join("; ")}`);
  return lines;
}

const MONEY_RE = /\$\s?[\d,]+(\.\d{2})?(\s?(million|M|K)\b)?/gi;
const PERCENT_RE = /\d+(?:\.\d+)?\s?%/g;
const MONTH = "(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)";
const DATE_RES = [
  new RegExp(`\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`, "g"),
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
  /\b\d{4}-\d{2}-\d{2}\b/g,
];
const BANNED = [
  { re: /\brecommend/i, word: "recommend" },
  { re: /\bshould/i, word: "should" },
  { re: /\bbest\b/i, word: "best" },
  { re: /\bcheaper\b/i, word: "cheaper" },
  { re: /\badvice\b/i, word: "advice" },
];

/**
 * Rejects a summary over 1,200 characters or with an em dash; any money,
 * percent or date token that isn't verbatim in the input; and the words
 * recommend, should, best, cheaper and advice. Reasons are plain sentences
 * the retry prompt can quote.
 */
export function checkSummary(summary: string, facts: string[]): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  const text = String(summary ?? "");
  const haystack = facts.join("\n");
  if (text.length > 1200) reasons.push("it is longer than 1,200 characters");
  if (text.includes("—")) reasons.push("it used an em dash");

  const seen = new Set<string>();
  const notIn = (token: string) => {
    const t = token.trim().replace(/,+$/, ""); // "$5,000, and" ends at the figure
    if (seen.has(t) || haystack.includes(t)) return;
    seen.add(t);
    reasons.push(`it wrote ${t}, which is not in the input`);
  };
  for (const m of text.matchAll(MONEY_RE)) notIn(m[0]);
  for (const m of text.matchAll(PERCENT_RE)) notIn(m[0]);
  for (const re of DATE_RES) for (const m of text.matchAll(re)) notIn(m[0]);

  for (const b of BANNED) if (b.re.test(text)) reasons.push(`it used the word ${b.word}`);
  return reasons.length ? { ok: false, reasons } : { ok: true };
}
