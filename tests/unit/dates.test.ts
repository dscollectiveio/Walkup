import { describe, expect, it } from "vitest";
import { shortDate, syncedAgo, todayIso } from "@/lib/dates";

describe("shortDate", () => {
  it("drops the year when it's this year", () => {
    expect(shortDate("2026-09-14", "2026-10-01")).toBe("Sep 14");
  });
  it("keeps the year otherwise", () => {
    expect(shortDate("2025-12-31", "2026-10-01")).toBe("Dec 31, 2025");
  });
  it("doesn't shift across timezones (no Date parsing of the day)", () => {
    expect(shortDate("2026-03-01", "2026-10-01")).toBe("Mar 1");
  });
  it("passes through junk unchanged", () => {
    expect(shortDate("n/a", "2026-10-01")).toBe("n/a");
  });
});

describe("syncedAgo", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  it("reads in minutes, hours, then days", () => {
    expect(syncedAgo("2026-10-01T11:59:30Z", now)).toBe("synced just now");
    expect(syncedAgo("2026-10-01T11:30:00Z", now)).toBe("synced 30 minutes ago");
    expect(syncedAgo("2026-10-01T09:00:00Z", now)).toBe("synced 3 hours ago");
    expect(syncedAgo("2026-10-01T11:00:00Z", now)).toBe("synced 1 hour ago");
    expect(syncedAgo("2026-09-30T06:00:00Z", now)).toBe("synced yesterday");
    expect(syncedAgo("2026-09-20T06:00:00Z", now)).toBe("synced 11 days ago");
  });
  it("handles never", () => {
    expect(syncedAgo(null, now)).toBe("not synced yet");
  });
});

describe("todayIso", () => {
  it("formats local date", () => {
    expect(todayIso(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
