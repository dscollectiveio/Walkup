import { describe, expect, it } from "vitest";
import {
  FIELD_DEFS,
  fromRecord,
  parseBoolean,
  parseDate,
  parseFieldValue,
  parseMoney,
  parseMoneyLoose,
  parsePercent,
  policyWarnings,
  resolveAll,
  resolveField,
} from "@/lib/insurance/declarations";
import { fieldsFor } from "@/lib/insurance/fields";

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

  it("reads short-form money loosely, for review only", () => {
    expect(parseMoneyLoose("$1M")).toBe("1000000.00");
    expect(parseMoneyLoose("$1 million")).toBe("1000000.00");
    expect(parseMoneyLoose("$2.5 million")).toBe("2500000.00");
    expect(parseMoneyLoose("$2.5M")).toBe("2500000.00");
    expect(parseMoneyLoose("$500K")).toBe("500000.00");
    expect(parseMoneyLoose("1,000,000 each occurrence")).toBe("1000000.00");
    expect(parseMoneyLoose("$5,000.50")).toBe("5000.50");
    expect(parseMoneyLoose("1-2M")).toBeNull();
    expect(parseMoneyLoose("1 to 2 million")).toBeNull();
    expect(parseMoneyLoose("1,000,000 / 2,000,000")).toBeNull();
    expect(parseMoneyLoose("included")).toBeNull();
  });

  it("an unknown scale word is not read as the bare number, and nothing above numeric(14,2) is accepted (REVIEW-4 #13)", () => {
    expect(parseMoneyLoose("$1.5 billion")).toBeNull();
    expect(parseMoneyLoose("$2 bn")).toBeNull();
    expect(parseMoneyLoose("$3 hundred")).toBeNull();
    expect(parseMoneyLoose("$5,000 per occurrence")).toBe("5000.00");
    expect(parseMoneyLoose("999,999,999,999.99")).toBe("999999999999.99");
    expect(parseMoneyLoose("1,000,000,000,000")).toBeNull(); // 13 digits
    expect(parseMoney("1,000,000,000,000")).toBeNull();
    expect(parseMoney("1000000000000.00")).toBeNull();
    expect(parseMoney("999,999,999,999.99")).toBe(999_999_999_999.99);
    expect(parseMoneyLoose("$1,000,000 million")).toBeNull(); // over the cap once scaled
  });

  it("reads percentages as fractions", () => {
    expect(parsePercent("2%")).toBe("0.0200");
    expect(parsePercent("2 %")).toBe("0.0200");
    expect(parsePercent("1.5 %")).toBe("0.0150");
    expect(parsePercent("2.5%")).toBe("0.0250");
    expect(parsePercent("0.02")).toBe("0.0200");
    expect(parsePercent("100%")).toBe("1.0000");
    expect(parsePercent("2")).toBeNull();
    expect(parsePercent("120%")).toBeNull();
    expect(parsePercent("2.555%")).toBeNull();
  });

  it("accepts ISO, US and written dates, rejects ambiguous and impossible ones", () => {
    expect(parseDate("2026-03-01")).toBe("2026-03-01");
    expect(parseDate("3/1/2026")).toBe("2026-03-01");
    expect(parseDate("March 1, 2026")).toBe("2026-03-01");
    expect(parseDate("Mar 1, 2026")).toBe("2026-03-01");
    expect(parseDate("Mar. 1, 2026")).toBe("2026-03-01");
    expect(parseDate("1 March 2026")).toBe("2026-03-01");
    expect(parseDate("1 Mar 2026")).toBe("2026-03-01");
    expect(parseDate("3/1/26")).toBeNull();
    expect(parseDate("2/30/2026")).toBeNull();
    expect(parseDate("02/30/2026")).toBeNull();
    expect(parseDate("Febtember 1, 2026")).toBeNull();
  });

  it("reads yes/no words, and 'waived' only for the waiver of subrogation", () => {
    expect(parseBoolean("Included")).toBe(true);
    expect(parseBoolean("Not included")).toBe(false);
    expect(parseBoolean("Applies")).toBe(true);
    expect(parseBoolean("Does not apply")).toBe(false);
    expect(parseBoolean("Excluded")).toBe(false);
    expect(parseBoolean("waived", "waiver_of_subrogation")).toBe(true);
    expect(parseBoolean("waived", "agreed_value")).toBeNull();
    expect(parseBoolean("waived")).toBeNull();
    expect(parseBoolean("maybe")).toBeNull();
  });

  it("dispatches by kind to the DB string form", () => {
    expect(parseFieldValue(def("building_limit"), "$2,400,000")).toBe("2400000.00");
    // numeric(14,2) holds 12 digits before the point
    expect(parseFieldValue(def("building_limit"), "999,999,999,999.99")).toBe("999999999999.99");
    expect(parseFieldValue(def("building_limit"), "1,000,000,000,000.00")).toBeNull();
    expect(parseFieldValue(def("wind_hail_deductible_percent"), "2%")).toBe("0.0200");
    expect(parseFieldValue(def("waiver_of_subrogation"), "Waived")).toBe("true");
    expect(parseFieldValue(def("expires_on"), "March 1, 2027")).toBe("2027-03-01");
    expect(parseFieldValue(def("valuation"), "Replacement_Cost")).toBe("replacement_cost");
    expect(parseFieldValue(def("valuation"), "new for old")).toBeNull();
    expect(parseFieldValue(def("carrier_name"), "  West Bend ")).toBe("West Bend");
  });
});

describe("resolveField", () => {
  it("pre-fills a confident, single, clean value with its page", () => {
    const r = resolveField(def("building_limit"), { name: "building_limit", candidates: [cand("$2,400,000", 2)], confidence: 0.95 });
    expect(r).toMatchObject({ status: "high", value: "2400000.00", page: 2, suggested: null });
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

  it("sends a short-form amount to review with the full figure suggested", () => {
    const r = resolveField(def("umbrella_limit"), { name: "umbrella_limit", candidates: [cand("$5M")], confidence: 0.99 });
    expect(r.status).toBe("review");
    expect(r.value).toBeNull();
    expect(r.reason).toBe("Written in short form. Check the full amount.");
    expect(r.suggested).toBe("5000000.00");
  });

  it("a value that doesn't parse at all goes to review with nothing suggested", () => {
    const r = resolveField(def("umbrella_limit"), { name: "umbrella_limit", candidates: [cand("see schedule")], confidence: 0.99 });
    expect(r).toMatchObject({ status: "review", suggested: null, reason: "This didn't read as a clean value." });
  });

  it("a quote candidate (forceReview) at confidence 1 still goes to review", () => {
    const r = resolveField(def("building_limit"), {
      name: "building_limit",
      candidates: [{ ...cand("$2,400,000"), forceReview: true }],
      confidence: 1,
    });
    expect(r.status).toBe("review");
    expect(r.value).toBeNull();
    expect(r.reason).toBe("From a quote: check it against the document.");
  });

  it("leaves a field blank when nothing was found and never guesses", () => {
    expect(resolveField(def("wind_hail_deductible"), undefined).status).toBe("blank");
    expect(resolveField(def("wind_hail_deductible"), { name: "wind_hail_deductible", candidates: [], confidence: 0.9 }).status).toBe("blank");
  });

  it("resolves every given field, blank by default", () => {
    const all = resolveAll([]);
    expect(all).toHaveLength(FIELD_DEFS.length);
    expect(all.every((f) => f.status === "blank")).toBe(true);
  });

  it("resolveAll takes the coverage's defs, so fields outside it are never shown", () => {
    const defs = fieldsFor("directors_officers", [], "policy");
    const all = resolveAll([{ name: "building_limit", candidates: [cand("$1")], confidence: 1 }], defs);
    expect(all.map((f) => f.key)).not.toContain("building_limit");
    expect(all).toHaveLength(defs.length);
  });
});

describe("fromRecord", () => {
  it("maps quote columns, including covers_to to expires_on", () => {
    const quote = { coverage: "property", carrier_name: "Acuity", quote_number: "Q-1", covers_from: "2027-03-01", covers_to: "2028-03-01", annual_premium: "3310.00", building_limit: "2500000.00", agreed_value: true, insured_address: "ignored" };
    const fromQuoteDefs = fromRecord(quote, fieldsFor("property", [], "quote"), "quote");
    const by = new Map(fromQuoteDefs.map((f) => [f.key, f]));
    expect(by.get("expires_on")).toMatchObject({ status: "high", value: "2028-03-01", source: "quote" });
    expect(by.get("policy_number")?.value).toBe("Q-1");
    expect(by.get("agreed_value")?.value).toBe("true");
    expect(by.get("water_damage_deductible")?.status).toBe("blank");

    // Starting a policy from a quote: policy-mode defs read the quote's columns.
    const forPolicy = new Map(fromRecord(quote, fieldsFor("property", [], "policy"), "quote").map((f) => [f.key, f]));
    expect(forPolicy.get("effective_on")?.value).toBe("2027-03-01");
    expect(forPolicy.get("expires_on")?.value).toBe("2028-03-01");
    expect(forPolicy.get("insured_address")?.status).toBe("blank");
  });

  it("copies last term from a policy row", () => {
    const row = { effective_from: "2026-03-01", effective_to: "2027-03-01", building_limit: "2400000.00" };
    const by = new Map(fromRecord(row, fieldsFor("property", [], "policy"), "previous_policy").map((f) => [f.key, f]));
    expect(by.get("expires_on")).toMatchObject({ value: "2027-03-01", source: "previous_policy" });
    expect(by.get("building_limit")?.value).toBe("2400000.00");
  });
});

describe("policyWarnings (legacy review screen)", () => {
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
    const warnings = policyWarnings({
      values: { ...base, named_insured: "Damen Owners LLC", expires_on: "2026-10-20", coverage_form: "unknown", water_damage_deductible: null },
      legalName: "2158 N. Damen Condominium Association",
      renewalReminderDays: 60,
      today,
      deductiblesPage: 3,
    });
    expect(warnings.map((w) => w.key)).toEqual(["named_insured", "expires_on", "coverage_form", "water_damage_deductible"]);
    expect(warnings.find((w) => w.key === "water_damage_deductible")!.text).not.toMatch(/Chicago/);
  });
});
