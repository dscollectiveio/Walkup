import { describe, expect, it } from "vitest";
import { RULES, runCoverageCheck, type CheckInput, type CheckPolicy, type Finding } from "@/lib/insurance/coverage-check";
import { emptyFacts, type BuildingFacts } from "@/lib/insurance/facts";
import { FIELD_DEFS } from "@/lib/insurance/fields";
import type { CitationKey } from "@/lib/insurance/statute";

const TODAY = "2026-10-14";
const LEGAL = "2158 N. Damen Condominium Association";

function pol(over: Partial<CheckPolicy> & { id: string }): CheckPolicy {
  return {
    coverage: "property", carrier_name: "West Bend", annual_premium: "3766.00",
    effective_from: "2026-03-01", effective_to: "2027-03-01", archived_at: null, replaced_by_policy_id: null,
    replaced_at: null, renewal_reminder_days: 60, included_sections: [], status: "active", renewed: false,
    ...over,
  };
}

/** A master package policy on which no rule fires. */
const MASTER: Partial<CheckPolicy> = {
  id: "master",
  included_sections: ["liability", "do", "crime", "umbrella", "equipment"],
  named_insured: LEGAL,
  building_limit: "2400000.00", valuation: "replacement_cost", cause_of_loss_form: "special", coverage_form: "single_entity",
  ordinance_or_law: true, ordinance_law_bc_limit: "250000.00", waiver_of_subrogation: true,
  property_deductible: "5000.00", water_damage_deductible: "25000.00", water_backup_limit: "25000.00",
  liability_per_occurrence: "1000000.00", unit_owners_additional_insureds: true,
  do_limit: "1000000.00", do_claims_made: true, do_covers_non_monetary: true, do_covers_breach_of_contract: true,
  do_covers_insurance_decisions: true, do_includes_managing_agent: true, do_includes_past_future_board: true,
  crime_limit: "200000.00", crime_includes_manager: true, crime_social_engineering_limit: "50000.00",
  umbrella_limit: "1000000.00", equipment_breakdown_limit: "1000000.00",
};

/** The master without some of its package sections, and without their values (which would imply them). */
function drop(...sections: string[]): Partial<CheckPolicy> {
  const out: Partial<CheckPolicy> = { included_sections: (MASTER.included_sections as string[]).filter((s) => !sections.includes(s)) };
  for (const d of FIELD_DEFS) if (sections.includes(d.group)) out[d.column] = null;
  return out;
}

const FACTS: BuildingFacts = {
  ...emptyFacts("damen"),
  replacement_cost_estimate: "2400000.00", replacement_cost_as_of: "2025-01-01", replacement_cost_source: "appraisal",
  flood_zone: "X", has_below_grade_units: false, has_basement: false, has_boiler: true, has_elevator: false,
  has_sprinklers: false, has_employees: false, uses_volunteers: false, has_commercial_space: false,
  manager_handles_funds: true, management_company: "Acme Management", declaration_coverage_form: "single_entity",
};

function input(over: Partial<CheckInput> = {}, master: Partial<CheckPolicy> = {}, facts: Partial<BuildingFacts> = {}): CheckInput {
  return {
    todayIso: TODAY, stateCode: "IL", unitCount: 6,
    facts: { ...FACTS, ...facts },
    policies: [pol({ ...MASTER, ...master } as CheckPolicy)],
    fundsTotal: "150000.00", history: [], legalName: LEGAL, quotesThisTerm: {}, dismissals: [],
    ...over,
  };
}

const run = (i: CheckInput) => runCoverageCheck(i);
const ids = (i: CheckInput) => run(i).findings.map((f) => f.ruleId);
const one = (i: CheckInput, ruleId: string): Finding => {
  const f = run(i).findings.filter((x) => x.ruleId === ruleId);
  expect(f, `${ruleId} should fire once`).toHaveLength(1);
  return f[0];
};

/** One scenario per rule in which it fires, with the citation key its findings must carry. */
const SCENARIOS: Record<string, { citation: CitationKey | null; make: () => CheckInput }> = {
  "IL-PROP-01": { citation: "ICPA_12_A1_PROPERTY", make: () => input({ policies: [pol({ id: "gl", coverage: "general_liability", liability_per_occurrence: "1000000.00", unit_owners_additional_insureds: true })] }) },
  "IL-PROP-02": { citation: "ICPA_12_A1_SPECIAL", make: () => input({}, { cause_of_loss_form: "basic" }) },
  "IL-PROP-03": { citation: "ICPA_12_A1_RC", make: () => input({}, {}, { replacement_cost_estimate: "2600000.00" }) },
  "IL-PROP-04": { citation: "ICPA_12_A1_BC", make: () => input({}, { ordinance_or_law: false }) },
  "IL-GL-01": { citation: "ICPA_12_A2_GL", make: () => input({}, { liability_per_occurrence: "500000.00" }) },
  "IL-GL-02": { citation: "ICPA_12_A2_OWNERS", make: () => input({}, { unit_owners_additional_insureds: null }) },
  "IL-FID-01": { citation: "ICPA_12_A3A_FIDELITY", make: () => input({}, drop("crime")) },
  "IL-FID-02": { citation: "ICPA_12_A3C_AMOUNT", make: () => input({}, { crime_limit: "100000.00" }) },
  "IL-FID-03": { citation: "ICPA_12_A3B_MANAGER", make: () => input({}, { crime_includes_manager: null }) },
  "IL-DO-01": { citation: "ICPA_12_A3D_DO", make: () => input({}, drop("do")) },
  "IL-DO-02": { citation: "ICPA_12_A3D_SCOPE", make: () => input({}, { do_covers_non_monetary: null }) },
  "IL-DO-03": { citation: "ICPA_12_A3D_INSUREDS", make: () => input({}, { do_includes_managing_agent: false }) },
  "IL-FORM-01": { citation: "ICPA_12_B_FIXTURES", make: () => input({}, { coverage_form: "bare_walls" }, { declaration_coverage_form: "bare_walls" }) },
  "IL-SUB-01": { citation: "ICPA_12_E_SUBROGATION", make: () => input({}, { waiver_of_subrogation: false }) },
  "CICAA-FID-01": { citation: "CICAA_1_55_FIDELITY", make: () => input({ unitCount: 30 }, drop("crime"), { is_condominium: false }) },
  "DOC-FORM-01": { citation: null, make: () => input({}, {}, { declaration_coverage_form: "all_in", declaration_insurance_section: "Article VIII" }) },
  "DOC-REQ-01": { citation: "ICPA_12_D_OTHER", make: () => input({}, {}, { declaration_required_lines: ["flood"] }) },
  "YD-EXP-01": { citation: null, make: () => input({ policies: [pol(MASTER as CheckPolicy), pol({ id: "cy", coverage: "cyber", effective_from: "2025-01-01", effective_to: "2026-01-01", status: "expired" })] }) },
  "YD-REN-01": { citation: null, make: () => input({}, { effective_from: "2025-11-30", effective_to: "2026-11-30" }) },
  "YD-PREM-01": { citation: null, make: () => input({ history: [{ coverage: "property", policyId: "master", changePercent: "12.5", previousPremium: "3348.00", annualPremium: "3766.00", quotesObtained: 0 }] }) },
  "YD-NI-01": { citation: null, make: () => input({}, { named_insured: "Damen Owners LLC" }) },
  "YD-COINS-01": { citation: null, make: () => input({}, { coinsurance_percent: "0.9000", agreed_value: false }, { replacement_cost_estimate: "3000000.00" }) },
  "YD-DED-01": { citation: null, make: () => input({}, { property_deductible: "200000.00" }) },
  "YD-WH-01": { citation: "ICPA_12_C_DEDUCTIBLE", make: () => input({}, { wind_hail_deductible_percent: "0.0200" }) },
  "CP-DED-01": { citation: null, make: () => input({}, { water_damage_deductible: null }) },
  "CP-VAL-01": { citation: null, make: () => input({}, {}, { replacement_cost_as_of: "2023-01-01" }) },
  "CP-WB-01": { citation: null, make: () => input({}, { water_backup_limit: null }, { has_basement: true }) },
  "CP-FL-01": { citation: null, make: () => input({}, {}, { flood_zone: "AE" }) },
  "CP-EB-01": { citation: "ICPA_12_D_OTHER", make: () => input({}, drop("equipment")) },
  "CP-WC-01": { citation: null, make: () => input({ policies: [pol(MASTER as CheckPolicy), pol({ id: "epl", coverage: "employment_practices", epli_limit: "500000.00" })] }, {}, { has_employees: true, employee_count: 2 }) },
  "CP-WC-02": { citation: null, make: () => input({}, {}, { uses_volunteers: true }) },
  "CP-EPLI-01": { citation: "ICPA_12_D_OTHER", make: () => input({ policies: [pol(MASTER as CheckPolicy), pol({ id: "wc", coverage: "workers_comp", wc_el_each_accident: "500000.00" })] }, {}, { has_employees: true }) },
  "CP-UMB-01": { citation: null, make: () => input({}, drop("umbrella")) },
  "CP-CRIME-01": { citation: null, make: () => input({}, { crime_social_engineering_limit: null }) },
  "CP-DO-01": { citation: null, make: () => input({ quotes: [{ coverage: "directors_officers", carrierName: "Travelers", declined: false }] }) },
  "CP-COMM-01": { citation: null, make: () => input({}, {}, { has_commercial_space: true }) },
};

describe("the clean building", () => {
  it("no rule fires and no fact is missing", () => {
    const r = run(input());
    expect(r.findings.map((f) => f.id)).toEqual([]);
    expect(r.missingFacts).toEqual([]);
    expect(r.legalChecks).toBe("illinois");
  });
});

describe("every rule", () => {
  it("there are 36 rules and a scenario for each", () => {
    expect(RULES).toHaveLength(36);
    expect(Object.keys(SCENARIOS).sort()).toEqual(RULES.map((r) => r.id).sort());
    const count = (prefix: string) => RULES.filter((r) => r.id.startsWith(prefix)).length;
    expect([count("IL-"), count("CICAA-"), count("DOC-"), count("YD-"), count("CP-")]).toEqual([14, 1, 2, 7, 12]);
  });

  for (const rule of RULES) {
    it(`${rule.id} fires in its scenario and not on the clean building`, () => {
      const s = SCENARIOS[rule.id];
      const fired = run(s.make()).findings.filter((f) => f.ruleId === rule.id);
      expect(fired.length, rule.id).toBeGreaterThan(0);
      expect(ids(input())).not.toContain(rule.id);
    });
  }

  it("citations: every finding carries exactly its rule's key; every statute rule has one", () => {
    for (const rule of RULES) {
      const s = SCENARIOS[rule.id];
      expect(rule.citation, rule.id).toBe(s.citation);
      if (rule.basis === "statute") expect(rule.citation, rule.id).not.toBeNull();
      for (const f of run(s.make()).findings.filter((x) => x.ruleId === rule.id)) {
        expect(f.citation?.key ?? null, rule.id).toBe(s.citation);
        if (f.basis === "statute") expect(f.citation?.verifiedOn, rule.id).toBe("2026-10-14");
      }
    }
  });

  it("copy: no em dash, no advice words, none of the removed claims", () => {
    const banned = [/—/, /\bbest\b/i, /should buy/i, /recommend/i, /usually price/i, /you won't compare/i, /two to four weeks/i, /at least a month/i];
    for (const rule of RULES) {
      for (const f of run(SCENARIOS[rule.id].make()).findings) {
        for (const text of [f.title, f.detail, f.question ?? ""]) {
          for (const re of banned) expect(text, `${f.ruleId}: ${text}`).not.toMatch(re);
        }
      }
    }
  });
});

describe("statute rules", () => {
  it("IL-PROP-01 is not on file, worded on the verified 12(a)(1)(i) quote", () => {
    const f = one(SCENARIOS["IL-PROP-01"].make(), "IL-PROP-01");
    expect(f).toMatchObject({ severity: "gap", notOnFile: true, answerableFields: [] });
    expect(f.detail).toBe("If you have one, add it. The Act requires property insurance covering the common elements and the units.");
  });

  it("IL-PROP-02: basic → gap, unknown → ask, special → none", () => {
    expect(one(input({}, { cause_of_loss_form: "basic" }), "IL-PROP-02")).toMatchObject({ severity: "gap", title: "The master policy is on a basic form, not special form." });
    expect(one(input({}, { cause_of_loss_form: "unknown" }), "IL-PROP-02").severity).toBe("ask");
    expect(one(input({}, { cause_of_loss_form: "unknown" }), "IL-PROP-02").answerableFields).toEqual(["cause_of_loss_form"]);
  });

  it("IL-PROP-03: limit below the estimate, ACV, unknown estimate", () => {
    const f = one(input({}, {}, { replacement_cost_estimate: "2600000.00" }), "IL-PROP-03");
    expect(f.severity).toBe("gap");
    expect(f.title).toContain("$200,000");
    expect(f.detail).toBe("Your policy covers $2,400,000. Your estimate (appraisal, January 1, 2025) is $2,600,000.");
    expect(f.answerableFields).toEqual(["building_limit", "valuation"]);
    expect(one(input({}, { valuation: "actual_cash_value" }), "IL-PROP-03").title).toBe("The building is insured at actual cash value.");
    const r = run(input({}, {}, { replacement_cost_estimate: null }));
    expect(r.findings.map((x) => x.ruleId)).not.toContain("IL-PROP-03");
    expect(r.missingFacts).toContain("replacement_cost_estimate");
  });

  it("IL-PROP-04: 10% capped at $500,000", () => {
    expect(ids(input({}, { ordinance_law_bc_limit: "250000.00" }))).not.toContain("IL-PROP-04");
    const short = one(input({}, { ordinance_law_bc_limit: null, ordinance_law_b_limit: "100000.00", ordinance_law_c_limit: "100000.00" }), "IL-PROP-04");
    expect(short.severity).toBe("gap");
    expect(short.detail).toContain("at least $240,000");
    expect(short.detail).toContain("Walkup sees $200,000");
    const big = one(input({}, { building_limit: "8000000.00", ordinance_law_bc_limit: "400000.00" }, { replacement_cost_estimate: "8000000.00" }), "IL-PROP-04");
    expect(big.detail).toContain("at least $500,000");
    expect(one(input({}, { ordinance_or_law: false }), "IL-PROP-04").severity).toBe("gap");
    expect(one(input({}, { ordinance_law_bc_limit: null }), "IL-PROP-04").severity).toBe("ask");
  });

  it("IL-GL-01: none → gap not on file; null limit → ask with the question; $500,000 in the package → gap", () => {
    const none = one(input({}, drop("liability")), "IL-GL-01");
    expect(none).toMatchObject({ severity: "gap", notOnFile: true, policyId: null });
    const unknown = one(input({}, { liability_per_occurrence: null }), "IL-GL-01");
    expect(unknown).toMatchObject({
      severity: "ask", answerableFields: ["liability_per_occurrence"],
      question: "Can you confirm our general liability limit per occurrence? The Act requires at least $1,000,000.",
    });
    const low = one(input({}, { liability_per_occurrence: "500000.00" }), "IL-GL-01");
    expect(low).toMatchObject({ severity: "gap", notOnFile: false, policyId: "master", title: "General liability is $500,000 per occurrence, below $1,000,000." });
  });

  it("IL-GL-02: false → gap, null → ask, never not-on-file", () => {
    expect(one(input({}, { unit_owners_additional_insureds: false }), "IL-GL-02")).toMatchObject({ severity: "gap", notOnFile: false });
    expect(one(input({}, { unit_owners_additional_insureds: null }), "IL-GL-02").severity).toBe("ask");
  });

  it("IL-FID-01/02: thresholds and the funds comparison", () => {
    const noCrime = drop("crime");
    expect(ids(input({ unitCount: 5 }, noCrime))).not.toContain("IL-FID-01");
    const gap = one(input({}, noCrime), "IL-FID-01");
    expect(gap).toMatchObject({ severity: "gap", notOnFile: true });
    expect(gap.detail).toContain("You have 6 units on record.");
    expect(gap.question).toContain("for at least $150,000");
    const f2 = one(input({}, { crime_limit: "100000.00" }), "IL-FID-02");
    expect(f2.title).toBe("The fidelity bond is $50,000 below the money the association holds.");
    expect(ids(input({ fundsTotal: null }, { crime_limit: "100000.00" }))).not.toContain("IL-FID-02");
  });

  it("IL-FID-03: manager unknown → missing fact; manager doesn't handle money → none", () => {
    const r = run(input({}, {}, { manager_handles_funds: null }));
    expect(r.missingFacts).toContain("manager_handles_funds");
    expect(ids(input({}, { crime_includes_manager: null }, { manager_handles_funds: false }))).not.toContain("IL-FID-03");
    expect(one(input({}, { crime_includes_manager: false }), "IL-FID-03")).toMatchObject({ severity: "gap", answerableFields: ["crime_includes_manager"] });
    expect(one(input({}, { crime_includes_manager: null }), "IL-FID-03").question).toContain("Acme Management");
  });

  it("IL-DO-01 not on file; IL-DO-02 offers the three D&O booleans and lists the unknowns; IL-DO-03", () => {
    expect(one(SCENARIOS["IL-DO-01"].make(), "IL-DO-01")).toMatchObject({ severity: "gap", notOnFile: true });
    const ask = one(input({}, { do_covers_non_monetary: null, do_covers_insurance_decisions: null }), "IL-DO-02");
    expect(ask.severity).toBe("ask");
    expect(ask.answerableFields).toEqual(["do_covers_non_monetary", "do_covers_breach_of_contract", "do_covers_insurance_decisions"]);
    expect(ask.detail).toContain("Walkup couldn't confirm: non-money claims and decisions about insurance.");
    expect(one(input({}, { do_covers_breach_of_contract: false }), "IL-DO-02").severity).toBe("gap");
    expect(one(input({}, { do_includes_past_future_board: null }), "IL-DO-03").severity).toBe("ask");
  });

  it("IL-FORM-01 and IL-SUB-01", () => {
    expect(one(SCENARIOS["IL-FORM-01"].make(), "IL-FORM-01")).toMatchObject({ severity: "ask", answerableFields: ["coverage_form"] });
    expect(one(input({}, { waiver_of_subrogation: false }), "IL-SUB-01").severity).toBe("gap");
    expect(one(input({}, { waiver_of_subrogation: null }), "IL-SUB-01").severity).toBe("info");
  });

  it("CICAA-FID-01 needs 30 units", () => {
    expect(one(SCENARIOS["CICAA-FID-01"].make(), "CICAA-FID-01").severity).toBe("ask");
    expect(ids(input({ unitCount: 29 }, drop("crime"), { is_condominium: false }))).not.toContain("CICAA-FID-01");
  });
});

describe("document, data and common-practice rules", () => {
  it("DOC-FORM-01 names both forms and the article", () => {
    const f = one(SCENARIOS["DOC-FORM-01"].make(), "DOC-FORM-01");
    expect(f.title).toBe("Your declaration says all-in; the master policy says single entity.");
    expect(f.detail).toContain("(Article VIII)");
    expect(ids(input({}, {}, { declaration_coverage_form: "unknown" }))).not.toContain("DOC-FORM-01");
  });

  it("DOC-REQ-01: one not-on-file finding per missing required line", () => {
    const r = run(input({}, {}, { declaration_required_lines: ["flood", "umbrella", "earthquake"] }));
    const f = r.findings.filter((x) => x.ruleId === "DOC-REQ-01");
    expect(f.map((x) => x.line).sort()).toEqual(["earthquake", "flood"]);
    expect(f.every((x) => x.notOnFile && x.severity === "gap")).toBe(true);
    expect(new Set(f.map((x) => x.id)).size).toBe(2);
  });

  it("IL-FID-01 stays quiet when the unit count is not a number (REVIEW-4 #15)", () => {
    const noCrime = drop("crime");
    expect(ids(input({ unitCount: Number.NaN }, noCrime))).not.toContain("IL-FID-01");
    expect(ids(input({ unitCount: 8 }, noCrime))).toContain("IL-FID-01");
  });

  it("dismissing one DOC-REQ-01 finding leaves the others open (REVIEW-4 #4)", () => {
    const facts = { declaration_required_lines: ["flood", "earthquake"] };
    const flood = "DOC-REQ-01:flood";
    const r = run({ ...input({}, {}, facts), dismissals: [{ ruleId: "DOC-REQ-01", policyId: null, findingKey: flood, reason: "Not needed" }] });
    const byId = new Map(r.findings.filter((x) => x.ruleId === "DOC-REQ-01").map((x) => [x.id, x]));
    expect(byId.get(flood)!.dismissed).toEqual({ reason: "Not needed" });
    expect(byId.get("DOC-REQ-01:earthquake")!.dismissed).toBeNull();
    // the open one still counts, the dismissed one does not
    const none = run({ ...input({}, {}, facts), dismissals: [] });
    expect(r.notOnFileCount).toBe(none.notOnFileCount - 1);
    // a row without a key (hand-written) covers every finding of the rule for that policy
    const all = run({ ...input({}, {}, facts), dismissals: [{ ruleId: "DOC-REQ-01", policyId: null, reason: "x" }] });
    expect(all.findings.filter((x) => x.ruleId === "DOC-REQ-01").every((x) => x.dismissed)).toBe(true);
  });

  it("YD-EXP-01: an ended policy with nothing newer; not when another of that coverage is in force", () => {
    expect(one(SCENARIOS["YD-EXP-01"].make(), "YD-EXP-01").title).toBe("Your cyber policy ended on January 1, 2026.");
    const covered = input({ policies: [pol(MASTER as CheckPolicy), pol({ id: "cy", coverage: "cyber", effective_from: "2025-01-01", effective_to: "2026-01-01", status: "expired" }), pol({ id: "cy2", coverage: "cyber", effective_from: "2026-01-01", effective_to: "2027-01-01" })] });
    expect(ids(covered)).not.toContain("YD-EXP-01");
  });

  it("YD-REN-01: in the reminder window with no quotes; none once a quote is recorded; offers no answer fields", () => {
    const f = one(SCENARIOS["YD-REN-01"].make(), "YD-REN-01");
    expect(f).toMatchObject({ severity: "ask", question: null, answerableFields: [] });
    expect(f.title).toBe("Master policy renews November 30, 2026. No other quotes are recorded yet.");
    expect(ids(input({ quotesThisTerm: { property: 1 } }, { effective_from: "2025-11-30", effective_to: "2026-11-30" }))).not.toContain("YD-REN-01");
  });

  it("YD-PREM-01: 10% or more with no quotes", () => {
    const f = one(SCENARIOS["YD-PREM-01"].make(), "YD-PREM-01");
    expect(f.title).toBe("Your master premium went up 12.5% at the last renewal, with no other quotes on file.");
    expect(f.detail).toBe("From $3,348 to $3,766.");
    const h = { coverage: "property", policyId: "master", changePercent: "9.9", previousPremium: "1000.00", annualPremium: "1099.00", quotesObtained: 0 };
    expect(ids(input({ history: [h] }))).not.toContain("YD-PREM-01");
    expect(ids(input({ history: [{ ...h, changePercent: "20.0", quotesObtained: 1 }] }))).not.toContain("YD-PREM-01");
  });

  it("YD-NI-01 ignores punctuation and case", () => {
    expect(one(SCENARIOS["YD-NI-01"].make(), "YD-NI-01").detail).toBe(`Policy: "Damen Owners LLC". Walkup: "${LEGAL}".`);
    expect(ids(input({}, { named_insured: "2158 n damen condominium association" }))).not.toContain("YD-NI-01");
  });

  it("YD-COINS-01: below coinsurance × estimate unless agreed value", () => {
    expect(one(SCENARIOS["YD-COINS-01"].make(), "YD-COINS-01").answerableFields).toEqual(["agreed_value", "coinsurance_percent"]);
    expect(ids(input({}, { coinsurance_percent: "0.9000", agreed_value: true }, { replacement_cost_estimate: "3000000.00" }))).not.toContain("YD-COINS-01");
    expect(ids(input({}, { coinsurance_percent: "0.8000" }, { replacement_cost_estimate: "3000000.00" }))).not.toContain("YD-COINS-01");
  });

  it("YD-COINS-01 and YD-WH-01 at the numeric(14,2) ceiling compute without precision loss", () => {
    const big = { building_limit: "999999999999.98", coinsurance_percent: "1.0000", wind_hail_deductible_percent: "0.0200" };
    const r = run(input({ fundsTotal: null }, big, { replacement_cost_estimate: "999999999999.99" }));
    expect(r.findings.map((f) => f.ruleId)).toContain("YD-COINS-01");
    const wh = r.findings.find((f) => f.ruleId === "YD-WH-01")!;
    // 2% of 99,999,999,999,998 cents = 1,999,999,999,999.96 cents → $20,000,000,000.00 rounded to the cent.
    expect(wh.title).toBe("Your wind or hail deductible is 2% of the building value, about $20,000,000,000.");
  });

  it("YD-DED-01 asks without naming a target", () => {
    const f = one(SCENARIOS["YD-DED-01"].make(), "YD-DED-01");
    expect(f.detail).toBe("Deductible $200,000; all funds $150,000.");
    expect(f.question).not.toMatch(/lower our deductible to/i);
    // The wind/hail percent's dollar equivalent counts when it is larger.
    expect(ids(input({}, { wind_hail_deductible_percent: "0.1000" }))).toContain("YD-DED-01");
  });

  it("YD-WH-01 states the dollars", () => {
    const f = one(input({}, { wind_hail_deductible_percent: "0.0200", wind_hail_deductible: "10000.00" }), "YD-WH-01");
    expect(f.title).toBe("Your wind or hail deductible is 2% of the building value, about $48,000.");
    expect(f.detail).toBe("2% of the $2,400,000 building limit, with a minimum of $10,000. Your declaration and rules decide whether owners can be charged.");
  });

  it("CP-DED-01 has no city in it", () => {
    const f = one(SCENARIOS["CP-DED-01"].make(), "CP-DED-01");
    expect(f.detail).not.toMatch(/Chicago/);
    expect(f.answerableFields).toEqual(["water_damage_deductible"]);
  });

  it("CP-VAL-01: older than three years", () => {
    expect(one(SCENARIOS["CP-VAL-01"].make(), "CP-VAL-01").title).toBe("Your replacement cost estimate is from January 1, 2023.");
    expect(ids(input({}, {}, { replacement_cost_as_of: "2023-10-15" }))).not.toContain("CP-VAL-01");
  });

  it("CP-WB-01: below-grade space with no backup limit; unknown space → missing facts", () => {
    expect(one(SCENARIOS["CP-WB-01"].make(), "CP-WB-01").answerableFields).toEqual(["water_backup_limit"]);
    const r = run(input({}, {}, { has_basement: null, has_below_grade_units: null }));
    expect(r.missingFacts).toEqual(expect.arrayContaining(["has_basement", "has_below_grade_units"]));
  });

  it("CP-FL-01: A/V zones ask, X with below-grade space informs, unknown → missing", () => {
    expect(one(SCENARIOS["CP-FL-01"].make(), "CP-FL-01")).toMatchObject({ severity: "ask", title: "Your building is in flood zone AE and Walkup has no flood policy." });
    expect(one(input({}, {}, { has_basement: true }), "CP-FL-01").severity).toBe("info");
    expect(run(input({}, {}, { flood_zone: null })).missingFacts).toContain("flood_zone");
    expect(ids(input({}, { included_sections: [...(MASTER.included_sections as string[]), "flood"] }, { flood_zone: "AE" }))).not.toContain("CP-FL-01");
  });

  it("CP-EB-01 names the equipment; unknown → missing", () => {
    const f = one(input({}, drop("equipment"), { has_elevator: true }), "CP-EB-01");
    expect(f.detail).toContain("You have a boiler and an elevator.");
    expect(f.question).toBe("Does our policy include equipment breakdown for the boiler and elevator?");
    expect(f.citationNote).toBe("The Act names equipment breakdown as coverage a declaration may require.");
    expect(run(input({}, drop("equipment"), { has_boiler: null, has_elevator: null })).missingFacts)
      .toEqual(expect.arrayContaining(["has_boiler", "has_elevator"]));
  });

  it("CP-WC-01 / CP-EPLI-01 / CP-WC-02", () => {
    expect(one(SCENARIOS["CP-WC-01"].make(), "CP-WC-01").question).toBe("We have 2 employees. Can you quote workers' compensation?");
    expect(run(input({}, {}, { has_employees: null })).missingFacts).toContain("has_employees");
    expect(one(SCENARIOS["CP-EPLI-01"].make(), "CP-EPLI-01").severity).toBe("info");
    const wc = input({ policies: [pol(MASTER as CheckPolicy), pol({ id: "wc", coverage: "workers_comp", wc_covers_volunteers: null })] }, {}, { uses_volunteers: true });
    expect(one(wc, "CP-WC-02")).toMatchObject({ policyId: "wc", answerableFields: ["wc_covers_volunteers"] });
  });

  it("CP-UMB-01, CP-CRIME-01, CP-DO-01, CP-COMM-01", () => {
    expect(one(SCENARIOS["CP-UMB-01"].make(), "CP-UMB-01").detail).toBe("An umbrella adds liability limits above general liability and D&O.");
    expect(one(SCENARIOS["CP-CRIME-01"].make(), "CP-CRIME-01").answerableFields).toEqual(["crime_social_engineering_limit"]);
    expect(one(SCENARIOS["CP-DO-01"].make(), "CP-DO-01").detail).toContain("your current date");
    expect(ids(input({ quotes: [{ coverage: "directors_officers", carrierName: "west bend", declined: false }] }))).not.toContain("CP-DO-01");
    expect(one(SCENARIOS["CP-COMM-01"].make(), "CP-COMM-01").line).toBeNull();
  });
});

describe("engine", () => {
  it("no policies → no findings and no missing facts", () => {
    const r = run(input({ policies: [] }, {}, { flood_zone: null }));
    expect(r.findings).toEqual([]);
    expect(r.missingFacts).toEqual([]);
  });

  it("is_condominium=false suppresses IL-* and enables CICAA-FID-01", () => {
    const r = run(input({ unitCount: 30 }, { ...drop("liability", "do", "crime", "umbrella", "equipment"), ordinance_or_law: false }, { is_condominium: false }));
    expect(r.legalChecks).toBe("condo_act_off");
    expect(r.findings.some((f) => f.ruleId.startsWith("IL-"))).toBe(false);
    expect(r.findings.map((f) => f.ruleId)).toContain("CICAA-FID-01");
  });

  it("outside Illinois: no IL or CICAA rule, YD/CP/DOC still run, no Illinois citation", () => {
    const r = run(input({ stateCode: "WI" }, { ...drop("liability", "do", "crime", "umbrella", "equipment"), ordinance_or_law: false, wind_hail_deductible_percent: "0.0200" }, { has_commercial_space: true, declaration_required_lines: ["flood"] }));
    expect(r.legalChecks).toBe("not_illinois");
    const ruleIds = r.findings.map((f) => f.ruleId);
    expect(ruleIds.some((id) => id.startsWith("IL-") || id.startsWith("CICAA-"))).toBe(false);
    expect(ruleIds).toEqual(expect.arrayContaining(["CP-COMM-01", "YD-WH-01", "DOC-REQ-01"]));
    expect(r.findings.every((f) => f.citation === null)).toBe(true);
  });

  it("missing facts become missingFacts, not findings", () => {
    const r = run(input({}, {}, { flood_zone: null, has_employees: null }));
    expect(r.missingFacts).toEqual(expect.arrayContaining(["flood_zone", "has_employees"]));
    expect(r.findings.some((f) => f.severity === "needs_info")).toBe(false);
  });

  it("facts null → every fact unknown, still a condominium", () => {
    const r = run({ ...input(), facts: null });
    expect(r.legalChecks).toBe("illinois");
    expect(r.missingFacts).toEqual(expect.arrayContaining(["replacement_cost_estimate", "flood_zone", "has_employees", "manager_handles_funds"]));
  });

  it("dismissals match rule and policy; a renewal's new policy re-shows the finding", () => {
    const base = input({}, { waiver_of_subrogation: false });
    const dismissed = run({ ...base, dismissals: [{ ruleId: "IL-SUB-01", policyId: "master", reason: "Our agent confirmed it." }] });
    const f = dismissed.findings.find((x) => x.ruleId === "IL-SUB-01")!;
    expect(f.dismissed).toEqual({ reason: "Our agent confirmed it." });
    expect(dismissed.counts.gap).toBe(0);
    const renewed = run({ ...input({}, { id: "master-2027", waiver_of_subrogation: false }), dismissals: [{ ruleId: "IL-SUB-01", policyId: "master", reason: "x" }] });
    expect(renewed.findings.find((x) => x.ruleId === "IL-SUB-01")!.dismissed).toBeNull();
    // A null-policy dismissal matches a null-policy finding.
    const noFl = run({ ...input({}, {}, { flood_zone: "AE" }), dismissals: [{ ruleId: "CP-FL-01", policyId: null, reason: "Lender waived it" }] });
    expect(noFl.findings.find((x) => x.ruleId === "CP-FL-01")!.dismissed).not.toBeNull();
  });

  it("sorts by severity, then basis, then line", () => {
    const r = run(input({}, { waiver_of_subrogation: null, cause_of_loss_form: "basic", named_insured: "Other", ...drop("umbrella") }, { flood_zone: "AE", declaration_coverage_form: "all_in" }));
    const sev = ["gap", "ask", "needs_info", "info"];
    const basis = ["statute", "your_documents", "your_data", "common_practice"];
    for (let k = 1; k < r.findings.length; k++) {
      const a = r.findings[k - 1];
      const b = r.findings[k];
      const order = sev.indexOf(a.severity) - sev.indexOf(b.severity) || basis.indexOf(a.basis) - basis.indexOf(b.basis);
      expect(order, `${a.id} before ${b.id}`).toBeLessThanOrEqual(0);
    }
    expect(r.findings[0].ruleId).toBe("IL-PROP-02");
  });

  it("counts: gap excludes not-on-file findings, which are counted separately", () => {
    const r = run(input({}, { ...drop("do", "crime"), cause_of_loss_form: "broad" }));
    expect(r.notOnFileCount).toBe(2); // IL-FID-01, IL-DO-01
    expect(r.counts.gap).toBe(1); // IL-PROP-02
    expect(r.findings.filter((f) => f.notOnFile).map((f) => f.ruleId).sort()).toEqual(["IL-DO-01", "IL-FID-01"]);
  });
});
