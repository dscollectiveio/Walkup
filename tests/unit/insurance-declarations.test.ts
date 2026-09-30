import { describe, expect, it } from "vitest";
import {
  FIELD_DEFS,
  parseDate,
  parseMoney,
  policyWarnings,
  resolveAll,
  resolveField,
} from "@/lib/insurance/declarations";

const def = (key: string) => FIELD_DEFS.find((f) => f.key === key)!;
const cand = (value: string, page = 1) => ({ value, page, snippet: `...${value}...` });

describe("parsing", () => {
  it("accepts only clean dollar amounts", () => {
    expect(parseMoney("$2,400,000")).toBe(2_400_000);
    expect(parseMoney("5,000.00")).toBe(5000);
    expect(parseMoney("25000")).toBe(25000);
    expect(parseMoney("$1M")).toBeNull();
    expect(parseMoney("$5k")).toBeNull();
    expect(parseMoney("1,000,000 / 2,000,000")).toBeNull();
    expect(parseMoney("2,40,000")).toBeNull();
  });

  it("accepts ISO and US dates, rejects impossible ones", () => {
    expect(parseDate("2026-03-01")).toBe("2026-03-01");
    expect(parseDate("3/1/2026")).toBe("2026-03-01");
    expect(parseDate("02/30/2026")).toBeNull();
    expect(parseDate("March 1, 2026")).toBeNull();
  });
});

describe("resolveField", () => {
  it("pre-fills a confident, single, clean value with its page", () => {
    const r = resolveField(def("building_limit"), { name: "building_limit", candidates: [cand("$2,400,000", 2)], confidence: 0.95 });
    expect(r).toMatchObject({ status: "high", value: "2400000.00", page: 2 });
  });

  it("sends a low-confidence value to review instead of filling it", () => {
    const r = resolveField(def("property_deductible"), { name: "property_deductible", candidates: [cand("5,000")], confidence: 0.6 });
    expect(r.status).toBe("review");
    expect(r.value).toBeNull();
    expect(r.candidates).toHaveLength(1);
  });

  it("never picks between two amounts near one label", () => {
    const r = resolveField(def("liability_per_occurrence"), {
      name: "liability_per_occurrence",
      candidates: [cand("1,000,000"), cand("2,000,000")],
      confidence: 0.99,
    });
    expect(r.status).toBe("review");
    expect(r.reason).toMatch(/More than one figure/);
  });

  it("sends an amount that doesn't parse cleanly to review, even when confident", () => {
    const r = resolveField(def("umbrella_limit"), { name: "umbrella_limit", candidates: [cand("$5M")], confidence: 0.99 });
    expect(r.status).toBe("review");
  });

  it("leaves a field blank when nothing was found — never guesses", () => {
    expect(resolveField(def("wind_hail_deductible"), undefined).status).toBe("blank");
    expect(resolveField(def("wind_hail_deductible"), { name: "wind_hail_deductible", candidates: [], confidence: 0.9 }).status).toBe("blank");
  });

  it("resolves every defined field, blank by default", () => {
    const all = resolveAll([]);
    expect(all).toHaveLength(FIELD_DEFS.length);
    expect(all.every((f) => f.status === "blank")).toBe(true);
  });
});

describe("policyWarnings", () => {
  const today = new Date("2026-09-30T00:00:00");
  const base = {
    policy_type: "property",
    named_insured: "2158 N. Damen Condominium Association",
    expires_on: "2027-06-01",
    coverage_form: "single_entity",
    water_damage_deductible: "25000.00",
  };

  it("says nothing when the data gives no reason to", () => {
    expect(
      policyWarnings({ values: base, legalName: "2158 N Damen Condominium Association", renewalReminderDays: 60, today, deductiblesPage: 3 }),
    ).toEqual([]);
  });

  it("flags a named insured that doesn't match, a close renewal, an unknown form, and a missing water deductible", () => {
    const keys = policyWarnings({
      values: { ...base, named_insured: "Damen Owners LLC", expires_on: "2026-10-20", coverage_form: "unknown", water_damage_deductible: null },
      legalName: "2158 N. Damen Condominium Association",
      renewalReminderDays: 60,
      today,
      deductiblesPage: 3,
    }).map((w) => w.key);
    expect(keys).toEqual(["named_insured", "expires_on", "coverage_form", "water_damage_deductible"]);
  });
});
