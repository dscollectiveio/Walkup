import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asService, asUser } from "./harness";
import type { Fixture } from "./fixtures";
import { EXTRA, addExpenses, addHoyneTicket, addVendors, boBoard, pgError, queries, seededDb } from "./repairs-helpers";

/**
 * Migrations 0077 and 0080: the three outside roles. A property manager runs the repairs and reads units and
 * people; an attorney reads only the legal documents the board shared with them; an observer reads what an
 * owner reads plus the finances summary. These tests hold each one to exactly that: what they can read, what
 * they can write, and everything they can't.
 */

const PAT_USER = "dddd0000-0000-0000-0000-0000000000a1"; // property manager
const LEE_USER = "dddd0000-0000-0000-0000-0000000000a2"; // attorney
const OLA_USER = "dddd0000-0000-0000-0000-0000000000a3"; // observer
const PAT = "eeee0000-0000-0000-0000-0000000000a1";
const LEE = "eeee0000-0000-0000-0000-0000000000a2";
const OLA = "eeee0000-0000-0000-0000-0000000000a3";
const NEW_USER = "dddd0000-0000-0000-0000-0000000000b1";

let db: PGlite;
let f: Fixture;
const { q, one, rows, count } = queries(() => db);

beforeEach(async () => {
  ({ db, f } = await seededDb());
  await db.exec(`
    insert into auth.users (id, email) values
      ('${PAT_USER}', 'pat@example.test'), ('${LEE_USER}', 'lee@example.test'), ('${OLA_USER}', 'ola@example.test');
    insert into public.persons (id, association_id, full_name, email, auth_user_id) values
      ('${PAT}', '${f.damen}', 'Pat Manager', 'pat@example.test', '${PAT_USER}'),
      ('${LEE}', '${f.damen}', 'Lee Counsel', 'lee@example.test', '${LEE_USER}'),
      ('${OLA}', '${f.damen}', 'Ola Observer', 'ola@example.test', '${OLA_USER}');
    insert into public.role_grants (association_id, person_id, role, granted_on, expires_on) values
      ('${f.damen}', '${PAT}', 'property_manager', current_date, current_date + 90),
      ('${f.damen}', '${LEE}', 'attorney', current_date, current_date + 90),
      ('${f.damen}', '${OLA}', 'observer', current_date, current_date + 90);
  `);
});
afterEach(async () => {
  await db.close();
});

const OUTSIDE = [
  ["property manager", PAT_USER],
  ["attorney", LEE_USER],
  ["observer", OLA_USER],
] as const;

const category = async (slug: string) =>
  (await one<{ id: string }>(null, `select id from public.document_categories where association_id = $1::uuid and slug = $2`, [f.damen, slug])).id;

/** A document filed by the board admin, in a category, optionally pinned to a unit or marked for all owners. */
async function fileDoc(slug: string, opts: { visibility?: "board_only" | "all_owners"; unit?: string | null; binned?: boolean } = {}) {
  const id = (
    await one<{ id: string }>(
      f.cyUser,
      `insert into public.documents (association_id, storage_path, filename, visibility, category_id, restricted_to_unit_id)
       values ($1::uuid, $2, $3, $4, $5::uuid, $6::uuid) returning id`,
      [f.damen, `${f.damen}/${crypto.randomUUID()}.pdf`, `${slug}${opts.unit ? "-pinned" : ""}.pdf`, opts.visibility ?? "board_only", await category(slug), opts.unit ?? null],
    )
  ).id;
  if (opts.binned) await db.query(`update public.documents set deleted_at = now() where id = $1::uuid`, [id]);
  return id;
}

// Sorted here, not in SQL, so the order does not depend on the database's collation.
const docNames = async (user: string) => (await rows<{ filename: string }>(user, `select filename from public.documents`)).map((r) => r.filename).sort();

describe("the grants", () => {
  it("an outside grant must have an end date", async () => {
    for (const role of ["property_manager", "attorney", "observer"]) {
      const e = await pgError(
        db.query(
          `insert into public.role_grants (association_id, person_id, role, granted_on, expires_on) values ($1::uuid, $2::uuid, $3::public.app_role, current_date, null)`,
          [f.damen, f.adaPerson, role],
        ),
      );
      expect(e.message, role).toMatch(/role_grants_outside_role_ends/);
    }
  });

  it("access that has run out reads nothing, and the daily clean-up stamps it", async () => {
    await fileDoc("governing", { visibility: "all_owners" });
    await db.query(`update public.role_grants set granted_on = current_date - 100, expires_on = current_date - 1 where person_id in ($1::uuid, $2::uuid, $3::uuid)`, [PAT, LEE, OLA]);
    for (const [, user] of OUTSIDE) {
      expect((await one<{ m: boolean }>(user, `select public.is_member($1::uuid) as m`, [f.damen])).m).toBe(false);
      expect(await docNames(user)).toEqual([]);
    }
    await asService(db, () => db.query(`select public.deprovision_stale_access($1::uuid)`, [f.damen]));
    expect(await count(`select 1 from public.role_grants where person_id in ('${PAT}', '${LEE}', '${OLA}') and revoked_at is not null`)).toBe(3);
  });

  it("a sign-in without the second step reads nothing", async () => {
    await fileDoc("governing", { visibility: "all_owners" });
    for (const [, user] of OUTSIDE) {
      const r = await asUser(db, user, () => db.query<{ m: boolean }>(`select public.is_member($1::uuid) as m`, [f.damen]), { aal: "aal1" });
      expect(r.rows[0].m).toBe(false);
      const d = await asUser(db, user, () => db.query(`select 1 from public.documents`), { aal: "aal1" });
      expect(d.rows).toHaveLength(0);
    }
  });

  it("the viewer's context names the role and who may work the repairs", async () => {
    const ctx = (user: string) =>
      one<{ roles: string[]; is_board: boolean; can_read_financials: boolean; can_manage_repairs: boolean }>(user, `select * from public.viewer_context($1::uuid)`, [f.damen]);
    expect(await ctx(PAT_USER)).toMatchObject({ roles: ["property_manager"], is_board: false, can_read_financials: false, can_manage_repairs: true });
    expect(await ctx(LEE_USER)).toMatchObject({ roles: ["attorney"], is_board: false, can_read_financials: false, can_manage_repairs: false });
    expect(await ctx(OLA_USER)).toMatchObject({ roles: ["observer"], is_board: false, can_read_financials: false, can_manage_repairs: false });
    expect(await ctx(f.cyUser)).toMatchObject({ is_board: true, can_manage_repairs: true });
    expect(await ctx(f.adaUser)).toMatchObject({ is_board: false, can_manage_repairs: false });
  });
});

describe("invites", () => {
  const invite = (user: string, role: string, email: string | null = "new@example.test") =>
    q<{ token: string }>(user, `insert into public.invites (association_id, role, email, created_by) values ($1::uuid, $2::public.app_role, $3, $4::uuid) returning token`, [f.damen, role, email, user]);

  it("only a board admin can invite one, a board member cannot", async () => {
    await boBoard(db, f);
    for (const role of ["property_manager", "attorney", "observer"]) {
      expect((await pgError(invite(f.boUser, role))).code, role).toBe("42501");
      await expect(invite(f.cyUser, role)).resolves.toBeDefined();
    }
  });

  it("needs the invitee's email and lasts three days", async () => {
    for (const role of ["property_manager", "attorney", "observer"]) {
      expect((await pgError(invite(f.cyUser, role, null))).message, role).toMatch(/needs the email/i);
    }
    const made = await invite(f.cyUser, "attorney");
    expect(made.rows).toHaveLength(1);
    const r = await one<{ days: number }>(null, `select extract(epoch from (expires_at - created_at)) / 86400 as days from public.invites where token = $1`, [made.rows[0].token]);
    expect(Number(r.days)).toBeLessThanOrEqual(3.0001);
  });

  it("works only for that email, and the grant it makes ends in 90 days", async () => {
    for (const role of ["property_manager", "attorney", "observer"]) {
      const { token } = (await invite(f.cyUser, role, "new@example.test")).rows[0];
      await db.query(`insert into auth.users (id, email) values ($1::uuid, $2) on conflict (id) do update set email = excluded.email`, [NEW_USER, "someone-else@example.test"]);
      const wrong = await pgError(q(NEW_USER, `select public.redeem_invite($1, 'New Person')`, [token]));
      expect(wrong.message, role).toMatch(/email address this invite was sent to/);
      await db.query(`update auth.users set email = 'NEW@example.test' where id = $1::uuid`, [NEW_USER]);
      await q(NEW_USER, `select public.redeem_invite($1, 'New Person')`, [token]);
      const g = await one<{ role: string; days: number }>(
        null,
        `select g.role::text, (g.expires_on - current_date) as days from public.role_grants g join public.persons p on p.id = g.person_id where p.auth_user_id = $1::uuid`,
        [NEW_USER],
      );
      expect(g.role).toBe(role);
      expect(Number(g.days)).toBe(90);
      // Clear the new login for the next role.
      await db.query(`delete from public.role_grants where person_id in (select id from public.persons where auth_user_id = $1::uuid)`, [NEW_USER]);
      await db.query(`delete from public.persons where auth_user_id = $1::uuid`, [NEW_USER]);
    }
  });
});

describe("every outside role is a member and nothing more", () => {
  it("reads what an owner reads: announcements, the owners' documents, the board's contact and its own record", async () => {
    await q(f.cyUser, `select public.save_announcement($1::uuid, null::uuid, 'Water off', 'Tuesday 9 to 11', 'all', null::uuid[], false, null::uuid, null::date, true)`, [f.damen]);
    await fileDoc("governing", { visibility: "all_owners" });
    await fileDoc("contract");
    for (const [name, user] of OUTSIDE) {
      expect((await one<{ m: boolean; b: boolean; r: boolean }>(user, `select public.is_member($1::uuid) as m, public.is_board($1::uuid) as b, public.can_read_financials($1::uuid) as r`, [f.damen])), name).toEqual({
        m: true,
        b: false,
        r: false,
      });
      expect((await rows(user, `select id from public.announcements`)).length, name).toBe(1);
      expect(await rows(user, `select id from public.units`), name).toHaveLength(3);
    }
    expect(await docNames(OLA_USER)).toEqual(["governing.pdf"]);
  });

  it("reads no money: ledger, bank feed, charges, payments, expenses, bills, taxes, access records", async () => {
    await addExpenses(db, f);
    const tables = [
      "journal_entries",
      "journal_lines",
      "assessment_charges",
      "payments",
      "expenses",
      "recurring_bills",
      "assessment_schedules",
      "late_fee_rules",
      "tax_filings",
      "bank_transactions",
      "bank_connections",
      "ticket_expenses",
      "invites",
      "access_reviews",
      "audit_log",
      "association_tax_ids",
      "email_batches",
    ];
    for (const [name, user] of OUTSIDE) {
      for (const t of tables) {
        expect(await rows(user, `select 1 from public.${t}`), `${name} reads ${t}`).toHaveLength(0);
      }
      // Other people's roles are the board's to see.
      expect(await rows(user, `select 1 from public.role_grants where person_id not in ($1::uuid)`, [(await one<{ id: string }>(null, `select id from public.persons where auth_user_id = $1::uuid`, [user])).id]), name).toHaveLength(0);
    }
  });

  it("writes nothing the board writes: roles, invites, announcements, email, settings, the books", async () => {
    for (const [name, user] of OUTSIDE) {
      expect((await pgError(q(user, `insert into public.role_grants (association_id, person_id, role, granted_on) values ($1::uuid, $2::uuid, 'board_admin', current_date)`, [f.damen, f.adaPerson]))).code, name).toBe("42501");
      expect((await pgError(q(user, `insert into public.invites (association_id, role, email) values ($1::uuid, 'owner', 'x@example.test')`, [f.damen]))).code, name).toBe("42501");
      expect((await pgError(q(user, `select public.save_announcement($1::uuid, null::uuid, 'Hi', 'Body', 'all', null::uuid[], false, null::uuid, null::date, true)`, [f.damen]))).code, name).toBe("42501");
      expect((await pgError(q(user, `select public.email_approve_batch($1::uuid)`, [crypto.randomUUID()]))).code, name).toBe("42501");
      expect((await pgError(q(user, `select public.set_owner_finances_enabled($1::uuid, true)`, [f.damen]))).code, name).toBe("42501");
      expect((await q(user, `update public.associations set display_name = 'Mine'`)).affectedRows, name).toBe(0);
      expect((await q(user, `update public.units set label = 'Mine'`)).affectedRows, name).toBe(0);
      expect((await pgError(q(user, `insert into public.documents (association_id, storage_path, filename) values ($1::uuid, $2, 'y.pdf')`, [f.damen, `${f.damen}/${crypto.randomUUID()}.pdf`]))).code, name).toBe("42501");
      expect((await pgError(q(user, `insert into public.attorney_shares (association_id, person_id) values ($1::uuid, $2::uuid)`, [f.damen, LEE]))).code, name).toBe("42501");
      // An owner asks the board for an insurance certificate; the outside roles read, they do not file requests.
      expect((await pgError(q(user, `select public.request_insurance_proof($1::uuid, 'question', 'Is it covered?')`, [f.damen]))).code, name).toBe("42501");
    }
    await expect(q(f.adaUser, `select public.request_insurance_proof($1::uuid, 'question', 'Is it covered?')`, [f.damen])).resolves.toBeDefined();
  });

  it("reads no other person's record: the attorney and the observer see only themselves", async () => {
    for (const user of [LEE_USER, OLA_USER]) {
      expect(await rows(user, `select id from public.persons`)).toHaveLength(1);
      expect(await rows(user, `select 1 from public.unit_owners`)).toHaveLength(0);
      expect(await rows(user, `select 1 from public.unit_property_managers`)).toHaveLength(0);
    }
  });

  it("never sees another association", async () => {
    await addHoyneTicket(db, f);
    for (const [name, user] of OUTSIDE) {
      expect(await rows(user, `select 1 from public.tickets where id = $1::uuid`, [EXTRA.hoyneTicket]), name).toHaveLength(0);
      expect(await rows(user, `select 1 from public.associations where id = $1::uuid`, [f.hoyne]), name).toHaveLength(0);
    }
  });
});

describe("observer: the finances summary", () => {
  const enabled = (user: string) => one<{ e: boolean }>(user, `select public.owner_finances_enabled($1::uuid) as e`, [f.damen]).then((r) => r.e);
  const summary = (user: string) => one<{ s: unknown }>(user, `select public.owner_finances_summary($1::uuid) as s`, [f.damen]).then((r) => r.s);

  it("reads it while the board's switch is off; owners and the other outside roles do not", async () => {
    expect(await enabled(OLA_USER)).toBe(true);
    expect(await summary(OLA_USER)).not.toBeNull();
    for (const user of [f.adaUser, PAT_USER, LEE_USER, f.cyUser, f.niaUser]) {
      expect(await enabled(user)).toBe(false);
      expect(await summary(user)).toBeNull();
    }
  });

  it("turning the switch on opens it to owners without changing what the observer reads", async () => {
    await q(f.cyUser, `select public.set_owner_finances_enabled($1::uuid, true)`, [f.damen]);
    expect(await enabled(f.adaUser)).toBe(true);
    expect(await enabled(OLA_USER)).toBe(true);
    await q(f.cyUser, `select public.set_owner_finances_enabled($1::uuid, false)`, [f.damen]);
    expect(await enabled(OLA_USER)).toBe(true);
  });

  it("is read only: no problem reported, no note, no repairs change, no document", async () => {
    expect((await pgError(q(OLA_USER, `insert into public.tickets (association_id, title) values ($1::uuid, 'Leak')`, [f.damen]))).code).toBe("42501");
    expect((await q(OLA_USER, `update public.tickets set status = 'closed'`)).affectedRows).toBe(0);
    expect((await pgError(q(OLA_USER, `insert into public.ticket_comments (association_id, ticket_id, body) values ($1::uuid, $2::uuid, 'hi')`, [f.damen, f.ticketCommon]))).code).toBe("42501");
    expect((await pgError(q(OLA_USER, `select public.add_upkeep_task($1::uuid, 'x', null, 12, null, null, null, null, current_date, null, null)`, [f.damen]))).code).toBe("42501");
    expect((await one<{ ok: boolean }>(OLA_USER, `select public.can_add_ticket_photo($1::uuid) as ok`, [f.ticketCommon])).ok).toBe(false);
  });

  it("does not read upkeep money or contractors, only the member calendar", async () => {
    await addVendors(db, f);
    await q(f.cyUser, `select * from public.add_upkeep_task($1::uuid, 'Boiler service', null, 12, null, null, null, 850, '2027-09-01', null, null)`, [f.damen]);
    expect(await rows(OLA_USER, `select 1 from public.upkeep_tasks`)).toHaveLength(0);
    expect(await rows(OLA_USER, `select 1 from public.vendors`)).toHaveLength(0);
    expect(await rows(OLA_USER, `select 1 from public.upkeep_tasks_member`)).toHaveLength(1);
  });
});

describe("property manager", () => {
  const pat = (sql: string, params: unknown[] = []) => q(PAT_USER, sql, params);

  describe("repairs, with a board member's powers", () => {
    it("reports and works a problem in any unit, plans it, and writes internal notes only the board and the manager read", async () => {
      await addVendors(db, f);
      const t = await one<{ id: string }>(PAT_USER, `insert into public.tickets (association_id, title, unit_id) values ($1::uuid, 'Hall light out', $2::uuid) returning id`, [f.damen, f.unit2]);
      expect((await pat(`update public.tickets set status = 'in_progress', assigned_vendor_id = $2::uuid where id = $1::uuid`, [t.id, EXTRA.damenVendor])).affectedRows).toBe(1);
      await pat(`select public.set_ticket_plan($1::uuid, '{"scheduled_for":"2027-01-12","estimated_cost":"150"}'::jsonb)`, [t.id]);
      expect(await one(PAT_USER, `select estimated_cost::text as c from public.ticket_board_details where ticket_id = $1::uuid`, [t.id])).toEqual({ c: "150.00" });
      await pat(`insert into public.ticket_comments (association_id, ticket_id, body, is_internal) values ($1::uuid, $2::uuid, 'Door code is 4411', true)`, [f.damen, t.id]);
      await pat(`insert into public.ticket_comments (association_id, ticket_id, body, is_internal) values ($1::uuid, $2::uuid, 'Contractor coming Tuesday', false)`, [f.damen, t.id]);
      expect(await rows(PAT_USER, `select body from public.ticket_comments where ticket_id = $1::uuid order by body`, [t.id])).toHaveLength(2);
      expect(await rows(f.cyUser, `select body from public.ticket_comments where ticket_id = $1::uuid`, [t.id])).toHaveLength(2);
      // Bo owns unit 2 and reads the update but not the internal note; the observer reads only the update.
      expect((await rows(f.boUser, `select body from public.ticket_comments where ticket_id = $1::uuid`, [t.id])).map((r) => (r as { body: string }).body)).toEqual(["Contractor coming Tuesday"]);
      await pat(`select public.set_ticket_priority($1::uuid, 'urgent', null)`, [t.id]);
      await pat(`select * from public.close_out_ticket($1::uuid, 'resolved', null, null, 'Replaced the bulb', false)`, [t.id]);
      expect((await one<{ status: string }>(null, `select status::text from public.tickets where id = $1::uuid`, [t.id])).status).toBe("resolved");
    });

    it("asks for quotes, and reads the quotes and the contractors, which an observer does not", async () => {
      await addVendors(db, f);
      const r = await pat(`select * from public.request_ticket_quotes($1::uuid, $2::jsonb)`, [f.ticketCommon, JSON.stringify([{ vendor_id: EXTRA.damenVendor, by_phone: true }])]);
      expect(r.rows).toHaveLength(1);
      expect(await rows(PAT_USER, `select 1 from public.ticket_bids`)).toHaveLength(1);
      // The contractor list comes through vendors_manager (0081); the table, with its tax identity, is not theirs.
      expect((await rows(PAT_USER, `select 1 from public.vendors_manager`)).length).toBeGreaterThan(0);
      expect(await rows(PAT_USER, `select 1 from public.vendors`)).toHaveLength(0);
      expect(await rows(OLA_USER, `select 1 from public.ticket_bids`)).toHaveLength(0);
      expect(await rows(LEE_USER, `select 1 from public.vendors`)).toHaveLength(0);
    });

    it("runs the upkeep: adds a job, marks it done, reads the cost columns", async () => {
      const task = await one<{ id: string }>(PAT_USER, `select task_id as id from public.add_upkeep_task($1::uuid, 'Boiler service', null, 12, null, null, null, 850, '2027-09-01', null, null)`, [f.damen]);
      await pat(`select * from public.mark_upkeep_done($1::uuid, current_date, 800, null, 'Serviced', null)`, [task.id]);
      expect(await one(PAT_USER, `select estimated_cost::text as c from public.upkeep_tasks where id = $1::uuid`, [task.id])).toEqual({ c: "850.00" });
      expect(await rows(PAT_USER, `select 1 from public.upkeep_log`)).toHaveLength(1);
    });

    it("can't delete, can't touch contractors, and can't link a payment to a problem", async () => {
      await addVendors(db, f);
      await addExpenses(db, f);
      expect((await pat(`delete from public.tickets where id = $1::uuid`, [f.ticketCommon])).affectedRows).toBe(0);
      expect((await pat(`delete from public.ticket_comments`)).affectedRows).toBe(0);
      expect((await pat(`delete from public.upkeep_tasks`)).affectedRows).toBe(0);
      expect((await pgError(pat(`insert into public.vendors (association_id, name) values ($1::uuid, 'New Co')`, [f.damen]))).code).toBe("42501");
      expect((await pat(`update public.vendors set name = 'Renamed'`)).affectedRows).toBe(0);
      expect((await pgError(pat(`select public.set_ticket_payments($1::uuid, array[$2::uuid], 450)`, [f.ticketCommon, EXTRA.damenExpense]))).code).toBe("42501");
      expect((await pgError(pat(`select * from public.close_out_ticket($1::uuid, 'resolved', 450, $2::uuid, null, false)`, [f.ticketCommon, EXTRA.damenExpense]))).code).toBe("42501");
      expect(await rows(PAT_USER, `select 1 from public.expenses`)).toHaveLength(0);
      expect(await rows(PAT_USER, `select 1 from public.ticket_expenses`)).toHaveLength(0);
    });

    it("reads no bills and can't mark one paid", async () => {
      const bill = await one<{ id: string }>(null, `select id from public.recurring_bills limit 1`);
      expect(await rows(PAT_USER, `select 1 from public.recurring_bills`)).toHaveLength(0);
      expect((await pgError(pat(`select * from public.mark_bill_paid($1::uuid, current_date, current_date, 10, null, null)`, [bill.id]))).code).toBe("42501");
    });

    it("sees problems only in its own building", async () => {
      await addHoyneTicket(db, f);
      expect(await rows(PAT_USER, `select 1 from public.tickets where id = $1::uuid`, [EXTRA.hoyneTicket])).toHaveLength(0);
      expect((await pgError(pat(`insert into public.tickets (association_id, title) values ($1::uuid, 'Wrong building')`, [f.hoyne]))).code).toBe("42501");
    });
  });

  describe("units and people, with contact details", () => {
    it("reads every person's email and phone, the owners of each unit and a unit's own property manager", async () => {
      const mgr = await one<{ id: string }>(null, `insert into public.persons (association_id, full_name, email) values ($1::uuid, 'Unit Manager', 'um@example.test') returning id`, [f.damen]);
      await db.query(`insert into public.person_contact_details (person_id, association_id, phone) values ($1::uuid, $2::uuid, '555-0100')`, [mgr.id, f.damen]);
      await db.query(`insert into public.unit_property_managers (unit_id, association_id, person_id, company) values ($1::uuid, $2::uuid, $3::uuid, 'Lakeside Mgmt')`, [f.unit1, f.damen, mgr.id]);
      const people = await rows<{ email: string | null }>(PAT_USER, `select email from public.persons`);
      expect(people.length).toBeGreaterThanOrEqual(7);
      expect(people.map((p) => p.email)).toContain("bo@example.test");
      // The phone is in person_contact_details (0082), which a property manager reads and the other outside roles do not.
      expect((await rows<{ phone: string | null }>(PAT_USER, `select phone from public.person_contact_details`)).map((r) => r.phone)).toContain("555-0100");
      for (const user of [LEE_USER, OLA_USER]) expect(await rows(user, `select 1 from public.person_contact_details`)).toHaveLength(0);
      expect((await rows(PAT_USER, `select 1 from public.unit_owners`)).length).toBeGreaterThanOrEqual(3);
      expect(await rows(PAT_USER, `select 1 from public.unit_property_managers`)).toHaveLength(1);
      expect(await rows(LEE_USER, `select 1 from public.unit_property_managers`)).toHaveLength(0);
    });

    it("can't change a person, an owner row or a unit's manager", async () => {
      expect((await pat(`update public.persons set email = 'x@example.test' where id = $1::uuid`, [f.boPerson])).affectedRows).toBe(0);
      expect((await pgError(pat(`insert into public.unit_owners (association_id, unit_id, person_id, effective_from) values ($1::uuid, $2::uuid, $3::uuid, current_date)`, [f.damen, f.unit1, PAT]))).code).toBe("42501");
      expect((await pgError(pat(`insert into public.persons (association_id, full_name) values ($1::uuid, 'Planted')`, [f.damen]))).code).toBe("42501");
    });

    it("sees where each unit stands on dues through one summary function, nothing underneath", async () => {
      const standing = await rows<{ unit_label: string; overdue: string; owed: string; net: string }>(PAT_USER, `select * from public.manager_unit_standing($1::uuid)`, [f.damen]);
      expect(standing.map((s) => s.unit_label)).toEqual(["Unit 1", "Unit 2", "Unit 3"]);
      expect(standing.find((s) => s.unit_label === "Unit 2")).toMatchObject({ owed: "750.00", overdue: "750.00", net: "750.00" });
      expect(standing.find((s) => s.unit_label === "Unit 3")).toMatchObject({ owed: "0.00", overdue: "0.00" });
      expect(Object.keys(standing[0]).sort()).toEqual(["as_of", "credit", "net", "next_due_on", "oldest_overdue_on", "open_charges", "overdue", "owed", "unit_id", "unit_label"]);
      expect(await rows(PAT_USER, `select 1 from public.assessment_charges`)).toHaveLength(0);
      expect(await rows(PAT_USER, `select 1 from public.payments`)).toHaveLength(0);
      for (const user of [LEE_USER, OLA_USER, f.adaUser, f.niaUser]) {
        expect(await rows(user, `select 1 from public.manager_unit_standing($1::uuid)`, [f.damen])).toHaveLength(0);
      }
    });
  });

  describe("documents", () => {
    it("reads maintenance, permit, vendor, contract, insurance and unit records, and what every owner reads, and nothing else", async () => {
      for (const slug of ["maintenance", "permit", "vendor_document", "contract", "insurance", "unit_record"]) await fileDoc(slug);
      await fileDoc("governing", { visibility: "all_owners" });
      for (const slug of ["tax_form", "invoice", "receipt", "bank_statement", "legal_notice", "correspondence", "other"]) await fileDoc(slug);
      await fileDoc("maintenance", { binned: true });
      await fileDoc("contract", { unit: f.unit2 });
      expect(await docNames(PAT_USER)).toEqual([
        "contract-pinned.pdf",
        "contract.pdf",
        "governing.pdf",
        "insurance.pdf",
        "maintenance.pdf",
        "permit.pdf",
        "unit_record.pdf",
        "vendor_document.pdf",
      ]);
    });

    it("can't file, change or bin a document", async () => {
      const id = await fileDoc("maintenance");
      expect((await pat(`update public.documents set title = 'Mine' where id = $1::uuid`, [id])).affectedRows).toBe(0);
      expect((await pat(`update public.documents set deleted_at = now() where id = $1::uuid`, [id])).affectedRows).toBe(0);
    });

    it("the accountant and the owners keep the reach they had", async () => {
      for (const slug of ["tax_form", "legal_notice", "maintenance"]) await fileDoc(slug);
      await fileDoc("governing", { visibility: "all_owners" });
      expect(await docNames(f.niaUser)).toEqual(["governing.pdf", "tax_form.pdf"]);
      expect(await docNames(f.adaUser)).toEqual(["governing.pdf"]);
    });
  });
});

describe("attorney", () => {
  const share = (unit: string | null, person = LEE) =>
    q(f.cyUser, `insert into public.attorney_shares (association_id, person_id, unit_id) values ($1::uuid, $2::uuid, $3::uuid) returning id`, [f.damen, person, unit]);

  async function legalFiles() {
    await fileDoc("legal_notice");
    await fileDoc("contract");
    await fileDoc("correspondence");
    await fileDoc("legal_notice", { unit: f.unit2 });
    await fileDoc("correspondence", { unit: f.unit1 });
    await fileDoc("tax_form");
    await fileDoc("maintenance");
    await fileDoc("governing", { visibility: "all_owners" });
  }

  it("reads only what every owner reads until the board shares something", async () => {
    await legalFiles();
    expect(await docNames(LEE_USER)).toEqual(["governing.pdf"]);
  });

  it("a building-wide share opens the legal documents that belong to no unit, in three categories only", async () => {
    await legalFiles();
    await share(null);
    expect(await docNames(LEE_USER)).toEqual(["contract.pdf", "correspondence.pdf", "governing.pdf", "legal_notice.pdf"]);
  });

  it("a unit share opens that unit's legal documents and no other unit's", async () => {
    await legalFiles();
    await share(f.unit2);
    expect(await docNames(LEE_USER)).toEqual(["governing.pdf", "legal_notice-pinned.pdf"]);
    await share(f.unit1);
    expect(await docNames(LEE_USER)).toEqual(["correspondence-pinned.pdf", "governing.pdf", "legal_notice-pinned.pdf"]);
    await share(null);
    expect(await docNames(LEE_USER)).toEqual([
      "contract.pdf",
      "correspondence-pinned.pdf",
      "correspondence.pdf",
      "governing.pdf",
      "legal_notice-pinned.pdf",
      "legal_notice.pdf",
    ]);
  });

  it("does not read a binned document, and loses everything when the grant ends", async () => {
    await fileDoc("legal_notice", { binned: true });
    await fileDoc("contract");
    await share(null);
    expect(await docNames(LEE_USER)).toEqual(["contract.pdf"]);
    await db.query(`update public.role_grants set granted_on = current_date - 100, expires_on = current_date - 1 where person_id = $1::uuid`, [LEE]);
    expect(await docNames(LEE_USER)).toEqual([]);
  });

  it("only a board admin writes shares, only for someone who holds the attorney role, in this building", async () => {
    await boBoard(db, f);
    expect((await pgError(q(f.boUser, `insert into public.attorney_shares (association_id, person_id) values ($1::uuid, $2::uuid)`, [f.damen, LEE]))).code).toBe("42501");
    expect((await pgError(q(LEE_USER, `insert into public.attorney_shares (association_id, person_id) values ($1::uuid, $2::uuid)`, [f.damen, LEE]))).code).toBe("42501");
    expect((await pgError(share(null, f.adaPerson))).code).toBe("23514");
    expect((await pgError(q(f.cyUser, `insert into public.attorney_shares (association_id, person_id, unit_id) values ($1::uuid, $2::uuid, $3::uuid)`, [f.damen, LEE, "bbbb2222-0000-0000-0000-000000000001"]))).code).toBe("42501");
    const made = await share(f.unit2);
    expect((await pgError(share(f.unit2))).code).toBe("23505");
    const id = made.rows[0].id;
    expect((await q(f.cyUser, `update public.attorney_shares set unit_id = null where id = $1::uuid`, [id])).affectedRows).toBe(0);
    expect((await q(f.boUser, `delete from public.attorney_shares where id = $1::uuid`, [id])).affectedRows).toBe(0);
    expect((await q(LEE_USER, `delete from public.attorney_shares where id = $1::uuid`, [id])).affectedRows).toBe(0);
    expect((await q(f.cyUser, `delete from public.attorney_shares where id = $1::uuid`, [id])).affectedRows).toBe(1);
  });

  it("the board and the attorney read the shares; nobody else does", async () => {
    await share(f.unit2);
    expect(await rows(f.cyUser, `select 1 from public.attorney_shares`)).toHaveLength(1);
    expect(await rows(f.boUser, `select 1 from public.attorney_shares`)).toHaveLength(0); // Bo is an owner here, not the board
    expect(await rows(LEE_USER, `select 1 from public.attorney_shares`)).toHaveLength(1);
    for (const user of [f.adaUser, f.niaUser, PAT_USER, OLA_USER]) expect(await rows(user, `select 1 from public.attorney_shares`)).toHaveLength(0);
  });

  describe("the units shared with them", () => {
    it("see the collections standing and the owners' contact details for those units only", async () => {
      await share(f.unit2);
      const units = await rows<{ unit_label: string; owed: string; overdue: string; oldest_overdue_on: string | null }>(LEE_USER, `select * from public.attorney_shared_units($1::uuid)`, [f.damen]);
      expect(units).toHaveLength(1);
      expect(units[0]).toMatchObject({ unit_label: "Unit 2", owed: "750.00", overdue: "750.00" });
      expect(units[0].oldest_overdue_on).not.toBeNull();
      const owners = await rows<{ unit_label: string; full_name: string; email: string }>(LEE_USER, `select * from public.attorney_shared_owners($1::uuid)`, [f.damen]);
      expect(owners).toEqual([expect.objectContaining({ unit_label: "Unit 2", full_name: "Bo Lindqvist", email: "bo@example.test", phone: null, mailing_address: null })]);
      // With details on file (0082) the function returns them; the table itself stays closed to the attorney.
      await db.query(`insert into public.person_contact_details (person_id, association_id, phone, mailing_address) values ($1::uuid, $2::uuid, '312-555-0142', '2 Elm St')`, [f.boPerson, f.damen]);
      const withDetails = await rows<{ phone: string; mailing_address: string }>(LEE_USER, `select * from public.attorney_shared_owners($1::uuid)`, [f.damen]);
      expect(withDetails).toEqual([expect.objectContaining({ phone: "312-555-0142", mailing_address: "2 Elm St" })]);
      expect(await rows(LEE_USER, `select 1 from public.person_contact_details`)).toHaveLength(0);
    });

    it("get nothing from a building-wide share alone, and nothing once the grant ends", async () => {
      await share(null);
      expect(await rows(LEE_USER, `select 1 from public.attorney_shared_units($1::uuid)`, [f.damen])).toHaveLength(0);
      expect(await rows(LEE_USER, `select 1 from public.attorney_shared_owners($1::uuid)`, [f.damen])).toHaveLength(0);
      await share(f.unit1);
      expect(await rows(LEE_USER, `select 1 from public.attorney_shared_units($1::uuid)`, [f.damen])).toHaveLength(1);
      await db.query(`update public.role_grants set granted_on = current_date - 100, expires_on = current_date - 1 where person_id = $1::uuid`, [LEE]);
      expect(await rows(LEE_USER, `select 1 from public.attorney_shared_units($1::uuid)`, [f.damen])).toHaveLength(0);
    });

    it("are closed to everyone who is not the attorney they were shared with, the board included", async () => {
      await share(f.unit2);
      for (const user of [PAT_USER, OLA_USER, f.adaUser, f.niaUser, f.cyUser]) {
        expect(await rows(user, `select 1 from public.attorney_shared_units($1::uuid)`, [f.damen])).toHaveLength(0);
        expect(await rows(user, `select 1 from public.attorney_shared_owners($1::uuid)`, [f.damen])).toHaveLength(0);
      }
    });
  });

  it("reads no money and no one else's contact details, even for a shared unit", async () => {
    await share(f.unit2);
    for (const t of ["assessment_charges", "payments", "journal_entries", "unit_owners", "bank_transactions"]) {
      expect(await rows(LEE_USER, `select 1 from public.${t}`), t).toHaveLength(0);
    }
    expect(await rows(LEE_USER, `select id from public.persons`)).toHaveLength(1);
    expect(await rows(LEE_USER, `select 1 from public.vendors`)).toHaveLength(0);
    expect((await q(LEE_USER, `update public.tickets set status = 'closed'`)).affectedRows).toBe(0);
  });
});

describe("function privileges", () => {
  it("the new functions are not callable by a signed-out visitor, and are callable by a signed-in one", async () => {
    const fns = [
      "can_manage_repairs(uuid)",
      "manager_unit_standing(uuid)",
      "attorney_shared_units(uuid)",
      "attorney_shared_owners(uuid)",
      "manager_document_category(uuid)",
      "attorney_document_category(uuid)",
      "manager_can_read_document(uuid, uuid)",
      "attorney_can_read_document(uuid, uuid, uuid)",
    ];
    for (const fn of fns) {
      const r = await one<{ anon: boolean; auth: boolean }>(
        null,
        `select has_function_privilege('anon', 'public.${fn}', 'execute') as anon, has_function_privilege('authenticated', 'public.${fn}', 'execute') as auth`,
      );
      expect(r, fn).toEqual({ anon: false, auth: true });
    }
  });
});
