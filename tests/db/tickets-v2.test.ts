import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { applyMigrations, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";
import { EXTRA, addExpenses, addHoyneTicket, addTasks, addVendors, boBoard, pgError, queries, seededDb, zaraBoard } from "./repairs-helpers";

/**
 * Migration 0053 tickets v2 (repairs-spec §3.2.4 to §3.10, tests §17.2
 * `tickets-v2`): the backfills, the timeline, the owner read paths, the
 * ticket RPCs, duplicates, emergency facts and "last seen".
 */

let photoCounter = 0;
const photoPath = (assoc: string, ticket: string) => `${assoc}/tickets/${ticket}/${1_760_000_000_000 + ++photoCounter}-abc123-p.jpg`;
const checksum = () => `beef${(++photoCounter).toString(16).padStart(60, "0")}`;

describe("tickets v2: backfills (migration path)", () => {
  let db: PGlite;
  let f: Fixture;
  const { one, rows, count } = queries(() => db);
  const LEGACY: [string, string, string | null][] = [
    ["ab000000-0000-0000-0000-0000000000c1", "Separate recycling bins", null],
    ["ab000000-0000-0000-0000-0000000000c2", "Notice on the office door", null],
    ["ab000000-0000-0000-0000-0000000000c3", "Duct tape on the sign", null],
    ["ab000000-0000-0000-0000-0000000000c4", "Block party permit", null],
    ["ab000000-0000-0000-0000-0000000000c5", "Monkey bars", null],
    ["ab000000-0000-0000-0000-0000000000c6", "Water heater pilot is out", "plumbing"],
  ];

  beforeAll(async () => {
    db = await freshDb({ before: "0053" });
    f = await seed(db);
    for (const [id, title] of LEGACY) {
      await db.query(`insert into public.tickets (id, association_id, title) values ($1::uuid, $2::uuid, $3)`, [id, f.damen, title]);
    }
    await applyMigrations(db, { from: "0053" });
  });
  afterAll(async () => {
    await db.close();
  });

  it("1. backfill gave the fixture tickets trades, honest timestamps and timelines", async () => {
    const t = await rows<{ id: string; trade: string; honest: boolean }>(
      null,
      `select id, trade, updated_at = created_at as honest from public.tickets where id in ($1::uuid, $2::uuid, $3::uuid)`,
      [f.ticketCommon, f.ticketUnit1, f.ticketUnit2],
    );
    const byId = Object.fromEntries(t.map((r) => [r.id, r]));
    expect(byId[f.ticketCommon].trade).toBe("roofing");
    expect(byId[f.ticketUnit1].trade).toBe("plumbing");
    expect(byId[f.ticketUnit2].trade).toBe("hvac");
    expect(t.every((r) => r.honest)).toBe(true);

    for (const id of [f.ticketCommon, f.ticketUnit1, f.ticketUnit2]) {
      expect(await count(`select 1 from public.ticket_events where ticket_id = $1::uuid and kind = 'created'`, [id])).toBe(1);
    }
    expect(await count(`select 1 from public.ticket_events where kind = 'trade_changed'`)).toBe(0);
  });

  it("2. the trade backfill uses word boundaries", async () => {
    for (const [id, title, expected] of LEGACY) {
      const r = await one<{ trade: string | null }>(null, `select trade from public.tickets where id = $1::uuid`, [id]);
      expect(r.trade, title).toBe(expected);
    }
  });
});

describe("tickets v2", () => {
  let db: PGlite;
  let f: Fixture;
  const { q, one, rows, count } = queries(() => db);

  beforeEach(async () => {
    ({ db, f } = await seededDb());
    await addVendors(db, f);
  });
  afterEach(async () => {
    await db.close();
  });

  const report = async (user: string, title: string, opts: { unit?: string | null; priority?: string; assoc?: string } = {}) =>
    (
      await one<{ id: string; reference: number }>(
        user,
        `insert into public.tickets (association_id, title, unit_id, priority) values ($1::uuid, $2, $3::uuid, $4::public.ticket_priority) returning id, reference`,
        [opts.assoc ?? f.damen, title, opts.unit ?? null, opts.priority ?? "normal"],
      )
    );
  const note = (user: string, ticket: string, body: string, opts: { internal?: boolean; kind?: string } = {}) =>
    q<{ id: string }>(
      user,
      `insert into public.ticket_comments (association_id, ticket_id, body, is_internal, kind) values ($1::uuid, $2::uuid, $3, $4, $5) returning id`,
      [f.damen, ticket, body, opts.internal ?? false, opts.kind ?? "note"],
    );
  const kinds = async (user: string, ticket: string) =>
    (await rows<{ kind: string }>(user, `select kind from public.ticket_events where ticket_id = $1::uuid order by created_at, kind`, [ticket])).map(
      (r) => r.kind,
    );
  const status = async (ticket: string) =>
    (await one<{ status: string }>(null, `select status from public.tickets where id = $1::uuid`, [ticket])).status;
  /** Move a ticket's resolved_at as the superuser, around the trigger that pins it. */
  const setResolvedAt = async (ticket: string, sql: string) => {
    await db.exec(`set session_replication_role = replica`);
    try {
      await db.query(`update public.tickets set resolved_at = ${sql} where id = $1::uuid`, [ticket]);
    } finally {
      await db.exec(`set session_replication_role = origin`);
    }
  };

  it("3. creating a ticket writes a created event visible to owners", async () => {
    const t = await report(f.adaUser, "Hallway carpet torn");
    const ev = await rows<{ kind: string; visible_to_owners: boolean; actor_person_id: string; to_value: string }>(
      f.boUser,
      `select kind, visible_to_owners, actor_person_id, to_value from public.ticket_events where ticket_id = $1::uuid`,
      [t.id],
    );
    expect(ev).toEqual([{ kind: "created", visible_to_owners: true, actor_person_id: f.adaPerson, to_value: "open" }]);
  });

  it("4. status, priority, schedule and contractor changes write owner-visible events; board details write board-only events", async () => {
    await q(
      f.cyUser,
      `update public.tickets set status = 'in_progress', priority = 'normal', scheduled_for = '2026-11-02', scheduled_window = 'Morning', assigned_vendor_id = $2::uuid where id = $1::uuid`,
      [f.ticketCommon, EXTRA.damenVendor],
    );
    await q(f.cyUser, `insert into public.ticket_board_details (ticket_id, association_id, estimated_cost) values ($1::uuid, $2::uuid, 400)`, [
      f.ticketCommon,
      f.damen,
    ]);
    const ada = await rows<{ kind: string; data: { contractor_name?: string; window?: string } }>(
      f.adaUser,
      `select kind, data from public.ticket_events where ticket_id = $1::uuid`,
      [f.ticketCommon],
    );
    const adaKinds = ada.map((e) => e.kind);
    expect(adaKinds).toEqual(expect.arrayContaining(["status_changed", "priority_changed", "scheduled", "contractor_assigned"]));
    expect(adaKinds).not.toContain("estimate_changed");
    expect(ada.find((e) => e.kind === "contractor_assigned")!.data.contractor_name).toBe("Damen Plumbing");
    expect(ada.find((e) => e.kind === "scheduled")!.data.window).toBe("Morning");
    expect(await kinds(f.cyUser, f.ticketCommon)).toContain("estimate_changed");
    expect(await kinds(f.niaUser, f.ticketCommon)).toContain("estimate_changed");

    // Edits name the fields; the trade change is board-only.
    await q(f.cyUser, `update public.tickets set title = 'Roof leak over the back stairs', description = 'Worse after rain', trade = 'gutters' where id = $1::uuid`, [
      f.ticketCommon,
    ]);
    const edited = await one<{ fields: string[] }>(
      f.adaUser,
      `select data->'fields' as fields from public.ticket_events where ticket_id = $1::uuid and kind = 'details_edited'`,
      [f.ticketCommon],
    );
    expect(edited.fields).toEqual(["title", "description"]);
    expect(await kinds(f.adaUser, f.ticketCommon)).not.toContain("trade_changed");
    expect(await kinds(f.cyUser, f.ticketCommon)).toContain("trade_changed");
  });

  it("5. an internal note's event is hidden from owners and the accountant", async () => {
    await note(f.cyUser, f.ticketCommon, "Board only: the roofer owes us a credit", { internal: true });
    expect(await kinds(f.adaUser, f.ticketCommon)).not.toContain("note_added");
    expect(await kinds(f.niaUser, f.ticketCommon)).not.toContain("note_added");
    expect(await kinds(f.cyUser, f.ticketCommon)).toContain("note_added");
    await note(f.cyUser, f.ticketCommon, "Roofer booked for Monday");
    expect(await kinds(f.adaUser, f.ticketCommon)).toContain("note_added");
  });

  it("6. resolved_at is set once, kept across resolved and closed, cleared on reopen, and the client value is ignored", async () => {
    const at = async () => (await one<{ r: string | null }>(null, `select resolved_at::text as r from public.tickets where id = $1::uuid`, [f.ticketCommon])).r;
    await q(f.cyUser, `update public.tickets set status = 'resolved', resolved_at = '2020-01-01' where id = $1::uuid`, [f.ticketCommon]);
    const first = await at();
    expect(first).not.toBeNull();
    expect(first!.startsWith("2020")).toBe(false);
    await q(f.cyUser, `update public.tickets set status = 'closed' where id = $1::uuid`, [f.ticketCommon]);
    expect(await at()).toBe(first);
    await q(f.cyUser, `update public.tickets set resolved_at = '2021-01-01' where id = $1::uuid`, [f.ticketCommon]);
    expect(await at()).toBe(first);
    await q(f.cyUser, `update public.tickets set status = 'open' where id = $1::uuid`, [f.ticketCommon]);
    expect(await at()).toBeNull();
    expect(await kinds(f.adaUser, f.ticketCommon)).toContain("reopened");
  });

  it("7. ticket_contractor_names returns the name only for visible tickets", async () => {
    await q(f.cyUser, `update public.tickets set assigned_vendor_id = $1::uuid where id in ($2::uuid, $3::uuid)`, [
      EXTRA.damenVendor,
      f.ticketCommon,
      f.ticketUnit2,
    ]);
    const names = (user: string) =>
      rows<{ ticket_id: string; contractor_name: string }>(user, `select * from public.ticket_contractor_names($1::uuid[])`, [
        [f.ticketCommon, f.ticketUnit1, f.ticketUnit2],
      ]);
    expect(await names(f.adaUser)).toEqual([{ ticket_id: f.ticketCommon, contractor_name: "Damen Plumbing" }]);
    expect(await names(f.zaraUser)).toEqual([]);
    expect(await names(f.cyUser)).toHaveLength(2);
  });

  it("8. ticket_event_actor_roles names roles, not people", async () => {
    const adaNote = (await note(f.adaUser, f.ticketCommon, "Still dripping")).rows[0].id;
    const boNote = (await note(f.boUser, f.ticketCommon, "Same in my hallway")).rows[0].id;
    // Bo wrote his note before he joined the board.
    await q(null, `update public.ticket_events set created_at = '2026-01-15' where data->>'comment_id' = $1`, [boNote]);
    await boBoard(db, f, "2026-02-01");
    await q(f.cyUser, `update public.tickets set status = 'in_progress' where id = $1::uuid`, [f.ticketCommon]);
    const internal = (await note(f.cyUser, f.ticketCommon, "Board only", { internal: true })).rows[0].id;

    const eventFor = async (pred: string, params: unknown[]) =>
      (await one<{ id: string }>(null, `select id from public.ticket_events where ticket_id = $1::uuid and ${pred}`, [f.ticketCommon, ...params])).id;
    const adaEv = await eventFor(`data->>'comment_id' = $2`, [adaNote]);
    const boEv = await eventFor(`data->>'comment_id' = $2`, [boNote]);
    const internalEv = await eventFor(`data->>'comment_id' = $2`, [internal]);
    const statusEv = await eventFor(`kind = 'status_changed'`, []);
    const createdEv = await eventFor(`kind = 'created'`, []);

    const roles = async (user: string) =>
      Object.fromEntries(
        (await rows<{ event_id: string; actor_role: string }>(user, `select * from public.ticket_event_actor_roles($1::uuid)`, [f.ticketCommon])).map((r) => [
          r.event_id,
          r.actor_role,
        ]),
      );
    const ada = await roles(f.adaUser);
    expect(ada[adaEv]).toBe("you");
    expect(ada[statusEv]).toBe("board");
    expect(ada[boEv]).toBe("owner");
    expect(ada[createdEv]).toBe("unknown");
    expect(ada[internalEv]).toBeUndefined();

    const bo = await roles(f.boUser);
    expect(bo[boEv]).toBe("you");
    expect(bo[adaEv]).toBe("owner");
    expect(bo[internalEv]).toBe("board");

    expect(await rows(f.zaraUser, `select * from public.ticket_event_actor_roles($1::uuid)`, [f.ticketCommon])).toEqual([]);
  });

  it("9. reopen_ticket: the reporter can reopen within 30 days and a note is written", async () => {
    const t = await report(f.adaUser, "Front steps cracked");
    await q(f.cyUser, `update public.tickets set status = 'resolved' where id = $1::uuid`, [t.id]);
    await setResolvedAt(t.id, `now() - interval '10 days'`);
    await q(f.adaUser, `select public.reopen_ticket($1::uuid, 'The crack is back')`, [t.id]);
    expect(await status(t.id)).toBe("open");
    const c = await one<{ body: string; person_id: string; is_internal: boolean }>(
      null,
      `select body, person_id, is_internal from public.ticket_comments where ticket_id = $1::uuid`,
      [t.id],
    );
    expect(c).toEqual({ body: "Reopened: The crack is back", person_id: f.adaPerson, is_internal: false });
    expect(await kinds(f.adaUser, t.id)).toContain("reopened");
  });

  it("10. reopen_ticket: another owner cannot; the reporter cannot after 30 days; the board always can", async () => {
    const t = await report(f.adaUser, "Front steps cracked");
    await q(f.cyUser, `update public.tickets set status = 'resolved' where id = $1::uuid`, [t.id]);
    expect((await pgError(q(f.boUser, `select public.reopen_ticket($1::uuid, 'Not fixed')`, [t.id]))).code).toBe("42501");
    await setResolvedAt(t.id, `now() - interval '40 days'`);
    expect((await pgError(q(f.adaUser, `select public.reopen_ticket($1::uuid, 'Not fixed')`, [t.id]))).code).toBe("42501");
    expect((await pgError(q(f.zaraUser, `select public.reopen_ticket($1::uuid, 'Not fixed')`, [t.id]))).code).toBe("42501");
    expect((await pgError(q(f.cyUser, `select public.reopen_ticket($1::uuid, '  ')`, [t.id]))).code).toBe("22023");
    await q(f.cyUser, `select public.reopen_ticket($1::uuid, 'Not fixed')`, [t.id]);
    expect(await status(t.id)).toBe("open");
  });

  it("11. confirm_ticket_fixed: the reporter closes a fixed ticket; another owner cannot", async () => {
    const t = await report(f.adaUser, "Front steps cracked");
    await q(f.cyUser, `update public.tickets set status = 'resolved' where id = $1::uuid`, [t.id]);
    expect((await pgError(q(f.boUser, `select public.confirm_ticket_fixed($1::uuid)`, [t.id]))).code).toBe("42501");
    await q(f.adaUser, `select public.confirm_ticket_fixed($1::uuid)`, [t.id]);
    expect(await status(t.id)).toBe("closed");
  });

  it("12. record_ticket_triage validates and limits", async () => {
    const t = await report(f.adaUser, "Water under the sink");
    const triage = (user: string, payload: unknown, trade: string | null = null) =>
      q(user, `select public.record_ticket_triage($1::uuid, $2::jsonb, $3)`, [t.id, JSON.stringify(payload), trade]);
    const good = { state: "done", trade: "plumbing", urgency: "normal", emergency: "gas", questions: ["Is it still leaking?"], confidence: 0.8, search_phrase: "sink leak" };

    // A reporter's "done" triage needs a finished AI call of theirs (REVIEW-1 #13).
    expect((await pgError(triage(f.adaUser, good, "plumbing"))).code).toBe("42501");
    const claim = await one<{ id: string }>(f.adaUser, `select public.claim_ai_call($1::uuid, 'ticket_triage') as id`, [f.damen]);
    await q(f.adaUser, `select public.finish_ai_call($1::uuid, true)`, [claim.id]);
    await triage(f.adaUser, good, "plumbing");
    const after = await one<{ trade: string; emergency_kind: string | null }>(null, `select trade, emergency_kind from public.tickets where id = $1::uuid`, [t.id]);
    expect(after).toEqual({ trade: "plumbing", emergency_kind: null });
    expect((await pgError(triage(f.adaUser, good))).code).toBe("42501");
    expect((await pgError(triage(f.boUser, good))).code).toBe("42501");

    await triage(f.cyUser, { ...good, trade: "hvac", urgency: "urgent" }, "hvac");
    const stored = await one<{ urgency: string; trade: string }>(
      null,
      `select d.triage->>'urgency' as urgency, t.trade from public.ticket_board_details d join public.tickets t on t.id = d.ticket_id where d.ticket_id = $1::uuid`,
      [t.id],
    );
    expect(stored).toEqual({ urgency: "urgent", trade: "plumbing" });

    const bad: unknown[] = [
      { state: "done", summary: "x".repeat(9000) },
      { state: "done", hack: 1 },
      { state: "done", urgency: "panic" },
      { state: "done", questions: ["a", "b", "c", "d"] },
      { state: "done", questions: ["x".repeat(141)] },
      { state: "done", confidence: 2 },
      { state: "done", confidence: "high" },
      { state: "done", search_phrase: "leak in unit 2" },
      { state: "maybe" },
      { state: "done", questions: "not a list" },
    ];
    for (const p of bad) {
      expect((await pgError(triage(f.cyUser, p))).code, JSON.stringify(p).slice(0, 60)).toBe("22023");
    }
    expect(await rows(f.adaUser, `select triage from public.ticket_board_details`)).toEqual([]);
  });

  it("13. triage cannot be written by a direct update", async () => {
    await q(f.cyUser, `select public.record_ticket_triage($1::uuid, '{"state":"done","urgency":"low"}'::jsonb, null)`, [f.ticketCommon]);
    await q(f.cyUser, `update public.ticket_board_details set triage = '{"state":"done","urgency":"urgent"}' where ticket_id = $1::uuid`, [f.ticketCommon]);
    await q(f.cyUser, `insert into public.ticket_board_details (ticket_id, association_id, triage) values ($1::uuid, $2::uuid, '{"state":"done"}')`, [
      f.ticketUnit1,
      f.damen,
    ]);
    const r = await rows<{ ticket_id: string; triage: { urgency?: string } | null }>(
      null,
      `select ticket_id, triage from public.ticket_board_details where ticket_id in ($1::uuid, $2::uuid)`,
      [f.ticketCommon, f.ticketUnit1],
    );
    const byId = Object.fromEntries(r.map((x) => [x.ticket_id, x.triage]));
    expect(byId[f.ticketCommon]!.urgency).toBe("low");
    expect(byId[f.ticketUnit1]).toBeNull();
  });

  const attach = async (user: string, ticket: string) =>
    (
      await one<{ document_id: string }>(
        user,
        `select * from public.attach_ticket_photo($1::uuid, $2, 'p.jpg', 'image/jpeg', 1000, $3, null)`,
        [ticket, photoPath(f.damen, ticket), checksum()],
      )
    ).document_id;

  it("14. a photo link writes a photo_added event", async () => {
    const doc = await attach(f.adaUser, f.ticketCommon);
    const ev = await one<{ visible_to_owners: boolean; actor_person_id: string; doc: string }>(
      f.boUser,
      `select visible_to_owners, actor_person_id, data->>'document_id' as doc from public.ticket_events where ticket_id = $1::uuid and kind = 'photo_added'`,
      [f.ticketCommon],
    );
    expect(ev).toEqual({ visible_to_owners: true, actor_person_id: f.adaPerson, doc });
  });

  it("15. photos follow the ticket's audience", async () => {
    const doc = await attach(f.adaUser, f.ticketUnit1);
    const shared = await attach(f.adaUser, f.ticketUnit1);
    // The second photo is also linked to a contractor: it keeps its audience.
    await q(null, `insert into public.document_links (association_id, document_id, target_table, target_id, relation) values ($1::uuid, $2::uuid, 'vendors', $3::uuid, 'source')`, [
      f.damen,
      shared,
      EXTRA.damenVendor,
    ]);
    const docRow = (id: string) =>
      one<{ visibility: string; restricted_to_unit_id: string | null }>(null, `select visibility, restricted_to_unit_id from public.documents where id = $1::uuid`, [id]);
    const boSees = async (id: string) => (await rows(f.boUser, `select id from public.documents where id = $1::uuid`, [id])).length === 1;

    expect(await docRow(doc)).toEqual({ visibility: "board_only", restricted_to_unit_id: f.unit1 });
    expect(await boSees(doc)).toBe(false);

    await q(f.cyUser, `update public.tickets set unit_id = null where id = $1::uuid`, [f.ticketUnit1]);
    expect(await docRow(doc)).toEqual({ visibility: "all_owners", restricted_to_unit_id: null });
    expect(await boSees(doc)).toBe(true);
    expect(await docRow(shared)).toEqual({ visibility: "board_only", restricted_to_unit_id: f.unit1 });

    await q(f.cyUser, `update public.tickets set unit_id = $2::uuid where id = $1::uuid`, [f.ticketUnit1, f.unit1]);
    expect(await docRow(doc)).toEqual({ visibility: "board_only", restricted_to_unit_id: f.unit1 });
    expect(await boSees(doc)).toBe(false);
  });

  it("16. ticket_last_activity follows the caller's RLS", async () => {
    await q(f.cyUser, `insert into public.ticket_board_details (ticket_id, association_id, estimated_cost) values ($1::uuid, $2::uuid, 400)`, [
      f.ticketCommon,
      f.damen,
    ]);
    await q(null, `update public.ticket_events set created_at = now() + interval '1 hour' where kind = 'estimate_changed'`);
    const last = async (user: string) =>
      (await one<{ later: boolean }>(
        user,
        `select last_activity_at > now() + interval '30 minutes' as later from public.ticket_last_activity where ticket_id = $1::uuid`,
        [f.ticketCommon],
      )).later;
    expect(await last(f.cyUser)).toBe(true);
    expect(await last(f.adaUser)).toBe(false);
    expect(await rows(f.zaraUser, `select * from public.ticket_last_activity`)).toEqual([]);
  });

  it("17. duplicates have no self-links, loops or chains", async () => {
    await addHoyneTicket(db, f);
    const dup = (ticket: string, of: string) => q(f.cyUser, `update public.tickets set duplicate_of_id = $2::uuid where id = $1::uuid`, [ticket, of]);
    expect((await pgError(dup(f.ticketCommon, f.ticketCommon))).code).toBe("23514");
    await dup(f.ticketUnit1, f.ticketCommon); // A -> B
    expect((await pgError(dup(f.ticketCommon, f.ticketUnit1))).code).toBe("22023"); // B -> A
    expect((await pgError(dup(f.ticketUnit2, f.ticketUnit1))).code).toBe("22023"); // C -> A (A is a duplicate)
    expect((await pgError(dup(f.ticketUnit2, EXTRA.hoyneTicket))).code).toBe("42501");
  });

  it("18. mark_ticket_duplicate links, closes and writes both notes in one call; owners are refused", async () => {
    expect((await pgError(q(f.adaUser, `select public.mark_ticket_duplicate($1::uuid, 1)`, [f.ticketUnit1]))).code).toBe("42501");
    const r = await one<{ o: string }>(f.cyUser, `select public.mark_ticket_duplicate($1::uuid, 1) as o`, [f.ticketUnit2]);
    expect(r.o).toBe(f.ticketCommon);
    const t = await one<{ status: string; duplicate_of_id: string; resolution_note: string }>(
      null,
      `select status, duplicate_of_id, resolution_note from public.tickets where id = $1::uuid`,
      [f.ticketUnit2],
    );
    expect(t).toEqual({ status: "closed", duplicate_of_id: f.ticketCommon, resolution_note: "Same problem as #1." });
    const notes = await rows<{ ticket_id: string; body: string }>(null, `select ticket_id, body from public.ticket_comments order by body`);
    expect(notes).toEqual([
      { ticket_id: f.ticketCommon, body: "#3 was closed as the same problem." },
      { ticket_id: f.ticketUnit2, body: "Closed as a duplicate of #1. Follow that one for updates." },
    ]);
    expect((await pgError(q(f.cyUser, `select public.mark_ticket_duplicate($1::uuid, 99)`, [f.ticketUnit1]))).code).toBe("22023");
    expect((await pgError(q(f.cyUser, `select public.mark_ticket_duplicate($1::uuid, 2)`, [f.ticketUnit1]))).code).toBe("22023");
  });

  it("19. close_out_ticket writes the ticket and its board details together, and logs upkeep once", async () => {
    await addTasks(db, f);
    await addExpenses(db, f);
    const t = await one<{ id: string }>(
      f.cyUser,
      `insert into public.tickets (association_id, title, upkeep_task_id, assigned_vendor_id) values ($1::uuid, 'Boiler service', $2::uuid, $3::uuid) returning id`,
      [f.damen, EXTRA.damenTask, EXTRA.damenVendor2],
    );
    const close = (user: string, cost: string | null) =>
      q<{ upkeep_logged: boolean; task_next_due_on: string }>(
        user,
        `select upkeep_logged, task_next_due_on::text from public.close_out_ticket($1::uuid, 'resolved', $2::numeric, $3::uuid, 'Serviced and cleaned', true)`,
        [t.id, cost, EXTRA.damenExpense],
      );
    expect((await pgError(close(f.adaUser, "250"))).code).toBe("42501");
    expect((await pgError(close(f.cyUser, "-1"))).code).toBe("22023");

    const first = (await close(f.cyUser, "250")).rows[0];
    expect(first.upkeep_logged).toBe(true);
    const ticket = await one<{ status: string; resolution_note: string }>(null, `select status, resolution_note from public.tickets where id = $1::uuid`, [t.id]);
    expect(ticket).toEqual({ status: "resolved", resolution_note: "Serviced and cleaned" });
    const details = await one<{ actual_cost: string; expense_id: string }>(
      null,
      `select actual_cost::text, expense_id from public.ticket_board_details where ticket_id = $1::uuid`,
      [t.id],
    );
    expect(details).toEqual({ actual_cost: "250.00", expense_id: EXTRA.damenExpense });
    const log = await rows<{ vendor_id: string; cost: string; note: string }>(
      null,
      `select vendor_id, cost::text, note from public.upkeep_log where ticket_id = $1::uuid`,
      [t.id],
    );
    expect(log).toHaveLength(1);
    expect(log[0].vendor_id).toBe(EXTRA.damenVendor2);
    expect(log[0].note).toMatch(/^From problem #\d+$/);
    const task = await one<{ next: string }>(null, `select next_due_on::text as next from public.upkeep_tasks where id = $1::uuid`, [EXTRA.damenTask]);
    expect(first.task_next_due_on).toBe(task.next);

    const second = (await close(f.cyUser, "250")).rows[0];
    expect(second.upkeep_logged).toBe(false);
    expect(await count(`select 1 from public.upkeep_log where ticket_id = $1::uuid`, [t.id])).toBe(1);

    // Corrected on a later close-out: the log row follows the ticket (REVIEW-4 #9), still one row
    const third = (await close(f.cyUser, "200")).rows[0];
    expect(third.upkeep_logged).toBe(false);
    const after = await rows<{ cost: string }>(null, `select cost::text from public.upkeep_log where ticket_id = $1::uuid`, [t.id]);
    expect(after).toEqual([{ cost: "200.00" }]);
    const ticketCost = await one<{ actual_cost: string }>(null, `select actual_cost::text from public.ticket_board_details where ticket_id = $1::uuid`, [t.id]);
    expect(ticketCost.actual_cost).toBe("200.00");
  });

  it("20. close_ticket_for_owner closes a unit problem with the board's note; a shared-area problem is refused", async () => {
    await q(f.cyUser, `select public.close_ticket_for_owner($1::uuid, 'Inside your unit, so the declaration puts this on you.')`, [f.ticketUnit1]);
    const t = await one<{ status: string; resolution_note: string }>(null, `select status, resolution_note from public.tickets where id = $1::uuid`, [f.ticketUnit1]);
    expect(t).toEqual({ status: "closed", resolution_note: "The board decided this is the unit owner's to fix." });
    const seen = await rows<{ body: string }>(f.adaUser, `select body from public.ticket_comments where ticket_id = $1::uuid`, [f.ticketUnit1]);
    expect(seen.map((c) => c.body)).toEqual(["Inside your unit, so the declaration puts this on you."]);
    expect((await pgError(q(f.cyUser, `select public.close_ticket_for_owner($1::uuid, 'Yours')`, [f.ticketCommon]))).code).toBe("22023");
    expect((await pgError(q(f.cyUser, `select public.close_ticket_for_owner($1::uuid, ' ')`, [f.ticketUnit2]))).code).toBe("22023");
    expect((await pgError(q(f.adaUser, `select public.close_ticket_for_owner($1::uuid, 'Yours')`, [f.ticketUnit1]))).code).toBe("42501");
  });

  it("21. a repeated client key finds the same ticket", async () => {
    const key = "ab000000-0000-0000-0000-0000000000ee";
    const send = (user: string, assoc: string) =>
      q(user, `insert into public.tickets (association_id, title, client_key) values ($1::uuid, 'Light out in the hall', $2::uuid)`, [assoc, key]);
    await send(f.adaUser, f.damen);
    expect((await pgError(send(f.adaUser, f.damen))).code).toBe("23505");
    await send(f.zaraUser, f.hoyne);
  });

  it("22. one open ticket per upkeep task", async () => {
    await addTasks(db, f);
    const open = () =>
      q<{ id: string }>(f.cyUser, `insert into public.tickets (association_id, title, upkeep_task_id) values ($1::uuid, 'Boiler service', $2::uuid) returning id`, [
        f.damen,
        EXTRA.damenTask,
      ]);
    const first = (await open()).rows[0].id;
    expect((await pgError(open())).code).toBe("23505");
    await q(f.cyUser, `update public.tickets set status = 'closed' where id = $1::uuid`, [first]);
    await open();
  });

  it("23. set_ticket_plan writes the ticket and its board details together", async () => {
    await boBoard(db, f);
    const plan = (user: string, fields: Record<string, unknown>) =>
      q(user, `select public.set_ticket_plan($1::uuid, $2::jsonb)`, [f.ticketCommon, JSON.stringify(fields)]);
    await plan(f.cyUser, {
      assigned_vendor_id: EXTRA.damenVendor,
      scheduled_for: "2026-11-03",
      scheduled_window: " 9 to 11 ",
      estimated_cost: "1250.505",
      due_on: "2026-11-10",
      assignee_person_id: f.boPerson,
    });
    const t = await one<{ assigned_vendor_id: string; scheduled_for: string; scheduled_window: string }>(
      null,
      `select assigned_vendor_id, scheduled_for::text, scheduled_window from public.tickets where id = $1::uuid`,
      [f.ticketCommon],
    );
    expect(t).toEqual({ assigned_vendor_id: EXTRA.damenVendor, scheduled_for: "2026-11-03", scheduled_window: "9 to 11" });
    const d = await one<{ estimated_cost: string; due_on: string; assignee_person_id: string }>(
      null,
      `select estimated_cost::text, due_on::text, assignee_person_id from public.ticket_board_details where ticket_id = $1::uuid`,
      [f.ticketCommon],
    );
    expect(d).toEqual({ estimated_cost: "1250.51", due_on: "2026-11-10", assignee_person_id: f.boPerson });

    // Only the keys given change; a JSON null clears.
    await plan(f.cyUser, { due_on: null });
    const d2 = await one<{ estimated_cost: string; due_on: string | null }>(
      null,
      `select estimated_cost::text, due_on::text from public.ticket_board_details where ticket_id = $1::uuid`,
      [f.ticketCommon],
    );
    expect(d2).toEqual({ estimated_cost: "1250.51", due_on: null });

    const dnu = await pgError(plan(f.cyUser, { assigned_vendor_id: EXTRA.damenDoNotUse }));
    expect([dnu.code, dnu.hint]).toEqual(["22023", "do_not_use"]);
    expect((await pgError(plan(f.cyUser, { assigned_vendor_id: EXTRA.damenArchived }))).code).toBe("22023");
    expect((await pgError(plan(f.cyUser, { hack: 1 }))).code).toBe("22023");
    expect((await pgError(plan(f.adaUser, { scheduled_for: "2026-11-03" }))).code).toBe("42501");
  });

  it("24. set_ticket_priority asks for a reason only when lowering an owner's report", async () => {
    const t = await report(f.adaUser, "Smell of smoke in the basement", { priority: "urgent" });
    const set = (ticket: string, p: string, reason: string | null) =>
      q(f.cyUser, `select public.set_ticket_priority($1::uuid, $2, $3)`, [ticket, p, reason]);
    const e = await pgError(set(t.id, "low", null));
    expect([e.code, e.hint]).toEqual(["22023", "reason_required"]);
    await set(t.id, "low", "Checked it; it was a neighbour's barbecue.");
    const c = await one<{ body: string; is_internal: boolean }>(null, `select body, is_internal from public.ticket_comments where ticket_id = $1::uuid`, [t.id]);
    expect(c).toEqual({ body: `Urgency changed to "Can wait": Checked it; it was a neighbour's barbecue.`, is_internal: false });
    await set(t.id, "urgent", null);
    const board = await report(f.cyUser, "Repaint the stair rail", { priority: "urgent" });
    await set(board.id, "low", null);
    expect((await one<{ priority: string }>(null, `select priority from public.tickets where id = $1::uuid`, [board.id])).priority).toBe("low");
    expect((await pgError(set(t.id, "panic", null))).code).toBe("22023");
  });

  it("25. \"I'm seeing this too\" and visit feedback", async () => {
    await note(f.boUser, f.ticketCommon, "Me too", { kind: "me_too" });
    expect((await pgError(note(f.boUser, f.ticketCommon, "Me too again", { kind: "me_too" }))).code).toBe("23505");
    expect((await pgError(note(f.adaUser, f.ticketUnit1, "Me too", { kind: "me_too" }))).code).toBe("22023");
    expect((await pgError(note(f.cyUser, f.ticketCommon, "Me too", { kind: "me_too", internal: true }))).code).toBe("22023");

    expect((await pgError(note(f.adaUser, f.ticketUnit1, "Went well", { kind: "visit_feedback" }))).code).toBe("22023");
    await q(f.cyUser, `update public.tickets set status = 'resolved' where id = $1::uuid`, [f.ticketUnit1]);
    await note(f.adaUser, f.ticketUnit1, "Went well, on time", { kind: "visit_feedback" });
  });

  it("26. building_emergency_info", async () => {
    await zaraBoard(db, f);
    await q(f.cyUser, `insert into public.building_emergency_info (association_id, water_shutoff_location, gas_utility_name, gas_emergency_phone) values ($1::uuid, 'Basement, left of the boiler', 'Peoples Gas', '866-556-6002')`, [
      f.damen,
    ]);
    await q(
      f.cyUser,
      `insert into public.building_emergency_contacts (association_id, person_id, name, label, phone, show_to_owners, sort_order)
       values ($1::uuid, $2::uuid, 'Cy Ferreira', 'Board president', '312-555-0103', true, 1),
              ($1::uuid, null, 'Night porter', null, '312-555-0199', false, 2)`,
      [f.damen, f.cyPerson],
    );
    const info = (user: string) =>
      rows<{ water_shutoff_location: string; gas_utility_name: string; contacts: { name: string }[] }>(
        user,
        `select * from public.building_emergency_info($1::uuid)`,
        [f.damen],
      );
    const ada = await info(f.adaUser);
    expect(ada).toHaveLength(1);
    expect(ada[0].water_shutoff_location).toBe("Basement, left of the boiler");
    expect(ada[0].contacts.map((c) => c.name)).toEqual(["Cy Ferreira"]);
    const cy = await info(f.cyUser);
    expect(cy[0].contacts.map((c) => c.name)).toEqual(["Cy Ferreira", "Night porter"]);
    expect(await info(f.zaraUser)).toEqual([]);
    expect(await rows(f.adaUser, `select * from public.building_emergency_info`)).toEqual([]);

    await boBoard(db, f);
    expect((await q(f.boUser, `delete from public.building_emergency_contacts where name = 'Night porter'`)).affectedRows).toBe(0);
    expect((await q(f.cyUser, `delete from public.building_emergency_contacts where name = 'Night porter'`)).affectedRows).toBe(1);
    const e = await pgError(
      q(f.cyUser, `insert into public.building_emergency_contacts (association_id, person_id, name, phone) values ($1::uuid, $2::uuid, 'Zara', '312-555-0111')`, [
        f.damen,
        f.zaraPerson,
      ]),
    );
    expect(e.code).toBe("42501");
    // A building with nothing entered still answers members, with no facts.
    const hoyne = await rows<{ water_shutoff_location: string | null; contacts: unknown[] }>(
      f.zaraUser,
      `select water_shutoff_location, contacts from public.building_emergency_info($1::uuid)`,
      [f.hoyne],
    );
    expect(hoyne).toEqual([{ water_shutoff_location: null, contacts: [] }]);
  });

  it("27. mark_repairs_seen", async () => {
    const seen = async (user: string) => (await one<{ s: string | null }>(user, `select public.mark_repairs_seen($1::uuid)::text as s`, [f.damen])).s;
    expect(await seen(f.boUser)).toBeNull();
    expect(await seen(f.boUser)).toBeNull();
    await q(null, `update public.repairs_seen set seen_at = '2026-10-01 12:00:00+00' where user_id = $1::uuid`, [f.boUser]);
    const since = await seen(f.boUser);
    expect(since).not.toBeNull();
    expect(new Date(since!).toISOString()).toBe("2026-10-01T12:00:00.000Z");
    const row = await one<{ prev: string }>(null, `select prev_seen_at::text as prev from public.repairs_seen where user_id = $1::uuid`, [f.boUser]);
    expect(new Date(row.prev).toISOString()).toBe("2026-10-01T12:00:00.000Z");

    expect(await rows(f.adaUser, `select * from public.repairs_seen`)).toEqual([]);
    expect((await q(f.adaUser, `update public.repairs_seen set seen_at = now() where user_id = $1::uuid`, [f.boUser])).affectedRows).toBe(0);
    await expect(
      q(f.adaUser, `insert into public.repairs_seen (association_id, user_id) values ($1::uuid, $2::uuid)`, [f.damen, f.boUser]),
    ).rejects.toThrow(/row-level security/);
    expect((await pgError(q(f.zaraUser, `select public.mark_repairs_seen($1::uuid)`, [f.damen]))).code).toBe("42501");
    expect(await count(`select 1 from public.repairs_seen`)).toBe(1);
  });

  // R6 self-check: dismissEmergencySuggestion is a PostgREST upsert on ticket_id
  // (merge-duplicates updates every column it sent). It must work with and
  // without an existing board-details row, keep the stored triage, and stay
  // board-only.
  it("28. the board dismisses an AI emergency suggestion with an upsert; owners and the accountant can't", async () => {
    const upsert = (user: string, ticketId: string, at: string) =>
      q(
        user,
        `insert into public.ticket_board_details (ticket_id, association_id, emergency_suggestion_dismissed_at)
         values ($1::uuid, $2::uuid, $3::timestamptz)
         on conflict (ticket_id) do update set ticket_id = excluded.ticket_id, association_id = excluded.association_id,
           emergency_suggestion_dismissed_at = excluded.emergency_suggestion_dismissed_at`,
        [ticketId, f.damen, at],
      );
    const dismissed = async (ticketId: string) =>
      (await one<{ at: string | null }>(null, `select emergency_suggestion_dismissed_at::text as at from public.ticket_board_details where ticket_id = $1::uuid`, [ticketId]))?.at ?? null;

    // No row yet: the upsert inserts one.
    await q(null, `delete from public.ticket_board_details where ticket_id = $1::uuid`, [f.ticketUnit1]);
    await upsert(f.cyUser, f.ticketUnit1, "2026-10-14 15:00:00+00");
    expect(new Date((await dismissed(f.ticketUnit1))!).toISOString()).toBe("2026-10-14T15:00:00.000Z");

    // A row with a stored triage: the upsert updates the stamp and keeps the triage.
    await q(f.cyUser, `select public.record_ticket_triage($1::uuid, $2::jsonb, null)`, [
      f.ticketCommon,
      JSON.stringify({ state: "done", trade: "roofing", urgency: "urgent", emergency: "flooding", questions: [], confidence: 0.8, search_phrase: "roof leak" }),
    ]);
    const before = await one<{ triage: { emergency?: string } | null }>(null, `select triage from public.ticket_board_details where ticket_id = $1::uuid`, [f.ticketCommon]);
    expect(before.triage?.emergency).toBe("flooding");
    await upsert(f.cyUser, f.ticketCommon, "2026-10-14 16:00:00+00");
    const after = await one<{ triage: unknown }>(null, `select triage from public.ticket_board_details where ticket_id = $1::uuid`, [f.ticketCommon]);
    expect(after.triage).toEqual(before.triage);
    expect(new Date((await dismissed(f.ticketCommon))!).toISOString()).toBe("2026-10-14T16:00:00.000Z");

    // Owners and the accountant are refused; the stamp is unchanged.
    await expect(upsert(f.adaUser, f.ticketCommon, "2026-10-14 17:00:00+00")).rejects.toThrow(/row-level security/);
    await expect(upsert(f.niaUser, f.ticketCommon, "2026-10-14 17:00:00+00")).rejects.toThrow(/row-level security/);
    expect(new Date((await dismissed(f.ticketCommon))!).toISOString()).toBe("2026-10-14T16:00:00.000Z");
  });
});
