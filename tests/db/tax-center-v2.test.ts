import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

const FY_2026 = "f1500000-0000-0000-0000-000000000001";
const FY_2027 = "f1500000-0000-0000-0000-000000000002";
const HOYNE_FY = "f1500000-0000-0000-0000-000000000003";
const PAT = "eeee0000-0000-0000-0000-0000000000a9";
const SHA = "a".repeat(64);
const IRS = "https://www.irs.gov/pub/irs-pdf/f1120h.pdf";

/**
 * Migration 0048: the official-links registry, link-only templates, the
 * accountant handoff, the $600 → $2,000 1099-NEC threshold split, and the
 * 1120-H parameters resolved as of the fiscal year end. Nothing here sets a
 * template active or verified from code, and nothing fills a recipient TIN.
 */
describe("tax center v2 (0048)", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
  });
  afterEach(async () => {
    await db.close();
  });

  const makePlatformAdmin = (user: string) =>
    db.query(`insert into public.platform_admins (user_id) values ($1::uuid)`, [user]);

  // A person with no grants and no unit — the shape an outside accountant
  // has. Inserted directly: the seed fixture is shared, this is test-local.
  const addPat = () =>
    db.query(
      `insert into public.persons (id, association_id, full_name, email)
       values ($1::uuid, $2::uuid, 'Pat Accountant', 'pat@cpa.test')`,
      [PAT, f.damen],
    );

  // --------------------------------------------------------------------------
  // A. Official links
  // --------------------------------------------------------------------------

  describe("official links registry", () => {
    it("ships seeded from the 2026-10-11 research, every row unverified and active", async () => {
      const { rows } = await db.query<{
        form_code: string;
        kind: string;
        state_code: string | null;
        retrieved_on: string;
        verified_at: string | null;
        active: boolean;
        sort_order: number;
      }>(
        `select form_code, kind, state_code, retrieved_on::text, verified_at::text, active, sort_order
           from public.tax_form_links order by form_code, sort_order`,
      );
      expect(rows).toHaveLength(19);
      for (const r of rows) {
        expect(r.retrieved_on).toBe("2026-10-11");
        expect(r.verified_at).toBeNull();
        expect(r.active).toBe(true);
      }
      // sort_order follows the kind, so "about" always leads a form's links.
      const orderByKind = { about: 10, form: 20, instructions: 30, file_online: 40, order_paper: 50, guidance: 60, law: 70 };
      for (const r of rows) expect(r.sort_order).toBe(orderByKind[r.kind as keyof typeof orderByKind]);
      // Illinois rows carry the state; federal rows don't.
      expect(rows.filter((r) => r.state_code === "IL").map((r) => r.form_code)).toEqual(
        expect.arrayContaining(["il_1120", "il_sos_annual_report"]),
      );
      expect(rows.filter((r) => r.form_code.startsWith("irs_")).every((r) => r.state_code === null)).toBe(true);
      // The W-9 is linked (boards request them) but never a template.
      expect(rows.filter((r) => r.form_code === "irs_w9")).toHaveLength(2);
    });

    it("any signed-in member reads them; only a platform admin writes", async () => {
      const { rows: asOwner } = await asUser(db, f.adaUser, () => db.query(`select id from public.tax_form_links`));
      expect(asOwner).toHaveLength(19);

      const insert = () =>
        asUser(db, f.cyUser, () =>
          db.query(
            `insert into public.tax_form_links (form_code, kind, label, url, retrieved_on)
             values ('irs_1120h', 'guidance', 'Pub 588?', 'https://www.irs.gov/publications/p588', current_date)`,
          ),
        );
      // Cy is board_admin — that is not enough for a global table.
      await expect(insert()).rejects.toThrow(/row-level security/);
      const silent = await asUser(db, f.cyUser, () =>
        db.query(`update public.tax_form_links set verified_at = now(), verified_by = $1::uuid`, [f.cyUser]),
      );
      expect(silent.affectedRows).toBe(0);

      await makePlatformAdmin(f.cyUser);
      expect((await insert()).affectedRows).toBe(1);
      const verified = await asUser(db, f.cyUser, () =>
        db.query(
          `update public.tax_form_links set verified_at = now(), verified_by = $1::uuid
            where form_code = 'irs_1120h' and kind = 'about'`,
          [f.cyUser],
        ),
      );
      expect(verified.affectedRows).toBe(1);
    });

    it("accepts only official hosts, known kinds, a real label and a two-letter state", async () => {
      await makePlatformAdmin(f.cyUser);
      const tryUrl = (url: string) =>
        asUser(db, f.cyUser, () =>
          db.query(
            `insert into public.tax_form_links (form_code, kind, label, url, retrieved_on)
             values ('irs_1120h', 'guidance', 'x', $1, current_date)`,
            [url],
          ),
        );
      await expect(tryUrl("https://example.com/f1120h.pdf")).rejects.toThrow(/check/);
      await expect(tryUrl("http://www.irs.gov/forms-pubs/about-form-1120-h")).rejects.toThrow(/check/);
      await expect(tryUrl("https://irs.gov.evil.test/x")).rejects.toThrow(/check/);
      // Subdomains of the four official hosts are fine.
      expect((await tryUrl("https://apps.ilsos.gov/other/")).affectedRows).toBe(1);
      expect((await tryUrl("https://www.ilga.gov/x")).affectedRows).toBe(1);

      const tryRow = (kind: string, label: string, state: string | null) =>
        asUser(db, f.cyUser, () =>
          db.query(
            `insert into public.tax_form_links (form_code, kind, label, url, state_code, retrieved_on)
             values ('irs_1120h', $1, $2, 'https://www.irs.gov/z', $3, current_date)`,
            [kind, label, state],
          ),
        );
      await expect(tryRow("blog", "x", null)).rejects.toThrow(/check/);
      await expect(tryRow("guidance", "   ", null)).rejects.toThrow(/check/);
      await expect(tryRow("guidance", "x", "Illinois")).rejects.toThrow(/check/);
      expect((await tryRow("guidance", "x", "NH")).affectedRows).toBe(1);

      // The same URL twice under one form and kind is a duplicate, not a second link.
      await expect(
        asUser(db, f.cyUser, () =>
          db.query(
            `insert into public.tax_form_links (form_code, kind, label, url, retrieved_on)
             values ('irs_1120h', 'about', 'About Form 1120-H (again)', 'https://www.irs.gov/forms-pubs/about-form-1120-h', current_date)`,
          ),
        ),
      ).rejects.toThrow(/duplicate key/);
    });
  });

  // --------------------------------------------------------------------------
  // B. Templates
  // --------------------------------------------------------------------------

  describe("templates", () => {
    beforeEach(() => makePlatformAdmin(f.cyUser));

    it("still ships with zero rows — a suggestion is installed by a person, never by migration", async () => {
      expect((await db.query(`select id from public.tax_form_templates`)).rows).toHaveLength(0);
    });

    it("accepts a link-only template without a file, and refuses a pdf template without one", async () => {
      const { rows } = await asUser(db, f.cyUser, () =>
        db.query<{ id: string; kind: string; storage_path: string | null }>(
          `insert into public.tax_form_templates
             (form_code, tax_year, kind, source_url, due_rule, due_rule_citation, notes)
           values ('il_sos_annual_report', 2026, 'link_only',
                   'https://www.ilsos.gov/departments/business-services/annual-reports.html',
                   'INCORPORATION_ANNIVERSARY_MONTH - 1 MONTHS, DAY LAST', '805 ILCS 105/114.10',
                   'Illinois not-for-profit corporations only.')
           returning id, kind, storage_path`,
        ),
      );
      expect(rows[0]).toMatchObject({ kind: "link_only", storage_path: null });

      // The default kind is 'pdf', and a pdf needs both the file and its hash.
      await expect(
        asUser(db, f.cyUser, () =>
          db.query(`insert into public.tax_form_templates (form_code, tax_year, source_url) values ('irs_1120h', 2025, $1)`, [IRS]),
        ),
      ).rejects.toThrow(/tax_form_templates_pdf_has_file/);
      await expect(
        asUser(db, f.cyUser, () =>
          db.query(
            `insert into public.tax_form_templates (form_code, tax_year, source_url, storage_path) values ('irs_1120h', 2025, $1, 'irs_1120h/2025/x.pdf')`,
            [IRS],
          ),
        ),
      ).rejects.toThrow(/tax_form_templates_pdf_has_file/);
      // And a link-only template can't smuggle a file in.
      await expect(
        asUser(db, f.cyUser, () =>
          db.query(
            `insert into public.tax_form_templates (form_code, tax_year, kind, source_url, storage_path, sha256)
             values ('il_1120', 2025, 'link_only', 'https://tax.illinois.gov/x', 'p', $1)`,
            [SHA],
          ),
        ),
      ).rejects.toThrow(/tax_form_templates_pdf_has_file/);
      // The gate is unchanged: not active until a person verifies.
      await expect(
        asUser(db, f.cyUser, () => db.query(`update public.tax_form_templates set active = true where id = $1::uuid`, [rows[0].id])),
      ).rejects.toThrow(/check/);
    });

    it("checks include_pages, mirror_json and instructions_url", async () => {
      const insert = (extraCols: string, extraVals: string) =>
        asUser(db, f.cyUser, () =>
          db.query(
            `insert into public.tax_form_templates (form_code, tax_year, source_url, storage_path, sha256${extraCols})
             values ('irs_1099_nec', 2026, 'https://www.irs.gov/pub/irs-pdf/f1099nec.pdf', 'irs_1099_nec/2026/x.pdf', $1${extraVals})
             returning id`,
            [SHA],
          ),
        );
      await expect(insert(", include_pages", ", '{0,4}'")).rejects.toThrow(/check/);
      await expect(insert(", include_pages", ", '{}'")).rejects.toThrow(/check/);
      await expect(insert(", mirror_json", `, '{"from": "CopyB[0]"}'`)).rejects.toThrow(/check/);
      await expect(insert(", instructions_url", ", 'https://example.com/i1099mec'")).rejects.toThrow(/check/);
      const ok = await insert(
        ", include_pages, mirror_json, instructions_url, revision_title, suggested_from",
        `, '{4,5,6}', '[{"from": "CopyB[0]", "to": "Copy2[0]"}]', 'https://www.irs.gov/instructions/i1099mec', 'Form 1099-NEC (Rev. December 2026)', 'irs_1099_nec_2026'`,
      );
      expect(ok.affectedRows).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // C. Forms
  // --------------------------------------------------------------------------

  describe("tax forms", () => {
    const start = (determination: string) =>
      asUser(db, f.cyUser, () =>
        db.query<{ id: string }>(
          `insert into public.tax_forms (association_id, form_code, tax_year, determination, determination_reason)
           values ($1::uuid, 'irs_1120h', 2026, $2, 'Both tests pass.') returning id`,
          [f.damen, determination],
        ),
      );

    it("accepts 'eligible' — 1120-H is an election, not a requirement", async () => {
      const { rows } = await start("eligible");
      expect(rows[0].id).toMatch(/[0-9a-f-]{36}/);
      await asUser(db, f.cyUser, () => db.query(`delete from public.tax_forms`));
      await expect(start("maybe")).rejects.toThrow(/check/);
    });

    it("records who sent it to the accountant only together with when", async () => {
      const { rows } = await start("eligible");
      await expect(
        asUser(db, f.cyUser, () =>
          db.query(`update public.tax_forms set sent_to_accountant_by = $2::uuid where id = $1::uuid`, [rows[0].id, f.cyUser]),
        ),
      ).rejects.toThrow(/tax_forms_sent_by_needs_when/);
      const ok = await asUser(db, f.cyUser, () =>
        db.query(
          `update public.tax_forms
              set sent_to_accountant_at = now(), sent_to_accountant_by = $2::uuid,
                  sent_snapshot_json = '{"subject": "2158 N. Damen — Form 1120-H 2026: figures for your review", "attachments": ["Form 1120-H 2026 worksheet.xlsx"]}'
            where id = $1::uuid`,
          [rows[0].id, f.cyUser],
        ),
      );
      expect(ok.affectedRows).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // D. The accountant
  // --------------------------------------------------------------------------

  describe("the accountant", () => {
    beforeEach(addPat);

    const accountant = async () => {
      const { rows } = await db.query<{ accountant_person_id: string | null; accountant_firm: string | null }>(
        `select accountant_person_id, accountant_firm from public.associations where id = $1::uuid`,
        [f.damen],
      );
      return rows[0];
    };

    it("a board member sets and clears the accountant; an owner can't", async () => {
      // Bo becomes board_member for this test — the role the RPC needs is
      // board, not board_admin (it's a contact, not an access grant).
      await db.query(
        `insert into public.role_grants (association_id, person_id, role, granted_on) values ($1::uuid, $2::uuid, 'board_member', current_date)`,
        [f.damen, f.boPerson],
      );
      await asUser(db, f.boUser, () =>
        db.query(`select public.set_accountant($1::uuid, $2::uuid, '  Pat & Co CPAs  ')`, [f.damen, PAT]),
      );
      expect(await accountant()).toEqual({ accountant_person_id: PAT, accountant_firm: "Pat & Co CPAs" });

      await expect(
        asUser(db, f.adaUser, () => db.query(`select public.set_accountant($1::uuid, null, null)`, [f.damen])),
      ).rejects.toThrow(/not authorized/);
      await expect(
        asUser(db, f.zaraUser, () => db.query(`select public.set_accountant($1::uuid, $2::uuid, null)`, [f.damen, PAT])),
      ).rejects.toThrow(/not authorized/);
      expect(await accountant()).toEqual({ accountant_person_id: PAT, accountant_firm: "Pat & Co CPAs" });

      // A null person clears the firm too, whatever was passed for it.
      await asUser(db, f.cyUser, () => db.query(`select public.set_accountant($1::uuid, null, 'stale firm')`, [f.damen]));
      expect(await accountant()).toEqual({ accountant_person_id: null, accountant_firm: null });
    });

    it("refuses a person from another association, through the RPC and on a direct update", async () => {
      await expect(
        asUser(db, f.cyUser, () => db.query(`select public.set_accountant($1::uuid, $2::uuid, null)`, [f.damen, f.zaraPerson])),
      ).rejects.toThrow(/different association/);
      // Cy is board_admin, so associations_update lets her write the column
      // directly; the trigger still refuses.
      await expect(
        asUser(db, f.cyUser, () =>
          db.query(`update public.associations set accountant_person_id = $2::uuid where id = $1::uuid`, [f.damen, f.zaraPerson]),
        ),
      ).rejects.toThrow(/different association/);
      expect(await accountant()).toEqual({ accountant_person_id: null, accountant_firm: null });
    });

    it("won't redact a person while they're the accountant", async () => {
      await asUser(db, f.cyUser, () => db.query(`select public.set_accountant($1::uuid, $2::uuid, 'Pat & Co')`, [f.damen, PAT]));
      await expect(
        asUser(db, f.cyUser, () => db.query(`select public.redact_person($1::uuid)`, [PAT])),
      ).rejects.toThrow(/recorded as your tax accountant/);

      await asUser(db, f.cyUser, () => db.query(`select public.set_accountant($1::uuid, null, null)`, [f.damen]));
      await asUser(db, f.cyUser, () => db.query(`select public.redact_person($1::uuid)`, [PAT]));
      const { rows } = await db.query<{ full_name: string; email: string | null }>(
        `select full_name, email from public.persons where id = $1::uuid`,
        [PAT],
      );
      expect(rows[0]).toEqual({ full_name: "Former member", email: null });
    });
  });

  // --------------------------------------------------------------------------
  // D. Filing settings
  // --------------------------------------------------------------------------

  describe("filing settings", () => {
    const settings = async () => {
      const { rows } = await db.query<{ information_returns_filing: string | null; il_sos_file_number: string | null }>(
        `select information_returns_filing, il_sos_file_number from public.associations where id = $1::uuid`,
        [f.damen],
      );
      return rows[0];
    };

    it("a board member records how 1099s are filed and the SOS file number, trimmed", async () => {
      await asUser(db, f.cyUser, () =>
        db.query(`select public.set_tax_filing_settings($1::uuid, 'paper', '  6543-210-1 ')`, [f.damen]),
      );
      expect(await settings()).toEqual({ information_returns_filing: "paper", il_sos_file_number: "6543-210-1" });
      await asUser(db, f.cyUser, () => db.query(`select public.set_tax_filing_settings($1::uuid, 'electronic', '')`, [f.damen]));
      expect(await settings()).toEqual({ information_returns_filing: "electronic", il_sos_file_number: null });
      // "Not sure yet" is null, never a third value.
      await asUser(db, f.cyUser, () => db.query(`select public.set_tax_filing_settings($1::uuid, null, null)`, [f.damen]));
      expect(await settings()).toEqual({ information_returns_filing: null, il_sos_file_number: null });
    });

    it("refuses an unknown filing method, and a caller who isn't board", async () => {
      await expect(
        asUser(db, f.cyUser, () => db.query(`select public.set_tax_filing_settings($1::uuid, 'fax', null)`, [f.damen])),
      ).rejects.toThrow(/paper/);
      await expect(
        asUser(db, f.adaUser, () => db.query(`select public.set_tax_filing_settings($1::uuid, 'paper', null)`, [f.damen])),
      ).rejects.toThrow(/not authorized/);
      await expect(
        asUser(db, f.niaUser, () => db.query(`select public.set_tax_filing_settings($1::uuid, 'paper', null)`, [f.damen])),
      ).rejects.toThrow(/not authorized/);
      // The column's own CHECK holds even for a direct write.
      await expect(
        db.query(`update public.associations set information_returns_filing = 'fax' where id = $1::uuid`, [f.damen]),
      ).rejects.toThrow(/check/);
      expect(await settings()).toEqual({ information_returns_filing: null, il_sos_file_number: null });
    });
  });

  // --------------------------------------------------------------------------
  // F. Tax parameters
  // --------------------------------------------------------------------------

  describe("tax parameters", () => {
    it("ends the $600 1099-NEC threshold at 2026-01-01 and starts $2,000 there, unverified and cited", async () => {
      const { rows } = await db.query<{
        numeric_value: string;
        effective_from: string;
        effective_to: string | null;
        verified_on: string | null;
        source_url: string;
      }>(
        `select numeric_value::text, effective_from::text, effective_to::text, verified_on::text, source_url
           from public.tax_parameters where key = 'form_1099_nec_threshold' order by effective_from`,
      );
      expect(rows).toEqual([
        {
          numeric_value: "600.000000",
          effective_from: "2020-01-01",
          effective_to: "2026-01-01",
          verified_on: null,
          source_url: "https://www.irs.gov/forms-pubs/about-form-1099-nec",
        },
        {
          numeric_value: "2000.000000",
          effective_from: "2026-01-01",
          effective_to: null,
          verified_on: null,
          source_url: "https://www.irs.gov/instructions/i1099mec",
        },
      ]);
    });

    it("resolves as of December 31 of the payment year, half-open at the boundary", async () => {
      // The predicate every reader uses (data.ts, compute_and_save_tax_filing).
      const asOf = async (date: string) => {
        const { rows } = await db.query<{ numeric_value: string }>(
          `select numeric_value::text from public.tax_parameters
            where key = 'form_1099_nec_threshold'
              and effective_from <= $1::date and (effective_to is null or effective_to > $1::date)`,
          [date],
        );
        return rows.map((r) => r.numeric_value);
      };
      expect(await asOf("2025-12-31")).toEqual(["600.000000"]);
      expect(await asOf("2026-01-01")).toEqual(["2000.000000"]);
      expect(await asOf("2026-12-31")).toEqual(["2000.000000"]);
    });

    it("only a platform admin marks a rule checked, and it changes nothing but verified_on", async () => {
      const { rows } = await db.query<{ id: string }>(
        `select id from public.tax_parameters where key = 'form_1099_nec_threshold' and effective_to is null`,
      );
      const id = rows[0].id;
      await expect(
        asUser(db, f.cyUser, () => db.query(`select public.verify_tax_parameter($1::uuid)`, [id])),
      ).rejects.toThrow(/not authorized/);
      // Still select-only through the API, even for a platform admin.
      await makePlatformAdmin(f.cyUser);
      const direct = await asUser(db, f.cyUser, () =>
        db.query(`update public.tax_parameters set verified_on = current_date where id = $1::uuid`, [id]),
      );
      expect(direct.affectedRows).toBe(0);

      await asUser(db, f.cyUser, () => db.query(`select public.verify_tax_parameter($1::uuid)`, [id]));
      const { rows: after } = await db.query<{ numeric_value: string; checked_today: boolean }>(
        `select numeric_value::text, verified_on = current_date as checked_today from public.tax_parameters where id = $1::uuid`,
        [id],
      );
      expect(after[0]).toEqual({ numeric_value: "2000.000000", checked_today: true });
      await expect(
        asUser(db, f.cyUser, () => db.query(`select public.verify_tax_parameter('00000000-0000-0000-0000-000000000000'::uuid)`)),
      ).rejects.toThrow(/not found/);
    });
  });

  // --------------------------------------------------------------------------
  // G. Platform admin requires MFA
  // --------------------------------------------------------------------------

  describe("platform admin at aal1", () => {
    it("is_platform_admin() is false without MFA, even with the row, so global writes are refused", async () => {
      await makePlatformAdmin(f.cyUser);
      const flag = (aal: "aal1" | "aal2") =>
        asUser(
          db,
          f.cyUser,
          async () => (await db.query<{ is_platform_admin: boolean }>(`select public.is_platform_admin()`)).rows[0].is_platform_admin,
          { aal },
        );
      expect(await flag("aal2")).toBe(true);
      expect(await flag("aal1")).toBe(false);

      await expect(
        asUser(
          db,
          f.cyUser,
          () =>
            db.query(
              `insert into public.tax_form_links (form_code, kind, label, url, retrieved_on)
               values ('irs_1120h', 'guidance', 'x', 'https://www.irs.gov/x', current_date)`,
            ),
          { aal: "aal1" },
        ),
      ).rejects.toThrow(/row-level security/);
      const { rows } = await db.query<{ id: string }>(`select id from public.tax_parameters limit 1`);
      await expect(
        asUser(db, f.cyUser, () => db.query(`select public.verify_tax_parameter($1::uuid)`, [rows[0].id]), { aal: "aal1" }),
      ).rejects.toThrow(/not authorized/);
    });
  });

  // --------------------------------------------------------------------------
  // H. compute_and_save_tax_filing as of the fiscal year end
  // --------------------------------------------------------------------------

  describe("compute_and_save_tax_filing", () => {
    beforeEach(async () => {
      // A future change to the specific deduction: $100 through 2026, $150
      // from 2027. Today (the old as-of) is before the change; a fiscal year
      // ending in 2027 is after it.
      await db.query(
        `update public.tax_parameters set effective_to = '2027-01-01'
          where key = 'form_1120h_specific_deduction' and effective_to is null`,
      );
      await db.query(
        `insert into public.tax_parameters (key, numeric_value, effective_from, source_url, notes)
         values ('form_1120h_specific_deduction', 150.00, '2027-01-01', 'https://www.irs.gov/forms-pubs/about-form-1120-h', 'test-only future value')`,
      );
      await db.query(
        `insert into public.fiscal_years (id, association_id, label, starts_on, ends_on) values
           ($1::uuid, $2::uuid, '2027', '2027-01-01', '2027-12-31'),
           ($3::uuid, $4::uuid, '2026', '2026-01-01', '2026-12-31')`,
        [FY_2027, f.damen, HOYNE_FY, f.hoyne],
      );
    });

    const snapshotFor = async (fiscalYearId: string) => {
      const { rows } = await asUser(db, f.cyUser, () =>
        db.query<{ compute_and_save_tax_filing: string }>(`select public.compute_and_save_tax_filing($1::uuid, $2::uuid)`, [
          f.damen,
          fiscalYearId,
        ]),
      );
      const filingId = rows[0].compute_and_save_tax_filing;
      const { rows: filing } = await db.query<{
        parameters_snapshot: { key: string; numeric_value: string; as_of: string }[];
        formula: string;
      }>(
        `select tf.parameters_snapshot,
                (select formula_description from public.tax_figure_provenance
                  where filing_id = tf.id and figure_key = 'taxable_income') as formula
           from public.tax_filings tf where tf.id = $1::uuid`,
        [filingId],
      );
      return filing[0];
    };

    it("reads the parameters as of the fiscal year end, not today, and says so in the snapshot", async () => {
      const fy2026 = await snapshotFor(FY_2026);
      expect(fy2026.parameters_snapshot).toHaveLength(4);
      expect(fy2026.parameters_snapshot.every((p) => p.as_of === "2026-12-31")).toBe(true);
      expect(Number(fy2026.parameters_snapshot.find((p) => p.key === "form_1120h_specific_deduction")?.numeric_value)).toBe(100);
      expect(fy2026.formula).toContain("specific deduction 100.00");

      const fy2027 = await snapshotFor(FY_2027);
      expect(fy2027.parameters_snapshot).toHaveLength(4);
      expect(fy2027.parameters_snapshot.every((p) => p.as_of === "2027-12-31")).toBe(true);
      expect(Number(fy2027.parameters_snapshot.find((p) => p.key === "form_1120h_specific_deduction")?.numeric_value)).toBe(150);
      expect(fy2027.formula).toContain("specific deduction 150.00");
    });

    it("refuses a fiscal year that isn't this association's", async () => {
      await expect(
        asUser(db, f.cyUser, () => db.query(`select public.compute_and_save_tax_filing($1::uuid, $2::uuid)`, [f.damen, HOYNE_FY])),
      ).rejects.toThrow(/fiscal year not found/);
    });
  });
});
