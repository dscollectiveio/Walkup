"use server";

import { createClient } from "@/lib/supabase/server";
import { isSingleMailbox } from "@/lib/ai/verify";
import {
  coiRequestDraft,
  generalDraft,
  jobGoAheadDraft,
  paperworkRequestDraft,
  quoteRequestDraft,
  w9RequestDraft,
  type Draft,
  type DraftContext,
} from "@/lib/repairs/drafts";
import {
  insertContractorDraft,
  loadDraftBasics,
  w9Link,
  type DraftKind,
} from "@/lib/repairs/contractor-drafts";
import { whereLabel } from "@/lib/repairs/format";
import { revalidateRepairs } from "@/lib/repairs/revalidate";
import { dbError, isUuid, textOrNull, type Err, type Ok } from "@/lib/repairs/server";

/**
 * Emails to contractors (repairs-spec §10.7).
 *
 * Walkup writes the draft from a template. A person reads it, sends it from
 * their own mail app, and marks it sent. There is no automatic send, and the
 * database enforces that: contractor_messages refuses a row marked 'sent'
 * without an approver, and the trigger takes the approver from the caller.
 *
 * That is a deliberate limit rather than a missing feature. An association
 * that accidentally emails a contractor something that reads like an
 * authorisation to start work has a real problem, and the volunteer doing
 * this at 10pm is exactly who would not notice.
 */

const KINDS: readonly DraftKind[] = ["general", "job", "quote_request", "w9_request", "coi_request", "paperwork_request"];
const DENIED = "Only a board member can write to contractors.";

export type { DraftKind };

export async function createDraft(input: {
  vendorId: string; ticketId?: string | null; kind: DraftKind; about?: string | null;
}): Promise<Ok<{ messageId: string; to: string[]; subject: string; body: string; existing: boolean }> | Err> {
  if (!isUuid(input.vendorId)) return { error: "Pick a contractor." };
  if (!KINDS.includes(input.kind)) return { error: "Choose what the email is about." };
  const ticketId = input.ticketId ? input.ticketId : null;
  if (ticketId !== null && !isUuid(ticketId)) return { error: "That problem isn't visible to you." };
  if ((input.kind === "job" || input.kind === "quote_request") && !ticketId) {
    return { error: "Pick the problem this email is about." };
  }

  const supabase = await createClient();
  // vendors_manager, not vendors: a property manager can read contractors but not their tax identity (0081).
  const { data: vendors } = await supabase
    .from("vendors_manager")
    .select("id, association_id, name, contact_name, email")
    .eq("id", input.vendorId)
    .limit(1);
  const vendor = vendors?.[0];
  if (!vendor) return { error: "That contractor isn't visible to you." };

  const basics = await loadDraftBasics(supabase, vendor.association_id);
  if (!basics) return { error: "No association is visible to you." };
  const ctx: DraftContext = { ...basics, contractor: { name: vendor.name, contactName: vendor.contact_name ?? null } };

  let draft: Draft;
  if (input.kind === "w9_request" || input.kind === "paperwork_request") {
    const url = await w9Link(supabase);
    draft = input.kind === "w9_request" ? w9RequestDraft(ctx, url) : paperworkRequestDraft(ctx, url);
  } else if (input.kind === "coi_request") {
    draft = coiRequestDraft(ctx);
  } else {
    let ticket: Record<string, unknown> | null = null;
    if (ticketId) {
      const { data } = await supabase
        .from("tickets")
        .select("id, reference, title, description, location_detail, access_notes, scheduled_for, scheduled_window, units(label)")
        .eq("id", ticketId)
        .eq("association_id", vendor.association_id)
        .limit(1);
      ticket = data?.[0] ?? null;
      if (!ticket) return { error: "That problem isn't visible to you." };
    }
    const unitLabel = (ticket?.units as { label?: string } | null)?.label ?? null;
    const where = ticket ? whereLabel(unitLabel, (ticket.location_detail as string | null) ?? null) : "";

    if (input.kind === "job" && ticket) {
      // The agreed figure: this contractor's accepted quote, else the board's estimate.
      const [{ data: bids }, { data: details }] = await Promise.all([
        supabase
          .from("ticket_bids")
          .select("amount::text, amount_kind, payment_terms_text")
          .eq("ticket_id", ticketId)
          .eq("vendor_id", vendor.id)
          .eq("status", "accepted")
          .limit(1),
        supabase.from("ticket_board_details").select("estimated_cost::text").eq("ticket_id", ticketId).limit(1),
      ]);
      const bid = bids?.[0];
      draft = jobGoAheadDraft(ctx, {
        reference: ticket.reference as number,
        title: ticket.title as string,
        where,
        accessNotes: (ticket.access_notes as string | null) ?? null,
        scheduledFor: (ticket.scheduled_for as string | null) ?? null,
        scheduledWindow: (ticket.scheduled_window as string | null) ?? null,
        amount: bid?.amount ?? details?.[0]?.estimated_cost ?? null,
        amountKind: bid?.amount_kind ?? null,
        paymentTerms: bid?.payment_terms_text ?? null,
      });
    } else if (input.kind === "quote_request" && ticket) {
      draft = quoteRequestDraft(ctx, {
        reference: ticket.reference as number,
        title: ticket.title as string,
        description: (ticket.description as string | null) ?? null,
        where,
        photosAttached: 0,
      });
    } else {
      const about = textOrNull(input.about ?? null) ?? (ticket ? `${ticket.title} (#${ticket.reference})` : null);
      draft = generalDraft(ctx, about ? about.slice(0, 120) : null);
    }
  }

  const stored = await insertContractorDraft(supabase, {
    associationId: vendor.association_id,
    vendorId: vendor.id,
    ticketId,
    kind: input.kind,
    toEmail: vendor.email ?? null,
    draft,
  });
  if ("error" in stored) return { error: dbError(stored.error, { denied: DENIED, context: "createDraft" }) };

  revalidateRepairs({ vendorId: vendor.id, ticketId: ticketId ?? undefined });
  return { ok: true, ...stored };
}

function checkText(subject: string, body: string): string | null {
  if (!oneLine(subject)) return "Add a subject.";
  if (oneLine(subject).length > 200) return "Keep the subject under 200 characters.";
  if (!body.trim()) return "Write the message first.";
  if (body.length > 10_000) return "Keep the message under 10,000 characters.";
  return null;
}

/** The first address given, when it is one plain mailbox; anything else (a list, "?bcc=", a name) is dropped, not stored. */
function firstAddress(to: string[] | undefined): string | null {
  const a = (to ?? []).map((t) => String(t).trim()).find(Boolean);
  return a && isSingleMailbox(a) ? a : null;
}

/** A subject is one line: line breaks and other control characters become a space (REVIEW-2 #14). */
function oneLine(subject: string): string {
  return String(subject ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/ {2,}/g, " ").trim();
}

export async function updateDraft(messageId: string, input: { subject: string; body: string; to: string[] }): Promise<Ok | Err> {
  if (!isUuid(messageId)) return { error: "That email isn't visible to you." };
  const problem = checkText(input.subject, input.body);
  if (problem) return { error: problem };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contractor_messages")
    .update({ subject: oneLine(input.subject), body: input.body, to_email: firstAddress(input.to) })
    .eq("id", messageId)
    .in("status", ["draft", "approved"])
    .select("id, vendor_id, ticket_id");
  if (error) return { error: dbError(error, { denied: DENIED, context: "updateDraft" }) };
  if (!data || data.length === 0) return { error: "Only a board member can change this, and only while it's a draft." };
  revalidateRepairs({ vendorId: data[0].vendor_id, ticketId: data[0].ticket_id ?? undefined });
  return { ok: true };
}

export async function discardDraft(messageId: string): Promise<Ok | Err> {
  if (!isUuid(messageId)) return { error: "That email isn't visible to you." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contractor_messages")
    .update({ status: "cancelled" })
    .eq("id", messageId)
    .in("status", ["draft", "approved"])
    .select("id, vendor_id, ticket_id");
  if (error) return { error: dbError(error, { denied: DENIED, context: "discardDraft" }) };
  if (!data || data.length === 0) return { error: "Only a board member can discard this, and only while it's a draft." };
  revalidateRepairs({ vendorId: data[0].vendor_id, ticketId: data[0].ticket_id ?? undefined });
  return { ok: true };
}

/**
 * Record that the board sent this email, with the text actually sent. The
 * triggers stamp sent_at and the approver, record when a quote was asked
 * for, and move an open problem to "being worked on" for a go-ahead, in the
 * same transaction. Marking an already-sent email again is harmless.
 */
export async function markMessageSent(
  messageId: string,
  final?: { to: string[]; subject: string; body: string },
): Promise<Ok<{ sentAt: string }> | Err> {
  if (!isUuid(messageId)) return { error: "That email isn't visible to you." };
  if (final) {
    const problem = checkText(final.subject, final.body);
    if (problem) return { error: problem };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contractor_messages")
    .update({
      status: "sent",
      ...(final ? { subject: oneLine(final.subject), body: final.body, to_email: firstAddress(final.to) } : {}),
    })
    .eq("id", messageId)
    .in("status", ["draft", "approved"])
    .select("id, sent_at, vendor_id, ticket_id");
  if (error) return { error: dbError(error, { denied: DENIED, context: "markMessageSent" }) };
  if (data && data.length > 0) {
    revalidateRepairs({ vendorId: data[0].vendor_id, ticketId: data[0].ticket_id ?? undefined });
    return { ok: true, sentAt: data[0].sent_at as string };
  }

  const { data: rows } = await supabase.from("contractor_messages").select("status, sent_at").eq("id", messageId).limit(1);
  const m = rows?.[0];
  if (m?.status === "sent" && m.sent_at) return { ok: true, sentAt: m.sent_at as string };
  if (m?.status === "cancelled") return { error: "This draft was discarded, so it can't be marked sent." };
  return { error: "Only a board member can mark an email sent." };
}

/** "Send as one email to all": every linked draft records the one text actually sent. */
export async function markMessagesSent(
  messageIds: string[],
  final: { subject: string; body: string },
): Promise<Ok<{ count: number }> | Err> {
  const ids = [...new Set((messageIds ?? []).filter(isUuid))];
  if (ids.length === 0) return { error: "Pick the emails you sent." };
  if (ids.length > 10) return { error: "That's more emails than one send can cover." };
  const problem = checkText(final.subject, final.body);
  if (problem) return { error: problem };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contractor_messages")
    .update({ subject: oneLine(final.subject), body: final.body, status: "sent" })
    .in("id", ids)
    .in("status", ["draft", "approved"])
    .select("id, vendor_id, ticket_id");
  if (error) return { error: dbError(error, { denied: DENIED, context: "markMessagesSent" }) };
  for (const r of data ?? []) revalidateRepairs({ vendorId: r.vendor_id, ticketId: r.ticket_id ?? undefined });
  if ((data ?? []).length === 0) revalidateRepairs();
  return { ok: true, count: (data ?? []).length };
}
