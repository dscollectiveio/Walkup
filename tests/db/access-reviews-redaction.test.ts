import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

describe("access reviews, deprovisioning, redaction (0037)", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
  });
  afterEach(async () => {
    await db.close();
  });

  async function activeGrant(personId: string, role: string): Promise<boolean> {
    const { rows } = await db.query<{ revoked_at: string | null }>(
      `select revoked_at from role_grants where person_id = $1::uuid and role = $2::app_role`,
      [personId, role],
    );
    return rows.length > 0 && rows[0].revoked_at === null;
  }

  describe("deprovision_stale_access", () => {
    it("records the revocation of an expired accountant grant", async () => {
      expect(await activeGrant(f.vicPerson, "accountant")).toBe(true);
      await db.query(`select public.deprovision_stale_access($1::uuid)`, [f.damen]);
      expect(await activeGrant(f.vicPerson, "accountant")).toBe(false);
      expect(await activeGrant(f.niaPerson, "accountant")).toBe(true);
    });

    it("revokes an owner grant once that owner's last ownership has ended", async () => {
      await db.query(
        `update unit_owners set effective_to = '2025-01-01' where person_id = $1::uuid`,
        [f.boPerson],
      );
      // Closing the ownership ends the owner role at once (0075); the daily run then has nothing left to do.
      expect(await activeGrant(f.boPerson, "owner")).toBe(false);
      const { rows } = await db.query<{ deprovision_stale_access: number }>(
        `select public.deprovision_stale_access(null)`,
      );
      expect(rows[0].deprovision_stale_access).toBe(0);
      expect(await activeGrant(f.adaPerson, "owner")).toBe(true);
      expect(await activeGrant(f.cyPerson, "owner")).toBe(true);
    });

    it("leaves alone an owner who has never been assigned a unit, or whose sale closes later", async () => {
      await db.query(
        `insert into persons (id, association_id, full_name)
         values ('eeee0000-0000-0000-0000-0000000000a1', $1::uuid, 'Pending Owner')`,
        [f.damen],
      );
      await db.query(
        `insert into role_grants (association_id, person_id, role) values
           ($1::uuid, 'eeee0000-0000-0000-0000-0000000000a1', 'owner')`,
        [f.damen],
      );
      await db.query(
        `update unit_owners set effective_to = '2099-01-01' where person_id = $1::uuid`,
        [f.adaPerson],
      );

      await db.query(`select public.deprovision_stale_access($1::uuid)`, [f.damen]);

      expect(await activeGrant("eeee0000-0000-0000-0000-0000000000a1", "owner")).toBe(true);
      expect(await activeGrant(f.adaPerson, "owner")).toBe(true);
    });

    it("can't be called directly by a signed-in user, even a board admin", async () => {
      await asUser(db, f.cyUser, async () => {
        await expect(
          db.query(`select public.deprovision_stale_access($1::uuid)`, [f.damen]),
        ).rejects.toThrow(/permission denied/i);
      });
    });
  });

  describe("record_access_review", () => {
    it("snapshots active grants after cleaning up stale ones", async () => {
      await asUser(db, f.cyUser, async () => {
        const { rows } = await db.query<{
          active_grants: { full_name: string; role: string }[];
          revoked_count: number;
          notes: string | null;
        }>(
          `select active_grants, revoked_count, notes
             from public.record_access_review($1::uuid, '  Quarterly check  ')`,
          [f.damen],
        );
        const grants = rows[0].active_grants.map((g) => `${g.full_name}:${g.role}`);
        expect(grants).not.toContain("Vic Advani:accountant");
        expect(grants).toContain("Nia Bergström:accountant");
        expect(grants).toContain("Cy Ferreira:board_admin");
        expect(rows[0].revoked_count).toBe(1);
        expect(rows[0].notes).toBe("Quarterly check");
      });
    });

    it("refuses an owner-only caller, who also can't read past reviews", async () => {
      await asUser(db, f.cyUser, async () => {
        await db.query(`select public.record_access_review($1::uuid)`, [f.damen]);
      });
      await asUser(db, f.adaUser, async () => {
        await expect(
          db.query(`select public.record_access_review($1::uuid)`, [f.damen]),
        ).rejects.toThrow(/not authorized/i);
        const { rows } = await db.query(`select * from public.access_reviews`);
        expect(rows).toHaveLength(0);
      });
    });

    it("is append-only: no direct insert, even for a board admin", async () => {
      await asUser(db, f.cyUser, async () => {
        await expect(
          db.query(
            `insert into public.access_reviews (association_id, active_grants) values ($1::uuid, '[]')`,
            [f.damen],
          ),
        ).rejects.toThrow(/row-level security/i);
      });
    });
  });

  describe("redact_person", () => {
    async function retireBo() {
      await db.query(
        `update unit_owners set effective_to = '2025-01-01' where person_id = $1::uuid`,
        [f.boPerson],
      );
      await db.query(
        `update role_grants set revoked_at = now() where person_id = $1::uuid`,
        [f.boPerson],
      );
    }

    it("removes personal details from the person and from every audit row about them", async () => {
      await retireBo();
      await db.query(
        `insert into invites (association_id, role, email) values ($1::uuid, 'owner', 'BO@example.test')`,
        [f.damen],
      );
      // Phone and address live in person_contact_details (0082); an edit leaves an audit row too.
      await db.query(
        `insert into person_contact_details (person_id, association_id, phone, mailing_address) values ($1::uuid, $2::uuid, '312-555-0177', '9 Birch Lane')`,
        [f.boPerson, f.damen],
      );
      await db.query(`update person_contact_details set phone = '312-555-0178' where person_id = $1::uuid`, [f.boPerson]);

      await asUser(db, f.cyUser, async () => {
        await db.query(`select public.redact_person($1::uuid)`, [f.boPerson]);
      });

      const { rows: person } = await db.query(
        `select full_name, email, auth_user_id from persons where id = $1::uuid`,
        [f.boPerson],
      );
      expect(person[0]).toEqual({
        full_name: "Former member",
        email: null,
        auth_user_id: null,
      });
      expect((await db.query(`select 1 from person_contact_details where person_id = $1::uuid`, [f.boPerson])).rows).toHaveLength(0);

      const { rows: leaks } = await db.query<{ n: number }>(
        `select count(*)::int as n from audit_log
          where coalesce(before_data::text, '') || coalesce(after_data::text, '')
                ~* '(bo@example\\.test|Lindqvist|312-555-017|Birch Lane)'`,
      );
      expect(leaks[0].n).toBe(0);

      const { rows: invites } = await db.query(`select email from invites`);
      expect(invites).toEqual([{ email: null }]);

      const { rows: history } = await db.query(
        `select 1 from unit_owners where person_id = $1::uuid`,
        [f.boPerson],
      );
      expect(history).toHaveLength(1); // ledger/ownership history survives
    });

    it("refuses while the person still has access or still owns a unit", async () => {
      await asUser(db, f.cyUser, async () => {
        await expect(
          db.query(`select public.redact_person($1::uuid)`, [f.adaPerson]),
        ).rejects.toThrow(/revoke this person's access/i);
      });

      await db.query(`update role_grants set revoked_at = now() where person_id = $1::uuid`, [
        f.adaPerson,
      ]);
      await asUser(db, f.cyUser, async () => {
        await expect(
          db.query(`select public.redact_person($1::uuid)`, [f.adaPerson]),
        ).rejects.toThrow(/still owns a unit/i);
      });
    });

    it("refuses your own record, and any non-admin caller", async () => {
      await asUser(db, f.cyUser, async () => {
        await expect(
          db.query(`select public.redact_person($1::uuid)`, [f.cyPerson]),
        ).rejects.toThrow(/your own personal data/i);
      });
      await retireBo();
      await asUser(db, f.adaUser, async () => {
        await expect(
          db.query(`select public.redact_person($1::uuid)`, [f.boPerson]),
        ).rejects.toThrow(/not authorized/i);
      });
    });
  });
});
