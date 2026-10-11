import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CategoryPicker, categoryOptions, optionFor } from "@/app/bank-feed/category-picker";
import type { Pickers } from "@/app/bank-feed/transaction-row";

const pickers: Pickers = {
  expenseAccounts: [
    { id: "a1", label: "6100 Utilities" },
    { id: "a2", label: "6200 Insurance" },
  ],
  incomeAccounts: [{ id: "i1", label: "4100 Interest income" }],
  cashAccounts: [{ id: "c1", label: "1010 Reserve Cash" }],
  units: [
    { id: "u1", label: "1A" },
    { id: "u2", label: "2B" },
  ],
  vendors: [],
};

describe("categoryOptions", () => {
  it("groups money out as expenses, transfers, not for the books — no dues or income", () => {
    const groups = [...new Set(categoryOptions(pickers, "out").map((o) => o.group))];
    expect(groups).toEqual(["Expenses", "Transfers", "Not for the books"]);
  });

  it("groups money in as dues, other income, transfers, not for the books — no expenses", () => {
    const options = categoryOptions(pickers, "in");
    expect([...new Set(options.map((o) => o.group))]).toEqual(["Dues", "Other income", "Transfers", "Not for the books"]);
    expect(options.map((o) => o.label)).toEqual([
      "Dues · 1A",
      "Dues · 2B",
      "Interest income",
      "Transfer · Reserve Cash",
      "Not for the books",
    ]);
  });

  it("offers everything for a mixed selection", () => {
    expect([...new Set(categoryOptions(pickers, "any").map((o) => o.group))]).toEqual([
      "Expenses",
      "Other income",
      "Dues",
      "Transfers",
      "Not for the books",
    ]);
  });

  it("each option sets kind, account and unit together", () => {
    const options = categoryOptions(pickers, "any");
    expect(optionFor(options, { kind: "dues", accountId: null, unitId: "u2" })).toMatchObject({ label: "Dues · 2B" });
    expect(optionFor(options, { kind: "transfer", accountId: "c1", unitId: null })).toMatchObject({
      label: "Transfer · Reserve Cash",
    });
    expect(optionFor(options, { kind: "excluded", accountId: null, unitId: null })).toMatchObject({ id: "excluded" });
    expect(optionFor(options, { kind: "expense", accountId: "nope", unitId: null })).toBeNull();
  });
});

describe("CategoryPicker", () => {
  const render = (props: Partial<Parameters<typeof CategoryPicker>[0]>) =>
    renderToStaticMarkup(
      createElement(CategoryPicker, { pickers, direction: "out", value: null, onChange: () => {}, ...props }),
    );

  it("renders a combobox over a grouped listbox", () => {
    const html = render({ defaultOpen: true });
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('aria-label="Expenses"');
    expect(html).toContain('aria-label="Transfers"');
    expect(html).toContain(">Utilities<");
    expect(html).toContain(">Transfer · Reserve Cash<");
    expect(html).not.toContain("Dues · 2B");
    expect((html.match(/role="option"/g) ?? []).length).toBe(4);
  });

  it("shows the chosen label in the input and marks its option selected", () => {
    const html = render({ value: { kind: "expense", accountId: "a2", unitId: null }, defaultOpen: true });
    expect(html).toContain('value="Insurance"');
    expect(html).toMatch(/aria-selected="true"[^>]*>Insurance</);
  });

  it("starts filtered to a kind when the kind is known but the target is not", () => {
    const html = render({ direction: "in", defaultOpen: true, defaultQuery: "Dues" });
    expect(html).toContain('value="Dues"');
    expect(html).toContain("Dues · 1A");
    expect(html).not.toContain("Interest income");
  });

  it("is closed until asked", () => {
    const html = render({});
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="listbox"');
  });
});
