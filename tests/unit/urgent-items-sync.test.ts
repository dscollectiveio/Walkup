import { describe, expect, it } from "vitest";
import { urgentItems } from "@/lib/home/urgent-items";

const today = new Date("2026-10-10T12:00:00Z");
const quiet = {
  booksVisible: true,
  booksBalance: true,
  aging: [],
  vendorsMissingW9: 0,
  nec1099Due: new Date("2027-01-31T00:00:00Z"),
  insuranceExpiry: null,
  bankConnected: true,
  today,
};

describe("urgentItems — bank sync", () => {
  it("nudges when the bank hasn't synced in more than three days", () => {
    const items = urgentItems({ ...quiet, lastSyncedAt: "2026-10-06T08:00:00Z" });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "sync",
      tone: "warning",
      title: "The bank hasn't synced in 4 days",
      action: { href: "/bank-feed" },
    });
  });

  it("stays quiet for a sync within three days, or when nothing has synced yet", () => {
    expect(urgentItems({ ...quiet, lastSyncedAt: "2026-10-08T08:00:00Z" })).toEqual([]);
    expect(urgentItems({ ...quiet, lastSyncedAt: null })).toEqual([]);
    expect(urgentItems(quiet)).toEqual([]);
  });

  it("says 'connect the bank' rather than 'sync' when there is no connection at all", () => {
    const items = urgentItems({ ...quiet, bankConnected: false, lastSyncedAt: "2026-09-01T08:00:00Z" });
    expect(items.map((i) => i.key)).toEqual(["bank"]);
  });
});
