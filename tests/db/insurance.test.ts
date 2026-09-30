import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

const OTHER = "99999999-0000-0000-0000-000000000041";

describe("insurance (0041)", () => {
  let db: PGlite;
  let f: Fixture;
  let policyId: string;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
    policyId = await asUser(db, f.cyUser, async () => {
      const { rows } = await db.query<{ id: string }>(
        `insert into public.insurance_policies
           (association_id, coverage, carrier_name, effective_from, effective_to, annual_premium,
            building_limit, water_damage_deductible, coverage_form)
         values ($1::uuid, 'property', 'West Bend', '2026-06-01', '2027-06-01', 3766.00, 2400000.00, 25000.00, 'single_entity')
         returning id`,
        [f.damen],
      );
      return rows[0].id;
    });
  });

  describe("platform admin and broker partners", () => {
    const addPartner = (user: string) =>
      asUser(db, user, () =>
        db.query(
          `insert into public.insurance_partners (name, contact_email, states_served) values ('Test Broker', 'q@example.test', '{IL}')`,
        ),
      );

    it("ships with no partners and no platform admins", async () => {
      const { rows: p } = await db.query(`select id from public.insurance_partners`);
      const { rows: a } = await db.query(`select user_id from public.platform_admins`);
      expect(p).toHaveLength(0);
      expect(a).toHaveLength(0);
    });

    it("a board admin can't add a broker — only a platform admin can", async () => {
      await expect(addPartner(f.cyUser)).rejects.toThrow(/row-level security/);
      await db.query(`insert into public.platform_admins (user_id) values ($1::uuid)`, [f.cyUser]);
      expect((await addPartner(f.cyUser)).affectedRows).toBe(1);
    });

    it("boards see active partners only; is_platform_admin reflects the table", async () => {
      await db.query(`insert into public.platform_admins (user_id) values ($1::uuid)`, [f.cyUser]);
      await addPartner(f.cyUser);
      await asUser(db, f.cyUser, () => db.query(`update public.insurance_partners set active = false`));
      await db.query(`delete from public.platform_admins`);
      const { rows } = await asUser(db, f.cyUser, () => db.query(`select id from public.insurance_partners`));
      expect(rows).toHaveLength(0);
      const { rows: flag } = await asUser(db, f.cyUser, () =>
        db.query<{ is_platform_admin: boolean }>(`select public.is_platform_admin()`),
      );
      expect(flag[0].is_platform_admin).toBe(false);
    });

    it("nobody can read the platform_admins table through the API", async () => {
      await db.query(`insert into public.platform_admins (user_id) values ($1::uuid)`, [f.cyUser]);
      const { rows } = await asUser(db, f.cyUser, () => db.query(`select user_id from public.platform_admins`));
      expect(rows).toHaveLength(0);
    });
  });

  describe("claims and provenance", () => {
    it("a board member can record a claim tied to a repair; an owner can't", async () => {
      const claim = (user: string) =>
        asUser(db, user, () =>
          db.query(
            `insert into public.insurance_claims (association_id, policy_id, ticket_id, date_of_loss, description)
             values ($1::uuid, $2::uuid, $3::uuid, '2026-08-01', 'Roof leak into the stairwell')`,
            [f.damen, policyId, f.ticketCommon],
          ),
        );
      expect((await claim(f.cyUser)).affectedRows).toBe(1);
      await expect(claim(f.adaUser)).rejects.toThrow(/row-level security/);
    });

    it("refuses a claim or a field source pointing at another association's policy", async () => {
      await db.query(
        `insert into public.associations (id, legal_name, display_name, state_code) values ($1::uuid, 'Other', 'Other', 'IL')`,
        [OTHER],
      );
      const { rows } = await db.query<{ id: string }>(
        `insert into public.insurance_policies (association_id, coverage, carrier_name, effective_from, effective_to, annual_premium)
         values ($1::uuid, 'property', 'Elsewhere', '2026-01-01', '2027-01-01', 100) returning id`,
        [OTHER],
      );
      await expect(
        asUser(db, f.cyUser, () =>
          db.query(
            `insert into public.insurance_claims (association_id, policy_id, date_of_loss, description)
             values ($1::uuid, $2::uuid, '2026-08-01', 'x')`,
            [f.damen, rows[0].id],
          ),
        ),
      ).rejects.toThrow(/different association/);
      await expect(
        asUser(db, f.cyUser, () =>
          db.query(
            `insert into public.insurance_policy_field_sources (association_id, policy_id, field_name, source)
             values ($1::uuid, $2::uuid, 'building_limit', 'manual')`,
            [f.damen, rows[0].id],
          ),
        ),
      ).rejects.toThrow(/different association/);
    });

    it("stores where each saved value came from, one row per field", async () => {
      await asUser(db, f.cyUser, () =>
        db.query(
          `insert into public.insurance_policy_field_sources
             (association_id, policy_id, field_name, source, page_number, confidence, raw_text_snippet)
           values ($1::uuid, $2::uuid, 'building_limit', 'extracted', 2, 0.97, 'Building Limit $2,400,000')`,
          [f.damen, policyId],
        ),
      );
      await expect(
        asUser(db, f.cyUser, () =>
          db.query(
            `insert into public.insurance_policy_field_sources (association_id, policy_id, field_name, source)
             values ($1::uuid, $2::uuid, 'building_limit', 'manual')`,
            [f.damen, policyId],
          ),
        ),
      ).rejects.toThrow(/duplicate key/);
    });
  });

  describe("quote requests", () => {
    let partnerId: string;
    beforeEach(async () => {
      const { rows } = await db.query<{ id: string }>(
        `insert into public.insurance_partners (name, contact_email, states_served) values ('Test Broker', 'q@example.test', '{IL}') returning id`,
      );
      partnerId = rows[0].id;
    });

    it("starts as a draft and can't be marked sent without a sent date", async () => {
      const { rows } = await asUser(db, f.cyUser, () =>
        db.query<{ id: string; status: string }>(
          `insert into public.insurance_quote_requests (association_id, policy_id, partner_id, payload_json)
           values ($1::uuid, $2::uuid, $3::uuid, '{}') returning id, status`,
          [f.damen, policyId, partnerId],
        ),
      );
      expect(rows[0].status).toBe("draft");
      await expect(
        asUser(db, f.cyUser, () =>
          db.query(`update public.insurance_quote_requests set status = 'sent' where id = $1::uuid`, [rows[0].id]),
        ),
      ).rejects.toThrow(/check/);
      const ok = await asUser(db, f.cyUser, () =>
        db.query(`update public.insurance_quote_requests set status = 'sent', sent_at = now() where id = $1::uuid`, [rows[0].id]),
      );
      expect(ok.affectedRows).toBe(1);
    });

    it("an owner can't see or create requests", async () => {
      await expect(
        asUser(db, f.adaUser, () =>
          db.query(
            `insert into public.insurance_quote_requests (association_id, partner_id, payload_json) values ($1::uuid, $2::uuid, '{}')`,
            [f.damen, partnerId],
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it("a received quote carries the same limits and deductibles as a policy", async () => {
      const ok = await asUser(db, f.cyUser, () =>
        db.query(
          `insert into public.insurance_quotes
             (association_id, coverage, carrier_name, quoted_on, annual_premium, building_limit, water_damage_deductible, coverage_form)
           values ($1::uuid, 'property', 'Carrier Q', '2026-09-30', 3500.00, 2000000.00, 10000.00, 'unknown')`,
          [f.damen],
        ),
      );
      expect(ok.affectedRows).toBe(1);
    });
  });
});
