import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/bank-feed/actions", () => ({
  applyCategorizations: vi.fn(),
  categorizeBankTransaction: vi.fn(),
  postBankTransaction: vi.fn(),
  unpostBankTransaction: vi.fn(),
}));

import { TransactionRow, type Pickers, type TransactionRecord } from "@/app/bank-feed/transaction-row";

const pickers: Pickers = {
  expenseAccounts: [{ id: "a1", label: "6100 Utilities" }],
  incomeAccounts: [],
  cashAccounts: [],
  units: [{ id: "u1", label: "2B" }],
  vendors: [],
};

const base: TransactionRecord = {
  id: "t1",
  posted_on: "2026-09-14",
  description: "COMED 8841",
  amount: "-120.50",
  pending: false,
  raw_category: "Utilities",
  posting_kind: null,
  account_id: null,
  matched_unit_id: null,
  vendor_id: null,
  journal_entry_id: null,
  excluded_at: null,
  removed_at: null,
};

const render = (props: Partial<Parameters<typeof TransactionRow>[0]>) =>
  renderToStaticMarkup(
    createElement(
      "table",
      null,
      createElement(
        "tbody",
        null,
        createElement(TransactionRow, { transaction: base, pickers, canEdit: true, leadingCell: null, ...props }),
      ),
    ),
  );

describe("TransactionRow", () => {
  it("lays out date, description, category, amount and actions as separate cells", () => {
    const html = render({});
    expect((html.match(/<td/g) ?? []).length).toBe(6);
    expect(html).toContain("Sep 14");
    expect(html).toContain("COMED 8841");
    expect(html).toContain("Needs category");
    expect(html).toContain("−$120.50");
    expect(html).toContain("Categorize");
  });

  it("shows the recommendation, its reason, and how many same-payee rows come along", () => {
    const html = render({
      suggestion: {
        kind: "expense",
        accountId: "a1",
        unitId: null,
        label: "Utilities",
        reason: "you filed this payee the same way 4 times before",
        needsPick: false,
      },
      similar: [{ ...base, id: "t2" }, { ...base, id: "t3" }],
      onAcceptSuggestion: async () => ({}),
    });
    expect(html).toContain("Recommended");
    expect(html).toContain("Utilities");
    expect(html).toContain("+2 more");
    expect(html).toContain("4 times before");
    expect(html).toContain("Accept &amp; post");
  });

  it("still shows a recommendation that needs a pick, as a chooser rather than a save", () => {
    const html = render({
      transaction: { ...base, amount: "450" },
      suggestion: {
        kind: "dues",
        accountId: null,
        unitId: null,
        label: "Dues",
        reason: "looks like an owner payment — pick the unit",
        needsPick: true,
      },
      onAcceptSuggestion: async () => ({}),
    });
    expect(html).toContain("Recommended");
    expect(html).toContain("choose →");
    expect(html).toContain("pick the unit");
    expect(html).not.toContain("Accept &amp; post");
  });

  it("colors money in and shows the chosen category as a chip once categorized", () => {
    const html = render({
      transaction: { ...base, amount: "900", posting_kind: "dues", matched_unit_id: "u1" },
    });
    expect(html).toContain("text-good-text");
    expect(html).toContain("+$900.00");
    expect(html).toContain("Dues · 2B");
    expect(html).toContain("Ready to post");
    expect(html).toContain(">Post<");
  });

  it("drops the account code from the chip", () => {
    const html = render({
      transaction: { ...base, posting_kind: "expense", account_id: "a1" },
    });
    expect(html).toContain(">Utilities<");
    expect(html).not.toContain("6100 Utilities");
  });

  it("owners see no actions column", () => {
    const html = renderToStaticMarkup(
      createElement(
        "table",
        null,
        createElement("tbody", null, createElement(TransactionRow, { transaction: base, pickers, canEdit: false })),
      ),
    );
    expect((html.match(/<td/g) ?? []).length).toBe(4);
    expect(html).not.toContain("Categorize");
  });
});
