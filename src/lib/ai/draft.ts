import "server-only";
import { z } from "zod";
import { redactTaxIds } from "@/lib/documents/redact";
import type { AiFailure } from "./errors";
import { checkDraftAgainstFacts, stripUnknownLinks, type DraftCheckContext, type DraftFacts } from "./draft-check";
import { DRAFT_SYSTEM } from "./prompts";
import { runStructured } from "./structured";
import type { Supabase } from "./usage";

/**
 * Model-written email drafts from structured facts only (brief decision 8).
 * The draft is shown in DraftEmail for the board to edit; nothing is sent.
 * Every draft passes through the code checks in draft-check.ts on the way
 * out, so a figure, date or link the facts didn't contain shows as a blank.
 */

export type { DraftFacts } from "./draft-check";

export const DRAFT_EMAIL_SCHEMA = z.object({
  subject: z.string().describe("Subject line, under 80 characters."),
  body: z.string().describe("Plain-text email body with blank lines between paragraphs, under 1,500 characters, ending with the sign-off exactly as given."),
});

/** Keeps a fact from closing the <facts> block early. */
function inert(text: string): string {
  return text.replace(/<\s*\/?\s*facts\s*>/gi, "");
}

function factValue(v: DraftFacts[string]): string {
  if (v === null || v === undefined) return "not known";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.length ? v.join("; ") : "none";
  return v.trim() ? v : "not known";
}

/** The user message: everything inside <facts> tags so the prompt's injection rule can name them. */
export function draftUserMessage(opts: {
  purpose: string; facts: DraftFacts; recipientName?: string | null; signOff: string;
}): string {
  const lines = [
    "<facts>",
    `Purpose of the email: ${inert(opts.purpose)}`,
    `Recipient: ${opts.recipientName?.trim() ? inert(opts.recipientName.trim()) : "not known"}`,
    "Facts:",
    ...Object.entries(opts.facts).map(([label, value]) => `- ${inert(label)}: ${inert(factValue(value))}`),
    "Sign-off (end the email with this exactly):",
    inert(opts.signOff),
    "</facts>",
  ];
  return lines.join("\n");
}

/** Post-processing on success, in order: tax IDs, dashes, unknown links, fact check, trim. */
export function finishDraftText(text: string, ctx: DraftCheckContext): { text: string; warnings: string[] } {
  let t = redactTaxIds(text).text;
  t = t.replace(/\s*[—–]\s*/g, " - ");
  t = stripUnknownLinks(t, ctx);
  const checked = checkDraftAgainstFacts(t, ctx);
  return { text: checked.text.trim(), warnings: checked.warnings };
}

export async function draftEmail(opts: {
  kind: "insurance_draft" | "contractor_draft";
  supabase: Supabase;
  associationId: string;
  purpose: string;                               // one sentence: what the email is for
  facts: DraftFacts;                             // labelled structured facts only; include boardDecision only when the board decided something
  recipientName?: string | null;                 // "Pat" or "the team at Acme Plumbing"
  signOff: string;                               // e.g. "Doug Smart\nTreasurer, 2158 N. Damen Condominium Association"
  timeoutMs?: number;                            // default 60_000
}): Promise<{ ok: true; subject: string; body: string; warnings: string[] } | AiFailure> {
  const r = await runStructured({
    kind: opts.kind,
    supabase: opts.supabase,
    associationId: opts.associationId,
    system: DRAFT_SYSTEM,
    content: draftUserMessage(opts),
    schema: DRAFT_EMAIL_SCHEMA,
    effort: "low",
    maxTokens: 4_000,
    timeoutMs: opts.timeoutMs ?? 60_000,
  });
  if (!r.ok) return r;

  const ctx: DraftCheckContext = {
    facts: opts.facts,
    signOff: opts.signOff,
    recipientName: opts.recipientName,
    purpose: opts.purpose,
  };
  const subject = finishDraftText(r.data.subject.replace(/\s+/g, " "), ctx);
  const body = finishDraftText(r.data.body, ctx);
  return {
    ok: true,
    subject: subject.text.slice(0, 120).trim(),
    body: body.text,
    warnings: [...new Set([...subject.warnings, ...body.warnings])],
  };
}
