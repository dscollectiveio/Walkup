import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OWNER_NAV, STAFF_ANNOUNCEMENTS, STAFF_MY_UNIT, ownerNavItems } from "@/lib/owner/nav";

const APP = path.resolve(import.meta.dirname, "../../src/app");

/** A route exists when its folder has a page.tsx (a trailing dynamic segment is not needed for these links). */
const routeExists = (href: string) => existsSync(path.join(APP, ...href.split("/").filter(Boolean), "page.tsx"));

describe("owner navigation (owner-portal-spec 7.1)", () => {
  const items = ownerNavItems();
  const labels = items.map((i) => i.label);

  it("has the pages an owner uses and none of the board's", () => {
    for (const want of ["Home", "Statement", "How to pay", "Announcements", "Repairs", "Budget", "Building insurance", "Your building", "Documents", "My profile"]) {
      expect(labels).toContain(want);
    }
    for (const never of ["Bank Feed", "Taxes", "HOA Dues", "Building Info", "Ledger", "Delinquency", "Financial Statements", "Contractors"]) {
      expect(labels).not.toContain(never);
    }
  });

  it("Home is the first item and points at /owner", () => {
    expect(items[0]).toMatchObject({ href: "/owner", label: "Home" });
  });

  it("every link goes to a page that exists", () => {
    for (const i of [...items, STAFF_MY_UNIT, STAFF_ANNOUNCEMENTS]) {
      expect(routeExists(i.href), `${i.href} has no page`).toBe(true);
    }
  });

  it("tour ids are unique inside a role's navigation", () => {
    const ids = items.map((i) => i.tourId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("hrefs are unique and the badges are the two the layout can fill", () => {
    const hrefs = items.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(items.filter((i) => i.badgeKey).map((i) => i.badgeKey).sort()).toEqual(["announcements", "repairs"]);
    expect(OWNER_NAV.length).toBe(4);
  });

  it("a staff member who owns a unit gets My unit pointing at /owner", () => {
    expect(STAFF_MY_UNIT).toMatchObject({ href: "/owner", label: "My unit", tourId: "my-unit" });
  });

  it("uses no em dash", () => {
    expect(JSON.stringify([OWNER_NAV, STAFF_MY_UNIT, STAFF_ANNOUNCEMENTS])).not.toContain("—");
  });
});
