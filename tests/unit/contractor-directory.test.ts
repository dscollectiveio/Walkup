import { describe, expect, it } from "vitest";
import {
  directoryHref,
  matchesQuery,
  orderDrafts,
  paperworkSummary,
  parseDirectoryParams,
  sortDirectory,
  type DirectoryRow,
} from "@/lib/contractors/directory";

function row(over: Partial<DirectoryRow>): DirectoryRow {
  return {
    id: over.name ?? "x",
    name: "X",
    status: "okay",
    contactName: null,
    trades: [],
    lastUsed: null,
    boardAverage: null,
    boardCount: 0,
    googleRating: null,
    googleCount: null,
    ...over,
  };
}

describe("directory params (repairs-spec §2.2)", () => {
  it("ignores invalid values", () => {
    expect(parseDirectoryParams({ q: "  acme ", trade: ["plumbing", "nope"], status: "bad", sort: "weird", archived: "yes" })).toEqual({
      q: "acme",
      trades: ["plumbing"],
      status: null,
      sort: "status",
      archived: false,
    });
  });

  it("round-trips through the URL", () => {
    const p = parseDirectoryParams({ q: "roof", trade: ["roofing", "gutters"], status: "preferred", sort: "google_rating", archived: "1" });
    const href = directoryHref(p);
    expect(href).toBe("/repairs?view=contractors&q=roof&trade=roofing&trade=gutters&status=preferred&sort=google_rating&archived=1");
    const back = new URLSearchParams(href.split("?")[1]);
    expect(parseDirectoryParams({ q: back.get("q")!, trade: back.getAll("trade"), status: back.get("status")!, sort: back.get("sort")!, archived: back.get("archived")! })).toEqual(p);
  });
});

describe("search", () => {
  it("matches name, contact person and trade label, every word", () => {
    const r = row({ name: "Acme Drains", contactName: "Pat Rivera", trades: ["sewer"] });
    expect(matchesQuery(r, "acme")).toBe(true);
    expect(matchesQuery(r, "rivera")).toBe(true);
    expect(matchesQuery(r, "rodding")).toBe(true); // "Sewer rodding & drains"
    expect(matchesQuery(r, "acme roof")).toBe(false);
    expect(matchesQuery(r, "")).toBe(true);
  });
});

describe("sort", () => {
  const a = row({ name: "Able", status: "okay", lastUsed: "2026-01-01", boardAverage: 5, boardCount: 1, googleRating: 5, googleCount: 1 });
  const b = row({ name: "Baker", status: "preferred", lastUsed: null, boardAverage: 4.6, boardCount: 10, googleRating: 4.8, googleCount: 900 });
  const c = row({ name: "Cole", status: "do_not_use", lastUsed: "2026-09-01" });

  it("puts preferred first, then the most recently used", () => {
    expect(sortDirectory([c, a, b], "status").map((r) => r.name)).toEqual(["Baker", "Able", "Cole"]);
  });

  it("sorts by last used with never-used last", () => {
    expect(sortDirectory([b, a, c], "last_used").map((r) => r.name)).toEqual(["Cole", "Able", "Baker"]);
  });

  it("weights ratings by review count, nulls last", () => {
    expect(sortDirectory([a, c, b], "your_rating").map((r) => r.name)).toEqual(["Baker", "Able", "Cole"]);
    expect(sortDirectory([a, c, b], "google_rating").map((r) => r.name)).toEqual(["Baker", "Able", "Cole"]);
  });
});

describe("paperwork answer", () => {
  it("is bad when anything expired and lists four then 'and k more'", () => {
    const items = ["A", "B", "C", "D", "E"].map((n, i) => ({ id: n, name: n, text: "No W-9 on file", tone: (i === 4 ? "bad" : "warning") as "bad" | "warning" }));
    const s = paperworkSummary(items)!;
    expect(s.status).toBe("bad");
    expect(s.headline).toBe("5 contractors need paperwork");
    expect(s.shown).toHaveLength(4);
    expect(s.more).toBe(1);
    expect(paperworkSummary([{ id: "a", name: "A", text: "x", tone: "warning" }])!.headline).toBe("1 contractor needs paperwork");
    expect(paperworkSummary([])).toBeNull();
  });
});

describe("emails waiting", () => {
  it("puts quote requests first, newest first within each", () => {
    const out = orderDrafts([
      { id: "1", kind: "general", createdAt: "2026-10-14T10:00:00Z" },
      { id: "2", kind: "quote_request", createdAt: "2026-10-12T10:00:00Z" },
      { id: "3", kind: "quote_request", createdAt: "2026-10-13T10:00:00Z" },
      { id: "4", kind: "coi_request", createdAt: "2026-10-14T11:00:00Z" },
    ]);
    expect(out.map((d) => d.id)).toEqual(["3", "2", "4", "1"]);
  });
});
