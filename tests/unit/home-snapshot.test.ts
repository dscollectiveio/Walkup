import { describe, expect, it } from "vitest";
import { buildSnapshot, syncedWords, type SnapshotInput } from "@/lib/home/snapshot";

const today = new Date("2026-09-30T12:00:00");
const empty: SnapshotInput = {
  today,
  bankConnections: [],
  uncategorizedCount: 0,
  insuranceInfo: { policyRecorded: false, ownerSummaryPublished: false },
  taxInfo: { einOnFile: false, reviewed: false },
  contractors: [],
};
const tile = (t: ReturnType<typeof buildSnapshot>, key: string) => t.find((x) => x.key === key)!;

describe("buildSnapshot", () => {
  it("is exactly four tiles, and on a brand-new account every one is a nudge, no invented numbers", () => {
    const tiles = buildSnapshot(empty);
    expect(tiles.map((t) => t.key)).toEqual(["bank", "insurance", "tax", "contractors"]);
    expect(tiles.every((t) => t.value === null)).toBe(true);
    expect(tile(tiles, "bank").note).toBe("Not linked yet");
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

  describe("insurance information", () => {
    it("nudges to record a policy when none is on file", () => {
      expect(tile(buildSnapshot(empty), "insurance")).toMatchObject({ value: null, note: "No policy recorded yet", href: "/insurance", tone: "neutral" });
    });

    it("asks for the owner summary once a policy is recorded", () => {
      expect(
        tile(buildSnapshot({ ...empty, insuranceInfo: { policyRecorded: true, ownerSummaryPublished: false } }), "insurance"),
      ).toMatchObject({ value: "Policy recorded", note: "Owner summary not published yet", tone: "attention" });
    });

    it("is complete, quietly green, with the policy and the owner summary both in place", () => {
      expect(
        tile(buildSnapshot({ ...empty, insuranceInfo: { policyRecorded: true, ownerSummaryPublished: true } }), "insurance"),
      ).toMatchObject({ value: "Complete", tone: "good" });
    });
  });

  describe("tax information", () => {
    it("points at Building & Owners when there is no EIN", () => {
      expect(tile(buildSnapshot(empty), "tax")).toMatchObject({ value: null, note: "EIN not on file yet", href: "/building" });
    });

    it("asks for the tax review once the EIN is on file", () => {
      expect(tile(buildSnapshot({ ...empty, taxInfo: { einOnFile: true, reviewed: false } }), "tax")).toMatchObject({
        value: "EIN on file", note: "Tax review not started yet", href: "/tax", tone: "attention",
      });
    });

    it("is set up with the EIN and the review done", () => {
      expect(tile(buildSnapshot({ ...empty, taxInfo: { einOnFile: true, reviewed: true } }), "tax")).toMatchObject({
        value: "Set up", tone: "good",
      });
    });
  });

  it("has no dated tiles: renewals and filing deadlines are Coming up's job", () => {
    const keys = buildSnapshot(empty).map((t) => t.key);
    expect(keys).not.toContain("filing");
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
