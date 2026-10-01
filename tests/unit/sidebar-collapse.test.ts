import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/budget" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown } & Record<string, unknown>) =>
    createElement("a", { href, ...rest }, children as never),
}));

import { Sidebar } from "@/components/sidebar/sidebar";
import { NAV_GROUPS, TRAILING_NAV, UNGROUPED_NAV } from "@/components/sidebar/config";

const render = (initialCollapsed: boolean) =>
  renderToStaticMarkup(
    createElement(Sidebar, {
      associationName: "Test HOA",
      uncategorizedCount: 3,
      userEmail: "a@b.co",
      signOutAction: async () => {},
      initialCollapsed,
    }),
  );

describe("Sidebar collapse", () => {
  it("expanded: full width at desktop, labels and group headings shown", () => {
    const html = render(false);
    expect(html).toContain("min-[900px]:w-[232px]");
    expect(html).toContain("min-[900px]:not-sr-only");
    expect(html).toContain("Finances &amp; Dues");
    expect(html).toContain("Collapse sidebar");
  });

  it("collapsed: icon rail only, no desktop widening, labels screen-reader-only", () => {
    const html = render(true);
    expect(html).not.toContain("min-[900px]:w-[232px]");
    expect(html).not.toContain("min-[900px]:not-sr-only");
    expect(html).not.toContain("Finances &amp; Dues");
    expect(html).toContain("Expand sidebar");
  });

  it("every tab keeps an icon and a tooltip/label when collapsed", () => {
    const html = render(true);
    const items = [...UNGROUPED_NAV, ...NAV_GROUPS.flatMap((g) => g.items), ...TRAILING_NAV];
    for (const item of items) {
      expect(html).toContain(`title="${item.label.replace("&", "&amp;")}"`);
    }
    expect((html.match(/<svg/g) ?? []).length).toBeGreaterThanOrEqual(items.length);
  });
});
