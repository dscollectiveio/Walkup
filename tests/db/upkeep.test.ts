import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

// Upkeep schedule (0045): the board keeps it, every member can read it, and a
// log line records each time a task was done.
describe("upkeep (0045)", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
  });

  const addTask = (user: string) =>
    asUser(db, user, () =>
      db.query<{ id: string }>(
        `insert into public.upkeep_tasks (association_id, name, interval_months, due_month, next_due_on, created_by)
         values ($1::uuid, 'Boiler service', 12, 9, '2027-09-01', $2::uuid) returning id`,
        [f.damen, user],
      ),
    );

  it("a board member adds a task; an owner can read it but not add one", async () => {
    const { rows } = await addTask(f.cyUser);
    expect(rows).toHaveLength(1);
    // Owners read the schedule through the member view (0074); the table itself holds estimates and contractors.
    const seen = await asUser(db, f.adaUser, () => db.query(`select id from public.upkeep_tasks_member`));
    expect(seen.rows).toHaveLength(1);
    expect((await asUser(db, f.adaUser, () => db.query(`select id from public.upkeep_tasks`))).rows).toHaveLength(0);
    await expect(addTask(f.adaUser)).rejects.toThrow();
  });

  it("marking it done writes a log line the owner can see, and the task rolls forward", async () => {
    const { rows } = await addTask(f.cyUser);
    const id = rows[0].id;
    const logged = await asUser(db, f.cyUser, () =>
      db.query(
        `insert into public.upkeep_log (association_id, task_id, done_on, cost, note, created_by)
         values ($1::uuid, $2::uuid, '2026-09-14', 240, 'Serviced by the usual guy', $3::uuid)`,
        [f.damen, id, f.cyUser],
      ),
    );
    expect(logged.affectedRows).toBe(1);
    const rolled = await asUser(db, f.cyUser, () =>
      db.query(`update public.upkeep_tasks set last_done_on = '2026-09-14', next_due_on = '2027-09-01' where id = $1::uuid`, [id]),
    );
    expect(rolled.affectedRows).toBe(1);
    const ownerSees = await asUser(db, f.adaUser, () => db.query(`select note from public.upkeep_log_member where task_id = $1::uuid`, [id]));
    expect(ownerSees.rows).toHaveLength(1);
    const ownerLogs = await asUser(db, f.adaUser, () =>
      db.query(`insert into public.upkeep_log (association_id, task_id, done_on) values ($1::uuid, $2::uuid, '2026-09-15')`, [f.damen, id]),
    ).catch(() => null);
    expect(ownerLogs).toBeNull();
  });

  it("refuses a task for another association's row and audits writes", async () => {
    const { rows } = await addTask(f.cyUser);
    await expect(
      asUser(db, f.zaraUser, () =>
        db.query(
          `insert into public.upkeep_log (association_id, task_id, done_on) values ($1::uuid, $2::uuid, '2026-09-15')`,
          [f.hoyne, rows[0].id],
        ),
      ),
    ).rejects.toThrow();
    const audit = await db.query<{ n: number }>(`select count(*)::int as n from public.audit_log where table_name = 'upkeep_tasks'`);
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(1);
  });
});
