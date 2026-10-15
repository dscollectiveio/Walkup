import { z } from "zod";

/**
 * The facts snapshot stored on an outbox row (money spec 4.1). Built in SQL
 * from the ledger by email_prepare_batch; parsed here before a template
 * renders it. Money is text. Pure and client-safe.
 */

const money = z.string().regex(/^-?\d{1,12}\.\d{2}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const unitFacts = z.object({
  unit_id: z.guid(),
  label: z.string().max(60),
  as_of: isoDate,
  owed: money,
  overdue: money,
  credit: money,
  net: money,
  oldest_overdue_on: isoDate.nullable(),
  lines: z.array(z.object({ due_on: isoDate, label: z.string().max(60), balance: money })).max(12),
});

export const duesFacts = z.object({
  units: z.array(unitFacts).min(1).max(20),
  rule_kind: z.enum(["dues_upcoming", "dues_overdue"]).optional(),
  rule_days: z.number().int().optional(),
});

export const lateFeeFacts = z.object({
  units: z.array(unitFacts).length(1),
  fee_charge_id: z.guid(),
  fee_amount: money,
  fee_charged_on: isoDate,
});

export const statementUnitFacts = z.object({
  unit_id: z.guid(),
  label: z.string().max(60),
  from: isoDate,
  to: isoDate,
  opening: money,
  charges: money,
  payments: money,
  adjustments: money,
  closing: money,
});

export const statementFacts = z.object({ units: z.array(statementUnitFacts).min(1).max(20) });
export const announcementFacts = z.object({ announcement_id: z.guid() });

export type UnitFacts = z.infer<typeof unitFacts>;
export type DuesFacts = z.infer<typeof duesFacts>;
export type LateFeeFacts = z.infer<typeof lateFeeFacts>;
export type StatementUnitFacts = z.infer<typeof statementUnitFacts>;
export type StatementFacts = z.infer<typeof statementFacts>;
export type AnnouncementFacts = z.infer<typeof announcementFacts>;

export type EmailKind = "dues_reminder" | "late_fee_notice" | "statement" | "annual_statement" | "announcement";

export const EMAIL_KINDS: EmailKind[] = ["dues_reminder", "late_fee_notice", "statement", "annual_statement", "announcement"];

export const KIND_LABEL: Record<EmailKind, string> = {
  dues_reminder: "Dues reminder",
  late_fee_notice: "Late fee notice",
  statement: "Statement",
  annual_statement: "Annual statement",
  announcement: "Announcement",
};

export type PreferenceKey = "dues_reminders" | "statements" | "announcements";

export const PREFERENCE_OF: Record<EmailKind, PreferenceKey> = {
  dues_reminder: "dues_reminders",
  late_fee_notice: "dues_reminders",
  statement: "statements",
  annual_statement: "statements",
  announcement: "announcements",
};

/** "dues reminders" / "statements" / "announcements", for the footer and the unsubscribe page. */
export const CATEGORY_WORDS: Record<PreferenceKey, string> = {
  dues_reminders: "dues reminders",
  statements: "statements",
  announcements: "announcements",
};

export type ParsedFacts =
  | { kind: "dues_reminder"; data: DuesFacts }
  | { kind: "late_fee_notice"; data: LateFeeFacts }
  | { kind: "statement" | "annual_statement"; data: StatementFacts }
  | { kind: "announcement"; data: AnnouncementFacts };

export function parseFacts(
  kind: EmailKind,
  facts: unknown,
): { ok: true; parsed: ParsedFacts } | { ok: false; error: string } {
  const schema =
    kind === "dues_reminder"
      ? duesFacts
      : kind === "late_fee_notice"
        ? lateFeeFacts
        : kind === "announcement"
          ? announcementFacts
          : statementFacts;
  const result = schema.safeParse(facts);
  if (!result.success) return { ok: false, error: "The saved details for this email could not be read." };
  return { ok: true, parsed: { kind, data: result.data } as ParsedFacts };
}
