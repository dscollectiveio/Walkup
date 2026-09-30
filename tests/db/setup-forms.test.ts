import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

const AR = "acc00000-0000-0000-0000-000000001200";
const INCOME = "acc00000-0000-0000-0000-000000004000";
const OPERATING = "ffff0000-0000-0000-0000-000000000001";
const FY_2026 = "f1500000-0000-0000-0000-000000000001";

// The three forms the setup guide needs (insurance policy, contractor, dues
// schedule) write through plain RLS-gated inserts; "Charge this period"
// goes through record_assessment_charge. These tests pin the authorization
// each one relies on and the double-charge guard the action implements.
describe("setup guide forms (0038 + existing RLS)", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
  });

  describe("associations.setup_dismissed_at", () => {
    it("exists, defaults to null, and a board_admin can set it", async () => {
      const before = await asUser(db, f.cyUser, () =>
        db.query<{ setup_dismissed_at: string | null }>(
          `select setup_dismissed_at from public.associations where id = $1::uuid`,
          [f.damen],
        ),
      );
      expect(before.rows[0].setup_dismissed_at).toBeNull();

      const updated = await asUser(db, f.cyUser, () =>
        db.query(`update public.associations set setup_dismissed_at = now() where id = $1::uuid`, [f.damen]),
      );
      expect(updated.affectedRows).toBe(1);
    });

    it("an owner cannot dismiss the guide", async () => {
      const updated = await asUser(db, f.adaUser, () =>
        db.query(`update public.associations set setup_dismissed_at = now() where id = $1::uuid`, [f.damen]),
      );
      expect(updated.affectedRows).toBe(0);
    });
  });

  describe("insurance_policies (record a policy)", () => {
    const insert = (user: string) =>
      asUser(db, user, () =>
        db.query(
          `insert into public.insurance_policies
             (association_id, coverage, carrier_name, effective_from, effective_to, annual_premium)
           values ($1::uuid, 'general_liability', 'Carrier C', '2026-10-01', '2027-10-01', 900.00)`,
          [f.damen],
        ),
      );

    it("board_admin can record one", async () => {
      expect((await insert(f.cyUser)).affectedRows).toBe(1);
    });

    it("owner cannot", async () => {
      await expect(insert(f.adaUser)).rejects.toThrow(/row-level security/);
    });
  });

  describe("vendors (add / edit a contractor)", () => {
    it("board_admin can add and then edit W-9 fields", async () => {
      const { rows } = await asUser(db, f.cyUser, () =>
        db.query<{ id: string }>(
          `insert into public.vendors (association_id, name, trade, tin_last4)
           values ($1::uuid, 'Damen Plumbing', 'plumber', '1234') returning id`,
          [f.damen],
        ),
      );
      const updated = await asUser(db, f.cyUser, () =>
        db.query(
          `update public.vendors set w9_on_file = true, w9_received_on = '2026-09-30' where id = $1::uuid`,
          [rows[0].id],
        ),
      );
      expect(updated.affectedRows).toBe(1);
    });

    it("refuses a full TIN — last four digits only", async () => {
      await expect(
        asUser(db, f.cyUser, () =>
          db.query(
            `insert into public.vendors (association_id, name, tin_last4) values ($1::uuid, 'X', '123456789')`,
            [f.damen],
          ),
        ),
      ).rejects.toThrow();
    });

    it("owner cannot add one", async () => {
      await expect(
        asUser(db, f.adaUser, () =>
          db.query(`insert into public.vendors (association_id, name) values ($1::uuid, 'X')`, [f.damen]),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  describe("assessment_schedules + charging a period", () => {
    async function createSchedule(): Promise<string> {
      const { rows } = await asUser(db, f.cyUser, () =>
        db.query<{ id: string }>(
          `insert into public.assessment_schedules
             (association_id, name, frequency, fund_id, allocation_method, starts_on, total_amount)
           values ($1::uuid, 'Regular assessments', 'monthly', $2::uuid, 'fixed_per_unit', '2026-09-01', 350.00)
           returning id`,
          [f.damen, OPERATING],
        ),
      );
      return rows[0].id;
    }

    /** What chargeDuesPeriod does per unit, minus the skip-already-charged loop. */
    async function chargeUnit(scheduleId: string, unitId: string) {
      return asUser(db, f.cyUser, () =>
        db.query<{ record_assessment_charge: string }>(
          `select public.record_assessment_charge(
             $1::uuid, $2::uuid, $3::uuid, 'assessment', '2026-09-01', '2026-09-01', 350.00,
             $4::uuid, $5::uuid, $6::uuid, $7::uuid)`,
          [f.damen, FY_2026, unitId, OPERATING, AR, INCOME, scheduleId],
        ),
      );
    }

    it("board_admin can create a schedule; owner cannot", async () => {
      await expect(createSchedule()).resolves.toMatch(/[0-9a-f-]{36}/);
      await expect(
        asUser(db, f.adaUser, () =>
          db.query(
            `insert into public.assessment_schedules
               (association_id, name, frequency, fund_id, starts_on, total_amount)
             values ($1::uuid, 'X', 'monthly', $2::uuid, '2026-09-01', 1)`,
            [f.damen, OPERATING],
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it("charging a period records one balanced entry per unit, tagged with the schedule", async () => {
      const scheduleId = await createSchedule();
      for (const unit of [f.unit1, f.unit2, f.unit3]) await chargeUnit(scheduleId, unit);

      const charges = await asUser(db, f.cyUser, () =>
        db.query<{ n: string }>(
          `select count(*)::text as n from public.assessment_charges
            where schedule_id = $1::uuid and period_start = '2026-09-01'`,
          [scheduleId],
        ),
      );
      expect(charges.rows[0].n).toBe("3");

      const balance = await asUser(db, f.cyUser, () =>
        db.query<{ debits: string; credits: string }>(
          `select sum(jl.debit)::text as debits, sum(jl.credit)::text as credits
             from public.journal_lines jl
             join public.assessment_charges c on c.journal_entry_id = jl.journal_entry_id
            where c.schedule_id = $1::uuid`,
          [scheduleId],
        ),
      );
      expect(balance.rows[0].debits).toBe("1050.00");
      expect(balance.rows[0].credits).toBe("1050.00");
    });

    it("the action's already-charged lookup finds the units to skip on a second run", async () => {
      const scheduleId = await createSchedule();
      await chargeUnit(scheduleId, f.unit1);

      const existing = await asUser(db, f.cyUser, () =>
        db.query<{ unit_id: string }>(
          `select unit_id from public.assessment_charges
            where schedule_id = $1::uuid and period_start = '2026-09-01'`,
          [scheduleId],
        ),
      );
      expect(existing.rows.map((r) => r.unit_id)).toEqual([f.unit1]);
    });

    it("an owner cannot charge a unit", async () => {
      const scheduleId = await createSchedule();
      await expect(
        asUser(db, f.adaUser, () =>
          db.query(
            `select public.record_assessment_charge(
               $1::uuid, $2::uuid, $3::uuid, 'assessment', '2026-09-01', '2026-09-01', 350.00,
               $4::uuid, $5::uuid, $6::uuid, $7::uuid)`,
            [f.damen, FY_2026, f.unit1, OPERATING, AR, INCOME, scheduleId],
          ),
        ),
      ).rejects.toThrow(/not authorized/);
    });
  });
});
