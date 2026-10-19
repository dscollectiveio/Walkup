import { z } from "zod";

/**
 * The parts of the email server actions that need no framework: input rules,
 * the database-error mapping and the outbox read-back. Pure so a unit test
 * can pin every message (money spec 6).
 */

export const SOMETHING_WRONG = "Something went wrong. Try again.";
export const BOARD_ONLY_PREPARE = "Preparing email is for the board.";
export const ADMIN_ONLY = "Only a board admin can do that.";

export const NOTE_MAX = 500;

export const ruleInput = z.object({
  kind: z.enum(["dues_upcoming", "dues_overdue"]),
  days: z.number().int().min(1, "Use at least 1 day.").max(90, "Use 90 days or fewer."),
  minAmount: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, "Enter an amount like 25 or 25.00."),
  repeatEveryDays: z.number().int().min(7, "Reminders go out at most once a week.").max(60, "Use 60 days or fewer."),
  maxReminders: z.number().int().min(1, "Send at least 1 reminder.").max(6, "Six reminders is the most."),
  enabled: z.boolean(),
});

export type RuleInput = z.infer<typeof ruleInput>;
export type RuleFieldErrors = Partial<Record<keyof RuleInput, string>>;

export function parseRuleInput(raw: unknown): { ok: true; value: RuleInput } | { ok: false; fieldErrors: RuleFieldErrors } {
  const parsed = ruleInput.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const fieldErrors: RuleFieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof RuleInput | undefined;
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return { ok: false, fieldErrors };
}

/** Same limits the database enforces on email_outbox.board_note, with sentences for people. */
export function validateNote(note: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const value = (note ?? "").replace(/\r\n?/g, "\n").trim();
  if (value.length > NOTE_MAX) return { ok: false, error: `Keep the note to ${NOTE_MAX} characters.` };
  if (/(:\/\/|www\.|@)/i.test(value)) return { ok: false, error: "Leave out links and email addresses." };
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return { ok: false, error: "That note has characters that can't be sent." };
  return { ok: true, value: value === "" ? null : value };
}

export interface DbError {
  code?: string | null;
  message?: string | null;
  hint?: string | null;
}

/** Postgres error to a sentence. The raw message is for the operator's log (code and hint only), never the page. */
export function mapDbError(error: DbError, where = "email"): string {
  const code = error.code ?? "";
  const hint = error.hint ?? "";
  if (code === "42501") return ADMIN_ONLY;
  if (code === "22023" && hint === "sending_off") return "Turn on sending first.";
  if (code === "22023" && hint === "no_reply_to") return "Add the board contact email on Building & Owners first. Replies go there.";
  if (code === "53400" && hint === "weekly_cap") return "This person already got this kind of email this week.";
  if (code === "22023" && error.message) return error.message;
  console.error(`[walkup-email] ${where}`, code || "-", hint || "-");
  return SOMETHING_WRONG;
}

export interface Counts {
  drafts: number;
  skipped: { reason: string; n: number }[];
}

/** Read back from the outbox rows after a batch is prepared. Left-out and cancelled rows are not "skipped". */
export function countsFromRows(rows: { status: string; skip_reason: string | null }[]): Counts {
  const skipped = new Map<string, number>();
  let drafts = 0;
  for (const r of rows) {
    if (r.status === "draft") drafts += 1;
    else if (r.status === "skipped") skipped.set(r.skip_reason ?? "unknown", (skipped.get(r.skip_reason ?? "unknown") ?? 0) + 1);
  }
  return { drafts, skipped: [...skipped.entries()].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n || a.reason.localeCompare(b.reason)) };
}

export function validateDailyCap(cap: unknown): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof cap !== "number" || !Number.isInteger(cap) || cap < 1 || cap > 200) return { ok: false, error: "Use a number from 1 to 200." };
  return { ok: true, value: cap };
}

const EMAIL_SHAPE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
export function validateEmailAddress(email: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const value = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!value || value.length > 254 || !EMAIL_SHAPE.test(value)) return { ok: false, error: "That doesn't look like an email address." };
  return { ok: true, value };
}

export const MAX_UNITS_PER_BATCH = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export function validateUnitIds(ids: unknown): { ok: true; value: string[] } | { ok: false; error: string } {
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: "Choose at least one unit." };
  if (ids.length > MAX_UNITS_PER_BATCH) return { ok: false, error: `Choose at most ${MAX_UNITS_PER_BATCH} units at a time.` };
  if (!ids.every(isUuid)) return { ok: false, error: "Something went wrong. Try again." };
  return { ok: true, value: [...new Set(ids)] };
}
