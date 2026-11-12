import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import { FiltersBar } from "@/app/bank-feed/filters-bar";
import { bankFeedHref } from "@/app/bank-feed/href";

const render = (props: Parameters<typeof FiltersBar>[0]) =>
  renderToStaticMarkup(createElement(FiltersBar, props));

describe("FiltersBar", () => {
  it("shows the search box and range select straight away, with no chips when nothing is active", () => {
    const html = render({
      current: { range: "all", status: "needs", sort: "date_desc" },
    });
    expect(html).toContain('type="search"');
    expect(html).toContain("Search by payee or description");
    expect(html).not.toContain("<details");
    expect(html).not.toContain("Filter &amp; search");
    expect(html).not.toContain("Remove filter");
  });

  it("keeps the search and range showing when a filter is active, with a chip only for the category filter", () => {
    const html = render({
      current: {
        q: "comed",
        range: "last_30",
        status: "needs",
        sort: "date_desc",
        account: "a1",
      },
      accountLabel: "Utilities",
    });
    expect(html).toContain('value="comed"');
    expect(html).toContain("Last 30 days");
    expect(html).not.toContain("‘comed’");
    expect(html).toContain("Only Utilities");
    expect((html.match(/Remove filter/g) ?? []).length).toBe(1);
    expect(html).not.toContain(">Filter<");
  });
});

describe("bankFeedHref", () => {
  it("leaves defaults out and keeps everything else", () => {
    expect(
      bankFeedHref({ range: "all", status: "sort", sort: "date_desc" }),
    ).toBe("/bank-feed");
    expect(
      bankFeedHref({ range: "all", status: "all", sort: "date_desc" }),
    ).toBe("/bank-feed?status=all");
    expect(
      bankFeedHref({
        range: "all",
        status: "all",
        sort: "date_desc",
        account: "a1",
      }),
    ).toBe("/bank-feed?account=a1");
    expect(
      bankFeedHref({
        q: "comed",
        range: "last_30",
        status: "needs",
        sort: "amount_asc",
        account: "a1",
        limit: 400,
      }),
    ).toBe(
      "/bank-feed?q=comed&account=a1&range=last_30&status=needs&sort=amount_asc&limit=400",
    );
    expect(
      bankFeedHref({
        range: "all",
        status: "sort",
        sort: "date_desc",
        limit: 200,
      }),
    ).toBe("/bank-feed");
  });
});
