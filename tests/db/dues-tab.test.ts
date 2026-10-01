import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

const AR = "acc00000-0000-0000-0000-000000001200";
const LATE_FEES = "acc00000-0000-0000-0000-000000004000"; // the seed has no 4020; any income account proves the memo
const OPERATING = "ffff0000-0000-0000-0000-000000000001";
const FY_2026 = "f1500000-0000-0000-0000-000000000001";

// The Dues tab (0044): a late-fee rule on the association, owner payment
// reports that never touch the ledger, and a memo on record_assessment_charge
// so a late fee reads as one on the statement.
describe("dues tab (0044)", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
  });

  describe("late-fee rule", () => {
    it("is off by default and a board_admin can set it", async () => {
      const before = await asUser(db, f.cyUser, () =>
        db.query<{ a: string | null; g: number | null }>(
          `select dues_late_fee_amount as a, dues_late_fee_grace_days as g from public.associations where id = $1::uuid`,
          [f.damen],
        ),
      );
      expect(before.rows[0]).toEqual({ a: null, g: null });
      const set = await asUser(db, f.cyUser, () =>
        db.query(
          `update public.associations set dues_late_fee_amount = 25, dues_late_fee_grace_days = 15 where id = $1::uuid`,
          [f.damen],
        ),
      );
      expect(set.affectedRows).toBe(1);
    });

    it("an owner cannot set it", async () => {
      const set = await asUser(db, f.adaUser, () =>
        db.query(`update public.associations set dues_late_fee_amount = 25 where id = $1::uuid`, [f.damen]),
      );
      expect(set.affectedRows).toBe(0);
    });
  });

  describe("owner payment reports", () => {
    const insertAs = (user: string, unit: string) =>
      asUser(db, user, () =>
        db.query<{ id: string }>(
          `insert into public.dues_payment_reports (association_id, unit_id, reported_by, amount, paid_on, method, note)
           values ($1::uuid, $2::uuid, $3::uuid, 450, '2026-10-03', 'zelle', 'sent from my Chase app')
           returning id`,
          [f.damen, unit, user],
        ),
      );

    it("an owner can report a payment for their own unit, and it starts pending", async () => {
      const { rows } = await insertAs(f.adaUser, f.unit1);
      expect(rows).toHaveLength(1);
      const seen = await asUser(db, f.adaUser, () =>
        db.query<{ status: string }>(`select status from public.dues_payment_reports where id = $1::uuid`, [rows[0].id]),
      );
      expect(seen.rows[0].status).toBe("pending");
    });

    it("an owner cannot report for a neighbour's unit, nor see the neighbour's report", async () => {
      await expect(insertAs(f.adaUser, f.unit2)).rejects.toThrow();
      await insertAs(f.boUser, f.unit2);
      const adaSees = await asUser(db, f.adaUser, () =>
        db.query(`select id from public.dues_payment_reports where unit_id = $1::uuid`, [f.unit2]),
      );
      expect(adaSees.rows).toHaveLength(0);
      const boardSees = await asUser(db, f.cyUser, () =>
        db.query(`select id from public.dues_payment_reports where unit_id = $1::uuid`, [f.unit2]),
      );
      expect(boardSees.rows).toHaveLength(1);
    });

    it("only the board resolves a report, and a match must name a bank transaction", async () => {
      const { rows } = await insertAs(f.adaUser, f.unit1);
      const id = rows[0].id;

      const ownerTries = await asUser(db, f.adaUser, () =>
        db.query(
          `update public.dues_payment_reports set status = 'dismissed', resolved_at = now(), resolved_by = $2::uuid where id = $1::uuid`,
          [id, f.adaUser],
        ),
      );
      expect(ownerTries.affectedRows).toBe(0);

      await expect(
        asUser(db, f.cyUser, () =>
          db.query(
            `update public.dues_payment_reports set status = 'matched', resolved_at = now(), resolved_by = $2::uuid where id = $1::uuid`,
            [id, f.cyUser],
          ),
        ),
      ).rejects.toThrow(/check/i);

      const dismissed = await asUser(db, f.cyUser, () =>
        db.query(
          `update public.dues_payment_reports
              set status = 'dismissed', resolution_note = 'Nothing arrived', resolved_at = now(), resolved_by = $2::uuid
            where id = $1::uuid`,
          [id, f.cyUser],
        ),
      );
      expect(dismissed.affectedRows).toBe(1);

      const audit = await db.query<{ n: number }>(
        `select count(*)::int as n from public.audit_log where table_name = 'dues_payment_reports'`,
      );
      expect(audit.rows[0].n).toBeGreaterThanOrEqual(2);
    });

    it("refuses a unit from another association", async () => {
      await expect(
        asUser(db, f.cyUser, () =>
          db.query(
            `insert into public.dues_payment_reports (association_id, unit_id, reported_by, amount, paid_on, method)
             values ($1::uuid, $2::uuid, $3::uuid, 100, '2026-10-01', 'cash')`,
            [f.damen, f.hoyneUnit, f.cyUser],
          ),
        ),
      ).rejects.toThrow(/different association/);
    });
  });


  describe("per-unit dues plans", () => {
    const plan = (user: string, unit: string, annual: number) =>
      asUser(db, user, () =>
        db.query<{ id: string }>(
          `insert into public.assessment_schedules
             (association_id, unit_id, name, frequency, fund_id, allocation_method, starts_on, is_special, total_amount, annual_amount)
           values ($1::uuid, $2::uuid, 'Unit dues', 'monthly', $3::uuid, 'fixed_per_unit', '2026-11-01', false, $4, $5)
           returning id`,
          [f.damen, unit, OPERATING, annual / 12, annual],
        ),
      );

    it("a board member sets different plans for different units and can change one", async () => {
      const a = await plan(f.cyUser, f.unit1, 5400);
      const b = await plan(f.cyUser, f.unit2, 3600);
      expect(a.rows).toHaveLength(1);
      expect(b.rows).toHaveLength(1);
      const changed = await asUser(db, f.cyUser, () =>
        db.query(`update public.assessment_schedules set frequency = 'quarterly', total_amount = 1350 where id = $1::uuid`, [a.rows[0].id]),
      );
      expect(changed.affectedRows).toBe(1);
    });

    it("an owner cannot set a plan, and a unit from another building is refused", async () => {
      await expect(plan(f.adaUser, f.unit1, 1200)).rejects.toThrow();
      await expect(plan(f.cyUser, f.hoyneUnit, 1200)).rejects.toThrow(/different association/);
    });

    it("a per-unit plan must be a fixed amount, not a split", async () => {
      await expect(
        asUser(db, f.cyUser, () =>
          db.query(
            `insert into public.assessment_schedules
               (association_id, unit_id, name, frequency, fund_id, allocation_method, starts_on, total_amount)
             values ($1::uuid, $2::uuid, 'x', 'monthly', $3::uuid, 'equal', '2026-11-01', 100)`,
            [f.damen, f.unit1, OPERATING],
          ),
        ),
      ).rejects.toThrow(/assessment_schedules_unit_fixed/);
    });
  });

  describe("record_assessment_charge memo", () => {
    it("a late fee posts with 'Late fee' on the entry, a one-off charge with its reason", async () => {
      const fee = await asUser(db, f.cyUser, () =>
        db.query<{ id: string }>(
          `select public.record_assessment_charge(
             $1::uuid, $2::uuid, $3::uuid, 'late_fee', '2026-09-01', '2026-10-16', 25, $4::uuid, $5::uuid, $6::uuid) as id`,
          [f.damen, FY_2026, f.unit1, OPERATING, AR, LATE_FEES],
        ),
      );
      const feeMemo = await db.query<{ memo: string }>(
        `select je.memo from public.assessment_charges c join public.journal_entries je on je.id = c.journal_entry_id where c.id = $1::uuid`,
        [fee.rows[0].id],
      );
      expect(feeMemo.rows[0].memo).toBe("Late fee");

      const oneOff = await asUser(db, f.cyUser, () =>
        db.query<{ id: string }>(
          `select public.record_assessment_charge(
             $1::uuid, $2::uuid, $3::uuid, 'other', '2026-10-16', '2026-10-16', 80, $4::uuid, $5::uuid, $6::uuid, null, 'Replacement mailbox key') as id`,
          [f.damen, FY_2026, f.unit1, OPERATING, AR, LATE_FEES],
        ),
      );
      const memo = await db.query<{ memo: string }>(
        `select je.memo from public.assessment_charges c join public.journal_entries je on je.id = c.journal_entry_id where c.id = $1::uuid`,
        [oneOff.rows[0].id],
      );
      expect(memo.rows[0].memo).toBe("Replacement mailbox key");
    });
  });
});
