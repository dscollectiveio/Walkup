import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asService, asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

/**
 * Migration 0065: access control phase 1. Invite-link accountants end after
 * 90 days, and a building always keeps a board admin who can sign in.
 */

describe("access fixes (0065)", () => {
  let db: PGlite;
  let f: Fixture;
  const freshUser = "99990000-0000-0000-0000-000000000001";

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
  });
  afterEach(async () => {
    await db.close();
  });

  async function redeemAs(role: string) {
    const { rows } = await asUser(db, f.cyUser, () =>
      db.query<{ token: string }>(
        `insert into public.invites (association_id, role, email, created_by)
         values ($1::uuid, $2::public.app_role, 'new@example.test', $3::uuid) returning token`,
        [f.damen, role, f.cyUser],
      ),
    );
    await db.query(`insert into auth.users (id, email) values ($1::uuid, 'new@example.test')`, [freshUser]);
    await asUser(db, freshUser, () => db.query(`select public.redeem_invite($1, $2)`, [rows[0].token, "New Person"]));
    const { rows: g } = await db.query<{ role: string; days: number | null }>(
      `select role, (expires_on - current_date) as days from public.role_grants
        where person_id = (select id from public.persons where auth_user_id = $1::uuid)`,
      [freshUser],
    );
    return g[0];
  }

  it("an accountant who joins by invite link has access for 90 days", async () => {
    const g = await redeemAs("accountant");
    expect(g.role).toBe("accountant");
    expect(Number(g.days)).toBe(90);
  });

  it("other roles joined by invite link have no end date", async () => {
    const g = await redeemAs("board_member");
    expect(g.days).toBeNull();
  });

  describe("keep at least one board admin", () => {
    it("refuses to revoke the only board admin", async () => {
      await expect(
        asUser(db, f.cyUser, () =>
          db.query(
            `update public.role_grants set revoked_at = now(), revoked_by = $2::uuid
              where person_id = $1::uuid and role = 'board_admin'`,
            [f.cyPerson, f.cyUser],
          ),
        ),
      ).rejects.toThrow(/at least one board admin/i);
    });

    it("refuses to delete the only board admin or give them an end date in the past", async () => {
      await expect(
        asService(db, () => db.query(`delete from public.role_grants where person_id = $1::uuid and role = 'board_admin'`, [f.cyPerson])),
      ).rejects.toThrow(/at least one board admin/i);
      await expect(
        asService(db, () =>
          db.query(`update public.role_grants set expires_on = current_date - 1 where person_id = $1::uuid and role = 'board_admin'`, [f.cyPerson]),
        ),
      ).rejects.toThrow(/at least one board admin/i);
    });

    it("allows it once another admin who can sign in exists", async () => {
      await asService(db, () =>
        db.query(
          `insert into public.role_grants (association_id, person_id, role, granted_on)
           values ($1::uuid, $2::uuid, 'board_admin', current_date)`,
          [f.damen, f.boPerson],
        ),
      );
      await asUser(db, f.cyUser, () =>
        db.query(
          `update public.role_grants set revoked_at = now(), revoked_by = $2::uuid
            where person_id = $1::uuid and role = 'board_admin'`,
          [f.cyPerson, f.cyUser],
        ),
      );
      const { rows } = await db.query<{ n: number }>(
        `select count(*)::int as n from public.role_grants where association_id = $1::uuid and role = 'board_admin' and revoked_at is null`,
        [f.damen],
      );
      expect(rows[0].n).toBe(1);
    });

    it("does not count an admin who has never signed in", async () => {
      await asService(db, async () => {
        await db.query(
          `insert into public.persons (id, association_id, full_name) values ('99990000-0000-0000-0000-0000000000aa', $1::uuid, 'No Login')`,
          [f.damen],
        );
        await db.query(
          `insert into public.role_grants (association_id, person_id, role, granted_on)
           values ($1::uuid, '99990000-0000-0000-0000-0000000000aa', 'board_admin', current_date)`,
          [f.damen],
        );
      });
      await expect(
        asUser(db, f.cyUser, () =>
          db.query(
            `update public.role_grants set revoked_at = now(), revoked_by = $2::uuid
              where person_id = $1::uuid and role = 'board_admin'`,
            [f.cyPerson, f.cyUser],
          ),
        ),
      ).rejects.toThrow(/at least one board admin/i);
    });

    it("lets system clean-up and other roles be revoked as before", async () => {
      await asUser(db, f.cyUser, () =>
        db.query(
          `update public.role_grants set revoked_at = now(), revoked_by = $2::uuid
            where person_id = $1::uuid and role = 'owner'`,
          [f.cyPerson, f.cyUser],
        ),
      );
    });
  });
});
