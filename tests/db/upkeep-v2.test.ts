import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { applyMigrations, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";
import { UPKEEP_CASES } from "../fixtures/upkeep-cases";
import { EXTRA, addHoyneTicket, addTasks, addVendors, boBoard, chicagoToday, pgError, queries, seededDb } from "./repairs-helpers";

/**
 * Migration 0053 upkeep v2 (repairs-spec §3.7, tests §17.2 `upkeep-v2`): the
 * schedule rule in SQL, the log trigger that keeps tasks in step, the
 * mark-done and add RPCs, admin-only deletes, and the backfills.
 */
describe("upkeep v2 (0053)", () => {
  let db: PGlite;
  let f: Fixture;
  const { q, one, rows, count } = queries(() => db);

  beforeEach(async () => {
    ({ db, f } = await seededDb());
    await addVendors(db, f);
    await addTasks(db, f);
  });
  afterEach(async () => {
    await db.close();
  });

  const task = (id: string = EXTRA.damenTask) =>
    one<{ last: string | null; next: string; vendor_id: string | null }>(
      null,
      `select last_done_on::text as last, next_due_on::text as next, vendor_id from public.upkeep_tasks where id = $1::uuid`,
      [id],
    );
  const done = (user: string, doneOn: string, extra: { cost?: string | null; vendor?: string | null; ticket?: string | null; taskId?: string } = {}) =>
    q<{ log_id: string; task_last_done_on: string; task_next_due_on: string }>(
      user,
      `select log_id, task_last_done_on::text, task_next_due_on::text from public.mark_upkeep_done($1::uuid, $2::date, $3::numeric, $4::uuid, 'Done', $5::uuid)`,
      [extra.taskId ?? EXTRA.damenTask, doneOn, extra.cost ?? null, extra.vendor ?? null, extra.ticket ?? null],
    );

  it("1. upkeep_next_due matches the shared case table", async () => {
    for (const c of UPKEEP_CASES) {
      const r = await one<{ d: string }>(null, `select public.upkeep_next_due($1::date, $2, $3)::text as d`, [c.doneOn, c.interval, c.month]);
      expect(r.d, `${c.doneOn} every ${c.interval} (${c.month ?? "any"}): ${c.why}`).toBe(c.expected);
    }
    expect((await one<{ d: string | null }>(null, `select public.upkeep_next_due(null, 12, 9)::text as d`)).d).toBeNull();
  });

  it("2. mark_upkeep_done logs, rolls the schedule and returns the next due date", async () => {
    const r = (await done(f.cyUser, "2026-09-14", { cost: "240.005" })).rows[0];
    expect(r).toMatchObject({ task_last_done_on: "2026-09-14", task_next_due_on: "2027-09-30" });
    expect(await task()).toMatchObject({ last: "2026-09-14", next: "2027-09-30" });
    const log = await one<{ cost: string; created_by: string; note: string }>(null, `select cost::text, created_by, note from public.upkeep_log where id = $1::uuid`, [r.log_id]);
    expect(log).toEqual({ cost: "240.01", created_by: f.cyUser, note: "Done" });
  });

  it("3. mark_upkeep_done refuses owners, future dates and negative costs", async () => {
    expect((await pgError(done(f.adaUser, "2026-09-14"))).code).toBe("42501");
    expect((await pgError(done(f.zaraUser, "2026-09-14"))).code).toBe("42501");
    expect((await pgError(q(f.cyUser, `select * from public.mark_upkeep_done($1::uuid, current_date + 5)`, [EXTRA.damenTask]))).code).toBe("22023");
    expect((await pgError(done(f.cyUser, "1999-12-31"))).code).toBe("22023");
    expect((await pgError(done(f.cyUser, "2026-09-14", { cost: "-1" }))).code).toBe("22023");
    expect(await count(`select 1 from public.upkeep_log`)).toBe(0);
  });

  it("4. a backdated completion older than the latest one doesn't move the schedule", async () => {
    await done(f.cyUser, "2026-09-14");
    const r = (await done(f.cyUser, "2025-09-10")).rows[0];
    expect(r).toMatchObject({ task_last_done_on: "2026-09-14", task_next_due_on: "2027-09-30" });
    expect(await count(`select 1 from public.upkeep_log`)).toBe(2);
  });

  it("5. giving a contractor sets the task's usual contractor", async () => {
    await done(f.cyUser, "2026-09-14", { vendor: EXTRA.damenVendor2 });
    expect((await task()).vendor_id).toBe(EXTRA.damenVendor2);
  });

  it("6. editing a log date recomputes; deleting the latest entry recomputes from the one before; deleting the only entry keeps next_due_on", async () => {
    const older = (await done(f.cyUser, "2025-09-10")).rows[0].log_id;
    const latest = (await done(f.cyUser, "2026-09-14")).rows[0].log_id;
    await q(f.cyUser, `update public.upkeep_log set done_on = '2026-10-05' where id = $1::uuid`, [latest]);
    expect(await task()).toMatchObject({ last: "2026-10-05", next: "2027-09-30" });
    const edited = await one<{ edited: boolean; created_by: string }>(null, `select edited_at is not null as edited, created_by from public.upkeep_log where id = $1::uuid`, [latest]);
    expect(edited).toEqual({ edited: true, created_by: f.cyUser });

    await q(f.cyUser, `delete from public.upkeep_log where id = $1::uuid`, [latest]);
    expect(await task()).toMatchObject({ last: "2025-09-10", next: "2026-09-30" });

    await q(f.cyUser, `delete from public.upkeep_log where id = $1::uuid`, [older]);
    expect(await task()).toMatchObject({ last: null, next: "2026-09-30" });
  });

  it("7. a board member can't delete log entries or tasks; an admin can", async () => {
    await boBoard(db, f);
    const log = (await done(f.boUser, "2026-09-14")).rows[0].log_id;
    expect((await q(f.boUser, `delete from public.upkeep_log where id = $1::uuid`, [log])).affectedRows).toBe(0);
    expect((await q(f.boUser, `delete from public.upkeep_tasks where id = $1::uuid`, [EXTRA.damenTask])).affectedRows).toBe(0);
    expect((await q(f.boUser, `update public.upkeep_log set note = 'Edited' where id = $1::uuid`, [log])).affectedRows).toBe(1);
    expect((await q(f.adaUser, `update public.upkeep_log set note = 'Mine' where id = $1::uuid`, [log])).affectedRows).toBe(0);
    expect((await q(f.cyUser, `delete from public.upkeep_log where id = $1::uuid`, [log])).affectedRows).toBe(1);
    expect((await q(f.cyUser, `delete from public.upkeep_tasks where id = $1::uuid`, [EXTRA.damenTask])).affectedRows).toBe(1);
  });

  it("8. a usual month is refused for a 5-month interval", async () => {
    const e = await pgError(
      q(f.cyUser, `insert into public.upkeep_tasks (association_id, name, interval_months, due_month, next_due_on) values ($1::uuid, 'Odd', 5, 3, '2027-03-31')`, [f.damen]),
    );
    expect(e.code).toBe("23514");
    await q(f.cyUser, `insert into public.upkeep_tasks (association_id, name, interval_months, due_month, next_due_on) values ($1::uuid, 'Odd', 5, null, '2027-03-31')`, [f.damen]);
  });

  it("10. log entries refuse another association's contractor or ticket", async () => {
    await addHoyneTicket(db, f);
    expect((await pgError(done(f.cyUser, "2026-09-14", { vendor: EXTRA.hoyneVendor }))).code).toBe("42501");
    expect((await pgError(done(f.cyUser, "2026-09-14", { ticket: EXTRA.hoyneTicket }))).code).toBe("42501");
  });

  // PGlite is one connection, so a real race cannot be staged here; what is pinned is the ORDER in the
  // function body: the task row is locked (select ... from upkeep_tasks ... for update) before the log is read.
  it("11. the log sync locks the task row before it reads the log", async () => {
    const def = await one<{ d: string }>(null, `select pg_get_functiondef('public.tg_upkeep_log_sync'::regproc) as d`);
    const body = def.d.toLowerCase().replace(/\s+/g, " ");
    const lock = body.search(/from public\.upkeep_tasks k where k\.id = v_task_id for update/);
    const read = body.search(/max\(l\.done_on\).*from public\.upkeep_log l/);
    expect(lock, "the task row lock").toBeGreaterThan(-1);
    expect(read, "the read of the log").toBeGreaterThan(-1);
    expect(lock).toBeLessThan(read);
  });

  it("12. add_upkeep_task: next due precedence and first history entry", async () => {
    const add = (user: string, last: string | null, next: string | null, initial = "2026-11-30") =>
      one<{ task_id: string; task_next_due_on: string }>(
        user,
        `select task_id, task_next_due_on::text from public.add_upkeep_task($1::uuid, 'Gutters', null, 12, 11, 'gutters', null, 300, $2::date, $3::date, $4::date)`,
        [f.damen, initial, last, next],
      );
    const onlyLast = await add(f.cyUser, "2025-11-20", null);
    expect(onlyLast.task_next_due_on).toBe("2026-11-30");
    expect(await count(`select 1 from public.upkeep_log where task_id = $1::uuid and done_on = '2025-11-20'`, [onlyLast.task_id])).toBe(1);

    const both = await add(f.cyUser, "2025-11-20", "2027-01-15");
    expect(both.task_next_due_on).toBe("2027-01-15");
    expect((await task(both.task_id)).last).toBe("2025-11-20");

    const neither = await add(f.cyUser, null, null, "2026-11-30");
    expect(neither.task_next_due_on).toBe("2026-11-30");
    expect(await count(`select 1 from public.upkeep_log where task_id = $1::uuid`, [neither.task_id])).toBe(0);

    expect((await pgError(add(f.adaUser, null, null))).code).toBe("42501");
    const today = await chicagoToday(db);
    const tomorrow = (await one<{ d: string }>(null, `select ($1::date + 1)::text as d`, [today])).d;
    expect((await pgError(add(f.cyUser, tomorrow, null))).code).toBe("22023");
    expect(
      (await pgError(q(f.cyUser, `select * from public.add_upkeep_task($1::uuid, 'Odd', null, 5, null, null, null, null, '2027-01-01')`, [f.damen]))).code,
    ).toBe("22023");
    const created = await one<{ created_by: string; trade: string }>(null, `select created_by, trade from public.upkeep_tasks where id = $1::uuid`, [neither.task_id]);
    expect(created).toEqual({ created_by: f.cyUser, trade: "gutters" });
  });

  it("13. a ticket logs upkeep at most once", async () => {
    await done(f.cyUser, "2026-09-14", { ticket: f.ticketCommon });
    expect((await pgError(done(f.cyUser, "2026-09-20", { ticket: f.ticketCommon }))).code).toBe("23505");
  });

  it("the task row pins who created it and stamps updated_at", async () => {
    await q(f.cyUser, `update public.upkeep_tasks set name = 'Boiler tune-up', created_by = $2::uuid, association_id = $3::uuid where id = $1::uuid`, [
      EXTRA.damenTask,
      f.adaUser,
      f.hoyne,
    ]);
    const r = await one<{ name: string; created_by: string | null; association_id: string; touched: boolean }>(
      null,
      `select name, created_by, association_id, updated_at > now() - interval '1 minute' as touched from public.upkeep_tasks where id = $1::uuid`,
      [EXTRA.damenTask],
    );
    expect(r).toEqual({ name: "Boiler tune-up", created_by: null, association_id: f.damen, touched: true });
    // Owners read the schedule through the member view (0074), not the table.
    expect(await rows(f.adaUser, `select id from public.upkeep_tasks_member where id = $1::uuid`, [EXTRA.damenTask])).toHaveLength(1);
    expect(await rows(f.adaUser, `select id from public.upkeep_tasks where id = $1::uuid`, [EXTRA.damenTask])).toHaveLength(0);
  });
});

describe("upkeep v2: backfills (migration path)", () => {
  let db: PGlite;
  let f: Fixture;
  const { one } = queries(() => db);
  const T = {
    yearly: "ab000000-0000-0000-0000-0000000000f1",
    halfYear: "ab000000-0000-0000-0000-0000000000f2",
    gutters: "ab000000-0000-0000-0000-0000000000f3",
    tree: "ab000000-0000-0000-0000-0000000000f4",
    wheat: "ab000000-0000-0000-0000-0000000000f5",
    odd: "ab000000-0000-0000-0000-0000000000f6",
  };

  beforeAll(async () => {
    db = await freshDb({ before: "0053" });
    f = await seed(db);
    await db.query(
      `insert into public.upkeep_tasks (id, association_id, name, interval_months, due_month, last_done_on, next_due_on) values
         ($1::uuid, $7::uuid, 'Boiler service', 12, 9, null, '2027-09-01'),
         ($2::uuid, $7::uuid, 'Furnace filters', 6, 4, '2026-04-10', '2027-04-01'),
         ($3::uuid, $7::uuid, 'Clean the gutters', 12, null, null, '2026-11-15'),
         ($4::uuid, $7::uuid, 'Street tree check', 12, null, null, '2026-11-15'),
         ($5::uuid, $7::uuid, 'Wheat paste removal', 12, null, null, '2026-11-15'),
         ($6::uuid, $7::uuid, 'Odd cadence', 5, 3, null, '2027-03-01')`,
      [T.yearly, T.halfYear, T.gutters, T.tree, T.wheat, T.odd, f.damen],
    );
    await applyMigrations(db, { from: "0053" });
  });
  afterAll(async () => {
    await db.close();
  });

  const row = (id: string) =>
    one<{ next: string; trade: string | null; due_month: number | null }>(
      null,
      `select next_due_on::text as next, trade, due_month from public.upkeep_tasks where id = $1::uuid`,
      [id],
    );

  it("9. backfill moved seasonal due dates to month end and recomputed sub-annual seasonal tasks", async () => {
    expect((await row(T.yearly)).next).toBe("2027-09-30");
    expect((await row(T.halfYear)).next).toBe("2026-10-31");
    // A month that doesn't fit the interval is dropped rather than kept unexplained.
    expect(await row(T.odd)).toMatchObject({ due_month: null, next: "2027-03-01" });
  });

  it("14. the upkeep trade backfill uses word boundaries", async () => {
    expect((await row(T.gutters)).trade).toBe("gutters");
    expect((await row(T.tree)).trade).toBe("tree");
    expect((await row(T.wheat)).trade).toBeNull();
    expect((await row(T.yearly)).trade).toBe("hvac");
  });
});
