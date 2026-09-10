import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

describe("create_expense_account (0032)", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
  });
  afterEach(async () => {
    await db.close();
  });

  it("refuses to add a category for a non-board caller", async () => {
    await asUser(db, f.adaUser, async () => {
      await expect(
        db.query(`select public.create_expense_account($1::uuid, 'Pool Maintenance')`, [
          f.damen,
        ]),
      ).rejects.toThrow(/not authorized/i);
    });
  });

  it("lets board_admin add a category, classified as an exempt operating expense", async () => {
    await asUser(db, f.cyUser, async () => {
      const { rows } = await db.query<{
        code: string;
        name: string;
        type: string;
        is_exempt_expenditure: boolean;
        is_active: boolean;
      }>(
        `select code, name, type, is_exempt_expenditure, is_active
           from public.create_expense_account($1::uuid, '  Pool Maintenance  ')`,
        [f.damen],
      );
      expect(rows[0].name).toBe("Pool Maintenance");
      expect(rows[0].type).toBe("expense");
      expect(rows[0].is_exempt_expenditure).toBe(true);
      expect(rows[0].is_active).toBe(true);
      expect(rows[0].code).toMatch(/^\d{4}$/);
    });
  });

  it("refuses a blank name", async () => {
    await asUser(db, f.cyUser, async () => {
      await expect(
        db.query(`select public.create_expense_account($1::uuid, '   ')`, [f.damen]),
      ).rejects.toThrow(/name is required/i);
    });
  });

  it("assigns increasing codes below the reserved 5900 tax line, per association", async () => {
    await asUser(db, f.cyUser, async () => {
      const first = await db.query<{ code: string }>(
        `select code from public.create_expense_account($1::uuid, 'First Category')`,
        [f.damen],
      );
      const second = await db.query<{ code: string }>(
        `select code from public.create_expense_account($1::uuid, 'Second Category')`,
        [f.damen],
      );
      expect(Number(second.rows[0].code)).toBeGreaterThan(Number(first.rows[0].code));
      expect(Number(second.rows[0].code)).toBeLessThan(5900);
    });
  });
});
