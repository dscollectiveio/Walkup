"use server";

import { todayIso } from "@/lib/dates";
import { COVERAGE_TYPES, isCoverageType, lineForCoverage, type LineKey } from "@/lib/insurance/coverage";
import { runCoverageCheck } from "@/lib/insurance/coverage-check";
import { draftEmail } from "@/lib/insurance/draft";
import {
  buildingDescription, detailsBlock, draftFacts, senderContact, type QuoteRequestPayloadV2, type RecipientKind,
} from "@/lib/insurance/emails";
import { friendlyDbError } from "@/lib/insurance/errors";
import { parseQuoteRequestPayload } from "@/lib/insurance/request-payload";
import { longDate } from "@/lib/insurance/format";
import { loadCheckInput, unitCount } from "@/lib/insurance/queries";
import { actionContext, cleanText, isIsoDate, isUuid, revalidateInsurance } from "./action-helpers";

/**
 * Quote requests to any saved contact (insurance-spec §8.4). The emails are
 * drafted first, with no database writes; then every request and its draft
 * go in one transaction, so a failure never leaves half a batch. Nothing is
 * sent: the board opens each draft in its own mail app (decision 8).
 */

export type { QuoteRequestPayloadV2 } from "@/lib/insurance/emails";

const BOARD_ONLY = "Only a board member can ask for quotes.";

interface ContactRow {
  id: string; name: string; person_name: string | null; kind: string; email: string | null;
  partner_id: string | null; is_current_agent: boolean;
}

/** The salutation for one contact: the person at an agency, an agent's own name, else "there". */
function greetingName(c: ContactRow): string {
  if (c.person_name?.trim()) return c.person_name.trim();
  if (c.kind === "agent" && c.name.trim()) return c.name.trim();
  return "there";
}

/** One recipient kind for a draft written once for several contacts. */
function sharedKind(contacts: ContactRow[]): RecipientKind {
  const kinds = new Set(contacts.map((c) => c.kind));
  const only = kinds.size === 1 ? [...kinds][0] : "agency";
  return only === "agent" || only === "broker" || only === "insurer" ? only : "agency";
}

function validPayload(p: QuoteRequestPayloadV2 | null | undefined): string | null {
  if (!p || typeof p !== "object" || p.version !== 2 || !p.association || !p.contact) return "The request details are missing. Reload and try again.";
  if (!p.association.legal_name?.trim() || !p.association.address?.trim()) {
    return "The association's legal name and address are needed for a quote.";
  }
  if (!p.contact.name?.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.contact.email?.trim() ?? "")) {
    return "Add your name and email so the agency can reply.";
  }
  if (!Array.isArray(p.coverages) || p.coverages.length === 0) return "Choose at least one kind of coverage.";
  if (p.coverages.some((c) => !c || !isCoverageType(c.coverage))) return "Choose coverage types from the list.";
  if (!Array.isArray(p.claims)) return "The request details are missing. Reload and try again.";
  return null;
}

export async function createQuoteRequests(input: {
  contactIds: string[];
  payload: QuoteRequestPayloadV2;
  consent: true;
}): Promise<{ ok: true; requestIds: string[]; messageIds: string[]; draftedBy: "model" | "template"; notice?: string } | { error: string }> {
  const ctx = await actionContext(BOARD_ONLY);
  if ("error" in ctx) return ctx;
  const { supabase, association } = ctx;

  // 1. Contacts and consent.
  const ids = [...new Set((input.contactIds ?? []).filter(isUuid))];
  if (ids.length === 0) return { error: "Choose at least one agency or insurer." };
  if (ids.length > 10) return { error: "Choose up to ten contacts at a time." };
  const { data: rows } = await supabase
    .from("insurance_contacts")
    .select("id, name, person_name, kind, email, partner_id, is_current_agent")
    .eq("association_id", association.id)
    .is("archived_at", null)
    .in("id", ids);
  const byId = new Map(((rows ?? []) as ContactRow[]).map((c) => [c.id, c]));
  const contacts = ids.map((id) => byId.get(id)).filter((c): c is ContactRow => Boolean(c));
  if (contacts.length !== ids.length) return { error: "One of those contacts was not found. Reload and try again." };
  const noEmail = contacts.find((c) => !c.email?.trim());
  if (noEmail) return { error: `${noEmail.name} has no email address. Add one or choose another contact.` };
  if (input.consent !== true) return { error: "Tick the box confirming these details can be shared." };

  // 2. The payload: shape and bounds first (unknown keys dropped), then the existing sentence-level checks.
  const bounded = parseQuoteRequestPayload(input.payload);
  if (!bounded.ok) return { error: bounded.error };
  const problem = validPayload(bounded.value);
  if (problem) return { error: problem };
  const payload: QuoteRequestPayloadV2 = {
    ...bounded.value,
    anything_else: cleanText(bounded.value.anything_else, 2000),
    claims: bounded.value.claims.slice(0, 20),
  };
  const coverages = [...new Set(payload.coverages.map((c) => c.coverage))];

  // 3. Draft once, before any write.
  const today = todayIso();
  const check = await loadCheckInput(supabase, association, today);
  const inForceFirst = check.policies
    .filter((p) => p.status === "active" && p.coverage === coverages[0])
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null;
  const wantedLines = new Set(coverages.map(lineForCoverage).filter((l): l is LineKey => l !== null));
  const findingLines = runCoverageCheck(check).findings
    .filter((f) => !f.dismissed && f.line && wantedLines.has(f.line) && (f.severity === "gap" || f.severity === "ask"))
    .map((f) => f.line as LineKey);
  const renewalOn = inForceFirst?.effective_to ?? null;
  const facts = draftFacts("quote_request", {
    contactKind: sharedKind(contacts),
    isCurrentAgent: contacts.length === 1 && contacts[0].is_current_agent,
    coverages,
    renewalKnown: renewalOn !== null,
    findingLines,
  });
  const units = payload.association.units || (await unitCount(supabase, association.id));
  const labels = COVERAGE_TYPES.filter((c) => coverages.includes(c.value)).map((c) => c.short.toLowerCase());
  const draft = await draftEmail({
    supabase,
    associationId: association.id,
    kind: "quote_request",
    facts,
    values: {
      agent_name: "{{agent_name}}",
      association_name: payload.association.legal_name.trim(),
      building_description: buildingDescription(units, payload.association.city ?? association.city),
      details_block: detailsBlock(payload),
      renewal_date: renewalOn ? longDate(renewalOn) : null,
      sender_name: payload.contact.name.trim(),
      sender_contact: senderContact(payload.contact.email, payload.contact.phone),
      coverages: labels.join(", "),
    },
  });

  // 4. One transaction: every request and its draft, or nothing.
  const perContact = contacts.map((c) => {
    const name = greetingName(c);
    return {
      request: { contact_id: c.id, partner_id: c.partner_id, policy_id: inForceFirst?.id ?? null, coverages, payload_json: payload },
      message: {
        subject: draft.subject.split("{{agent_name}}").join(name),
        body: draft.body.split("{{agent_name}}").join(name),
        to_email: c.email!.trim(),
        drafted_by: draft.draftedBy,
        facts_json: facts,
      },
    };
  });
  const { data, error } = await supabase.rpc("create_insurance_quote_requests", {
    p_association_id: association.id,
    p_requests: perContact.map((x) => x.request),
    p_messages: perContact.map((x) => x.message),
  });
  if (error) return friendlyDbError(error, "Walkup couldn't prepare those requests. Nothing was saved. Try again.");
  const created = (data ?? []) as { request_id: string; message_id: string }[];

  revalidateInsurance();
  return {
    ok: true,
    requestIds: created.map((r) => r.request_id),
    messageIds: created.map((r) => r.message_id),
    draftedBy: draft.draftedBy,
    ...(draft.notice ? { notice: draft.notice } : {}),
  };
}

const STATUSES = new Set(["sent", "quote_received", "declined", "expired"]);

export async function setQuoteRequestStatus(
  requestId: string,
  status: "sent" | "quote_received" | "declined" | "expired",
  extra?: { declinedReason?: string },
): Promise<{ ok: true } | { error: string }> {
  const ctx = await actionContext("Only a board member can update a request.");
  if ("error" in ctx) return ctx;
  if (!isUuid(requestId)) return { error: "That request was not found." };
  if (!STATUSES.has(status)) return { error: "Unknown status." };
  const { data: row } = await ctx.supabase
    .from("insurance_quote_requests")
    .select("id, status, sent_at")
    .eq("id", requestId)
    .maybeSingle();
  const current = row as { id: string; status: string; sent_at: string | null } | null;
  if (!current) return { error: "That request was not found." };
  if (current.status === "accepted") return { error: "A quote from this request was chosen, so it can't change." };

  const now = new Date().toISOString();
  // A request that isn't a draft has a sent date (0041's check), so any move out of draft sets one.
  const patch: Record<string, unknown> = { status, updated_at: now, sent_at: current.sent_at ?? now };
  if (status === "quote_received" || status === "declined") patch.responded_at = now;
  if (status === "declined") patch.declined_reason = cleanText(extra?.declinedReason, 500);
  if (status === "sent") patch.declined_reason = null;

  const { data, error } = await ctx.supabase.from("insurance_quote_requests").update(patch).eq("id", requestId).select("id");
  if (error) return friendlyDbError(error, "Walkup couldn't update this request. Try again.");
  if (!data || data.length === 0) return { error: "Only a board member can update a request." };
  revalidateInsurance();
  return { ok: true };
}

export async function setFollowUp(requestId: string, on: string | null): Promise<{ ok: true } | { error: string }> {
  const ctx = await actionContext("Only a board member can update a request.");
  if ("error" in ctx) return ctx;
  if (!isUuid(requestId)) return { error: "That request was not found." };
  if (on !== null && !isIsoDate(on)) return { error: "Choose a follow-up date with the date picker." };
  const { data, error } = await ctx.supabase
    .from("insurance_quote_requests")
    .update({ follow_up_on: on, updated_at: new Date().toISOString() })
    .eq("id", requestId)
    .select("id");
  if (error) return friendlyDbError(error, "Walkup couldn't set the follow-up date. Try again.");
  if (!data || data.length === 0) return { error: "Only a board member can update a request." };
  revalidateInsurance();
  return { ok: true };
}
