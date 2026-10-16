import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/budget" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown } & Record<string, unknown>) =>
    createElement("a", { href, ...rest }, children as never),
}));

import { Sidebar } from "@/components/sidebar/sidebar";
import { NAV_GROUPS, TRAILING_NAV, UNGROUPED_NAV, insuranceNavLabel, isNavItemActive, navFor, pageTitleFor } from "@/components/sidebar/config";

const render = (initialMode: "expanded" | "rail", extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(Sidebar, {
      associationName: "Test HOA",
      uncategorizedCount: 3,
      userEmail: "a@b.co",
      initialMode,
      ...extra,
    }),
  );

// Find a Contractor is board-only, so the role-less renders below do not show it.
const items = [...UNGROUPED_NAV, ...NAV_GROUPS.flatMap((g) => g.items), ...TRAILING_NAV].filter((i) => i.href !== "/repairs/find");

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

  it("names the insurance and repairs sub-pages before their section", () => {
    expect(pageTitleFor("/insurance")).toBe("Insurance Marketplace");
    expect(pageTitleFor("/insurance?view=check")).toBe("Insurance Marketplace");
    expect(pageTitleFor("/insurance/policies/abc")).toBe("Policy");
    expect(pageTitleFor("/insurance/policies/new")).toBe("Policy");
    expect(pageTitleFor("/insurance/import/abc")).toBe("Import insurance");
    expect(pageTitleFor("/insurance/compare")).toBe("Compare quotes");
    expect(pageTitleFor("/insurance/facts")).toBe("Building facts");
    expect(pageTitleFor("/insurance/owner-summary")).toBe("Owner summary");
    expect(pageTitleFor("/insurance/emails/new")).toBe("Email");
    expect(pageTitleFor("/insurance/claims/new")).toBe("Claim");
    expect(pageTitleFor("/insurance/contacts/abc")).toBe("Contact");
    expect(pageTitleFor("/insurance/quotes/abc")).toBe("Quote");
    expect(pageTitleFor("/insurance/sheet")).toBe("Insurance facts sheet");
    expect(pageTitleFor("/repairs/report")).toBe("Report a problem");
    expect(pageTitleFor("/repairs/find?trade=plumbing")).toBe("Find a contractor");
    expect(pageTitleFor("/repairs/emergency-info")).toBe("In an emergency");
    expect(pageTitleFor("/repairs/upkeep/abc")).toBe("Upkeep job");
    expect(pageTitleFor("/maintenance/abc")).toBe("Problem");
    expect(pageTitleFor("/contractors/abc")).toBe("Contractor");
  });

  it("calls it Building insurance for owners, Insurance for the accountant, and the Marketplace for the board", () => {
    expect(insuranceNavLabel("board_admin")).toBe("Insurance Marketplace");
    expect(insuranceNavLabel("board_member")).toBe("Insurance Marketplace");
    expect(insuranceNavLabel("accountant")).toBe("Insurance");
    expect(insuranceNavLabel("owner")).toBe("Building insurance");
    expect(pageTitleFor("/insurance", "owner")).toBe("Building insurance");
    expect(pageTitleFor("/insurance", "accountant")).toBe("Insurance");
    const item = navFor("owner").groups.flatMap((g) => g.items).find((i) => i.href === "/insurance")!;
    expect(item).toMatchObject({ label: "Building insurance", tourId: "insurance" });
    expect(render("expanded", { role: "owner" })).toContain(">Building insurance<");
    expect(render("expanded", { role: "accountant" })).toContain(">Insurance<");
  });

  it("shows Find a Contractor to the board only", () => {
    const labels = (role: Parameters<typeof navFor>[0]) => navFor(role).groups.flatMap((g) => g.items).map((i) => i.label);
    expect(labels("board_admin")).toContain("Find a Contractor");
    expect(labels("board_member")).toContain("Find a Contractor");
    expect(labels("accountant")).not.toContain("Find a Contractor");
  });

  it("keeps Repairs & Upkeep highlighted on problem, contractor and bill pages", () => {
    const repairs = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.href === "/repairs")!;
    for (const path of ["/repairs", "/maintenance/abc", "/contractors/abc", "/bills"]) {
      expect(isNavItemActive(path, repairs), path).toBe(true);
    }
    // Find a Contractor has its own tab, so it lights instead of Repairs & Upkeep.
    const find = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.href === "/repairs/find")!;
    expect(isNavItemActive("/repairs/find", repairs)).toBe(false);
    expect(isNavItemActive("/repairs/find", find)).toBe(true);
    expect(isNavItemActive("/repairs", find)).toBe(false);
    expect(isNavItemActive("/budget", repairs)).toBe(false);
    expect(isNavItemActive("/", { href: "/" })).toBe(true);
    expect(isNavItemActive("/budget", { href: "/" })).toBe(false);
  });

  it("shows the repairs badge in gold, next to the rust bank badge", () => {
    const html = render("expanded", { repairsCount: 4 });
    expect(html).toContain(">4<");
    expect(html).toContain("bg-brass text-on-brass");
    expect(html).toContain("bg-rust text-paper");
  });

  it("gives owner-only people the owner navigation and none of the board's pages", () => {
    const html = render("expanded", { role: "owner" });
    for (const label of ["Home", "Statement", "How to pay", "Announcements", "Repairs", "Budget", "Your building", "Documents", "My profile"]) {
      expect(html, label).toContain(`>${label}<`);
    }
    for (const never of ["Dashboard", "Bank Feed", "Financial Statements", "HOA Dues", "Taxes", "Building Info", "Find a Contractor"]) {
      expect(html, never).not.toContain(never.replace("&", "&amp;"));
    }
    expect(html).toContain('href="/owner"');
    expect(html).toContain('data-tour="owner-statement"');
  });

  it("gives board and accountant Announcements right under the Dashboard, and My unit only when they own a unit", () => {
    const building = navFor("board_admin").groups.find((g) => g.label === "Building")!;
    expect(building.items.map((i) => i.href)).not.toContain("/announcements");
    expect(navFor("board_member", { ownsUnit: false }).ungrouped.map((i) => i.label)).toEqual(["Dashboard", "Announcements"]);
    expect(navFor("board_member", { ownsUnit: true }).ungrouped.map((i) => i.label)).toEqual(["Dashboard", "Announcements", "My unit"]);
    expect(render("expanded", { role: "board_admin", ownsUnit: true })).toContain('data-tour="my-unit"');
    expect(render("expanded", { role: "board_admin" })).not.toContain('data-tour="my-unit"');
  });

  it("shows the announcements count as a badge", () => {
    const html = render("expanded", { role: "owner", announcementsCount: 2 });
    expect(html).toContain(">2<");
    expect(html).toContain("2 waiting");
  });

  it("lights /owner only on /owner itself, and Statement on a unit's statement", () => {
    const home = navFor("owner").ungrouped[0];
    expect(isNavItemActive("/owner", home)).toBe(true);
    expect(isNavItemActive("/owner/pay", home)).toBe(false);
    const statement = navFor("owner").groups.flatMap((g) => g.items).find((i) => i.href === "/owner/statement")!;
    expect(isNavItemActive("/owner/statement/abc", statement)).toBe(true);
  });

  it("names the owner portal, money and import pages in the top bar", () => {
    expect(pageTitleFor("/owner", "owner")).toBe("Home");
    expect(pageTitleFor("/owner", "board_admin")).toBe("My unit");
    expect(pageTitleFor("/owner/statement/abc", "owner")).toBe("Statement");
    expect(pageTitleFor("/owner/pay", "owner")).toBe("How to pay");
    expect(pageTitleFor("/announcements", "owner")).toBe("Announcements");
    expect(pageTitleFor("/announcements/abc")).toBe("Announcement");
    expect(pageTitleFor("/delinquency")).toBe("Collections");
    expect(pageTitleFor("/dues/send/abc")).toBe("Review emails");
    expect(pageTitleFor("/dues/statements")).toBe("Owner statements");
    expect(pageTitleFor("/dues/email")).toBe("Email from Walkup");
    expect(pageTitleFor("/dues")).toBe("HOA Dues");
    expect(pageTitleFor("/building/import")).toBe("Import");
    expect(pageTitleFor("/building/import/new")).toBe("Import");
    expect(pageTitleFor("/building")).toBe("Building Info");
  });
});
