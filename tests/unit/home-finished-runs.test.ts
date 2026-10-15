import { describe, expect, it } from "vitest";
import { finishedRuns, parseQueryKey } from "@/lib/home/finished-runs";
import { boardRepairsCount, ownerRepairsCount, type BadgeTicket } from "@/lib/home/repairs-badge";

const now = new Date("2026-10-14T18:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

describe("finished background runs on Home (foundation-spec 5.3)", () => {
  it("reads the phrase and wants back out of a web cache key", () => {
    expect(parseQueryKey("roof leak|emergency,condo_work")).toEqual({ phrase: "roof leak", wants: ["emergency", "condo_work"] });
    expect(parseQueryKey("|")).toEqual({ phrase: "", wants: [] });
  });

  it("says a contractor search finished and links back to the same search", () => {
    const [run] = finishedRuns({
      contractor: [{ id: "r1", trade: "roofing", query_key: "roof leak|", ai_state: "done", ai_finished_at: hoursAgo(2), resultCount: 6 }],
      market: [],
      now,
    });
    expect(run).toMatchObject({
      title: "Contractor search finished: 6 found for “roof leak”",
      action: "See them",
      href: "/repairs/find?trade=roofing&phrase=roof+leak&want=none",
      failed: false,
    });
  });

  it("names the trade when there was no phrase, and says when a search failed", () => {
    const [run] = finishedRuns({
      contractor: [{ id: "r2", trade: "plumbing", query_key: "|emergency", ai_state: "failed", ai_finished_at: hoursAgo(1), resultCount: 0 }],
      market: [],
      now,
    });
    expect(run.title).toBe("The contractor search for “plumbing” didn't finish");
    expect(run.href).toBe("/repairs/find?trade=plumbing&want=emergency");
    expect(run.failed).toBe(true);
  });

  it("covers the Marketplace searches, newest first, and forgets runs older than a day or still running", () => {
    const runs = finishedRuns({
      contractor: [{ id: "old", trade: "roofing", query_key: "|", ai_state: "done", ai_finished_at: hoursAgo(30), resultCount: 2 }],
      market: [
        { kind: "agencies", ai_state: "done", ai_finished_at: hoursAgo(5), itemCount: 4 },
        { kind: "insurers", ai_state: "done", ai_finished_at: hoursAgo(1), itemCount: 0 },
        { kind: "agencies", ai_state: "running", ai_finished_at: hoursAgo(1), itemCount: 0 },
      ],
      now,
    });
    expect(runs.map((r) => [r.title, r.action, r.href])).toEqual([
      ["Insurer search finished: 0 found", "Open the Marketplace", "/insurance?view=market"],
      ["Agency search finished: 4 found", "See them", "/insurance?view=market"],
    ]);
  });

  it("uses no em dashes", () => {
    const runs = finishedRuns({
      contractor: [
        { id: "a", trade: "roofing", query_key: "|", ai_state: "done", ai_finished_at: hoursAgo(1), resultCount: 1 },
        { id: "b", trade: "roofing", query_key: "|", ai_state: "failed", ai_finished_at: hoursAgo(1), resultCount: 0 },
      ],
      market: [{ kind: "agencies", ai_state: "failed", ai_finished_at: hoursAgo(1), itemCount: 0 }],
      now,
    });
    for (const r of runs) expect(`${r.title} ${r.why} ${r.action}`).not.toContain("—");
  });
});

describe("Repairs & Upkeep sidebar badge (repairs-spec §18.6)", () => {
  const t = (over: Partial<BadgeTicket> = {}): BadgeTicket => ({
    id: Math.random().toString(36).slice(2),
    status: "open",
    priority: "normal",
    emergency_kind: null,
    created_at: "2026-10-01T00:00:00Z",
    mine: false,
    triage_emergency: null,
    triage_at: null,
    emergency_suggestion_dismissed_at: null,
    ...over,
  });

  it("board: counts urgent, emergencies, undismissed AI emergencies, new reports and overdue upkeep, each problem once", () => {
    const since = "2026-10-10T00:00:00Z";
    const n = boardRepairsCount({
      since,
      overdueUpkeep: 2,
      now,
      tickets: [
        t({ priority: "urgent" }),
        t({ emergency_kind: "gas" }),
        t({ triage_emergency: "flooding", triage_at: "2026-10-12T00:00:00Z" }),
        t({ triage_emergency: "flooding", triage_at: "2026-10-12T00:00:00Z", emergency_suggestion_dismissed_at: "2026-10-13T00:00:00Z" }),
        t({ created_at: "2026-10-12T00:00:00Z" }),
        t({ created_at: "2026-10-12T00:00:00Z", mine: true }),
        t({ created_at: "2026-10-12T00:00:00Z", priority: "urgent" }),
        t({ status: "resolved", priority: "urgent" }),
        t(),
      ],
    });
    expect(n).toBe(5 + 2);
  });

  it("board: a first visit counts the last 7 days of reports", () => {
    const n = boardRepairsCount({ since: null, overdueUpkeep: 0, now, tickets: [t({ created_at: "2026-10-10T00:00:00Z" }), t({ created_at: "2026-10-01T00:00:00Z" })] });
    expect(n).toBe(1);
  });

  it("owner: updates on their own reports and units, plus fixes waiting for them", () => {
    const n = ownerRepairsCount({
      myPersonId: "me",
      myUnitIds: new Set(["u1"]),
      events: [
        { ticket_id: "a", reported_by: "me", unit_id: null },
        { ticket_id: "a", reported_by: "me", unit_id: null },
        { ticket_id: "b", reported_by: "someone", unit_id: "u1" },
        { ticket_id: "c", reported_by: "someone", unit_id: null },
      ],
      awaitingConfirmation: ["a", "d"],
    });
    expect(n).toBe(3);
  });
});
