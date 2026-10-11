import { describe, expect, it } from "vitest";
import { buildHistoryIndex, recommend, typicalAmountCents, type PayeeHistoryRow } from "@/lib/plaid/recommend";

const accounts = {
  expense: [
    { id: "util", name: "Utilities" },
    { id: "ins", name: "Insurance" },
  ],
  income: [{ id: "int", name: "Interest income" }],
};

/** A bank_payee_history row, the way the trigger in 0046 would have tallied it. */
function filed(
  payee_key: string,
  direction: -1 | 1,
  choice: Pick<PayeeHistoryRow, "posting_kind" | "account_id" | "matched_unit_id">,
  count: number,
  amountCentsEach: number,
): PayeeHistoryRow {
  return { payee_key, direction, ...choice, count, amount_cents_total: count * amountCentsEach };
}

describe("recommend", () => {
  it("prefers what the board filed this payee as before, over the keyword table", () => {
    const history = buildHistoryIndex([
      filed("comed", -1, { posting_kind: "expense", account_id: "ins", matched_unit_id: null }, 2, 10000),
      filed("comed", -1, { posting_kind: "expense", account_id: "util", matched_unit_id: null }, 1, 10000),
    ]);
    const r = recommend({ description: "COMED 4444", amount: -120 }, history, accounts);
    expect(r).toMatchObject({ kind: "expense", accountId: "ins", source: "history", needsPick: false });
    expect(r?.reason).toBe("you filed this payee the same way twice before");
  });

  it("remembers which unit a recurring owner payment belongs to", () => {
    const history = buildHistoryIndex([
      filed("zelle j smith", 1, { posting_kind: "dues", account_id: null, matched_unit_id: "u2b" }, 1, 45000),
    ]);
    const r = recommend({ description: "ZELLE J SMITH", amount: 450 }, history, accounts);
    expect(r).toMatchObject({ kind: "dues", unitId: "u2b", needsPick: false });
    expect(r?.reason).toBe("you filed this payee the same way once before");
  });

  it("keeps direction separate: a refund from a vendor isn't filed like a payment to them", () => {
    const history = buildHistoryIndex([
      filed("comed", -1, { posting_kind: "expense", account_id: "util", matched_unit_id: null }, 1, 10000),
    ]);
    const r = recommend({ description: "COMED", amount: 30 }, history, accounts);
    expect(r?.source).not.toBe("history");
  });

  it("knows what a payee usually costs, across every way it was filed", () => {
    const history = buildHistoryIndex([
      filed("comed", -1, { posting_kind: "expense", account_id: "util", matched_unit_id: null }, 3, 10000),
      // bigint columns can arrive as strings from PostgREST
      { ...filed("comed", -1, { posting_kind: "expense", account_id: "ins", matched_unit_id: null }, 1, 20000), amount_cents_total: "20000" },
    ]);
    expect(typicalAmountCents({ description: "COMED 8841", amount: -300 }, history)).toBe(12500);
    expect(typicalAmountCents({ description: "COMED 8841", amount: 300 }, history)).toBeNull();
    expect(typicalAmountCents({ description: "NEVER SEEN", amount: -1 }, history)).toBeNull();
  });

  it("leaves a row's own amount out of 'typical' once it has been filed", () => {
    // Three $100 bills and this $900 one, all already tallied by the trigger.
    const history = buildHistoryIndex([
      filed("comed", -1, { posting_kind: "expense", account_id: "util", matched_unit_id: null }, 4, 30000),
    ]);
    const big = { description: "COMED 8841", amount: -900 };
    expect(typicalAmountCents(big, history)).toBe(30000);
    expect(typicalAmountCents(big, history, { alreadyFiled: true })).toBe(10000);
    // The only filing there is: a first-time payee, not a typical amount.
    const once = buildHistoryIndex([
      filed("new vendor", -1, { posting_kind: "expense", account_id: "util", matched_unit_id: null }, 1, 5000),
    ]);
    expect(typicalAmountCents({ description: "NEW VENDOR", amount: -50 }, once, { alreadyFiled: true })).toBeNull();
  });

  it("takes a filed row's own amount out of a mean built across every choice, not just the most-used one", () => {
    // Four $50 Utilities and two $500 Repairs: the others of a $50 row average $230.
    const mixed = buildHistoryIndex([
      filed("comed", -1, { posting_kind: "expense", account_id: "util", matched_unit_id: null }, 4, 5000),
      filed("comed", -1, { posting_kind: "expense", account_id: "rep", matched_unit_id: null }, 2, 50000),
    ]);
    expect(typicalAmountCents({ description: "COMED 8841", amount: -50 }, mixed, { alreadyFiled: true })).toBe(23000);
    // Filed once each way: a second filing exists, so this is not a first-time payee.
    const twice = buildHistoryIndex([
      filed("comed", -1, { posting_kind: "expense", account_id: "util", matched_unit_id: null }, 1, 5000),
      filed("comed", -1, { posting_kind: "expense", account_id: "rep", matched_unit_id: null }, 1, 50000),
    ]);
    expect(typicalAmountCents({ description: "COMED 8841", amount: -500 }, twice, { alreadyFiled: true })).toBe(5000);
  });

  it("ignores payee keys too short to mean anything", () => {
    const history = buildHistoryIndex([
      filed("ab", -1, { posting_kind: "expense", account_id: "util", matched_unit_id: null }, 5, 100),
    ]);
    expect(history.size).toBe(0);
  });

  it("falls back to the keyword table with a one-click target", () => {
    const r = recommend({ description: "West Bend Mutual", amount: -900 }, new Map(), accounts);
    expect(r).toMatchObject({ kind: "expense", accountId: "ins", source: "keyword", needsPick: false });
  });

  it("still recommends dues and transfers, but asks for the pick", () => {
    expect(recommend({ description: "Zelle payment", amount: 450 }, new Map(), accounts)).toMatchObject({
      kind: "dues",
      needsPick: true,
    });
    expect(recommend({ description: "Online transfer to savings", amount: -5000 }, new Map(), accounts)).toMatchObject({
      kind: "transfer",
      needsPick: true,
    });
  });

  describe("duplicate guard", () => {
    const history = buildHistoryIndex([
      filed("zelle j smith", 1, { posting_kind: "dues", account_id: null, matched_unit_id: "u2b" }, 3, 45000),
    ]);
    const deposit = { description: "ZELLE J SMITH", amount: "450.00", posted_on: "2026-10-06" };

    it("keeps a deposit out of the books when the same dues were already recorded by hand", () => {
      const r = recommend(deposit, history, accounts, {
        manualPayments: [{ unit_id: "u2b", amount: 450, received_on: "2026-10-03" }],
      });
      expect(r).toMatchObject({ kind: "excluded", source: "duplicate", needsPick: false, unitId: null });
      expect(r?.reason).toBe("looks like the $450 you recorded by hand on Oct 3 — already in the books");
    });

    it("picks the closest payment and keeps the cents when they matter", () => {
      const r = recommend({ ...deposit, amount: 450.5 }, history, accounts, {
        manualPayments: [
          { unit_id: "u2b", amount: "450.50", received_on: "2026-09-28" },
          { unit_id: "u2b", amount: "450.50", received_on: "2026-10-07" },
        ],
      });
      expect(r?.reason).toContain("$450.50 you recorded by hand on Oct 7");
    });

    it("still recommends dues when the hand-recorded payment is another unit's, another amount, or too far away", () => {
      const cases = [
        { unit_id: "u1a", amount: 450, received_on: "2026-10-03" },
        { unit_id: "u2b", amount: 400, received_on: "2026-10-03" },
        { unit_id: "u2b", amount: 450, received_on: "2026-09-20" },
      ];
      for (const p of cases) {
        expect(recommend(deposit, history, accounts, { manualPayments: [p] })).toMatchObject({
          kind: "dues",
          unitId: "u2b",
          source: "history",
        });
      }
      expect(recommend(deposit, history, accounts)).toMatchObject({ kind: "dues", source: "history" });
    });
  });

  it("recommends nothing when it has nothing to go on", () => {
    expect(recommend({ description: "XQZ 99", amount: -12 }, new Map(), accounts)).toBeNull();
  });
});
