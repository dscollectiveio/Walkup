import { describe, expect, it } from "vitest";
import { fieldsFor, type PolicyRow } from "@/lib/insurance/fields";
import { checkSummary, summaryFacts } from "@/lib/insurance/summary-check";

const policy: PolicyRow = {
  id: "p", coverage: "property", carrier_name: "West Bend", annual_premium: "3766.00",
  effective_from: "2026-03-01", effective_to: "2027-03-01", archived_at: null, replaced_by_policy_id: null, replaced_at: null,
  renewal_reminder_days: 60, included_sections: [], payment_schedule: "annual",
  policy_number: "BOP-998877", named_insured: "2158 N. Damen Condominium Association", insured_address: "2158 N Damen Ave",
  broker_name: "Pat Agent", broker_email: "pat@agency.example", agent_phone: "3125550100", agency_name: "Acme Agency",
  building_limit: "2400000.00", liability_per_occurrence: null, property_deductible: "5000.00", water_damage_deductible: "25000.00",
  wind_hail_deductible_percent: "0.0200", coverage_form: "single_entity", equipment_breakdown_included: true,
  endorsements: [{ form_number: "CP 04 05", title: "Ordinance or Law Coverage", page: 3 }],
};
const facts = summaryFacts(policy, fieldsFor("property", []));

describe("summaryFacts", () => {
  it("lists labelled values and leaves out names, numbers and contacts", () => {
    expect(facts).toContain("Kind of policy: Master policy (building and property)");
    expect(facts).toContain("Insurer: West Bend");
    expect(facts).toContain("Policy period: March 1, 2026 to March 1, 2027");
    expect(facts).toContain("Building: $2,400,000");
    expect(facts).toContain("Wind or hail (percent): 2%");
    expect(facts).toContain("Equipment breakdown included: Yes");
    expect(facts).toContain("Endorsements: Ordinance or Law Coverage");
    const all = facts.join("\n");
    expect(all).not.toMatch(/BOP-998877|Damen|Pat Agent|pat@|555|Acme Agency|CP 04 05/);
  });
});

const good =
  "This is the association's master policy with West Bend, from March 1, 2026 to March 1, 2027. It insures the building for $2,400,000. The all other perils deductible is $5,000, with a separate $25,000 deductible for water damage and a 2% wind or hail deductible.";

describe("checkSummary", () => {
  it("accepts figures and dates copied from the input", () => {
    expect(checkSummary(good, facts)).toEqual({ ok: true });
  });

  it("'$1 million' for '$1,000,000' is rejected with a reason naming it", () => {
    const r = checkSummary(`${good} Liability is $1 million.`, facts);
    expect(r).toEqual({ ok: false, reasons: ["it wrote $1 million, which is not in the input"] });
  });

  it("a percent not in the input is rejected", () => {
    expect(checkSummary(`${good} Coinsurance is 90%.`, facts).ok).toBe(false);
  });

  it("a date not in the input is rejected", () => {
    expect(checkSummary(`${good} It was bound on February 1, 2026.`, facts)).toMatchObject({ ok: false, reasons: ["it wrote February 1, 2026, which is not in the input"] });
  });

  it("'should', 'recommend', 'best', 'cheaper', 'advice' are rejected in plain words", () => {
    expect(checkSummary(`${good} Owners should buy HO-6 cover.`, facts)).toEqual({ ok: false, reasons: ["it used the word should"] });
    expect(checkSummary(`${good} We recommend a review.`, facts)).toMatchObject({ ok: false, reasons: ["it used the word recommend"] });
    expect(checkSummary(`${good} It is the best option.`, facts).ok).toBe(false);
  });

  it("length cap and em dash", () => {
    expect(checkSummary("a".repeat(1201), facts)).toMatchObject({ ok: false, reasons: ["it is longer than 1,200 characters"] });
    expect(checkSummary(`${good} — nothing else.`, facts)).toMatchObject({ ok: false, reasons: ["it used an em dash"] });
  });

  it("reasons are plain sentences the retry prompt can quote", () => {
    const r = checkSummary(`${good} You should get $2 million more — it's the best.`, facts) as { ok: false; reasons: string[] };
    for (const reason of r.reasons) expect(reason).toMatch(/^it [a-z]/);
  });
});
