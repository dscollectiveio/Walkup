// Input validation for Repairs, shared by client forms and server actions
// (repairs-spec §4.2). Money goes to PostgREST as a string ("1250.50"); the
// database casts it to numeric(14,2). Never a float.

import { z } from "zod";
import { isTradeSlug } from "@/lib/contractors/trades";
import { EMERGENCY_KINDS } from "./emergency";

/** What the money inputs accept after stripping "$", "," and spaces. */
export const MONEY_TEXT = /^\d{1,12}(\.\d{1,2})?$/;

const MONEY_MESSAGE = "Enter an amount in dollars, like 1250 or 1,250.50.";

function cleanMoney(raw: string): string {
  return String(raw ?? "").replace(/[$,\s]/g, "");
}

/** "$1,250.5" -> "1250.50"; "" -> null; anything else is refused. Output is numeric(14,2) text. */
export const moneyText = z.string().transform((raw, ctx): string | null => {
  const v = cleanMoney(raw);
  if (v === "") return null;
  if (!MONEY_TEXT.test(v)) {
    ctx.addIssue({ code: "custom", message: MONEY_MESSAGE });
    return z.NEVER;
  }
  const [whole, frac = ""] = v.split(".");
  return `${whole.replace(/^0+(?=\d)/, "")}.${frac.padEnd(2, "0")}`;
});

/** "$1,250.5" -> "1250.50"; "" -> null; invalid throws a ZodError (via moneyText). */
export function normaliseMoneyInput(raw: string): string | null {
  return moneyText.parse(raw);
}

function realDate(v: string): boolean {
  const [y, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** "YYYY-MM-DD" that exists on the calendar. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date.")
  .refine(realDate, "That date doesn't exist.");

const where = z.union([z.literal("shared"), z.guid()], { error: "Choose where the problem is." });

export const ticketReportSchema = z.object({
  /** crypto.randomUUID() when the form mounts; a retried submit finds the same ticket. */
  clientKey: z.guid(),
  title: z.string().trim().min(4, "Give it a short title, at least 4 letters.").max(120, "Keep the title under 120 characters."),
  description: z.string().trim().max(4000, "Keep the description under 4,000 characters.").optional().transform((v) => v || null),
  /** A unit id or "shared". */
  where,
  location_detail: z.string().trim().max(200, "Keep where it is under 200 characters.").optional().transform((v) => v || null),
  access_notes: z.string().trim().max(1000, "Keep the access notes under 1,000 characters.").optional().transform((v) => v || null),
  priority: z.enum(["low", "normal", "urgent"], { error: "Choose how urgent it is." }),
  /**
   * The reporter's answer to "Is this happening right now?" when a rule
   * fired. false = "No, it's already under control": no emergency_kind,
   * priority as chosen.
   */
  emergencyConfirmed: z.boolean(),
});
export type TicketReportInput = z.input<typeof ticketReportSchema>;
export type TicketReport = z.output<typeof ticketReportSchema>;

/** Board edit of a problem's details. */
export const ticketDetailsSchema = z.object({
  title: z.string().trim().min(4, "Give it a short title, at least 4 letters.").max(120, "Keep the title under 120 characters."),
  description: z.string().trim().max(4000, "Keep the description under 4,000 characters.").nullable(),
  where,
  location_detail: z.string().trim().max(200, "Keep where it is under 200 characters.").nullable(),
  access_notes: z.string().trim().max(1000, "Keep the access notes under 1,000 characters.").nullable(),
  priority: z.enum(["low", "normal", "urgent"]),
  trade: z.string().refine(isTradeSlug, "Choose a kind of work.").nullable(),
  emergency_kind: z.enum(EMERGENCY_KINDS).nullable(),
  /** Required (1..300) when lowering the priority of a ticket an owner reported; posted as a note. */
  priorityReason: z.string().trim().max(300, "Keep the reason under 300 characters.").nullable(),
  /** Required when a unit ticket with access notes becomes shared: keep them (every member reads them then) or clear them. */
  accessNotesWhenShared: z.enum(["keep", "clear"]).nullable(),
});
export type TicketDetailsInput = z.input<typeof ticketDetailsSchema>;

/** Board: who and when. */
export const ticketPlanSchema = z.object({
  assigned_vendor_id: z.guid().nullable().optional(),        // tickets
  scheduled_for: isoDate.nullable().optional(),                       // tickets
  scheduled_window: z.string().trim().max(60, "Keep the time window under 60 characters.").nullable().optional(), // tickets
  assignee_person_id: z.guid().nullable().optional(),        // ticket_board_details
  due_on: isoDate.nullable().optional(),                              // ticket_board_details
  estimated_cost: moneyText.nullable().optional(),                    // ticket_board_details
});
export type TicketPlanInput = z.input<typeof ticketPlanSchema>;

export const closeOutSchema = z.object({
  status: z.enum(["resolved", "closed"]),
  actual_cost: moneyText.nullable(),
  expense_id: z.guid().nullable(),
  resolution_note: z.string().trim().max(2000, "Keep the note under 2,000 characters.").nullable(),
  log_upkeep: z.boolean(),
});
export type CloseOutInput = z.input<typeof closeOutSchema>;

export const bidSchema = z.object({
  ticket_id: z.guid(),
  vendor_id: z.guid(),
  bid_id: z.guid().nullable(),
  /** Required to record a quote. */
  amount: moneyText.refine((v) => v !== null, "Enter the amount they quoted."),
  amount_kind: z.enum(["fixed", "estimate", "not_to_exceed"]),
  received_on: isoDate.nullable(),
  valid_until: isoDate.nullable(),
  can_start_on: isoDate.nullable(),
  duration_text: z.string().trim().max(120).nullable(),
  scope_text: z.string().trim().max(2000).nullable(),
  warranty_text: z.string().trim().max(300).nullable(),
  exclusions_text: z.string().trim().max(600).nullable(),
  payment_terms_text: z.string().trim().max(200).nullable(),
  notes: z.string().trim().max(2000).nullable(),
  document_id: z.guid().nullable(),
});
export type BidInput = z.input<typeof bidSchema>;

const tradeSlugText = z.string().regex(/^[a-z][a-z_]{1,30}$/).refine(isTradeSlug);

/** What the ticket page accepts from ticket_board_details.triage before rendering anything from it. */
export const storedTriageSchema = z.object({
  state: z.enum(["done", "skipped", "failed"]),
  reason: z.enum(["not_configured", "quota", "error", "reporter_limit"]).optional(),
  trade: tradeSlugText.nullable().optional(),
  secondary_trade: tradeSlugText.nullable().optional(),
  urgency: z.enum(["low", "normal", "urgent"]).optional(),
  emergency: z.enum(["none", ...EMERGENCY_KINDS]).optional(),
  search_phrase: z.string().max(60).optional(),
  summary: z.string().max(200).optional(),
  questions: z.array(z.string().max(140)).max(3).optional(),
  confidence: z.number().min(0).max(1).optional(),
  model: z.string().max(60).optional(),
  at: z.string().max(40),
}).strict();
export type StoredTriage = z.infer<typeof storedTriageSchema>;

/** A stored triage, or null when it fails the schema (the page then shows the failed state, never partial text). */
export function parseStoredTriage(value: unknown): StoredTriage | null {
  const r = storedTriageSchema.safeParse(value);
  return r.success ? r.data : null;
}
