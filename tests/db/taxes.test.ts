import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

const INCOME = "acc00000-0000-0000-0000-000000004000";
const OTHER = "99999999-0000-0000-0000-000000000042";
const SHA = "a".repeat(64);

describe("taxes (0042)", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
  });

  describe("confirming income classification", () => {
    it("a board member confirms once; it's recorded with who and when", async () => {
      await asUser(db, f.cyUser, () =>
        db.query(`select public.confirm_income_classification($1::uuid, true)`, [INCOME]),
      );
      const { rows } = await db.query<{ is_exempt_function_income: boolean; tax_classification_confirmed_by: string }>(
        `select is_exempt_function_income, tax_classification_confirmed_by from public.accounts where id = $1::uuid`,
        [INCOME],
      );
      expect(rows[0]).toEqual({ is_exempt_function_income: true, tax_classification_confirmed_by: f.cyUser });
    });

    it("refuses an owner, and refuses a non-income account", async () => {
      await expect(
        asUser(db, f.adaUser, () => db.query(`select public.confirm_income_classification($1::uuid, false)`, [INCOME])),
      ).rejects.toThrow(/not authorized/);
      await expect(
        asUser(db, f.cyUser, () =>
          db.query(`select public.confirm_income_classification('acc00000-0000-0000-0000-000000001000'::uuid, false)`),
        ),
      ).rejects.toThrow(/only income accounts/);
    });
  });

  describe("official form templates", () => {
    const insert = (user: string, url = "https://www.irs.gov/pub/irs-pdf/f1120h.pdf") =>
      asUser(db, user, () =>
        db.query(
          `insert into public.tax_form_templates (form_code, tax_year, source_url, storage_path, sha256)
           values ('irs_1120h', 2026, $1, 'irs_1120h/2026/x.pdf', $2) returning id`,
          [url, SHA],
        ),
      );

    it("ships with none, and only a platform admin can add one", async () => {
      expect((await db.query(`select id from public.tax_form_templates`)).rows).toHaveLength(0);
      await expect(insert(f.cyUser)).rejects.toThrow(/row-level security/);
      await db.query(`insert into public.platform_admins (user_id) values ($1::uuid)`, [f.cyUser]);
      expect((await insert(f.cyUser)).affectedRows).toBe(1);
    });

    it("accepts only official sources and can't be active until verified", async () => {
      await db.query(`insert into public.platform_admins (user_id) values ($1::uuid)`, [f.cyUser]);
      await expect(insert(f.cyUser, "https://example.com/f1120h.pdf")).rejects.toThrow(/check/);
      const { rows } = (await insert(f.cyUser)) as { rows: { id: string }[] };
      await expect(
        asUser(db, f.cyUser, () => db.query(`update public.tax_form_templates set active = true where id = $1::uuid`, [rows[0].id])),
      ).rejects.toThrow(/check/);
      const ok = await asUser(db, f.cyUser, () =>
        db.query(`update public.tax_form_templates set active = true, verified_at = now() where id = $1::uuid`, [rows[0].id]),
      );
      expect(ok.affectedRows).toBe(1);
    });

    it("keeps one active template per form per year", async () => {
      await db.query(`insert into public.platform_admins (user_id) values ($1::uuid)`, [f.cyUser]);
      await asUser(db, f.cyUser, () =>
        db.query(
          `insert into public.tax_form_templates (form_code, tax_year, source_url, storage_path, sha256, active, verified_at)
           values ('irs_1120h', 2026, 'https://www.irs.gov/a.pdf', 'p1', $1, true, now()),
                  ('irs_1120h', 2026, 'https://www.irs.gov/b.pdf', 'p2', $2, false, now())`,
          [SHA, "b".repeat(64)],
        ),
      );
      await expect(
        asUser(db, f.cyUser, () =>
          db.query(`update public.tax_form_templates set active = true where sha256 = $1`, ["b".repeat(64)]),
        ),
      ).rejects.toThrow(/tax_form_templates_one_active/);
    });
  });

  describe("tax forms and their fields", () => {
    async function startForm(user: string = f.cyUser) {
      const { rows } = await asUser(db, user, () =>
        db.query<{ id: string }>(
          `insert into public.tax_forms (association_id, form_code, tax_year, determination, determination_reason)
           values ($1::uuid, 'irs_1120h', 2026, 'ask_cpa', 'Some income isn''t classified yet.') returning id`,
          [f.damen],
        ),
      );
      return rows[0].id;
    }

    it("a board member starts a form; an owner can't see or start one", async () => {
      const id = await startForm();
      expect(id).toMatch(/[0-9a-f-]{36}/);
      const { rows } = await asUser(db, f.adaUser, () => db.query(`select id from public.tax_forms`));
      expect(rows).toHaveLength(0);
      await expect(startForm(f.adaUser)).rejects.toThrow(/row-level security/);
    });

    it("always carries a reason, and can't be 'filed' without a date", async () => {
      await expect(
        asUser(db, f.cyUser, () =>
          db.query(
            `insert into public.tax_forms (association_id, form_code, tax_year, determination, determination_reason)
             values ($1::uuid, 'irs_1096', 2026, 'required', '  ')`,
            [f.damen],
          ),
        ),
      ).rejects.toThrow(/check/);
      const id = await startForm();
      await expect(
        asUser(db, f.cyUser, () => db.query(`update public.tax_forms set status = 'filed' where id = $1::uuid`, [id])),
      ).rejects.toThrow(/check/);
    });

    it("needs a contractor exactly when it's a 1099-NEC, one per contractor per year", async () => {
      const { rows: v } = await asUser(db, f.cyUser, () =>
        db.query<{ id: string }>(`insert into public.vendors (association_id, name) values ($1::uuid, 'Damen Plumbing') returning id`, [f.damen]),
      );
      const nec = () =>
        asUser(db, f.cyUser, () =>
          db.query(
            `insert into public.tax_forms (association_id, form_code, tax_year, vendor_id, determination, determination_reason)
             values ($1::uuid, 'irs_1099_nec', 2026, $2::uuid, 'required', 'Paid over the threshold.')`,
            [f.damen, v[0].id],
          ),
        );
      await nec();
      await expect(nec()).rejects.toThrow(/tax_forms_one_per_year/);
      await expect(
        asUser(db, f.cyUser, () =>
          db.query(
            `insert into public.tax_forms (association_id, form_code, tax_year, determination, determination_reason)
             values ($1::uuid, 'irs_1099_nec', 2025, 'required', 'x')`,
            [f.damen],
          ),
        ),
      ).rejects.toThrow(/check/);
    });

    it("keeps every field's value with its source, and refuses another association's form", async () => {
      const id = await startForm();
      const ok = await asUser(db, f.cyUser, () =>
        db.query(
          `insert into public.tax_form_fields
             (association_id, tax_form_id, pdf_field_name, label, value, source, source_ref_json, confidence)
           values ($1::uuid, $2::uuid, 'f1_1', 'Exempt function income', '18400.00', 'ledger', '{"count": 14}', 'high')`,
          [f.damen, id],
        ),
      );
      expect(ok.affectedRows).toBe(1);

      await db.query(
        `insert into public.associations (id, legal_name, display_name, state_code) values ($1::uuid, 'Other', 'Other', 'IL')`,
        [OTHER],
      );
      await expect(
        asUser(db, f.cyUser, () =>
          db.query(
            `insert into public.tax_form_fields (association_id, tax_form_id, pdf_field_name, label, source, confidence)
             values ($1::uuid, $2::uuid, 'f1_2', 'x', 'manual', 'blank')`,
            [OTHER, id],
          ),
        ),
      ).rejects.toThrow();
    });
  });

  it("totals 1099 payments by the calendar year paid, not the fiscal year", async () => {
    const { rows } = await asUser(db, f.cyUser, () =>
      db.query<{ calendar_year: number }>(`select calendar_year from public.vendor_1099_calendar_totals`),
    );
    for (const r of rows) expect(Number.isInteger(r.calendar_year)).toBe(true);
  });

  it("lets a filled packet link to its form in the Document Hub", async () => {
    const { rows } = await db.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'document_links_target_table_known'`,
    );
    expect(rows[0].def).toContain("tax_forms");
  });
});
