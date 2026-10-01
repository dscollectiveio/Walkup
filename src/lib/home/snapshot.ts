// "Right now" tiles for the Where-the-association-stands card. Every tile is
// either a real figure from the records or an honest nudge to set the thing
// up — never a placeholder number. Pure, so the wording and thresholds are
// testable.
//
// Four tiles, chosen for what a small self-managed HOA actually gets caught
// out by: the bank feed quietly breaking or backing up, an insurance policy
// lapsing, a filing deadline sneaking up, and a contractor without current
// paperwork.

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
  /** Every bank connection that isn't disconnected. */
  bankConnections: { status: string; institutionName: string; lastSyncedAt: string | null }[];
  uncategorizedCount: number;
  /** Soonest end date among active insurance policies, ISO. */
  insuranceExpiresOn: string | null;
  /** The next tax or compliance filing, if any, as an ISO date. */
  nextFiling: { name: string; dueOn: string; estimated: boolean } | null;
  /** Contractors the board still uses (not marked "do not use"). */
  contractors: { w9OnFile: boolean; is1099Exempt: boolean; insuredUntil: string | null }[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(`${toIso}T00:00:00`).getTime() - new Date(`${fromIso}T00:00:00`).getTime()) / 86_400_000);
}

function shortDate(dateIso: string, todayIso: string): string {
  return new Date(`${dateIso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(dateIso.slice(0, 4) !== todayIso.slice(0, 4) ? { year: "numeric" } : {}),
  });
}

/** "synced today", "synced yesterday", "synced 4 days ago", or "not synced yet". */
export function syncedWords(lastSyncedAt: string | null, todayIso: string): string {
  if (!lastSyncedAt) return "not synced yet";
  const days = daysBetween(lastSyncedAt.slice(0, 10), todayIso);
  if (days <= 0) return "synced today";
  if (days === 1) return "synced yesterday";
  return `synced ${days} days ago`;
}

export function buildSnapshot(input: SnapshotInput): SnapshotTile[] {
  const todayIso = iso(input.today);
  const tiles: SnapshotTile[] = [];

  // ---- Bank linked --------------------------------------------------------------
  const active = input.bankConnections.filter((c) => c.status === "active");
  const broken = input.bankConnections.filter((c) => c.status === "error");
  if (input.bankConnections.length === 0) {
    tiles.push({ key: "bank", label: "Bank", value: null, note: "Not linked yet", href: "/bank-feed", tone: "neutral" });
  } else if (active.length === 0) {
    tiles.push({
      key: "bank",
      label: "Bank",
      value: "Needs reconnecting",
      note: `${broken[0]?.institutionName ?? "Your bank"} stopped syncing`,
      href: "/bank-feed",
      tone: "attention",
    });
  } else {
    const newest = active
      .map((c) => c.lastSyncedAt)
      .filter((d): d is string => d !== null)
      .sort()
      .at(-1) ?? null;
    const names = active.map((c) => c.institutionName);
    const where = names.length === 1 ? names[0] : `${names.length} accounts`;
    const stale = newest !== null && daysBetween(newest.slice(0, 10), todayIso) >= 3;
    const backlog = input.uncategorizedCount;
    tiles.push({
      key: "bank",
      label: "Bank",
      value: broken.length > 0 ? "Linked — one needs attention" : "Linked",
      note:
        `${where} · ${syncedWords(newest, todayIso)}` +
        (backlog > 0 ? ` · ${backlog} need a category` : ""),
      href: backlog > 0 ? "/bank-feed?status=needs" : "/bank-feed",
      tone: broken.length > 0 || stale || backlog > 0 ? "attention" : "good",
    });
  }

  // ---- Insurance renewal ----------------------------------------------------------
  if (!input.insuranceExpiresOn) {
    tiles.push({ key: "insurance", label: "Insurance", value: null, note: "No active policy recorded", href: "/insurance", tone: "neutral" });
  } else {
    const days = daysBetween(todayIso, input.insuranceExpiresOn);
    tiles.push({
      key: "insurance",
      label: "Insurance renews",
      value: shortDate(input.insuranceExpiresOn, todayIso),
      note: days === 0 ? "today" : `in ${plural(days, "day")}`,
      href: "/insurance",
      tone: days <= 60 ? "attention" : "neutral",
    });
  }

  // ---- Next filing ------------------------------------------------------------------
  if (!input.nextFiling) {
    tiles.push({ key: "filing", label: "Next filing", value: null, note: "No deadline on file yet", href: "/tax", tone: "neutral" });
  } else {
    const days = daysBetween(todayIso, input.nextFiling.dueOn);
    tiles.push({
      key: "filing",
      label: "Next filing",
      value: shortDate(input.nextFiling.dueOn, todayIso),
      note: `${input.nextFiling.name}${input.nextFiling.estimated ? " (estimated)" : ""} · ${days <= 0 ? "due now" : `in ${plural(days, "day")}`}`,
      href: "/tax",
      tone: days <= 30 ? "attention" : "neutral",
    });
  }

  // ---- Contractor paperwork -----------------------------------------------------------
  if (input.contractors.length === 0) {
    tiles.push({ key: "contractors", label: "Contractors", value: null, note: "None added yet", href: "/contractors", tone: "neutral" });
  } else {
    const missingW9 = input.contractors.filter((c) => !c.w9OnFile && !c.is1099Exempt).length;
    const lapsed = input.contractors.filter((c) => c.insuredUntil !== null && c.insuredUntil < todayIso).length;
    const noCoi = input.contractors.filter((c) => c.insuredUntil === null).length;
    const parts = [
      missingW9 > 0 ? `${plural(missingW9, "W-9")} missing` : null,
      lapsed > 0 ? `${plural(lapsed, "insurance certificate")} expired` : null,
      noCoi > 0 ? `${noCoi} with no insurance on file` : null,
    ].filter((p): p is string => p !== null);
    tiles.push(
      parts.length === 0
        ? {
            key: "contractors",
            label: "Contractor paperwork",
            value: "In order",
            note: `${plural(input.contractors.length, "contractor")}, all current`,
            href: "/contractors",
            tone: "good",
          }
        : {
            key: "contractors",
            label: "Contractor paperwork",
            value: `${plural(missingW9 + lapsed + noCoi, "gap")}`,
            note: parts.join(" · "),
            href: "/contractors",
            tone: "attention",
          },
    );
  }

  return tiles;
}
