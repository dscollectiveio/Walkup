import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";
import { addVendors, boBoard, EXTRA, pgError, queries, seededDb, zaraBoard } from "./repairs-helpers";

/**
 * Migration 0056, spreadsheet import (import-spec section 14.1). Rows are
 * staged the way the application stages them (mapped values only), then the
 * database validates, previews, commits and undoes.
 */

const CASH = "acc00000-0000-0000-0000-000000001000";
const AR = "acc00000-0000-0000-0000-000000001200";
const A4000 = "acc00000-0000-0000-0000-000000004000";
const RESERVE_CASH = "acc00000-0000-0000-0000-000000001010";
const LATE_AR = "acc00000-0000-0000-0000-000000001250";
const CAPITAL = "acc00000-0000-0000-0000-000000001500";
const PAYABLE = "acc00000-0000-0000-0000-000000002000";
const EQ_OP = "acc00000-0000-0000-0000-000000003000";
const EQ_RES = "acc00000-0000-0000-0000-000000003100";
const INTEREST = "acc00000-0000-0000-0000-000000004100";
const REPAIRS = "acc00000-0000-0000-0000-000000005020";
const PENALTIES = "acc00000-0000-0000-0000-000000005950";
const OPERATING = "ffff0000-0000-0000-0000-000000000001";
const RESERVE = "ffff0000-0000-0000-0000-000000000002";
const FY2026 = "f1500000-0000-0000-0000-000000000001";
const FY2025 = "f1500000-0000-0000-0000-000000000002";
const FY2024 = "f1500000-0000-0000-0000-000000000003";
const BOARD_USER = "dddd0000-0000-0000-0000-000000000012";

type Summary = {
  counts: { rows: number; ok: number; errors: number; duplicates: number; skipped: number };
  batch_errors: { field: string; code: string; message: string }[];
  digest: string;
  money_in: string;
  money_out: string;
  debits: string | null;
  credits: string | null;
  unit_total: string | null;
  by_account: Record<string, { account: string; type: string; exempt: boolean | null; count: number; total: string }>;
  new_units: number;
  existing_units: number;
  new_people: number;
  owners_assigned: number;
  dues_plans: number;
  percent_total?: string | null;
  created?: number;
  amendment_id?: string;
};

describe("imports (0056)", () => {
  let db: PGlite;
  let f: Fixture;
  const { q, one, rows, count } = queries(() => db);
  let seq = 0;
  const sha = () => (++seq).toString(16).padStart(64, "0");

  beforeEach(async () => {
    ({ db, f } = await seededDb());
    await db.exec(`
      insert into accounts (id, association_id, code, name, type, is_cash_account, is_exempt_function_income, is_exempt_expenditure) values
        ('${RESERVE_CASH}', '${f.damen}', '1010', 'Reserve Cash', 'asset', true, null, null),
        ('${LATE_AR}', '${f.damen}', '1250', 'Late Fees Receivable', 'asset', false, null, null),
        ('${CAPITAL}', '${f.damen}', '1500', 'Building Improvements', 'asset', false, null, true),
        ('${PAYABLE}', '${f.damen}', '2000', 'Accounts Payable', 'liability', false, null, null),
        ('${EQ_OP}', '${f.damen}', '3000', 'Operating Fund Balance', 'equity', false, null, null),
        ('${EQ_RES}', '${f.damen}', '3100', 'Reserve Fund Balance', 'equity', false, null, null),
        ('${INTEREST}', '${f.damen}', '4100', 'Interest Income', 'income', false, false, null),
        ('${REPAIRS}', '${f.damen}', '5020', 'Repairs & Maintenance', 'expense', false, null, true),
        ('${PENALTIES}', '${f.damen}', '5950', 'Penalties', 'expense', false, null, false);
      insert into fiscal_years (id, association_id, label, starts_on, ends_on) values
        ('${FY2025}', '${f.damen}', '2025', '2025-01-01', '2025-12-31'),
        ('${FY2024}', '${f.damen}', '2024', '2024-01-01', '2024-12-31');
      update fiscal_years set status = 'closed', closed_at = now() where id = '${FY2024}';
      insert into auth.users (id, email) values ('${BOARD_USER}', 'board@example.test');
    `);
    // Bo is a board member; the board user exists only to be a plain extra login.
    await boBoard(db, f);
  });
  afterEach(async () => {
    await db.close();
  });

  // --- helpers --------------------------------------------------------------

  type Row = Record<string, string>;
  const start = (user: string | null, kind: string, n: number, opts: { sha?: string; doc?: string | null; assoc?: string } = {}) =>
    q<{ id: string }>(
      user,
      `select public.import_start($1::uuid, $2, 'file.csv', $3, $4::uuid, $5) as id`,
      [opts.assoc ?? f.damen, kind, opts.sha ?? sha(), opts.doc ?? null, n],
    );

  async function stage(
    kind: string,
    data: Row[],
    options: Record<string, unknown> = {},
    opts: { user?: string; sha?: string } = {},
  ): Promise<{ id: string; summary: Summary }> {
    const user = opts.user ?? f.cyUser;
    const id = (await start(user, kind, data.length, { sha: opts.sha })).rows[0].id;
    const payload = data.map((m, i) => ({ row_number: i + 1, raw: m, mapped: m, errors: [] }));
    await q(user, `select public.import_stage_rows($1::uuid, $2::jsonb)`, [id, JSON.stringify(payload)]);
    await q(user, `select public.import_set_options($1::uuid, '{}'::jsonb, $2::jsonb)`, [id, JSON.stringify(options)]);
    return { id, summary: await validate(id, user) };
  }
  const validate = async (id: string, user: string = f.cyUser) =>
    (await one<{ s: Summary }>(user, `select public.import_validate($1::uuid) as s`, [id])).s;
  const setOptions = (id: string, options: Record<string, unknown>) =>
    q(f.cyUser, `select public.import_set_options($1::uuid, null, $2::jsonb)`, [id, JSON.stringify(options)]);
  const commit = (id: string, digest: string, user: string = f.cyUser) =>
    one<{ s: Summary }>(user, `select public.import_commit($1::uuid, $2) as s`, [id, digest]).then((r) => r.s);
  const undo = (id: string, user: string = f.cyUser) => q(user, `select public.import_undo($1::uuid)`, [id]);
  const rowsOf = (id: string) =>
    rows<{ row_number: number; status: string; errors: { code: string }[]; mapped: Row; raw: Row | null; created_table: string | null; created_id: string | null }>(
      null,
      `select row_number, status, errors, mapped, raw, created_table, created_id from public.import_rows where batch_id = $1::uuid order by row_number`,
      [id],
    );
  const codes = async (id: string) => (await rowsOf(id)).map((r) => r.errors.map((e) => e.code));
  const batchCodes = (s: Summary) => s.batch_errors.map((e) => e.code);
  const batchStatus = async (id: string) => (await one<{ status: string }>(null, `select status from public.import_batches where id = $1::uuid`, [id])).status;

  const txOptions = (extra: Record<string, unknown> = {}) => ({
    cash_account_id: CASH,
    default_fund_id: OPERATING,
    mapping_confirmed: true,
    account_map: { repairs: REPAIRS, "regular assessments": A4000, interest: INTEREST, loan: PAYABLE },
    ...extra,
  });
  const tx = (over: Row = {}): Row => ({
    date: "2026-03-14",
    description: "Boiler repair",
    amount: "-450.00",
    category_key: "Repairs",
    ...over,
  });
  const trialBalanceOk = async () => {
    const r = await one<{ d: string; c: string }>(null, `select coalesce(sum(debit),0)::text d, coalesce(sum(credit),0)::text c from public.journal_lines`);
    expect(r.d).toBe(r.c);
  };

  // --- access ---------------------------------------------------------------

  describe("access", () => {
    it("1. import_start works for a board admin and is refused to everyone else", async () => {
      const ok = await start(f.cyUser, "contractors", 1);
      expect(ok.rows[0].id).toBeTruthy();
      for (const [who, user] of [["board member", f.boUser], ["owner", f.adaUser], ["live accountant", f.niaUser], ["expired accountant", f.vicUser]] as const) {
        const e = await pgError(start(user, "contractors", 1));
        expect(e.code, who).toBe("42501");
      }
      // Another association's admin.
      await zaraBoard(db, f);
      expect((await pgError(start(f.zaraUser, "contractors", 1))).code).toBe("42501");
      // A session that has not passed MFA.
      const aal1 = await pgError(
        asUser(db, f.cyUser, () => db.query(`select public.import_start($1::uuid, 'contractors', 'f.csv', $2, null, 1)`, [f.damen, sha()]), { aal: "aal1" }),
      );
      expect(aal1.code).toBe("42501");
    });

    it("2. board members read their batches and rows; owners, the accountant and other associations read none", async () => {
      const { id } = await stage("contractors", [{ name: "Acme Plumbing" }]);
      expect(await count(`select 1 from public.import_batches`)).toBe(1);
      expect((await rows(f.cyUser, `select id from public.import_batches`)).length).toBe(1);
      expect((await rows(f.boUser, `select id from public.import_batches`)).length).toBe(1);
      expect((await rows(f.boUser, `select id from public.import_rows where batch_id = $1::uuid`, [id])).length).toBe(1);
      await zaraBoard(db, f);
      for (const user of [f.adaUser, f.niaUser, f.vicUser, f.zaraUser]) {
        expect((await rows(user, `select id from public.import_batches`)).length).toBe(0);
        expect((await rows(user, `select id from public.import_rows`)).length).toBe(0);
      }
    });

    it("3. no role can insert, update or delete batches or rows directly", async () => {
      const { id } = await stage("contractors", [{ name: "Acme Plumbing" }]);
      const insertBatch = await pgError(
        q(f.cyUser, `insert into public.import_batches (association_id, kind, filename, file_sha256, row_count) values ($1::uuid, 'contractors', 'x.csv', $2, 1)`, [f.damen, sha()]),
      );
      expect(insertBatch.message).toMatch(/row-level security/i);
      const insertRow = await pgError(
        q(f.cyUser, `insert into public.import_rows (association_id, batch_id, row_number) values ($1::uuid, $2::uuid, 99)`, [f.damen, id]),
      );
      expect(insertRow.message).toMatch(/row-level security/i);
      for (const user of [f.cyUser, f.boUser]) {
        expect((await q(user, `update public.import_batches set status = 'committed' where id = $1::uuid returning id`, [id])).rows).toEqual([]);
        expect((await q(user, `update public.import_rows set status = 'ok' where batch_id = $1::uuid returning id`, [id])).rows).toEqual([]);
        expect((await q(user, `delete from public.import_batches where id = $1::uuid returning id`, [id])).rows).toEqual([]);
        expect((await q(user, `delete from public.import_rows where batch_id = $1::uuid returning id`, [id])).rows).toEqual([]);
      }
      expect(await batchStatus(id)).toBe("validated");
    });

    it("4. the import functions are not executable by anon, and the internal helpers not by authenticated", async () => {
      const fns = await rows<{ fn: string; name: string; anon: boolean; auth: boolean; secdef: boolean; cfg: string[] | null }>(
        null,
        `select p.oid::regprocedure::text fn, p.proname name,
                has_function_privilege('anon', p.oid, 'execute') anon,
                has_function_privilege('authenticated', p.oid, 'execute') auth,
                p.prosecdef secdef, p.proconfig cfg
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and (p.proname like 'import\\_%' or p.proname = 'tg_import_same_association')`,
      );
      expect(fns.length).toBeGreaterThanOrEqual(19);
      expect(fns.filter((x) => x.anon).map((x) => x.fn)).toEqual([]);
      expect(fns.filter((x) => !(x.cfg ?? []).some((c) => c.startsWith("search_path="))).map((x) => x.fn)).toEqual([]);
      const internal = ["import_fiscal_year", "import_err", "import_row_key", "import_uuid", "import_expire_stale"]; // the last is service_role only (REVIEW-1 #17)
      expect(fns.filter((x) => internal.includes(x.name) && x.auth).map((x) => x.fn)).toEqual([]);
      const callable = fns.filter((x) => !internal.includes(x.name));
      expect(callable.filter((x) => !x.auth).map((x) => x.fn)).toEqual([]);
    });

    it("5. a staged row whose batch is in another association raises 42501", async () => {
      const { id } = await stage("contractors", [{ name: "Acme" }]);
      const e = await pgError(
        db.query(`insert into public.import_rows (association_id, batch_id, row_number) values ($1::uuid, $2::uuid, 50)`, [f.hoyne, id]),
      );
      expect(e.code).toBe("42501");
      const doc = await pgError(
        db.query(
          `insert into public.import_batches (association_id, kind, filename, file_sha256, row_count, source_document_id)
           select $1::uuid, 'contractors', 'x.csv', $2, 1, d.id from (select gen_random_uuid() id) d`,
          [f.hoyne, sha()],
        ),
      );
      expect(doc.code).toBe("42501");
    });

    it("a batch of another association cannot be touched by a board admin of this one", async () => {
      await zaraBoard(db, f);
      const { id } = await stage("contractors", [{ name: "Acme" }]);
      for (const sql of [
        `select public.import_validate($1::uuid)`,
        `select public.import_cancel($1::uuid)`,
        `select public.import_set_options($1::uuid, null, '{}'::jsonb)`,
        `select public.import_stage_rows($1::uuid, '[]'::jsonb)`,
        `select public.import_skip_problem_rows($1::uuid)`,
        `select public.import_undo($1::uuid)`,
        `select public.import_commit($1::uuid, 'x')`,
      ]) {
        expect((await pgError(q(f.zaraUser, sql, [id]))).code, sql).toBe("42501");
      }
    });
  });

  // --- lifecycle ------------------------------------------------------------

  describe("lifecycle", () => {
    it("6. staging caps, closed batches, the sixth open batch and a committed file", async () => {
      const id = (await start(f.cyUser, "contractors", 2)).rows[0].id;
      const many = Array.from({ length: 501 }, (_, i) => ({ row_number: i + 1, mapped: { name: `n${i}` } }));
      expect((await pgError(q(f.cyUser, `select public.import_stage_rows($1::uuid, $2::jsonb)`, [id, JSON.stringify(many)]))).message).toMatch(/at most 500/);
      const three = [1, 2, 3].map((n) => ({ row_number: n, mapped: { name: `n${n}` } }));
      expect((await pgError(q(f.cyUser, `select public.import_stage_rows($1::uuid, $2::jsonb)`, [id, JSON.stringify(three)]))).message).toMatch(/more rows than the file had/);
      await q(f.cyUser, `select public.import_cancel($1::uuid)`, [id]);
      expect((await pgError(q(f.cyUser, `select public.import_stage_rows($1::uuid, '[]'::jsonb)`, [id]))).message).toMatch(/closed/);

      // Five open batches is the cap (one was just cancelled, so four are open here).
      for (let i = 0; i < 5; i++) await start(f.cyUser, "contractors", 1);
      const sixth = await pgError(start(f.cyUser, "contractors", 1));
      expect(sixth).toMatchObject({ code: "53400", hint: "too_many_open" });

      // A committed file cannot be started again; the hint names the earlier batch.
      await db.exec(`update public.import_batches set status = 'cancelled' where status = 'uploaded'`);
      const s = sha();
      const { id: first, summary } = await stage("contractors", [{ name: "Acme" }], {}, { sha: s });
      await commit(first, summary.digest);
      const again = await pgError(start(f.cyUser, "contractors", 1, { sha: s }));
      expect(again.code).toBe("23505");
      expect(again.hint).toBe(`already_imported:${first}`);
    });

    it("7. validate refuses while rows are missing", async () => {
      const id = (await start(f.cyUser, "contractors", 2)).rows[0].id;
      await q(f.cyUser, `select public.import_stage_rows($1::uuid, $2::jsonb)`, [id, JSON.stringify([{ row_number: 1, mapped: { name: "A" } }])]);
      const e = await pgError(q(f.cyUser, `select public.import_validate($1::uuid)`, [id]));
      expect(e).toMatchObject({ code: "22023", hint: "rows_missing" });
    });

    it("8. changing the options resets validated rows to pending and clears the digest", async () => {
      const { id } = await stage("contractors", [{ name: "A" }, { name: "B" }]);
      expect(await batchStatus(id)).toBe("validated");
      await setOptions(id, {});
      expect(await batchStatus(id)).toBe("uploaded");
      expect((await one<{ digest: string | null }>(null, `select digest from public.import_batches where id = $1::uuid`, [id])).digest).toBeNull();
      expect((await rowsOf(id)).map((r) => r.status)).toEqual(["pending", "pending"]);
    });

    it("9. fixing a row clears its complaints; skipping excludes it from the digest and the commit; skip-all-problems skips exactly the errors", async () => {
      const staged = await stage("contractors", [
        { name: "Good Co" },
        { name: "", email: "x@y.co" },
        { name: "Bad Mail", email: "not an email" },
      ]);
      expect(staged.summary.counts).toMatchObject({ ok: 1, errors: 2 });
      // A parse complaint on a row is superseded by a typed fix.
      const parseId = (await start(f.cyUser, "contractors", 1)).rows[0].id;
      await q(f.cyUser, `select public.import_stage_rows($1::uuid, $2::jsonb)`, [
        parseId,
        JSON.stringify([{ row_number: 1, mapped: { name: "Parse Co" }, errors: [{ field: "name", code: "parse_formula", message: "formula" }] }]),
      ]);
      expect((await validate(parseId)).counts.errors).toBe(1);
      const [{ id: rowId }] = await rows<{ id: string }>(null, `select id from public.import_rows where batch_id = $1::uuid`, [parseId]);
      await q(f.cyUser, `select public.import_update_row($1::uuid, '{"name":"Parse Co 2"}'::jsonb)`, [rowId]);
      expect((await validate(parseId)).counts).toMatchObject({ ok: 1, errors: 0 });

      const digestBefore = staged.summary.digest;
      const skipped = (await one<{ n: number }>(f.cyUser, `select public.import_skip_problem_rows($1::uuid) as n`, [staged.id])).n;
      expect(skipped).toBe(2);
      const after = await validate(staged.id);
      expect(after.counts).toMatchObject({ ok: 1, errors: 0, skipped: 2 });
      // The digest covers the rows that will be written. The skipped ones were errors, never in it.
      expect(digestBefore).toMatch(/^[0-9a-f]{64}$/);
      expect(after.digest).toBe(digestBefore);
      expect((await rowsOf(staged.id)).map((r) => r.status)).toEqual(["ok", "skipped", "skipped"]);
      // Skipping the one row that WILL be written changes what a commit would do, so it changes the digest.
      const [okRow] = await rows<{ id: string }>(null, `select id from public.import_rows where batch_id = $1::uuid order by row_number`, [staged.id]);
      await q(f.cyUser, `select public.import_set_row_decision($1::uuid, 'skip')`, [okRow.id]);
      const withoutOk = await validate(staged.id);
      expect(withoutOk.counts.ok).toBe(0);
      expect(withoutOk.digest).not.toBe(after.digest);
      await q(f.cyUser, `select public.import_set_row_decision($1::uuid, 'import')`, [okRow.id]);
      expect((await validate(staged.id)).digest).toBe(after.digest);
      // Including a row again puts it back into play.
      const [, second] = await rows<{ id: string }>(null, `select id from public.import_rows where batch_id = $1::uuid order by row_number`, [staged.id]);
      await q(f.cyUser, `select public.import_set_row_decision($1::uuid, 'import')`, [second.id]);
      expect((await validate(staged.id)).counts).toMatchObject({ errors: 1, skipped: 1 });
      expect((await pgError(q(f.cyUser, `select public.import_set_row_decision($1::uuid, 'maybe')`, [second.id]))).message).toMatch(/unknown decision/);
    });

    it("10. cancelling nulls raw and mapped and closes the batch; a committed batch cannot be cancelled", async () => {
      const { id } = await stage("contractors", [{ name: "Acme", phone: "312-555-0100" }]);
      await q(f.cyUser, `select public.import_cancel($1::uuid)`, [id]);
      const [r] = await rowsOf(id);
      expect(r.raw).toBeNull();
      expect(r.mapped).toEqual({});
      expect(await batchStatus(id)).toBe("cancelled");
      const { id: id2, summary } = await stage("contractors", [{ name: "Acme" }]);
      await commit(id2, summary.digest);
      expect((await pgError(q(f.cyUser, `select public.import_cancel($1::uuid)`, [id2]))).message).toMatch(/not been committed/);
    });
  });

  // --- transactions ---------------------------------------------------------

  describe("transactions", () => {
    it("11. an unmapped category, an unmapped fund, an unknown unit and an unknown payee mapping are errors", async () => {
      const unmapped = await stage("transactions", [tx({ category_key: "Plumbing" }), tx({ category_key: "" })], txOptions());
      expect(await codes(unmapped.id)).toEqual([["category_unmapped"], ["category_missing"]]);

      const noFund = await stage("transactions", [tx()], { ...txOptions(), default_fund_id: undefined });
      expect(batchCodes(noFund.summary)).toContain("fund_missing");
      expect(await codes(noFund.id)).toEqual([["fund_unmapped"]]);

      const unit = await stage("transactions", [tx({ unit_label: "Unit 99" })], txOptions());
      expect(await codes(unit.id)).toEqual([["unit_unknown"]]);

      const payee = await stage("transactions", [tx({ payee: "Ghost Co" })], txOptions({ payee_map: { "ghost co": "99999999-9999-9999-9999-999999999999" } }));
      expect(await codes(payee.id)).toEqual([["payee_unknown"]]);
    });

    it("12. wrong sign, a cash account as the category and a receivable are refused", async () => {
      const staged = await stage(
        "transactions",
        [
          tx({ amount: "450.00" }), // money in to an expense
          tx({ amount: "-100.00", category_key: "Regular Assessments" }), // money out of income
          tx({ category_key: "Bank" }),
          tx({ category_key: "Receivable" }),
          tx({ category_key: "Late receivable" }),
        ],
        txOptions({ account_map: { repairs: REPAIRS, "regular assessments": A4000, bank: RESERVE_CASH, receivable: AR, "late receivable": LATE_AR } }),
      );
      expect(await codes(staged.id)).toEqual([["sign_expense"], ["sign_income"], ["transfer_not_supported"], ["ar_not_allowed"], ["ar_not_allowed"]]);
    });

    it("13. a date without a fiscal year and a date in a closed year are refused; an open year passes", async () => {
      const staged = await stage(
        "transactions",
        [tx({ date: "2019-05-01" }), tx({ date: "2024-06-01" }), tx({ date: "2025-06-01" }), tx({ date: "2026-02-30" }), tx({ amount: "12.345" })],
        txOptions(),
      );
      expect(await codes(staged.id)).toEqual([["fiscal_year_missing"], ["fiscal_year_closed"], [], ["date_bad"], ["amount_bad"]]);
    });

    it("14. the mapping must be confirmed, and the cash account must be a cash account of this association", async () => {
      const unconfirmed = await stage("transactions", [tx()], txOptions({ mapping_confirmed: false }));
      expect(batchCodes(unconfirmed.summary)).toEqual(["mapping_unconfirmed"]);
      await setOptions(unconfirmed.id, txOptions({ cash_account_id: AR }));
      expect(batchCodes(await validate(unconfirmed.id))).toEqual(["cash_account_missing"]);
      await setOptions(unconfirmed.id, txOptions({ cash_account_id: RESERVE_CASH }));
      expect(batchCodes(await validate(unconfirmed.id))).toEqual([]);
      // An account of another association is never accepted.
      await db.exec(`
        insert into accounts (id, association_id, code, name, type, is_cash_account)
        values ('acc00000-0000-0000-0000-0000000f0001', '${f.hoyne}', '1000', 'Hoyne Cash', 'asset', true)`);
      await setOptions(unconfirmed.id, txOptions({ cash_account_id: "acc00000-0000-0000-0000-0000000f0001" }));
      expect(batchCodes(await validate(unconfirmed.id))).toEqual(["cash_account_missing"]);
      await setOptions(unconfirmed.id, txOptions({ account_map: { repairs: "acc00000-0000-0000-0000-0000000f0001" } }));
      expect(await codes(unconfirmed.id)).toEqual([[]]);
      await validate(unconfirmed.id);
      expect(await codes(unconfirmed.id)).toEqual([["category_unmapped"]]);
    });

    it("15. after a committed opening balance, rows on or before its date are before_opening", async () => {
      const open = await stage(
        "opening_accounts",
        [
          { account_key: "1000", fund_key: "Operating", debit: "1000.00" },
          { account_key: "3000", fund_key: "Operating", credit: "1000.00" },
        ],
        { as_of: "2025-12-31" },
      );
      await commit(open.id, open.summary.digest);
      const staged = await stage("transactions", [tx({ date: "2025-12-31" }), tx({ date: "2025-12-30" }), tx({ date: "2026-01-02" })], txOptions());
      expect(await codes(staged.id)).toEqual([["before_opening"], ["before_opening"], []]);
    });

    it("16. commit: expense via record_expense, income with a unit, a capital item; entries balanced and traceable", async () => {
      await db.exec(`insert into public.vendors (id, association_id, name) values ('${EXTRA.damenVendor}', '${f.damen}', 'Acme Plumbing')`);
      const staged = await stage(
        "transactions",
        [
          tx({ payee: "Acme Plumbing" }),
          tx({ description: "March dues, Unit 2", amount: "750.00", category_key: "Regular Assessments", unit_label: "unit 2", date: "2026-03-05" }),
          tx({ description: "New boiler", amount: "-8000.00", category_key: "Boiler asset", date: "2026-03-20" }),
          tx({ description: "Bank interest", amount: "3.10", category_key: "Interest", date: "2026-03-31" }),
          tx({ description: "Loan received", amount: "5000.00", category_key: "Loan", date: "2026-03-31" }),
        ],
        txOptions({
          payee_map: { "acme plumbing": EXTRA.damenVendor },
          account_map: { repairs: REPAIRS, "regular assessments": A4000, "boiler asset": CAPITAL, interest: INTEREST, loan: PAYABLE },
        }),
      );
      expect(staged.summary.counts).toMatchObject({ ok: 5, errors: 0 });
      expect(staged.summary).toMatchObject({ money_in: "5753.10", money_out: "8450.00" });
      expect(staged.summary.by_account[REPAIRS]).toMatchObject({ count: 1, total: "450.00", exempt: true, type: "expense" });
      expect(staged.summary.by_account[INTEREST]).toMatchObject({ exempt: false });

      const done = await commit(staged.id, staged.summary.digest);
      expect(done.created).toBe(5);
      expect(await batchStatus(staged.id)).toBe("committed");

      // The expense went through record_expense: an expenses row with the payee, 1099 services.
      const exp = await rows<{ amount: string; vendor_id: string | null; is_capitalized: boolean; account_id: string; memo: string }>(
        null,
        `select amount::text, vendor_id, is_capitalized, account_id, memo from public.expenses order by paid_on`,
      );
      expect(exp).toEqual([
        { amount: "450.00", vendor_id: EXTRA.damenVendor, is_capitalized: false, account_id: REPAIRS, memo: "Boiler repair" },
        { amount: "8000.00", vendor_id: null, is_capitalized: true, account_id: CAPITAL, memo: "New boiler" },
      ]);

      // The dues deposit: two lines, the unit on both, Dr cash Cr income.
      const lines = await rows<{ account_id: string; unit_id: string | null; debit: string; credit: string; source: string; source_id: string | null }>(
        null,
        `select l.account_id, l.unit_id, l.debit::text, l.credit::text, e.source, e.source_id
           from public.journal_lines l join public.journal_entries e on e.id = l.journal_entry_id
          where e.memo = 'March dues, Unit 2' order by l.debit desc`,
      );
      expect(lines).toEqual([
        { account_id: CASH, unit_id: f.unit2, debit: "750.00", credit: "0.00", source: "import", source_id: staged.id },
        { account_id: A4000, unit_id: f.unit2, debit: "0.00", credit: "750.00", source: "import", source_id: staged.id },
      ]);
      // Non-expense rows are source 'import' tied to the batch.
      expect(await count(`select 1 from public.journal_entries where source = 'import' and source_id = '${staged.id}'`)).toBe(3);

      // The deposit shows up in the cash-basis receipts as a direct receipt of the chosen account.
      const rec = await rows<{ basis: string; amount: string; is_exempt: boolean; income_account_id: string }>(
        null,
        `select basis, amount::text, is_exempt, income_account_id from public.cash_basis_receipts where received_on = '2026-03-05'`,
      );
      expect(rec).toEqual([{ basis: "direct", amount: "750.00", is_exempt: true, income_account_id: A4000 }]);
      // The capital item counts as a disbursement (90% numerator).
      expect(
        await count(`select 1 from public.cash_basis_disbursements where account_id = '${CAPITAL}' and amount = 8000`),
      ).toBe(1);
      await trialBalanceOk();
      // The budget actuals saw the repair.
      const actuals = await one<{ n: number }>(null, `select count(*)::int n from public.expenses e where e.account_id = '${REPAIRS}' and e.fund_id = '${OPERATING}'`);
      expect(actuals.n).toBe(1);
    });

    it("17. tax consequences: exempt income and exempt spending count, taxable income does not, liabilities do neither", async () => {
      const figures = async () =>
        one<{ exempt_income: string; nonexempt_income: string; exempt_expenditures: string; total_expenditures: string }>(
          f.cyUser,
          `select * from public.form_1120h_figures($1::uuid, $2::uuid)`,
          [f.damen, FY2026],
        );
      const before = await figures();
      const staged = await stage(
        "transactions",
        [
          tx({ description: "Assessment", amount: "1000.00", category_key: "Regular Assessments" }),
          tx({ description: "Interest", amount: "20.00", category_key: "Interest" }),
          tx({ description: "Repair", amount: "-300.00", category_key: "Repairs" }),
          tx({ description: "Penalty", amount: "-40.00", category_key: "Penalties" }),
          tx({ description: "Loan", amount: "5000.00", category_key: "Loan" }),
          tx({ description: "Loan payment", amount: "-500.00", category_key: "Loan" }),
        ],
        txOptions({ account_map: { repairs: REPAIRS, "regular assessments": A4000, interest: INTEREST, penalties: PENALTIES, loan: PAYABLE } }),
      );
      await commit(staged.id, staged.summary.digest);
      const after = await figures();
      const d = (k: keyof typeof after) => (Number(after[k]) - Number(before[k])).toFixed(2);
      expect(d("exempt_income")).toBe("1000.00");
      expect(d("nonexempt_income")).toBe("20.00");
      // The loan payment is a credit to cash against a liability: no expense or asset leg, so no expenditure.
      expect(d("exempt_expenditures")).toBe("300.00");
      expect(d("total_expenditures")).toBe("340.00");
    });

    it("18. the digest: a changed option, a new unit, a wrong digest and a stale one all refuse", async () => {
      const staged = await stage("transactions", [tx()], txOptions());
      // Wrong digest.
      expect(await pgError(q(f.cyUser, `select public.import_commit($1::uuid, 'nope')`, [staged.id]))).toMatchObject({ code: "22023", hint: "preview_stale" });
      // An option changed after validation: the batch is back to 'uploaded', so the old digest is stale.
      await setOptions(staged.id, txOptions({ default_fund_id: RESERVE }));
      expect(await pgError(q(f.cyUser, `select public.import_commit($1::uuid, $2)`, [staged.id, staged.summary.digest]))).toMatchObject({ hint: "preview_stale" });
      const fresh = await validate(staged.id);
      // A unit added between preview and commit makes it stale.
      await db.exec(`insert into public.units (association_id, label, sort_order) values ('${f.damen}', 'Unit 9', 9)`);
      expect(await pgError(q(f.cyUser, `select public.import_commit($1::uuid, $2)`, [staged.id, fresh.digest]))).toMatchObject({ hint: "preview_stale" });
      const again = await validate(staged.id);
      // A year closing since the preview does too.
      await db.exec(`update public.fiscal_years set status = 'closed', closed_at = now() where id = '${FY2025}'`);
      expect(await pgError(q(f.cyUser, `select public.import_commit($1::uuid, $2)`, [staged.id, again.digest]))).toMatchObject({ hint: "preview_stale" });
      // Re-validated, it commits.
      const last = await validate(staged.id);
      await commit(staged.id, last.digest);
      expect(await batchStatus(staged.id)).toBe("committed");
    });

    it("18b. batch problems and an empty import refuse at commit", async () => {
      const unconfirmed = await stage("transactions", [tx()], txOptions({ mapping_confirmed: false }));
      expect(await pgError(q(f.cyUser, `select public.import_commit($1::uuid, $2)`, [unconfirmed.id, unconfirmed.summary.digest]))).toMatchObject({ hint: "batch_errors" });
      const empty = await stage("transactions", [tx({ category_key: "Unknown" })], txOptions());
      expect(await pgError(q(f.cyUser, `select public.import_commit($1::uuid, $2)`, [empty.id, empty.summary.digest]))).toMatchObject({ hint: "nothing" });
    });

    it("19. identical rows both import; the same rows in a new file are duplicates; only new rows import; the same bytes are refused", async () => {
      const row = tx();
      const first = await stage("transactions", [row, row, tx({ description: "Paint", amount: "-80.00", date: "2026-04-01" })], txOptions());
      expect(first.summary.counts).toMatchObject({ ok: 3, duplicates: 0 });
      const hashes = await rows<{ row_hash: string }>(null, `select row_hash from public.import_rows where batch_id = '${first.id}'`);
      expect(new Set(hashes.map((h) => h.row_hash)).size).toBe(3);
      await commit(first.id, first.summary.digest);

      // An overlapping re-export: three old rows, two new.
      const second = await stage(
        "transactions",
        [row, row, tx({ description: "Paint", amount: "-80.00", date: "2026-04-01" }), tx({ description: "Glass", amount: "-60.00", date: "2026-04-10" }), tx({ description: "Glass", amount: "-60.00", date: "2026-04-10" })],
        txOptions(),
      );
      expect(second.summary.counts).toMatchObject({ ok: 2, duplicates: 3 });
      await commit(second.id, second.summary.digest);
      expect(await count(`select 1 from public.expenses`)).toBe(5);
      // A third copy of the same row in a later file is new (occurrence 3), as a real third payment would be.
      const third = await stage("transactions", [row, row, row], txOptions());
      expect(third.summary.counts).toMatchObject({ ok: 1, duplicates: 2 });
    });

    it("19b. a row already in the books (typed by hand) is flagged, can be skipped or marked separate, and an undone entry does not count", async () => {
      const expense = (on: string, amount: number) =>
        q(f.cyUser, `select public.record_expense($1::uuid, $2::uuid, $3::date, $4::numeric, $5::uuid, $6::uuid, $7::uuid)`, [f.damen, FY2026, on, amount, OPERATING, CASH, REPAIRS]);
      await expense("2026-03-14", 450);
      const figs = async () =>
        (await one<{ total: string }>(f.cyUser, `select total_expenditures::text as total from public.form_1120h_figures($1::uuid, $2::uuid)`, [f.damen, FY2026])).total;
      expect(await figs()).toBe("450.00");

      const staged = await stage("transactions", [tx(), tx({ description: "Paint", amount: "-80.00", date: "2026-04-01" })], txOptions());
      expect(await codes(staged.id)).toEqual([["already_in_books"], []]);
      expect(staged.summary.counts).toMatchObject({ ok: 1, errors: 1 });
      // skipping it keeps the tax figure at the real spending (450 + 80, not 900 + 80)
      await q(f.cyUser, `select public.import_skip_problem_rows($1::uuid)`, [staged.id]);
      const again = await validate(staged.id);
      await commit(staged.id, again.digest);
      expect(await figs()).toBe("530.00");

      // "This is a separate transaction" lets the same date and amount through
      const second = await stage("transactions", [tx({ description: "Boiler repair, second visit" })], txOptions());
      expect(await codes(second.id)).toEqual([["already_in_books"]]);
      const [row] = await rows<{ id: string }>(null, `select id from public.import_rows where batch_id = '${second.id}'`);
      await q(f.cyUser, `select public.import_update_row($1::uuid, '{"confirmed_separate":"true"}'::jsonb)`, [row.id]);
      const ok = await validate(second.id);
      expect(ok.counts).toMatchObject({ ok: 1, errors: 0 });
      await commit(second.id, ok.digest);
      expect(await figs()).toBe("980.00");
    });

    it("19c. cash with a different amount or date, an expense on another day, and an entry that was undone are not 'already in the books'", async () => {
      const id = (await one<{ id: string }>(f.cyUser,
        `select public.record_expense($1::uuid, $2::uuid, '2026-03-14', 450, $3::uuid, $4::uuid, $5::uuid) as id`,
        [f.damen, FY2026, OPERATING, CASH, REPAIRS])).id;
      const staged = await stage("transactions", [tx({ amount: "-450.01" }), tx({ date: "2026-03-15" }), tx({ amount: "450.00", category_key: "Regular Assessments", description: "Deposit" })], txOptions());
      // same amount but money IN on that day is not the same transaction as money OUT
      expect(await codes(staged.id)).toEqual([[], [], []]);
      // undo the hand-typed entry: the import may bring it back
      const entry = (await one<{ journal_entry_id: string }>(null, `select journal_entry_id from public.expenses limit 1`)).journal_entry_id;
      expect(id).toBeTruthy();
      await q(f.cyUser, `select public.reverse_journal_entry($1::uuid)`, [entry]);
      const back = await stage("transactions", [tx()], txOptions());
      expect(await codes(back.id)).toEqual([[]]);
      // reversing the reversal brings the original back, and the row is a repeat again
      const rev = (await one<{ id: string }>(null, `select id from public.journal_entries where reverses_entry_id = '${entry}'`)).id;
      await q(f.cyUser, `select public.reverse_journal_entry($1::uuid)`, [rev]);
      const dup = await stage("transactions", [tx()], txOptions());
      expect(await codes(dup.id)).toEqual([["already_in_books"]]);
    });

    it("19d. a bank-feed transaction waiting to be posted counts as already there", async () => {
      await db.exec(`
        insert into public.bank_connections (id, association_id, institution_name, plaid_item_id, created_by)
        values ('b0000000-0000-0000-0000-0000000000c1', '${f.damen}', 'Test Bank', 'item-1', '${f.cyUser}')`);
      await db.exec(`
        insert into public.bank_transactions (association_id, bank_connection_id, plaid_transaction_id, posted_on, amount, description)
        values ('${f.damen}', 'b0000000-0000-0000-0000-0000000000c1', 'tx-1', '2026-03-14', -450.00, 'BOILER CO')`);
      const staged = await stage("transactions", [tx()], txOptions());
      expect(await codes(staged.id)).toEqual([["already_in_bank_feed"]]);
    });

    it("20. a failure on the last row writes nothing and leaves the batch validated", async () => {
      const staged = await stage("transactions", [tx(), tx({ description: "Second", date: "2026-03-15" }), tx({ description: "boom", date: "2026-03-16" })], txOptions());
      await db.exec(`
        create function public.zz_explode() returns trigger language plpgsql as $$ begin
          if new.memo = 'boom' then raise exception 'forced failure'; end if; return new; end $$;
        create trigger zz_explode before insert on public.expenses for each row execute function public.zz_explode();
      `);
      const e = await pgError(q(f.cyUser, `select public.import_commit($1::uuid, $2)`, [staged.id, staged.summary.digest]));
      expect(e.message).toMatch(/forced failure/);
      expect(await count(`select 1 from public.expenses`)).toBe(0);
      expect(await count(`select 1 from public.journal_entries where memo in ('Boiler repair','Second','boom')`)).toBe(0);
      expect(await batchStatus(staged.id)).toBe("validated");
      expect((await rowsOf(staged.id)).map((r) => r.status)).toEqual(["ok", "ok", "ok"]);
    });

    it("21. undo reverses every entry, removes expenses, frees the file, and refuses a closed year or a linked expense", async () => {
      const s = sha();
      const staged = await stage(
        "transactions",
        [tx(), tx({ description: "Dues", amount: "300.00", category_key: "Regular Assessments", unit_label: "Unit 1" })],
        txOptions(),
        { sha: s },
      );
      await commit(staged.id, staged.summary.digest);
      const entryIds = await rows<{ id: string }>(
        null,
        `select e.id from public.journal_entries e where e.memo in ('Boiler repair', 'Dues')`,
      );
      expect(entryIds.length).toBe(2);

      await undo(staged.id);
      expect(await batchStatus(staged.id)).toBe("undone");
      expect((await rowsOf(staged.id)).map((r) => r.status)).toEqual(["undone", "undone"]);
      expect(await count(`select 1 from public.expenses`)).toBe(0);
      // Each original has exactly one reversal partner, and every account nets to zero.
      for (const { id } of entryIds) {
        expect(await count(`select 1 from public.journal_entries where reverses_entry_id = '${id}'`)).toBe(1);
      }
      const net = await rows<{ account_id: string; net: string }>(
        null,
        `select l.account_id, sum(l.debit - l.credit)::text net
           from public.journal_lines l join public.journal_entries e on e.id = l.journal_entry_id
          where e.memo in ('Boiler repair', 'Dues', 'Reversal: Boiler repair', 'Reversal: Dues') group by 1`,
      );
      expect(net.every((n) => Number(n.net) === 0)).toBe(true);
      await trialBalanceOk();
      // The file hash is free again and the same file can be staged once more.
      expect((await start(f.cyUser, "transactions", 1, { sha: s })).rows[0].id).toBeTruthy();
      // An undone batch cannot be undone twice.
      expect((await pgError(undo(staged.id))).message).toMatch(/only a committed import/);

      // A closed year blocks the undo and leaves everything as it was.
      const closing = await stage("transactions", [tx({ date: "2025-05-01", description: "Old repair" })], txOptions());
      await commit(closing.id, closing.summary.digest);
      await db.exec(`update public.fiscal_years set status = 'closed', closed_at = now() where id = '${FY2025}'`);
      expect(await pgError(undo(closing.id))).toMatchObject({ code: "22023", hint: "year_closed" });
      expect(await batchStatus(closing.id)).toBe("committed");
      expect(await count(`select 1 from public.expenses where memo = 'Old repair'`)).toBe(1);

      // Something now depends on an imported expense: refused, nothing changes.
      const linked = await stage("transactions", [tx({ description: "Linked repair", date: "2026-05-02" })], txOptions());
      await commit(linked.id, linked.summary.digest);
      const exp = await one<{ id: string }>(null, `select id from public.expenses where memo = 'Linked repair'`);
      await db.query(
        `insert into public.ticket_board_details (ticket_id, association_id, expense_id) values ($2::uuid, $3::uuid, $1::uuid)
         on conflict (ticket_id) do update set expense_id = excluded.expense_id`,
        [exp.id, f.ticketCommon, f.damen],
      );
      expect(await pgError(undo(linked.id))).toMatchObject({ code: "22023", hint: "in_use" });
      expect(await batchStatus(linked.id)).toBe("committed");
      expect(await count(`select 1 from public.expenses where memo = 'Linked repair'`)).toBe(1);
      expect(await count(`select 1 from public.journal_entries where memo = 'Reversal: Linked repair'`)).toBe(0);
    });
  });

  // --- opening balances -----------------------------------------------------

  describe("opening balances", () => {
    const accountRows = (over: Row[] = []): Row[] => [
      { account_key: "1000", fund_key: "Operating", debit: "18400.00" },
      { account_key: "1010", fund_key: "Reserve", debit: "52000.00" },
      { account_key: "Accounts Payable", fund_key: "Operating", credit: "1200.00" },
      { account_key: "3000", fund_key: "Operating", credit: "17200.00" },
      { account_key: "3100", fund_key: "Reserve", credit: "52000.00" },
      ...over,
    ];

    it("22. account file rules: balance, line count, account types, receivables, unknown fund, debit and credit together", async () => {
      const unbalanced = await stage(
        "opening_accounts",
        [{ account_key: "1000", fund_key: "Operating", debit: "5000.00" }, { account_key: "3000", fund_key: "Operating", credit: "4000.00" }],
        { as_of: "2025-12-31" },
      );
      expect(unbalanced.summary.batch_errors.map((e) => e.code)).toEqual(["unbalanced"]);
      expect(unbalanced.summary.batch_errors[0].message).toContain("Debits are 5000.00 and credits are 4000.00");

      const one1 = await stage("opening_accounts", [{ account_key: "1000", fund_key: "Operating", debit: "5000.00" }], { as_of: "2025-12-31" });
      expect(batchCodes(one1.summary)).toEqual(expect.arrayContaining(["too_few"]));

      const bad = await stage(
        "opening_accounts",
        [
          { account_key: "4000", fund_key: "Operating", credit: "10.00" },
          { account_key: "5020", fund_key: "Operating", debit: "10.00" },
          { account_key: "1200", fund_key: "Operating", debit: "10.00" },
          { account_key: "1250", fund_key: "Operating", debit: "10.00" },
          { account_key: "Nothing", fund_key: "Operating", debit: "10.00" },
          { account_key: "1000", fund_key: "Mystery", debit: "10.00" },
          { account_key: "1000", fund_key: "Operating", debit: "10.00", credit: "10.00" },
          { account_key: "1000", fund_key: "Operating" },
        ],
        { as_of: "2025-12-31" },
      );
      expect(await codes(bad.id)).toEqual([
        ["account_type"], ["account_type"], ["ar_not_allowed"], ["ar_not_allowed"], ["account_unknown"], ["fund_unknown"], ["amount_bad"], ["amount_bad"],
      ]);
    });

    it("23. commit posts one entry on the as-of date; entries_exist, missing and closed years are refused; one accounts batch at a time", async () => {
      const staged = await stage("opening_accounts", accountRows(), { as_of: "2025-12-31" });
      expect(staged.summary).toMatchObject({ debits: "70400.00", credits: "70400.00" });
      expect(staged.summary.batch_errors).toEqual([]);
      const done = await commit(staged.id, staged.summary.digest);
      expect(done.created).toBe(5);
      const entries = await rows<{ id: string; entry_date: string; fiscal_year_id: string; source: string; n: number }>(
        null,
        `select e.id, e.entry_date::text, e.fiscal_year_id, e.source, (select count(*)::int from public.journal_lines l where l.journal_entry_id = e.id) n
           from public.journal_entries e where e.source_id = '${staged.id}'`,
      );
      expect(entries).toEqual([{ id: expect.any(String), entry_date: "2025-12-31", fiscal_year_id: FY2025, source: "import", n: 5 }]);
      await trialBalanceOk();

      // A second committed accounts batch is refused by the unique index, and allowed again after undo.
      const second = await stage("opening_accounts", accountRows(), { as_of: "2025-12-30" });
      const e = await pgError(commit(second.id, second.summary.digest));
      expect(e.code).toBe("23505");
      await undo(staged.id);
      // (2025-12-30 now has no entries on or before it: only the reversed pair at 2025-12-31.)
      const retry = await validate(second.id);
      await commit(second.id, retry.digest);

      // entries_exist: the fixture's 2026-01-01 entry blocks a 2026 as-of; missing and closed years are named.
      await undo(second.id);
      const late = await stage("opening_accounts", accountRows(), { as_of: "2026-06-30" });
      expect(batchCodes(late.summary)).toContain("entries_exist");
      const none = await stage("opening_accounts", accountRows(), { as_of: "2019-12-31" });
      expect(batchCodes(none.summary)).toContain("fiscal_year_missing");
      const closed = await stage("opening_accounts", accountRows(), { as_of: "2024-12-31" });
      expect(batchCodes(closed.summary)).toContain("fiscal_year_closed");
      const noDate = await stage("opening_accounts", accountRows(), {});
      expect(batchCodes(noDate.summary)).toContain("as_of_missing");
    });

    it("24. unit balances become charges that credit the chosen income account, and a later payment counts under it", async () => {
      const units = [{ unit_label: "Unit 2", amount: "750.00" }, { unit_label: "unit 1", amount: "150.00" }];
      const opts = { as_of: "2025-12-31", income_account_id: A4000, ar_account_id: AR, fund_id: OPERATING };

      const wrong = await stage("opening_units", units, { ...opts, income_account_id: EQ_OP, ar_account_id: CASH });
      expect(batchCodes(wrong.summary)).toEqual(expect.arrayContaining(["income_account_missing", "ar_account_missing"]));
      const badRows = await stage("opening_units", [{ unit_label: "Unit 99", amount: "5.00" }, { unit_label: "Unit 1", amount: "0" }, { unit_label: "Unit 1", amount: "-5.00" }], opts);
      expect(await codes(badRows.id)).toEqual([["unit_unknown"], ["amount_bad"], ["amount_bad"]]);

      const staged = await stage("opening_units", units, opts);
      expect(staged.summary).toMatchObject({ unit_total: "900.00", counts: { ok: 2 } });
      await commit(staged.id, staged.summary.digest);

      const charges = await rows<{ charge_type: string; amount: string; due_on: string; memo: string; unit_id: string }>(
        null,
        `select c.charge_type::text, c.amount::text, c.due_on::text, e.memo, c.unit_id
           from public.assessment_charges c join public.journal_entries e on e.id = c.journal_entry_id
          where e.entry_date = '2025-12-31' order by c.amount desc`,
      );
      expect(charges).toEqual([
        { charge_type: "other", amount: "750.00", due_on: "2025-12-31", memo: "Balance carried forward", unit_id: f.unit2 },
        { charge_type: "other", amount: "150.00", due_on: "2025-12-31", memo: "Balance carried forward", unit_id: f.unit1 },
      ]);
      // The statement shows what was carried forward as owed.
      const summary = await one<{ owed: string }>(f.cyUser, `select owed from public.unit_statement_summary($1::uuid, '2026-02-01')`, [f.unit2]);
      expect(Number(summary.owed)).toBeGreaterThanOrEqual(750);

      // A payment applied to the carried-forward charge is a receipt of the chosen income account.
      const charge = await one<{ id: string }>(null, `select id from public.assessment_charges where amount = 750 and unit_id = '${f.unit2}' and due_on = '2025-12-31'`);
      await q(f.cyUser, `select public.record_payment($1::uuid, $2::uuid, $3::uuid, '2026-02-10', 750, $4::uuid, $5::uuid, $6::uuid, 'check', null, $7::jsonb)`, [
        f.damen, f.unit2, FY2026, OPERATING, CASH, AR, JSON.stringify([{ charge_id: charge.id, amount: 750 }]),
      ]);
      const receipt = await rows<{ basis: string; amount: string; income_account_id: string; is_exempt: boolean }>(
        null,
        `select basis, amount::text, income_account_id, is_exempt from public.cash_basis_receipts where received_on = '2026-02-10'`,
      );
      expect(receipt).toEqual([{ basis: "assessment", amount: "750.00", income_account_id: A4000, is_exempt: true }]);
    });

    it("25. undo of unit balances refuses once a payment is applied, and works before", async () => {
      const opts = { as_of: "2025-12-31", income_account_id: A4000, ar_account_id: AR, fund_id: OPERATING };
      const staged = await stage("opening_units", [{ unit_label: "Unit 2", amount: "750.00" }], opts);
      await commit(staged.id, staged.summary.digest);
      const charge = await one<{ id: string }>(null, `select id from public.assessment_charges where due_on = '2025-12-31'`);
      await q(f.cyUser, `select public.record_payment($1::uuid, $2::uuid, $3::uuid, '2026-02-10', 100, $4::uuid, $5::uuid, $6::uuid, 'check', null, $7::jsonb)`, [
        f.damen, f.unit2, FY2026, OPERATING, CASH, AR, JSON.stringify([{ charge_id: charge.id, amount: 100 }]),
      ]);
      expect(await pgError(undo(staged.id))).toMatchObject({ code: "22023", hint: "in_use" });
      expect(await count(`select 1 from public.assessment_charges where due_on = '2025-12-31'`)).toBe(1);

      const clean = await stage("opening_units", [{ unit_label: "Unit 1", amount: "20.00" }], opts);
      // Only one committed unit-balances batch at a time.
      expect((await pgError(commit(clean.id, clean.summary.digest))).code).toBe("23505");
    });
  });

  // --- units and owners -----------------------------------------------------

  describe("units and owners", () => {
    const uo = (over: Row = {}): Row => ({ unit_label: "Unit 7", owner_name: "Dee Park", email: "dee@example.test", ...over });
    const opts = (extra: Record<string, unknown> = {}) => ({ effective_from: "2026-01-01", ...extra });

    it("26. a new unit, person, link and plan; the person has no login and no role", async () => {
      const staged = await stage("units_owners", [uo({ phone: "312-555-0142", dues_amount: "350.00" })], opts({ dues_frequency: "monthly", dues_starts_on: "2026-11-01" }));
      expect(staged.summary).toMatchObject({ new_units: 1, new_people: 1, owners_assigned: 1, dues_plans: 1 });
      await commit(staged.id, staged.summary.digest);
      const person = await one<{ id: string; auth_user_id: string | null; phone: string }>(null, `select id, auth_user_id, phone from public.persons where email = 'dee@example.test'`);
      expect(person.auth_user_id).toBeNull();
      expect(person.phone).toBe("312-555-0142");
      expect(await count(`select 1 from public.role_grants where person_id = '${person.id}'`)).toBe(0);
      expect(await count(`select 1 from public.unit_owners uo join public.units u on u.id = uo.unit_id where u.label = 'Unit 7' and uo.person_id = '${person.id}' and uo.effective_to is null`)).toBe(1);
      const plan = await one<{ frequency: string; total_amount: string; annual_amount: string; allocation_method: string; note: string; starts_on: string; unit_id: string }>(
        null,
        `select frequency, total_amount::text, annual_amount::text, allocation_method, note, starts_on::text, unit_id from public.assessment_schedules where name = 'Unit 7 dues'`,
      );
      expect(plan).toMatchObject({ frequency: "monthly", total_amount: "350.00", annual_amount: "4200.00", allocation_method: "fixed_per_unit", note: "Imported", starts_on: "2026-11-01" });
    });

    it("27. people match by email case-insensitively and keep their name; no email always creates a new person; two rows are co-owners", async () => {
      const staged = await stage(
        "units_owners",
        [
          { unit_label: "Unit 1", owner_name: "Ada O.", email: "ADA@example.test" },
          { unit_label: "Unit 8", owner_name: "Sam Lee" },
          { unit_label: "Unit 9", owner_name: "Sam Lee" },
          { unit_label: "Unit 10", owner_name: "Kim Ho", email: "kim@example.test" },
          { unit_label: "Unit 10", owner_name: "Lou Ho", email: "lou@example.test" },
        ],
        opts(),
      );
      expect(staged.summary.counts).toMatchObject({ ok: 5, errors: 0 });
      await commit(staged.id, staged.summary.digest);
      expect((await one<{ full_name: string }>(null, `select full_name from public.persons where id = '${f.adaPerson}'`)).full_name).toBe("Ada Okonkwo");
      expect(await count(`select 1 from public.persons where full_name = 'Sam Lee'`)).toBe(2);
      expect(await count(`select 1 from public.persons where association_id = '${f.damen}' and lower(email) = 'ada@example.test'`)).toBe(1);
      expect(await count(`select 1 from public.unit_owners uo join public.units u on u.id = uo.unit_id where u.label = 'Unit 10' and uo.effective_to is null`)).toBe(2);
      // Ada already owns Unit 1: no second link.
      expect(await count(`select 1 from public.unit_owners where unit_id = '${f.unit1}' and person_id = '${f.adaPerson}'`)).toBe(1);
    });

    it("28. a different current owner is a conflict; replacing ends the old link the day before; a co-owner next to a current one is fine", async () => {
      const conflict = await stage("units_owners", [{ unit_label: "unit 1", owner_name: "New Person", email: "new@example.test" }], opts());
      expect(await codes(conflict.id)).toEqual([["owner_conflict"]]);

      const coOwner = await stage(
        "units_owners",
        [
          { unit_label: "Unit 1", owner_name: "Ada Okonkwo", email: "ada@example.test" },
          { unit_label: "Unit 1", owner_name: "Bea Okonkwo", email: "bea@example.test" },
        ],
        opts(),
      );
      expect(coOwner.summary.counts).toMatchObject({ ok: 2, errors: 0 });
      await commit(coOwner.id, coOwner.summary.digest);
      expect(await count(`select 1 from public.unit_owners where unit_id = '${f.unit1}' and effective_to is null`)).toBe(2);

      const replace = await stage("units_owners", [{ unit_label: "Unit 2", owner_name: "Replacement", email: "rep@example.test" }], opts({ replace_owners: true, effective_from: "2026-06-01" }));
      expect(replace.summary.counts).toMatchObject({ ok: 1, errors: 0 });
      await commit(replace.id, replace.summary.digest);
      const links = await rows<{ full_name: string; effective_from: string; effective_to: string | null }>(
        null,
        `select p.full_name, uo.effective_from::text, uo.effective_to::text from public.unit_owners uo join public.persons p on p.id = uo.person_id where uo.unit_id = '${f.unit2}' order by uo.effective_from`,
      );
      expect(links).toEqual([
        { full_name: "Bo Lindqvist", effective_from: "2020-01-01", effective_to: "2026-05-31" },
        { full_name: "Replacement", effective_from: "2026-06-01", effective_to: null },
      ]);
      // Undo brings the previous owner back as the current one.
      await undo(replace.id);
      const back = await rows<{ full_name: string; effective_to: string | null }>(
        null,
        `select p.full_name, uo.effective_to::text from public.unit_owners uo join public.persons p on p.id = uo.person_id where uo.unit_id = '${f.unit2}'`,
      );
      expect(back).toEqual([{ full_name: "Bo Lindqvist", effective_to: null }]);
    });

    it("29. percentages are all or nothing, must sum to 100, and record one amendment with a line per unit", async () => {
      const all = [
        { unit_label: "Unit 1", ownership_percent: "33.333333" },
        { unit_label: "Unit 2", ownership_percent: "33.333333" },
        { unit_label: "Unit 3", ownership_percent: "33.333334" },
      ];
      const drop = (id: string) => q(f.cyUser, `select public.import_cancel($1::uuid)`, [id]);
      const partial = await stage("units_owners", [all[0], all[1]], opts());
      expect(batchCodes(partial.summary)).toEqual(["percent_incomplete"]);
      await drop(partial.id);
      const sum = await stage("units_owners", [{ ...all[0], ownership_percent: "33.3" }, all[1], all[2]], opts());
      expect(batchCodes(sum.summary)).toEqual(["percent_sum"]);
      await drop(sum.id);
      // Thirds to six places add up to 99.999999: the amendment demands exactly 100, so the preview must say so
      const thirds = await stage("units_owners", all.map((r) => ({ ...r, ownership_percent: "33.333333" })), opts());
      expect(batchCodes(thirds.summary)).toEqual(["percent_sum"]);
      expect(thirds.summary.percent_total).toBe("99.999999");
      await drop(thirds.id);
      const conflict = await stage("units_owners", [...all, { unit_label: "Unit 1", ownership_percent: "10" }], opts());
      expect(batchCodes(conflict.summary)).toContain("percent_conflict");
      await drop(conflict.id);
      const bad = await stage("units_owners", [{ unit_label: "Unit 1", ownership_percent: "0" }, { unit_label: "Unit 2", ownership_percent: "101" }, { unit_label: "Unit 3", ownership_percent: "abc" }], opts());
      expect(await codes(bad.id)).toEqual([["percent_bad"], ["percent_bad"], ["percent_bad"]]);
      await drop(bad.id);
      // A new unit has to be covered too.
      const newUnit = await stage("units_owners", [{ unit_label: "Unit 4", ownership_percent: "25" }, ...all.map((r) => ({ ...r, ownership_percent: "25" }))], opts());
      expect(newUnit.summary.batch_errors).toEqual([]);
      await drop(newUnit.id);
      const missingNew = await stage("units_owners", [{ unit_label: "Unit 4" }, ...all.map((r) => ({ ...r, ownership_percent: "33.333333" }))], opts());
      expect(batchCodes(missingNew.summary)).toEqual(["percent_incomplete"]);
      await drop(missingNew.id);

      // "Leave percentages out" records none.
      const before = await count(`select 1 from public.ownership_amendments`);
      const skip = await stage("units_owners", [{ unit_label: "Unit 40", ownership_percent: "5" }], opts({ skip_percentages: true }));
      expect(skip.summary.batch_errors).toEqual([]);
      await commit(skip.id, skip.summary.digest);
      expect(await count(`select 1 from public.ownership_amendments`)).toBe(before);

      // Covering every unit and adding to 100 records one amendment with a line per unit.
      const units = (await rows<{ label: string }>(null, `select label from public.units where association_id = '${f.damen}' order by sort_order, label`)).map((u) => u.label);
      const shares = ["25.000000", "25.000000", "25.000000", "25.000000"];
      expect(units.length).toBe(4);
      const full = await stage("units_owners", units.map((label, i) => ({ unit_label: label, ownership_percent: shares[i] })), opts());
      expect(full.summary.batch_errors).toEqual([]);
      const done = await commit(full.id, full.summary.digest);
      const lines = await rows<{ label: string; percentage: string }>(
        null,
        `select u.label, l.percentage::text from public.ownership_amendment_lines l join public.units u on u.id = l.unit_id where l.amendment_id = '${done.amendment_id}' order by u.label`,
      );
      expect(lines.length).toBe(4);
      expect(lines.every((l) => l.percentage === "25.000000")).toBe(true);
    });

    it("30. a dues plan is created only when the unit has none, per payment, and nothing is charged", async () => {
      await db.exec(`
        insert into public.assessment_schedules (association_id, name, frequency, fund_id, allocation_method, starts_on, unit_id, total_amount, annual_amount)
        values ('${f.damen}', 'Existing', 'monthly', '${OPERATING}', 'fixed_per_unit', '2026-01-01', '${f.unit1}', 100, 1200)`);
      const charges = await count(`select 1 from public.assessment_charges`);
      const staged = await stage(
        "units_owners",
        [
          { unit_label: "Unit 1", dues_amount: "999.00" },
          { unit_label: "Unit 3", dues_amount: "1500.00" },
          { unit_label: "Unit 11", dues_amount: "5400.00" },
        ],
        opts({ dues_frequency: "quarterly" }),
      );
      expect(staged.summary.dues_plans).toBe(2);
      await commit(staged.id, staged.summary.digest);
      const plans = await rows<{ name: string; total_amount: string; annual_amount: string; frequency: string }>(
        null,
        `select name, total_amount::text, annual_amount::text, frequency from public.assessment_schedules order by name`,
      );
      expect(plans).toEqual([
        { name: "Existing", total_amount: "100.00", annual_amount: "1200.00", frequency: "monthly" },
        { name: "Unit 11 dues", total_amount: "5400.00", annual_amount: "21600.00", frequency: "quarterly" },
        { name: "Unit 3 dues", total_amount: "1500.00", annual_amount: "6000.00", frequency: "quarterly" },
      ]);
      expect(await count(`select 1 from public.assessment_charges`)).toBe(charges);
      const yearly = await stage("units_owners", [{ unit_label: "Unit 12", dues_amount: "5400.00" }], opts({ dues_frequency: "annual" }));
      await commit(yearly.id, yearly.summary.digest);
      expect((await one<{ a: string }>(null, `select annual_amount::text a from public.assessment_schedules where name = 'Unit 12 dues'`)).a).toBe("5400.00");
      expect(batchCodes(await stage("units_owners", [uo()], opts({ dues_frequency: "weekly" })).then((s) => s.summary))).toEqual(["frequency_unknown"]);
    });

    it("31. undo removes only what the batch created and refuses when something now depends on a created unit", async () => {
      const staged = await stage(
        "units_owners",
        [{ unit_label: "Unit 1", owner_name: "Ada Okonkwo", email: "ada@example.test" }, uo({ dues_amount: "200.00" })],
        opts(),
      );
      await commit(staged.id, staged.summary.digest);
      await undo(staged.id);
      expect(await batchStatus(staged.id)).toBe("undone");
      expect(await count(`select 1 from public.units where label = 'Unit 7'`)).toBe(0);
      expect(await count(`select 1 from public.persons where email = 'dee@example.test'`)).toBe(0);
      expect(await count(`select 1 from public.assessment_schedules where name = 'Unit 7 dues'`)).toBe(0);
      // Ada and Unit 1 were already there and are untouched.
      expect(await count(`select 1 from public.persons where id = '${f.adaPerson}'`)).toBe(1);
      expect(await count(`select 1 from public.unit_owners where unit_id = '${f.unit1}' and person_id = '${f.adaPerson}'`)).toBe(1);

      const second = await stage("units_owners", [uo({ unit_label: "Unit 20" })], opts());
      await commit(second.id, second.summary.digest);
      const unit = await one<{ id: string }>(null, `select id from public.units where label = 'Unit 20'`);
      await db.query(
        `insert into public.assessment_charges (association_id, unit_id, charge_type, period_start, due_on, amount) values ($1::uuid, $2::uuid, 'assessment', '2026-01-01', '2026-01-01', 10)`,
        [f.damen, unit.id],
      );
      expect(await pgError(undo(second.id))).toMatchObject({ code: "22023", hint: "in_use" });
      expect(await count(`select 1 from public.units where label = 'Unit 20'`)).toBe(1);
      expect(await batchStatus(second.id)).toBe("committed");
    });

    it("31b. undo of a batch with percentages removes its amendment, unless a later one exists", async () => {
      const mk = (a: string, b: string, c: string) => [
        { unit_label: "Unit 1", ownership_percent: a },
        { unit_label: "Unit 2", ownership_percent: b },
        { unit_label: "Unit 3", ownership_percent: c },
      ];
      const first = await stage("units_owners", mk("40", "30", "30"), opts());
      const done = await commit(first.id, first.summary.digest);
      await undo(first.id);
      expect(await count(`select 1 from public.ownership_amendments where id = '${done.amendment_id}'`)).toBe(0);

      const second = await stage("units_owners", mk("50", "25", "25"), opts());
      await commit(second.id, second.summary.digest);
      await q(f.cyUser, `select public.record_ownership_amendment($1::uuid, '2026-07-01', $2::jsonb, 'later', null)`, [
        f.damen,
        JSON.stringify([f.unit1, f.unit2, f.unit3].map((u, i) => ({ unit_id: u, percentage: [20, 40, 40][i] }))),
      ]);
      expect(await pgError(undo(second.id))).toMatchObject({ hint: "in_use" });
    });

    it("32. commit reduces mapped to the unit label or name and nulls raw", async () => {
      const staged = await stage("units_owners", [uo({ phone: "312-555-0142", mailing_address: "PO Box 12" })], opts());
      expect((await rowsOf(staged.id))[0].raw).toMatchObject({ email: "dee@example.test" });
      await commit(staged.id, staged.summary.digest);
      const [r] = await rowsOf(staged.id);
      expect(r.raw).toBeNull();
      expect(Object.keys(r.mapped).sort()).toEqual(["name", "unit_label"]);
      expect(JSON.stringify(r.mapped)).not.toContain("example.test");
      // Hash and status survive for duplicate detection.
      expect(r.status).toBe("committed");
      const again = await stage("units_owners", [uo()], opts());
      expect(again.summary.counts).toMatchObject({ duplicates: 1 });
    });
  });

  // --- contractors ----------------------------------------------------------

  describe("contractors", () => {
    it("33. trades array, duplicates in the file and on file, refused tax IDs, undo deletes the unused and refuses the used", async () => {
      await addVendors(db, { ...f } as Fixture);
      const staged = await stage("contractors", [
        { name: "Acme Plumbing", trade: "Plumbing", email: "SAM@acme.example", website: "acme.example" },
        { name: "acme plumbing" },
        { name: "Damen Plumbing" },
        { name: "No Tax Co", tin: "12-3456789" },
        { name: "" },
        { name: "Roof Pros", trade: "Roofing" },
      ]);
      expect(staged.summary.counts).toMatchObject({ ok: 2, duplicates: 2, errors: 2 });
      expect((await rowsOf(staged.id)).map((r) => r.status)).toEqual(["ok", "duplicate", "duplicate", "error", "error", "ok"]);
      expect((await codes(staged.id))[3]).toEqual(["tin_not_accepted"]);
      await q(f.cyUser, `select public.import_skip_problem_rows($1::uuid)`, [staged.id]);
      const ok = await validate(staged.id);
      const done = await commit(staged.id, ok.digest);
      expect(done.created).toBe(2);
      const v = await one<{ trade: string; trades: string[]; email: string; website_url: string }>(null, `select trade, trades, email, website_url from public.vendors where name = 'Acme Plumbing'`);
      expect(v).toEqual({ trade: "Plumbing", trades: ["plumbing"], email: "sam@acme.example", website_url: "https://acme.example" }); // a bare domain gets https:// (REVIEW-1 #15)
      expect(await count(`select 1 from public.vendors where association_id = '${f.damen}' and name ilike 'acme plumbing'`)).toBe(1);

      // The raw tax-id column never reaches the table, but a stray tin key is also refused by the validator.
      // Undo: unused contractors go.
      const used = await one<{ id: string }>(null, `select id from public.vendors where name = 'Roof Pros'`);
      await db.query(`update public.tickets set assigned_vendor_id = $1::uuid where id = $2::uuid`, [used.id, f.ticketCommon]);
      expect(await pgError(undo(staged.id))).toMatchObject({ hint: "in_use" });
      expect(await count(`select 1 from public.vendors where name = 'Acme Plumbing'`)).toBe(1);
      await db.query(`update public.tickets set assigned_vendor_id = null where id = $1::uuid`, [f.ticketCommon]);
      await undo(staged.id);
      expect(await count(`select 1 from public.vendors where name in ('Acme Plumbing', 'Roof Pros')`)).toBe(0);
      expect(await count(`select 1 from public.vendors where name = 'Damen Plumbing'`)).toBe(1);
    });
  });

  // --- fiscal years and accounts -------------------------------------------

  describe("fiscal years and categories", () => {
    it("34. import_ensure_fiscal_year adds a calendar year, is idempotent, and refuses other year ends, overlaps, strangers and absurd years", async () => {
      const ensure = (user: string | null, year: number, assoc = f.damen) =>
        q<{ id: string }>(user, `select public.import_ensure_fiscal_year($1::uuid, $2) as id`, [assoc, year]);
      const a = (await ensure(f.cyUser, 2023)).rows[0].id;
      const b = (await ensure(f.cyUser, 2023)).rows[0].id;
      expect(a).toBe(b);
      expect(await one(null, `select label, starts_on::text s, ends_on::text e, status::text st from public.fiscal_years where id = '${a}'`)).toEqual({ label: "2023", s: "2023-01-01", e: "2023-12-31", st: "open" });
      expect((await pgError(ensure(f.boUser, 2022))).code).toBe("42501");
      expect((await pgError(ensure(f.adaUser, 2022))).code).toBe("42501");
      expect((await pgError(ensure(f.cyUser, 1980))).message).toMatch(/out of range/);
      expect((await pgError(ensure(f.cyUser, 2100))).message).toMatch(/out of range/);
      await db.exec(`update public.associations set fiscal_year_end_month = 6 where id = '${f.damen}'`);
      expect(await pgError(ensure(f.cyUser, 2022))).toMatchObject({ hint: "fy_not_december" });
      // An existing exact calendar year is still returned for a non-December association.
      expect((await ensure(f.cyUser, 2023)).rows[0].id).toBe(a);
      await db.exec(`update public.associations set fiscal_year_end_month = 12 where id = '${f.damen}'`);
      await db.exec(`insert into public.fiscal_years (association_id, label, starts_on, ends_on) values ('${f.damen}', 'FY21-22', '2021-07-01', '2022-06-30')`);
      expect(await pgError(ensure(f.cyUser, 2021))).toMatchObject({ hint: "fy_overlap" });
    });

    it("35. import_create_account demands an exempt answer, sets the flag exactly, avoids code collisions and is board admin only", async () => {
      const make = (user: string, name: string, type: string, exempt: boolean | null) =>
        q<{ id: string }>(user, `select public.import_create_account($1::uuid, $2, $3, $4::boolean) as id`, [f.damen, name, type, exempt]);
      expect(await pgError(make(f.cyUser, "Pool", "expense", null))).toMatchObject({ code: "22023", hint: "exempt_required" });
      const e1 = (await make(f.cyUser, "Pool Maintenance", "expense", false)).rows[0].id;
      const e2 = (await make(f.cyUser, "Snow", "expense", true)).rows[0].id;
      const i1 = (await make(f.cyUser, "Parking", "income", false)).rows[0].id;
      const i2 = (await make(f.cyUser, "Special levy", "income", true)).rows[0].id;
      const accts = await rows<{ id: string; code: string; type: string; exempt_i: boolean | null; exempt_e: boolean | null; confirmed: boolean }>(
        null,
        `select id, code, type::text, is_exempt_function_income exempt_i, is_exempt_expenditure exempt_e, tax_classification_confirmed_at is not null confirmed
           from public.accounts where id in ('${e1}','${e2}','${i1}','${i2}')`,
      );
      const by = Object.fromEntries(accts.map((a) => [a.id, a]));
      expect(by[e1]).toMatchObject({ type: "expense", exempt_e: false, exempt_i: null, code: "5030" });
      expect(by[e2]).toMatchObject({ type: "expense", exempt_e: true, code: "5040" });
      expect(by[i1]).toMatchObject({ type: "income", exempt_i: false, exempt_e: null, confirmed: true, code: "4110" });
      expect(by[i2]).toMatchObject({ exempt_i: true, code: "4120" });
      expect(new Set(accts.map((a) => a.code)).size).toBe(4);
      expect((await pgError(make(f.cyUser, "A bank", "asset", true))).message).toMatch(/expense or income/);
      expect((await pgError(make(f.cyUser, "   ", "expense", true))).message).toMatch(/1 to 80/);
      expect((await pgError(make(f.boUser, "Pool 2", "expense", true))).code).toBe("42501");
      expect((await pgError(make(f.adaUser, "Pool 2", "expense", true))).code).toBe("42501");
    });
  });


  // --- more of the rules the spec lists ---------------------------------------

  describe("further rules", () => {
    it("email addresses are checked for owners and contractors", async () => {
      const owners = await stage("units_owners", [{ unit_label: "Unit 50", owner_name: "Dee", email: "dee at example" }, { unit_label: "Unit 51", email: "x@example.test" }], { effective_from: "2026-01-01" });
      expect(await codes(owners.id)).toEqual([["email_bad"], ["owner_name_missing"]]);
      const vendors = await stage("contractors", [{ name: "Bad Mail", email: "a b@c" }]);
      expect(await codes(vendors.id)).toEqual([["email_bad"]]);
    });

    it("a payee mapped to another association's contractor is refused", async () => {
      await addVendors(db, { ...f } as Fixture);
      const staged = await stage("transactions", [tx({ payee: "Hoyne Roofing" })], txOptions({ payee_map: { "hoyne roofing": EXTRA.hoyneVendor } }));
      expect(await codes(staged.id)).toEqual([["payee_unknown"]]);
      const ok = await stage("transactions", [tx({ payee: "Damen Plumbing", description: "Pipe" })], txOptions({ payee_map: { "damen plumbing": EXTRA.damenVendor } }));
      expect(await codes(ok.id)).toEqual([[]]);
    });

    it("a fund column maps to funds, and a reserve payment lands in the reserve fund through the reserve cash account", async () => {
      const staged = await stage(
        "transactions",
        [tx({ fund_key: "Reserve", description: "Reserve repair" }), tx({ fund_key: "Mystery", description: "Other", date: "2026-03-15" })],
        txOptions({ cash_account_id: RESERVE_CASH, fund_map: { reserve: RESERVE } }),
      );
      expect(await codes(staged.id)).toEqual([[], ["fund_unmapped"]]);
      await q(f.cyUser, `select public.import_skip_problem_rows($1::uuid)`, [staged.id]);
      const again = await validate(staged.id);
      await commit(staged.id, again.digest);
      const e = await one<{ fund_id: string; account_id: string }>(null, `select e.fund_id, l.account_id from public.expenses e join public.journal_lines l on l.journal_entry_id = e.journal_entry_id and l.credit > 0 where e.memo = 'Reserve repair'`);
      expect(e).toEqual({ fund_id: RESERVE, account_id: RESERVE_CASH });
    });

    it("replacing owners keeps a co-owner the file still lists", async () => {
      await db.exec(`insert into public.persons (id, association_id, full_name, email) values ('eeee0000-0000-0000-0000-0000000000c1', '${f.damen}', 'Co Owner', 'co@example.test')`);
      await db.exec(`insert into public.unit_owners (association_id, unit_id, person_id, effective_from) values ('${f.damen}', '${f.unit2}', 'eeee0000-0000-0000-0000-0000000000c1', '2021-01-01')`);
      const staged = await stage(
        "units_owners",
        [
          { unit_label: "Unit 2", owner_name: "Co Owner", email: "co@example.test" },
          { unit_label: "Unit 2", owner_name: "Newcomer", email: "new@example.test" },
        ],
        { effective_from: "2026-06-01", replace_owners: true },
      );
      expect(staged.summary.counts).toMatchObject({ ok: 2, errors: 0 });
      await commit(staged.id, staged.summary.digest);
      const links = await rows<{ full_name: string; effective_to: string | null }>(
        null,
        `select p.full_name, uo.effective_to::text from public.unit_owners uo join public.persons p on p.id = uo.person_id where uo.unit_id = '${f.unit2}' order by p.full_name`,
      );
      // Bo is replaced; the co-owner and the newcomer are current.
      expect(links).toEqual([
        { full_name: "Bo Lindqvist", effective_to: "2026-05-31" },
        { full_name: "Co Owner", effective_to: null },
        { full_name: "Newcomer", effective_to: null },
      ]);
    });

    it("a contractor imported before is 'Already there' in a later file", async () => {
      const first = await stage("contractors", [{ name: "Acme Plumbing" }, { name: "Bright Electric" }]);
      await commit(first.id, first.summary.digest);
      const second = await stage("contractors", [{ name: "acme plumbing" }, { name: "Bright Electric" }, { name: "New Roofing" }]);
      expect(second.summary.counts).toMatchObject({ ok: 1, duplicates: 2 });
      await commit(second.id, second.summary.digest);
      expect(await count(`select 1 from public.vendors where association_id = '${f.damen}'`)).toBe(3);
    });

    it("the shared trade list slug lands in vendors.trades beside the label", async () => {
      const staged = await stage("contractors", [{ name: "HVAC Pros", trade: "Heating & cooling", trade_slug: "hvac" }]);
      await commit(staged.id, staged.summary.digest);
      expect(await one(null, `select trade, trades from public.vendors where name = 'HVAC Pros'`)).toEqual({ trade: "Heating & cooling", trades: ["hvac"] });
    });

    it("unit balances for the same unit may be imported more than once in a file, but only one set stands at a time", async () => {
      const opts = { as_of: "2025-12-31", income_account_id: A4000, ar_account_id: AR, fund_id: OPERATING };
      const staged = await stage("opening_units", [{ unit_label: "Unit 2", amount: "10.00" }, { unit_label: "Unit 2", amount: "10.00" }], opts);
      expect(staged.summary.counts).toMatchObject({ ok: 2, duplicates: 0 });
    });

    it("a rows file that is staged twice for the same batch is refused beyond its declared size", async () => {
      const id = (await start(f.cyUser, "contractors", 1)).rows[0].id;
      await q(f.cyUser, `select public.import_stage_rows($1::uuid, $2::jsonb)`, [id, JSON.stringify([{ row_number: 1, mapped: { name: "A" } }])]);
      expect((await pgError(q(f.cyUser, `select public.import_stage_rows($1::uuid, $2::jsonb)`, [id, JSON.stringify([{ row_number: 1, mapped: { name: "A" } }])]))).message).toMatch(/more rows than the file had/);
    });

    it("a hostile text in a description is stored as text and never executed", async () => {
      const staged = await stage("transactions", [tx({ description: "=HYPERLINK(\"http://evil\",\"x\")" }), tx({ description: "'; drop table accounts; --", date: "2026-03-20" })], txOptions());
      await commit(staged.id, staged.summary.digest);
      expect(await count(`select 1 from public.expenses where memo like '=HYPERLINK%'`)).toBe(1);
      expect(await count(`select 1 from public.accounts`)).toBeGreaterThan(5);
    });
  });

  // --- lint and migration path ---------------------------------------------

  describe("schema hygiene", () => {
    it("36. every import table has association_id (restrict), RLS and no floating point; the audit trigger is on batches", async () => {
      for (const t of ["import_batches", "import_rows"]) {
        const col = await one<{ n: number }>(null, `select count(*)::int n from information_schema.columns where table_schema='public' and table_name=$1 and column_name='association_id'`, [t]);
        expect(col.n).toBe(1);
        const rls = await one<{ r: boolean }>(null, `select relrowsecurity r from pg_class where oid = ('public.' || $1)::regclass`, [t]);
        expect(rls.r).toBe(true);
        const fk = await one<{ d: string }>(
          null,
          `select confdeltype::text d from pg_constraint where conrelid = ('public.' || $1)::regclass and contype = 'f' and confrelid = 'public.associations'::regclass`,
          [t],
        );
        expect(fk.d).toBe("r"); // restrict
      }
      expect(await count(`select 1 from pg_trigger where tgrelid = 'public.import_batches'::regclass and tgname = 'audit_import_batches'`)).toBe(1);
      const { id } = await stage("contractors", [{ name: "Audit Co" }]);
      expect(await count(`select 1 from public.audit_log where table_name = 'import_batches' and record_id = '${id}'`)).toBeGreaterThan(0);
    });

    it("37. applying 0056 over seeded data leaves existing document links alone and widens the target check", async () => {
      const old = await freshDb({ before: "0056" });
      const o = await seed(old);
      await old.exec(`
        insert into documents (id, association_id, storage_path, filename) values ('d0c00000-0000-0000-0000-000000000001', '${o.damen}', 'x/y.pdf', 'y.pdf');
        insert into document_links (association_id, document_id, target_table, target_id, relation)
        values ('${o.damen}', 'd0c00000-0000-0000-0000-000000000001', 'tickets', '${o.ticketCommon}', 'source'),
               ('${o.damen}', 'd0c00000-0000-0000-0000-000000000001', 'announcements', gen_random_uuid(), 'source');`);
      await old.exec(await readFile(path.resolve(import.meta.dirname, "../../supabase/migrations/0056_imports.sql"), "utf8"));
      expect((await old.query<{ n: number }>(`select count(*)::int n from document_links`)).rows[0].n).toBe(2);
      await old.exec(`insert into document_links (association_id, document_id, target_table, target_id, relation)
        values ('${o.damen}', 'd0c00000-0000-0000-0000-000000000001', 'import_batches', gen_random_uuid(), 'source')`);
      await expect(
        old.exec(`insert into document_links (association_id, document_id, target_table, target_id, relation)
          values ('${o.damen}', 'd0c00000-0000-0000-0000-000000000001', 'nonsense', gen_random_uuid(), 'source')`),
      ).rejects.toThrow();
      // Every earlier target table is still allowed.
      const def = (await old.query<{ d: string }>(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'document_links_target_table_known'`)).rows[0].d;
      for (const t of ["associations", "units", "persons", "vendors", "journal_entries", "expenses", "assessment_charges", "payments", "insurance_policies", "tickets", "recurring_bills", "fiscal_years", "tax_forms", "insurance_quotes", "insurance_claims", "announcements", "import_batches"]) {
        expect(def, t).toContain(`'${t}'`);
      }
      await old.close();
    });

    it("keeps the source document with its batch: a kept copy blocks purging the document", async () => {
      await db.exec(`insert into documents (id, association_id, storage_path, filename) values ('d0c00000-0000-0000-0000-000000000002', '${f.damen}', '${f.damen}/1760000000000-abc123-b.csv', 'b.csv')`);
      const id = (await start(f.cyUser, "contractors", 1, { doc: "d0c00000-0000-0000-0000-000000000002" })).rows[0].id;
      expect(id).toBeTruthy();
      expect((await pgError(db.query(`delete from public.documents where id = 'd0c00000-0000-0000-0000-000000000002'`))).code).toBe("23001");
    });
  });
});
