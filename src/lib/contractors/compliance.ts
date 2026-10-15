// Contractor paperwork: certificate of insurance, license and W-9
// (repairs-spec §4.10). Pure.
//
// Missing paperwork only counts for a contractor the board actually uses
// (inUse), so saving a contractor found on the web doesn't raise alerts
// until you hire them. Expired and expiring items always count. Archived and
// do-not-use contractors return nothing.

import { humanDate } from "@/lib/repairs/format";
import { daysUntil } from "@/lib/upkeep/schedule";

export const COI_SOON_DAYS = 30;       // certificate of insurance
export const LICENSE_SOON_DAYS = 60;
export const IN_USE_DAYS = 365;

export type ComplianceTone = "ok" | "warning" | "bad";

export interface ComplianceItem {
  key: "coi_missing" | "coi_expired" | "coi_soon" | "license_missing" | "license_expired" | "license_soon" | "w9_missing";
  tone: ComplianceTone;
  text: string;
  action: "request_coi" | "request_w9" | "edit" | null;
}

export interface ComplianceInput {
  insured_until: string | null;
  license_number: string | null;
  license_expires_on: string | null;
  w9_on_file: boolean;
  is_1099_exempt: boolean;
  status: string;
  archived_at: string | null;
  /**
   * Assigned to an open ticket, the usual contractor on an active upkeep
   * task, or a ticket, expense or upkeep log in the last IN_USE_DAYS.
   */
  inUse: boolean;
  /** trade.licenseTypical for any of their trades (src/lib/contractors/trades.ts). */
  tradeNeedsLicense: boolean;
}

const TONE_RANK: Record<ComplianceTone, number> = { ok: 0, warning: 1, bad: 2 };

const blank = (v: string | null | undefined) => !v || !v.trim();

export function complianceFor(v: ComplianceInput, todayIso: string): { items: ComplianceItem[]; worst: ComplianceTone } {
  if (v.archived_at || v.status === "do_not_use") return { items: [], worst: "ok" };
  const items: ComplianceItem[] = [];

  if (v.insured_until) {
    const days = daysUntil(v.insured_until, todayIso);
    const date = humanDate(v.insured_until, todayIso);
    if (!Number.isFinite(days)) items.push({ key: "coi_expired", tone: "bad", text: "Insurance certificate date can't be read. Check it.", action: "edit" });
    else if (days < 0) items.push({ key: "coi_expired", tone: "bad", text: `Insurance certificate expired ${date}`, action: "request_coi" });
    else if (days <= COI_SOON_DAYS) items.push({ key: "coi_soon", tone: "warning", text: `Insurance certificate expires ${date}`, action: "request_coi" });
  } else if (v.inUse) {
    items.push({ key: "coi_missing", tone: "warning", text: "No insurance certificate on file", action: "request_coi" });
  }

  if (v.license_expires_on) {
    const days = daysUntil(v.license_expires_on, todayIso);
    const date = humanDate(v.license_expires_on, todayIso);
    if (!Number.isFinite(days)) items.push({ key: "license_expired", tone: "bad", text: "License date can't be read. Check it.", action: "edit" });
    else if (days < 0) items.push({ key: "license_expired", tone: "bad", text: `License expired ${date}`, action: "edit" });
    else if (days <= LICENSE_SOON_DAYS) items.push({ key: "license_soon", tone: "warning", text: `License expires ${date}`, action: "edit" });
  }
  if (blank(v.license_number) && v.inUse && v.tradeNeedsLicense) {
    items.push({ key: "license_missing", tone: "warning", text: "No license number on file", action: "edit" });
  }

  if (v.inUse && !v.is_1099_exempt && !v.w9_on_file) {
    items.push({ key: "w9_missing", tone: "warning", text: "No W-9 on file", action: "request_w9" });
  }

  // Worst first; the order above stands within a tone.
  const sorted = items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => TONE_RANK[b.item.tone] - TONE_RANK[a.item.tone] || a.i - b.i)
    .map((x) => x.item);
  const worst = sorted.reduce<ComplianceTone>((w, it) => (TONE_RANK[it.tone] > TONE_RANK[w] ? it.tone : w), "ok");
  return { items: sorted, worst };
}

/** True when the date is within the last IN_USE_DAYS (on or before today). */
export function usedRecently(dateIso: string | null | undefined, todayIso: string): boolean {
  if (!dateIso) return false;
  const days = daysUntil(dateIso, todayIso);
  return days <= 0 && days >= -IN_USE_DAYS;
}
