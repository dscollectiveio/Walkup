import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/bank-feed/actions", () => ({
  applyCategorizations: vi.fn(),
  categorizeBankTransaction: vi.fn(),
  deleteCategorizationRule: vi.fn(),
  postBankTransaction: vi.fn(),
  unpostBankTransaction: vi.fn(),
}));

import {
  TransactionRow,
  labelForCategorization,
  type Pickers,
  type RowRecommendation,
  type TransactionRecord,
} from "@/app/bank-feed/transaction-row";

const pickers: Pickers = {
  expenseAccounts: [{ id: "a1", label: "6100 Utilities" }],
  incomeAccounts: [],
  cashAccounts: [{ id: "c1", label: "1010 Reserve Cash" }],
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
  rule_id: null,
};

const utilities: RowRecommendation = {
  kind: "expense",
  accountId: "a1",
  unitId: null,
  label: "Utilities",
  reason: "you filed this payee the same way 4 times before",
  needsPick: false,
  source: "history",
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

  it("the recommendation chip posts in one click, with Save for later beside it", () => {
    const html = render({
      suggestion: utilities,
      similar: [{ ...base, id: "t2" }, { ...base, id: "t3" }],
      onAcceptSuggestion: async () => ({}),
    });
    expect(html).toContain("Recommended");
    expect(html).toContain("Utilities");
    expect(html).toContain("+2 more");
    expect(html).toContain("4 times before");
    expect(html).toContain("and posts it to the books");
    expect(html).toContain("Save for later");
    expect(html).not.toContain("Accept &amp; post");
    // history-backed: filled
    expect(html).toContain("bg-info-tint");
  });

  it("a pending row's chip only saves, and says why", () => {
    const html = render({
      transaction: { ...base, pending: true },
      suggestion: utilities,
      onAcceptSuggestion: async () => ({}),
    });
    expect(html).toContain("Pending at the bank — posts once it settles");
    expect(html).toContain("Saves the category; it posts once the bank settles it");
    expect(html).not.toContain("Save for later");
  });

  it("a keyword guess is outlined and says it is a guess", () => {
    const html = render({
      suggestion: { ...utilities, source: "keyword", reason: "a guess from the description" },
      onAcceptSuggestion: async () => ({}),
    });
    expect(html).toContain("a guess from the description");
    expect(html).toContain("border-info-line bg-paper");
  });

  it("a likely duplicate is warning-tinted, says so in plain words, and files this row alone", () => {
    const html = render({
      transaction: { ...base, amount: "450" },
      similar: [{ ...base, id: "t2", amount: "450" }],
      suggestion: {
        kind: "excluded",
        accountId: null,
        unitId: null,
        label: "Not for the books",
        reason: "looks like the $450 you recorded by hand on Oct 3 — already in the books",
        needsPick: false,
        source: "duplicate",
      },
      onAcceptSuggestion: async () => ({}),
    });
    expect(html).toContain("Already recorded · not for the books");
    expect(html).toContain("bg-warning-tint");
    expect(html).toContain("recorded by hand on Oct 3");
    expect(html).not.toContain("+1 more");
    expect(html).not.toContain("along with");
  });

  it("calls the kept-out state Not for the books, like the picker does", () => {
    const html = render({
      transaction: { ...base, posting_kind: "excluded", excluded_at: "2026-09-15T00:00:00Z" },
    });
    expect(html).toContain("Not for the books");
    expect(html).not.toContain(">Excluded<");
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
        source: "keyword",
      },
      onAcceptSuggestion: async () => ({}),
    });
    expect(html).toContain("Recommended");
    expect(html).toContain("choose →");
    expect(html).toContain("pick the unit");
    expect(html).not.toContain("Save for later");
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

  it("explains the Pending pill", () => {
    const html = render({ transaction: { ...base, pending: true } });
    expect(html).toContain('title="The bank hasn&#x27;t settled this yet; it will post once it does"');
  });

  it("tags a row a rule filed, naming the rule, with Remove rule always visible for the board", () => {
    const html = render({
      transaction: { ...base, posting_kind: "expense", account_id: "a1", rule_id: "r1" },
      rulePattern: "COMED",
    });
    expect(html).toContain(">rule<");
    expect(html).toContain("Filed by your rule for ‘COMED’");
    expect(html).toContain("Remove rule");
    expect(html).not.toContain("opacity-0");
  });

  it("opens the categorize form with the searchable picker when told to", () => {
    const html = render({ editing: true, onEditingChange: () => {} });
    expect(html).toContain('role="combobox"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain("Save &amp; post");
    expect(html).toContain("Save for later");
    expect(html).not.toContain("Remember this");
  });

  it("is a card below sm and a table row above it, with the category and actions columns sized", () => {
    const html = render({});
    // the row: flex-wrap card on a phone, table row from sm up; editable rows are clickable
    expect(html).toMatch(/<tr[^>]*class="[^"]*flex flex-wrap[^"]*sm:table-row/);
    expect(html).toContain("cursor-pointer");
    // description + amount first, date (with the status beside it) second, category third, actions last
    expect(html).toContain("order-2 min-w-0 flex-1");
    expect(html).toContain("order-3 sm:order-none figures");
    expect(html).toContain("order-4 basis-full");
    expect(html).toContain("order-5 basis-full sm:basis-auto sm:order-none min-w-[14rem]");
    expect(html).toContain("order-6 basis-full");
    expect(html).toContain("sm:w-[11rem]");
    expect(html).toContain('<span class="ml-2 sm:hidden">');
  });

  it("posted rows are not clickable", () => {
    const html = render({ transaction: { ...base, posting_kind: "expense", account_id: "a1", journal_entry_id: "j1" } });
    expect(html).not.toContain("cursor-pointer");
    expect(html).toContain("Undo posting");
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

describe("labelForCategorization", () => {
  it("reads the way the picker does", () => {
    expect(labelForCategorization({ kind: "expense", accountId: "a1", unitId: null }, pickers)).toBe("Utilities");
    expect(labelForCategorization({ kind: "dues", accountId: null, unitId: "u1" }, pickers)).toBe("Dues · 2B");
    expect(labelForCategorization({ kind: "transfer", accountId: "c1", unitId: null }, pickers)).toBe(
      "Transfer · Reserve Cash",
    );
    expect(labelForCategorization({ kind: "excluded", accountId: null, unitId: null }, pickers)).toBe(
      "Not for the books",
    );
  });
});
