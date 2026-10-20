// Rule engine for "Worth a minute today". Items are DERIVED from real
// conditions, never hand-maintained, so the list empties itself as things
// get handled.
//
// Deliberate mismatch, documented: this count is not the sidebar's
// "needs a category" badge, which counts uncategorized transactions; this
// counts financial and compliance conditions needing a board member's minute.
// They measure different things, and forcing them equal would make one of
// them lie.

import { coverageShort } from "@/lib/insurance/coverage";
import { SUPPORT_EMAIL } from "@/lib/site-config";

export interface UrgentItem {
  key:
    | "books"
    | "delinquent"
    | "w9"
    | "insurance"
    | "insurance_task"
    | "bank"
    | "sync"
    | "budget"
    | "repairs_emergency"
    | "repairs_possible_emergency"
    | "repairs_urgent"
    | "repairs_overdue"
    | "upkeep_overdue"
    | "contractor_paperwork"
    | "ai_finished"
    | "email_key_rejected"
    | "email_failed"
    | "email_bounced";
  severity: number; // lower sorts first
  title: string;
  why: string;
  action: { label: string; href: string };
  tone: "bad" | "warning";
}

interface UrgentInputs {
  booksVisible: boolean;
  booksBalance: boolean;
  aging: {
    label: string;
    days_1_30: string | number;
    days_31_60: string | number;
    days_60_plus: string | number;
    total_owed: string | number;
  }[];
  /** Contractors paid this year at or above the 1099 threshold with no W-9 on file. */
  vendorsMissingW9: number;
  /** When this year's 1099-NECs are due (lib/tax/deadlines — verified or estimated), or the general January 31 when none is in play. */
  nec1099Due: Date;
  /**
   * The soonest-ending active policy that isn't renewed yet, and whether it is
   * inside its own renewal_reminder_days (renewalFor in lib/insurance/status).
   */
  insuranceRenewal?: { daysToEnd: number; withinReminder: boolean; policy: { coverage: string } } | null;
  /** Board only: Insurance's own to-dos (loadInsuranceBanners): reads to review or that failed, owner requests, a stale owner summary. */
  insuranceBanners?: { key: string; tone: "attention" | "bad"; text: string; href: string; action: string }[];
  /** Board only: open problems (repairs-spec §18.2). */
  repairsEmergency?: { count: number; firstTitle: string | null; firstId: string | null };
  /** Open, no emergency_kind, triage suggested an emergency, not dismissed. */
  repairsPossibleEmergency?: number;
  /** Open, priority urgent, no emergency. */
  repairsUrgent?: number;
  /** Open problems past their target date (ticket_board_details.due_on). */
  repairsOverdue?: number;
  upkeepOverdue?: { count: number; firstName: string | null };
  /** Contractors in use whose insurance certificate or license has expired. */
  contractorPaperwork?: { expired: number; firstName: string | null; firstKind?: "coi" | "license" };
  /** Background AI runs that finished recently, for whoever left the page (finished-runs.ts). */
  finishedRuns?: { key: string; title: string; why: string; href: string; action: string; failed: boolean }[];
  /** Board admins only: what happened to Walkup's own email in the last 7 days (money-and-reminders-spec 15). */
  email?: { keyRejected: boolean; failed: number; bounced: number };
  bankConnected: boolean;
  /** Most recent successful sync across the connected banks; null when none has synced. */
  lastSyncedAt?: string | null;
  today: Date;
  /** Categories more than 10% over their share of the budget so far this year, biggest first. */
  budgetOver?: { name: string; overCents: number }[];
}

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The one-line "why" under each of Insurance's own to-dos, by banner kind. */
function insuranceTaskWhy(key: string, tone: "attention" | "bad"): string {
  if (key.startsWith("read:")) {
    return tone === "bad"
      ? "Open it to see why. You can try again or type the figures in yourself."
      : "Nothing is saved until a board member checks the figures.";
  }
  if (key === "owner_requests") return "Lenders ask owners for it. Your agent sends the certificate; Walkup drafts the request.";
  return "Owners read it to know what their own condo policy has to cover.";
}

export function urgentItems(input: UrgentInputs): UrgentItem[] {
  const items: UrgentItem[] = [];
  const days = (d: Date) => Math.ceil((d.getTime() - input.today.getTime()) / 86400000);

  // ---- Repairs first: an emergency outranks everything (repairs-spec §18.2).
  const emergency = input.repairsEmergency;
  if (emergency && emergency.count > 0) {
    const n = emergency.count;
    items.push({
      key: "repairs_emergency",
      severity: 0,
      title: `${plural(n, "emergency problem")} open`,
      why: emergency.firstTitle
        ? `Reported as an emergency: ${emergency.firstTitle}. Check someone is on it.`
        : "Reported as an emergency. Check someone is on it.",
      action: { label: "Open it", href: n === 1 && emergency.firstId ? `/maintenance/${emergency.firstId}` : "/repairs?view=today" },
      tone: "bad",
    });
  }
  if ((input.repairsPossibleEmergency ?? 0) > 0) {
    const n = input.repairsPossibleEmergency!;
    items.push({
      key: "repairs_possible_emergency",
      severity: 1,
      title: `${plural(n, "report")} may be an emergency`,
      why: "Suggested by AI from the report. Check and mark it, or dismiss it.",
      action: { label: "Check", href: "/repairs?view=today" },
      tone: "warning",
    });
  }
  if ((input.repairsUrgent ?? 0) > 0) {
    const n = input.repairsUrgent!;
    items.push({
      key: "repairs_urgent",
      severity: 1,
      title: `${plural(n, "urgent problem")} open`,
      why: `Marked "Needs attention now" by whoever reported ${n === 1 ? "it" : "them"}.`,
      action: { label: n === 1 ? "See it" : "See them", href: "/repairs?view=problems&priority=urgent" },
      tone: "bad",
    });
  }
  if ((input.repairsOverdue ?? 0) > 0) {
    const n = input.repairsOverdue!;
    items.push({
      key: "repairs_overdue",
      severity: 2,
      title: `${plural(n, "problem")} past ${n === 1 ? "its" : "their"} target date`,
      why: "The date the board set for each fix has passed and it's still open.",
      action: { label: n === 1 ? "See it" : "See them", href: "/repairs?view=problems&sort=due" },
      tone: "warning",
    });
  }
  const upkeep = input.upkeepOverdue;
  if (upkeep && upkeep.count > 0) {
    items.push({
      key: "upkeep_overdue",
      severity: 2,
      title: upkeep.count === 1 && upkeep.firstName ? `${upkeep.firstName} is overdue` : `${upkeep.count} upkeep jobs are overdue`,
      why: "Overdue upkeep is easier to fix before it becomes a repair.",
      action: { label: "Open upkeep", href: "/repairs?view=upkeep&show=overdue" },
      tone: "warning",
    });
  }
  const paperwork = input.contractorPaperwork;
  if (paperwork && paperwork.expired > 0) {
    items.push({
      key: "contractor_paperwork",
      severity: 2,
      title:
        paperwork.expired === 1 && paperwork.firstName
          ? `${paperwork.firstName}'s ${paperwork.firstKind === "license" ? "license" : "insurance certificate"} has expired`
          : `${paperwork.expired} contractors have expired paperwork`,
      why: "If an uninsured contractor is hurt on the property, the association may be exposed. Ask for a current certificate.",
      action: { label: "Ask for certificates", href: "/repairs?view=contractors" },
      tone: "warning",
    });
  }

  if (input.booksVisible && !input.booksBalance) {
    items.push({
      key: "books",
      severity: 0,
      title: "The two sides of the books don't match",
      why: "Every transaction is recorded twice. When the sides disagree, a record is wrong somewhere, and everything downstream inherits it.",
      action: { label: "See every transaction", href: "/ledger" },
      tone: "bad",
    });
  }

  // Any unit with a charge past its due date. The wording follows the aging
  // bucket honestly: 1 to 30 days is "past due", 31 to 60 is "over a month
  // behind", 61 and up is "2+ months behind". One unit gets its own item;
  // several are grouped so they don't crowd out everything else on the card.
  const behind = input.aging
    .map((u) => {
      const d60 = Number(u.days_31_60);
      const d60p = Number(u.days_60_plus);
      const overdue = Number(u.days_1_30) + d60 + d60p;
      const lateness = d60p > 0 ? "2+ months behind" : d60 > 0 ? "over a month behind" : "past due";
      return { label: u.label, overdue, lateness };
    })
    .filter((u) => u.overdue > 0)
    .sort((a, b) => b.overdue - a.overdue);
  if (behind.length === 1) {
    const [u] = behind;
    items.push({
      key: "delinquent",
      severity: 1,
      title: `${u.label} is ${u.lateness}: ${money(u.overdue)}`,
      why: "Unpaid dues hurt cash flow. Collections shows who is behind and what has been sent.",
      action: { label: "Open Collections", href: "/dues#collections" },
      tone: "bad",
    });
  } else if (behind.length > 1) {
    const total = behind.reduce((s, u) => s + u.overdue, 0);
    const names = behind.map((u) => u.label);
    const listed =
      names.length <= 3 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
    items.push({
      key: "delinquent",
      severity: 1,
      title: `${behind.length} units are behind on dues: ${money(total)}`,
      why: `${listed}. Unpaid dues hurt cash flow. Collections shows who is behind and what has been sent.`,
      action: { label: "Open Collections", href: "/dues#collections" },
      tone: "bad",
    });
  }

  if (input.vendorsMissingW9 > 0 && days(input.nec1099Due) <= 180) {
    items.push({
      key: "w9",
      severity: 2,
      title: `${input.vendorsMissingW9} contractor${input.vendorsMissingW9 === 1 ? "" : "s"} still owe${input.vendorsMissingW9 === 1 ? "s" : ""} you a W-9`,
      why: "You need one on file to issue their 1099-NEC in January. Easier to collect now than over the holidays.",
      action: { label: "Request W-9s", href: "/repairs?view=contractors" },
      tone: "warning",
    });
  }

  // The policy's own lead time (renewal_reminder_days), not a fixed 60 days;
  // a policy whose renewal is already saved never gets here (renewalFor).
  const renewal = input.insuranceRenewal;
  if (renewal && renewal.withinReminder && renewal.daysToEnd >= 0) {
    const d = renewal.daysToEnd;
    items.push({
      key: "insurance",
      severity: 2,
      title: `${coverageShort(renewal.policy.coverage)} renews in ${d} day${d === 1 ? "" : "s"}`,
      why: "A good time to check the renewal terms and ask for another quote to compare.",
      action: { label: "Get quotes", href: "/insurance?view=quotes&new=1" },
      tone: "warning",
    });
  }

  for (const b of input.insuranceBanners ?? []) {
    items.push({
      key: "insurance_task",
      severity: b.tone === "bad" ? 1 : 2,
      title: b.text,
      why: insuranceTaskWhy(b.key, b.tone),
      action: { label: b.action, href: b.href },
      tone: b.tone === "bad" ? "bad" : "warning",
    });
  }

  const over = input.budgetOver ?? [];
  if (over.length > 0) {
    const lead = over[0];
    items.push({
      key: "budget",
      severity: 2,
      title:
        over.length === 1
          ? `${lead.name} is ${money(lead.overCents / 100)} over budget`
          : `${over.length} categories are over budget`,
      why:
        over.length === 1
          ? "So far this year. Catching it now leaves room to trim or move money before it needs a special assessment."
          : `${lead.name} leads at ${money(lead.overCents / 100)} so far this year. Catching it now leaves room to adjust.`,
      action: { label: "See the budget", href: "/budget" },
      tone: "warning",
    });
  }

  if (!input.bankConnected) {
    items.push({
      key: "bank",
      severity: 3,
      title: "The bank account isn't connected yet",
      why: "Connecting it brings transactions in automatically. Read-only: nothing can move money.",
      action: { label: "Connect the bank", href: "/bank-feed" },
      tone: "warning",
    });
  } else if (input.lastSyncedAt) {
    // A bank that stops syncing usually wants someone to sign in again.
    // Three days covers a weekend plus the daily sync missing once.
    const staleDays = Math.floor((input.today.getTime() - new Date(input.lastSyncedAt).getTime()) / 86400000);
    // The same 3-day line as the Bank tile on the snapshot, so the two agree.
    if (staleDays >= 3) {
      items.push({
        key: "sync",
        severity: 2,
        title: `The bank hasn't synced in ${staleDays} days`,
        why: "New transactions aren't reaching the books. If the bank wants a fresh sign-in, the bank feed has a Reconnect button.",
        action: { label: "Open the bank feed", href: "/bank-feed" },
        tone: "warning",
      });
    }
  }

  const mail = input.email;
  if (mail?.keyRejected) {
    items.push({
      key: "email_key_rejected",
      severity: 1,
      title: "Walkup couldn't send your last email",
      why: `Walkup's email service needs attention. Reminders are paused. Email ${SUPPORT_EMAIL}.`,
      action: { label: "Check", href: "/dues/email" },
      tone: "bad",
    });
  }
  if (mail && mail.failed > 0) {
    items.push({
      key: "email_failed",
      severity: 2,
      title: `${plural(mail.failed, "email")} failed to send in the last 7 days`,
      why: "Check the address or try again.",
      action: { label: "See the log", href: "/dues/email#log" },
      tone: "warning",
    });
  }
  if (mail && mail.bounced > 0) {
    items.push({
      key: "email_bounced",
      severity: 2,
      title: `${plural(mail.bounced, "owner")} didn't get an email (bounced)`,
      why: "Their address may be wrong. Fix it so reminders reach them.",
      action: { label: "See who", href: "/dues/email" },
      tone: "warning",
    });
  }

  for (const r of input.finishedRuns ?? []) {
    items.push({ key: "ai_finished", severity: 3, title: r.title, why: r.why, action: { label: r.action, href: r.href }, tone: "warning" });
  }

  // Every item, most important first. The card shows the top few and keeps
  // the rest one click away, so nothing is silently dropped.
  return items.sort((a, b) => a.severity - b.severity);
}

/** How many items the card shows before "Show more". */
export const WORTH_A_MINUTE_VISIBLE = 3;
