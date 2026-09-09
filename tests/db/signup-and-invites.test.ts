import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

describe("signup and invites (0027)", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
  });
  afterEach(async () => {
    await db.close();
  });

  async function newAuthUser(id: string, email: string) {
    await db.query(`insert into auth.users (id, email) values ($1::uuid, $2)`, [id, email]);
  }

  const freshUser = "99990000-0000-0000-0000-000000000001";
  const freshUser2 = "99990000-0000-0000-0000-000000000002";

  // --------------------------------------------------------------------------
  // create_association_and_owner
  // --------------------------------------------------------------------------

  describe("create_association_and_owner", () => {
    it("creates a brand-new association with the caller as its board_admin", async () => {
      await newAuthUser(freshUser, "new@example.test");
      await asUser(db, freshUser, async () => {
        const { rows } = await db.query<{ create_association_and_owner: string }>(
          `select public.create_association_and_owner($1, $2, $3, $4, $5)`,
          ["New Condo Association", "New Condo", "IL", "New Person", "new@example.test"],
        );
        const assocId = rows[0].create_association_and_owner;
        expect(assocId).toBeTruthy();

        const { rows: personRows } = await db.query<{ full_name: string }>(
          `select full_name from public.persons where association_id = $1::uuid and auth_user_id = $2::uuid`,
          [assocId, freshUser],
        );
        expect(personRows).toEqual([{ full_name: "New Person" }]);

        const { rows: boardRows } = await db.query<{ has_role_in: boolean }>(
          `select public.has_role_in($1::uuid, array['board_admin']::public.app_role[])`,
          [assocId],
        );
        expect(boardRows[0].has_role_in).toBe(true);
      });
    });

    it("rejects a second call for a user who already has a building", async () => {
      await newAuthUser(freshUser, "new@example.test");
      await asUser(db, freshUser, async () => {
        await db.query(`select public.create_association_and_owner($1, $2, $3, $4, $5)`, [
          "First Association",
          "First",
          "IL",
          "New Person",
          "new@example.test",
        ]);
        await expect(
          db.query(`select public.create_association_and_owner($1, $2, $3, $4, $5)`, [
            "Second Association",
            "Second",
            "IL",
            "New Person",
            "new@example.test",
          ]),
        ).rejects.toThrow(/already belongs to a building/i);
      });
    });

    it("rejects an unauthenticated caller", async () => {
      await expect(
        asUser(db, null, async () =>
          db.query(`select public.create_association_and_owner($1, $2, $3, $4, $5)`, [
            "No Auth",
            "No Auth",
            "IL",
            "Nobody",
            "nobody@example.test",
          ]),
        ),
      ).rejects.toThrow(/not authenticated/i);
    });
  });

  // --------------------------------------------------------------------------
  // redeem_invite
  // --------------------------------------------------------------------------

  describe("redeem_invite", () => {
    async function createInvite(role = "owner") {
      const { rows } = await asUser(db, f.cyUser, () =>
        db.query<{ id: string; token: string }>(
          `insert into public.invites (association_id, role, created_by)
           values ($1::uuid, $2::public.app_role, $3::uuid) returning id, token`,
          [f.damen, role, f.cyUser],
        ),
      );
      return rows[0];
    }

    it("lets a fresh user join at the invited role", async () => {
      const invite = await createInvite("board_member");
      await newAuthUser(freshUser, "invited@example.test");
      await asUser(db, freshUser, async () => {
        const { rows } = await db.query<{ redeem_invite: string }>(
          `select public.redeem_invite($1, $2)`,
          [invite.token, "Invited Person"],
        );
        expect(rows[0].redeem_invite).toBe(f.damen);

        const { rows: roleRows } = await db.query<{ role: string }>(
          `select role from public.role_grants where association_id = $1::uuid
             and person_id = (select id from public.persons where auth_user_id = $2::uuid)`,
          [f.damen, freshUser],
        );
        expect(roleRows.map((r) => r.role)).toEqual(["board_member"]);
      });
    });

    it("rejects a second redemption of the same invite", async () => {
      const invite = await createInvite();
      await newAuthUser(freshUser, "a@example.test");
      await newAuthUser(freshUser2, "b@example.test");

      await asUser(db, freshUser, () =>
        db.query(`select public.redeem_invite($1, $2)`, [invite.token, "First"]),
      );

      await asUser(db, freshUser2, async () => {
        await expect(
          db.query(`select public.redeem_invite($1, $2)`, [invite.token, "Second"]),
        ).rejects.toThrow(/already been used/i);
      });
    });

    it("rejects an expired invite", async () => {
      // invites has no UPDATE policy (deliberately — redeemed_at/redeemed_by
      // are written only by redeem_invite()), so an expired invite has to be
      // inserted with a past expires_at directly, not backdated after the fact.
      const { rows } = await asUser(db, f.cyUser, () =>
        db.query<{ token: string }>(
          `insert into public.invites (association_id, role, created_by, created_at, expires_at)
           values ($1::uuid, 'owner', $2::uuid, now() - interval '2 days', now() - interval '1 day')
           returning token`,
          [f.damen, f.cyUser],
        ),
      );
      const invite = rows[0];

      await newAuthUser(freshUser, "late@example.test");
      await asUser(db, freshUser, async () => {
        await expect(
          db.query(`select public.redeem_invite($1, $2)`, [invite.token, "Late"]),
        ).rejects.toThrow(/expired/i);
      });
    });

    it("rejects an invalid token", async () => {
      await newAuthUser(freshUser, "x@example.test");
      await asUser(db, freshUser, async () => {
        await expect(
          db.query(`select public.redeem_invite($1, $2)`, ["not-a-real-token", "Nobody"]),
        ).rejects.toThrow(/not valid/i);
      });
    });

    it("rejects a caller who already belongs to a building", async () => {
      const invite = await createInvite();
      await asUser(db, f.adaUser, async () => {
        await expect(
          db.query(`select public.redeem_invite($1, $2)`, [invite.token, "Ada Again"]),
        ).rejects.toThrow(/already belongs to a building/i);
      });
    });
  });

  // --------------------------------------------------------------------------
  // invites RLS
  // --------------------------------------------------------------------------

  describe("invites RLS", () => {
    it("lets a board_admin create, list, and delete invites for their own association", async () => {
      await asUser(db, f.cyUser, async () => {
        const { rows: created } = await db.query<{ id: string }>(
          `insert into public.invites (association_id, role, created_by)
           values ($1::uuid, 'owner', $2::uuid) returning id`,
          [f.damen, f.cyUser],
        );
        expect(created).toHaveLength(1);

        const { rows: listed } = await db.query<{ n: number }>(
          `select count(*)::int n from public.invites where association_id = $1::uuid`,
          [f.damen],
        );
        expect(listed[0].n).toBeGreaterThanOrEqual(1);

        const { affectedRows } = await db.query(`delete from public.invites where id = $1::uuid`, [
          created[0].id,
        ]);
        expect(affectedRows).toBe(1);
      });
    });

    it("rejects an owner-only caller creating an invite", async () => {
      await asUser(db, f.adaUser, async () => {
        await expect(
          db.query(
            `insert into public.invites (association_id, role, created_by)
             values ($1::uuid, 'owner', $2::uuid)`,
            [f.damen, f.adaUser],
          ),
        ).rejects.toThrow(/row-level security/i);
      });
    });

    it("rejects a board_admin creating or listing invites for a different association", async () => {
      await asUser(db, f.cyUser, async () => {
        await expect(
          db.query(
            `insert into public.invites (association_id, role, created_by)
             values ($1::uuid, 'owner', $2::uuid)`,
            [f.hoyne, f.cyUser],
          ),
        ).rejects.toThrow(/row-level security/i);

        const { rows } = await db.query<{ n: number }>(
          `select count(*)::int n from public.invites where association_id = $1::uuid`,
          [f.hoyne],
        );
        expect(rows[0].n).toBe(0); // RLS filtered the row, not visible even if one existed
      });
    });
  });
});
