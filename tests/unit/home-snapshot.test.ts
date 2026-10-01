import { describe, expect, it } from "vitest";
import { buildSnapshot, syncedWords, type SnapshotInput } from "@/lib/home/snapshot";

const today = new Date("2026-09-30T12:00:00");
const empty: SnapshotInput = {
  today,
  bankConnections: [],
  uncategorizedCount: 0,
  insuranceExpiresOn: null,
  nextFiling: null,
  contractors: [],
};
const tile = (t: ReturnType<typeof buildSnapshot>, key: string) => t.find((x) => x.key === key)!;

describe("buildSnapshot", () => {
  it("is exactly four tiles, and on a brand-new account every one is a nudge — no invented numbers", () => {
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

  it("counts days to the insurance renewal and flags one inside 60 days", () => {
    expect(tile(buildSnapshot({ ...empty, insuranceExpiresOn: "2026-11-15" }), "insurance")).toMatchObject({
      value: "Nov 15", note: "in 46 days", tone: "attention",
    });
    expect(tile(buildSnapshot({ ...empty, insuranceExpiresOn: "2027-06-01" }), "insurance")).toMatchObject({
      value: "Jun 1, 2027", tone: "neutral",
    });
  });

  it("shows the next filing, labels an unverified date as estimated, and flags one inside 30 days", () => {
    expect(
      tile(buildSnapshot({ ...empty, nextFiling: { name: "Form 1120-H", dueOn: "2027-04-15", estimated: true } }), "filing"),
    ).toMatchObject({ value: "Apr 15, 2027", note: "Form 1120-H (estimated) · in 197 days", tone: "neutral" });
    expect(
      tile(buildSnapshot({ ...empty, nextFiling: { name: "1099-NEC to contractors", dueOn: "2026-10-20", estimated: false } }), "filing"),
    ).toMatchObject({ note: "1099-NEC to contractors · in 20 days", tone: "attention" });
  });

  describe("contractor paperwork", () => {
    const c = (over = {}) => ({ w9OnFile: true, is1099Exempt: false, insuredUntil: "2027-03-01", ...over });

    it("is quiet when everything is current", () => {
      expect(tile(buildSnapshot({ ...empty, contractors: [c(), c()] }), "contractors")).toMatchObject({
        value: "In order", note: "2 contractors, all current", tone: "good",
      });
    });

    it("counts missing W-9s, expired certificates and contractors with none on file", () => {
      const t = tile(
        buildSnapshot({
          ...empty,
          contractors: [c({ w9OnFile: false }), c({ insuredUntil: "2026-08-01" }), c({ insuredUntil: null }), c({ w9OnFile: false, is1099Exempt: true })],
        }),
        "contractors",
      );
      expect(t).toMatchObject({
        value: "3 gaps",
        note: "1 W-9 missing · 1 insurance certificate expired · 1 with no insurance on file",
        tone: "attention",
      });
    });
  });
});
