import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

/**
 * Shared ground for the 0053 (repairs v2) suites: a migrated template so each
 * test starts from a copy instead of replaying every migration, query
 * helpers, and the extra fixtures of repairs-spec §17.1, created inside the
 * tests that need them (the seed file is not changed).
 */

export type PgError = { code?: string; detail?: string; hint?: string; message: string };

/** The error a statement fails with; fails the test if it succeeds. */
export async function pgError(p: Promise<unknown>): Promise<PgError> {
  try {
    await p;
  } catch (e) {
    const x = e as PgError;
    return { code: x.code, detail: x.detail, hint: x.hint, message: x.message };
  }
  throw new Error("expected the statement to fail");
}

let template: File | Blob | undefined;

/** Every migration applied once per test file, then copied per test. Nothing seeded. */
export async function templateDb(): Promise<PGlite> {
  if (!template) {
    const db = await freshDb();
    template = await db.dumpDataDir("none");
    await db.close();
  }
  return PGlite.create({ loadDataDir: template, extensions: { btree_gist } });
}

/** A migrated, seeded database. */
export async function seededDb(): Promise<{ db: PGlite; f: Fixture }> {
  const db = await templateDb();
  const f = await seed(db);
  return { db, f };
}

/** Query helpers bound to a database: `user = null` runs as the superuser (no auth.uid()). */
export function queries(getDb: () => PGlite) {
  const q = <T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []) =>
    user === null ? getDb().query<T>(sql, params) : asUser(getDb(), user, () => getDb().query<T>(sql, params));
  const one = async <T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []) =>
    (await q<T>(user, sql, params)).rows[0];
  const rows = async <T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []) =>
    (await q<T>(user, sql, params)).rows;
  const count = async (sql: string, params: unknown[] = []) =>
    (await one<{ n: number }>(null, `select count(*)::int as n from (${sql}) x`, params)).n;
  return { q, one, rows, count };
}

export const EXTRA = {
  hoyneVendor: "ab000000-0000-0000-0000-000000000001",
  damenVendor: "ab000000-0000-0000-0000-000000000002",
  damenVendor2: "ab000000-0000-0000-0000-000000000003",
  damenDoNotUse: "ab000000-0000-0000-0000-000000000004",
  damenArchived: "ab000000-0000-0000-0000-000000000005",
  hoyneTicket: "ab000000-0000-0000-0000-000000000010",
  hoyneTask: "ab000000-0000-0000-0000-000000000020",
  damenTask: "ab000000-0000-0000-0000-000000000021",
  hoyneFund: "ab000000-0000-0000-0000-000000000030",
  hoyneAccount: "ab000000-0000-0000-0000-000000000031",
  hoyneCash: "ab000000-0000-0000-0000-000000000035",
  hoyneYear: "ab000000-0000-0000-0000-000000000032",
  hoyneEntry: "ab000000-0000-0000-0000-000000000033",
  hoyneExpense: "ab000000-0000-0000-0000-000000000034",
  damenExpenseAccount: "ab000000-0000-0000-0000-000000000040",
  damenEntry: "ab000000-0000-0000-0000-000000000041",
  damenExpense: "ab000000-0000-0000-0000-000000000042",
} as const;

/** Zara becomes Hoyne's board admin, so cross-association cases have a board on both sides. */
export async function zaraBoard(db: PGlite, f: Fixture): Promise<void> {
  await db.query(
    `insert into public.role_grants (association_id, person_id, role, granted_on) values ($1::uuid, $2::uuid, 'board_admin', '2024-01-01')`,
    [f.hoyne, f.zaraPerson],
  );
}

/** Bo becomes a Damen board member (limited write, no deletes). */
export async function boBoard(db: PGlite, f: Fixture, grantedOn: string | null = null): Promise<void> {
  await db.query(
    `insert into public.role_grants (association_id, person_id, role, granted_on)
     values ($1::uuid, $2::uuid, 'board_member', coalesce($3::date, current_date))`,
    [f.damen, f.boPerson, grantedOn],
  );
}

/** Contractors: one in Hoyne, two in Damen, a Damen do-not-use and an archived Damen one. */
export async function addVendors(db: PGlite, f: Fixture): Promise<void> {
  await db.query(
    `insert into public.vendors (id, association_id, name, trades, status, do_not_use_reason, archived_at)
     values ($1::uuid, $6::uuid, 'Hoyne Roofing', '{roofing}', 'okay', null, null),
            ($2::uuid, $7::uuid, 'Damen Plumbing', '{plumbing}', 'preferred', null, null),
            ($3::uuid, $7::uuid, 'Lakeside Heating', '{hvac}', 'okay', null, null),
            ($4::uuid, $7::uuid, 'Never Again Co', '{plumbing}', 'do_not_use', 'No-show twice', null),
            ($5::uuid, $7::uuid, 'Old Masonry', '{masonry}', 'okay', null, now())`,
    [EXTRA.hoyneVendor, EXTRA.damenVendor, EXTRA.damenVendor2, EXTRA.damenDoNotUse, EXTRA.damenArchived, f.hoyne, f.damen],
  );
}

/** A Hoyne shared-area ticket. */
export async function addHoyneTicket(db: PGlite, f: Fixture): Promise<void> {
  await db.query(
    `insert into public.tickets (id, association_id, title, status, priority, unit_id, opened_on)
     values ($1::uuid, $2::uuid, 'Hoyne gutter loose', 'open', 'normal', null, '2026-03-01')`,
    [EXTRA.hoyneTicket, f.hoyne],
  );
}

/** Upkeep tasks: one in Hoyne, one in Damen (a yearly September boiler service). */
export async function addTasks(db: PGlite, f: Fixture): Promise<void> {
  await db.query(
    `insert into public.upkeep_tasks (id, association_id, name, interval_months, due_month, next_due_on)
     values ($1::uuid, $3::uuid, 'Hoyne gutters', 12, 11, '2026-11-30'),
            ($2::uuid, $4::uuid, 'Boiler service', 12, 9, '2027-09-30')`,
    [EXTRA.hoyneTask, EXTRA.damenTask, f.hoyne, f.damen],
  );
}

/** One expense in each association (Hoyne needs its own fund, account, year and entry first). */
export async function addExpenses(db: PGlite, f: Fixture): Promise<void> {
  await db.exec(`
    insert into public.funds (id, association_id, name, kind, is_restricted)
    values ('${EXTRA.hoyneFund}', '${f.hoyne}', 'Operating', 'operating', false);
    insert into public.accounts (id, association_id, code, name, type, is_cash_account, is_exempt_expenditure)
    values ('${EXTRA.hoyneAccount}', '${f.hoyne}', '5100', 'Repairs', 'expense', false, true),
           ('${EXTRA.damenExpenseAccount}', '${f.damen}', '5100', 'Repairs', 'expense', false, true),
           ('${EXTRA.hoyneCash}', '${f.hoyne}', '1000', 'Operating Cash', 'asset', true, null);
    insert into public.fiscal_years (id, association_id, label, starts_on, ends_on)
    values ('${EXTRA.hoyneYear}', '${f.hoyne}', '2026', '2026-01-01', '2026-12-31');
    insert into public.journal_entries (id, association_id, fiscal_year_id, entry_date, memo, source, is_posted)
    values ('${EXTRA.hoyneEntry}', '${f.hoyne}', '${EXTRA.hoyneYear}', '2026-03-01', 'Repair', 'manual', false),
           ('${EXTRA.damenEntry}', '${f.damen}', 'f1500000-0000-0000-0000-000000000001', '2026-03-01', 'Repair', 'manual', false);
    -- Balanced lines, or the deferred double-entry check refuses the commit.
    insert into public.journal_lines (association_id, journal_entry_id, account_id, fund_id, debit, credit)
    values ('${f.hoyne}', '${EXTRA.hoyneEntry}', '${EXTRA.hoyneAccount}', '${EXTRA.hoyneFund}', 120.00, 0),
           ('${f.hoyne}', '${EXTRA.hoyneEntry}', '${EXTRA.hoyneCash}', '${EXTRA.hoyneFund}', 0, 120.00),
           ('${f.damen}', '${EXTRA.damenEntry}', '${EXTRA.damenExpenseAccount}', 'ffff0000-0000-0000-0000-000000000001', 450.00, 0),
           ('${f.damen}', '${EXTRA.damenEntry}', 'acc00000-0000-0000-0000-000000001000', 'ffff0000-0000-0000-0000-000000000001', 0, 450.00);
    insert into public.expenses (id, association_id, account_id, fund_id, paid_on, amount, journal_entry_id)
    values ('${EXTRA.hoyneExpense}', '${f.hoyne}', '${EXTRA.hoyneAccount}', '${EXTRA.hoyneFund}', '2026-03-01', 120.00, '${EXTRA.hoyneEntry}'),
           ('${EXTRA.damenExpense}', '${f.damen}', '${EXTRA.damenExpenseAccount}', 'ffff0000-0000-0000-0000-000000000001', '2026-03-01', 450.00, '${EXTRA.damenEntry}');
  `);
}

/** The building's today, as the migration computes it. */
export async function chicagoToday(db: PGlite): Promise<string> {
  const { rows } = await db.query<{ d: string }>(`select ((now() at time zone 'America/Chicago')::date)::text as d`);
  return rows[0].d;
}
