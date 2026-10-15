import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { historyTotals, mergeHistory, type HistoryItem } from "@/lib/contractors/history";

const ticket = (date: string, id = `t-${date}`): HistoryItem => ({ kind: "ticket", date, ticketId: id, reference: 4, title: "Leak", status: "resolved", cost: "450.00" });
const bid = (date: string): HistoryItem => ({ kind: "bid", date, ticketId: "t1", reference: 4, title: "Leak", status: "received", amount: "500.00" });
const upkeep = (date: string, ticketId: string | null = null): HistoryItem => ({ kind: "upkeep", date, taskId: `u-${date}`, taskName: "Boiler / furnace service", cost: "300.00", note: null, ticketId });
const payment = (date: string, amount: string): HistoryItem => ({ kind: "payment", date, expenseId: `p-${date}-${amount}`, amount, account: "Repairs and maintenance", memo: null });
const message = (date: string): HistoryItem => ({ kind: "message", date, messageId: `m-${date}`, subject: "Quote request", status: "sent", messageKind: "quote_request" });

describe("mergeHistory", () => {
  it("puts everything in one list, newest first", () => {
    const merged = mergeHistory([[ticket("2026-03-02"), ticket("2026-09-14")], [bid("2026-02-20")], [payment("2026-09-30", "450.00")], [message("2026-10-01")], [upkeep("2025-11-05")]]);
    expect(merged.map((i) => `${i.kind} ${i.date}`)).toEqual([
      "message 2026-10-01",
      "payment 2026-09-30",
      "ticket 2026-09-14",
      "ticket 2026-03-02",
      "bid 2026-02-20",
      "upkeep 2025-11-05",
    ]);
  });

  it("orders the same day as payment, job, upkeep, quote, message", () => {
    const day = "2026-05-01";
    const merged = mergeHistory([[message(day), bid(day)], [upkeep(day), ticket(day)], [payment(day, "10.00")]]);
    expect(merged.map((i) => i.kind)).toEqual(["payment", "ticket", "upkeep", "bid", "message"]);
  });

  it("is empty for nothing", () => {
    expect(mergeHistory([])).toEqual([]);
    expect(mergeHistory([[], []])).toEqual([]);
  });
});

describe("historyTotals", () => {
  it("adds payments in cents, this year and all time", () => {
    const items = [payment("2026-01-15", "0.10"), payment("2026-06-01", "0.20"), payment("2025-12-31", "1249.95"), payment("2026-10-01", "1000")];
    expect(historyTotals(items, "2026-10-14")).toMatchObject({ paidThisYear: "1000.30", paidAllTime: "2250.25" });
  });

  it("counts jobs once when a problem's close-out also logged upkeep", () => {
    const items = [ticket("2026-04-01", "t1"), upkeep("2026-04-03", "t1"), upkeep("2025-09-20"), bid("2026-02-01"), message("2026-02-01")];
    const totals = historyTotals(items, "2026-10-14");
    expect(totals.jobs).toBe(2);
    expect(totals.firstUsed).toBe("2025-09-20");
    expect(totals.lastUsed).toBe("2026-04-03");
  });

  it("is zero with no history; quotes and messages alone aren't use", () => {
    expect(historyTotals([bid("2026-01-01"), message("2026-01-02")], "2026-10-14")).toEqual({
      paidThisYear: "0.00", paidAllTime: "0.00", jobs: 0, firstUsed: null, lastUsed: null,
    });
  });
});
