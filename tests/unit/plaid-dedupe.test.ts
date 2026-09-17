import { describe, expect, it } from "vitest";
import { matchRule, planSyncWrites, type IncomingTransaction } from "@/lib/plaid/dedupe";

function tx(id: string, date: string, plaidAmount: number, name: string): IncomingTransaction {
  return { transaction_id: id, date, amount: plaidAmount, name, pending: false };
}

describe("planSyncWrites", () => {
  it("adopts a prior-connection row that matches on date, amount, and description", () => {
    // Plaid amount 51 (money out) is stored as -51.00 in Walkup.
    const plan = planSyncWrites(
      [tx("new-1", "2026-06-29", 51, "PPD ComEd PAYMENTS")],
      new Set(),
      [{ id: "old-row", posted_on: "2026-06-29", amount: "-51.00", description: "PPD ComEd PAYMENTS" }],
    );
    expect(plan.adoptions).toEqual([
      { priorId: "old-row", incoming: expect.objectContaining({ transaction_id: "new-1" }) },
    ]);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.upserts).toHaveLength(0);
  });

  it("treats an ID already known for this connection as a plain upsert, never an adoption", () => {
    const plan = planSyncWrites(
      [tx("known", "2026-06-29", 51, "PPD ComEd PAYMENTS")],
      new Set(["known"]),
      [{ id: "old-row", posted_on: "2026-06-29", amount: "-51.00", description: "PPD ComEd PAYMENTS" }],
    );
    expect(plan.upserts).toHaveLength(1);
    expect(plan.adoptions).toHaveLength(0);
  });

  it("pairs identical same-day transactions one-to-one, inserting any surplus", () => {
    const plan = planSyncWrites(
      [
        tx("a", "2026-08-27", 51, "PPD ComEd PAYMENTS"),
        tx("b", "2026-08-27", 51, "PPD ComEd PAYMENTS"),
        tx("c", "2026-08-27", 51, "PPD ComEd PAYMENTS"),
      ],
      new Set(),
      [
        { id: "old-1", posted_on: "2026-08-27", amount: -51, description: "PPD ComEd PAYMENTS" },
        { id: "old-2", posted_on: "2026-08-27", amount: -51, description: "ppd comed payments " },
      ],
    );
    expect(plan.adoptions.map((a) => a.priorId)).toEqual(["old-1", "old-2"]);
    expect(plan.inserts.map((t) => t.transaction_id)).toEqual(["c"]);
  });

  it("does not adopt across a sign or amount difference", () => {
    const plan = planSyncWrites(
      [tx("x", "2026-08-05", -4350, "DDA DEPOSIT")],
      new Set(),
      [{ id: "old", posted_on: "2026-08-05", amount: "-4350.00", description: "DDA DEPOSIT" }],
    );
    expect(plan.adoptions).toHaveLength(0);
    expect(plan.inserts).toHaveLength(1);
  });
});

describe("matchRule", () => {
  const rules = [
    { id: "r1", pattern: "ComEd", posting_kind: "expense", account_id: "utilities", matched_unit_id: null, vendor_id: null, auto_post: true },
    { id: "r2", pattern: "chase bank", posting_kind: "transfer", account_id: "chase", matched_unit_id: null, vendor_id: null, auto_post: false },
  ];

  it("matches case-insensitively as a substring, first rule wins", () => {
    expect(matchRule("PPD ComEd PAYMENTS", rules)?.id).toBe("r1");
    expect(matchRule("TRANSFER TO CK CHASE BANK", rules)?.id).toBe("r2");
    expect(matchRule("WEB CITY OF CHICAGO WATER BILL", rules)).toBeNull();
  });
});
