import { describe, expect, it } from "vitest";
import { friendlyDbError } from "@/lib/insurance/errors";
import type { PolicyRow } from "@/lib/insurance/fields";
import {
  agentFromValues, emptyColumnValue, fieldErrorText, parseLists, premiumBillOption, prepareFieldValues,
} from "@/lib/insurance/save-input";
import { FIELD_BY_KEY } from "@/lib/insurance/fields";

const basics = {
  carrier_name: "West Bend Mutual",
  effective_on: "2026-03-01",
  expires_on: "2027-03-01",
  annual_premium: "$3,766",
};

describe("prepareFieldValues (savePolicy steps 1 to 3, 5, 7)", () => {
  it("parses into columns: money as exact text, booleans as booleans, blank enums as unknown", () => {
    const r = prepareFieldValues({
      mode: "policy", coverage: "property", includedSections: [], isEdit: false, meta: {},
      values: { ...basics, building_limit: "$2,400,000", agreed_value: "yes", wind_hail_deductible_percent: "2%" },
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.columns.coverage).toBe("property");
    expect(r.columns.annual_premium).toBe("3766.00");
    expect(r.columns.building_limit).toBe("2400000.00");
    expect(r.columns.agreed_value).toBe(true);
    expect(r.columns.wind_hail_deductible_percent).toBe("0.0200");
    expect(r.columns.valuation).toBe("unknown");
    expect(r.columns.coverage_form).toBe("unknown");
    expect(r.columns.do_limit).toBeUndefined(); // D&O isn't a section of this policy
  });

  it("collects field errors with the spec's wording and hints", () => {
    const r = prepareFieldValues({
      mode: "policy", coverage: "property", includedSections: [], isEdit: false, meta: {},
      values: { ...basics, building_limit: "about two million", coinsurance_percent: "eighty" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fieldErrors.building_limit).toBe('Building: "about two million" isn\'t a value Walkup can save. Use digits, like 2400000 or $2,400,000.');
    expect(r.fieldErrors.coinsurance_percent).toContain("Use a percent, like 2%.");
  });

  it("requires the policy basics and an end date after the start", () => {
    const missing = prepareFieldValues({ mode: "policy", coverage: "directors_officers", includedSections: [], isEdit: false, meta: {}, values: {} });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(Object.keys(missing.fieldErrors).sort()).toEqual(["annual_premium", "carrier_name", "effective_on", "expires_on"]);
      expect(missing.fieldErrors.carrier_name).toBe("Insurer is needed to save.");
    }
    const backwards = prepareFieldValues({
      mode: "policy", coverage: "directors_officers", includedSections: [], isEdit: false, meta: {},
      values: { ...basics, expires_on: "2026-02-01" },
    });
    expect(!backwards.ok && backwards.fieldErrors.expires_on).toBe("The end date has to be after the start date.");
  });

  it("quotes need only kind, insurer and premium, and save to the quote columns", () => {
    const r = prepareFieldValues({
      mode: "quote", coverage: "property", includedSections: [], isEdit: false, meta: {},
      values: { carrier_name: "Acuity", annual_premium: "3310", policy_number: "Q-77", effective_on: "2027-03-01" },
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.columns.quote_number).toBe("Q-77");
    expect(r.columns.covers_from).toBe("2027-03-01");
    expect(r.columns).not.toHaveProperty("policy_number");
    expect(r.columns).not.toHaveProperty("insured_address");
  });

  it("sources: one per field with a value; extracted keeps its candidate index; nothing else is sent", () => {
    const r = prepareFieldValues({
      mode: "policy", coverage: "property", includedSections: [], isEdit: false,
      values: { ...basics, building_limit: "2400000" },
      meta: {
        building_limit: { source: "extracted", candidateIndex: 1 },
        carrier_name: { source: "extracted", candidateIndex: null },
        annual_premium: { source: "agent_confirmed", candidateIndex: null, confirmedOn: "2026-10-01", attachmentDocumentId: "doc-9" },
      },
    });
    if (!r.ok) throw new Error(r.error);
    const by = Object.fromEntries(r.sources.map((s) => [s.field_name, s]));
    expect(by.building_limit).toEqual({ field_name: "building_limit", source: "extracted", candidate_index: 1 });
    expect(by.carrier_name.source).toBe("manual"); // extracted without a candidate can't be rebuilt
    expect(by.annual_premium).toEqual({ field_name: "annual_premium", source: "agent_confirmed", confirmed_on: "2026-10-01", document_id: "doc-9" });
    expect(by.effective_on.source).toBe("manual");
    expect(by.valuation).toBeUndefined(); // blank fields send no source
    for (const s of r.sources) expect(Object.keys(s).some((k) => /page|snippet|confidence/.test(k))).toBe(false);
  });

  it("an edit sends keep for untouched fields; a quote never sends quote or agent_confirmed", () => {
    const edit = prepareFieldValues({ mode: "policy", coverage: "directors_officers", includedSections: [], isEdit: true, meta: {}, values: basics });
    if (!edit.ok) throw new Error(edit.error);
    expect(edit.sources.every((s) => s.source === "keep")).toBe(true);
    const quote = prepareFieldValues({
      mode: "quote", coverage: "directors_officers", includedSections: [], isEdit: false,
      values: { carrier_name: "Acuity", annual_premium: "900" },
      meta: { carrier_name: { source: "quote", candidateIndex: null }, annual_premium: { source: "agent_confirmed", candidateIndex: null } },
    });
    if (!quote.ok) throw new Error(quote.error);
    expect(quote.sources.map((s) => s.source)).toEqual(["manual", "manual", "manual"]);
  });

  it("an edit clears a section switched off, and legacy values only when asked", () => {
    const row = {
      id: "p1", coverage: "property", effective_from: "2026-03-01", effective_to: "2027-03-01", archived_at: null,
      replaced_by_policy_id: null, replaced_at: null, renewal_reminder_days: 60, carrier_name: "West Bend", annual_premium: "3766.00",
      included_sections: ["property", "property_deductibles", "do"], do_limit: "1000000.00", building_limit: "2400000.00",
    } as unknown as PolicyRow;
    const r = prepareFieldValues({ mode: "policy", coverage: "property", includedSections: [], isEdit: true, existing: row, meta: {}, values: basics });
    if (!r.ok) throw new Error(r.error);
    expect(r.columns.do_limit).toBeNull(); // D&O was on screen and switched off
    const legacyDo = {
      ...row, coverage: "directors_officers", included_sections: ["do"], do_limit: "1000000.00", building_limit: "2400000.00",
    } as unknown as PolicyRow;
    const keep = prepareFieldValues({ mode: "policy", coverage: "directors_officers", includedSections: [], isEdit: true, existing: legacyDo, meta: {}, values: basics });
    if (!keep.ok) throw new Error(keep.error);
    expect(keep.columns).not.toHaveProperty("building_limit");
    const clear = prepareFieldValues({
      mode: "policy", coverage: "directors_officers", includedSections: [], isEdit: true, existing: legacyDo, clearLegacy: true, meta: {}, values: basics,
    });
    if (!clear.ok) throw new Error(clear.error);
    expect(clear.columns.building_limit).toBeNull();
  });
});

describe("helpers", () => {
  it("fieldErrorText has no hint for enums and booleans", () => {
    expect(fieldErrorText(FIELD_BY_KEY.get("agreed_value")!, "maybe")).toBe('Agreed value (coinsurance waived): "maybe" isn\'t a value Walkup can save.');
  });

  it("emptyColumnValue: unknown for enums that have it, null otherwise", () => {
    expect(emptyColumnValue(FIELD_BY_KEY.get("valuation")!)).toBe("unknown");
    expect(emptyColumnValue(FIELD_BY_KEY.get("building_limit")!)).toBeNull();
  });

  it("premiumBillOption runs premiumSchedule on the values being saved", () => {
    expect(premiumBillOption({ annual_premium: "1000.00", payment_schedule: "quarterly", effective_on: "2026-03-01", expires_on: "2027-03-01" }, "acct", "2026-10-14"))
      .toEqual({ account_id: "acct", frequency: "quarterly", typical_amount: "250.00", next_due_on: "2026-12-01" });
    expect(premiumBillOption({ annual_premium: null, effective_on: "2026-03-01", expires_on: "2027-03-01" }, null, "2026-10-14")).toBeNull();
  });

  it("agentFromValues: an agency with a person, a lone agent, nothing, a bad email dropped", () => {
    expect(agentFromValues({ agency_name: "Acme Agency", agent_name: "Pat Lee", agent_email: "pat@acme.com", agent_phone: null }))
      .toEqual({ kind: "agency", name: "Acme Agency", personName: "Pat Lee", email: "pat@acme.com", phone: null });
    expect(agentFromValues({ agent_name: "Pat Lee", agent_email: "not an email" }))
      .toEqual({ kind: "agent", name: "Pat Lee", personName: null, email: null, phone: null });
    expect(agentFromValues({})).toBeNull();
    expect(agentFromValues({ agent_phone: "312-555-0100" })).toBeNull();
  });

  it("parseLists refuses a row without a title", () => {
    expect(parseLists({ endorsements: [{ form_number: "CP 00 17", title: "Condo association coverage", page: 2 }], exclusions: [], premiumBreakdown: [] }).ok).toBe(true);
    const bad = parseLists({ endorsements: [{ form_number: null, title: "", page: null }], exclusions: [], premiumBreakdown: [] });
    expect(bad.ok).toBe(false);
  });
});

describe("friendlyDbError (§8)", () => {
  it("passes through the RPC messages written for people", () => {
    expect(friendlyDbError({ code: "42501", message: "Only a board admin can delete a policy." }, "x").error).toBe("Only a board admin can delete a policy.");
    expect(friendlyDbError({ code: "42501", message: "File this document as Insurance before Walkup reads it." }, "x").error).toMatch(/^File this/);
    expect(friendlyDbError({ code: "42501", message: "new row violates row-level security policy" }, "x").error).toBe("Only a board member can do that.");
    expect(friendlyDbError({ code: "40001", message: "Someone else changed this policy while you were editing. Reload to see their changes." }, "x").error).toContain("Someone else");
    expect(friendlyDbError({ code: "P0002", message: "That quote was not found." }, "x").error).toBe("That quote was not found.");
    expect(friendlyDbError({ code: "22023", message: "Enter the date your agent answered." }, "x").error).toBe("Enter the date your agent answered.");
  });

  it("23503 and 23505", () => {
    expect(friendlyDbError({ code: "23503", message: "This policy has claims recorded against it. Archive it instead." }, "x").error).toMatch(/^This policy has claims/);
    expect(friendlyDbError({ code: "23503", message: "update or delete violates foreign key" }, "x").error).toContain("Archive it instead.");
    expect(friendlyDbError({ code: "23505", message: "This policy was already saved from this file.", details: "pol-1" }, "x"))
      .toEqual({ error: "This policy was already saved from this file.", alreadySavedId: "pol-1" });
    expect(friendlyDbError({ code: "23505", message: "duplicate key value violates unique constraint" }, "x")).toEqual({ error: "That already exists." });
  });

  it("anything else gets the fallback, never the raw message", () => {
    expect(friendlyDbError({ code: "XX000", message: "internal error at line 3" }, "Walkup couldn't save this policy.")).toEqual({ error: "Walkup couldn't save this policy." });
  });
});
