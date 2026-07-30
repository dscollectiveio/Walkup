import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

describe("operations layer", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
  });
  afterEach(async () => {
    await db.close();
  });

  describe("tickets", () => {
    it("lets an owner see shared-area problems and their own, but not a neighbour's", async () => {
      await asUser(db, f.adaUser, async () => {
        const { rows } = await db.query<{ id: string; title: string }>(
          `select id, title from tickets order by opened_on`,
        );
        const ids = rows.map((r) => r.id);

        // The roof is everyone's business.
        expect(ids).toContain(f.ticketCommon);
        expect(ids).toContain(f.ticketUnit1);
        // What is wrong inside Bo's flat is not.
        expect(ids).not.toContain(f.ticketUnit2);
      });
    });

    it("lets the board see every problem", async () => {
      await asUser(db, f.cyUser, async () => {
        const { rows } = await db.query(`select id from tickets`);
        expect(rows).toHaveLength(3);
      });
    });

    it("lets an owner report a shared-area problem", async () => {
      await asUser(db, f.adaUser, async () => {
        await db.query(
          `insert into tickets (association_id, title, unit_id) values ($1, $2, null)`,
          [f.damen, "Front door lock sticking"],
        );
      });
      const { rows } = await db.query<{ n: number }>(
        `select count(*)::int n from tickets where title = 'Front door lock sticking'`,
      );
      expect(rows[0].n).toBe(1);
    });

    it("does not let an owner file a problem against a neighbour's unit", async () => {
      await asUser(db, f.adaUser, async () => {
        await expect(
          db.query(
            `insert into tickets (association_id, title, unit_id) values ($1, $2, $3)`,
            [f.damen, "Something about Bo's flat", f.unit2],
          ),
        ).rejects.toThrow(/row-level security/i);
      });
    });

    it("does not let an owner close a problem", async () => {
      await asUser(db, f.adaUser, async () => {
        const res = await db.query(
          `update tickets set status = 'closed', resolved_at = now() where id = $1`,
          [f.ticketCommon],
        );
        // Invisible under USING means zero rows, not an error (DECISIONS #17).
        expect(res.affectedRows).toBe(0);
      });
    });

    it("numbers tickets per association, not globally", async () => {
      const { rows } = await db.query<{ reference: number }>(
        `select reference from tickets order by reference`,
      );
      expect(rows.map((r) => r.reference)).toEqual([1, 2, 3]);
    });

    it("keeps resolved_at and status in agreement", async () => {
      await expect(
        db.query(`update tickets set status = 'resolved' where id = $1`, [f.ticketCommon]),
      ).rejects.toThrow(/violates check constraint/i);
    });
  });

  describe("board-only operations data", () => {
    it("hides bills and insurance from owners", async () => {
      await asUser(db, f.adaUser, async () => {
        const bills = await db.query(`select id from recurring_bills`);
        const policies = await db.query(`select id from insurance_policies`);
        expect(bills.rows).toEqual([]);
        expect(policies.rows).toEqual([]);
      });
    });

    it("shows them to the board", async () => {
      await asUser(db, f.cyUser, async () => {
        const bills = await db.query(`select id from recurring_bills`);
        const policies = await db.query(`select id from insurance_policies`);
        expect(bills.rows).toHaveLength(1);
        expect(policies.rows).toHaveLength(2);
      });
    });
  });

  describe("contractor messages", () => {
    it("refuses to record a message as sent without an approver", async () => {
      await expect(
        db.query(
          `insert into contractor_messages
             (association_id, vendor_id, subject, body, status, sent_at)
           values ($1,
             (select id from vendors limit 1),
             'Test', 'Body', 'sent', now())`,
          [f.damen],
        ),
      ).rejects.toThrow(/violates check constraint|null value/i);
    });
  });

  describe("insurance year over year", () => {
    it("computes the change against the previous policy year", async () => {
      const { rows } = await db.query<{
        carrier_name: string;
        annual_premium: string;
        change_amount: string | null;
        change_percent: string | null;
      }>(
        `select carrier_name, annual_premium::text, change_amount::text, change_percent::text
           from insurance_year_over_year order by effective_from`,
      );

      expect(rows[0].change_amount).toBeNull();
      expect(rows[1].change_amount).toBe("200.00");
      expect(Number(rows[1].change_percent)).toBeCloseTo(20, 1);
    });
  });
});
