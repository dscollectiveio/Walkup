// "Right now" tiles for the Where-the-association-stands card. Every tile is
// either a real figure from the records or an honest nudge to set the thing
// up — never a placeholder number. Pure, so the wording and thresholds are
// testable.

export type SnapshotTone = "neutral" | "attention" | "good";

export interface SnapshotTile {
  key: string;
  label: string;
  /** The headline figure; null for a "not set up yet" nudge. */
  value: string | null;
  note: string;
  href: string;
  tone: SnapshotTone;
}

export interface SnapshotInput {
  today: Date;
  owedCents: number;
  unitsBehind: number;
  /** Months with any dues charged. Empty means dues have never been charged. */
  duesByMonth: { month: string; chargedCents: number; collectedCents: number }[];
  bills: { nextDueOn: string | null; typicalAmountCents: number | null }[];
  bankConnected: boolean;
  uncategorizedCount: number;
  /** Soonest end date among active insurance policies, ISO. */
  insuranceExpiresOn: string | null;
}

const dollars = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function buildSnapshot(input: SnapshotInput): SnapshotTile[] {
  const tiles: SnapshotTile[] = [];
  const todayIso = iso(input.today);
  const monthKey = `${todayIso.slice(0, 7)}-01`;
  const everCharged = input.duesByMonth.some((m) => m.chargedCents > 0);

  // ---- Dues owed -------------------------------------------------------------
  if (!everCharged) {
    tiles.push({
      key: "owed",
      label: "Dues owed",
      value: null,
      note: "No dues charged yet — set a schedule",
      href: "/dues",
      tone: "neutral",
    });
  } else {
    tiles.push({
      key: "owed",
      label: "Dues owed",
      value: dollars(input.owedCents),
      note: input.unitsBehind > 0 ? `across ${plural(input.unitsBehind, "unit")}` : "Every unit is current",
      href: "/dues",
      tone: input.unitsBehind > 0 ? "attention" : "good",
    });

    const month = input.duesByMonth.find((m) => m.month === monthKey);
    tiles.push(
      month && month.chargedCents > 0
        ? {
            key: "dues_month",
            label: "Dues this month",
            value: `${dollars(month.collectedCents)} of ${dollars(month.chargedCents)}`,
            note: month.collectedCents >= month.chargedCents ? "Everyone has paid" : "collected so far",
            href: "/dues",
            tone: month.collectedCents >= month.chargedCents ? "good" : "neutral",
          }
        : {
            key: "dues_month",
            label: "Dues this month",
            value: null,
            note: "Not charged yet this month",
            href: "/dues",
            tone: "neutral",
          },
    );
  }

  // ---- Bills in the next 30 days ----------------------------------------------
  const horizon = new Date(input.today);
  horizon.setDate(horizon.getDate() + 30);
  const horizonIso = iso(horizon);
  const soon = input.bills.filter((b) => b.nextDueOn && b.nextDueOn >= todayIso && b.nextDueOn <= horizonIso);
  if (input.bills.length === 0) {
    tiles.push({
      key: "bills",
      label: "Bills, next 30 days",
      value: null,
      note: "No bills added yet",
      href: "/budget",
      tone: "neutral",
    });
  } else if (soon.length === 0) {
    tiles.push({
      key: "bills",
      label: "Bills, next 30 days",
      value: "None due",
      note: "Nothing known is due this month",
      href: "/budget",
      tone: "good",
    });
  } else {
    const known = soon.filter((b) => b.typicalAmountCents !== null);
    const total = known.reduce((s, b) => s + (b.typicalAmountCents ?? 0), 0);
    tiles.push({
      key: "bills",
      label: "Bills, next 30 days",
      value: plural(soon.length, "bill"),
      note:
        known.length === 0
          ? "amounts vary"
          : known.length < soon.length
            ? `about ${dollars(total)}, plus some that vary`
            : `about ${dollars(total)}`,
      href: "/budget",
      tone: "neutral",
    });
  }

  // ---- Bank backlog -----------------------------------------------------------
  if (!input.bankConnected) {
    tiles.push({
      key: "bank",
      label: "Bank",
      value: null,
      note: "Not connected yet",
      href: "/bank-feed",
      tone: "neutral",
    });
  } else if (input.uncategorizedCount > 0) {
    tiles.push({
      key: "bank",
      label: "Needs a category",
      value: String(input.uncategorizedCount),
      note: `${input.uncategorizedCount === 1 ? "transaction isn't" : "transactions aren't"} in the books yet`,
      href: "/bank-feed?status=needs",
      tone: "attention",
    });
  } else {
    tiles.push({
      key: "bank",
      label: "Bank",
      value: "All categorized",
      note: "Every synced transaction is in the books",
      href: "/bank-feed",
      tone: "good",
    });
  }

  // ---- Insurance renewal --------------------------------------------------------
  if (!input.insuranceExpiresOn) {
    tiles.push({
      key: "insurance",
      label: "Insurance",
      value: null,
      note: "No active policy recorded",
      href: "/insurance",
      tone: "neutral",
    });
  } else {
    const days = Math.round(
      (new Date(`${input.insuranceExpiresOn}T00:00:00`).getTime() - new Date(`${todayIso}T00:00:00`).getTime()) / 86_400_000,
    );
    const when = new Date(`${input.insuranceExpiresOn}T00:00:00`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(input.insuranceExpiresOn.slice(0, 4) !== todayIso.slice(0, 4) ? { year: "numeric" } : {}),
    });
    tiles.push({
      key: "insurance",
      label: "Insurance renews",
      value: when,
      note: days === 0 ? "today" : `in ${plural(days, "day")}`,
      href: "/insurance",
      tone: days <= 60 ? "attention" : "neutral",
    });
  }

  return tiles;
}
