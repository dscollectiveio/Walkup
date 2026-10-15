import { describe, expect, it } from "vitest";
import { emptyFacts } from "@/lib/insurance/facts";
import type { PolicyRow } from "@/lib/insurance/fields";
import {
  LEFT_TO_OWNERS,
  NO_AGENT_CERTIFICATE_INSTRUCTIONS,
  buildOwnerSummaryDraft,
  ownerSummarySchema,
  ownerSummarySourceHash,
  ownerSummaryStaleness,
} from "@/lib/insurance/owner-summary";
import type { PolicyStatus } from "@/lib/insurance/status";

const master: PolicyRow = {
  id: "m1", coverage: "property", carrier_name: "West Bend", annual_premium: "3766.00",
  effective_from: "2026-03-01", effective_to: "2027-03-01", archived_at: null, replaced_by_policy_id: null, replaced_at: null,
  renewal_reminder_days: 60, coverage_form: "single_entity", property_deductible: "5000.00", water_damage_deductible: "25000.00",
  wind_hail_deductible: "10000.00", wind_hail_deductible_percent: "0.0200", per_unit_deductible: null, claims_phone: "8005550199",
  notes: "renewal call scheduled",
};
const agent = { name: "Acme Agency", person_name: "Pat Lee", email: "pat@acme.example", phone: "3125550100" };

const build = (over: Partial<Parameters<typeof buildOwnerSummaryDraft>[0]> = {}) =>
  buildOwnerSummaryDraft({ associationName: "2158 N. Damen Condominium Association", master, facts: null, agent, ...over });

describe("buildOwnerSummaryDraft", () => {
  it("lists what's left to owners per coverage form", () => {
    for (const form of ["bare_walls", "single_entity", "all_in", "unknown"] as const) {
      expect(build({ master: { ...master, coverage_form: form } }).left_to_owners).toEqual(LEFT_TO_OWNERS[form]);
    }
    expect(build({ master: null }).left_to_owners).toEqual(LEFT_TO_OWNERS.unknown);
  });

  it("the master deductible tip includes the formatted deductibles and never says 'Ask for at least'", () => {
    const tip = build().tips[0];
    expect(tip).toBe(
      "Master deductible: the master policy deductible is $5,000 ($25,000 for water damage, 2% of the building value (at least $10,000) for wind or hail). Depending on your declaration and rules, the association may be able to charge an owner part or all of that amount. Ask the board, and ask your agent whether your policy's loss assessment or master deductible coverage would pay it.",
    );
    expect(tip).not.toMatch(/Ask for at least/i);
    expect(build({ master: { ...master, property_deductible: null, water_damage_deductible: null, wind_hail_deductible: null, wind_hail_deductible_percent: null } }).tips[0])
      .toBe("Master deductible: the board is confirming the master policy's deductible.");
  });

  it("no tip or list item says 'should'; no em dashes anywhere", () => {
    for (const form of ["bare_walls", "single_entity", "all_in", "unknown"] as const) {
      const s = build({ master: { ...master, coverage_form: form }, facts: { ...emptyFacts("a"), owners_must_carry_ho6: true, owners_ho6_min_liability: "300000.00" } });
      for (const line of [...s.tips, ...s.left_to_owners]) expect(line).not.toMatch(/should/i);
      expect(JSON.stringify(s)).not.toContain("—");
    }
  });

  it("the liability requirement only when the facts say so", () => {
    expect(build().liability_requirement).toBeNull();
    expect(build({ facts: { ...emptyFacts("a"), owners_must_carry_ho6: false } }).liability_requirement).toBeNull();
    expect(build({ facts: { ...emptyFacts("a"), owners_must_carry_ho6: true, owners_ho6_min_liability: "300000.00" } }).liability_requirement)
      .toBe("The board requires every owner to carry personal liability insurance of at least $300,000.");
    expect(build({ facts: { ...emptyFacts("a"), owners_must_carry_ho6: true } }).liability_requirement)
      .toBe("The board requires every owner to carry personal liability insurance.");
  });

  it("claims_line comes from claims_phone", () => {
    expect(build().claims_line).toEqual({ carrier: "West Bend", phone: "(800) 555-0199" });
    expect(build({ master: { ...master, claims_phone: null } }).claims_line).toBeNull();
  });

  it("certificate instructions name the agent, with the fallback when there is none", () => {
    const s = build();
    expect(s.certificate_contact).toEqual({ name: "Pat Lee", agency: "Acme Agency", email: "pat@acme.example", phone: "(312) 555-0100" });
    expect(s.certificate_instructions).toBe(
      "Need proof of the building's insurance for your mortgage lender? Ask Pat Lee at Acme Agency for a certificate of insurance: pat@acme.example or (312) 555-0100.",
    );
    expect(build({ agent: null }).certificate_instructions).toBe(NO_AGENT_CERTIFICATE_INSTRUCTIONS);
  });

  it("parses with ownerSummarySchema", () => {
    expect(ownerSummarySchema.safeParse(build()).success).toBe(true);
    expect(ownerSummarySchema.safeParse(build({ master: null, agent: null })).success).toBe(true);
  });
});

describe("source hash and staleness", () => {
  const withStatus = (p: PolicyRow, status: PolicyStatus = "active") => ({ ...p, status });
  const published = { source_policy_id: "m1", source_hash: ownerSummarySourceHash(master), content: build() };

  it("the hash changes with a deductible, not with the notes", () => {
    expect(ownerSummarySourceHash({ ...master, water_damage_deductible: "50000.00" })).not.toBe(ownerSummarySourceHash(master));
    expect(ownerSummarySourceHash({ ...master, notes: "something else" })).toBe(ownerSummarySourceHash(master));
    expect(ownerSummarySourceHash(master)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("deleted, archived, replaced, ended, edited, and not stale", () => {
    const today = "2026-10-14";
    expect(ownerSummaryStaleness(published, null, today)).toEqual({ stale: true, reason: "deleted", endedOn: null });
    expect(ownerSummaryStaleness(published, withStatus({ ...master, archived_at: "2026-10-01T00:00:00Z" }, "archived"), today)).toMatchObject({ reason: "archived" });
    expect(ownerSummaryStaleness(published, withStatus(master, "replaced"), today)).toMatchObject({ reason: "replaced" });
    expect(ownerSummaryStaleness(published, withStatus(master, "expired"), "2027-03-02")).toEqual({ stale: true, reason: "ended", endedOn: "2027-03-01" });
    expect(ownerSummaryStaleness(published, withStatus({ ...master, property_deductible: "10000.00" }), today)).toMatchObject({ reason: "edited" });
    expect(ownerSummaryStaleness(published, withStatus(master), today)).toEqual({ stale: false });
  });
});
