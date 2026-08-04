// Rule engine for "Worth a minute today". Items are DERIVED from real
// conditions, never hand-maintained, so the list empties itself as things
// get handled.
//
// Deliberate mismatch, documented: this count is not the sidebar's Problems
// badge. The badge counts open maintenance tickets; this counts financial
// and compliance conditions needing a board member's minute. They measure
// different things, and forcing them equal would make one of them lie.

export interface UrgentItem {
  key: "books" | "delinquent" | "w9" | "insurance" | "bank";
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
  vendorsMissingW9: number;
  nec1099Due: Date;
  insuranceExpiry: Date | null; // soonest active policy end
  bankConnected: boolean;
  today: Date;
}

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export function urgentItems(input: UrgentInputs): UrgentItem[] {
  const items: UrgentItem[] = [];
  const days = (d: Date) => Math.ceil((d.getTime() - input.today.getTime()) / 86400000);

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

  // A unit at least a month behind: anything aged past the current bucket.
  for (const u of input.aging) {
    const d30 = Number(u.days_1_30);
    const d60 = Number(u.days_31_60);
    const d60p = Number(u.days_60_plus);
    const overdue = d30 + d60 + d60p;
    if (overdue <= 0) continue;
    const monthsBehind = d60p > 0 ? 3 : d60 > 0 ? 2 : 1;
    items.push({
      key: "delinquent",
      severity: 1,
      title: `${u.label} is ${monthsBehind === 1 ? "a month" : `${monthsBehind}+ months`} behind — ${money(overdue)}`,
      why: "Unpaid fees are a cash-flow problem now and a tax-eligibility problem in April — collections drive the 60% income test.",
      action: { label: "Send a reminder", href: "/delinquency" },
      tone: "bad",
    });
  }

  if (input.vendorsMissingW9 > 0 && days(input.nec1099Due) <= 180) {
    items.push({
      key: "w9",
      severity: 2,
      title: `${input.vendorsMissingW9} contractor${input.vendorsMissingW9 === 1 ? "" : "s"} still owe${input.vendorsMissingW9 === 1 ? "s" : ""} you a W-9`,
      why: "You need one on file before you can issue their 1099-NEC in January. Easier to collect now than during the holidays.",
      action: { label: "Request W-9s", href: "/contractors" },
      tone: "warning",
    });
  }

  if (input.insuranceExpiry) {
    const d = days(input.insuranceExpiry);
    if (d >= 0 && d <= 60) {
      items.push({
        key: "insurance",
        severity: 2,
        title: `Insurance renews in ${d} day${d === 1 ? "" : "s"}`,
        why: "Carriers price renewals assuming you won't shop around. Collecting an alternative quote is the one negotiation a small association reliably wins.",
        action: { label: "Review the policy", href: "/insurance" },
        tone: "warning",
      });
    }
  }

  if (!input.bankConnected) {
    items.push({
      key: "bank",
      severity: 3,
      title: "The bank account isn't connected yet",
      why: "Connecting it shows transactions here without anyone typing them in. Read-only — nothing can move money.",
      action: { label: "Connect the bank", href: "/bank-feed" },
      tone: "warning",
    });
  }

  // Cap at the three highest-priority. The count chip equals what renders.
  return items.sort((a, b) => a.severity - b.severity).slice(0, 3);
}
