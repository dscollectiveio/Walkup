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

  it("recommends nothing when it has nothing to go on", () => {
    expect(recommend({ description: "XQZ 99", amount: -12 }, new Map(), accounts)).toBeNull();
  });
});
