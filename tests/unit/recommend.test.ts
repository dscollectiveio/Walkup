import { describe, expect, it } from "vitest";
import { buildHistoryIndex, recommend } from "@/lib/plaid/recommend";

const accounts = {
  expense: [
    { id: "util", name: "Utilities" },
    { id: "ins", name: "Insurance" },
  ],
  income: [{ id: "int", name: "Interest income" }],
};

describe("recommend", () => {
  it("prefers what the board filed this payee as before, over the keyword table", () => {
    const history = buildHistoryIndex([
      { description: "COMED 1111", amount: -100, posting_kind: "expense", account_id: "ins", matched_unit_id: null },
      { description: "COMED 2222", amount: -100, posting_kind: "expense", account_id: "ins", matched_unit_id: null },
      { description: "COMED 3333", amount: -100, posting_kind: "expense", account_id: "util", matched_unit_id: null },
    ]);
    const r = recommend({ description: "COMED 4444", amount: -120 }, history, accounts);
    expect(r).toMatchObject({ kind: "expense", accountId: "ins", source: "history", needsPick: false });
    expect(r?.reason).toBe("you filed this payee the same way twice before");
  });

  it("remembers which unit a recurring owner payment belongs to", () => {
    const history = buildHistoryIndex([
      { description: "ZELLE J SMITH", amount: 450, posting_kind: "dues", account_id: null, matched_unit_id: "u2b" },
    ]);
    const r = recommend({ description: "ZELLE J SMITH", amount: 450 }, history, accounts);
    expect(r).toMatchObject({ kind: "dues", unitId: "u2b", needsPick: false });
    expect(r?.reason).toBe("you filed this payee the same way once before");
  });

  it("keeps direction separate: a refund from a vendor isn't filed like a payment to them", () => {
    const history = buildHistoryIndex([
      { description: "COMED", amount: -100, posting_kind: "expense", account_id: "util", matched_unit_id: null },
    ]);
    const r = recommend({ description: "COMED", amount: 30 }, history, accounts);
    expect(r?.source).not.toBe("history");
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
