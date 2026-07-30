import { describe, expect, it } from "vitest";
import { freshDb } from "./harness";

describe("migrations", () => {
  it("apply cleanly from empty", async () => {
    const db = await freshDb();
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_tables where schemaname = 'public'`,
    );
    expect(rows[0].n).toBeGreaterThan(0);
    await db.close();
  });

  it("declare money columns as numeric(14,2) and never floating point", async () => {
    const db = await freshDb();

    const { rows: floats } = await db.query<{ table_name: string; column_name: string; data_type: string }>(
      `select table_name, column_name, data_type
         from information_schema.columns
        where table_schema = 'public'
          and data_type in ('real', 'double precision')`,
    );
    expect(floats).toEqual([]);

    // Every numeric column is either money (14,2) or a percentage/rate.
    const { rows: numerics } = await db.query<{
      table_name: string;
      column_name: string;
      numeric_precision: number;
      numeric_scale: number;
    }>(
      // Base tables only. A view's sum() reports null precision, which says
      // nothing about how the underlying money is stored.
      `select c.table_name, c.column_name, c.numeric_precision, c.numeric_scale
         from information_schema.columns c
         join information_schema.tables t
           on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'public'
          and t.table_type = 'BASE TABLE'
          and c.data_type = 'numeric'
        order by 1, 2`,
    );

    const allowed = new Set(["14,2", "9,6", "6,4", "14,6"]);
    const offenders = numerics.filter(
      (c) => !allowed.has(`${c.numeric_precision},${c.numeric_scale}`),
    );
    expect(offenders).toEqual([]);

    await db.close();
  });

  it("scope every association-owned table with association_id", async () => {
    const db = await freshDb();

    // Global reference data and the append-only log are the documented
    // exceptions: tax_parameters is not association-scoped, and audit_log
    // carries association_id without a foreign key so it outlives its subject.
    const { rows } = await db.query<{ table_name: string }>(
      `select t.table_name
         from information_schema.tables t
        where t.table_schema = 'public'
          and t.table_type = 'BASE TABLE'
          and t.table_name not in ('associations', 'tax_parameters')
          and not exists (
            select 1 from information_schema.columns c
             where c.table_schema = 'public'
               and c.table_name = t.table_name
               and c.column_name = 'association_id')
        order by 1`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([]);

    await db.close();
  });

  it("let authenticated execute every function a deferred trigger calls", async () => {
    // Regression for 0007/0012. Postgres does not check EXECUTE privilege when
    // a trigger FIRES, but a trigger body calling another function makes an
    // ordinary, privilege-checked call — as the current user, which at commit
    // time is `authenticated`. Revoking check_entry_balanced therefore
    // disabled every ledger write in production while the local suite stayed
    // green, because PGlite resolves deferred-trigger privileges differently.
    //
    // This is a static assertion precisely because the runtime behaviour is
    // the part PGlite cannot be trusted to reproduce.
    const db = await freshDb();
    const required = [
      "public.check_entry_balanced(uuid)",
      "public.tg_lines_balanced()",
      "public.tg_entry_balanced()",
      "public.tg_ownership_sums_to_100()",
      "public.tg_allocation_within_payment()",
    ];

    for (const fn of required) {
      const { rows } = await db.query<{ ok: boolean }>(
        `select has_function_privilege('authenticated', $1, 'execute') as ok`,
        [fn],
      );
      expect(rows[0].ok, `authenticated must be able to execute ${fn}`).toBe(true);
    }

    // anon must NOT be able to reach them.
    const { rows: anon } = await db.query<{ ok: boolean }>(
      `select has_function_privilege('anon', 'public.check_entry_balanced(uuid)', 'execute') as ok`,
    );
    expect(anon[0].ok).toBe(false);

    await db.close();
  });

  it("never cascade a delete from associations into financial history", async () => {
    const db = await freshDb();
    const { rows } = await db.query<{ table_name: string; constraint_name: string }>(
      `select tc.table_name, tc.constraint_name
         from information_schema.table_constraints tc
         join information_schema.referential_constraints rc
           on rc.constraint_name = tc.constraint_name
         join information_schema.constraint_column_usage ccu
           on ccu.constraint_name = tc.constraint_name
        where tc.constraint_type = 'FOREIGN KEY'
          and ccu.table_name = 'associations'
          and rc.delete_rule <> 'RESTRICT'
        order by 1`,
    );
    expect(rows).toEqual([]);
    await db.close();
  });
});
