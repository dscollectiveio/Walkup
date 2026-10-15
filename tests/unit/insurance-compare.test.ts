import { describe, expect, it } from "vitest";
import { chipText, compareRows, type CompareRow } from "@/lib/insurance/compare";
import { fieldsFor } from "@/lib/insurance/fields";

const defs = fieldsFor("property", [], "policy");
const current = {
  coverage: "property", carrier_name: "West Bend", effective_from: "2026-03-01", effective_to: "2027-03-01",
  annual_premium: "3766.00", building_limit: "2400000.00", water_damage_deductible: "25000.00",
  wind_hail_deductible_percent: "0.0100", ordinance_or_law: true, coverage_form: "single_entity", payment_schedule: "annual",
};
const quote = {
  coverage: "property", carrier_name: "Acuity", covers_from: "2027-03-01", covers_to: "2028-03-01",
  annual_premium: "3310.00", building_limit: "2300000.00", water_damage_deductible: "50000.00",
  wind_hail_deductible_percent: "0.0200", ordinance_or_law: false, coverage_form: "bare_walls", payment_schedule: "annual",
};

function row(sections: ReturnType<typeof compareRows>, key: string): CompareRow | undefined {
  return sections.flatMap((s) => s.rows).find((r) => r.key === key);
}

describe("compareRows", () => {
  const out = compareRows(current, [quote], defs, 3);

  it("premium first, with per unit a month; the change is a percent from cents", () => {
    expect(out[0].section).toBe("Premium");
    expect(out[0].rows.map((r) => r.key)).toEqual(["annual_premium", "per_unit_month"]);
    const p = row(out, "annual_premium")!;
    expect(p.cells[0]).toMatchObject({ display: "$3,766", change: null });
    expect(p.cells[1]).toMatchObject({ display: "$3,310", change: "premium_down", tone: "good", pct: "12" });
    expect(chipText(p.cells[1])).toBe("−12%");
    expect(p.cells[1].ariaLabel).toBe("Annual premium: $3,310, 12% lower than now.");
    expect(row(out, "per_unit_month")!.cells.map((c) => c.display)).toEqual(["$104.61", "$91.94"]);
  });

  it("a lower limit warns", () => {
    expect(row(out, "building_limit")!.cells[1]).toMatchObject({ change: "lower_limit", tone: "warning", ariaLabel: "Building: $2,300,000, lower than now." });
  });

  it("a higher deductible warns; percent deductibles compare by bp4", () => {
    expect(row(out, "water_damage_deductible")!.cells[1]).toMatchObject({ change: "higher_deductible", tone: "warning", ariaLabel: "Water damage: $50,000, higher than now." });
    expect(row(out, "wind_hail_deductible_percent")!.cells[1]).toMatchObject({ change: "higher_deductible", display: "2%" });
  });

  it("yes → no is not included; a different coverage form is different", () => {
    expect(row(out, "ordinance_or_law")!.cells[1]).toMatchObject({ change: "not_included", tone: "warning" });
    expect(row(out, "coverage_form")!.cells[1]).toMatchObject({ change: "different", tone: "warning" });
  });

  it("rows where every column is empty are hidden", () => {
    expect(row(out, "flood_covered")).toBeUndefined();
    expect(row(out, "per_unit_deductible")).toBeUndefined();
  });

  it("a value now that the quote doesn't state reads not stated", () => {
    const q2 = { ...quote, building_limit: null };
    const c = row(compareRows(current, [q2], defs, 3), "building_limit")!.cells[1];
    expect(c).toMatchObject({ display: null, change: "not_stated" });
    expect(c.ariaLabel).toBe("Building: Not stated, not stated.");
  });

  it("every cell with a change has an aria label reading the whole fact", () => {
    for (const s of out) for (const r of s.rows) for (const c of r.cells) {
      if (c.change) expect(c.ariaLabel, r.key).toMatch(new RegExp(`^${r.label.replace(/[()]/g, "\\$&")}: .+, .+\\.$`));
    }
  });

  it("a premium that moved a little is not 'Same' (REVIEW-4 #11): 0.4% shows one decimal, a tiny change shows <0.1", () => {
    const small = compareRows(current, [{ ...quote, annual_premium: "3781.00" }], defs, 3); // 3766 -> 3781 is +0.398%
    const cell = row(small, "annual_premium")!.cells[1];
    expect(cell.change).toBe("premium_up");
    expect(chipText(cell)).toBe("+0.4%");
    expect(cell.ariaLabel).toContain("0.4% higher than now");
    const tiny = row(compareRows(current, [{ ...quote, annual_premium: "3766.01" }], defs, 3), "annual_premium")!.cells[1];
    expect(tiny.change).toBe("premium_up");
    expect(chipText(tiny)).toBe("+<0.1%");
    // whole percents from a half percent up
    expect(chipText(row(compareRows(current, [{ ...quote, annual_premium: "3790.00" }], defs, 3), "annual_premium")!.cells[1])).toBe("+1%");
    expect(chipText(row(compareRows(current, [{ ...quote, annual_premium: "3700.00" }], defs, 3), "annual_premium")!.cells[1])).toBe("−2%");
  });

  it("same premium reads Same; no current policy means no chips", () => {
    const same = compareRows(current, [{ ...quote, annual_premium: "3766.00" }], defs, 3);
    expect(row(same, "annual_premium")!.cells[1].change).toBe("same");
    const none = compareRows(null, [quote], defs, 3);
    expect(none.flatMap((s) => s.rows).flatMap((r) => r.cells).every((c) => c.change === null)).toBe(true);
    expect(row(none, "annual_premium")!.cells[0].display).toBeNull();
  });
});
