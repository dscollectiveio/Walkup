import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/budget" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown } & Record<string, unknown>) =>
    createElement("a", { href, ...rest }, children as never),
}));

import { Sidebar } from "@/components/sidebar/sidebar";
import { NAV_GROUPS, TRAILING_NAV, UNGROUPED_NAV, pageTitleFor } from "@/components/sidebar/config";

const render = (initialMode: "expanded" | "rail") =>
  renderToStaticMarkup(
    createElement(Sidebar, {
      associationName: "Test HOA",
      uncategorizedCount: 3,
      userEmail: "a@b.co",
      initialMode,
    }),
  );

const items = [...UNGROUPED_NAV, ...NAV_GROUPS.flatMap((g) => g.items), ...TRAILING_NAV];

describe("Sidebar: expanded and rail", () => {
  it("expanded: 288px, labels and group headings visible, numbered badge", () => {
    const html = render("expanded");
    expect(html).toContain("w-[288px]");
    expect(html).toContain("Finances &amp; Dues");
    expect(html).toContain("Collapse navigation");
    expect(html).toContain(">3<"); // the badge number
    for (const item of items) expect(html).toContain(item.label.replace("&", "&amp;"));
  });

  it("rail: 72px, labels kept for screen readers, no hover pop-out, dot badge", () => {
    const html = render("rail");
    expect(html).toContain("w-[72px]");
    expect(html).not.toContain("Finances &amp; Dues"); // group headings become dividers
    expect(html).toContain("Expand navigation");
    expect(html).not.toContain('role="tooltip"'); // the hover pop-out label is gone; the sidebar slides out instead
    expect(html).toContain("3 waiting");
    expect(html).not.toContain(">3<");
    for (const item of items) expect(html).toContain(item.label.replace("&", "&amp;"));
  });

  it("same items in the same order in both states, active item marked", () => {
    const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => h !== "/" || true);
    const a = hrefs(render("expanded")).filter((h) => items.some((i) => i.href === h));
    const b = hrefs(render("rail")).filter((h) => items.some((i) => i.href === h));
    expect(a).toEqual(b);
    expect(render("rail")).toContain('aria-current="page"');
  });

  it("labels the first item Dashboard and gives it its own hue in both states", () => {
    for (const mode of ["expanded", "rail"] as const) {
      const html = render(mode);
      expect(html).toContain("Dashboard");
      expect(html).not.toMatch(/>Home</);
      expect(html).toContain("bg-warning-tint");
    }
  });

  it("selected tab sits on the dark fill in both states", () => {
    expect(render("expanded")).toContain("bg-nav-active text-nav-active-text");
    expect(render("rail")).toContain("bg-nav-active text-nav-active-text");
  });

  it("names the current page for the top bar", () => {
    expect(pageTitleFor("/")).toBe("Dashboard");
    expect(pageTitleFor("/budget")).toBe("Budget & spending");
    expect(pageTitleFor("/repairs?view=upkeep")).toBe("Repairs & Upkeep");
    expect(pageTitleFor("/units/abc")).toBe("Unit statement");
    expect(pageTitleFor("/nowhere")).toBeNull();
  });
});
