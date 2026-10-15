import { describe, expect, it } from "vitest";
import { buildSnapshot, syncedWords, type SnapshotInput } from "@/lib/home/snapshot";

const today = new Date("2026-09-30T12:00:00");
const empty: SnapshotInput = {
  today,
  bankConnections: [],
  uncategorizedCount: 0,
  insuranceRenewal: null,
  nextFiling: null,
  contractors: [],
};
const tile = (t: ReturnType<typeof buildSnapshot>, key: string) => t.find((x) => x.key === key)!;

describe("buildSnapshot", () => {
  it("is exactly four tiles, and on a brand-new account every one is a nudge, no invented numbers", () => {
    const tiles = buildSnapshot(empty);
    expect(tiles.map((t) => t.key)).toEqual(["bank", "insurance", "filing", "contractors"]);
    expect(tiles.every((t) => t.value === null)).toBe(true);
    expect(tile(tiles, "bank").note).toBe("Not linked yet");
    expect(tile(tiles, "filing").href).toBe("/tax");
  });

  describe("bank", () => {
    const conn = (over = {}) => ({ status: "active", institutionName: "Chase", lastSyncedAt: "2026-09-30T08:00:00Z", ...over });

    it("shows linked, where, and when it last synced", () => {
      expect(tile(buildSnapshot({ ...empty, bankConnections: [conn()] }), "bank")).toMatchObject({
        value: "Linked", note: "Chase · synced today", tone: "good", href: "/bank-feed",
      });
    });

    it("folds the uncategorized backlog in and links straight to it", () => {
      expect(tile(buildSnapshot({ ...empty, bankConnections: [conn()], uncategorizedCount: 62 }), "bank")).toMatchObject({
        note: "Chase · synced today · 62 need a category", tone: "attention", href: "/bank-feed?status=needs",
      });
    });

    it("flags a sync that's gone stale (3+ days)", () => {
      const t = tile(buildSnapshot({ ...empty, bankConnections: [conn({ lastSyncedAt: "2026-09-25T08:00:00Z" })] }), "bank");
      expect(t).toMatchObject({ note: "Chase · synced 5 days ago", tone: "attention" });
    });

    it("says so when the connection is broken", () => {
      expect(tile(buildSnapshot({ ...empty, bankConnections: [conn({ status: "error" })] }), "bank")).toMatchObject({
        value: "Needs reconnecting", note: "Chase stopped syncing", tone: "attention",
      });
    });

    it("words sync age plainly", () => {
      expect(syncedWords(null, "2026-09-30")).toBe("not synced yet");
      expect(syncedWords("2026-09-29T01:00:00Z", "2026-09-30")).toBe("synced yesterday");
    });
  });

  describe("insurance", () => {
    const renewal = (effective_to: string, daysToEnd: number, withinReminder: boolean, renewed = false) => ({
      policy: { effective_to },
      daysToEnd,
      withinReminder,
      renewed,
    });

    it("counts days to the renewal and flags it inside the policy's own reminder window", () => {
      expect(tile(buildSnapshot({ ...empty, insuranceRenewal: renewal("2026-11-15", 46, true) }), "insurance")).toMatchObject({
        value: "Nov 15", note: "in 46 days", tone: "attention",
      });
      expect(tile(buildSnapshot({ ...empty, insuranceRenewal: renewal("2027-06-01", 244, false) }), "insurance")).toMatchObject({
        value: "Jun 1, 2027", tone: "neutral",
      });
    });

    it("does not flag a renewal inside 60 days when the policy's lead time is shorter", () => {
      expect(tile(buildSnapshot({ ...empty, insuranceRenewal: renewal("2026-11-15", 46, false) }), "insurance")).toMatchObject({
        note: "in 46 days", tone: "neutral",
      });
    });

    it("says the renewal is saved, quietly, when it is", () => {
      expect(tile(buildSnapshot({ ...empty, insuranceRenewal: renewal("2026-10-20", 20, false, true) }), "insurance")).toMatchObject({
        value: "Oct 20", note: "renewal saved", tone: "neutral",
      });
    });

    it("nudges to record a policy when none is in force", () => {
      expect(tile(buildSnapshot(empty), "insurance")).toMatchObject({ value: null, note: "No active policy recorded", href: "/insurance" });
    });
  });

  it("shows the next filing, labels an unverified date as estimated, and flags one inside 30 days", () => {
    expect(
      tile(buildSnapshot({ ...empty, nextFiling: { name: "Form 1120-H", dueOn: "2027-04-15", estimated: true } }), "filing"),
    ).toMatchObject({ value: "Apr 15, 2027", note: "Form 1120-H (estimated) · in 197 days", tone: "neutral" });
    expect(
      tile(buildSnapshot({ ...empty, nextFiling: { name: "2 1099-NECs to contractors", dueOn: "2026-10-20", estimated: false } }), "filing"),
    ).toMatchObject({ note: "2 1099-NECs to contractors · in 20 days", tone: "attention" });
  });

  it("says overdue for a filing whose date has passed, and due today on the day", () => {
    // lib/tax/deadlines keeps an overdue deadline for 120 days rather than rolling it forward.
    expect(
      tile(buildSnapshot({ ...empty, nextFiling: { name: "Illinois annual report", dueOn: "2026-09-20", estimated: true } }), "filing"),
    ).toMatchObject({ value: "Sep 20", note: "Illinois annual report (estimated) · overdue", tone: "attention" });
    expect(
      tile(buildSnapshot({ ...empty, nextFiling: { name: "Form 1096", dueOn: "2026-09-30", estimated: false } }), "filing"),
    ).toMatchObject({ note: "Form 1096 · due today", tone: "attention" });
  });

  describe("contractor paperwork", () => {
    const c = (over = {}) => ({ w9OnFile: true, is1099Exempt: false, insuredUntil: "2027-03-01", inUse: true, ...over });

    it("is quiet when everything is current, and links to the directory", () => {
      expect(tile(buildSnapshot({ ...empty, contractors: [c(), c()] }), "contractors")).toMatchObject({
        value: "In order", note: "2 contractors, all current", tone: "good", href: "/repairs?view=contractors",
      });
    });

    it("counts missing W-9s and expired certificates and licenses among contractors in use", () => {
      const t = tile(
        buildSnapshot({
          ...empty,
          contractors: [
            c({ w9OnFile: false }),
            c({ insuredUntil: "2026-08-01" }),
            c({ licenseExpiresOn: "2026-09-01" }),
            c({ insuredUntil: null }),
            c({ w9OnFile: false, is1099Exempt: true }),
          ],
        }),
        "contractors",
      );
      expect(t).toMatchObject({
        value: "3 gaps",
        note: "1 W-9 missing · 1 insurance certificate expired · 1 license expired",
        tone: "attention",
        href: "/repairs?view=contractors",
      });
    });

    it("ignores archived contractors and the paperwork of contractors not in use", () => {
      const t = tile(
        buildSnapshot({
          ...empty,
          contractors: [c(), c({ archived: true, insuredUntil: "2026-01-01" }), c({ inUse: false, w9OnFile: false, insuredUntil: "2026-01-01" })],
        }),
        "contractors",
      );
      expect(t).toMatchObject({ value: "In order", note: "2 contractors, all current", tone: "good" });
    });

    it("nudges to add one when every contractor is archived", () => {
      expect(tile(buildSnapshot({ ...empty, contractors: [c({ archived: true })] }), "contractors")).toMatchObject({
        value: null, note: "None added yet",
      });
    });
  });
});
