"use server";

import { VENDOR_MANAGER_VIEW } from "@/lib/contractors/vendor-source";
import { after } from "next/server";
import type { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { aiConfigured } from "@/lib/ai/client";
import { aiFailure } from "@/lib/ai/errors";
import { guessTradeFromText } from "@/lib/contractors/trades";
import { buildingTodayIso } from "@/lib/dates";
import { detectEmergency, EMERGENCY_KINDS, type EmergencyKind } from "@/lib/repairs/emergency";
import { humanDate } from "@/lib/repairs/format";
import { revalidateRepairs } from "@/lib/repairs/revalidate";
import {
  currentAssociationId,
  currentPersonId,
  canReadFinancials,
  dbError,
  firstIssue,
  canManageRepairs,
  isUuid,
  NO_ASSOCIATION,
  SOMETHING_WRONG,
  type Err,
  type Ok,
  type Supabase,
} from "@/lib/repairs/server";
import { recordTriage, triageAndRecord, triageTicket } from "@/lib/repairs/triage";
import {
  closeOutSchema,
  isoDate,
  ticketDetailsSchema,
  ticketPlanSchema,
  ticketReportSchema,
  type StoredTriage,
  type TicketReportInput,
} from "@/lib/repairs/validate";

/**
 * Ticket actions (repairs-spec §5.1). The association is always the
 * caller's own (DECISIONS #11); reporter, author and times come from the
 * database triggers, never from here; every multi-row write is one RPC.
 */

const OPEN_STATUSES = ["open", "in_progress", "waiting_on_contractor"] as const;
const NOT_VISIBLE = "That problem isn't visible to you.";
const BOARD_ONLY = "Only a board member can do this.";

interface TicketRow {
  id: string;
  association_id: string;
  unit_id: string | null;
  reported_by: string | null;
  status: string;
  priority: string;
  title: string;
  description: string | null;
  location_detail: string | null;
  access_notes: string | null;
  trade: string | null;
  emergency_kind: string | null;
  assigned_vendor_id: string | null;
  upkeep_task_id: string | null;
  created_at: string;
}

const TICKET_COLUMNS =
  "id, association_id, unit_id, reported_by, status, priority, title, description, location_detail, access_notes, trade, emergency_kind, assigned_vendor_id, upkeep_task_id, created_at";

async function loadTicket(supabase: Supabase, ticketId: string): Promise<TicketRow | null> {
  if (!isUuid(ticketId)) return null;
  const { data } = await supabase.from("tickets").select(TICKET_COLUMNS).eq("id", ticketId).limit(1);
  return (data?.[0] as TicketRow | undefined) ?? null;
}

/** A stored note's date: "Thu, Oct 22" (or "Oct 22, 2027"), never "tomorrow", which goes stale. */
function noteDate(dateIso: string): string {
  const year = dateIso.slice(0, 4);
  const month = Number(dateIso.slice(5, 7));
  return humanDate(dateIso, month < 7 ? `${year}-12-31` : `${year}-01-01`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/** Problems one person may report in 24 hours. */
const TICKETS_PER_PERSON_PER_DAY = 25;

export async function createTicket(input: TicketReportInput): Promise<
  Ok<{ ticketId: string; reference: number; emergency: EmergencyKind | null; alreadyExisted: boolean }> | Err
> {
  const parsed = ticketReportSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;

  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: NO_ASSOCIATION };

  // The deterministic rules decide an emergency, and only when the reporter
  // says it is happening now (§7.1). The reporter never picks a trade.
  const text = [v.title, v.description ?? "", v.location_detail ?? ""].join(" ");
  const rule = detectEmergency(text, new Date());
  let priority = v.priority;
  let emergencyKind: EmergencyKind | null = null;
  let trade: string | null;
  if (rule && v.emergencyConfirmed) {
    priority = "urgent";
    emergencyKind = rule.kind;
    trade = rule.trade;
  } else {
    trade = guessTradeFromText(text);
  }

  // A retried submit: the same key already made this ticket.
  const existingTicket = async () => {
    const { data: existing } = await supabase
      .from("tickets")
      .select("id, reference, emergency_kind")
      .eq("association_id", associationId)
      .eq("client_key", v.clientKey)
      .limit(1);
    const row = existing?.[0];
    return row
      ? {
          ok: true as const,
          ticketId: row.id,
          reference: row.reference,
          emergency: (row.emergency_kind as EmergencyKind | null) ?? null,
          alreadyExisted: true,
        }
      : null;
  };

  // A ceiling per person per day: each ticket can queue a triage call and up to 20 photos (REVIEW-2 #26).
  const { data: me } = await supabase.auth.getUser();
  if (me.user) {
    const { data: mine } = await supabase
      .from("persons")
      .select("id")
      .eq("association_id", associationId)
      .eq("auth_user_id", me.user.id)
      .limit(1);
    if (mine?.[0]) {
      const { count } = await supabase
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .eq("association_id", associationId)
        .eq("reported_by", mine[0].id)
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
      if ((count ?? 0) >= TICKETS_PER_PERSON_PER_DAY) {
        return (await existingTicket()) ?? { error: "That's a lot of problems for one day. Ask the board to add more, or try again tomorrow." };
      }
    }
  }

  const { data, error } = await supabase
    .from("tickets")
    .insert({
      association_id: associationId,
      title: v.title,
      description: v.description,
      unit_id: v.where === "shared" ? null : v.where,
      location_detail: v.location_detail,
      access_notes: v.access_notes,
      priority,
      emergency_kind: emergencyKind,
      trade,
      client_key: v.clientKey,
    })
    .select("id, reference, emergency_kind");

  if (error) {
    if (error.code === "23505") {
      const dup = await existingTicket();
      if (dup) return dup;
    }
    return { error: dbError(error, { denied: "You can report problems in shared areas or in your own unit.", context: "createTicket" }) };
  }
  const row = data?.[0];
  if (!row) return { error: SOMETHING_WRONG };

  if (aiConfigured()) {
    // The per-reporter cap is applied inside triageAndRecord (§7.2).
    after(() => triageAndRecord(row.id));
  }

  revalidateRepairs({ ticketId: row.id });
  return {
    ok: true,
    ticketId: row.id,
    reference: row.reference,
    emergency: (row.emergency_kind as EmergencyKind | null) ?? null,
    alreadyExisted: false,
  };
}

// ---------------------------------------------------------------------------
// Board edits
// ---------------------------------------------------------------------------

export async function updateTicketDetails(ticketId: string, input: z.input<typeof ticketDetailsSchema>): Promise<Ok | Err> {
  const parsed = ticketDetailsSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;

  const supabase = await createClient();
  const ticket = await loadTicket(supabase, ticketId);
  if (!ticket) return { error: NOT_VISIBLE };
  if (!(await canManageRepairs(supabase, ticket.association_id))) return { error: "Only a board member can edit a problem." };

  const unitId = v.where === "shared" ? null : v.where;
  let accessNotes = v.access_notes;
  if (ticket.unit_id !== null && unitId === null && (accessNotes ?? "").trim()) {
    if (!v.accessNotesWhenShared) {
      return { error: "Decide what happens to the access notes before sharing this problem with every owner." };
    }
    if (v.accessNotesWhenShared === "clear") accessNotes = null;
  }

  // Urgency goes through its RPC: lowering an owner's report needs a reason they will read.
  if (v.priority !== ticket.priority) {
    const { error } = await supabase.rpc("set_ticket_priority", {
      p_ticket_id: ticketId,
      p_priority: v.priority,
      p_reason: v.priorityReason,
    });
    if (error) {
      if (error.hint === "reason_required") {
        let who = "The person who reported it";
        if (ticket.reported_by) {
          const { data: p } = await supabase.from("persons").select("full_name").eq("id", ticket.reported_by).limit(1);
          const first = (p?.[0]?.full_name as string | undefined)?.trim().split(/\s+/)[0];
          if (first) who = first;
        }
        return { error: `Say why you're lowering the urgency. ${who} will see it.` };
      }
      return { error: dbError(error, { denied: "Only a board member can change the urgency.", context: "set_ticket_priority" }) };
    }
  }

  // One statement; the photo re-pin trigger runs in it when the unit changes.
  const { data, error } = await supabase
    .from("tickets")
    .update({
      title: v.title,
      description: v.description || null,
      unit_id: unitId,
      location_detail: v.location_detail || null,
      access_notes: accessNotes || null,
      trade: v.trade,
      emergency_kind: v.emergency_kind,
    })
    .eq("id", ticketId)
    .select("id");
  if (error) return { error: dbError(error, { denied: "Only a board member can edit a problem.", context: "updateTicketDetails" }) };
  if (!data || data.length === 0) return { error: "Only a board member can edit a problem." };

  revalidateRepairs({ ticketId });
  return { ok: true };
}

export async function setTicketPlan(ticketId: string, input: z.input<typeof ticketPlanSchema>): Promise<Ok | Err> {
  const parsed = ticketPlanSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const fields: Record<string, string | null> = {};
  for (const [k, value] of Object.entries(parsed.data)) {
    if (value !== undefined) fields[k] = value === "" ? null : value;
  }
  if (Object.keys(fields).length === 0) return { ok: true };

  const supabase = await createClient();
  if (!isUuid(ticketId)) return { error: NOT_VISIBLE };

  if (fields.assigned_vendor_id) {
    // vendors_manager: the same rows for the board, and the only contractor read a property manager has (0081).
    const { data: vendors } = await supabase
      .from(VENDOR_MANAGER_VIEW)
      .select("name, status, do_not_use_reason, archived_at")
      .eq("id", fields.assigned_vendor_id)
      .limit(1);
    const vendor = vendors?.[0];
    if (!vendor) return { error: "That contractor isn't visible to you." };
    if (vendor.status === "do_not_use") {
      return {
        error: `The board marked ${vendor.name} as do not use: ${vendor.do_not_use_reason ?? "no reason recorded"}. Change their status first if you want to use them.`,
      };
    }
    if (vendor.archived_at) return { error: `${vendor.name} is archived. Restore them first.` };
  }

  const { error } = await supabase.rpc("set_ticket_plan", { p_ticket_id: ticketId, p_fields: fields });
  if (error) return { error: dbError(error, { denied: "Only a board member can plan this.", context: "set_ticket_plan" }) };

  revalidateRepairs({ ticketId, vendorId: fields.assigned_vendor_id ?? undefined });
  return { ok: true };
}

/** Open, being worked on, waiting on the contractor. Done goes through closeOutTicket. */
export async function setTicketStatus(ticketId: string, status: "open" | "in_progress" | "waiting_on_contractor"): Promise<Ok | Err> {
  if (!(OPEN_STATUSES as readonly string[]).includes(status)) return { error: "Use Mark fixed to finish a problem." };
  if (!isUuid(ticketId)) return { error: NOT_VISIBLE };
  const supabase = await createClient();
  // resolved_at is never sent: the trigger owns it.
  const { data, error } = await supabase.from("tickets").update({ status }).eq("id", ticketId).select("id");
  if (error) return { error: dbError(error, { denied: "Only a board member can change the status.", context: "setTicketStatus" }) };
  if (!data || data.length === 0) return { error: "Only a board member can change the status." };
  revalidateRepairs({ ticketId });
  return { ok: true };
}

export async function closeOutTicket(ticketId: string, input: z.input<typeof closeOutSchema>): Promise<
  Ok<{ reviewPrompt: { vendorId: string; vendorName: string } | null; upkeepLogged: boolean; nextDueOn: string | null }> | Err
> {
  const parsed = closeOutSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;
  const supabase = await createClient();
  const ticket = await loadTicket(supabase, ticketId);
  if (!ticket) return { error: NOT_VISIBLE };

  const { data, error } = await supabase.rpc("close_out_ticket", {
    p_ticket_id: ticketId,
    p_status: v.status,
    p_actual_cost: v.actual_cost,
    p_expense_id: v.expense_id,
    p_resolution_note: v.resolution_note,
    p_log_upkeep: v.log_upkeep,
  });
  if (error) return { error: dbError(error, { denied: "Only a board member can mark a problem fixed.", context: "close_out_ticket" }) };
  const result = (Array.isArray(data) ? data[0] : data) as { upkeep_logged?: boolean; task_next_due_on?: string | null } | null;

  let reviewPrompt: { vendorId: string; vendorName: string } | null = null;
  if (ticket.assigned_vendor_id) {
    const [{ data: auth }, { data: vendors }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from(VENDOR_MANAGER_VIEW).select("id, name").eq("id", ticket.assigned_vendor_id).limit(1),
    ]);
    const userId = auth?.user?.id;
    const vendor = vendors?.[0];
    if (vendor && userId) {
      const { data: reviews } = await supabase
        .from("contractor_reviews")
        .select("id")
        .eq("vendor_id", vendor.id)
        .eq("ticket_id", ticketId)
        .eq("created_by", userId)
        .limit(1);
      if (!reviews || reviews.length === 0) reviewPrompt = { vendorId: vendor.id, vendorName: vendor.name };
    }
  }

  revalidateRepairs({ ticketId, taskId: ticket.upkeep_task_id ?? undefined, vendorId: ticket.assigned_vendor_id ?? undefined });
  return {
    ok: true,
    reviewPrompt,
    upkeepLogged: result?.upkeep_logged === true,
    nextDueOn: result?.task_next_due_on ?? null,
  };
}

/** Today's "Close all": fixed problems nobody reopened in 30 days. */
export async function closeFixedTickets(ticketIds: string[]): Promise<Ok<{ closed: number }> | Err> {
  const ids = [...new Set((ticketIds ?? []).filter(isUuid))].slice(0, 50);
  if (ids.length === 0) return { ok: true, closed: 0 };
  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: NO_ASSOCIATION };
  if (!(await canManageRepairs(supabase, associationId))) return { error: "Only a board member can close problems." };

  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("tickets")
    .update({ status: "closed" })
    .in("id", ids)
    .eq("status", "resolved")
    .lt("resolved_at", cutoff)
    .select("id");
  if (error) return { error: dbError(error, { denied: "Only a board member can close problems.", context: "closeFixedTickets" }) };
  revalidateRepairs();
  return { ok: true, closed: (data ?? []).length };
}

export async function markDuplicate(ticketId: string, originalReference: number): Promise<Ok | Err> {
  if (!isUuid(ticketId)) return { error: NOT_VISIBLE };
  const ref = Number(originalReference);
  if (!Number.isInteger(ref) || ref < 1) return { error: "Enter the number of the problem it duplicates, like 12." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_ticket_duplicate", { p_ticket_id: ticketId, p_original_reference: ref });
  if (error) return { error: dbError(error, { denied: BOARD_ONLY, context: "mark_ticket_duplicate" }) };
  revalidateRepairs({ ticketId });
  if (typeof data === "string") revalidateRepairs({ ticketId: data });
  return { ok: true };
}

export async function closeForOwner(ticketId: string, note: string): Promise<Ok | Err> {
  if (!isUuid(ticketId)) return { error: NOT_VISIBLE };
  const text = String(note ?? "").trim();
  if (!text) return { error: "Write a short note to the owner." };
  if (text.length > 2000) return { error: "Keep the note under 2,000 characters." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_ticket_for_owner", { p_ticket_id: ticketId, p_note: text });
  if (error) return { error: dbError(error, { denied: BOARD_ONLY, context: "close_ticket_for_owner" }) };
  revalidateRepairs({ ticketId });
  return { ok: true };
}

/** Board: mark (or clear) an emergency. Marking makes it urgent; clearing leaves the urgency alone. */
export async function markEmergency(ticketId: string, kind: EmergencyKind | null): Promise<Ok | Err> {
  if (!isUuid(ticketId)) return { error: NOT_VISIBLE };
  if (kind !== null && !(EMERGENCY_KINDS as readonly string[]).includes(kind)) return { error: "Choose what kind of emergency it is." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tickets")
    .update(kind ? { emergency_kind: kind, priority: "urgent" } : { emergency_kind: null })
    .eq("id", ticketId)
    .select("id");
  if (error) return { error: dbError(error, { denied: BOARD_ONLY, context: "markEmergency" }) };
  if (!data || data.length === 0) return { error: BOARD_ONLY };
  revalidateRepairs({ ticketId });
  return { ok: true };
}

/** Board: the AI's "possible emergency" isn't one. A later suggestion shows again only if it is newer. */
export async function dismissEmergencySuggestion(ticketId: string): Promise<Ok | Err> {
  const supabase = await createClient();
  const ticket = await loadTicket(supabase, ticketId);
  if (!ticket) return { error: NOT_VISIBLE };
  const { error } = await supabase
    .from("ticket_board_details")
    .upsert(
      { ticket_id: ticketId, association_id: ticket.association_id, emergency_suggestion_dismissed_at: new Date().toISOString() },
      { onConflict: "ticket_id" },
    );
  if (error) return { error: dbError(error, { denied: BOARD_ONLY, context: "dismissEmergencySuggestion" }) };
  revalidateRepairs({ ticketId });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

function noteBody(body: string | null | undefined): string | { error: string } {
  const t = String(body ?? "").trim();
  if (!t) return { error: "Write something first." };
  if (t.length > 4000) return { error: "Keep the note under 4,000 characters." };
  return t;
}

export async function addComment(ticketId: string, body: string, isInternal: boolean): Promise<Ok | Err> {
  const text = noteBody(body);
  if (typeof text !== "string") return text;
  const supabase = await createClient();
  const ticket = await loadTicket(supabase, ticketId);
  if (!ticket) return { error: NOT_VISIBLE };
  // person_id and created_at are the trigger's.
  const { error } = await supabase.from("ticket_comments").insert({
    association_id: ticket.association_id,
    ticket_id: ticketId,
    body: text,
    is_internal: isInternal === true,
  });
  if (error) {
    const denied = isInternal ? "Only the board can add internal notes." : "You can't add notes to this problem.";
    return { error: dbError(error, { denied, context: "addComment" }) };
  }
  revalidateRepairs({ ticketId });
  return { ok: true };
}

/** "I'm seeing this too" on a shared-area problem, once per person. */
export async function addMeToo(ticketId: string, body: string | null): Promise<Ok | Err> {
  const supabase = await createClient();
  const ticket = await loadTicket(supabase, ticketId);
  if (!ticket) return { error: NOT_VISIBLE };
  if (ticket.unit_id !== null) return { error: "This is for problems in shared areas." };
  const me = await currentPersonId(supabase, ticket.association_id);
  if (me && ticket.reported_by === me) return { error: "You reported this one, so the board already knows." };
  const text = body === null || !String(body).trim() ? "I'm seeing this too." : noteBody(body);
  if (typeof text !== "string") return text;
  const { error } = await supabase.from("ticket_comments").insert({
    association_id: ticket.association_id,
    ticket_id: ticketId,
    body: text,
    is_internal: false,
    kind: "me_too",
  });
  if (error) {
    return { error: dbError(error, { denied: "You can't add to this problem.", duplicate: "You've already said you're seeing this.", context: "addMeToo" }) };
  }
  revalidateRepairs({ ticketId });
  return { ok: true };
}

/** The reporter's "How did the visit go?" on a fixed or closed problem. */
export async function addVisitFeedback(ticketId: string, body: string): Promise<Ok | Err> {
  const text = noteBody(body);
  if (typeof text !== "string") return text;
  const supabase = await createClient();
  const ticket = await loadTicket(supabase, ticketId);
  if (!ticket) return { error: NOT_VISIBLE };
  const me = await currentPersonId(supabase, ticket.association_id);
  if (!me || ticket.reported_by !== me) return { error: "Only the person who reported it can say how the visit went." };
  const { error } = await supabase.from("ticket_comments").insert({
    association_id: ticket.association_id,
    ticket_id: ticketId,
    body: text,
    is_internal: false,
    kind: "visit_feedback",
  });
  if (error) return { error: dbError(error, { denied: "You can't add to this problem.", context: "addVisitFeedback" }) };
  revalidateRepairs({ ticketId });
  return { ok: true };
}

export async function editComment(commentId: string, body: string): Promise<Ok | Err> {
  if (!isUuid(commentId)) return { error: "That note isn't visible to you." };
  const text = noteBody(body);
  if (typeof text !== "string") return text;
  const supabase = await createClient();
  const { data, error } = await supabase.from("ticket_comments").update({ body: text }).eq("id", commentId).select("id, ticket_id");
  if (error) return { error: dbError(error, { denied: "You can only edit your own notes.", context: "editComment" }) };
  if (!data || data.length === 0) return { error: "You can only edit your own notes." };
  revalidateRepairs({ ticketId: data[0].ticket_id });
  return { ok: true };
}

export async function deleteComment(commentId: string): Promise<Ok | Err> {
  if (!isUuid(commentId)) return { error: "That note isn't visible to you." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("ticket_comments").delete().eq("id", commentId).select("id, ticket_id");
  if (error) return { error: dbError(error, { denied: "Only a board admin can delete a note.", context: "deleteComment" }) };
  if (!data || data.length === 0) return { error: "Only a board admin can delete a note." };
  revalidateRepairs({ ticketId: data[0].ticket_id });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reopen, confirm
// ---------------------------------------------------------------------------

export async function reopenTicket(ticketId: string, reason: string): Promise<Ok | Err> {
  if (!isUuid(ticketId)) return { error: NOT_VISIBLE };
  const text = String(reason ?? "").trim();
  if (!text) return { error: "Say what's still wrong." };
  if (text.length > 2000) return { error: "Keep it under 2,000 characters." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_ticket", { p_ticket_id: ticketId, p_reason: text });
  if (error) {
    return { error: dbError(error, { denied: "Only the board, or the person who reported it within 30 days of the fix, can reopen it.", context: "reopen_ticket" }) };
  }
  revalidateRepairs({ ticketId });
  return { ok: true };
}

export async function confirmFixed(ticketId: string): Promise<Ok | Err> {
  if (!isUuid(ticketId)) return { error: NOT_VISIBLE };
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_ticket_fixed", { p_ticket_id: ticketId });
  if (error) return { error: dbError(error, { denied: "Only the board or the person who reported it can confirm it.", context: "confirm_ticket_fixed" }) };
  revalidateRepairs({ ticketId });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Triage, upkeep, money, owners
// ---------------------------------------------------------------------------

/** Board: "Suggest again". The building-wide limit applies; the per-reporter cap doesn't. */
export async function retriageTicket(ticketId: string): Promise<Ok<{ triage: StoredTriage }> | Err> {
  const supabase = await createClient();
  const ticket = await loadTicket(supabase, ticketId);
  if (!ticket) return { error: NOT_VISIBLE };
  if (!(await canManageRepairs(supabase, ticket.association_id))) return { error: BOARD_ONLY };
  if (!aiConfigured()) return { error: aiFailure("not_configured", "ticket_triage").reason };

  const triage = await triageTicket({
    supabase,
    associationId: ticket.association_id,
    title: ticket.title,
    description: ticket.description,
    locationDetail: ticket.location_detail,
    isSharedArea: ticket.unit_id === null,
  });
  const err = await recordTriage(supabase, ticketId, triage);
  if (err) return { error: dbError(err, { denied: BOARD_ONLY, context: "record_ticket_triage" }) };
  revalidateRepairs({ ticketId });
  return { ok: true, triage };
}

/** "Turn into a problem". Twice, or from two devices, gives the same open problem. */
export async function createTicketFromUpkeep(taskId: string): Promise<Ok<{ ticketId: string }> | Err> {
  if (!isUuid(taskId)) return { error: "That upkeep job isn't visible to you." };
  const supabase = await createClient();
  const { data: tasks } = await supabase
    .from("upkeep_tasks")
    .select("id, association_id, name, description, trade, vendor_id, estimated_cost::text")
    .eq("id", taskId)
    .limit(1);
  const task = tasks?.[0];
  if (!task) return { error: "That upkeep job isn't visible to you." };
  if (!(await canManageRepairs(supabase, task.association_id))) return { error: "Only a board member can turn upkeep into a problem." };

  // The usual contractor's status, by id: an embed would read the vendors table, which a property manager does not (0081).
  const usual = task.vendor_id
    ? ((await supabase.from(VENDOR_MANAGER_VIEW).select("status, archived_at").eq("id", task.vendor_id).limit(1)).data?.[0] as
        | { status?: string; archived_at?: string | null }
        | undefined) ?? null
    : null;
  const vendorUsable = task.vendor_id && usual && usual.status !== "do_not_use" && !usual.archived_at;
  const name = String(task.name ?? "").trim();
  const title = (name.length >= 4 ? name : `Upkeep: ${name}`).slice(0, 120);

  const { data, error } = await supabase
    .from("tickets")
    .insert({
      association_id: task.association_id,
      title,
      description: task.description ?? null,
      trade: task.trade ?? null,
      unit_id: null,
      priority: "normal",
      upkeep_task_id: taskId,
      assigned_vendor_id: vendorUsable ? task.vendor_id : null,
    })
    .select("id");
  if (error) {
    if (error.code === "23505") {
      const { data: open } = await supabase
        .from("tickets")
        .select("id")
        .eq("upkeep_task_id", taskId)
        .in("status", OPEN_STATUSES as unknown as string[])
        .limit(1);
      if (open?.[0]) return { ok: true, ticketId: open[0].id };
    }
    return { error: dbError(error, { denied: "Only a board member can turn upkeep into a problem.", context: "createTicketFromUpkeep" }) };
  }
  const ticketId = data?.[0]?.id as string | undefined;
  if (!ticketId) return { error: SOMETHING_WRONG };

  // The one place two writes remain (§5.1): the estimate is a copy of the
  // task's; if it fails the problem still exists and the plan card shows it empty.
  if (task.estimated_cost) {
    const { error: planError } = await supabase.rpc("set_ticket_plan", {
      p_ticket_id: ticketId,
      p_fields: { estimated_cost: task.estimated_cost },
    });
    if (planError) console.error("[repairs] upkeep estimate", planError.code ?? "-", planError.message ?? "");
  }

  revalidateRepairs({ ticketId, taskId });
  return { ok: true, ticketId };
}

/** Payments to pick from when linking one: the assigned contractor's in the last 120 days, else the newest. */
export async function recentExpensesForTicket(ticketId: string): Promise<
  Ok<{ expenses: { id: string; paid_on: string; amount: string; memo: string | null; vendor_name: string | null }[] }> | Err
> {
  const supabase = await createClient();
  const ticket = await loadTicket(supabase, ticketId);
  if (!ticket) return { error: NOT_VISIBLE };
  if (!(await canReadFinancials(supabase, ticket.association_id))) return { error: "Only the board and the accountant can see payments." };

  let q = supabase
    .from("expenses")
    .select("id, paid_on, amount::text, memo, vendors(name)")
    .eq("association_id", ticket.association_id);
  if (ticket.assigned_vendor_id) {
    const today = buildingTodayIso();
    const [y, m, d] = today.split("-").map(Number);
    const from = new Date(Date.UTC(y, m - 1, d - 120)).toISOString().slice(0, 10);
    q = q.eq("vendor_id", ticket.assigned_vendor_id).gte("paid_on", from);
  }
  const { data, error } = await q.order("paid_on", { ascending: false }).limit(20);
  if (error) return { error: dbError(error, { denied: "Only the board and the accountant can see payments.", context: "recentExpensesForTicket" }) };
  return {
    ok: true,
    expenses: (data ?? []).map((e) => ({
      id: e.id as string,
      paid_on: e.paid_on as string,
      amount: e.amount as string,
      memo: (e.memo as string | null) ?? null,
      vendor_name: ((e.vendors as { name?: string } | null)?.name as string | undefined) ?? null,
    })),
  };
}

/**
 * Who to tell about a visit. A unit problem: that unit's current owners. A
 * shared-area problem: every current owner, in Bcc, with the sender in To so
 * owners don't see each other's addresses.
 */
export async function ownerNoticeRecipients(ticketId: string): Promise<
  Ok<{ to: string[]; bcc: string[]; ownersWithoutEmail: number; needsUnitAccess: boolean }> | Err
> {
  const supabase = await createClient();
  const ticket = await loadTicket(supabase, ticketId);
  if (!ticket) return { error: NOT_VISIBLE };
  if (!(await canManageRepairs(supabase, ticket.association_id))) return { error: BOARD_ONLY };

  const today = buildingTodayIso();
  let q = supabase
    .from("unit_owners")
    .select("person_id, effective_from, effective_to, persons(email)")
    .eq("association_id", ticket.association_id)
    .lte("effective_from", today)
    .or(`effective_to.is.null,effective_to.gte.${today}`);
  if (ticket.unit_id) q = q.eq("unit_id", ticket.unit_id);
  const { data, error } = await q;
  if (error) return { error: dbError(error, { denied: BOARD_ONLY, context: "ownerNoticeRecipients" }) };

  const byPerson = new Map<string, string | null>();
  for (const r of data ?? []) {
    const email = ((r.persons as { email?: string | null } | null)?.email ?? "").trim() || null;
    if (!byPerson.has(r.person_id) || email) byPerson.set(r.person_id, email);
  }
  const emails = [...new Set([...byPerson.values()].filter((e): e is string => Boolean(e)))];
  const ownersWithoutEmail = [...byPerson.values()].filter((e) => !e).length;

  if (ticket.unit_id) {
    return { ok: true, to: emails, bcc: [], ownersWithoutEmail, needsUnitAccess: true };
  }
  const { data: auth } = await supabase.auth.getUser();
  let senderEmail: string | null = null;
  if (auth?.user?.id) {
    const { data: me } = await supabase
      .from("persons")
      .select("email")
      .eq("association_id", ticket.association_id)
      .eq("auth_user_id", auth.user.id)
      .limit(1);
    senderEmail = (me?.[0]?.email as string | null)?.trim() || auth.user.email || null;
  }
  return {
    ok: true,
    to: senderEmail ? [senderEmail] : [],
    bcc: emails.filter((e) => e.toLowerCase() !== senderEmail?.toLowerCase()),
    ownersWithoutEmail,
    needsUnitAccess: false,
  };
}

/** After the notice is marked sent: a note the reporter and owners see. */
export async function markOwnersTold(ticketId: string, visitDate: string): Promise<Ok | Err> {
  const date = isoDate.safeParse(visitDate);
  if (!date.success) return { error: "Set the visit date first." };
  const supabase = await createClient();
  const ticket = await loadTicket(supabase, ticketId);
  if (!ticket) return { error: NOT_VISIBLE };
  if (!(await canManageRepairs(supabase, ticket.association_id))) return { error: BOARD_ONLY };
  const { error } = await supabase.from("ticket_comments").insert({
    association_id: ticket.association_id,
    ticket_id: ticketId,
    body: `Owners were told about the visit on ${noteDate(date.data)}.`,
    is_internal: false,
  });
  if (error) return { error: dbError(error, { denied: BOARD_ONLY, context: "markOwnersTold" }) };
  revalidateRepairs({ ticketId });
  return { ok: true };
}

/** Records this visit to /repairs; returns the "since" moment for "New since your last visit". */
export async function markRepairsSeen(): Promise<Ok<{ since: string | null }> | Err> {
  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: NO_ASSOCIATION };
  const { data, error } = await supabase.rpc("mark_repairs_seen", { p_association_id: associationId });
  if (error) return { error: dbError(error, { denied: "Members of this building only.", context: "mark_repairs_seen" }) };
  return { ok: true, since: typeof data === "string" ? data : null };
}
