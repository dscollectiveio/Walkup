"use server";

import { after } from "next/server";
import { aiConfigured } from "@/lib/ai/client";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/dates";
import { isCoverageType, type CoverageType, type SectionKey } from "@/lib/insurance/coverage";
import { runCoverageCheck } from "@/lib/insurance/coverage-check";
import { parseFieldValue } from "@/lib/insurance/declarations";
import { findDuplicatePolicy, type DuplicateCandidate } from "@/lib/insurance/duplicates";
import { friendlyDbError } from "@/lib/insurance/errors";
import { FIELD_BY_KEY, FIELD_DEFS, type Endorsement, type Exclusion, type PremiumLine } from "@/lib/insurance/fields";
import { upsertAgentContact } from "@/lib/insurance/contacts";
import { loadCheckInput, loadPolicy } from "@/lib/insurance/queries";
import {
  fieldErrorText, parseLists, premiumBillOption, prepareFieldValues, type FieldMeta, type SourceEntry,
} from "@/lib/insurance/save-input";
import { premiumSchedule } from "@/lib/insurance/premium";
import { writePolicySummary } from "@/lib/insurance/summary";
import { actionContext, isIsoDate, isUuid, revalidateInsurance } from "./action-helpers";

/**
 * Policies (insurance-spec §8.2, §8.2a). Every save goes through
 * save_insurance_policy, one transaction that is idempotent per read item
 * and per form (client_token). Provenance is sent as a source per field;
 * the RPC rebuilds page, snippet and confidence from the stored read.
 */

export type { FieldMeta } from "@/lib/insurance/save-input";

const BOARD_ONLY = "Only a board member can save a policy.";

export interface SavePolicyInput {
  policyId: string | null;
  clientToken: string;
  coverage: CoverageType;
  includedSections: SectionKey[];
  values: Record<string, string | null>;
  meta: Record<string, FieldMeta>;
  clearLegacy: boolean;
  endorsements: Endorsement[];
  exclusions: Exclusion[];
  premiumBreakdown: PremiumLine[];
  renewalReminderDays: number;
  notes: string | null;
  agentContactId: string | null;
  saveAsSeparate?: boolean;
  options: {
    documentId?: string;
    readId?: string;
    readIndex?: number;
    replacesPolicyId?: string | null;
    acceptedQuoteId?: string;
    expectedUpdatedAt?: string;
    trackPremium?: { accountId: string | null } | null;
  };
}

export type SavePolicyResult =
  | { ok: true; policyId: string }
  | { error: string; fieldErrors?: Record<string, string>; alreadySavedId?: string }
  | { duplicateOf: { id: string; carrier: string; savedOn: string } };

function scheduleSummary(policyId: string) {
  const bg = createClient();
  after(async () => {
    try {
      await writePolicySummary(await bg, policyId);
    } catch (e) {
      console.error("policy summary crashed", e instanceof Error ? e.name : "unknown");
    }
    revalidateInsurance(`/insurance/policies/${policyId}`);
  });
}

export async function savePolicy(input: SavePolicyInput): Promise<SavePolicyResult> {
  const ctx = await actionContext(BOARD_ONLY);
  if ("error" in ctx) return ctx;
  const { supabase, association } = ctx;
  if (!isCoverageType(input.coverage)) return { error: "Choose the kind of policy." };
  const policyId = input.policyId && isUuid(input.policyId) ? input.policyId : null;
  if (input.policyId && !policyId) return { error: "That policy was not found." };
  const today = todayIso();

  const days = Number(input.renewalReminderDays);
  if (!Number.isInteger(days) || days < 0 || days > 365) {
    return { error: "The reminder lead time is a number of days from 0 to 365.", fieldErrors: { renewal_reminder_days: "Use a number of days from 0 to 365." } };
  }
  const lists = parseLists(input);
  if (!lists.ok) return { error: lists.error };

  const existing = policyId ? await loadPolicy(supabase, policyId, today) : null;
  if (policyId && !existing) return { error: "That policy was not found." };

  // Steps 1 to 3: parse, require, date order.
  const prepared = prepareFieldValues({
    mode: "policy",
    coverage: input.coverage,
    includedSections: input.includedSections ?? [],
    values: input.values ?? {},
    meta: input.meta ?? {},
    existing,
    clearLegacy: input.clearLegacy === true,
    isEdit: policyId !== null,
  });
  if (!prepared.ok) return { error: prepared.error, fieldErrors: prepared.fieldErrors };
  const { parsed, columns, sources, sections } = prepared;

  // Step 4: "You already have this policy" (new policies only, read or typed).
  if (!policyId && !input.saveAsSeparate) {
    const { data: rows } = await supabase
      .from("insurance_policies")
      .select("id, coverage, carrier_name, effective_from, policy_number, created_at, archived_at")
      .eq("association_id", association.id)
      .is("archived_at", null);
    const dup = findDuplicatePolicy(
      { coverage: input.coverage, carrier_name: parsed.carrier_name ?? "", effective_from: parsed.effective_on ?? "", policy_number: parsed.policy_number ?? null },
      (rows ?? []) as DuplicateCandidate[],
      null,
    );
    if (dup) return { duplicateOf: { id: dup.id, carrier: dup.carrier_name, savedOn: dup.created_at.slice(0, 10) } };
  }

  // Step 6: the agent becomes a contact.
  let agentContactId = input.agentContactId && isUuid(input.agentContactId) ? input.agentContactId : null;
  if (!agentContactId) agentContactId = await upsertAgentContact(supabase, association.id, parsed);

  // Step 5: p_values.
  const pValues: Record<string, unknown> = {
    ...columns,
    included_sections: sections,
    endorsements: lists.endorsements,
    exclusions: lists.exclusions,
    premium_breakdown: lists.premiumBreakdown,
    renewal_reminder_days: days,
    notes: input.notes?.trim() ? input.notes.trim().slice(0, 4000) : null,
    agent_contact_id: agentContactId,
  };

  // Steps 8 and 9: options.
  const o = input.options ?? {};
  const pOptions: Record<string, unknown> = {};
  if (isUuid(o.documentId)) pOptions.document_id = o.documentId;
  if (isUuid(o.readId) && Number.isInteger(o.readIndex) && (o.readIndex as number) >= 0) {
    pOptions.read_id = o.readId;
    pOptions.read_index = o.readIndex;
  }
  if (isUuid(o.replacesPolicyId)) pOptions.replaces_policy_id = o.replacesPolicyId;
  if (isUuid(o.acceptedQuoteId)) pOptions.accepted_quote_id = o.acceptedQuoteId;
  if (policyId && typeof o.expectedUpdatedAt === "string" && o.expectedUpdatedAt) pOptions.expected_updated_at = o.expectedUpdatedAt;
  if (!policyId && isUuid(input.clientToken)) pOptions.client_token = input.clientToken;
  const accountId = o.trackPremium && isUuid(o.trackPremium.accountId) ? o.trackPremium.accountId : null;
  if (o.trackPremium) {
    const bill = premiumBillOption(parsed, accountId, today);
    if (bill) pOptions.premium_bill = bill;
  }

  // Step 10.
  const { data, error } = await supabase.rpc("save_insurance_policy", {
    p_association_id: association.id,
    p_policy_id: policyId,
    p_values: pValues,
    p_sources: sources,
    p_options: pOptions,
  });
  if (error) return friendlyDbError(error, "Walkup couldn't save this policy. Try again.");
  const savedId = data as string;

  // The agent of a policy in force (or about to be) is the current agent.
  const endsOn = parsed.expires_on;
  if (agentContactId && endsOn && endsOn >= today) {
    const { error: agentError } = await supabase.rpc("set_current_insurance_agent", { p_contact_id: agentContactId });
    if (agentError) console.error("set_current_insurance_agent failed", agentError.code);
  }

  // Step 11: a plain-English summary in the background, unless the board wrote one.
  if (aiConfigured() && existing?.summary_source !== "board") scheduleSummary(savedId);

  // Step 12.
  revalidateInsurance(...(o.trackPremium ? ["/bills", "/budget", "/repairs?view=upkeep"] : []));
  return { ok: true, policyId: savedId };
}

export async function archivePolicy(policyId: string, archived: boolean): Promise<{ ok: true } | { error: string }> {
  const ctx = await actionContext(false);
  if ("error" in ctx) return ctx;
  if (!isUuid(policyId)) return { error: "That policy was not found." };
  const { error } = await ctx.supabase.rpc("archive_insurance_policy", { p_policy_id: policyId, p_archived: archived === true });
  if (error) return friendlyDbError(error, "Walkup couldn't archive this policy. Try again.");
  revalidateInsurance("/bills");
  return { ok: true };
}

export async function deletePolicy(policyId: string): Promise<{ ok: true } | { error: string }> {
  const ctx = await actionContext(false);
  if ("error" in ctx) return ctx;
  if (!isUuid(policyId)) return { error: "That policy was not found." };
  const { error } = await ctx.supabase.rpc("delete_insurance_policy", { p_policy_id: policyId });
  if (error) return friendlyDbError(error, "Walkup couldn't delete this policy. Try again.");
  revalidateInsurance("/bills");
  return { ok: true };
}

export async function writeSummaryNow(policyId: string): Promise<{ ok: true; summary: string } | { error: string; configured?: boolean; quota?: boolean }> {
  const ctx = await actionContext("Only a board member can write the summary.");
  if ("error" in ctx) return ctx;
  if (!isUuid(policyId)) return { error: "That policy was not found." };
  const r = await writePolicySummary(ctx.supabase, policyId, { force: true });
  revalidateInsurance(`/insurance/policies/${policyId}`);
  if (r.ok) return { ok: true, summary: r.summary };
  return { error: r.reason, ...(r.configured === false ? { configured: false } : {}), ...(r.quota ? { quota: true } : {}) };
}

export async function saveSummaryText(policyId: string, text: string): Promise<{ ok: true } | { error: string }> {
  const ctx = await actionContext("Only a board member can change the summary.");
  if ("error" in ctx) return ctx;
  if (!isUuid(policyId)) return { error: "That policy was not found." };
  const summary = String(text ?? "").trim();
  if (summary.length > 2000) return { error: "Keep the summary under 2,000 characters." };
  const { data, error } = await ctx.supabase
    .from("insurance_policies")
    .update({
      summary_text: summary || null,
      summary_source: summary ? "board" : null,
      summary_written_at: summary ? new Date().toISOString() : null,
      summary_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", policyId)
    .select("id");
  if (error) return friendlyDbError(error, "Walkup couldn't save the summary. Try again.");
  if (!data || data.length === 0) return { error: "Only a board member can change the summary." };
  revalidateInsurance(`/insurance/policies/${policyId}`);
  return { ok: true };
}

export async function trackPremium(policyId: string, accountId: string): Promise<{ ok: true; billId: string } | { error: string }> {
  const ctx = await actionContext("Only a board member can track a premium.");
  if ("error" in ctx) return ctx;
  if (!isUuid(policyId)) return { error: "That policy was not found." };
  const policy = await loadPolicy(ctx.supabase, policyId);
  if (!policy) return { error: "That policy was not found." };
  const s = premiumSchedule(
    {
      annual_premium: policy.annual_premium,
      payment_schedule: typeof policy.payment_schedule === "string" ? policy.payment_schedule : "unknown",
      effective_from: policy.effective_from,
      effective_to: policy.effective_to,
    },
    todayIso(),
  );
  const { data, error } = await ctx.supabase.rpc("track_insurance_premium", {
    p_policy_id: policyId,
    p_account_id: isUuid(accountId) ? accountId : null,
    p_frequency: s.frequency,
    p_typical_amount: s.perInstallment,
    p_next_due_on: s.nextDueOn,
  });
  if (error) return friendlyDbError(error, "Walkup couldn't add the premium to your bills. Try again.");
  revalidateInsurance("/bills", "/budget", "/repairs?view=upkeep");
  return { ok: true, billId: data as string };
}

export async function recordAgentAnswer(input: {
  policyId: string;
  findingRuleId: string;
  answers: Record<string, string | null>;
  answeredOn: string;
  attachmentDocumentId: string | null;
  expectedUpdatedAt: string;
}): Promise<{ ok: true } | { error: string; fieldErrors?: Record<string, string> }> {
  const ctx = await actionContext("Only a board member can record the agent's answer.");
  if ("error" in ctx) return ctx;
  const { supabase, association } = ctx;
  if (!isUuid(input.policyId)) return { error: "That policy was not found." };
  const today = todayIso();
  if (!isIsoDate(input.answeredOn) || input.answeredOn > today) {
    return { error: "Enter the date your agent answered.", fieldErrors: { answered_on: "Enter the date your agent answered." } };
  }
  const attachment = input.attachmentDocumentId && isUuid(input.attachmentDocumentId) ? input.attachmentDocumentId : null;

  // 1. Only the fields this finding asks about.
  const check = runCoverageCheck(await loadCheckInput(supabase, association, today));
  const finding = check.findings.find(
    (f) => f.ruleId === input.findingRuleId && (f.policyId === null || f.policyId === input.policyId),
  );
  if (!finding) return { error: "That finding no longer applies. Reload to see the current check." };
  const allowed = new Set(finding.answerableFields);
  const keys = Object.keys(input.answers ?? {});
  if (keys.some((k) => !allowed.has(k))) return { error: "That isn't one of the things this finding asks about." };

  // 2. Parse; blanks are skipped, not cleared.
  const values: Record<string, unknown> = {};
  const answered: SourceEntry[] = [];
  const fieldErrors: Record<string, string> = {};
  for (const key of keys) {
    const raw = String(input.answers[key] ?? "").trim();
    if (raw === "") continue;
    const def = FIELD_BY_KEY.get(key);
    if (!def) return { error: "That isn't one of the things this finding asks about." };
    const v = parseFieldValue(def, raw);
    if (v === null) {
      fieldErrors[key] = fieldErrorText(def, raw);
      continue;
    }
    values[def.column] = def.kind === "boolean" ? v === "true" : v;
    answered.push({
      field_name: key,
      source: "agent_confirmed",
      confirmed_on: input.answeredOn,
      ...(attachment ? { document_id: attachment } : {}),
    });
  }
  const errKeys = Object.keys(fieldErrors);
  if (errKeys.length) return { error: fieldErrors[errKeys[0]], fieldErrors };
  if (answered.length === 0) return { error: "Enter at least one answer." };

  // 3. Everything else keeps its provenance.
  const answeredKeys = new Set(answered.map((a) => a.field_name));
  const keep: SourceEntry[] = FIELD_DEFS.filter((d) => !answeredKeys.has(d.key)).map((d) => ({ field_name: d.key, source: "keep" }));

  const { error } = await supabase.rpc("save_insurance_policy", {
    p_association_id: association.id,
    p_policy_id: input.policyId,
    p_values: values,
    p_sources: [...answered, ...keep],
    p_options: { expected_updated_at: input.expectedUpdatedAt, document_id: null },
  });
  if (error) return friendlyDbError(error, "Walkup couldn't save the agent's answer. Try again.");

  // 4. The agent's answer, kept with the policy.
  if (attachment) {
    const { error: linkError } = await supabase.from("document_links").insert({
      association_id: association.id,
      document_id: attachment,
      target_table: "insurance_policies",
      target_id: input.policyId,
      relation: "agent_answer",
    });
    if (linkError && linkError.code !== "23505") console.error("agent answer link failed", linkError.code);
  }

  revalidateInsurance(`/insurance/policies/${input.policyId}`);
  return { ok: true };
}
