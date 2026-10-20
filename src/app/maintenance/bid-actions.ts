"use server";

import { createClient } from "@/lib/supabase/server";
import { runStructured } from "@/lib/ai/structured";
import { extractDocumentText } from "@/lib/documents/extract-text";
import { redactTaxIds } from "@/lib/documents/redact";
import {
  BID_READ_SYSTEM,
  BID_TEXT_MAX,
  BID_TEXT_MIN,
  bidPrefillFrom,
  bidReadContent,
  bidReadSchema,
  type BidPrefill,
} from "@/lib/repairs/bid-read";
import { insertContractorDraft, loadDraftBasics } from "@/lib/repairs/contractor-drafts";
import { callScript, notChosenDraft, quoteRequestDraft } from "@/lib/repairs/drafts";
import { whereLabel } from "@/lib/repairs/format";
import { revalidateRepairs } from "@/lib/repairs/revalidate";
import {
  currentAssociationId,
  dbError,
  firstIssue,
  isBoard,
  canManageRepairs,
  isUuid,
  NO_ASSOCIATION,
  type Err,
  type Ok,
} from "@/lib/repairs/server";
import { bidSchema, type BidInput } from "@/lib/repairs/validate";

/**
 * Quotes per problem (repairs-spec §8). Walkup records offers; it never
 * places work. Asking several contractors is one RPC (bids, drafts and the
 * links between them, or nothing); accepting is one RPC (contractor and
 * estimate on the problem, every other live quote "not chosen").
 */

const BOARD_ONLY = "Only a board member can do this.";
const NOT_VISIBLE = "That problem isn't visible to you.";

type RequestOutcome = "drafted" | "by_phone" | "already_asked" | "not_available";

export async function requestQuotes(
  ticketId: string,
  picks: { vendorId: string; byPhone: boolean }[],
  attachPhotos: boolean,
): Promise<
  | Ok<{
      drafts: { messageId: string; bidId: string; vendorId: string; vendorName: string; to: string[]; subject: string; body: string }[];
      calls: { bidId: string; vendorId: string; vendorName: string; phone: string | null; script: string }[];
      skipped: { vendorId: string; vendorName: string; reason: "already_asked" | "not_available" }[];
    }>
  | Err
> {
  if (!isUuid(ticketId)) return { error: NOT_VISIBLE };
  const seen = new Set<string>();
  const unique = (picks ?? []).filter((p) => isUuid(p?.vendorId) && !seen.has(p.vendorId) && seen.add(p.vendorId));
  if (unique.length === 0) return { error: "Pick at least one contractor." };
  if (unique.length > 5) return { error: "Pick up to 5 contractors." };

  const supabase = await createClient();
  const { data: tickets } = await supabase
    .from("tickets")
    .select("id, association_id, reference, title, description, location_detail, units(label)")
    .eq("id", ticketId)
    .limit(1);
  const ticket = tickets?.[0];
  if (!ticket) return { error: NOT_VISIBLE };
  if (!(await canManageRepairs(supabase, ticket.association_id))) return { error: "Only a board member can ask for quotes." };

  const [basics, { data: vendors }, photoCount] = await Promise.all([
    loadDraftBasics(supabase, ticket.association_id),
    supabase.from("vendors").select("id, name, contact_name, email, phone").in("id", unique.map((p) => p.vendorId)),
    attachPhotos
      ? supabase.rpc("ticket_photos", { p_ticket_id: ticketId }).then((r) => (Array.isArray(r.data) ? r.data.length : 0))
      : Promise.resolve(0),
  ]);
  if (!basics) return { error: NO_ASSOCIATION };
  const byId = new Map((vendors ?? []).map((v) => [v.id as string, v]));
  const where = whereLabel((ticket.units as { label?: string } | null)?.label ?? null, ticket.location_detail ?? null);

  const requests = unique.map((p) => {
    const v = byId.get(p.vendorId);
    const email = (v?.email as string | null)?.trim() || null;
    const byPhone = p.byPhone || !email;
    if (!v || byPhone) return { vendor_id: p.vendorId, by_phone: true, to_email: null, subject: null, body: null };
    const draft = quoteRequestDraft(
      { ...basics, contractor: { name: v.name, contactName: v.contact_name ?? null } },
      { reference: ticket.reference, title: ticket.title, description: ticket.description ?? null, where, photosAttached: photoCount },
    );
    return { vendor_id: p.vendorId, by_phone: false, to_email: email, subject: draft.subject, body: draft.body };
  });

  const { data: rows, error } = await supabase.rpc("request_ticket_quotes", { p_ticket_id: ticketId, p_requests: requests });
  if (error) return { error: dbError(error, { denied: "Only a board member can ask for quotes.", context: "request_ticket_quotes" }) };
  const results = (rows ?? []) as { vendor_id: string; bid_id: string | null; message_id: string | null; outcome: RequestOutcome }[];

  // The stored text (a reused open draft keeps its own words).
  const messageIds = results.map((r) => r.message_id).filter((id): id is string => Boolean(id));
  const { data: messages } = messageIds.length
    ? await supabase.from("contractor_messages").select("id, subject, body, to_email").in("id", messageIds)
    : { data: [] as { id: string; subject: string; body: string; to_email: string | null }[] };
  const messageById = new Map((messages ?? []).map((m) => [m.id as string, m]));

  const drafts: { messageId: string; bidId: string; vendorId: string; vendorName: string; to: string[]; subject: string; body: string }[] = [];
  const calls: { bidId: string; vendorId: string; vendorName: string; phone: string | null; script: string }[] = [];
  const skipped: { vendorId: string; vendorName: string; reason: "already_asked" | "not_available" }[] = [];
  const script = callScript({ title: ticket.title, where });
  for (const r of results) {
    const v = byId.get(r.vendor_id);
    const vendorName = (v?.name as string | undefined) ?? "This contractor";
    if (r.outcome === "drafted" && r.message_id && r.bid_id) {
      const m = messageById.get(r.message_id);
      const sent = requests.find((q) => q.vendor_id === r.vendor_id);
      const to = (m?.to_email as string | null) ?? sent?.to_email ?? null;
      drafts.push({
        messageId: r.message_id,
        bidId: r.bid_id,
        vendorId: r.vendor_id,
        vendorName,
        to: to ? [to] : [],
        subject: (m?.subject as string | undefined) ?? sent?.subject ?? "",
        body: (m?.body as string | undefined) ?? sent?.body ?? "",
      });
    } else if (r.outcome === "by_phone" && r.bid_id) {
      calls.push({ bidId: r.bid_id, vendorId: r.vendor_id, vendorName, phone: (v?.phone as string | null) ?? null, script });
    } else if (r.outcome === "already_asked" || r.outcome === "not_available") {
      skipped.push({ vendorId: r.vendor_id, vendorName, reason: r.outcome });
    }
  }

  revalidateRepairs({ ticketId });
  return { ok: true, drafts, calls, skipped };
}

/** Record a quote, or edit one: a requested bid becomes "Quote in". */
export async function recordBid(input: BidInput): Promise<Ok<{ bidId: string }> | Err> {
  const parsed = bidSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;

  const supabase = await createClient();
  const { data: tickets } = await supabase.from("tickets").select("id, association_id").eq("id", v.ticket_id).limit(1);
  const ticket = tickets?.[0];
  if (!ticket) return { error: NOT_VISIBLE };
  if (!(await canManageRepairs(supabase, ticket.association_id))) return { error: "Only a board member can record a quote." };

  const fields = {
    amount: v.amount,
    amount_kind: v.amount_kind,
    received_on: v.received_on,
    valid_until: v.valid_until,
    can_start_on: v.can_start_on,
    duration_text: v.duration_text || null,
    scope_text: v.scope_text || null,
    warranty_text: v.warranty_text || null,
    exclusions_text: v.exclusions_text || null,
    payment_terms_text: v.payment_terms_text || null,
    notes: v.notes || null,
    document_id: v.document_id,
  };

  // The bid to update: the one named, else this contractor's live bid on this problem.
  let existing: { id: string; status: string; amount: string | null } | null = null;
  if (v.bid_id) {
    const { data } = await supabase
      .from("ticket_bids")
      .select("id, status, amount::text, ticket_id, vendor_id")
      .eq("id", v.bid_id)
      .limit(1);
    const b = data?.[0];
    if (!b || b.ticket_id !== v.ticket_id || b.vendor_id !== v.vendor_id) return { error: "That quote isn't visible to you." };
    existing = b;
  } else {
    const { data } = await supabase
      .from("ticket_bids")
      .select("id, status, amount::text")
      .eq("ticket_id", v.ticket_id)
      .eq("vendor_id", v.vendor_id)
      .in("status", ["requested", "received", "accepted"])
      .limit(1);
    existing = data?.[0] ?? null;
  }

  let bidId: string;
  if (existing) {
    const status = existing.status === "requested" || existing.status === "withdrawn" ? "received" : existing.status;
    const { data, error } = await supabase
      .from("ticket_bids")
      .update({ ...fields, status })
      .eq("id", existing.id)
      .select("id");
    if (error) {
      return { error: dbError(error, { denied: "Only a board member can record a quote.", duplicate: "This contractor already has a live quote on this problem.", context: "recordBid update" }) };
    }
    if (!data || data.length === 0) return { error: "Only a board member can record a quote." };
    bidId = existing.id;
    // An accepted quote's new figure is the problem's estimate too.
    if (existing.status === "accepted" && existing.amount !== v.amount) {
      const { error: planError } = await supabase.rpc("set_ticket_plan", {
        p_ticket_id: v.ticket_id,
        p_fields: { estimated_cost: v.amount },
      });
      if (planError) console.error("[repairs] accepted quote estimate", planError.code ?? "-", planError.message ?? "");
    }
  } else {
    const { data, error } = await supabase
      .from("ticket_bids")
      .insert({ association_id: ticket.association_id, ticket_id: v.ticket_id, vendor_id: v.vendor_id, status: "received", ...fields })
      .select("id");
    if (error) {
      return { error: dbError(error, { denied: "Only a board member can record a quote.", duplicate: "This contractor already has a live quote on this problem.", context: "recordBid insert" }) };
    }
    if (!data?.[0]) return { error: "Only a board member can record a quote." };
    bidId = data[0].id as string;
  }

  revalidateRepairs({ ticketId: v.ticket_id, vendorId: v.vendor_id });
  return { ok: true, bidId };
}

async function bidRow(bidId: string) {
  const supabase = await createClient();
  if (!isUuid(bidId)) return { supabase, bid: null };
  const { data } = await supabase
    .from("ticket_bids")
    .select("id, association_id, ticket_id, vendor_id, status, amount::text")
    .eq("id", bidId)
    .limit(1);
  return { supabase, bid: data?.[0] ?? null };
}

/** Chooses the contractor and sets the estimate. Walkup doesn't tell them; the go-ahead is the next step. */
export async function acceptBid(bidId: string): Promise<Ok | Err> {
  const { supabase, bid } = await bidRow(bidId);
  if (!bid) return { error: "That quote isn't visible to you." };
  const { error } = await supabase.rpc("accept_ticket_bid", { p_bid_id: bidId });
  if (error) return { error: dbError(error, { denied: "Only a board member can accept a quote.", context: "accept_ticket_bid" }) };
  revalidateRepairs({ ticketId: bid.ticket_id, vendorId: bid.vendor_id });
  return { ok: true };
}

/** "Not chosen". A request that never got a figure becomes "No quote" (the table needs an amount to decline). */
export async function declineBid(bidId: string, reason: string | null): Promise<Ok | Err> {
  const why = reason?.trim() || null;
  if (why && why.length > 300) return { error: "Keep the reason under 300 characters." };
  const { supabase, bid } = await bidRow(bidId);
  if (!bid) return { error: "That quote isn't visible to you." };
  const update = bid.amount === null ? { status: "withdrawn" } : { status: "declined", decline_reason: why };
  const { data, error } = await supabase
    .from("ticket_bids")
    .update(update)
    .eq("id", bidId)
    .in("status", ["requested", "received", "accepted"])
    .select("id");
  if (error) return { error: dbError(error, { denied: BOARD_ONLY, context: "declineBid" }) };
  if (!data || data.length === 0) return { error: "Only a board member can change a quote, and only while it's live." };
  revalidateRepairs({ ticketId: bid.ticket_id, vendorId: bid.vendor_id });
  return { ok: true };
}

/** "No quote from them": they didn't quote, or the board stopped waiting. */
export async function markNoQuote(bidId: string): Promise<Ok | Err> {
  const { supabase, bid } = await bidRow(bidId);
  if (!bid) return { error: "That quote isn't visible to you." };
  const { data, error } = await supabase
    .from("ticket_bids")
    .update({ status: "withdrawn" })
    .eq("id", bidId)
    .in("status", ["requested", "received"])
    .select("id");
  if (error) return { error: dbError(error, { denied: BOARD_ONLY, context: "markNoQuote" }) };
  if (!data || data.length === 0) return { error: "Only a board member can change a quote, and only while it's waiting." };
  revalidateRepairs({ ticketId: bid.ticket_id, vendorId: bid.vendor_id });
  return { ok: true };
}

/** "Let {other} know": a polite not-chosen email, as a draft. */
export async function draftNotChosen(bidId: string): Promise<
  Ok<{ messageId: string; to: string[]; subject: string; body: string; existing: boolean }> | Err
> {
  const { supabase, bid } = await bidRow(bidId);
  if (!bid) return { error: "That quote isn't visible to you." };
  const [{ data: vendors }, { data: tickets }, basics] = await Promise.all([
    supabase.from("vendors").select("id, name, contact_name, email").eq("id", bid.vendor_id).limit(1),
    supabase.from("tickets").select("title").eq("id", bid.ticket_id).limit(1),
    loadDraftBasics(supabase, bid.association_id),
  ]);
  const vendor = vendors?.[0];
  if (!vendor || !tickets?.[0] || !basics) return { error: "That quote isn't visible to you." };
  const draft = notChosenDraft(
    { ...basics, contractor: { name: vendor.name, contactName: vendor.contact_name ?? null } },
    { title: tickets[0].title },
  );
  const stored = await insertContractorDraft(supabase, {
    associationId: bid.association_id,
    vendorId: vendor.id,
    ticketId: bid.ticket_id,
    kind: "general",
    toEmail: vendor.email ?? null,
    draft,
  });
  if ("error" in stored) return { error: dbError(stored.error, { denied: "Only a board member can write to contractors.", context: "draftNotChosen" }) };
  revalidateRepairs({ ticketId: bid.ticket_id, vendorId: vendor.id });
  return { ok: true, ...stored };
}

// ---------------------------------------------------------------------------
// Reading a quote (text layer or pasted text only; never a scan, §19)
// ---------------------------------------------------------------------------

type ReadResult = Ok<{ prefill: BidPrefill; confidence: number }> | { error: string; manual?: true; quota?: true };

async function readQuoteText(supabase: Awaited<ReturnType<typeof createClient>>, associationId: string, text: string): Promise<ReadResult> {
  const r = await runStructured({
    kind: "bid_read",
    supabase,
    associationId,
    system: BID_READ_SYSTEM,
    content: bidReadContent(text),
    schema: bidReadSchema,
    effort: "medium",
    maxTokens: 8000,
    timeoutMs: 90_000,
  });
  if (!r.ok) return r.quota ? { error: r.reason, quota: true } : { error: r.reason };
  return { ok: true, ...bidPrefillFrom(r.data) };
}

export async function readBidDocument(documentId: string): Promise<ReadResult> {
  if (!isUuid(documentId)) return { error: "That document isn't visible to you." };
  const supabase = await createClient();
  const { data: docs } = await supabase
    .from("documents")
    .select("id, association_id, storage_path, mime_type")
    .eq("id", documentId)
    .limit(1);
  const doc = docs?.[0];
  if (!doc) return { error: "That document isn't visible to you." };
  if (!(await isBoard(supabase, doc.association_id))) return { error: "Only a board member can read a quote." };

  const { data: blob, error } = await supabase.storage.from("documents").download(doc.storage_path);
  if (error || !blob) return { error: "Walkup couldn't open that file. Try again, or enter the figures by hand." };
  const extracted = await extractDocumentText(doc.mime_type ?? null, new Uint8Array(await blob.arrayBuffer()));
  if (!extracted.ok) {
    return {
      error: "This quote is a scan or a photo, so Walkup can't read it. Enter the figures by hand, or paste the text if you have it.",
      manual: true,
    };
  }
  return readQuoteText(supabase, doc.association_id, extracted.text);
}

/** A quote that came by text message or in an email body. Tax IDs are redacted before the model sees it. */
export async function readBidText(text: string): Promise<ReadResult> {
  const raw = String(text ?? "").trim();
  if (raw.length < BID_TEXT_MIN) return { error: "Paste at least a line of the quote." };
  if (raw.length > BID_TEXT_MAX) return { error: "That's longer than a quote. Paste just the quote." };
  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: NO_ASSOCIATION };
  if (!(await isBoard(supabase, associationId))) return { error: "Only a board member can read a quote." };
  return readQuoteText(supabase, associationId, redactTaxIds(raw).text);
}
