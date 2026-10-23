// "Status Check" tiles for the Where-the-association-stands card. Every tile is
// either a real figure from the records or an honest nudge to set the thing
// up, never a placeholder number. Pure, so the wording and thresholds are
// testable.
//
// Four tiles, chosen for what a small self-managed HOA actually gets caught
// out by: the bank feed quietly breaking or backing up, the insurance
// information and the tax information being incomplete, and a contractor
// without current paperwork. Dated notices (an insurance renewal, a filing
// deadline) live in Coming up, not here.

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
  /**
   * How complete the insurance information is, from the same rows the setup
   * guide reads: a policy recorded, and the summary of what it covers
   * published to owners.
   */
  insuranceInfo: { policyRecorded: boolean; ownerSummaryPublished: boolean };
  /**
   * How complete the tax information is: the EIN on the association's profile,
   * and whether the yearly tax review has been started (a filing computed).
   */
  taxInfo: { einOnFile: boolean; reviewed: boolean };
  /**
   * Saved contractors not marked "do not use". Archived ones are dropped here;
   * paperwork only counts for contractors in use (lib/contractors/compliance).
   */
  contractors: {
    w9OnFile: boolean;
    is1099Exempt: boolean;
    insuredUntil: string | null;
    licenseExpiresOn?: string | null;
    archived?: boolean;
    inUse?: boolean;
  }[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(`${toIso}T00:00:00`).getTime() - new Date(`${fromIso}T00:00:00`).getTime()) / 86_400_000);
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
    tiles.push({ key: "bank", label: "Bank connection and sync", value: null, note: "Not linked yet", href: "/bank-feed", tone: "neutral" });
  } else if (active.length === 0) {
    tiles.push({
      key: "bank",
      label: "Bank connection and sync",
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
      label: "Bank connection and sync",
      value: broken.length > 0 ? "Linked, one needs attention" : "Linked",
      note:
        `${where} · ${syncedWords(newest, todayIso)}` +
        (backlog > 0 ? ` · ${backlog} need a category` : ""),
      href: backlog > 0 ? "/bank-feed?status=needs" : "/bank-feed",
      tone: broken.length > 0 || stale || backlog > 0 ? "attention" : "good",
    });
  }

  // ---- Insurance information -------------------------------------------------------
  // Dated notices (a renewal, a filing deadline) are Coming up's job; these two tiles say how
  // complete the information itself is.
  const ins = input.insuranceInfo;
  if (!ins.policyRecorded) {
    tiles.push({ key: "insurance", label: "Insurance information", value: null, note: "No policy recorded yet", href: "/insurance", tone: "neutral" });
  } else if (!ins.ownerSummaryPublished) {
    tiles.push({
      key: "insurance",
      label: "Insurance information",
      value: "Policy recorded",
      note: "Owner summary not published yet",
      href: "/insurance",
      tone: "attention",
    });
  } else {
    tiles.push({
      key: "insurance",
      label: "Insurance information",
      value: "Complete",
      note: "Policy recorded · owner summary published",
      href: "/insurance",
      tone: "good",
    });
  }

  // ---- Tax information ---------------------------------------------------------------------
  const tax = input.taxInfo;
  if (!tax.einOnFile) {
    tiles.push({ key: "tax", label: "Tax information", value: null, note: "EIN not on file yet", href: "/building", tone: "neutral" });
  } else if (!tax.reviewed) {
    tiles.push({
      key: "tax",
      label: "Tax information",
      value: "EIN on file",
      note: "Tax review not started yet",
      href: "/tax",
      tone: "attention",
    });
  } else {
    tiles.push({
      key: "tax",
      label: "Tax information",
      value: "Set up",
      note: "EIN on file · tax review done",
      href: "/tax",
      tone: "good",
    });
  }

  // ---- Contractor paperwork -----------------------------------------------------------
  // Archived contractors are history, not paperwork to chase; and a contractor
  // saved from a search but never hired owes nothing yet (repairs-spec §18.4).
  const saved = input.contractors.filter((c) => !c.archived);
  if (saved.length === 0) {
    tiles.push({ key: "contractors", label: "Contractors on file", value: null, note: "None added yet", href: "/repairs?view=contractors", tone: "neutral" });
  } else {
    const used = saved.filter((c) => c.inUse !== false);
    const missingW9 = used.filter((c) => !c.w9OnFile && !c.is1099Exempt).length;
    const lapsed = used.filter((c) => c.insuredUntil !== null && c.insuredUntil < todayIso).length;
    const lapsedLicense = used.filter((c) => (c.licenseExpiresOn ?? null) !== null && c.licenseExpiresOn! < todayIso).length;
    const parts = [
      missingW9 > 0 ? `${plural(missingW9, "W-9")} missing` : null,
      lapsed > 0 ? `${plural(lapsed, "insurance certificate")} expired` : null,
      lapsedLicense > 0 ? `${plural(lapsedLicense, "license")} expired` : null,
    ].filter((p): p is string => p !== null);
    tiles.push(
      parts.length === 0
        ? {
            key: "contractors",
            label: "Contractor W-9s and paperwork",
            value: "In order",
            note: `${plural(saved.length, "contractor")}, all current`,
            href: "/repairs?view=contractors",
            tone: "good",
          }
        : {
            key: "contractors",
            label: "Contractor W-9s and paperwork",
            value: `${plural(missingW9 + lapsed + lapsedLicense, "gap")}`,
            note: parts.join(" · "),
            href: "/repairs?view=contractors",
            tone: "attention",
          },
    );
  }

  return tiles;
}
