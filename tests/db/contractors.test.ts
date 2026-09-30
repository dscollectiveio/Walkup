import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

describe("contractors (0040)", () => {
  let db: PGlite;
  let f: Fixture;
  let vendorId: string;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
    vendorId = await asUser(db, f.cyUser, async () => {
      const { rows } = await db.query<{ id: string }>(
        `insert into public.vendors (association_id, name, trades, phone)
         values ($1::uuid, 'Damen Plumbing', '{plumbing}', '(312) 555-0100') returning id`,
        [f.damen],
      );
      return rows[0].id;
    });
  });

  describe("status", () => {
    it("keeps is_preferred in step with status", async () => {
      const { rows } = await asUser(db, f.cyUser, () =>
        db.query<{ is_preferred: boolean }>(
          `update public.vendors set status = 'preferred' where id = $1::uuid returning is_preferred`,
          [vendorId],
        ),
      );
      expect(rows[0].is_preferred).toBe(true);
    });

    it("refuses 'do not use' without a reason, and clears the reason when status changes back", async () => {
      await expect(
        asUser(db, f.cyUser, () =>
          db.query(`update public.vendors set status = 'do_not_use' where id = $1::uuid`, [vendorId]),
        ),
      ).rejects.toThrow(/do_not_use_needs_reason/);

      await asUser(db, f.cyUser, () =>
        db.query(
          `update public.vendors set status = 'do_not_use', do_not_use_reason = 'No-show twice' where id = $1::uuid`,
          [vendorId],
        ),
      );
      const { rows } = await asUser(db, f.cyUser, () =>
        db.query<{ do_not_use_reason: string | null }>(
          `update public.vendors set status = 'okay' where id = $1::uuid returning do_not_use_reason`,
          [vendorId],
        ),
      );
      expect(rows[0].do_not_use_reason).toBeNull();
    });
  });

  it("saves a Google place only once per association", async () => {
    const insert = () =>
      asUser(db, f.cyUser, () =>
        db.query(
          `insert into public.vendors (association_id, name, trades, source, google_place_id)
           values ($1::uuid, $2, '{roofing}', 'google', 'place-abc')`,
          [f.damen, `Roofer ${Math.random()}`],
        ),
      );
    await insert();
    await expect(insert()).rejects.toThrow(/vendors_google_place_unique/);
  });

  describe("contractor_reviews", () => {
    const review = (user: string, vendor = vendorId) =>
      asUser(db, user, () =>
        db.query(
          `insert into public.contractor_reviews (association_id, vendor_id, rating, body)
           values ($1::uuid, $2::uuid, 4, 'Fixed the riser same day')`,
          [f.damen, vendor],
        ),
      );

    it("a board member can review", async () => {
      expect((await review(f.cyUser)).affectedRows).toBe(1);
    });

    it("an owner can't review or read reviews", async () => {
      await expect(review(f.adaUser)).rejects.toThrow(/row-level security/);
      await review(f.cyUser);
      const { rows } = await asUser(db, f.adaUser, () => db.query(`select id from public.contractor_reviews`));
      expect(rows).toHaveLength(0);
    });

    it("a review can't point at another association's contractor", async () => {
      const other = "99999999-0000-0000-0000-000000000040";
      await db.query(
        `insert into public.associations (id, legal_name, display_name, state_code) values ($1::uuid, 'Other', 'Other', 'IL')`,
        [other],
      );
      const { rows } = await db.query<{ id: string }>(
        `insert into public.vendors (association_id, name) values ($1::uuid, 'Elsewhere Co') returning id`,
        [other],
      );
      await expect(review(f.cyUser, rows[0].id)).rejects.toThrow(/different association/);
    });
  });

  it("the search cache and call log are board-only", async () => {
    await asUser(db, f.cyUser, async () => {
      await db.query(
        `insert into public.contractor_search_cache (association_id, trade, results_json) values ($1::uuid, 'plumbing', '[]')`,
        [f.damen],
      );
      await db.query(
        `insert into public.google_api_calls (association_id, kind, trade) values ($1::uuid, 'text_search', 'plumbing')`,
        [f.damen],
      );
    });
    const cache = await asUser(db, f.adaUser, () => db.query(`select id from public.contractor_search_cache`));
    const calls = await asUser(db, f.adaUser, () => db.query(`select id from public.google_api_calls`));
    expect(cache.rows).toHaveLength(0);
    expect(calls.rows).toHaveLength(0);
  });
});
