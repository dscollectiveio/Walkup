import { describe, expect, it } from "vitest";
import { sectionsFor } from "@/lib/insurance/coverage";
import {
  FIELD_DEFS,
  POLICY_EDITABLE_COLUMNS,
  POLICY_EXTRA_COLUMNS,
  fieldsFor,
  policySelect,
  quoteSelect,
} from "@/lib/insurance/fields";

describe("FIELD_DEFS", () => {
  it("has 89 unique keys, and every column is in the policy allowlist mirror", () => {
    const keys = FIELD_DEFS.map((d) => d.key);
    expect(keys).toHaveLength(89);
    expect(new Set(keys).size).toBe(89);
    const allow = new Set(POLICY_EDITABLE_COLUMNS);
    expect(FIELD_DEFS.map((d) => d.column).filter((c) => !allow.has(c))).toEqual([]);
    // ... and the mirror holds nothing else but the extras.
    const expected = new Set([...FIELD_DEFS.map((d) => d.column), ...POLICY_EXTRA_COLUMNS]);
    expect([...allow].sort()).toEqual([...expected].sort());
  });

  it("columns are unique on both sides", () => {
    const cols = FIELD_DEFS.map((d) => d.column);
    expect(new Set(cols).size).toBe(cols.length);
    const quoteCols = FIELD_DEFS.flatMap((d) => (d.quoteColumn ? [d.quoteColumn] : []));
    expect(new Set(quoteCols).size).toBe(quoteCols.length);
  });
});

describe("fieldsFor", () => {
  const groups = (defs: { group: string }[]) => new Set(defs.map((d) => d.group));

  it("property shows property and deductibles, not D&O", () => {
    const g = groups(fieldsFor("property", []));
    expect(g.has("property")).toBe(true);
    expect(g.has("property_deductibles")).toBe(true);
    expect(g.has("do")).toBe(false);
    expect(g.has("basics") && g.has("agent")).toBe(true);
  });

  it("property with D&O included adds the D&O fields", () => {
    expect(fieldsFor("property", ["do"]).some((d) => d.key === "do_limit")).toBe(true);
  });

  it("a D&O policy has no building field (the old bug)", () => {
    const keys = fieldsFor("directors_officers", []).map((d) => d.key);
    expect(keys).not.toContain("building_limit");
    expect(keys).toContain("do_limit");
  });

  it("ignores an included section the coverage can't carry", () => {
    expect(sectionsFor("directors_officers", ["property"])).toEqual(["do"]);
    expect(fieldsFor("directors_officers", ["property"]).some((d) => d.key === "building_limit")).toBe(false);
  });

  it("quote mode drops insured_address and maps to quote columns", () => {
    const defs = fieldsFor("property", [], "quote");
    const by = new Map(defs.map((d) => [d.key, d]));
    expect(by.has("insured_address")).toBe(false);
    expect(by.get("policy_number")?.column).toBe("quote_number");
    expect(by.get("policy_number")?.label).toBe("Quote number");
    expect(by.get("effective_on")?.column).toBe("covers_from");
    expect(by.get("expires_on")?.column).toBe("covers_to");
    expect(by.get("expires_on")?.label).toBe("Ends");
    expect(by.get("effective_on")?.required).toBeUndefined();
    expect(by.get("annual_premium")?.required).toBe("both");
  });
});

describe("selects", () => {
  it("policySelect casts every money and percent column to ::text, and nothing else", () => {
    const parts = policySelect().split(", ");
    for (const d of FIELD_DEFS) {
      const cast = d.kind === "money" || d.kind === "percent";
      expect(parts, d.key).toContain(cast ? `${d.column}::text` : d.column);
      if (cast) expect(parts, d.key).not.toContain(d.column);
    }
    expect(parts).toContain("id");
    expect(parts).toContain("archived_at");
    expect(parts).toContain("replaced_at");
  });

  it("quoteSelect uses quote columns with the same casts", () => {
    const parts = quoteSelect().split(", ");
    expect(parts).toContain("quote_number");
    expect(parts).toContain("covers_to");
    expect(parts).toContain("building_limit::text");
    expect(parts).toContain("wind_hail_deductible_percent::text");
    expect(parts).not.toContain("insured_address");
    expect(parts).not.toContain("effective_from");
  });
});
