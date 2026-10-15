import "server-only";
import { z } from "zod";
import { aiConfigured } from "@/lib/ai/client";
import { runStructured } from "@/lib/ai/structured";
import {
  DRAFT_SYSTEM, checkModelDraft, draftUserMessage, fillPlaceholders, requiredPlaceholders, templateDraft,
  type DraftFactsByKind, type EmailKind, type TemplateValues,
} from "./emails";
import type { Supabase } from "./queries";

/**
 * Insurance emails (insurance-spec §7.4, §8.5). The model writes the prose
 * with placeholders from facts that hold no names, digits, dates or amounts;
 * code checks the draft (checkModelDraft) and fills the placeholders with the
 * real values, which never reach the model. Any failure falls back to the
 * deterministic template, so a draft is always produced. Nothing is sent.
 */

export type DraftFacts = DraftFactsByKind[EmailKind];

export const DRAFT_NOTICE = {
  template: "Written from Walkup's template.",
  quota: "Walkup has drafted as many emails as it can today, so this one uses the template.",
} as const;

const DraftSchema = z.object({ subject: z.string(), body: z.string() });

export async function draftEmail(opts: {
  supabase: Supabase;
  associationId: string;
  kind: EmailKind;
  facts: DraftFacts;                 // what the model sees (stored in facts_json)
  values: TemplateValues;            // placeholder values, never sent to the model
}): Promise<{ subject: string; body: string; draftedBy: "model" | "template"; notice?: string }> {
  const values: TemplateValues = { ...opts.values, agent_name: opts.values.agent_name?.trim() || "there" };
  const template = (notice: string) => ({ ...templateDraft(opts.kind, values), draftedBy: "template" as const, notice });

  if (!aiConfigured()) return template(DRAFT_NOTICE.template);

  const required = requiredPlaceholders(opts.kind, opts.facts as { renewalKnown?: boolean });
  const r = await runStructured({
    kind: "insurance_draft",
    supabase: opts.supabase,
    associationId: opts.associationId,
    system: DRAFT_SYSTEM,
    content: draftUserMessage(opts.kind, required, opts.facts),
    schema: DraftSchema,
    effort: "low",
    maxTokens: 1_500,
    timeoutMs: 45_000,
  });
  if (!r.ok) return template(r.code === "quota" ? DRAFT_NOTICE.quota : DRAFT_NOTICE.template);

  const draft = { subject: r.data.subject.replace(/\s+/g, " ").trim(), body: r.data.body.replace(/\r\n/g, "\n").trim() };
  if (!checkModelDraft(draft, required).ok) return template(DRAFT_NOTICE.template);

  return {
    subject: fillPlaceholders(draft.subject, values).replace(/\s+/g, " ").trim(),
    body: fillPlaceholders(draft.body, values),
    draftedBy: "model",
  };
}
