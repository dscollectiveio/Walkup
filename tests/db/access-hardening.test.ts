import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

/**
 * Migration 0074: access hardening, step 1. Invites for an existing person, document visibility and
 * the accountant's reach, upkeep money, and the EIN.
 */

describe("access hardening (0074)", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
    // Bo is a board member.
    await db.query(
      `insert into public.role_grants (association_id, person_id, role, granted_on) values ($1::uuid, $2::uuid, 'board_member', '2024-01-01')`,
      [f.damen, f.boPerson],
    );
  });
  afterEach(async () => {
    await db.close();
  });

  const category = async (slug: string) =>
    (await db.query<{ id: string }>(`select id from public.document_categories where association_id = $1::uuid and slug = $2`, [f.damen, slug])).rows[0].id;

  async function fileDoc(slug: string | null, visibility = "board_only", user = f.cyUser) {
    const cat = slug ? await category(slug) : null;
    const { rows } = await asUser(db, user, () =>
      db.query<{ id: string }>(
        `insert into public.documents (association_id, storage_path, filename, visibility, category_id)
         values ($1::uuid, $2, $3, $4, $5::uuid) returning id`,
        [f.damen, `${f.damen}/${crypto.randomUUID()}.pdf`, `${slug ?? "unfiled"}.pdf`, visibility, cat],
      ),
    );
    return rows[0].id;
  }

  const idsFor = async (user: string) =>
    (await asUser(db, user, () => db.query<{ filename: string }>(`select filename from public.documents order by filename`))).rows.map((r) => r.filename);

  describe("invites for an existing person", () => {
    const invite = (user: string, person: string) =>
      asUser(db, user, () =>
        db.query(
          `insert into public.invites (association_id, role, created_by, person_id) values ($1::uuid, 'owner', $2::uuid, $3::uuid)`,
          [f.damen, user, person],
        ),
      );

    it("a board member cannot invite a person who holds a board role (the admin), but can invite an owner", async () => {
      // Bo is a board member. Cy is a board admin as well as an owner.
      await expect(invite(f.boUser, f.cyPerson)).rejects.toThrow(/only a board admin can invite/i);
      await expect(invite(f.boUser, f.adaPerson)).resolves.toBeDefined();
    });

    it("a board admin can still invite anyone", async () => {
      await expect(invite(f.cyUser, f.cyPerson)).resolves.toBeDefined();
    });
  });

  describe("documents", () => {
    it("only governing documents, minutes and financial statements can be shared with all owners", async () => {
      await expect(fileDoc("contract", "all_owners")).rejects.toThrow(/shared with all owners/i);
      await expect(fileDoc(null, "all_owners")).rejects.toThrow(/shared with all owners/i);
      for (const slug of ["governing", "minutes", "financial_statement"]) {
        await expect(fileDoc(slug, "all_owners")).resolves.toBeTruthy();
      }
    });

    it("changing a board-only document to all owners is checked too", async () => {
      const id = await fileDoc("bank_statement");
      await expect(
        asUser(db, f.cyUser, () => db.query(`update public.documents set visibility = 'all_owners' where id = $1::uuid`, [id])),
      ).rejects.toThrow(/shared with all owners/i);
    });

    it("the accountant reads accounting and tax records and what owners read, not the board's legal papers", async () => {
      await fileDoc("tax_form");
      await fileDoc("invoice");
      await fileDoc("vendor_document");
      await fileDoc("contract");
      await fileDoc("legal_notice");
      await fileDoc("correspondence");
      await fileDoc(null);
      await fileDoc("governing", "all_owners");
      expect(await idsFor(f.niaUser)).toEqual(["governing.pdf", "invoice.pdf", "tax_form.pdf", "vendor_document.pdf"]);
    });

    it("the board still sees everything and an owner sees only what is shared", async () => {
      await fileDoc("tax_form");
      await fileDoc("contract");
      await fileDoc("governing", "all_owners");
      expect(await idsFor(f.boUser)).toHaveLength(3);
      expect(await idsFor(f.adaUser)).toEqual(["governing.pdf"]);
    });
  });

  describe("upkeep money", () => {
    async function task() {
      const { rows } = await asUser(db, f.cyUser, () =>
        db.query<{ id: string }>(
          `insert into public.upkeep_tasks (association_id, name, interval_months, next_due_on, estimated_cost, created_by)
           values ($1::uuid, 'Boiler service', 12, '2027-09-01', 850, $2::uuid) returning id`,
          [f.damen, f.cyUser],
        ),
      );
      return rows[0].id;
    }

    it("an owner cannot read the tables but reads the calendar through the member view, without the cost", async () => {
      await task();
      const direct = await asUser(db, f.adaUser, () => db.query(`select * from public.upkeep_tasks`));
      expect(direct.rows).toHaveLength(0);
      const view = await asUser(db, f.adaUser, () => db.query<Record<string, unknown>>(`select * from public.upkeep_tasks_member`));
      expect(view.rows).toHaveLength(1);
      expect(view.rows[0].name).toBe("Boiler service");
      expect(Object.keys(view.rows[0])).not.toContain("estimated_cost");
      expect(Object.keys(view.rows[0])).not.toContain("vendor_id");
    });

    it("the accountant and the board still read the full table", async () => {
      await task();
      for (const u of [f.niaUser, f.cyUser, f.boUser]) {
        const r = await asUser(db, u, () => db.query(`select estimated_cost from public.upkeep_tasks`));
        expect(r.rows).toHaveLength(1);
      }
    });

    it("someone outside the building reads nothing from the view", async () => {
      await task();
      const r = await asUser(db, f.zaraUser, () => db.query(`select * from public.upkeep_tasks_member`));
      expect(r.rows).toHaveLength(0);
    });
  });

  describe("the EIN", () => {
    it("board and accountant read it, an owner cannot, and only an admin writes it", async () => {
      await asUser(db, f.cyUser, () =>
        db.query(`insert into public.association_tax_ids (association_id, ein) values ($1::uuid, '36-1234567')`, [f.damen]),
      );
      for (const u of [f.cyUser, f.boUser, f.niaUser]) {
        const r = await asUser(db, u, () => db.query<{ ein: string }>(`select ein from public.association_tax_ids`));
        expect(r.rows).toEqual([{ ein: "36-1234567" }]);
      }
      expect((await asUser(db, f.adaUser, () => db.query(`select ein from public.association_tax_ids`))).rows).toHaveLength(0);
      const upd = await asUser(db, f.boUser, () => db.query(`update public.association_tax_ids set ein = '00-0000000' where association_id = $1::uuid`, [f.damen]));
      expect(upd.affectedRows).toBe(0);
    });

    it("the associations row no longer has an EIN column", async () => {
      const { rows } = await db.query(`select 1 from information_schema.columns where table_schema = 'public' and table_name = 'associations' and column_name = 'ein'`);
      expect(rows).toHaveLength(0);
    });
  });
});

describe("the upkeep member views are read only (0083)", () => {
  let db: PGlite;
  let f: Fixture;
  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
    await asUser(db, f.cyUser, () =>
      db.query(
        `insert into public.upkeep_tasks (association_id, name, interval_months, next_due_on, created_by) values ($1::uuid, 'Boiler', 12, '2027-09-01', $2::uuid)`,
        [f.damen, f.cyUser],
      ),
    );
  });
  afterEach(async () => {
    await db.close();
  });

  it("no member can write through them", async () => {
    await expect(asUser(db, f.adaUser, () => db.query(`update public.upkeep_tasks_member set name = 'hacked'`))).rejects.toThrow(/permission denied/i);
    await expect(asUser(db, f.adaUser, () => db.query(`delete from public.upkeep_tasks_member`))).rejects.toThrow(/permission denied/i);
    await expect(asUser(db, f.adaUser, () => db.query(`update public.upkeep_log_member set note = 'x'`))).rejects.toThrow(/permission denied|cannot update view/i);
  });
});
