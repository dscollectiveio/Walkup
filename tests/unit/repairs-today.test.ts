import { describe, expect, it } from "vitest";
import { buildToday, possibleEmergency, recordedRepairCosts, todayIsEmpty, type TodayInput, type TodayTicket } from "@/lib/repairs/today";

const TODAY = "2026-10-14";
const SINCE = "2026-10-13T20:00:00Z";

let n = 0;
function ticket(over: Partial<TodayTicket> = {}): TodayTicket {
  n += 1;
  return {
    id: `t${n}`,
    reference: n,
    title: `Problem ${n}`,
    status: "open",
    priority: "normal",
    emergency_kind: null,
    due_on: null,
    scheduled_for: null,
    scheduled_window: null,
    assigned_vendor_id: null,
    contractor_name: null,
    resolved_at: null,
    opened_on: "2026-10-01",
    created_at: "2026-10-01T15:00:00Z",
    reporter_is_me: false,
    where: "Shared area",
    triage_emergency: null,
    emergency_suggestion_dismissed_at: null,
    triage_at: null,
    bids: { requested: 0, received: 0, accepted: 0, expiringSoon: 0, expiringOn: null },
    reopenedAt: null,
    ...over,
  };
}

function input(over: Partial<TodayInput> = {}): TodayInput {
  return {
    todayIso: TODAY,
    since: SINCE,
    tickets: [],
    unsentQuoteRequests: 0,
    tasks: [],
    contractors: [],
    bills: [],
    spending: { ticketCents: 0, upkeepCents: 0 },
    ...over,
  };
}

describe("buildToday", () => {
  it("empty input is all clear", () => {
    const { sections, stats } = buildToday(input());
    expect(todayIsEmpty(sections)).toBe(true);
    expect(stats).toEqual({ open: 0, urgent: 0, upkeepOverdue: 0, visitsThisWeek: 0, recordedCostsCents: 0 });
  });

  it("lists open emergencies with their words and date", () => {
    const t = ticket({ emergency_kind: "flooding", priority: "urgent", title: "Water through ceiling", reference: 14, opened_on: TODAY, created_at: "2026-10-14T13:00:00Z" });
    const { sections, stats } = buildToday(input({ tickets: [t] }));
    expect(sections.emergencies).toHaveLength(1);
    expect(sections.emergencies[0].title).toBe("#14 Water through ceiling");
    expect(sections.emergencies[0].detail).toBe("Emergency: flooding · reported today");
    expect(sections.emergencies[0].action?.label).toBe("Open");
    // Not repeated under "new".
    expect(sections.new).toHaveLength(0);
    expect(stats.urgent).toBe(1);
  });

  it("a possible emergency stays until dismissed, and a newer suggestion brings it back", () => {
    const base = { triage_emergency: "gas", triage_at: "2026-10-14T10:00:00Z" };
    expect(buildToday(input({ tickets: [ticket(base)] })).sections.emergencies[0].detail).toBe("Possible emergency (AI suggestion): gas smell");
    expect(buildToday(input({ tickets: [ticket(base)] })).sections.emergencies[0].action?.label).toBe("Check it");
    const dismissed = ticket({ ...base, emergency_suggestion_dismissed_at: "2026-10-14T11:00:00Z" });
    expect(buildToday(input({ tickets: [dismissed] })).sections.emergencies).toHaveLength(0);
    const newer = ticket({ ...base, emergency_suggestion_dismissed_at: "2026-10-14T09:00:00Z" });
    expect(buildToday(input({ tickets: [newer] })).sections.emergencies).toHaveLength(1);
    expect(possibleEmergency({ emergency_kind: null, triage_emergency: "none", triage_at: null, emergency_suggestion_dismissed_at: null })).toBeNull();
  });

  it("a problem reported this morning is new the same day; my own reports aren't", () => {
    const fresh = ticket({ created_at: "2026-10-14T14:00:00Z", opened_on: TODAY, where: "Inside Unit 2" });
    const mine = ticket({ created_at: "2026-10-14T14:30:00Z", reporter_is_me: true });
    const old = ticket({ created_at: "2026-10-12T14:00:00Z" });
    const { sections } = buildToday(input({ tickets: [fresh, mine, old] }));
    expect(sections.new.map((i) => i.key)).toEqual([`new-${fresh.id}`]);
    expect(sections.new[0].detail).toBe("Reported today · Inside Unit 2");
  });

  it("first visit: new means the last 7 days, capped at 10 with 'and k more'", () => {
    const many = Array.from({ length: 12 }, (_, i) => ticket({ created_at: `2026-10-${String(10 + (i % 4)).padStart(2, "0")}T12:00:00Z` }));
    const { sections } = buildToday(input({ since: null, tickets: [...many, ticket({ created_at: "2026-10-01T12:00:00Z" })] }));
    expect(sections.new).toHaveLength(11);
    expect(sections.new[10].title).toBe("and 2 more");
    expect(sections.new[10].href).toBe("/repairs?view=problems&sort=newest");
  });

  it("decisions by stage", () => {
    const nobody = ticket({ opened_on: "2026-10-10" });
    const notYet = ticket({ opened_on: TODAY, created_at: "2026-10-14T01:00:00Z" });
    const quotesIn = ticket({ bids: { requested: 0, received: 2, accepted: 0, expiringSoon: 0, expiringOn: null } });
    const allIn = ticket({ bids: { requested: 0, received: 1, accepted: 0, expiringSoon: 0, expiringOn: null } });
    const waiting = ticket({ bids: { requested: 2, received: 1, accepted: 0, expiringSoon: 0, expiringOn: null } });
    const chosen = ticket({ assigned_vendor_id: "v1", contractor_name: "Acme Plumbing", bids: { requested: 0, received: 0, accepted: 1, expiringSoon: 0, expiringOn: null } });
    const { sections } = buildToday(input({ tickets: [nobody, notYet, quotesIn, allIn, waiting, chosen] }));
    const byKey = new Map(sections.decide.map((i) => [i.key, i]));
    expect(byKey.get(`decide-new-${nobody.id}`)?.detail).toBe("Nobody is on this yet.");
    expect(byKey.get(`decide-new-${nobody.id}`)?.action).toEqual({ label: "Get quotes", href: `/maintenance/${nobody.id}?open=quotes` });
    expect(byKey.has(`decide-new-${notYet.id}`)).toBe(false);
    expect(byKey.get(`decide-quotes-${quotesIn.id}`)?.detail).toBe("Quotes are in. Compare and choose.");
    expect(byKey.has(`decide-quotes-${allIn.id}`)).toBe(true);
    expect(byKey.has(`decide-quotes-${waiting.id}`)).toBe(false);
    expect(byKey.get(`decide-chosen-${chosen.id}`)?.detail).toBe("Acme Plumbing was chosen but hasn't been told.");
    expect(byKey.get(`decide-chosen-${chosen.id}`)?.action?.label).toBe("Send the go-ahead");
  });

  it("expiring quotes, reopened problems and unsent quote requests", () => {
    const expiring = ticket({ bids: { requested: 1, received: 1, accepted: 0, expiringSoon: 1, expiringOn: "2026-10-16" } });
    const reopened = ticket({ reopenedAt: "2026-10-05T12:00:00Z" });
    const longAgo = ticket({ reopenedAt: "2026-09-01T12:00:00Z" });
    const { sections } = buildToday(input({ tickets: [expiring, reopened, longAgo], unsentQuoteRequests: 2 }));
    const texts = sections.decide.map((i) => i.detail || i.title);
    expect(texts).toContain("A quote expires Fri, Oct 16.");
    expect(texts).toContain("Reopened by the reporter.");
    expect(sections.decide.filter((i) => i.detail === "Reopened by the reporter.")).toHaveLength(1);
    expect(texts).toContain("2 quote requests drafted but not marked sent.");
  });

  it("visits this week, overdue target dates and upkeep, coming up", () => {
    const visit = ticket({ scheduled_for: "2026-10-16", scheduled_window: "8 to 10am", contractor_name: "Acme" });
    const later = ticket({ scheduled_for: "2026-10-30" });
    const late = ticket({ due_on: "2026-10-01" });
    const { sections, stats } = buildToday(
      input({
        tickets: [visit, later, late],
        tasks: [
          { id: "k1", name: "Gutter cleaning", next_due_on: "2026-10-04" },
          { id: "k2", name: "Boiler service", next_due_on: "2026-11-01" },
          { id: "k3", name: "Roof check", next_due_on: "2027-04-01" },
        ],
        contractors: [
          { id: "v1", name: "Acme", compliance: [{ key: "coi_soon", tone: "warning", text: "Insurance certificate expires Nov 1", action: "request_coi" }] },
          { id: "v2", name: "Bolt", compliance: [{ key: "w9_missing", tone: "warning", text: "No W-9 on file", action: "request_w9" }] },
        ],
        bills: [
          { id: "b1", name: "Water", next_due_on: "2026-10-20", autopay_arranged: false, paused_at: null },
          { id: "b2", name: "Gas", next_due_on: "2026-10-20", autopay_arranged: true, paused_at: null },
          { id: "b3", name: "Paused", next_due_on: "2026-10-20", autopay_arranged: false, paused_at: "2026-09-01T00:00:00Z" },
        ],
      }),
    );
    expect(sections.visits.map((i) => i.detail)).toEqual(["Visit Fri, Oct 16, 8 to 10am · Acme"]);
    expect(stats.visitsThisWeek).toBe(1);
    expect(sections.overdue.map((i) => i.detail)).toEqual(["Target date was Thu, Oct 1.", "10 days overdue"]);
    expect(sections.overdue[1].action?.label).toBe("Mark done");
    expect(stats.upkeepOverdue).toBe(1);
    expect(sections.coming_up.map((i) => i.title).sort()).toEqual(["Acme", "Boiler service", "Water"]);
  });

  it("one close row for fixed problems past 30 days", () => {
    const old1 = ticket({ status: "resolved", resolved_at: "2026-09-01T12:00:00Z" });
    const old2 = ticket({ status: "resolved", resolved_at: "2026-09-10T12:00:00Z" });
    const recent = ticket({ status: "resolved", resolved_at: "2026-10-10T12:00:00Z" });
    const { sections } = buildToday(input({ tickets: [old1, old2, recent] }));
    expect(sections.close).toHaveLength(1);
    expect(sections.close[0].title).toBe("2 fixed problems nobody reopened in 30 days.");
    expect(sections.close[0].ticketIds).toEqual([old1.id, old2.id]);
    expect(sections.close[0].action?.href).toBe("/repairs?view=problems&stage=fixed");
  });

  it("adds the recorded costs", () => {
    const { stats } = buildToday(input({ spending: { ticketCents: 48000, upkeepCents: 12000 } }));
    expect(stats.recordedCostsCents).toBe(60000);
  });
});

describe("recordedRepairCosts", () => {
  it("counts a problem's final cost once when its close-out also logged upkeep", () => {
    const r = recordedRepairCosts({
      year: 2026,
      tickets: [
        { actual_cost: "480.00", resolved_at: "2026-10-01T12:00:00Z" },
        { actual_cost: "100.00", resolved_at: "2025-12-30T12:00:00Z" },
        { actual_cost: null, resolved_at: "2026-10-01T12:00:00Z" },
      ],
      upkeepLog: [
        { cost: "480.00", done_on: "2026-10-01", ticket_id: "t1" },
        { cost: "120.50", done_on: "2026-03-01", ticket_id: null },
        { cost: "99.00", done_on: "2025-03-01", ticket_id: null },
      ],
    });
    expect(r).toEqual({ ticketCents: 48000, upkeepCents: 12050 });
  });

  it("cuts the year in Chicago, not UTC (REVIEW-4 #10; replaces the reviewer's scratch tz.test.ts)", () => {
    // 20:00 on 31 December in Chicago is 02:00 on 1 January in UTC
    const tickets = [{ actual_cost: "100.00", resolved_at: "2027-01-01T02:00:00Z" }];
    expect(recordedRepairCosts({ year: 2026, tickets, upkeepLog: [] }).ticketCents).toBe(10000);
    expect(recordedRepairCosts({ year: 2027, tickets, upkeepLog: [] }).ticketCents).toBe(0);
    // 18:00 Chicago on 1 January is January in both
    const jan = [{ actual_cost: "50.00", resolved_at: "2027-01-02T00:00:00Z" }];
    expect(recordedRepairCosts({ year: 2027, tickets: jan, upkeepLog: [] }).ticketCents).toBe(5000);
    // timestamptz as Postgres prints it, with an offset
    const offset = [{ actual_cost: "10.00", resolved_at: "2026-12-31 20:00:00-06" }];
    expect(recordedRepairCosts({ year: 2026, tickets: offset, upkeepLog: [] }).ticketCents).toBe(1000);
  });
});
