import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { applyMigrations, asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";
import {
  EXTRA,
  addExpenses,
  addHoyneTicket,
  addTasks,
  addVendors,
  boBoard,
  chicagoToday,
  pgError,
  queries,
  seededDb,
} from "./repairs-helpers";

/**
 * Migration 0053 security fixes (repairs-spec §3.2, tests §17.2
 * `repairs-security`). The leak and the injection are first reproduced
 * against the schema before 0053, then shown closed after it.
 */

const OWNER_TICKET_COLUMNS = [
  "id", "association_id", "reference", "title", "description", "status", "priority", "unit_id", "reported_by",
  "assigned_vendor_id", "opened_on", "resolved_at", "created_at", "trade", "location_detail", "access_notes",
  "scheduled_for", "scheduled_window", "resolution_note", "emergency_kind", "upkeep_task_id", "duplicate_of_id",
  "client_key", "updated_at",
].sort();

describe("repairs security: before 0053 (the holes, reproduced)", () => {
  let db: PGlite;
  let f: Fixture;
  const { q, rows } = queries(() => db);

  beforeEach(async () => {
    db = await freshDb({ before: "0053" });
    f = await seed(db);
  });
  afterEach(async () => {
    await db.close();
  });

  it("1. before 0053: an owner in Hoyne can read Damen's shared-area ticket (the leak)", async () => {
    const seen = await rows<{ id: string }>(f.zaraUser, `select id from public.tickets`);
    expect(seen.map((r) => r.id)).toContain(f.ticketCommon);
  });

  it("4. before 0053: an owner in Hoyne can post a comment onto Damen's ticket and Damen's board sees it (the injection)", async () => {
    await q(
      f.zaraUser,
      `insert into public.ticket_comments (association_id, ticket_id, body) values ($1::uuid, $2::uuid, 'Injected from Hoyne')`,
      [f.hoyne, f.ticketCommon],
    );
    const seen = await rows<{ body: string }>(
      f.cyUser,
      `select body from public.ticket_comments where ticket_id = $1::uuid`,
      [f.ticketCommon],
    );
    expect(seen.map((r) => r.body)).toContain("Injected from Hoyne");
  });
});

describe("repairs security: after 0053", () => {
  let db: PGlite;
  let f: Fixture;
  const { q, one, rows, count } = queries(() => db);

  beforeEach(async () => {
    ({ db, f } = await seededDb());
    await addVendors(db, f);
    await addHoyneTicket(db, f);
  });
  afterEach(async () => {
    await db.close();
  });

  const comment = (user: string, assoc: string, ticket: string, extra: { internal?: boolean; person?: string } = {}) =>
    q<{ id: string }>(
      user,
      `insert into public.ticket_comments (association_id, ticket_id, body, is_internal, person_id)
       values ($1::uuid, $2::uuid, 'A note', $3, $4::uuid) returning id`,
      [assoc, ticket, extra.internal ?? false, extra.person ?? null],
    );

  it("2. after 0053: an owner in Hoyne cannot read Damen's shared-area ticket", async () => {
    const seen = await rows<{ id: string }>(f.zaraUser, `select id from public.tickets where association_id = $1::uuid`, [f.damen]);
    expect(seen).toEqual([]);
  });

  it("3. after 0053: an owner in Hoyne cannot read comments on Damen's tickets", async () => {
    await q(null, `insert into public.ticket_comments (association_id, ticket_id, body) values ($1::uuid, $2::uuid, 'Board note')`, [
      f.damen,
      f.ticketCommon,
    ]);
    expect(await rows(f.zaraUser, `select id from public.ticket_comments`)).toEqual([]);
    expect(await rows(f.zaraUser, `select id from public.ticket_events where association_id = $1::uuid`, [f.damen])).toEqual([]);
  });

  it("5. after 0053: that insert is refused (association_id = hoyne)", async () => {
    await expect(comment(f.zaraUser, f.hoyne, f.ticketCommon)).rejects.toThrow(/different association|row-level security/);
  });

  it("6. after 0053: that insert is refused (association_id = damen)", async () => {
    await expect(comment(f.zaraUser, f.damen, f.ticketCommon)).rejects.toThrow(/row-level security/);
  });

  it("7. an owner without MFA sees no tickets, shared or own", async () => {
    const seen = await asUser(db, f.adaUser, () => db.query(`select id from public.tickets`), { aal: "aal1" });
    expect(seen.rows).toEqual([]);
  });

  it("8. an expired accountant sees no tickets", async () => {
    expect(await rows(f.vicUser, `select id from public.tickets`)).toEqual([]);
  });

  it("9. the reporter is the caller, not the client value", async () => {
    const row = await one<{ reported_by: string }>(
      f.adaUser,
      `insert into public.tickets (association_id, title, reported_by) values ($1::uuid, 'Hall light out', $2::uuid) returning reported_by`,
      [f.damen, f.boPerson],
    );
    expect(row.reported_by).toBe(f.adaPerson);
  });

  it("10. a note's author is the caller, not the client value", async () => {
    const { rows: r } = await comment(f.cyUser, f.damen, f.ticketCommon, { person: f.adaPerson });
    const stored = await one<{ person_id: string }>(null, `select person_id from public.ticket_comments where id = $1::uuid`, [r[0].id]);
    expect(stored.person_id).toBe(f.cyPerson);
  });

  it("11. an owner's report ignores board-only fields", async () => {
    const row = await one<{ id: string }>(
      f.adaUser,
      `insert into public.tickets (association_id, title, status, assigned_vendor_id, scheduled_for, resolution_note, unit_id)
       values ($1::uuid, 'Dishwasher leaking', 'closed', $2::uuid, '2026-12-01', 'All done', $3::uuid) returning id`,
      [f.damen, EXTRA.damenVendor, f.unit1],
    );
    const stored = await one<{ status: string; assigned_vendor_id: string | null; scheduled_for: string | null; resolution_note: string | null; resolved_at: string | null }>(
      null,
      `select status, assigned_vendor_id, scheduled_for, resolution_note, resolved_at from public.tickets where id = $1::uuid`,
      [row.id],
    );
    expect(stored).toEqual({ status: "open", assigned_vendor_id: null, scheduled_for: null, resolution_note: null, resolved_at: null });
  });

  it("12. a signed-in caller cannot choose the reference", async () => {
    const row = await one<{ reference: number }>(
      f.adaUser,
      `insert into public.tickets (association_id, title, reference) values ($1::uuid, 'Hall light out', 99) returning reference`,
      [f.damen],
    );
    expect(row.reference).toBe(4);
  });

  // One connection in PGlite, so the race itself cannot be staged; the ORDER is pinned: the per-association
  // advisory lock is taken before max(reference) is read, and is keyed by the association.
  it("13. numbering takes the per-association advisory lock before it reads the highest number", async () => {
    const def = await one<{ d: string }>(null, `select pg_get_functiondef('public.tg_tickets_before_insert'::regproc) as d`);
    const body = def.d.replace(/\s+/g, " ");
    const lock = body.search(/pg_advisory_xact_lock\( ?hashtextextended\('public\.tickets\.reference:' \|\| new\.association_id::text, 0\)\)/);
    const read = body.search(/max\(t\.reference\)/);
    expect(lock, "the lock call keyed by association").toBeGreaterThan(-1);
    expect(read, "the read of the highest reference").toBeGreaterThan(-1);
    expect(lock).toBeLessThan(read);
  });

  it("14. numbering is per association", async () => {
    // A second Hoyne ticket (the helper's is Hoyne's first) and a new Damen one.
    const hoyne = await one<{ reference: number }>(
      f.zaraUser,
      `insert into public.tickets (association_id, title) values ($1::uuid, 'Back gate sticks') returning reference`,
      [f.hoyne],
    );
    const first = await one<{ reference: number }>(null, `select reference from public.tickets where id = $1::uuid`, [EXTRA.hoyneTicket]);
    const damen = await one<{ reference: number }>(
      f.adaUser,
      `insert into public.tickets (association_id, title) values ($1::uuid, 'Hall light out') returning reference`,
      [f.damen],
    );
    expect(first.reference).toBe(1);
    expect(hoyne.reference).toBe(2);
    expect(damen.reference).toBe(4);
  });

  it("15. the board cannot assign another association's contractor", async () => {
    const e = await pgError(q(f.cyUser, `update public.tickets set assigned_vendor_id = $1::uuid where id = $2::uuid`, [EXTRA.hoyneVendor, f.ticketCommon]));
    expect(e.code).toBe("42501");
  });

  it("16. the board cannot link another association's expense in the board details", async () => {
    await addExpenses(db, f);
    const e = await pgError(
      q(f.cyUser, `insert into public.ticket_board_details (ticket_id, association_id, expense_id) values ($1::uuid, $2::uuid, $3::uuid)`, [
        f.ticketCommon,
        f.damen,
        EXTRA.hoyneExpense,
      ]),
    );
    expect(e.code).toBe("42501");
    // Its own expense is fine.
    await q(f.cyUser, `insert into public.ticket_board_details (ticket_id, association_id, expense_id) values ($1::uuid, $2::uuid, $3::uuid)`, [
      f.ticketCommon,
      f.damen,
      EXTRA.damenExpense,
    ]);
  });

  it("17. the board cannot move a ticket to another association's unit", async () => {
    const e = await pgError(q(f.cyUser, `update public.tickets set unit_id = $1::uuid where id = $2::uuid`, [f.hoyneUnit, f.ticketCommon]));
    expect(e.code).toBe("42501");
  });

  it("18. the assignee must be on this board", async () => {
    const set = (person: string) =>
      q(f.cyUser, `insert into public.ticket_board_details (ticket_id, association_id, assignee_person_id) values ($1::uuid, $2::uuid, $3::uuid)
                   on conflict (ticket_id) do update set assignee_person_id = excluded.assignee_person_id`, [f.ticketCommon, f.damen, person]);
    expect((await pgError(set(f.adaPerson))).code).toBe("42501");
    expect((await pgError(set(f.boPerson))).code).toBe("42501");
    await boBoard(db, f);
    await set(f.boPerson);
    const row = await one<{ assignee_person_id: string }>(null, `select assignee_person_id from public.ticket_board_details where ticket_id = $1::uuid`, [f.ticketCommon]);
    expect(row.assignee_person_id).toBe(f.boPerson);
  });

  it("19. the board cannot link another association's upkeep task or mark a duplicate across associations", async () => {
    await addTasks(db, f);
    const task = await pgError(q(f.cyUser, `update public.tickets set upkeep_task_id = $1::uuid where id = $2::uuid`, [EXTRA.hoyneTask, f.ticketCommon]));
    expect(task.code).toBe("42501");
    const dup = await pgError(q(f.cyUser, `update public.tickets set duplicate_of_id = $1::uuid where id = $2::uuid`, [EXTRA.hoyneTicket, f.ticketCommon]));
    expect(dup.code).toBe("42501");
  });

  it("20. contractor_messages refuse another association's contractor or ticket", async () => {
    const msg = (vendor: string, ticket: string | null) =>
      q(f.cyUser, `insert into public.contractor_messages (association_id, vendor_id, ticket_id, subject, body) values ($1::uuid, $2::uuid, $3::uuid, 'Hi', 'Body')`, [
        f.damen,
        vendor,
        ticket,
      ]);
    expect((await pgError(msg(EXTRA.hoyneVendor, null))).code).toBe("42501");
    expect((await pgError(msg(EXTRA.damenVendor, EXTRA.hoyneTicket))).code).toBe("42501");
    await msg(EXTRA.damenVendor, f.ticketCommon);
  });

  it("21. recurring_bills refuse another association's contractor, category or fund", async () => {
    await addExpenses(db, f);
    const bill = (vendor: string | null, account: string, fund: string) =>
      q(f.cyUser, `insert into public.recurring_bills (association_id, name, vendor_id, account_id, fund_id) values ($1::uuid, 'Water', $2::uuid, $3::uuid, $4::uuid)`, [
        f.damen,
        vendor,
        account,
        fund,
      ]);
    const okAccount = EXTRA.damenExpenseAccount;
    const okFund = "ffff0000-0000-0000-0000-000000000001";
    expect((await pgError(bill(EXTRA.hoyneVendor, okAccount, okFund))).code).toBe("42501");
    expect((await pgError(bill(null, EXTRA.hoyneAccount, okFund))).code).toBe("42501");
    expect((await pgError(bill(null, okAccount, EXTRA.hoyneFund))).code).toBe("42501");
    await bill(EXTRA.damenVendor, okAccount, okFund);
  });

  it("22. internal notes are board-only", async () => {
    await boBoard(db, f);
    const { rows: r } = await comment(f.cyUser, f.damen, f.ticketCommon, { internal: true });
    const id = r[0].id;
    const sees = async (user: string) => ({
      note: (await rows(user, `select id from public.ticket_comments where id = $1::uuid`, [id])).length,
      event: (await rows(user, `select id from public.ticket_events where data->>'comment_id' = $1`, [id])).length,
    });
    expect(await sees(f.adaUser)).toEqual({ note: 0, event: 0 });
    expect(await sees(f.niaUser)).toEqual({ note: 0, event: 0 });
    expect(await sees(f.boUser)).toEqual({ note: 1, event: 1 });
  });

  it("23. an owner cannot post an internal note", async () => {
    await expect(comment(f.adaUser, f.damen, f.ticketCommon, { internal: true })).rejects.toThrow(/row-level security/);
  });

  it("24. authors edit their own note; edited_at is stamped; ticket, author and is_internal can't change", async () => {
    const { rows: r } = await comment(f.adaUser, f.damen, f.ticketCommon);
    const id = r[0].id;
    const res = await q(
      f.adaUser,
      `update public.ticket_comments set body = 'Corrected', ticket_id = $2::uuid, person_id = $3::uuid, is_internal = true where id = $1::uuid`,
      [id, f.ticketUnit1, f.boPerson],
    );
    expect(res.affectedRows).toBe(1);
    const row = await one<{ body: string; ticket_id: string; person_id: string; is_internal: boolean; edited: boolean }>(
      null,
      `select body, ticket_id, person_id, is_internal, edited_at is not null as edited from public.ticket_comments where id = $1::uuid`,
      [id],
    );
    expect(row).toEqual({ body: "Corrected", ticket_id: f.ticketCommon, person_id: f.adaPerson, is_internal: false, edited: true });
    // Someone else's note is not theirs to edit.
    const other = await q(f.boUser, `update public.ticket_comments set body = 'Mine now' where id = $1::uuid`, [id]);
    expect(other.affectedRows).toBe(0);
  });

  it("25. a board member cannot delete a note; a board admin can", async () => {
    await boBoard(db, f);
    const { rows: r } = await comment(f.adaUser, f.damen, f.ticketCommon);
    const id = r[0].id;
    expect((await q(f.boUser, `delete from public.ticket_comments where id = $1::uuid`, [id])).affectedRows).toBe(0);
    expect((await q(f.adaUser, `delete from public.ticket_comments where id = $1::uuid`, [id])).affectedRows).toBe(0);
    expect((await q(f.cyUser, `delete from public.ticket_comments where id = $1::uuid`, [id])).affectedRows).toBe(1);
  });

  it("26. tickets still cannot be deleted by anyone", async () => {
    expect((await q(f.cyUser, `delete from public.tickets where id = $1::uuid`, [f.ticketCommon])).affectedRows).toBe(0);
    expect(await count(`select 1 from public.tickets where id = $1::uuid`, [f.ticketCommon])).toBe(1);
  });

  it("27. an owner receives exactly the owner-safe ticket columns", async () => {
    const row = await one<Record<string, unknown>>(f.adaUser, `select * from public.tickets where id = $1::uuid`, [f.ticketCommon]);
    expect(Object.keys(row).sort()).toEqual(OWNER_TICKET_COLUMNS);

    await q(f.cyUser, `insert into public.ticket_board_details (ticket_id, association_id, estimated_cost) values ($1::uuid, $2::uuid, 400)`, [
      f.ticketCommon,
      f.damen,
    ]);
    expect(await rows(f.adaUser, `select * from public.ticket_board_details`)).toEqual([]);
    expect(await rows(f.niaUser, `select * from public.ticket_board_details`)).toHaveLength(1);

    const cols = await rows<{ column_name: string }>(
      null,
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'tickets'
          and column_name in ('estimated_cost', 'expense_id', 'actual_cost', 'due_on', 'assignee_person_id', 'triage')`,
    );
    expect(cols).toEqual([]);
  });

  it("28. can_see_ticket agrees with tickets_select for every fixture user and ticket", async () => {
    const users = [f.adaUser, f.boUser, f.cyUser, f.niaUser, f.vicUser, f.zaraUser];
    const tickets = [f.ticketCommon, f.ticketUnit1, f.ticketUnit2, EXTRA.hoyneTicket];
    for (const user of users) {
      for (const ticket of tickets) {
        const fn = await one<{ v: boolean }>(user, `select public.can_see_ticket($1::uuid) as v`, [ticket]);
        const policy = (await rows(user, `select id from public.tickets where id = $1::uuid`, [ticket])).length === 1;
        expect(fn.v, `${user} / ${ticket}`).toBe(policy);
      }
    }
    // And the rule isn't trivially all-false or all-true.
    expect((await one<{ v: boolean }>(f.adaUser, `select public.can_see_ticket($1::uuid) as v`, [f.ticketUnit1])).v).toBe(true);
    expect((await one<{ v: boolean }>(f.adaUser, `select public.can_see_ticket($1::uuid) as v`, [f.ticketUnit2])).v).toBe(false);
  });

  it("29. an owner's insert ... returning works", async () => {
    const row = await one<{ id: string; reference: number }>(
      f.adaUser,
      `insert into public.tickets (association_id, title, unit_id) values ($1::uuid, 'Window will not close', $2::uuid) returning id, reference`,
      [f.damen, f.unit1],
    );
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.reference).toBe(4);
  });

  it("30. the accountant cannot report a problem or add a note", async () => {
    await expect(
      q(f.niaUser, `insert into public.tickets (association_id, title) values ($1::uuid, 'Books look odd')`, [f.damen]),
    ).rejects.toThrow(/row-level security/);
    await expect(comment(f.niaUser, f.damen, f.ticketCommon)).rejects.toThrow(/row-level security/);
  });

  it("31. timestamps are the server's", async () => {
    const today = await chicagoToday(db);
    const t = await one<{ id: string; created_today: boolean; opened_on: string }>(
      f.adaUser,
      `insert into public.tickets (association_id, title, created_at, opened_on) values ($1::uuid, 'Stair rail loose', '2020-01-01', '2020-01-01')
       returning id, created_at > now() - interval '1 minute' as created_today, opened_on::text`,
      [f.damen],
    );
    expect(t.created_today).toBe(true);
    expect(t.opened_on).toBe(today);

    const c = await q<{ id: string }>(
      f.adaUser,
      `insert into public.ticket_comments (association_id, ticket_id, body, created_at, edited_at)
       values ($1::uuid, $2::uuid, 'Still loose', '2020-01-01', now()) returning id`,
      [f.damen, t.id],
    );
    const stored = await one<{ recent: boolean; edited_at: string | null }>(
      null,
      `select created_at > now() - interval '1 minute' as recent, edited_at from public.ticket_comments where id = $1::uuid`,
      [c.rows[0].id],
    );
    expect(stored).toEqual({ recent: true, edited_at: null });

    const n = await q<{ id: string }>(
      f.cyUser,
      `insert into public.contractor_notes (association_id, vendor_id, body, created_at) values ($1::uuid, $2::uuid, 'Called Tuesday', '2020-01-01') returning id`,
      [f.damen, EXTRA.damenVendor],
    );
    const note = await one<{ recent: boolean }>(null, `select created_at > now() - interval '1 minute' as recent from public.contractor_notes where id = $1::uuid`, [
      n.rows[0].id,
    ]);
    expect(note.recent).toBe(true);
  });

  it("the comment and timeline policies reuse 0051's ticket_association_id (can_see_ticket)", async () => {
    const defs = await rows<{ policyname: string; qual: string | null; with_check: string | null }>(
      null,
      `select policyname, qual, with_check from pg_policies
        where schemaname = 'public' and policyname in ('ticket_comments_select', 'ticket_comments_insert', 'ticket_events_select')`,
    );
    expect(defs).toHaveLength(3);
    for (const d of defs) expect(`${d.qual ?? ""} ${d.with_check ?? ""}`).toContain("ticket_association_id");
  });
});

describe("repairs security: the legacy repair (migration path)", () => {
  let db: PGlite;
  let f: Fixture;
  const BOARD_TICKET = "ab000000-0000-0000-0000-0000000000b1";
  let boardComment: string;
  let injected: string;
  const { q, one, rows } = queries(() => db);

  beforeAll(async () => {
    db = await freshDb({ before: "0053" });
    f = await seed(db);
    // The old bug: the board's app sent "the first person I can see" as the reporter and author.
    await q(
      f.cyUser,
      `insert into public.tickets (id, association_id, title, reported_by) values ($1::uuid, $2::uuid, 'Basement door sticks', $3::uuid)`,
      [BOARD_TICKET, f.damen, f.adaPerson],
    );
    boardComment = (
      await one<{ id: string }>(
        f.cyUser,
        `insert into public.ticket_comments (association_id, ticket_id, person_id, body) values ($1::uuid, $2::uuid, $3::uuid, 'Called the locksmith') returning id`,
        [f.damen, BOARD_TICKET, f.adaPerson],
      )
    ).id;
    // The old hole: a Hoyne owner writing onto Damen's shared ticket.
    injected = (
      await one<{ id: string }>(
        f.zaraUser,
        `insert into public.ticket_comments (association_id, ticket_id, body) values ($1::uuid, $2::uuid, 'Hello from Hoyne') returning id`,
        [f.hoyne, f.ticketCommon],
      )
    ).id;
    await applyMigrations(db, { from: "0053" });
  });
  afterAll(async () => {
    await db.close();
  });

  it("32. 0053 repairs reporters and authors from the audit log", async () => {
    const t = await one<{ reported_by: string }>(null, `select reported_by from public.tickets where id = $1::uuid`, [BOARD_TICKET]);
    expect(t.reported_by).toBe(f.cyPerson);
    const c = await one<{ person_id: string }>(null, `select person_id from public.ticket_comments where id = $1::uuid`, [boardComment]);
    expect(c.person_id).toBe(f.cyPerson);

    expect(await rows(null, `select id from public.ticket_comments where id = $1::uuid`, [injected])).toEqual([]);
    const audit = await rows<{ body: string }>(
      null,
      `select before_data->>'body' as body from public.audit_log where table_name = 'ticket_comments' and action = 'delete' and record_id = $1::uuid`,
      [injected],
    );
    expect(audit.map((a) => a.body)).toEqual(["Hello from Hoyne"]);

    const seeded = await rows<{ reported_by: string | null }>(
      null,
      `select reported_by from public.tickets where id in ($1::uuid, $2::uuid, $3::uuid)`,
      [f.ticketCommon, f.ticketUnit1, f.ticketUnit2],
    );
    expect(seeded.map((r) => r.reported_by)).toEqual([null, null, null]);

    // The repaired rows carry the timeline backfill too.
    const events = await rows<{ kind: string; actor_person_id: string | null }>(
      null,
      `select kind, actor_person_id from public.ticket_events where ticket_id = $1::uuid order by kind`,
      [BOARD_TICKET],
    );
    expect(events).toEqual([
      { kind: "created", actor_person_id: f.cyPerson },
      { kind: "note_added", actor_person_id: f.cyPerson },
    ]);
  });

  it("33. a reporter corrected by the repair loses the rights", async () => {
    await q(null, `update public.tickets set status = 'resolved' where id = $1::uuid`, [BOARD_TICKET]);
    expect((await pgError(q(f.adaUser, `select public.reopen_ticket($1::uuid, 'Still sticks')`, [BOARD_TICKET]))).code).toBe("42501");
    expect((await pgError(q(f.adaUser, `select public.confirm_ticket_fixed($1::uuid)`, [BOARD_TICKET]))).code).toBe("42501");
    expect(
      await rows(f.adaUser, `select id from public.tickets where id = $1::uuid and reported_by = $2::uuid`, [BOARD_TICKET, f.adaPerson]),
    ).toEqual([]);
  });
});

