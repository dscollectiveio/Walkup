import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";
import { FIELD_DEFS } from "@/lib/insurance/fields";
import { premiumBillOption, prepareFieldValues } from "@/lib/insurance/save-input";

/**
 * The contract between the insurance actions and the 0052 save RPCs: what
 * prepareFieldValues() builds (every column of the policy's sections, enum
 * blanks as "unknown", booleans as booleans, money and percents as exact
 * text, one source per filled field) is accepted by save_insurance_policy /
 * save_insurance_quote as is, and an edit with "keep" sources clears what it
 * should and nothing else.
 */

describe("insurance actions ↔ save RPCs", () => {
  let db: PGlite;
  let f: Fixture;

  beforeAll(async () => {
    db = await freshDb();
    f = await seed(db);
  });
  afterAll(async () => {
    await db.close();
  });

  const rpc = async (user: string, fn: string, args: unknown[]) =>
    (
      await asUser(db, user, () =>
        db.query<{ id: string }>(`select public.${fn}($1::uuid, $2::uuid, $3::jsonb, $4::jsonb, $5::jsonb) as id`, args),
      )
    ).rows[0].id;

  const row = async (sql: string, params: unknown[]) => (await db.query<Record<string, unknown>>(sql, params)).rows[0];

  it("a new master policy with a package section, a premium bill and a client token", async () => {
    const prepared = prepareFieldValues({
      mode: "policy",
      coverage: "property",
      includedSections: ["do"],
      isEdit: false,
      meta: {},
      values: {
        carrier_name: "West Bend Mutual",
        policy_number: "CPP 1234567",
        effective_on: "2026-03-01",
        expires_on: "2027-03-01",
        annual_premium: "$3,766",
        payment_schedule: "quarterly",
        building_limit: "$2,400,000",
        wind_hail_deductible_percent: "2%",
        agreed_value: "Included",
        coverage_form: "single_entity",
        do_limit: "$1,000,000",
        do_covers_non_monetary: "no",
      },
    });
    if (!prepared.ok) throw new Error(prepared.error);
    const account = (await row(
      `insert into public.accounts (association_id, code, name, type, is_exempt_expenditure)
       values ($1::uuid, '5150', 'Insurance', 'expense', false) returning id`,
      [f.damen],
    )).id as string;
    const values = {
      ...prepared.columns,
      included_sections: prepared.sections,
      endorsements: [{ form_number: "CP 00 17", title: "Condominium Association Coverage Form", page: 2 }],
      exclusions: [],
      premium_breakdown: [{ label: "Premium", amount: "3600.00", page: 1 }],
      renewal_reminder_days: 60,
      notes: null,
      agent_contact_id: null,
    };
    const options = {
      client_token: "99999999-9999-4999-8999-999999999999",
      premium_bill: premiumBillOption(prepared.parsed, account, "2026-10-14"),
    };
    const id = await rpc(f.cyUser, "save_insurance_policy", [f.damen, null, JSON.stringify(values), JSON.stringify(prepared.sources), JSON.stringify(options)]);
    const again = await rpc(f.cyUser, "save_insurance_policy", [f.damen, null, JSON.stringify(values), JSON.stringify(prepared.sources), JSON.stringify(options)]);
    expect(again).toBe(id);

    const saved = await row(
      `select building_limit::text, wind_hail_deductible_percent::text, agreed_value, coverage_form, valuation, do_limit::text,
              do_covers_non_monetary, included_sections, payment_schedule, annual_premium::text
         from public.insurance_policies where id = $1::uuid`,
      [id],
    );
    expect(saved).toMatchObject({
      building_limit: "2400000.00", wind_hail_deductible_percent: "0.0200", agreed_value: true, coverage_form: "single_entity",
      valuation: "unknown", do_limit: "1000000.00", do_covers_non_monetary: false, payment_schedule: "quarterly", annual_premium: "3766.00",
    });
    expect(saved.included_sections).toEqual(["property", "property_deductibles", "do"]);

    const sources = (await db.query<{ field_name: string; source: string }>(
      `select field_name, source from public.insurance_policy_field_sources where policy_id = $1::uuid order by field_name`, [id],
    )).rows;
    expect(sources.map((s) => s.field_name)).toEqual(prepared.sources.map((s) => s.field_name).sort());
    expect(new Set(sources.map((s) => s.source))).toEqual(new Set(["manual"]));

    const bill = await row(`select frequency::text, typical_amount::text, next_due_on::text from public.recurring_bills where insurance_policy_id = $1::uuid`, [id]);
    expect(bill).toEqual({ frequency: "quarterly", typical_amount: "941.50", next_due_on: "2026-12-01" });

    // An edit that switches D&O off clears its values; untouched fields keep their provenance.
    const before = await row(`select updated_at::text from public.insurance_policies where id = $1::uuid`, [id]);
    const existing = await row(
      `select id, coverage::text, effective_from::text, effective_to::text, archived_at, replaced_by_policy_id, replaced_at,
              renewal_reminder_days, carrier_name, annual_premium::text, included_sections, do_limit::text, building_limit::text
         from public.insurance_policies where id = $1::uuid`,
      [id],
    );
    const edit = prepareFieldValues({
      mode: "policy", coverage: "property", includedSections: [], isEdit: true, existing: existing as never, meta: {},
      values: { carrier_name: "West Bend Mutual", effective_on: "2026-03-01", expires_on: "2027-03-01", annual_premium: "3766.00", building_limit: "2,500,000" },
    });
    if (!edit.ok) throw new Error(edit.error);
    await rpc(f.cyUser, "save_insurance_policy", [
      f.damen, id,
      JSON.stringify({ ...edit.columns, included_sections: edit.sections }),
      JSON.stringify(edit.sources),
      JSON.stringify({ expected_updated_at: before.updated_at }),
    ]);
    const after = await row(`select do_limit, do_covers_non_monetary, building_limit::text, included_sections from public.insurance_policies where id = $1::uuid`, [id]);
    expect(after).toMatchObject({ do_limit: null, do_covers_non_monetary: null, building_limit: "2500000.00" });
    expect(after.included_sections).toEqual(["property", "property_deductibles"]);
    const kept = (await db.query<{ field_name: string }>(
      `select field_name from public.insurance_policy_field_sources where policy_id = $1::uuid order by field_name`, [id],
    )).rows.map((r) => r.field_name);
    expect(kept).toContain("building_limit");
    expect(kept).not.toContain("do_limit");
  });

  it("a quote from the quote-mode columns", async () => {
    const prepared = prepareFieldValues({
      mode: "quote", coverage: "directors_officers", includedSections: [], isEdit: false, meta: {},
      values: { carrier_name: "Great American", annual_premium: "1,250", policy_number: "Q-77", effective_on: "2027-03-01", expires_on: "2028-03-01", do_limit: "$1M" },
    });
    // "$1M" is a short form: the form offers "Use $1,000,000"; a raw save refuses it.
    expect(prepared.ok).toBe(false);
    const fixed = prepareFieldValues({
      mode: "quote", coverage: "directors_officers", includedSections: [], isEdit: false, meta: {},
      values: { carrier_name: "Great American", annual_premium: "1,250", policy_number: "Q-77", effective_on: "2027-03-01", expires_on: "2028-03-01", do_limit: "1000000" },
    });
    if (!fixed.ok) throw new Error(fixed.error);
    const values = {
      ...fixed.columns, included_sections: fixed.sections, endorsements: [], exclusions: [], premium_breakdown: [],
      notes: null, quoted_on: "2026-10-14", valid_until: null, contact_id: null, quote_request_id: null,
    };
    const id = await rpc(f.cyUser, "save_insurance_quote", [f.damen, null, JSON.stringify(values), JSON.stringify(fixed.sources), "{}"]);
    const saved = await row(
      `select quote_number, covers_from::text, covers_to::text, do_limit::text, annual_premium::text, payment_schedule from public.insurance_quotes where id = $1::uuid`,
      [id],
    );
    expect(saved).toEqual({ quote_number: "Q-77", covers_from: "2027-03-01", covers_to: "2028-03-01", do_limit: "1000000.00", annual_premium: "1250.00", payment_schedule: "unknown" });
  });

  it("every policy column the form can send is one the RPC accepts", async () => {
    const allowed = (await db.query<{ c: string[] }>(`select public.insurance_policy_editable_columns() as c`)).rows[0].c;
    for (const d of FIELD_DEFS) expect(allowed).toContain(d.column);
  });
});
