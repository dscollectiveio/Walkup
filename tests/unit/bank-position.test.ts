import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { walkBackMonths } from "@/lib/bank/position";

const cash = new Map([
  ["chk", "operating"],
  ["sav", "reserve"],
]);

describe("walkBackMonths: month-end cash from today's bank balance", () => {
  it("ends on today's bank balance and steps back by each month's net movement", () => {
    const months = walkBackMonths(
      100_000, // $1,000.00 today
      ["2026-08-01", "2026-09-01", "2026-10-01"],
      [
        { posted_on: "2026-09-05", amount: "200.00", plaid_account_id: "chk" }, // in
        { posted_on: "2026-09-20", amount: "-50.00", plaid_account_id: "sav" }, // out
        { posted_on: "2026-10-02", amount: "-300.00", plaid_account_id: "chk" }, // out
      ],
      cash,
    );
    expect(months.map((m) => [m.key, m.balanceCents, m.inCents, m.outCents])).toEqual([
      ["2026-08-01", 115_000, 0, 0], // Sept close less Sept's +150
      ["2026-09-01", 130_000, 20_000, 5_000], // Oct close less Oct's -300
      ["2026-10-01", 100_000, 0, 30_000], // today
    ]);
  });

  it("ignores accounts that aren't cash (a card, a loan, an investment)", () => {
    const months = walkBackMonths(
      50_000,
      ["2026-09-01", "2026-10-01"],
      [
        { posted_on: "2026-10-03", amount: "-999.00", plaid_account_id: "card" },
        { posted_on: "2026-10-04", amount: "-10.00", plaid_account_id: null },
      ],
      cash,
    );
    expect(months).toEqual([
      { key: "2026-09-01", inCents: 0, outCents: 0, balanceCents: 50_000 },
      { key: "2026-10-01", inCents: 0, outCents: 0, balanceCents: 50_000 },
    ]);
  });
});
