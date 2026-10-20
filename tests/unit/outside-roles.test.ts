import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  APP_ROLES,
  OUTSIDE_PATHS,
  OUTSIDE_ROLES,
  ROLE_HINT,
  ROLE_LABEL,
  TIMED_ACCESS_DAYS,
  TIMED_ROLES,
  daysUntil,
  endDateFor,
  homePathFor,
  isAppRole,
  isOutsideRole,
  isTimedRole,
  knownRoles,
  pathAllowedFor,
  startLinksFor,
  topRole,
  type OutsideRole,
} from "@/lib/access/outside-roles";
import { navFor } from "@/components/sidebar/config";
import { tourStepsFor, tourRoleFrom } from "@/lib/tour/steps";

const APP = path.resolve(import.meta.dirname, "../../src/app");
const routeExists = (href: string) => existsSync(path.join(APP, ...href.split("/").filter(Boolean), "page.tsx"));

const navItems = (role: Parameters<typeof navFor>[0]) => {
  const n = navFor(role);
  return [...n.ungrouped, ...n.groups.flatMap((g) => g.items), ...n.trailing];
};

describe("roles and their order", () => {
  it("lists the seven roles, highest first, with the three outside roles between the accountant and the owner", () => {
    expect([...APP_ROLES]).toEqual(["board_admin", "board_member", "accountant", "property_manager", "attorney", "observer", "owner"]);
    expect([...OUTSIDE_ROLES]).toEqual(["property_manager", "attorney", "observer"]);
    expect([...TIMED_ROLES]).toEqual(["accountant", "property_manager", "attorney", "observer"]);
  });

  it("picks the highest role someone holds and ignores a role it does not know", () => {
    expect(topRole(["owner", "observer"])).toBe("observer");
    expect(topRole(["owner", "attorney", "observer"])).toBe("attorney");
    expect(topRole(["property_manager", "accountant"])).toBe("accountant");
    expect(topRole(["owner", "board_member", "property_manager"])).toBe("board_member");
    expect(topRole(["owner"])).toBe("owner");
    expect(topRole([])).toBeNull();
    expect(topRole(["something_new"])).toBeNull();
    expect(knownRoles(["observer", "nonsense", "board_admin"])).toEqual(["board_admin", "observer"]);
    expect(tourRoleFrom(["owner", "property_manager"])).toBe("property_manager");
    expect(tourRoleFrom(["nonsense"])).toBeNull();
  });

  it("knows which roles are outside and which end by themselves", () => {
    for (const r of OUTSIDE_ROLES) {
      expect(isOutsideRole(r)).toBe(true);
      expect(isTimedRole(r)).toBe(true);
    }
    expect(isTimedRole("accountant")).toBe(true);
    for (const r of ["owner", "board_admin", "board_member", "accountant"]) expect(isOutsideRole(r)).toBe(false);
    for (const r of ["owner", "board_admin", "board_member"]) expect(isTimedRole(r)).toBe(false);
    expect(isOutsideRole(undefined)).toBe(false);
    expect(isAppRole("attorney")).toBe(true);
    expect(isAppRole("landlord")).toBe(false);
  });

  it("names and describes every role with no em dash", () => {
    for (const r of APP_ROLES) {
      expect(ROLE_LABEL[r]).toBeTruthy();
      expect(`${ROLE_LABEL[r]} ${ROLE_HINT[r]}`).not.toContain("—");
    }
    for (const r of OUTSIDE_ROLES) expect(ROLE_HINT[r]).toMatch(/90 days/);
  });
});

describe("access that ends", () => {
  it("is 90 days from the day it is given, for the accountant and the outside roles only", () => {
    expect(TIMED_ACCESS_DAYS).toBe(90);
    expect(endDateFor("observer", "2026-10-20")).toBe("2027-01-18");
    expect(endDateFor("attorney", "2026-01-01")).toBe("2026-04-01");
    expect(endDateFor("property_manager", "2027-12-01")).toBe("2028-02-29");
    expect(endDateFor("accountant", "2026-10-20")).toBe("2027-01-18");
    for (const r of ["owner", "board_admin", "board_member"]) expect(endDateFor(r, "2026-10-20")).toBeNull();
  });

  it("counts whole days to the end, negative once it has passed", () => {
    expect(daysUntil("2026-11-03", "2026-10-20")).toBe(14);
    expect(daysUntil("2026-10-20", "2026-10-20")).toBe(0);
    expect(daysUntil("2026-10-19", "2026-10-20")).toBe(-1);
    expect(daysUntil("2027-03-01", "2027-02-28")).toBe(1);
  });
});

describe("where each role lands", () => {
  it("sends the board and the accountant to the Dashboard and the others to a page that is theirs", () => {
    expect(homePathFor("board_admin")).toBe("/");
    expect(homePathFor("board_member")).toBe("/");
    expect(homePathFor("accountant")).toBe("/");
    expect(homePathFor("property_manager")).toBe("/repairs");
    expect(homePathFor("attorney")).toBe("/documents");
    expect(homePathFor("observer")).toBe("/owner");
    expect(homePathFor("owner")).toBe("/owner");
    expect(homePathFor(null)).toBe("/owner");
  });

  it("points an outside role only at pages they can open", () => {
    for (const role of OUTSIDE_ROLES) {
      for (const l of startLinksFor(role)) {
        expect(pathAllowedFor(role, l.href), `${role}: ${l.href}`).toBe(true);
        expect(routeExists(l.href), `${l.href} has no page`).toBe(true);
      }
      expect(pathAllowedFor(role, homePathFor(role)), `${role} home`).toBe(true);
    }
    expect(startLinksFor("owner")).toEqual([]);
  });
});

describe("navigation for the outside roles", () => {
  const labels = (role: OutsideRole) => navItems(role).map((i) => i.label);

  it("gives a property manager Announcements, Repairs & Upkeep, Building & Owners and Documents", () => {
    expect(labels("property_manager")).toEqual(["Announcements", "Repairs & Upkeep", "Building & Owners", "Documents"]);
  });

  it("gives an attorney Documents and Collections and nothing else", () => {
    expect(labels("attorney")).toEqual(["Documents", "Collections"]);
  });

  it("gives an observer the owner navigation without My unit, plus Finances after Budget", () => {
    const l = labels("observer");
    expect(l).toEqual(["Home", "Announcements", "Repairs", "Budget", "Finances", "Building insurance", "Your building", "Documents", "Your account"]);
    expect(l).not.toContain("Statement");
    expect(l).not.toContain("How to pay");
  });

  it("never lists a money page, the bank, taxes, the board's tools or People & Access", () => {
    const never = [
      "Bank Feed & Transactions",
      "Financial Statements",
      "Budget & Spending",
      "HOA Dues",
      "Taxes",
      "Insurance",
      "Find a Contractor",
      "People & Access",
      "Dashboard",
      "Billing",
    ];
    for (const role of OUTSIDE_ROLES) {
      for (const n of never) expect(labels(role), `${role} lists ${n}`).not.toContain(n);
    }
  });

  it("only links to pages that exist and that the role is allowed to open", () => {
    for (const role of OUTSIDE_ROLES) {
      for (const i of navItems(role)) {
        expect(routeExists(i.href), `${role}: ${i.href} has no page`).toBe(true);
        expect(pathAllowedFor(role, i.href), `${role}: ${i.href} is not on the allow-list`).toBe(true);
      }
    }
  });

  it("has unique links and tour ids inside each role's navigation", () => {
    for (const role of OUTSIDE_ROLES) {
      const items = navItems(role);
      expect(new Set(items.map((i) => i.href)).size, role).toBe(items.length);
      expect(new Set(items.map((i) => i.tourId)).size, role).toBe(items.length);
    }
  });

  it("keeps the allow-list free of the pages that hold the books", () => {
    const books = ["/bank-feed", "/financial-statements", "/dues", "/tax", "/ledger", "/access", "/billing", "/admin", "/delinquency", "/bills", "/upkeep-schedule"];
    for (const role of OUTSIDE_ROLES) {
      for (const b of books) expect(pathAllowedFor(role, b), `${role} may open ${b}`).toBe(false);
      for (const p of OUTSIDE_PATHS[role]) expect(books.some((b) => p === b || p.startsWith(`${b}/`)), `${role}: ${p}`).toBe(false);
    }
    expect(pathAllowedFor("attorney", "/repairs")).toBe(false);
    expect(pathAllowedFor("attorney", "/building")).toBe(false);
    expect(pathAllowedFor("observer", "/building")).toBe(false);
    expect(pathAllowedFor("observer", "/collections")).toBe(false);
    expect(pathAllowedFor("property_manager", "/collections")).toBe(false);
  });

  it("leaves the board and the accountant navigation as it was", () => {
    expect(navItems("board_admin").map((i) => i.label)).toContain("Find a Contractor");
    expect(navItems("accountant").map((i) => i.label)).not.toContain("Building & Owners");
    expect(navItems("owner").map((i) => i.label)).toContain("Statement");
  });
});

describe("the tour for the outside roles", () => {
  it("starts with Welcome and ends with the finish card", () => {
    for (const role of OUTSIDE_ROLES) {
      const ids = tourStepsFor(role).map((s) => s.id);
      expect(ids[0]).toBe("welcome");
      expect(ids.at(-1)).toBe("finish");
    }
  });

  it("points only at items in that role's own navigation (and the account circle)", () => {
    for (const role of OUTSIDE_ROLES) {
      const ids = new Set(navItems(role).map((i) => i.tourId));
      ids.add("account");
      for (const s of tourStepsFor(role)) if (s.target) expect(ids.has(s.target), `${role}: ${s.target}`).toBe(true);
    }
  });

  it("says each role's limits plainly and uses no em dash", () => {
    expect(tourStepsFor("property_manager").find((s) => s.id === "repairs")!.body).toMatch(/Bills and payments stay with the board/);
    expect(tourStepsFor("attorney").find((s) => s.id === "documents")!.body).toMatch(/shared with you/);
    expect(tourStepsFor("observer").find((s) => s.id === "repairs")!.body).toMatch(/can read them but not report/);
    for (const role of OUTSIDE_ROLES) {
      for (const s of tourStepsFor(role)) expect(`${s.title} ${s.body}`).not.toContain("—");
    }
  });
});
