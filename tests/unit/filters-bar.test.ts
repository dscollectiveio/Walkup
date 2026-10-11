import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import { FiltersBar } from "@/app/bank-feed/filters-bar";
import { bankFeedHref } from "@/app/bank-feed/href";

const render = (props: Parameters<typeof FiltersBar>[0]) => renderToStaticMarkup(createElement(FiltersBar, props));

describe("FiltersBar", () => {
  it("stays collapsed with no chips when nothing is active", () => {
    const html = render({ current: { range: "all", status: "needs", sort: "date_desc" } });
    expect(html).toContain("Filter &amp; search");
    expect(html).not.toContain("· on");
    expect(html).not.toMatch(/<details[^>]*open/);
    expect(html).not.toContain("Remove filter");
    expect(html).toContain('type="search"');
  });

  it("opens with a removable chip for each active filter", () => {
    const html = render({
      current: { q: "comed", range: "last_30", status: "needs", sort: "date_desc", account: "a1" },
      accountLabel: "Utilities",
    });
    expect(html).toMatch(/<details[^>]*open/);
    expect(html).toContain("· on");
    expect(html).toContain('value="comed"');
    expect(html).toContain("Last 30 days");
    expect(html).toContain("‘comed’");
    expect(html).toContain("Only Utilities");
    expect((html.match(/Remove filter/g) ?? []).length).toBe(3);
    expect(html).not.toContain(">Filter<");
  });
});

describe("bankFeedHref", () => {
  it("leaves defaults out and keeps everything else", () => {
    expect(bankFeedHref({ range: "all", status: "all", sort: "date_desc" })).toBe("/bank-feed");
    expect(
      bankFeedHref({ q: "comed", range: "last_30", status: "needs", sort: "amount_asc", account: "a1", limit: 400 }),
    ).toBe("/bank-feed?q=comed&account=a1&range=last_30&status=needs&sort=amount_asc&limit=400");
    expect(bankFeedHref({ range: "all", status: "all", sort: "date_desc", limit: 200 })).toBe("/bank-feed");
  });
});
