// Words for the How to pay page (owner-portal-spec 6.3). Pure.

import { money } from "@/components/ui";
import { shortDate } from "@/lib/dates";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Unit 2 dues Oct 2026": a memo the treasurer can match at a glance. */
export function suggestedMemo(unitLabel: string, todayIso: string): string {
  const [y, m] = todayIso.split("-").map(Number);
  return `${unitLabel} dues ${MONTHS[(m || 1) - 1]} ${y}`;
}

export const WITHDRAWN_NOTE = "Withdrawn by the person who sent it";

export type ReportStatus = "pending" | "matched" | "dismissed";

export interface ReportRow {
  id: string;
  unit_id: string;
  amount: string;
  paid_on: string;
  method: string;
  status: ReportStatus;
  resolution_note: string | null;
}

const METHOD_WORDS: Record<string, string> = {
  zelle: "by Zelle",
  check: "by check",
  cash: "in cash",
  bank_transfer: "by bank transfer",
  other: "another way",
};

export function reportLine(r: ReportRow, todayIso: string): string {
  return `${shortDate(r.paid_on, todayIso)} · ${money(r.amount)} ${METHOD_WORDS[r.method] ?? "another way"}`;
}

export function reportStatusWords(r: ReportRow): { label: string; tone: "warning" | "good" | "neutral"; note: string | null } {
  if (r.status === "pending") return { label: "Waiting for the board", tone: "warning", note: null };
  if (r.status === "matched") return { label: "Matched to a deposit", tone: "good", note: null };
  if (r.resolution_note === WITHDRAWN_NOTE) return { label: "Withdrawn", tone: "neutral", note: null };
  return { label: "Not matched", tone: "neutral", note: r.resolution_note?.trim() || null };
}

export function hasPaymentDetails(a: {
  dues_payee_name: string | null;
  dues_account_number: string | null;
  dues_zelle_handle: string | null;
}): boolean {
  return Boolean(a.dues_payee_name?.trim() || a.dues_account_number?.trim() || a.dues_zelle_handle?.trim());
}
