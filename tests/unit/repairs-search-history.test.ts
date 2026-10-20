import { describe, expect, it } from "vitest";
import { addEntry, historyLabel, parseHistory, type HistoryEntry } from "@/lib/contractors/search-history";

const e = (href: string, over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  href,
  job: "",
  tradeLabel: "Plumbing",
  phrase: "",
  miles: 20,
  minRating: 3.5,
  minReviews: 10,
  emergency: false,
  at: "2026-10-20T12:00:00.000Z",
  ...over,
});

describe("search history", () => {
  it("keeps newest first, moves a repeat to the top and stops at the limit", () => {
    const list = addEntry(addEntry([], e("/repairs/find?a")), e("/repairs/find?b"));
    expect(addEntry(list, e("/repairs/find?a")).map((x) => x.href)).toEqual(["/repairs/find?a", "/repairs/find?b"]);
    const many = Array.from({ length: 12 }, (_, i) => e(`/repairs/find?${i}`)).reduce((acc, x) => addEntry(acc, x), [] as HistoryEntry[]);
    expect(many).toHaveLength(10);
  });

  it("reads only well-formed stored entries", () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory("nope")).toEqual([]);
    expect(parseHistory(JSON.stringify([e("/repairs/find?a"), e("https://evil.example"), { x: 1 }]))).toHaveLength(1);
  });

  it("words a search", () => {
    expect(historyLabel(e("/repairs/find", { emergency: true, minReviews: 0 }))).toMatch(/^Plumbing, 20 miles, 3.5\+ stars, Emergency Services/);
    expect(historyLabel(e("/repairs/find", { phrase: "sewer backup" }))).toContain('"sewer backup"');
  });
});
