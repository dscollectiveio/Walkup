import { describe, expect, it } from "vitest";
import type { PolicyRow } from "@/lib/insurance/fields";
import {
  deductibleHint,
  effectiveSections,
  inForce,
  legacyValuesOutside,
  linesInForce,
  policyStatus,
  renewalFor,
  withStatus,
} from "@/lib/insurance/status";

const TODAY = "2026-10-14";

function policy(over: Partial<PolicyRow> & { id: string }): PolicyRow {
  return {
    coverage: "property",
    carrier_name: "West Bend",
    annual_premium: "3766.00",
    effective_from: "2026-03-01",
    effective_to: "2027-03-01",
    archived_at: null,
    replaced_by_policy_id: null,
    replaced_at: null,
    renewal_reminder_days: 60,
    included_sections: [],
    ...over,
  };
}

describe("policyStatus", () => {
  const p = policy({ id: "p1" });

  it("archived wins over everything", () => {
    expect(policyStatus({ ...p, archived_at: "2026-05-01T00:00:00Z" }, policy({ id: "s", effective_from: "2026-04-01" }), TODAY)).toBe("archived");
  });

  it("a successor that has started → replaced; one not started yet → still active", () => {
    expect(policyStatus({ ...p, replaced_by_policy_id: "s" }, policy({ id: "s", effective_from: "2026-10-01", effective_to: "2027-10-01" }), TODAY)).toBe("replaced");
    expect(policyStatus({ ...p, replaced_by_policy_id: "s" }, policy({ id: "s", effective_from: "2027-03-01", effective_to: "2028-03-01" }), TODAY)).toBe("active");
  });

  it("an archived successor doesn't replace", () => {
    expect(policyStatus(p, policy({ id: "s", effective_from: "2026-10-01", archived_at: "2026-10-02T00:00:00Z" }), TODAY)).toBe("active");
  });

  it("legacy rule 2b: replaced_at with no successor link → replaced", () => {
    expect(policyStatus({ ...p, replaced_at: "2026-06-01T00:00:00Z" }, null, TODAY)).toBe("replaced");
  });

  it("upcoming, expired the day after effective_to, active on effective_to", () => {
    expect(policyStatus(policy({ id: "u", effective_from: "2026-11-01", effective_to: "2027-11-01" }), null, TODAY)).toBe("upcoming");
    expect(policyStatus(policy({ id: "e", effective_from: "2025-10-14", effective_to: "2026-10-13" }), null, TODAY)).toBe("expired");
    expect(policyStatus(policy({ id: "a", effective_from: "2025-10-14", effective_to: "2026-10-14" }), null, TODAY)).toBe("active");
  });
});

describe("withStatus / inForce / renewalFor", () => {
  it("links successors and reports renewed", () => {
    const old = policy({ id: "old", replaced_by_policy_id: "new" });
    const next = policy({ id: "new", effective_from: "2027-03-01", effective_to: "2028-03-01" });
    const ws = withStatus([old, next], TODAY);
    expect(ws[0]).toMatchObject({ status: "active", renewed: true, successor: next });
    expect(ws[1]).toMatchObject({ status: "upcoming", renewed: false });
    expect(inForce([old, next], TODAY).map((x) => x.id)).toEqual(["old"]);
  });

  it("honours each policy's own reminder lead time", () => {
    const p = policy({ id: "p", effective_from: "2025-12-01", effective_to: "2027-01-07", renewal_reminder_days: 90 }); // 85 days out
    expect(renewalFor([p], TODAY)).toMatchObject({ daysToEnd: 85, withinReminder: true });
    expect(renewalFor([{ ...p, renewal_reminder_days: 60 }], TODAY)?.withinReminder).toBe(false);
  });

  it("excludes a renewed policy and picks the soonest", () => {
    const renewed = policy({ id: "r", effective_to: "2026-11-01", replaced_by_policy_id: "n" });
    const next = policy({ id: "n", effective_from: "2026-11-01", effective_to: "2027-11-01" });
    const soon = policy({ id: "s", coverage: "directors_officers", effective_to: "2026-12-01" });
    const later = policy({ id: "l", coverage: "umbrella", effective_to: "2027-02-01" });
    expect(renewalFor([renewed, next, later, soon], TODAY)?.policy.id).toBe("s");
  });
});

describe("sections and legacy values", () => {
  it("a legacy property row holding a D&O limit gets the do section", () => {
    expect(effectiveSections(policy({ id: "p", do_limit: "1000000.00" }))).toEqual(["property", "property_deductibles", "do"]);
  });

  it("a coverage_form default of 'unknown' implies nothing", () => {
    expect(effectiveSections(policy({ id: "d", coverage: "directors_officers", coverage_form: "unknown" }))).toEqual(["do"]);
  });

  it("legacyValuesOutside: a legacy D&O row with a building limit returns that one value", () => {
    const row = policy({ id: "d", coverage: "directors_officers", do_limit: "1000000.00", building_limit: "2400000.00", coverage_form: "unknown", flood_covered: null });
    expect(legacyValuesOutside(row)).toEqual([{ key: "building_limit", label: "Building", value: "$2,400,000" }]);
  });

  it("legacyValuesOutside: a property row returns none", () => {
    expect(legacyValuesOutside(policy({ id: "p", building_limit: "2400000.00", coverage_form: "single_entity" }))).toEqual([]);
  });
});

describe("linesInForce", () => {
  it("a package property with liability fills the liability line", () => {
    const lines = linesInForce([policy({ id: "p", included_sections: ["liability"], building_limit: "2400000.00", liability_per_occurrence: "1000000.00" })]);
    expect(lines.property?.limit).toBe("2400000.00");
    expect(lines.liability).toMatchObject({ limit: "1000000.00", policies: [{ id: "p" }] });
    expect(lines.do).toBeNull();
  });

  it("flood_covered on the master gives flood with no limit (Included)", () => {
    const lines = linesInForce([policy({ id: "p", flood_covered: true })]);
    expect(lines.flood).toMatchObject({ limit: null, policies: [{ id: "p" }] });
    expect(linesInForce([policy({ id: "p", flood_covered: false })]).flood).toBeNull();
  });

  it("the highest limit wins, compared in cents", () => {
    const lines = linesInForce([
      policy({ id: "a", coverage: "umbrella", umbrella_limit: "900000.00" }),
      policy({ id: "b", coverage: "umbrella", umbrella_limit: "1000000.00" }),
      policy({ id: "c", coverage: "umbrella", umbrella_limit: null }),
    ]);
    expect(lines.umbrella?.limit).toBe("1000000.00");
    expect(lines.umbrella?.policies).toHaveLength(3);
  });

  it("generic gives no line", () => {
    const lines = linesInForce([policy({ id: "o", coverage: "other", coverage_limit: "5000.00" })]);
    expect(Object.values(lines).every((l) => l === null)).toBe(true);
  });
});

describe("deductibleHint (Repairs R-5)", () => {
  const master = { id: "m", property_deductible: "10000.00", water_damage_deductible: "25000.00" };
  const ticket = { trade: "plumbing", emergency_kind: null, actual_cost: null, estimated_cost: "30000.00", has_claim: false };

  it("plumbing at $30,000 against a $25,000 water deductible → water hint", () => {
    const h = deductibleHint(ticket, master);
    expect(h).toMatchObject({ kind: "water", deductible: "25000.00", policyId: "m" });
    expect(h?.text).toBe("This repair is above your $25,000 water deductible. Worth asking your agent whether to file a claim.");
  });

  it("plumbing at $20,000 → none", () => {
    expect(deductibleHint({ ...ticket, estimated_cost: "20000.00" }, master)).toBeNull();
  });

  it("fire with property deductible $10,000 and actual $12,000 → property hint", () => {
    expect(deductibleHint({ trade: "general", emergency_kind: "fire", actual_cost: "12000.00", estimated_cost: "5000.00", has_claim: false }, master)?.kind).toBe("property");
  });

  it("water with no water deductible falls back to the property deductible", () => {
    expect(deductibleHint({ ...ticket, trade: null, emergency_kind: "sewage" }, { ...master, water_damage_deductible: null })?.kind).toBe("property");
  });

  it("a ticket with a claim → none; no master → none; other trades → none", () => {
    expect(deductibleHint({ ...ticket, has_claim: true }, master)).toBeNull();
    expect(deductibleHint(ticket, null)).toBeNull();
    expect(deductibleHint({ ...ticket, trade: "electrical" }, master)).toBeNull();
  });
});
