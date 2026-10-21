"use server";

import { todayIso } from "@/lib/dates";
import { COVERAGE_TYPES, LINE_COVERAGE } from "@/lib/insurance/coverage";
import { runCoverageCheck } from "@/lib/insurance/coverage-check";
import { draftEmail } from "@/lib/insurance/draft";
import {
  EMAIL_KINDS, buildingDescription, draftFacts, policyReference, senderContact, templateDraft,
  type ChangeKind, type DraftFactsByKind, type EmailKind, type HolderKind, type MessageKind, type TemplateValues,
} from "@/lib/insurance/emails";
import { friendlyDbError } from "@/lib/insurance/errors";
import { formatMoney, longDate } from "@/lib/insurance/format";
import { loadCheckInput, loadPolicies, unitCount, type Supabase } from "@/lib/insurance/queries";
import { actionContext, cleanText, isUuid, revalidateInsurance } from "./action-helpers";

/**
 * Drafted emails to agents, brokers and insurers (insurance-spec §8.5). Each
 * is built from the database for its kind, drafted by the model from
 * placeholder-only facts (or the template), and saved as a draft the board
 * edits, opens in its own mail app and marks sent. Walkup never sends it.
 */

const BOARD_ONLY = "Only a board member can write to agents.";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const HOLDER_KINDS: HolderKind[] = ["mortgage_lender", "contractor", "property_manager", "other"];
const CHANGE_KINDS: ChangeKind[] = ["add_coverage", "raise_limit", "change_deductible", "add_additional_insured", "update_address", "other"];

interface ContactRow { id: string; name: string; person_name: string | null; kind: string; email: string | null; is_current_agent: boolean }

function greetingName(c: ContactRow | null): string {
  if (!c) return "there";
  if (c.person_name?.trim()) return c.person_name.trim();
  if (c.kind === "agent" && c.name.trim()) return c.name.trim();
  return "there";
}

function coverageLabelsLower(coverages: string[]): string {
  return COVERAGE_TYPES.filter((c) => coverages.includes(c.value)).map((c) => c.short.toLowerCase()).join(", ");
}

async function loadContact(supabase: Supabase, id: string | null | undefined): Promise<ContactRow | null> {
  if (!isUuid(id)) return null;
  const { data } = await supabase
    .from("insurance_contacts")
    .select("id, name, person_name, kind, email, is_current_agent")
    .eq("id", id)
    .maybeSingle();
  return (data ?? null) as ContactRow | null;
}

/** The signed-in board member's name and contact line for the sign-off. */
async function sender(supabase: Supabase, associationId: string): Promise<{ name: string; contact: string }> {
  const { data: personId } = await supabase.rpc("current_person_id", { assoc: associationId });
  if (typeof personId !== "string") return { name: "The board", contact: "" };
  const [{ data }, { data: contact }] = await Promise.all([
    supabase.from("persons").select("full_name, email").eq("id", personId).maybeSingle(),
    // The caller's own phone (person_contact_details, 0082).
    supabase.from("person_contact_details").select("phone").eq("person_id", personId).maybeSingle(),
  ]);
  const p = data as { full_name: string; email: string | null } | null;
  const phone = (contact as { phone: string | null } | null)?.phone ?? null;
  return { name: p?.full_name?.trim() || "The board", contact: senderContact(p?.email ?? null, phone) };
}

export async function composeInsuranceEmail(input: {
  kind: EmailKind | "other";
  contactId: string | null;
  toEmail: string | null;
  policyId?: string;
  claimId?: string;
  findingId?: string;
  quoteRequestId?: string;
  quoteId?: string;
  ownerRequestId?: string;
  holder?: { name: string; address: string; kind: HolderKind };
  change?: { kind: ChangeKind; details: string };
  /** coverage_question with "My own question": template only, nothing goes to the model. */
  question?: string;
}): Promise<{ ok: true; messageId: string; subject: string; body: string; draftedBy: "model" | "template"; notice?: string } | { error: string }> {
  const ctx = await actionContext(BOARD_ONLY);
  if ("error" in ctx) return ctx;
  const { supabase, association } = ctx;
  const kind = input.kind;
  if (kind !== "other" && !(EMAIL_KINDS as readonly string[]).includes(kind)) return { error: "Choose what the email is for." };
  if (kind === "quote_request") return { error: "Use Ask for quotes to write quote requests." };

  const today = todayIso();
  let contact = await loadContact(supabase, input.contactId);
  if (input.contactId && !contact) return { error: "That contact was not found." };

  const [me, units, policies] = await Promise.all([
    sender(supabase, association.id),
    unitCount(supabase, association.id),
    loadPolicies(supabase, association.id, today),
  ]);
  const policyById = new Map(policies.map((p) => [p.id, p]));
  const master = policies
    .filter((p) => p.status === "active" && p.coverage === "property")
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null;

  const values: TemplateValues = {
    association_name: association.legal_name?.trim() || association.display_name?.trim() || "our association",
    building_description: buildingDescription(units, association.city),
    sender_name: me.name,
    sender_contact: me.contact || null,
  };
  const link: { policy_id: string | null; claim_id: string | null; quote_request_id: string | null; finding_rule_id: string | null } = {
    policy_id: null, claim_id: null, quote_request_id: null, finding_rule_id: null,
  };
  let facts: DraftFactsByKind[EmailKind] | Record<string, never> = {};
  let templateOnly = false;

  const policyRef = (id: string | null | undefined) => {
    const p = id ? policyById.get(id) : null;
    if (!p) return null;
    link.policy_id = p.id;
    values.policy_reference = policyReference(p.coverage, p.carrier_name, typeof p.policy_number === "string" ? p.policy_number : null);
    values.coverage = COVERAGE_TYPES.find((c) => c.value === p.coverage)?.short ?? "insurance";
    return p;
  };

  switch (kind) {
    case "quote_follow_up": {
      if (!isUuid(input.quoteRequestId)) return { error: "Choose the request to follow up on." };
      const { data } = await supabase
        .from("insurance_quote_requests")
        .select("id, contact_id, coverages, sent_at, status")
        .eq("id", input.quoteRequestId)
        .maybeSingle();
      const req = data as { id: string; contact_id: string | null; coverages: string[]; sent_at: string | null; status: string } | null;
      if (!req) return { error: "That request was not found." };
      if (!req.sent_at) return { error: "This request hasn't been sent yet. Send it first." };
      contact = contact ?? (await loadContact(supabase, req.contact_id));
      link.quote_request_id = req.id;
      const days = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(req.sent_at)) / 86_400_000);
      values.original_date = longDate(req.sent_at);
      values.coverages = coverageLabelsLower(req.coverages) || "our insurance";
      facts = draftFacts("quote_follow_up", { contactKind: contact?.kind ?? null, daysSinceSent: days, coverages: req.coverages });
      break;
    }
    case "coverage_question": {
      const own = cleanText(input.question, 2000);
      if (own) {
        policyRef(input.policyId ?? master?.id);
        values.question = own;
        values.policy_reference ??= "our insurance";
        values.coverage ??= "insurance";
        templateOnly = true;
        break;
      }
      if (!input.findingId) return { error: "Choose a finding, or write your own question." };
      const check = runCoverageCheck(await loadCheckInput(supabase, association, today));
      const finding = check.findings.find((f) => f.id === input.findingId);
      if (!finding) return { error: "That finding no longer applies. Reload to see the current check." };
      link.finding_rule_id = finding.ruleId;
      const p = policyRef(finding.policyId ?? input.policyId ?? (finding.line === "property" ? master?.id : null));
      values.question = finding.question ?? finding.title;
      values.policy_reference ??= "our insurance";
      const coverage = p?.coverage ?? (finding.line ? LINE_COVERAGE[finding.line] : "other");
      values.coverage ??= COVERAGE_TYPES.find((c) => c.value === coverage)?.short ?? "insurance";
      facts = draftFacts("coverage_question", {
        contactKind: contact?.kind ?? null, isCurrentAgent: contact?.is_current_agent ?? false,
        coverage, line: finding.line, basis: finding.basis,
      });
      break;
    }
    case "certificate_request": {
      const name = cleanText(input.holder?.name, 300);
      const address = cleanText(input.holder?.address, 1000);
      if (!name || !address) return { error: "Enter the name and address to show on the certificate." };
      const holderKind = input.holder && HOLDER_KINDS.includes(input.holder.kind) ? input.holder.kind : "other";
      const p = policyRef(input.policyId ?? master?.id);
      values.policy_reference ??= "our master policy";
      values.certificate_holder = `${name}\n${address}`;
      facts = draftFacts("certificate_request", { contactKind: contact?.kind ?? null, holderKind, coverages: [p?.coverage ?? "property"] });
      break;
    }
    case "claim_report": {
      if (!isUuid(input.claimId)) return { error: "Choose the claim. No claim yet? Add the claim first." };
      const { data } = await supabase
        .from("insurance_claims")
        .select("id, policy_id, ticket_id, date_of_loss, description, amount_claimed::text, claim_number")
        .eq("id", input.claimId)
        .maybeSingle();
      const claim = data as { id: string; policy_id: string; ticket_id: string | null; date_of_loss: string; description: string; amount_claimed: string | null; claim_number: string | null } | null;
      if (!claim) return { error: "That claim was not found." };
      link.claim_id = claim.id;
      const p = policyRef(claim.policy_id);
      values.policy_reference ??= "our policy";
      values.loss_details = [
        `Date of loss: ${longDate(claim.date_of_loss)}.`,
        `What happened: ${/[.!?]$/.test(claim.description.trim()) ? claim.description.trim() : `${claim.description.trim()}.`}`,
        formatMoney(claim.amount_claimed) ? `Amount claimed: ${formatMoney(claim.amount_claimed)}.` : null,
        claim.claim_number ? `Claim number: ${claim.claim_number}.` : null,
      ].filter(Boolean).join("\n");
      facts = draftFacts("claim_report", { contactKind: contact?.kind ?? null, coverage: p?.coverage ?? "other", linkedToRepair: claim.ticket_id !== null });
      break;
    }
    case "change_request": {
      const details = cleanText(input.change?.details, 2000);
      if (!details) return { error: "Describe the change you'd like to ask about." };
      const changeKind = input.change && CHANGE_KINDS.includes(input.change.kind) ? input.change.kind : "other";
      const p = policyRef(input.policyId);
      values.policy_reference ??= "our insurance";
      values.change_details = details;
      facts = draftFacts("change_request", { contactKind: contact?.kind ?? null, changeKind, coverage: p?.coverage ?? "other" });
      break;
    }
    case "documents_request":
      facts = draftFacts("documents_request", { contactKind: contact?.kind ?? null, isCurrentAgent: contact?.is_current_agent ?? false });
      break;
    case "quote_decline": {
      if (!isUuid(input.quoteId)) return { error: "Choose the quote you're thanking them for." };
      const { data } = await supabase
        .from("insurance_quotes")
        .select("id, coverage, contact_id, quote_request_id, was_selected")
        .eq("id", input.quoteId)
        .maybeSingle();
      const quote = data as { id: string; coverage: string; contact_id: string | null; quote_request_id: string | null; was_selected: boolean } | null;
      if (!quote) return { error: "That quote was not found." };
      if (quote.was_selected) return { error: "You chose this quote, so there's nothing to decline." };
      contact = contact ?? (await loadContact(supabase, quote.contact_id));
      link.quote_request_id = quote.quote_request_id;
      values.coverages = coverageLabelsLower([quote.coverage]) || "insurance";
      facts = draftFacts("quote_decline", { contactKind: contact?.kind ?? null, coverages: [quote.coverage] });
      break;
    }
    default:
      // "other": a blank email the board writes itself.
      policyRef(input.policyId);
      templateOnly = true;
  }

  const toEmail = cleanText(input.toEmail, 320) ?? contact?.email?.trim() ?? null;
  if (!toEmail) return { error: "Choose a contact with an email address, or type one." };
  if (!EMAIL_RE.test(toEmail)) return { error: "Check the email address." };
  values.agent_name = greetingName(contact);

  let draft: { subject: string; body: string; draftedBy: "model" | "template"; notice?: string };
  if (kind === "other") {
    draft = {
      subject: "",
      body: [`Hello ${values.agent_name},`, "", "", "", "Thank you,", values.sender_name, values.sender_contact].filter((l) => l !== null && l !== undefined).join("\n"),
      draftedBy: "template",
    };
  } else if (templateOnly) {
    draft = { ...templateDraft(kind, values), draftedBy: "template" };
  } else {
    draft = await draftEmail({ supabase, associationId: association.id, kind, facts: facts as DraftFactsByKind[EmailKind], values });
  }

  const messageKind: MessageKind = kind;
  const { data: inserted, error } = await supabase
    .from("insurance_messages")
    .insert({
      association_id: association.id,
      kind: messageKind,
      contact_id: contact?.id ?? null,
      to_email: toEmail,
      subject: draft.subject,
      body: draft.body,
      status: "draft",
      ...link,
      drafted_by: draft.draftedBy,
      facts_json: facts,
    })
    .select("id")
    .single();
  if (error || !inserted) return friendlyDbError(error ?? { message: "" }, "Walkup couldn't save this draft. Try again.");
  const messageId = (inserted as { id: string }).id;

  if (kind === "certificate_request" && isUuid(input.ownerRequestId)) {
    const { error: linkError } = await supabase
      .from("insurance_owner_requests")
      .update({ message_id: messageId })
      .eq("id", input.ownerRequestId)
      .eq("status", "open");
    if (linkError) console.error("owner request link failed", linkError.code);
  }

  revalidateInsurance();
  return {
    ok: true, messageId, subject: draft.subject, body: draft.body, draftedBy: draft.draftedBy,
    ...(draft.notice ? { notice: draft.notice } : {}),
  };
}

export async function updateMessage(
  messageId: string,
  patch: { subject?: string; body?: string; toEmail?: string },
): Promise<{ ok: true } | { error: string }> {
  const ctx = await actionContext(BOARD_ONLY);
  if ("error" in ctx) return ctx;
  if (!isUuid(messageId)) return { error: "That email was not found." };
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.subject !== undefined) update.subject = String(patch.subject).replace(/\s+/g, " ").trim().slice(0, 300);
  if (patch.body !== undefined) update.body = String(patch.body).slice(0, 20_000);
  if (patch.subject !== undefined || patch.body !== undefined) update.drafted_by = "board";
  if (patch.toEmail !== undefined) {
    const to = String(patch.toEmail).trim();
    if (!EMAIL_RE.test(to)) return { error: "Check the email address." };
    update.to_email = to;
  }
  const { data, error } = await ctx.supabase
    .from("insurance_messages")
    .update(update)
    .eq("id", messageId)
    .eq("status", "draft")
    .select("id");
  if (error) return friendlyDbError(error, "Walkup couldn't save your changes. Try again.");
  if (!data || data.length === 0) return { error: "This email was already sent or cancelled." };
  revalidateInsurance();
  return { ok: true };
}

export async function markMessageSent(messageId: string): Promise<{ ok: true } | { error: string }> {
  const ctx = await actionContext(BOARD_ONLY);
  if ("error" in ctx) return ctx;
  if (!isUuid(messageId)) return { error: "That email was not found." };
  const { error } = await ctx.supabase.rpc("mark_insurance_message_sent", { p_message_id: messageId });
  if (error) return friendlyDbError(error, "Walkup couldn't mark this email sent. Try again.");
  revalidateInsurance();
  return { ok: true };
}

export async function cancelMessage(messageId: string): Promise<{ ok: true } | { error: string }> {
  const ctx = await actionContext(BOARD_ONLY);
  if ("error" in ctx) return ctx;
  if (!isUuid(messageId)) return { error: "That email was not found." };
  const { data, error } = await ctx.supabase
    .from("insurance_messages")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", messageId)
    .eq("status", "draft")
    .select("id");
  if (error) return friendlyDbError(error, "Walkup couldn't cancel this draft. Try again.");
  if (!data || data.length === 0) return { error: "This email was already sent or cancelled." };
  revalidateInsurance();
  return { ok: true };
}
