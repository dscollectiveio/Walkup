"use server";

import { createClient } from "@/lib/supabase/server";
import { buildingTodayIso } from "@/lib/dates";
import { humanDate } from "@/lib/repairs/format";
import { revalidateRepairs } from "@/lib/repairs/revalidate";
import {
  currentAssociationId,
  dbError,
  isUuid,
  NO_ASSOCIATION,
  SOMETHING_WRONG,
  type Err,
  type Ok,
} from "@/lib/repairs/server";
import { isoDate, moneyText } from "@/lib/repairs/validate";

/**
 * Recurring bills (repairs-spec §13.1). Walkup reminds; it never pays. Mark
 * paid records that the board paid at the provider and advances the next
 * due date in one RPC; the form sends the due date it showed, so a second
 * click is refused instead of marking the following period paid.
 */

const FREQUENCIES = ["monthly", "quarterly", "semiannual", "annual"] as const;
const BOARD_ONLY = "Only a board member can change bills.";
const NOT_VISIBLE = "That bill isn't visible to you.";

export interface BillInput {
  name: string;
  account_id: string;
  vendor_id: string | null;
  frequency: "monthly" | "quarterly" | "semiannual" | "annual";
  next_due_on: string;
  typical_amount: string | null;     // money text
  autopay_arranged: boolean;
  autopay_note: string | null;
  notes: string | null;
}

function parseBill(input: BillInput) {
  const name = String(input?.name ?? "").trim();
  if (!name) return { error: 'Give the bill a name, like "ComEd" or "Water".' };
  if (name.length > 120) return { error: "Keep the name under 120 characters." };
  if (!isUuid(input?.account_id)) return { error: "Choose the category it's paid from." };
  if (!(FREQUENCIES as readonly string[]).includes(input?.frequency)) return { error: "Choose how often it's due." };
  const due = isoDate.safeParse(input?.next_due_on ?? "");
  if (!due.success) return { error: "Enter when it's next due." };
  const vendorId = input?.vendor_id || null;
  if (vendorId !== null && !isUuid(vendorId)) return { error: "Choose who it's paid to." };
  const amount = moneyText.safeParse(input?.typical_amount ?? "");
  if (!amount.success) return { error: amount.error.issues[0]?.message ?? "Enter an amount in dollars." };
  const autopayNote = String(input?.autopay_note ?? "").trim() || null;
  const notes = String(input?.notes ?? "").trim() || null;
  if (autopayNote && autopayNote.length > 300) return { error: "Keep the autopay note under 300 characters." };
  if (notes && notes.length > 2000) return { error: "Keep the notes under 2,000 characters." };
  return {
    fields: {
      name,
      account_id: input.account_id,
      vendor_id: vendorId,
      frequency: input.frequency,
      next_due_on: due.data,
      typical_amount: amount.data,
      autopay_arranged: input.autopay_arranged === true,
      autopay_note: autopayNote,
      notes,
    },
  };
}

export async function addBill(input: BillInput): Promise<Ok<{ billId: string }> | Err> {
  const parsed = parseBill(input);
  if ("error" in parsed) return { error: parsed.error as string };
  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: NO_ASSOCIATION };
  const { data: funds } = await supabase
    .from("funds")
    .select("id")
    .eq("association_id", associationId)
    .eq("kind", "operating")
    .limit(1);
  const fundId = funds?.[0]?.id;
  if (!fundId) return { error: "No operating fund is visible to you." };

  const { data, error } = await supabase
    .from("recurring_bills")
    .insert({
      association_id: associationId,
      fund_id: fundId,
      ...parsed.fields,
      due_day: Number(parsed.fields.next_due_on.slice(8, 10)),
    })
    .select("id");
  if (error) return { error: dbError(error, { denied: BOARD_ONLY, context: "addBill" }) };
  const billId = data?.[0]?.id as string | undefined;
  if (!billId) return { error: BOARD_ONLY };
  revalidateRepairs();
  return { ok: true, billId };
}

export async function updateBill(billId: string, input: BillInput): Promise<Ok | Err> {
  if (!isUuid(billId)) return { error: NOT_VISIBLE };
  const parsed = parseBill(input);
  if ("error" in parsed) return { error: parsed.error as string };
  const supabase = await createClient();
  const { data: rows } = await supabase.from("recurring_bills").select("id, next_due_on").eq("id", billId).limit(1);
  const current = rows?.[0];
  if (!current) return { error: NOT_VISIBLE };
  const dateChanged = current.next_due_on !== parsed.fields.next_due_on;
  // insurance_policy_id is never sent, so editing a premium bill keeps its policy link (insurance-spec §12 R-2).
  const { data, error } = await supabase
    .from("recurring_bills")
    .update({ ...parsed.fields, ...(dateChanged ? { due_day: Number(parsed.fields.next_due_on.slice(8, 10)) } : {}) })
    .eq("id", billId)
    .select("id");
  if (error) return { error: dbError(error, { denied: BOARD_ONLY, context: "updateBill" }) };
  if (!data || data.length === 0) return { error: BOARD_ONLY };
  revalidateRepairs();
  return { ok: true };
}

/** Paused bills stay listed but leave reminders (a seasonal contract, a disputed bill). */
export async function setBillPaused(billId: string, paused: boolean, note?: string | null): Promise<Ok | Err> {
  if (!isUuid(billId)) return { error: NOT_VISIBLE };
  const text = String(note ?? "").trim() || null;
  if (text && text.length > 200) return { error: "Keep the note under 200 characters." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recurring_bills")
    .update(paused ? { paused_at: new Date().toISOString(), paused_note: text } : { paused_at: null, paused_note: null })
    .eq("id", billId)
    .select("id");
  if (error) return { error: dbError(error, { denied: BOARD_ONLY, context: "setBillPaused" }) };
  if (!data || data.length === 0) return { error: BOARD_ONLY };
  revalidateRepairs();
  return { ok: true };
}

export async function markBillPaid(
  billId: string,
  input: { due_on: string | null; paid_on: string; amount: string | null; note: string | null },
): Promise<Ok<{ nextDueOn: string | null }> | (Err & { nextDueOn?: string | null })> {
  if (!isUuid(billId)) return { error: NOT_VISIBLE };
  const paid = isoDate.safeParse(input?.paid_on ?? "");
  if (!paid.success) return { error: "Pick the date it was paid." };
  const due = input?.due_on ? isoDate.safeParse(input.due_on) : null;
  if (due && !due.success) return { error: "Refresh the page and try again." };
  const amount = moneyText.safeParse(input?.amount ?? "");
  if (!amount.success) return { error: amount.error.issues[0]?.message ?? "Enter an amount in dollars." };
  const note = String(input?.note ?? "").trim() || null;
  if (note && note.length > 300) return { error: "Keep the note under 300 characters." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_bill_paid", {
    p_bill_id: billId,
    p_due_on: due?.data ?? null,
    p_paid_on: paid.data,
    p_amount: amount.data,
    p_note: note,
  });
  if (error) {
    if (error.code === "23505") {
      // A second click, or another board member: say so and hand back the current due date for the sheet.
      const { data: rows } = await supabase.from("recurring_bills").select("next_due_on").eq("id", billId).limit(1);
      const shown = due?.data ?? null;
      revalidateRepairs();
      return {
        error: shown ? `Already marked paid for ${humanDate(shown, buildingTodayIso())}.` : "Already marked paid.",
        nextDueOn: (rows?.[0]?.next_due_on as string | null | undefined) ?? null,
      };
    }
    return { error: dbError(error, { denied: "Only a board member can mark a bill paid.", context: "mark_bill_paid" }) };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { bill_next_due_on?: string | null } | null;
  if (!row) return { error: SOMETHING_WRONG };
  revalidateRepairs();
  // Null: a premium bill the renewal has taken over retired, so nothing further is due on it.
  return { ok: true, nextDueOn: row.bill_next_due_on ?? null };
}

async function setActive(billId: string, active: boolean): Promise<Ok | Err> {
  if (!isUuid(billId)) return { error: NOT_VISIBLE };
  const supabase = await createClient();
  const { data, error } = await supabase.from("recurring_bills").update({ is_active: active }).eq("id", billId).select("id");
  if (error) return { error: dbError(error, { denied: BOARD_ONLY, context: active ? "restoreBill" : "archiveBill" }) };
  if (!data || data.length === 0) return { error: BOARD_ONLY };
  revalidateRepairs();
  return { ok: true };
}

export async function archiveBill(billId: string): Promise<Ok | Err> {
  return setActive(billId, false);
}

export async function restoreBill(billId: string): Promise<Ok | Err> {
  return setActive(billId, true);
}
