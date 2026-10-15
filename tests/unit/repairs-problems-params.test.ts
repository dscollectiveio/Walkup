import { describe, expect, it } from "vitest";
import {
  clearedParams,
  hasFilters,
  parseProblemParams,
  problemsHref,
  resolveView,
  viewsFor,
} from "@/lib/repairs/problems-params";

const BOARD = { isBoard: true, canReadFinancials: true };
const ACCOUNTANT = { isBoard: false, canReadFinancials: true };
const OWNER = { isBoard: false, canReadFinancials: false };

describe("views", () => {
  it("shows each viewer only the views they may use", () => {
    expect(viewsFor(BOARD)).toEqual(["today", "problems", "upkeep", "contractors", "bills"]);
    expect(viewsFor(ACCOUNTANT)).toEqual(["problems", "upkeep", "contractors", "bills"]);
    expect(viewsFor(OWNER)).toEqual(["problems", "upkeep"]);
  });

  it("defaults to Today for the board and Problems for everyone else", () => {
    expect(resolveView(undefined, BOARD)).toBe("today");
    expect(resolveView(undefined, OWNER)).toBe("problems");
    expect(resolveView(undefined, ACCOUNTANT)).toBe("problems");
  });

  it("falls back instead of showing an owner a board page", () => {
    expect(resolveView("today", OWNER)).toBe("problems");
    expect(resolveView("bills", OWNER)).toBe("problems");
    expect(resolveView("nonsense", BOARD)).toBe("today");
    expect(resolveView("bills", ACCOUNTANT)).toBe("bills");
  });
});

describe("parseProblemParams", () => {
  it("defaults", () => {
    const p = parseProblemParams({}, BOARD);
    expect(p).toMatchObject({ layout: "list", layoutFromUrl: false, q: "", status: "open", stage: null, trades: [], where: null, urgentOnly: false, mine: false, sort: "priority", older: false });
    expect(hasFilters(p)).toBe(false);
  });

  it("ignores invalid values", () => {
    const p = parseProblemParams({ status: "bogus", sort: "nope", where: "roof", stage: "maybe", trade: ["plumbing", "laser"], layout: "grid" }, BOARD);
    expect(p.status).toBe("open");
    expect(p.sort).toBe("priority");
    expect(p.where).toBeNull();
    expect(p.stage).toBeNull();
    expect(p.trades).toEqual(["plumbing"]);
    expect(p.layout).toBe("list");
  });

  it("keeps board-only values from owners", () => {
    const p = parseProblemParams({ stage: "quoting", sort: "due", layout: "board" }, OWNER);
    expect(p.stage).toBeNull();
    expect(p.sort).toBe("priority");
    expect(p.layout).toBe("list");
  });

  it("the accountant may use the board layout but not the due sort", () => {
    const p = parseProblemParams({ layout: "board", sort: "due" }, ACCOUNTANT);
    expect(p.layout).toBe("board");
    expect(p.sort).toBe("priority");
  });

  it("reads repeatable trades, the urgent and mine flags", () => {
    const p = parseProblemParams({ trade: ["plumbing", "roofing", "plumbing"], priority: "urgent", mine: "1", q: "  leak " }, BOARD);
    expect(p.trades).toEqual(["plumbing", "roofing"]);
    expect(p.urgentOnly).toBe(true);
    expect(p.mine).toBe(true);
    expect(p.q).toBe("leak");
    expect(hasFilters(p)).toBe(true);
  });
});

describe("problemsHref", () => {
  it("leaves defaults out and keeps filters", () => {
    const p = parseProblemParams({ status: "done", trade: "plumbing", q: "a b" }, BOARD);
    expect(problemsHref(p)).toBe("/repairs?view=problems&q=a+b&status=done&trade=plumbing");
    expect(problemsHref(clearedParams(p))).toBe("/repairs?view=problems");
  });

  it("switches layout", () => {
    const p = parseProblemParams({}, BOARD);
    expect(problemsHref(p, { layout: "board" })).toBe("/repairs?view=problems&layout=board");
    expect(problemsHref(p, { layout: "list", layoutFromUrl: true })).toBe("/repairs?view=problems&layout=list");
  });
});
