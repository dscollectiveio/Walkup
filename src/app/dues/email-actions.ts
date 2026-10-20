"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getViewer, type Viewer } from "@/lib/owner/viewer";
import { buildingTodayIso } from "@/lib/dates";
import { notConfiguredCopy, sendConfig } from "@/lib/email-outbox/config";
import { boardSessionDeps, senderSite } from "@/lib/email-outbox/deps";
import { runSender } from "@/lib/email-outbox/send-batch";
import {
  ADMIN_ONLY,
  BOARD_ONLY_PREPARE,
  SOMETHING_WRONG,
  countsFromRows,
  isUuid,
  mapDbError,
  parseRuleInput,
  validateDailyCap,
  validateEmailAddress,
  validateNote,
  validateUnitIds,
  type Counts,
  type RuleFieldErrors,
  type RuleInput,
} from "@/lib/email-outbox/actions-core";
import { parsePeriod } from "@/lib/statements/period";
import { loadCollections } from "@/lib/collections/data";
import { previewRule, previewSentence } from "@/lib/collections/rule-preview";
import { centsFromNumeric } from "@/lib/collections/build";

/**
 * Email server actions (money spec 6). Each one starts from the caller's own
 * session and their own association (never an id from the browser), checks the
 * role for a clear message, and lets the database make the real decision:
 * every limit lives in 0055. Error sentences are exact; raw database messages
 * go to the operator's log by code only.
 */

type Err = { error: string };
type Prepared = { ok: true; batchId: string; counts: Counts } | Err;

async function boardViewer(): Promise<{ viewer: Viewer } | Err> {
  const viewer = await getViewer();
  if (!viewer || !viewer.isBoard) return { error: BOARD_ONLY_PREPARE };
  return { viewer };
}

async function adminViewer(): Promise<{ viewer: Viewer } | Err> {
  const viewer = await getViewer();
  if (!viewer || !viewer.isBoardAdmin) return { error: ADMIN_ONLY };
  return { viewer };
}

function refreshEmailPages(batchId?: string) {
  if (batchId) revalidatePath(`/dues/send/${batchId}`);
  revalidatePath("/delinquency");
  revalidatePath("/dues/email");
  revalidatePath("/dues/statements");
}

// ---- Preparing batches (drafts only; never needs Resend) ---------------------------

async function finishPrepare(
  supabase: Awaited<ReturnType<typeof createClient>>,
  batchId: string,
  emptyMessage: string,
): Promise<Prepared> {
  const { data: rows, error } = await supabase.from("email_outbox").select("status, skip_reason").eq("batch_id", batchId);
  if (error) {
    console.error("[walkup-email] counts", error.code ?? "-");
    return { error: SOMETHING_WRONG };
  }
  if ((rows ?? []).length === 0) {
    await supabase.rpc("email_cancel_batch", { p_batch_id: batchId });
    return { error: emptyMessage };
  }
  refreshEmailPages(batchId);
  return { ok: true, batchId, counts: countsFromRows(rows as { status: string; skip_reason: string | null }[]) };
}

export async function prepareReminders(input: { unitIds: string[] }): Promise<Prepared> {
  const who = await boardViewer();
  if ("error" in who) return who;
  const units = validateUnitIds(input?.unitIds);
  if (!units.ok) return { error: units.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("email_prepare_batch", {
    p_association_id: who.viewer.associationId,
    p_kind: "dues_reminder",
    p_unit_ids: units.value,
  });
  if (error || !data) return { error: error ? mapDbError(error, "prepare_reminders") : SOMETHING_WRONG };
  return finishPrepare(supabase, data as string, "None of those units has an overdue balance.");
}

export async function prepareStatements(input: { unitIds: string[]; from: string; to: string }): Promise<Prepared> {
  const who = await boardViewer();
  if ("error" in who) return who;
  const units = validateUnitIds(input?.unitIds);
  if (!units.ok) return { error: units.error };
  const period = parsePeriod(input?.from, input?.to);
  if (!period) return { error: "Choose a start and end date, with the end on or after the start." };
  const supabase = await createClient();
  const annual = period.from.slice(5) === "01-01" && period.to.slice(5) === "12-31" && period.from.slice(0, 4) === period.to.slice(0, 4);
  const { data, error } = await supabase.rpc("email_prepare_batch", {
    p_association_id: who.viewer.associationId,
    p_kind: annual ? "annual_statement" : "statement",
    p_unit_ids: units.value,
    p_period_start: period.from,
    p_period_end: period.to,
  });
  if (error || !data) return { error: error ? mapDbError(error, "prepare_statements") : SOMETHING_WRONG };
  return finishPrepare(supabase, data as string, "None of those units has a current owner to send to.");
}

export async function prepareLateFeeNotice(input: { feeChargeId: string }): Promise<Prepared> {
  const who = await boardViewer();
  if ("error" in who) return who;
  if (!isUuid(input?.feeChargeId)) return { error: SOMETHING_WRONG };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("email_prepare_batch", {
    p_association_id: who.viewer.associationId,
    p_kind: "late_fee_notice",
    p_unit_ids: [],
    p_fee_charge_id: input.feeChargeId,
  });
  if (error || !data) return { error: error ? mapDbError(error, "prepare_late_fee") : SOMETHING_WRONG };
  return finishPrepare(supabase, data as string, "That unit has no current owner to send a notice to.");
}

export async function prepareAnnouncementEmail(input: { announcementId: string }): Promise<Prepared> {
  const who = await boardViewer();
  if ("error" in who) return who;
  if (!isUuid(input?.announcementId)) return { error: SOMETHING_WRONG };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("email_prepare_batch", {
    p_association_id: who.viewer.associationId,
    p_kind: "announcement",
    p_unit_ids: [],
    p_announcement_id: input.announcementId,
  });
  if (error || !data) return { error: error ? mapDbError(error, "prepare_announcement") : SOMETHING_WRONG };
  return finishPrepare(supabase, data as string, "No owner is in that announcement's audience.");
}

// ---- Reviewing a batch --------------------------------------------------------------

export async function saveDraftNote(outboxId: string, note: string): Promise<{ ok: true } | Err> {
  const who = await boardViewer();
  if ("error" in who) return who;
  if (!isUuid(outboxId)) return { error: SOMETHING_WRONG };
  const checked = validateNote(note);
  if (!checked.ok) return { error: checked.error };
  const supabase = await createClient();
  const { error } = await supabase.rpc("email_edit_draft", { p_outbox_id: outboxId, p_board_note: checked.value, p_left_out: false });
  if (error) return { error: mapDbError(error, "save_note") };
  revalidatePath("/dues/send/[batchId]", "page");
  return { ok: true };
}

export async function leaveOut(outboxId: string): Promise<{ ok: true } | Err> {
  const who = await boardViewer();
  if ("error" in who) return who;
  if (!isUuid(outboxId)) return { error: SOMETHING_WRONG };
  const supabase = await createClient();
  const { error } = await supabase.rpc("email_edit_draft", { p_outbox_id: outboxId, p_board_note: null, p_left_out: true });
  if (error) return { error: mapDbError(error, "leave_out") };
  revalidatePath("/dues/send/[batchId]", "page");
  return { ok: true };
}

export async function cancelBatch(batchId: string): Promise<{ ok: true } | Err> {
  const who = await boardViewer();
  if ("error" in who) return who;
  if (!isUuid(batchId)) return { error: SOMETHING_WRONG };
  const supabase = await createClient();
  const { error } = await supabase.rpc("email_cancel_batch", { p_batch_id: batchId });
  if (error) return { error: mapDbError(error, "cancel_batch") };
  refreshEmailPages(batchId);
  return { ok: true };
}

/**
 * The approval. A board admin presses Send; the database re-checks every cap
 * and queues what passes; then the sender runs in the background of this
 * request under the admin's own session.
 */
export async function approveBatch(
  batchId: string,
): Promise<{ ok: true; queued: number; skipped: number } | { error: string; hint?: "sending_off" | "no_reply_to" }> {
  // Before any database call: no key, no address, or the kill switch means drafts only.
  const config = sendConfig();
  if (!config.ok) return { error: notConfiguredCopy(config.reason) };
  if (!isUuid(batchId)) return { error: SOMETHING_WRONG };
  const supabase = await createClient();
  const who = await adminViewer();
  if ("error" in who) {
    // The Secretary may approve announcement emails (0076); the database decides, this only lets the call through.
    const { data: b } = await supabase.from("email_batches").select("association_id, kind").eq("id", batchId).maybeSingle();
    const { data: secretary } =
      b?.kind === "announcement"
        ? await supabase.rpc("has_position", { p_association_id: b.association_id as string, p_position: "secretary" })
        : { data: false };
    if (secretary !== true) return who;
  }

  const { data, error } = await supabase.rpc("email_approve_batch", { p_batch_id: batchId });
  if (error) {
    const hint = error.hint === "sending_off" || error.hint === "no_reply_to" ? error.hint : undefined;
    return { error: mapDbError(error, "approve_batch"), ...(hint ? { hint } : {}) };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { queued: number; skipped: number } | undefined;

  after(async () => {
    try {
      await runSender({ batchId, deps: boardSessionDeps(supabase, config), config, site: senderSite });
    } catch (cause) {
      console.error("[walkup-email] sender_crashed", (cause as Error).name);
    }
    revalidatePath(`/dues/send/${batchId}`);
  });
  refreshEmailPages(batchId);
  return { ok: true, queued: row?.queued ?? 0, skipped: row?.skipped ?? 0 };
}

/** The request that was sending died, or Resend slowed down: run the sender again for what is still waiting. */
export async function resumeBatch(batchId: string): Promise<{ ok: true } | Err> {
  const config = sendConfig();
  if (!config.ok) return { error: notConfiguredCopy(config.reason) };
  const who = await adminViewer();
  if ("error" in who) return who;
  if (!isUuid(batchId)) return { error: SOMETHING_WRONG };
  const supabase = await createClient();
  const { data: batch } = await supabase.from("email_batches").select("id, status").eq("id", batchId).maybeSingle();
  if (!batch || batch.status !== "approved") return { error: "This batch isn't ready to send." };
  after(async () => {
    try {
      await runSender({ batchId, deps: boardSessionDeps(supabase, config), config, site: senderSite });
    } catch (cause) {
      console.error("[walkup-email] sender_crashed", (cause as Error).name);
    }
    revalidatePath(`/dues/send/${batchId}`);
  });
  refreshEmailPages(batchId);
  return { ok: true };
}

/** A board member opened the draft in their own mail app and says they sent it. */
export async function markSentByHand(outboxId: string): Promise<{ ok: true } | Err> {
  const who = await boardViewer();
  if ("error" in who) return who;
  if (!isUuid(outboxId)) return { error: SOMETHING_WRONG };
  const supabase = await createClient();
  const { error } = await supabase.rpc("email_mark_sent_by_hand", { p_outbox_id: outboxId });
  if (error) return { error: mapDbError(error, "mark_sent_by_hand") };
  revalidatePath("/dues/send/[batchId]", "page");
  revalidatePath("/delinquency");
  revalidatePath("/dues/email");
  return { ok: true };
}

// ---- Settings, rules, blocked addresses (board admin) -------------------------------

export async function setSendingEnabled(enabled: boolean): Promise<{ ok: true } | Err> {
  const who = await adminViewer();
  if ("error" in who) return who;
  const supabase = await createClient();
  const { error } = await supabase.rpc("email_set_sending", { p_association_id: who.viewer.associationId, p_enabled: enabled === true });
  if (error) return { error: mapDbError(error, "set_sending") };
  refreshEmailPages();
  return { ok: true };
}

export async function setDailyCap(cap: number): Promise<{ ok: true } | Err> {
  const who = await adminViewer();
  if ("error" in who) return who;
  const checked = validateDailyCap(cap);
  if (!checked.ok) return { error: checked.error };
  const supabase = await createClient();
  const { error } = await supabase.rpc("email_set_daily_cap", { p_association_id: who.viewer.associationId, p_cap: checked.value });
  if (error) return { error: mapDbError(error, "set_cap") };
  refreshEmailPages();
  return { ok: true };
}

export async function saveReminderRule(input: RuleInput): Promise<{ ok: true } | { error: string; fieldErrors?: RuleFieldErrors }> {
  const who = await adminViewer();
  if ("error" in who) return who;
  const parsed = parseRuleInput(input);
  if (!parsed.ok) return { error: "Check the highlighted fields.", fieldErrors: parsed.fieldErrors };
  const r = parsed.value;
  const supabase = await createClient();
  const { error } = await supabase.rpc("email_save_rule", {
    p_association_id: who.viewer.associationId,
    p_kind: r.kind,
    p_days: r.days,
    p_min_amount: r.minAmount,
    p_repeat_every_days: r.repeatEveryDays,
    p_max_reminders: r.maxReminders,
    p_enabled: r.enabled,
  });
  if (error) return { error: mapDbError(error, "save_rule") };
  refreshEmailPages();
  return { ok: true };
}

export async function setRulePaused(ruleId: string, paused: boolean): Promise<{ ok: true } | Err> {
  const who = await boardViewer();
  if ("error" in who) return who;
  if (!isUuid(ruleId)) return { error: SOMETHING_WRONG };
  const supabase = await createClient();
  const { error } = await supabase.rpc("email_set_rule_paused", { p_rule_id: ruleId, p_paused: paused === true });
  if (error) return { error: mapDbError(error, "pause_rule") };
  refreshEmailPages();
  return { ok: true };
}

export async function clearSuppression(email: string): Promise<{ ok: true } | Err> {
  const who = await adminViewer();
  if ("error" in who) return who;
  const checked = validateEmailAddress(email);
  if (!checked.ok) return { error: checked.error };
  const supabase = await createClient();
  const { error } = await supabase.rpc("email_clear_suppression", { p_association_id: who.viewer.associationId, p_email: checked.value });
  if (error) return { error: mapDbError(error, "clear_suppression") };
  refreshEmailPages();
  return { ok: true };
}

/** "Preview who would get one today": the rule's conditions on the current books, read-only. */
export async function previewRuleRecipients(input: Pick<RuleInput, "kind" | "days" | "minAmount" | "repeatEveryDays" | "maxReminders">): Promise<{ ok: true; sentence: string } | Err> {
  const who = await boardViewer();
  if ("error" in who) return who;
  const parsed = parseRuleInput({ ...input, enabled: false });
  if (!parsed.ok) return { error: Object.values(parsed.fieldErrors)[0] ?? "Check the numbers and try again." };
  const supabase = await createClient();
  const today = buildingTodayIso();
  const data = await loadCollections(supabase, who.viewer.associationId, today, { board: true });
  if (!data) return { error: "We couldn't load balances. Reload the page." };
  const recent = new Set<string>();
  for (const m of data.messages) {
    if (m.at && ["sent", "delivered", "bounced", "complained", "queued", "sending"].includes(m.status) && Date.parse(m.at) > Date.now() - 7 * 86_400_000) {
      for (const id of m.unit_ids) recent.add(id);
    }
  }
  const r = parsed.value;
  const { labels } = previewRule(
    { kind: r.kind, days: r.days, minAmountCents: centsFromNumeric(r.minAmount), repeatEveryDays: r.repeatEveryDays, maxReminders: r.maxReminders },
    {
      todayIso: today,
      behind: data.units,
      units: data.rawUnits,
      charges: data.charges,
      owners: data.owners,
      suppressed: data.suppressed,
      optedOutPersonIds: data.optedOutPersonIds,
      recentlyEmailedUnitIds: recent,
    },
  );
  return { ok: true, sentence: previewSentence(labels) };
}
