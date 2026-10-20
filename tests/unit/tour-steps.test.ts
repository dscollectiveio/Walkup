import { describe, expect, it } from "vitest";
import { MY_UNIT_NAV, NAV_GROUPS, TRAILING_NAV, UNGROUPED_NAV, navFor } from "@/components/sidebar/config";
import { ownerNavItems } from "@/lib/owner/nav";
import { tourRoleFrom, tourStepsFor, type TourRole } from "@/lib/tour/steps";

const ROLES: TourRole[] = ["board_admin", "board_member", "accountant", "owner", "property_manager", "attorney", "observer"];
const navTourIds = new Set(
  [...UNGROUPED_NAV, ...MY_UNIT_NAV, ...NAV_GROUPS.flatMap((g) => g.items), ...TRAILING_NAV, ...ownerNavItems()]
    .map((i) => i.tourId)
    .filter(Boolean),
);
// The three outside roles (0080) have their own navigation.
for (const role of ["property_manager", "attorney", "observer"] as const) {
  const n = navFor(role);
  for (const i of [...n.ungrouped, ...n.groups.flatMap((g) => g.items), ...n.trailing]) navTourIds.add(i.tourId);
}
// Top-bar targets: the profile circle.
navTourIds.add("account");

describe("first-login tour", () => {
  it("gives each role its own stops, welcome first and finish last", () => {
    expect(tourStepsFor("owner").map((s) => s.id)).toEqual([
      "welcome",
      "dashboard",
      "owner-statement",
      "dues",
      "announcements",
      "repairs",
      "insurance",
      "owner-building",
      "account",
      "finish",
    ]);
    expect(tourStepsFor("accountant").map((s) => s.id)).toEqual([
      "welcome",
      "financial-statements",
      "budget",
      "taxes",
      "insurance",
      "documents",
      "account",
      "finish",
    ]);
    const board = tourStepsFor("board_member").map((s) => s.id);
    expect(board.indexOf("insurance")).toBe(board.indexOf("taxes") + 1);
    for (const role of ROLES) {
      const ids = tourStepsFor(role).map((s) => s.id);
      expect(ids[0]).toBe("welcome");
      expect(ids.at(-1)).toBe("finish");
    }
  });

  it("points each role only at items in its own navigation", () => {
    const staffIds = new Set(
      [...UNGROUPED_NAV, ...MY_UNIT_NAV, ...NAV_GROUPS.flatMap((g) => g.items), ...TRAILING_NAV].map((i) => i.tourId),
    );
    // The top bar's profile circle is a tour stop too, for everyone.
    staffIds.add("account");
    const ownerIds = new Set(ownerNavItems().map((i) => i.tourId));
    ownerIds.add("account");
    for (const s of tourStepsFor("owner")) if (s.target) expect(ownerIds.has(s.target), `owner: ${s.target}`).toBe(true);
    for (const role of ["board_admin", "board_member", "accountant"] as const) {
      for (const s of tourStepsFor(role)) if (s.target) expect(staffIds.has(s.target), `${role}: ${s.target}`).toBe(true);
    }
  });

  it("gives the board Announcements right after the dashboard, and ends on the account circle", () => {
    const ids = tourStepsFor("board_admin").map((s) => s.id);
    expect(ids[ids.indexOf("dashboard") + 1]).toBe("announcements");
    expect(ids).not.toContain("my-unit");
    expect(ids[ids.indexOf("finish") - 1]).toBe("account");
    expect(tourStepsFor("accountant").map((s) => s.id)).toContain("account");
  });

  it("describes Collections, statements and the import where the board would look for them", () => {
    const dues = tourStepsFor("board_admin").find((s) => s.id === "dues")!;
    expect(dues.body).toBe("Who owes what, reminders you review and send, and statements for every owner.");
    const building = tourStepsFor("board_admin").find((s) => s.id === "building")!;
    expect(building.body).toMatch(/Import them from a spreadsheet/);
  });

  it("only board admins are sent to the setup checklist at the end", () => {
    expect(tourStepsFor("board_admin").at(-1)?.body).toMatch(/setup checklist/);
    expect(tourStepsFor("board_member").at(-1)?.body).not.toMatch(/setup checklist/);
  });

  it("points only at sidebar items that exist", () => {
    for (const role of ROLES) {
      for (const s of tourStepsFor(role)) {
        if (s.target) expect(navTourIds.has(s.target), `${role}: ${s.target}`).toBe(true);
      }
    }
  });

  it("uses no em dashes", () => {
    for (const role of ROLES) {
      for (const s of tourStepsFor(role)) expect(`${s.title} ${s.body}`).not.toContain("—");
    }
  });

  it("picks the highest role", () => {
    expect(tourRoleFrom(["owner", "board_admin"])).toBe("board_admin");
    expect(tourRoleFrom(["owner", "accountant"])).toBe("accountant");
    expect(tourRoleFrom([])).toBeNull();
    // The outside roles sit between the accountant and the owner.
    expect(tourRoleFrom(["owner", "observer"])).toBe("observer");
    expect(tourRoleFrom(["observer", "attorney", "property_manager"])).toBe("property_manager");
    expect(tourRoleFrom(["property_manager", "accountant"])).toBe("accountant");
  });

  it("gives each role its own insurance stop, naming Illinois law only for Illinois", () => {
    const body = (role: TourRole, stateCode?: string | null) => tourStepsFor(role, { stateCode }).find((s) => s.id === "insurance")!.body;
    expect(body("board_admin")).toContain("against Illinois law and your building's facts");
    expect(body("board_admin", "IL")).toContain("Illinois law");
    expect(body("board_admin", "WI")).toBe(
      "Your policies and what they cover. Walkup checks them against your building's facts, and drafts emails to your agent.",
    );
    expect(body("accountant")).toBe("The association's policies and premiums, read-only.");
    expect(body("owner")).toMatch(/your own condo policy/);
  });

  it("tells owners Walkup doesn't alert the board", () => {
    expect(tourStepsFor("owner").find((s) => s.id === "repairs")!.body).toMatch(/doesn't alert the board/);
  });
});
