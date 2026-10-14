import { describe, expect, it } from "vitest";
import { NAV_GROUPS, TRAILING_NAV, UNGROUPED_NAV } from "@/components/sidebar/config";
import { tourRoleFrom, tourStepsFor, type TourRole } from "@/lib/tour/steps";

const ROLES: TourRole[] = ["board_admin", "board_member", "accountant", "owner"];
const navTourIds = new Set(
  [...UNGROUPED_NAV, ...NAV_GROUPS.flatMap((g) => g.items), ...TRAILING_NAV].map((i) => i.tourId).filter(Boolean),
);

describe("first-login tour", () => {
  it("gives each role its own stops, welcome first and finish last", () => {
    expect(tourStepsFor("owner").map((s) => s.id)).toEqual(["welcome", "dashboard", "dues", "repairs", "finish"]);
    expect(tourStepsFor("accountant").map((s) => s.id)).toEqual([
      "welcome",
      "financial-statements",
      "budget",
      "taxes",
      "documents",
      "finish",
    ]);
    for (const role of ROLES) {
      const ids = tourStepsFor(role).map((s) => s.id);
      expect(ids[0]).toBe("welcome");
      expect(ids.at(-1)).toBe("finish");
    }
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
  });
});
