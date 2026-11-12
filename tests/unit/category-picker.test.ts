import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CategoryPicker,
  categoryOptions,
  optionFor,
} from "@/app/bank-feed/category-picker";
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

describe("categoryOptions: moving money", () => {
  const two: Pickers = {
    ...pickers,
    cashAccounts: [
      { id: "c0", label: "1000 Operating Cash" },
      { id: "c1", label: "1010 Reserve Cash" },
    ],
  };
  const labels = (p: Pickers, exclude?: string) =>
    categoryOptions(p, "out", exclude)
      .filter((o) => o.group.startsWith("Moving money"))
      .map((o) => o.label);

  it("never lists the account the money came from", () => {
    expect(labels(two, "c0")).toEqual(["Moved to Reserve Cash"]);
    expect(labels(two, "c1")).toEqual(["Moved to Operating Cash"]);
  });

  it("offers a card payment by name when a card is connected", () => {
    const withCard = {
      ...two,
      cardPayableId: "p1",
      cardNames: ["Plaid Credit Card ••3333"],
    };
    expect(labels(withCard, "c0")).toEqual([
      "Credit card payment · Plaid Credit Card ••3333",
      "Moved to Reserve Cash",
    ]);
  });

  it("offers a plain 'Credit card payment' when none is connected, and still treats it as a transfer", () => {
    const noCard = { ...two, cardPayableId: "p1", cardNames: [] };
    const o = categoryOptions(noCard, "out", "c0").find(
      (x) => x.label === "Credit card payment",
    );
    expect(o?.kind).toBe("transfer");
    expect(o?.accountId).toBe("p1");
  });

  it("offers no card payment for money coming in, or when the books have no card account", () => {
    expect(
      categoryOptions({ ...two, cardPayableId: "p1" }, "in").some((o) =>
        o.label.includes("credit card"),
      ),
    ).toBe(false);
    expect(labels(two)).not.toContain("Paid a credit card (not connected)");
  });
});

describe("categoryOptions", () => {
  it("groups money out as moving money first, then expenses, then not for the books — no dues or income", () => {
    const groups = [
      ...new Set(categoryOptions(pickers, "out").map((o) => o.group)),
    ];
    expect(groups).toEqual([
      "Moving money (transfer or card payment)",
      "Expenses",
      "Not for the books",
    ]);
  });

  it("groups money in as moving money first, then dues, other income, not for the books — no expenses", () => {
    const options = categoryOptions(pickers, "in");
    expect([...new Set(options.map((o) => o.group))]).toEqual([
      "Moving money (transfer or card payment)",
      "Dues",
      "Other income",
      "Not for the books",
    ]);
    expect(options.map((o) => o.label)).toEqual([
      "Moved to Reserve Cash",
      "Dues · 1A",
      "Dues · 2B",
      "Interest income",
      "Not for the books",
    ]);
  });

  it("offers everything for a mixed selection", () => {
    expect([
      ...new Set(categoryOptions(pickers, "any").map((o) => o.group)),
    ]).toEqual([
      "Moving money (transfer or card payment)",
      "Expenses",
      "Other income",
      "Dues",
      "Not for the books",
    ]);
  });

  it("each option sets kind, account and unit together", () => {
    const options = categoryOptions(pickers, "any");
    expect(
      optionFor(options, { kind: "dues", accountId: null, unitId: "u2" }),
    ).toMatchObject({ label: "Dues · 2B" });
    expect(
      optionFor(options, { kind: "transfer", accountId: "c1", unitId: null }),
    ).toMatchObject({
      label: "Moved to Reserve Cash",
    });
    expect(
      optionFor(options, { kind: "excluded", accountId: null, unitId: null }),
    ).toMatchObject({ id: "excluded" });
    expect(
      optionFor(options, { kind: "expense", accountId: "nope", unitId: null }),
    ).toBeNull();
  });
});

describe("CategoryPicker", () => {
  const render = (props: Partial<Parameters<typeof CategoryPicker>[0]>) =>
    renderToStaticMarkup(
      createElement(CategoryPicker, {
        pickers,
        direction: "out",
        value: null,
        onChange: () => {},
        ...props,
      }),
    );

  it("renders a combobox over a grouped listbox", () => {
    const html = render({ defaultOpen: true });
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('aria-label="Expenses"');
    expect(html).toContain(
      'aria-label="Moving money (transfer or card payment)"',
    );
    expect(html).toContain(">Utilities<");
    expect(html).toContain(">Moved to Reserve Cash<");
    expect(html).not.toContain("Dues · 2B");
    expect((html.match(/role="option"/g) ?? []).length).toBe(4);
  });

  it("shows the chosen label in the input and marks its option selected", () => {
    const html = render({
      value: { kind: "expense", accountId: "a2", unitId: null },
      defaultOpen: true,
    });
    expect(html).toContain('value="Insurance"');
    expect(html).toMatch(/aria-selected="true"[^>]*>Insurance</);
  });

  it("starts filtered to a kind when the kind is known but the target is not", () => {
    const html = render({
      direction: "in",
      defaultOpen: true,
      defaultQuery: "Dues",
    });
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
