import { beforeEach, afterEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asService, asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

/**
 * Migration 0055 (DECISIONS #36): Walkup sends no email unless a board admin
 * approved it, and the limits live in SQL. Every limit in the spec's table 3.2
 * has a test here, plus isolation, opt-out, bounce handling and redaction.
 */

const MEL_USER = "dddd0000-0000-0000-0000-0000000000a1"; // board_member, not admin
const MEL_PERSON = "eeee0000-0000-0000-0000-0000000000a1";
const DEE_USER = "dddd0000-0000-0000-0000-0000000000a2"; // owner with no login yet? (has a login) of unit 3 too
const DEE_PERSON = "eeee0000-0000-0000-0000-0000000000a2";
const HOYNE_BOARD_USER = "dddd0000-0000-0000-0000-0000000000a3"; // board_admin of Hoyne
const HOYNE_BOARD_PERSON = "eeee0000-0000-0000-0000-0000000000a3";
const JOURNAL = "3e000000-0000-0000-0000-000000000001";
const OPERATING = "ffff0000-0000-0000-0000-000000000001";

type Err = { code?: string; message: string; hint?: string };
type Facts = { units: { unit_id: string; owed: string; overdue: string; closing: string; charges: string; lines: unknown[] }[]; fee_amount?: string; fee_charge_id?: string };
type Claimed = {
  outbox_id: string; claim_token: string; to_email: string; attempts: number; idempotency_key: string; kind: string;
  reply_to_email: string; reply_to_name: string; association_name: string; has_login: boolean; unsubscribe_token: string;
};
type Row = Record<string, unknown>;

describe("email reminders and statements (0055)", () => {
  let db: PGlite;
  let f: Fixture;

  const arr = (ids: string[]) => `{${ids.join(",")}}`;
  const q = <T extends object = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    db.query<T>(sql, params);
  const asCy = <T>(fn: () => Promise<T>) => asUser(db, f.cyUser, fn);
  const asMel = <T>(fn: () => Promise<T>) => asUser(db, MEL_USER, fn);
  const asAda = <T>(fn: () => Promise<T>) => asUser(db, f.adaUser, fn);
  const asAnon = async <T>(fn: () => Promise<T>) => {
    await db.exec(`select set_config('request.jwt.claims', '', false); set role anon;`);
    try {
      return await fn();
    } finally {
      await db.exec(`reset role;`);
    }
  };
  const fail = async (p: Promise<unknown>): Promise<Err> => {
    try {
      await p;
    } catch (e) {
      return e as Err;
    }
    throw new Error("expected the call to fail");
  };

  /** prepare as Cy, return the batch id */
  const prepare = async (
    kind: string,
    units: string[],
    opts: { from?: string; to?: string; announcement?: string; fee?: string; user?: string } = {},
  ) => {
    const { rows } = await asUser(db, opts.user ?? f.cyUser, () =>
      db.query<{ id: string }>(
        `select public.email_prepare_batch($1::uuid, $2, $3::uuid[], $4::date, $5::date, $6::uuid, $7::uuid) as id`,
        [f.damen, kind, arr(units), opts.from ?? null, opts.to ?? null, opts.announcement ?? null, opts.fee ?? null],
      ),
    );
    return rows[0].id;
  };
  const outbox = async (batch: string) =>
    (
      await q<{ id: string; person_id: string; status: string; skip_reason: string | null; to_email: string; facts: Facts; unit_ids: string[]; board_note: string | null; attempts: number; kind: string }>(
        `select id, person_id, status, skip_reason, to_email, facts, unit_ids, board_note, attempts, kind
           from public.email_outbox where batch_id = $1::uuid order by to_email`,
        [batch],
      )
    ).rows;
  const approve = (batch: string, user: string = f.cyUser) =>
    asUser(db, user, () =>
      db.query<{ queued: number; skipped: number }>(`select * from public.email_approve_batch($1::uuid)`, [batch]),
    );
  const claim = (batch: string | null, limit = 10, user: string | null = f.cyUser) =>
    asUser(db, user, () =>
      db.query<Claimed>(`select * from public.email_claim($1::uuid, $2)`, [batch, limit]),
    );
  const markSent = (id: string, token: string, provider: string) =>
    asCy(() => db.query(`select public.email_mark_sent($1::uuid, $2::uuid, $3, 'Subject')`, [id, token, provider]));
  /** full flow for one person's reminder to status 'sent' */
  const sendReminderTo = async (unit: string, provider: string) => {
    const b = await prepare("dues_reminder", [unit]);
    await approve(b);
    const c = await claim(b);
    expect(c.rows).toHaveLength(1);
    await markSent(c.rows[0].outbox_id, c.rows[0].claim_token, provider);
    return { batch: b, id: c.rows[0].outbox_id as string, token: c.rows[0].claim_token as string };
  };
  const addCharge = (unit: string, amount: string, dueOn = "2026-02-01", type = "assessment") =>
    q<{ id: string }>(
      `insert into public.assessment_charges (association_id, unit_id, charge_type, period_start, due_on, amount)
       values ($1::uuid, $2::uuid, $3::public.charge_type, $4::date, $4::date, $5::numeric) returning id`,
      [f.damen, unit, type, dueOn, amount],
    ).then((r) => r.rows[0].id);

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
    await db.exec(`
      insert into auth.users (id, email) values
        ('${MEL_USER}', 'mel@example.test'), ('${DEE_USER}', 'dee@example.test'), ('${HOYNE_BOARD_USER}', 'hb@example.test');
      insert into public.persons (id, association_id, full_name, email, auth_user_id) values
        ('${MEL_PERSON}', '${f.damen}', 'Mel Board', 'mel@example.test', '${MEL_USER}'),
        ('${DEE_PERSON}', '${f.damen}', 'Dee Owner', 'dee@example.test', null),
        ('${HOYNE_BOARD_PERSON}', '${f.hoyne}', 'Hal Hoyne', 'hb@example.test', '${HOYNE_BOARD_USER}');
      insert into public.role_grants (association_id, person_id, role, granted_on) values
        ('${f.damen}', '${MEL_PERSON}', 'board_member', '2024-01-01'),
        ('${f.hoyne}', '${HOYNE_BOARD_PERSON}', 'board_admin', '2024-01-01');
      update public.associations set board_contact_email = 'board@example.test', board_contact_name = 'Cy Ferreira'
       where id = '${f.damen}';
    `);
    await asCy(() => db.query(`select public.email_set_sending($1::uuid, true)`, [f.damen]));
  });

  afterEach(async () => {
    await db.close();
  });

  // ------------------------------------------------------------------ settings and approval

  describe("settings and approval", () => {
    it("1. refuses to turn sending on without a board contact email, then stamps who and when", async () => {
      await q(`update public.email_settings set sending_enabled = false, enabled_at = null`);
      await q(`update public.associations set board_contact_email = null where id = $1::uuid`, [f.damen]);
      const e = await fail(asCy(() => db.query(`select public.email_set_sending($1::uuid, true)`, [f.damen])));
      expect(e.code).toBe("22023");
      expect(e.hint).toBe("no_reply_to");

      await q(`update public.associations set board_contact_email = 'board@example.test' where id = $1::uuid`, [f.damen]);
      await asCy(() => db.query(`select public.email_set_sending($1::uuid, true)`, [f.damen]));
      const { rows } = await q<{ sending_enabled: boolean; enabled_at: string | null; enabled_by: string }>(
        `select sending_enabled, enabled_at, enabled_by from public.email_settings where association_id = $1::uuid`,
        [f.damen],
      );
      expect(rows[0].sending_enabled).toBe(true);
      expect(rows[0].enabled_at).not.toBeNull();
      expect(rows[0].enabled_by).toBe(f.cyUser);
    });

    it("2. lets only a board admin switch, cap, save rules and approve", async () => {
      const b = await prepare("dues_reminder", [f.unit1]);
      for (const user of [f.adaUser, MEL_USER]) {
        const calls: [string, unknown[]][] = [
          [`select public.email_set_sending($1::uuid, true)`, [f.damen]],
          [`select public.email_set_daily_cap($1::uuid, 50)`, [f.damen]],
          [`select public.email_save_rule($1::uuid, 'dues_overdue', 7, 1, 7, 3, false)`, [f.damen]],
          [`select * from public.email_approve_batch($1::uuid)`, [b]],
        ];
        for (const [sql, params] of calls) {
          const e = await fail(asUser(db, user, () => db.query(sql, params)));
          expect(e.code, sql).toBe("42501");
        }
      }
    });

    it("3. lets only a platform admin suspend; a suspended building cannot approve and claims skip", async () => {
      const e = await fail(
        asCy(() => db.query(`select public.email_suspend($1::uuid, true, 'abuse')`, [f.damen])),
      );
      expect(e.code).toBe("42501");

      const b = await prepare("dues_reminder", [f.unit1]);
      await approve(b);
      await q(`insert into public.platform_admins (user_id) values ($1::uuid)`, [f.vicUser]);
      await asUser(db, f.vicUser, () =>
        db.query(`select public.email_suspend($1::uuid, true, 'Reported spam')`, [f.damen]),
      );
      const c = await claim(b);
      expect(c.rows).toHaveLength(0);
      expect((await outbox(b))[0]).toMatchObject({ status: "skipped", skip_reason: "sending_off" });

      const b2 = await prepare("dues_reminder", [f.unit2]);
      const e2 = await fail(approve(b2));
      expect(e2.code).toBe("22023");
      expect(e2.hint).toBe("sending_off");
    });

    it("4. rejects a daily limit of 0 or 201", async () => {
      for (const n of [0, 201]) {
        const e = await fail(asCy(() => db.query(`select public.email_set_daily_cap($1::uuid, $2)`, [f.damen, n])));
        expect(e.code).toBe("22023");
      }
      await asCy(() => db.query(`select public.email_set_daily_cap($1::uuid, 200)`, [f.damen]));
    });

    it("5. cancels drafts and queued mail and disables every rule when sending is switched off", async () => {
      const draft = await prepare("dues_reminder", [f.unit1]);
      const queued = await prepare("dues_reminder", [f.unit2]);
      await approve(queued);
      await asCy(() =>
        db.query(`select public.email_save_rule($1::uuid, 'dues_overdue', 7, 1, 7, 3, true)`, [f.damen]),
      );
      await asCy(() => db.query(`select public.email_set_sending($1::uuid, false)`, [f.damen]));
      expect((await outbox(draft))[0]).toMatchObject({ status: "cancelled", skip_reason: "sending_off" });
      expect((await outbox(queued))[0]).toMatchObject({ status: "cancelled", skip_reason: "sending_off" });
      const { rows } = await q<{ enabled: boolean }>(`select enabled from public.reminder_rules`);
      expect(rows.every((r) => !r.enabled)).toBe(true);
    });
  });

  // ------------------------------------------------------------------ prepare

  describe("prepare", () => {
    it("6. makes one draft per current owner, with the amounts the ledger shows", async () => {
      const b = await prepare("dues_reminder", [f.unit1, f.unit2]);
      const rows = await outbox(b);
      expect(rows.map((r) => r.status)).toEqual(["draft", "draft"]);
      for (const r of rows) {
        const unit = r.facts.units[0].unit_id as string;
        const { rows: s } = await asCy(() =>
          db.query<{ owed: string; overdue: string }>(
            `select owed, overdue from public.unit_statement_summary($1::uuid, current_date)`,
            [unit],
          ),
        );
        expect(r.facts.units[0].owed).toBe(s[0].owed);
        expect(r.facts.units[0].overdue).toBe(s[0].overdue);
        expect(r.facts.units[0].lines.length).toBeGreaterThan(0);
      }
      expect(rows.map((r) => r.facts.units[0].owed).sort()).toEqual(["500.00", "750.00"]);
    });

    it("7. makes no row for a unit with nothing overdue, and one row for a person with two behind units", async () => {
      const none = await prepare("dues_reminder", [f.unit3]);
      expect(await outbox(none)).toHaveLength(0);

      await q(
        `insert into public.unit_owners (association_id, unit_id, person_id, effective_from)
         values ($1::uuid, $2::uuid, $3::uuid, '2020-01-01')`,
        [f.damen, f.unit3, f.adaPerson],
      );
      await addCharge(f.unit3, "100.00", "2026-03-01");
      const b = await prepare("dues_reminder", [f.unit1, f.unit3]);
      const rows = (await outbox(b)).filter((r) => r.to_email === "ada@example.test");
      expect(rows).toHaveLength(1);
      expect(rows[0].facts.units).toHaveLength(2);
      expect([...rows[0].unit_ids].sort()).toEqual([f.unit1, f.unit3].sort());
    });

    it("8. refuses units from another association and more than 100 units", async () => {
      const e = await fail(
        asCy(() =>
          db.query(`select public.email_prepare_batch($1::uuid, 'dues_reminder', $2::uuid[])`, [f.damen, arr([f.hoyneUnit])]),
        ),
      );
      expect(e.code).toBe("42501");
      const many = Array.from({ length: 101 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`);
      const e2 = await fail(
        asCy(() =>
          db.query(`select public.email_prepare_batch($1::uuid, 'dues_reminder', $2::uuid[])`, [f.damen, arr(many)]),
        ),
      );
      expect(e2.code).toBe("22023");
    });

    it("9. marks people who cannot be emailed as skipped with the right reason", async () => {
      // Ada: opted out of everything. Bo: no email. Check statements=false does not block a reminder.
      await q(`insert into public.email_preferences (association_id, person_id, unsubscribed_all) values ($1::uuid, $2::uuid, true) on conflict (person_id) do update set unsubscribed_all = excluded.unsubscribed_all`, [f.damen, f.adaPerson]);
      await q(`update public.persons set email = null where id = $1::uuid`, [f.boPerson]);
      const b = await prepare("dues_reminder", [f.unit1, f.unit2]);
      const rows = await outbox(b);
      const byEmail = Object.fromEntries(rows.map((r) => [r.to_email, r]));
      expect(byEmail["ada@example.test"]).toMatchObject({ status: "skipped", skip_reason: "opted_out" });
      expect(byEmail["invalid@invalid.invalid"]).toMatchObject({ status: "skipped", skip_reason: "no_email" });

      // suppressed address
      await q(`delete from public.email_preferences`);
      await q(`update public.persons set email = 'bo@example.test' where id = $1::uuid`, [f.boPerson]);
      await q(`insert into public.email_suppressions (association_id, email, reason) values ($1::uuid, 'bo@example.test', 'bounce')`, [f.damen]);
      const b2 = await prepare("dues_reminder", [f.unit2]);
      expect((await outbox(b2))[0]).toMatchObject({ status: "skipped", skip_reason: "suppressed" });

      // dues_reminders=false skips; statements=false does not block a reminder
      await q(`delete from public.email_suppressions`);
      await q(`insert into public.email_preferences (association_id, person_id, dues_reminders) values ($1::uuid, $2::uuid, false) on conflict (person_id) do update set dues_reminders = excluded.dues_reminders`, [f.damen, f.boPerson]);
      await q(`insert into public.email_preferences (association_id, person_id, statements) values ($1::uuid, $2::uuid, false) on conflict (person_id) do update set statements = excluded.statements`, [f.damen, f.adaPerson]);
      const b3 = await prepare("dues_reminder", [f.unit1, f.unit2]);
      const r3 = Object.fromEntries((await outbox(b3)).map((r) => [r.to_email, r]));
      expect(r3["bo@example.test"]).toMatchObject({ status: "skipped", skip_reason: "opted_out" });
      expect(r3["ada@example.test"].status).toBe("draft");
    });

    it("10. builds statement facts whose closing balance matches the statement, and needs both dates", async () => {
      const e = await fail(
        asCy(() =>
          db.query(`select public.email_prepare_batch($1::uuid, 'statement', $2::uuid[], '2026-01-01')`, [f.damen, arr([f.unit2])]),
        ),
      );
      expect(e.code).toBe("22023");
      const b = await prepare("statement", [f.unit2], { from: "2026-01-01", to: "2026-03-31" });
      const rows = await outbox(b);
      expect(rows).toHaveLength(1);
      const { rows: st } = await asCy(() =>
        db.query<{ balance: string }>(
          `select balance from public.unit_statement($1::uuid, '2026-01-01', '2026-03-31') order by seq desc limit 1`,
          [f.unit2],
        ),
      );
      expect(rows[0].facts.units[0].closing).toBe(st[0].balance);
      expect(rows[0].facts.units[0].closing).toBe("750.00");
      expect(rows[0].facts.units[0].charges).toBe("750.00");
    });

    it("11. refuses a waived, written-off or settled late fee, and includes the fee amount", async () => {
      const fee = await addCharge(f.unit2, "25.00", "2026-02-15", "late_fee");
      const b = await prepare("late_fee_notice", [], { fee });
      const rows = await outbox(b);
      expect(rows).toHaveLength(1);
      expect(rows[0].facts.fee_amount).toBe("25.00");
      expect(rows[0].facts.fee_charge_id).toBe(fee);

      await q(`update public.assessment_charges set waived_at = now() where id = $1::uuid`, [fee]);
      const e = await fail(prepare("late_fee_notice", [], { fee }));
      expect(e.hint).toBe("fee_not_open");

      const fee2 = await addCharge(f.unit2, "25.00", "2026-03-15", "late_fee");
      await q(`update public.assessment_charges set written_off_at = now() where id = $1::uuid`, [fee2]);
      expect((await fail(prepare("late_fee_notice", [], { fee: fee2 }))).hint).toBe("fee_not_open");

      // fully paid: payment + allocation
      const fee3 = await addCharge(f.unit2, "25.00", "2026-04-15", "late_fee");
      const pay = await q<{ id: string }>(
        `insert into public.payments (association_id, unit_id, received_on, amount, method, fund_id, journal_entry_id)
         values ($1::uuid, $2::uuid, '2026-04-20', 25, 'check', $3::uuid, $4::uuid) returning id`,
        [f.damen, f.unit2, OPERATING, JOURNAL],
      );
      await q(`insert into public.payment_allocations (association_id, payment_id, charge_id, amount) values ($1::uuid, $2::uuid, $3::uuid, 25)`, [f.damen, pay.rows[0].id, fee3]);
      expect((await fail(prepare("late_fee_notice", [], { fee: fee3 }))).hint).toBe("fee_not_open");
    });

    it("12. refuses an unposted announcement and sends a targeted one only to that unit's owners", async () => {
      const draftId = (
        await q<{ id: string }>(
          `insert into public.announcements (association_id, title, body, audience, status)
           values ($1::uuid, 'Hello', 'Body', 'all', 'draft') returning id`,
          [f.damen],
        )
      ).rows[0].id;
      const e = await fail(prepare("announcement", [], { announcement: draftId }));
      expect(e.code).toBe("22023");

      const pub = (
        await q<{ id: string }>(
          `insert into public.announcements (association_id, title, body, audience, status, published_at)
           values ($1::uuid, 'Water off', 'Tuesday', 'units', 'published', now()) returning id`,
          [f.damen],
        )
      ).rows[0].id;
      await q(`insert into public.announcement_units (association_id, announcement_id, unit_id) values ($1::uuid, $2::uuid, $3::uuid)`, [f.damen, pub, f.unit2]);
      const rows = await outbox(await prepare("announcement", [], { announcement: pub }));
      expect(rows.map((r) => r.to_email)).toEqual(["bo@example.test"]);

      const all = (
        await q<{ id: string }>(
          `insert into public.announcements (association_id, title, body, audience, status, published_at)
           values ($1::uuid, 'Everyone', 'Hi', 'all', 'published', now()) returning id`,
          [f.damen],
        )
      ).rows[0].id;
      const rows2 = await outbox(await prepare("announcement", [], { announcement: all }));
      expect(rows2.map((r) => r.to_email).sort()).toEqual(["ada@example.test", "bo@example.test", "cy@example.test"]);
    });

    it("13. does not email an owner whose ownership has ended", async () => {
      await q(`update public.unit_owners set effective_to = '2026-06-01' where unit_id = $1::uuid`, [f.unit2]);
      const b = await prepare("dues_reminder", [f.unit2]);
      expect(await outbox(b)).toHaveLength(0);
    });

    it("14. edits a note, enforces the note limits, freezes after approval, and leaves people out", async () => {
      const b = await prepare("dues_reminder", [f.unit1, f.unit2]);
      const [ada, bo] = await outbox(b);
      await asCy(() => db.query(`select public.email_edit_draft($1::uuid, 'Please call me.', false)`, [ada.id]));
      expect((await outbox(b))[0].board_note).toBe("Please call me.");

      for (const bad of ["see http://x.test", "visit www.x.test", "mail me@x.test", "x".repeat(501)]) {
        const e = await fail(asCy(() => db.query(`select public.email_edit_draft($1::uuid, $2, false)`, [ada.id, bad])));
        expect(e.code, bad).toBe("23514");
      }

      await asCy(() => db.query(`select public.email_edit_draft($1::uuid, null, true)`, [bo.id]));
      expect((await outbox(b))[1]).toMatchObject({ status: "cancelled", skip_reason: "left_out" });

      await approve(b);
      const e = await fail(asCy(() => db.query(`select public.email_edit_draft($1::uuid, 'Changed', false)`, [ada.id])));
      expect(e.code).toBe("22023");
    });
  });

  // ------------------------------------------------------------------ approve, claim, send

  describe("approve, claim and send", () => {
    it("15. queues eligible rows, skips weekly_cap, and logs queued and skipped", async () => {
      await sendReminderTo(f.unit1, "prov-ada-1");
      const b = await prepare("dues_reminder", [f.unit1, f.unit2]);
      // Ada was already emailed: prepare itself marks her skipped
      const rows = await outbox(b);
      expect(rows.find((r) => r.to_email === "ada@example.test")).toMatchObject({ status: "skipped", skip_reason: "weekly_cap" });

      // The race the spec names: a draft prepared BEFORE the earlier mail went out is skipped at approval.
      const early = await prepare("dues_reminder", [f.unit2]);
      const prior = await prepare("dues_reminder", [f.unit2]);
      await approve(prior);
      const res = await approve(early);
      expect(res.rows[0]).toMatchObject({ queued: 0, skipped: 1 });
      expect((await outbox(early))[0]).toMatchObject({ status: "skipped", skip_reason: "weekly_cap" });

      const approved = await approve(b);
      expect(approved.rows[0].queued).toBe(0); // Bo is now covered by `prior`
      // the log rows of THESE batches, not the earlier send's
      const { rows: log } = await q<{ event: string }>(
        `select l.event from public.email_log l join public.email_outbox o on o.id = l.outbox_id
          where o.batch_id = any ($1::uuid[]) and l.event in ('queued', 'skipped')`,
        [`{${[prior, early, b].join(",")}}`],
      );
      expect(log.filter((l) => l.event === "queued")).toHaveLength(1); // only `prior` was queued
      expect(log.filter((l) => l.event === "skipped").length).toBeGreaterThanOrEqual(2); // `early` at approval, `b` for Ada
    });

    it("16. stops at the daily remainder and applies the warm-up of 20 a day for the first week", async () => {
      await asCy(() => db.query(`select public.email_set_daily_cap($1::uuid, 1)`, [f.damen]));
      const b = await prepare("dues_reminder", [f.unit1, f.unit2]);
      const res = await approve(b);
      expect(res.rows[0]).toMatchObject({ queued: 1, skipped: 1 });
      expect((await outbox(b)).map((r) => r.skip_reason)).toContain("daily_cap");

      const remaining = async () =>
        (await q<{ n: number }>(`select public.email_daily_remaining($1::uuid) as n`, [f.damen])).rows[0].n;
      await q(`update public.email_settings set daily_cap = 200 where association_id = $1::uuid`, [f.damen]);
      await q(`update public.email_settings set enabled_at = now() where association_id = $1::uuid`, [f.damen]);
      expect(await remaining()).toBe(20);
      await q(`update public.email_settings set enabled_at = now() - interval '8 days' where association_id = $1::uuid`, [f.damen]);
      expect(await remaining()).toBe(200);
    });

    it("17. does not let a board member or another building's admin approve", async () => {
      const b = await prepare("dues_reminder", [f.unit1]);
      expect((await fail(approve(b, MEL_USER))).code).toBe("42501");
      expect((await fail(approve(b, HOYNE_BOARD_USER))).code).toBe("42501");
      expect((await fail(approve(b, f.adaUser))).code).toBe("42501");
    });

    it("18. claims for the board admin with reply-to, unsubscribe token and login flag; refuses others", async () => {
      const b = await prepare("dues_reminder", [f.unit1]);
      await approve(b);
      expect((await fail(claim(b, 10, HOYNE_BOARD_USER))).code).toBe("42501");
      expect((await fail(claim(b, 10, f.adaUser))).code).toBe("42501");
      expect((await fail(claim(b, 10, MEL_USER))).code).toBe("42501");
      const { rows } = await claim(b);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        to_email: "ada@example.test",
        reply_to_email: "board@example.test",
        reply_to_name: "Cy Ferreira",
        association_name: "2158 N. Damen",
        has_login: true,
        attempts: 1,
      });
      expect(rows[0].unsubscribe_token).toHaveLength(96);
      expect(rows[0].idempotency_key).toBe(`wk-${rows[0].outbox_id}`);
    });

    it("19. skips and records address_changed when the person's email changed after approval", async () => {
      const b = await prepare("dues_reminder", [f.unit1]);
      await approve(b);
      await q(`update public.persons set email = 'ada.new@example.test' where id = $1::uuid`, [f.adaPerson]);
      const { rows } = await claim(b);
      expect(rows).toHaveLength(0);
      expect((await outbox(b))[0]).toMatchObject({ status: "skipped", skip_reason: "address_changed" });
    });

    it("20. skips balance_changed when a charge is added, or a payment clears the balance", async () => {
      const b = await prepare("dues_reminder", [f.unit1, f.unit2]);
      await approve(b);
      await addCharge(f.unit1, "40.00", "2026-05-01");
      const pay = await q<{ id: string }>(
        `insert into public.payments (association_id, unit_id, received_on, amount, method, fund_id, journal_entry_id)
         values ($1::uuid, $2::uuid, '2026-05-02', 750, 'check', $3::uuid, $4::uuid) returning id`,
        [f.damen, f.unit2, OPERATING, JOURNAL],
      );
      await q(`insert into public.payment_allocations (association_id, payment_id, charge_id, amount) values ($1::uuid, $2::uuid, $3::uuid, 750)`, [f.damen, pay.rows[0].id, f.boCharge]);
      const { rows } = await claim(b);
      expect(rows).toHaveLength(0);
      expect((await outbox(b)).map((r) => r.skip_reason)).toEqual(["balance_changed", "balance_changed"]);
    });

    it("21. skips opted_out and suppressed that happened after approval", async () => {
      const b = await prepare("dues_reminder", [f.unit1, f.unit2]);
      await approve(b);
      await q(`insert into public.email_preferences (association_id, person_id, dues_reminders) values ($1::uuid, $2::uuid, false) on conflict (person_id) do update set dues_reminders = excluded.dues_reminders`, [f.damen, f.adaPerson]);
      await q(`insert into public.email_suppressions (association_id, email, reason) values ($1::uuid, 'bo@example.test', 'bounce')`, [f.damen]);
      const { rows } = await claim(b);
      expect(rows).toHaveLength(0);
      const reasons = Object.fromEntries((await outbox(b)).map((r) => [r.to_email, r.skip_reason]));
      expect(reasons).toEqual({ "ada@example.test": "opted_out", "bo@example.test": "suppressed" });
    });

    it("22. needs the claim token to mark sent, and is idempotent for the same provider id", async () => {
      const b = await prepare("dues_reminder", [f.unit1]);
      await approve(b);
      const [c] = (await claim(b)).rows;
      const e = await fail(markSent(c.outbox_id, "99999999-9999-9999-9999-999999999999", "prov-1"));
      expect(e.code).toBe("22023");
      await markSent(c.outbox_id, c.claim_token, "prov-1");
      await markSent(c.outbox_id, c.claim_token, "prov-1");
      const { rows } = await q<{ status: string; sent_at: string | null; subject: string }>(
        `select status, sent_at, subject from public.email_outbox where id = $1::uuid`,
        [c.outbox_id],
      );
      expect(rows[0].status).toBe("sent");
      expect(rows[0].sent_at).not.toBeNull();
      expect(rows[0].subject).toBe("Subject");
    });

    it("23. returns a retryable failure to the queue with a delay, and ends in failed after three", async () => {
      const b = await prepare("dues_reminder", [f.unit1]);
      await approve(b);
      let [c] = (await claim(b)).rows;
      await asCy(() => db.query(`select public.email_mark_failed($1::uuid, $2::uuid, 'Resend busy', true)`, [c.outbox_id, c.claim_token]));
      let row = (await outbox(b))[0];
      expect(row.status).toBe("queued");
      const { rows: nb } = await q<{ not_before: string | null }>(`select not_before from public.email_outbox where id = $1::uuid`, [c.outbox_id]);
      expect(nb[0].not_before).not.toBeNull();
      expect((await claim(b)).rows).toHaveLength(0); // not before the delay

      for (let attempt = 2; attempt <= 3; attempt++) {
        await q(`update public.email_outbox set not_before = null where id = $1::uuid`, [c.outbox_id]);
        [c] = (await claim(b)).rows;
        expect(c.attempts).toBe(attempt);
        await asCy(() => db.query(`select public.email_mark_failed($1::uuid, $2::uuid, 'Resend busy', true)`, [c.outbox_id, c.claim_token]));
      }
      row = (await outbox(b))[0];
      expect(row.status).toBe("failed");

      const b2 = await prepare("dues_reminder", [f.unit2]);
      await approve(b2);
      const [c2] = (await claim(b2)).rows;
      await asCy(() => db.query(`select public.email_mark_failed($1::uuid, $2::uuid, 'Invalid to address', false)`, [c2.outbox_id, c2.claim_token]));
      expect((await outbox(b2))[0].status).toBe("failed");
    });

    it("24. releases a stuck sending row after 10 minutes and gives up after 20 hours", async () => {
      const b = await prepare("dues_reminder", [f.unit1]);
      await approve(b);
      const [c] = (await claim(b)).rows;
      expect((await claim(b)).rows).toHaveLength(0); // still in flight
      await q(`update public.email_outbox set claimed_at = now() - interval '11 minutes' where id = $1::uuid`, [c.outbox_id]);
      const again = (await claim(b)).rows;
      expect(again).toHaveLength(1);
      expect(again[0].attempts).toBe(2);
      expect(again[0].idempotency_key).toBe(c.idempotency_key);

      await q(`update public.email_outbox set claimed_at = now() - interval '21 hours' where id = $1::uuid`, [c.outbox_id]);
      expect((await claim(b)).rows).toHaveLength(0);
      const { rows } = await q<{ status: string; last_error: string }>(`select status, last_error from public.email_outbox where id = $1::uuid`, [c.outbox_id]);
      expect(rows[0].status).toBe("failed");
      expect(rows[0].last_error).toMatch(/Outcome unknown/);
      expect((await claim(b)).rows).toHaveLength(0);
    });

    it("25. never hands the same row to two claims", async () => {
      const b = await prepare("dues_reminder", [f.unit1, f.unit2]);
      await approve(b);
      const first = (await claim(b, 1)).rows;
      const second = (await claim(b, 1)).rows;
      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
      expect(first[0].outbox_id).not.toBe(second[0].outbox_id);
      expect((await claim(b, 1)).rows).toHaveLength(0);
    });

    it("26. backstops the weekly limit in a trigger even if the application skipped the check", async () => {
      const a = await prepare("dues_reminder", [f.unit1]);
      const dup = await prepare("dues_reminder", [f.unit1]);
      await approve(a);
      await claim(a);
      const dupRow = (await outbox(dup))[0];
      await q(`update public.email_outbox set status = 'queued', queued_at = now() where id = $1::uuid`, [dupRow.id]);
      const e = await fail(q(`update public.email_outbox set status = 'sending', claimed_at = now() where id = $1::uuid`, [dupRow.id]));
      expect(e.code).toBe("53400");
      expect(e.hint).toBe("weekly_cap");
    });

    it("27. enforces the outbox state machine and freezes content once queued", async () => {
      const { id } = await sendReminderTo(f.unit1, "prov-sm-1");
      for (const to of ["queued", "draft", "failed"]) {
        const e = await fail(q(`update public.email_outbox set status = $2 where id = $1::uuid`, [id, to]));
        expect(e.code, to).toBe("42501");
      }
      const b = await prepare("dues_reminder", [f.unit2]);
      await approve(b);
      const row = (await outbox(b))[0];
      const e = await fail(q(`update public.email_outbox set facts = '{}'::jsonb where id = $1::uuid`, [row.id]));
      expect(e.code).toBe("42501");
      const e2 = await fail(q(`update public.email_outbox set to_email = 'other@example.test' where id = $1::uuid`, [row.id]));
      expect(e2.code).toBe("42501");
      // skipped -> queued
      await q(`update public.email_outbox set status = 'skipped', skip_reason = 'x' where id = $1::uuid`, [row.id]);
      expect((await fail(q(`update public.email_outbox set status = 'queued' where id = $1::uuid`, [row.id]))).code).toBe("42501");
    });

    it("28. holds a message (queued, retried in ten minutes) when 300 emails went out in the last hour", async () => {
      const hb = await q<{ id: string }>(
        `insert into public.email_batches (association_id, kind, status, approved_at) values ($1::uuid, 'dues_reminder', 'approved', now()) returning id`,
        [f.hoyne],
      );
      await q(
        `insert into public.email_outbox (association_id, batch_id, kind, person_id, to_email, template_key, status, claimed_at, sent_at, provider_message_id, idempotency_key)
         select $1::uuid, $2::uuid, 'dues_reminder', $3::uuid, 'zara@example.test', 'dues_reminder', 'sent', now(), now(), 'bulk-' || g, 'wk-bulk-' || g
           from generate_series(1, 300) g`,
        [f.hoyne, hb.rows[0].id, f.zaraPerson],
      );
      const b = await prepare("dues_reminder", [f.unit1]);
      await approve(b);
      expect((await claim(b)).rows).toHaveLength(0);
      // REVIEW-4 #8: a busy hour is a pause, not a verdict. The row is still queued and waits.
      expect((await outbox(b))[0]).toMatchObject({ status: "queued", skip_reason: null });
      const { rows: held } = await q<{ minutes: number }>(
        `select extract(epoch from (not_before - now()))::int / 60 as minutes from public.email_outbox where batch_id = $1::uuid`, [b]);
      expect(held[0].minutes).toBeGreaterThanOrEqual(9);
      expect(held[0].minutes).toBeLessThanOrEqual(10);
      // once the hour has room (and the wait is over) the same message goes out
      await q(`delete from public.email_outbox where batch_id = $1::uuid`, [hb.rows[0].id]);
      await q(`update public.email_outbox set not_before = null where batch_id = $1::uuid`, [b]);
      expect((await claim(b)).rows).toHaveLength(1);
    });

    it("29. records a send by hand for any board member, only on a draft, and it counts for the weekly limit", async () => {
      const b = await prepare("dues_reminder", [f.unit1]);
      const row = (await outbox(b))[0];
      expect((await fail(asAda(() => db.query(`select public.email_mark_sent_by_hand($1::uuid)`, [row.id])))).code).toBe("42501");
      await asMel(() => db.query(`select public.email_mark_sent_by_hand($1::uuid)`, [row.id]));
      const { rows } = await q<{ status: string; provider_message_id: string }>(`select status, provider_message_id from public.email_outbox where id = $1::uuid`, [row.id]);
      expect(rows[0].status).toBe("sent");
      expect(rows[0].provider_message_id).toBe(`manual:${row.id}`);
      expect((await fail(asMel(() => db.query(`select public.email_mark_sent_by_hand($1::uuid)`, [row.id])))).code).toBe("22023");

      const again = await prepare("dues_reminder", [f.unit1]);
      expect((await outbox(again))[0]).toMatchObject({ status: "skipped", skip_reason: "weekly_cap" });
      const { rows: n } = await q<{ n: number }>(`select count(*)::int as n from public.email_outbox where association_id = $1::uuid and status = 'sent'`, [f.damen]);
      expect(n[0].n).toBe(1);
    });
  });

  describe("the daily cron's claims", () => {
    it("49. lets the service key claim plain reminders from any approved batch, never statements or announcements", async () => {
      const reminders = await prepare("dues_reminder", [f.unit1]);
      await approve(reminders);
      const statements = await prepare("statement", [f.unit2], { from: "2026-01-01", to: "2026-03-31" });
      await approve(statements);

      // A signed-in admin cannot claim "everything" (no batch); only the service key can.
      expect((await fail(claim(null))).code).toBe("42501");

      const rows = await asService(db, () => db.query<{ kind: string; to_email: string }>(`select kind, to_email from public.email_claim(null, 10)`));
      expect(rows.rows).toEqual([{ kind: "dues_reminder", to_email: "ada@example.test" }]);
      const left = (await outbox(statements))[0];
      expect(left.status).toBe("queued"); // waits for the review page's Resume
    });

    it("50. lets the service key mark a claimed message sent", async () => {
      const b = await prepare("dues_reminder", [f.unit1]);
      await approve(b);
      const [c] = (await asService(db, () => db.query<Claimed>(`select * from public.email_claim(null, 1)`))).rows;
      await asService(db, () => db.query(`select public.email_mark_sent($1::uuid, $2::uuid, 'prov-cron', 'Subject')`, [c.outbox_id, c.claim_token]));
      expect((await outbox(b))[0].status).toBe("sent");
    });
  });

  // ------------------------------------------------------------------ rules and cron

  describe("rules", () => {
    const saveRule = (kind: string, days: number, min = 1, repeat = 7, max = 3, enabled = true) =>
      asCy(() =>
        db.query(`select public.email_save_rule($1::uuid, $2, $3, $4, $5, $6, $7)`, [f.damen, kind, days, min, repeat, max, enabled]),
      );
    const run = (day: string) =>
      asService(db, () =>
        db.query<{ association_id: string; batch_id: string; queued: number }>(`select * from public.email_run_rules($1::date)`, [day]),
      );

    it("30. needs sending on to switch a rule on, and the repeat and max limits are checks", async () => {
      await q(`update public.email_settings set sending_enabled = false`);
      const e = await fail(saveRule("dues_overdue", 7));
      expect(e.hint).toBe("sending_off");
      await q(`update public.email_settings set sending_enabled = true`);
      expect((await fail(saveRule("dues_overdue", 7, 1, 6))).code).toBe("23514");
      expect((await fail(saveRule("dues_overdue", 7, 1, 7, 7))).code).toBe("23514");
      await saveRule("dues_overdue", 7);
    });

    it("31. runs only for the service key, writes an approved rule batch, and not twice a day", async () => {
      await saveRule("dues_overdue", 7);
      expect((await fail(asCy(() => db.query(`select * from public.email_run_rules(current_date)`)))).code).toBe("42501");
      const first = await run("2026-10-14");
      expect(first.rows).toHaveLength(1);
      expect(first.rows[0].queued).toBe(2);
      const { rows } = await q<{ status: string; source: string; approved_by: string; rule_id: string }>(
        `select status, source, approved_by, rule_id from public.email_batches where id = $1::uuid`,
        [first.rows[0].batch_id],
      );
      expect(rows[0]).toMatchObject({ status: "approved", source: "rule", approved_by: f.cyUser });
      expect(rows[0].rule_id).not.toBeNull();
      expect((await outbox(first.rows[0].batch_id)).every((r) => r.status === "queued")).toBe(true);
      expect((await run("2026-10-14")).rows).toHaveLength(0);
    });

    it("32. honours days, minimum amount, maximum reminders and the repeat interval", async () => {
      await saveRule("dues_overdue", 7);
      expect((await run("2026-01-06")).rows).toHaveLength(0); // 5 days overdue
      expect((await run("2026-01-09")).rows[0].queued).toBe(2); // 8 days overdue

      // minimum amount: 600 excludes Ada (500) but keeps Bo (750)
      await db.exec(`delete from public.email_log; delete from public.email_outbox; delete from public.email_batches; update public.reminder_rules set last_run_on = null`);
      await saveRule("dues_overdue", 7, 600);
      const r = await run("2026-10-14");
      expect((await outbox(r.rows[0].batch_id)).map((x) => x.to_email)).toEqual(["bo@example.test"]);

      // within repeat_every_days: waits; after it: eligible again once the weekly cap has aged out
      await q(`update public.reminder_rules set last_run_on = null`);
      expect((await run("2026-10-17")).rows).toHaveLength(0);
      await q(`update public.email_outbox set created_at = now() - interval '10 days', queued_at = now() - interval '10 days'`);
      await q(`update public.reminder_rules set last_run_on = null`);
      expect((await run("2026-10-24")).rows).toHaveLength(1);

      // maximum reminders: with max 1 it stops after the first
      await db.exec(`delete from public.email_log; delete from public.email_outbox; delete from public.email_batches; update public.reminder_rules set last_run_on = null`);
      await saveRule("dues_overdue", 7, 1, 7, 1);
      expect((await run("2026-10-14")).rows).toHaveLength(1);
      await db.exec(`update public.email_outbox set created_at = now() - interval '20 days', queued_at = now() - interval '20 days'; update public.reminder_rules set last_run_on = null`);
      expect((await run("2026-11-30")).rows).toHaveLength(0);
    });

    it("32b. repeat_every_days counts calendar days in Chicago: eligible on the 7th day, not the 6th", async () => {
      await saveRule("dues_overdue", 7);
      const first = await run("2026-10-14");
      expect(first.rows[0].queued).toBe(2);
      const setCreated = async (iso: string) => {
        // queued_at stays old so the separate weekly cap (real clock) never interferes with the repeat interval
        await q(`update public.email_outbox set created_at = $1::timestamptz, queued_at = now() - interval '30 days'`, [iso]);
        await q(`update public.reminder_rules set last_run_on = null`);
      };
      // 14:00 UTC is 09:00 in Chicago on the same date
      await setCreated("2026-10-08T14:00:00Z"); // 6 days before
      expect((await run("2026-10-14")).rows).toHaveLength(0);
      await setCreated("2026-10-07T14:00:00Z"); // 7 days before
      expect((await run("2026-10-14")).rows).toHaveLength(1);
      // 03:00 UTC on the 8th is still the 7th in Chicago (UTC-5): the Chicago date decides, not the UTC one
      await db.exec(`delete from public.email_log; delete from public.email_outbox; delete from public.email_batches;`);
      await q(`update public.reminder_rules set last_run_on = null`);
      expect((await run("2026-10-14")).rows).toHaveLength(1);
      await setCreated("2026-10-08T03:00:00Z");
      expect((await run("2026-10-14")).rows).toHaveLength(1);
      await setCreated("2026-10-08T06:00:00Z"); // 01:00 on the 8th in Chicago: 6 days
      expect((await run("2026-10-14")).rows).toHaveLength(0);
    });

    it("33. dues_upcoming includes a unit with a charge coming due and nothing overdue", async () => {
      await saveRule("dues_upcoming", 7);
      await q(
        `insert into public.assessment_charges (association_id, unit_id, charge_type, period_start, due_on, amount)
         values ($1::uuid, $2::uuid, 'assessment', current_date, current_date + 5, 300)`,
        [f.damen, f.unit3],
      );
      const r = await run(new Date().toISOString().slice(0, 10));
      expect(r.rows).toHaveLength(1);
      const rows = await outbox(r.rows[0].batch_id);
      expect(rows.map((x) => x.to_email)).toEqual(["cy@example.test"]);
      const { rows: t } = await q<{ template_key: string }>(`select template_key from public.email_outbox where batch_id = $1::uuid`, [r.rows[0].batch_id]);
      expect(t[0].template_key).toBe("dues_upcoming");
    });

    it("34. skips a paused rule and a building with sending off", async () => {
      const id = (await saveRule("dues_overdue", 7)).rows[0] as { email_save_rule: string };
      await asMel(() => db.query(`select public.email_set_rule_paused($1::uuid, true)`, [id.email_save_rule]));
      expect((await run("2026-10-14")).rows).toHaveLength(0);
      await asMel(() => db.query(`select public.email_set_rule_paused($1::uuid, false)`, [id.email_save_rule]));
      await q(`update public.email_settings set sending_enabled = false`);
      expect((await run("2026-10-14")).rows).toHaveLength(0);
      await q(`update public.email_settings set sending_enabled = true`);
      expect((await run("2026-10-14")).rows).toHaveLength(1);
    });

    it("35. leaves out opted-out, suppressed and week-capped people, and makes no batch when nobody qualifies", async () => {
      await saveRule("dues_overdue", 7);
      await q(`insert into public.email_preferences (association_id, person_id, unsubscribed_all) values ($1::uuid, $2::uuid, true) on conflict (person_id) do update set unsubscribed_all = excluded.unsubscribed_all`, [f.damen, f.adaPerson]);
      await q(`insert into public.email_suppressions (association_id, email, reason) values ($1::uuid, 'bo@example.test', 'complaint')`, [f.damen]);
      const r = await run("2026-10-14");
      expect(r.rows).toHaveLength(0);
      const { rows } = await q<{ n: number }>(`select count(*)::int as n from public.email_batches where source = 'rule'`);
      expect(rows[0].n).toBe(0);
    });
  });

  // ------------------------------------------------------------------ events and preferences

  describe("events and preferences", () => {
    const event = (provider: string, type: string, svix: string, permanent = true) =>
      asService(db, () =>
        db.query<{ r: string }>(`select public.email_record_event($1, $2, 'detail', $3, $4) as r`, [provider, type, svix, permanent]),
      );

    it("36. records delivery, bounces, complaints and replays; refuses non-service callers", async () => {
      expect((await fail(asCy(() => db.query(`select public.email_record_event('x','email.delivered','d','s1')`)))).code).toBe("42501");

      const a = await sendReminderTo(f.unit1, "prov-a");
      expect((await event("prov-a", "email.delivered", "svix-1")).rows[0].r).toBe("delivered");
      expect((await q<{ status: string }>(`select status from public.email_outbox where id = $1::uuid`, [a.id])).rows[0].status).toBe("delivered");
      expect((await event("prov-a", "email.delivered", "svix-1")).rows[0].r).toBe("duplicate");
      const { rows: n } = await q<{ n: number }>(`select count(*)::int as n from public.email_log where svix_id = 'svix-1'`);
      expect(n[0].n).toBe(1);
      expect((await event("unknown-id", "email.delivered", "svix-2")).rows[0].r).toBe("ignored");

      const b = await sendReminderTo(f.unit2, "prov-b");
      expect((await event("prov-b", "email.bounced", "svix-3", false)).rows[0].r).toBe("delayed");
      expect((await q(`select 1 from public.email_suppressions`)).rows).toHaveLength(0);
      expect((await event("prov-b", "email.bounced", "svix-4", true)).rows[0].r).toBe("bounced");
      expect((await q<{ email: string; reason: string }>(`select email, reason from public.email_suppressions`)).rows).toEqual([{ email: "bo@example.test", reason: "bounce" }]);
      expect((await q<{ status: string }>(`select status from public.email_outbox where id = $1::uuid`, [b.id])).rows[0].status).toBe("bounced");

      // complaint: suppress and opt the person out of everything
      await q(`update public.persons set email = 'cy@example.test' where id = $1::uuid`, [f.cyPerson]);
      await addCharge(f.unit3, "60.00", "2026-04-01");
      const c = await sendReminderTo(f.unit3, "prov-c");
      expect((await event("prov-c", "email.complained", "svix-5")).rows[0].r).toBe("complained");
      expect((await q<{ unsubscribed_all: boolean }>(`select unsubscribed_all from public.email_preferences where person_id = $1::uuid`, [f.cyPerson])).rows[0].unsubscribed_all).toBe(true);
      expect((await q<{ status: string }>(`select status from public.email_outbox where id = $1::uuid`, [c.id])).rows[0].status).toBe("complained");
    });

    it("37. lets only a board admin clear a suppression", async () => {
      await q(`insert into public.email_suppressions (association_id, email, reason) values ($1::uuid, 'bo@example.test', 'bounce')`, [f.damen]);
      expect((await fail(asMel(() => db.query(`select public.email_clear_suppression($1::uuid, 'bo@example.test')`, [f.damen])))).code).toBe("42501");
      await asCy(() => db.query(`select public.email_clear_suppression($1::uuid, 'BO@example.test')`, [f.damen]));
      expect((await q(`select 1 from public.email_suppressions`)).rows).toHaveLength(0);
    });

    it("38. lets owners read only their own preferences, and gives the board flags without tokens", async () => {
      await db.exec(`select public.email_ensure_preferences(id) from public.persons where association_id = '${f.damen}'`);
      const own = await asAda(() => db.query<{ person_id: string; token: string }>(`select person_id, token from public.email_preferences`));
      expect(own.rows).toHaveLength(1);
      expect(own.rows[0].person_id).toBe(f.adaPerson);
      expect(own.rows[0].token).toHaveLength(96);
      const boardRead = await asCy(() => db.query(`select * from public.email_preferences`));
      expect(boardRead.rows.map((r) => (r as Row).person_id)).toEqual([f.cyPerson]); // Cy's own row only
      await q(`update public.email_preferences set statements = false where person_id = $1::uuid`, [f.boPerson]);
      const optouts = await asCy(() => db.query<Record<string, unknown>>(`select * from public.email_optouts($1::uuid)`, [f.damen]));
      expect(optouts.rows).toHaveLength(1);
      expect(optouts.rows[0].person_id).toBe(f.boPerson);
      expect(Object.keys(optouts.rows[0])).not.toContain("token");
      expect((await asAda(() => db.query(`select * from public.email_optouts($1::uuid)`, [f.damen]))).rows).toHaveLength(0);
    });

    it("39. lets a signed-in person read and set their own preferences, and a stranger nothing", async () => {
      const mine = await asAda(() => db.query<Row>(`select * from public.my_email_preferences($1::uuid)`, [f.damen]));
      expect(mine.rows[0]).toMatchObject({ dues_reminders: true, statements: true, announcements: true, unsubscribed_all: false, email: "ada@example.test" });
      await asAda(() => db.query(`select public.set_my_email_preferences($1::uuid, false, true, false, false)`, [f.damen]));
      const after = await asAda(() => db.query<Row>(`select * from public.my_email_preferences($1::uuid)`, [f.damen]));
      expect(after.rows[0]).toMatchObject({ dues_reminders: false, statements: true, announcements: false });
      // Zara has no person in Damen
      expect((await asUser(db, f.zaraUser, () => db.query(`select * from public.my_email_preferences($1::uuid)`, [f.damen]))).rows).toHaveLength(0);
      expect((await fail(asUser(db, f.zaraUser, () => db.query(`select public.set_my_email_preferences($1::uuid, false, false, false, true)`, [f.damen])))).code).toBe("42501");
    });

    it("40. unsubscribes signed out with the token: scoped, reversible, logged, and nothing else", async () => {
      await q(`select public.email_ensure_preferences($1::uuid)`, [f.adaPerson]);
      const token = (await q<{ token: string }>(`select token from public.email_preferences where person_id = $1::uuid`, [f.adaPerson])).rows[0].token;

      const view = await asAnon(() => db.query<Record<string, unknown>>(`select * from public.email_preference_for_token($1)`, [token]));
      expect(view.rows).toHaveLength(1);
      expect(view.rows[0].masked_email).toBe("a***@example.test");
      expect(Object.keys(view.rows[0]).sort()).toEqual(["announcements", "association_name", "dues_reminders", "masked_email", "statements", "unsubscribed_all"]);
      expect((await asAnon(() => db.query(`select * from public.email_preference_for_token($1)`, ["x".repeat(96)]))).rows).toHaveLength(0);
      expect((await asAnon(() => db.query(`select * from public.email_preference_for_token($1)`, [token.slice(0, 95)]))).rows).toHaveLength(0);

      const ok = await asAnon(() => db.query<{ r: boolean }>(`select public.email_unsubscribe($1, 'dues_reminders', false) as r`, [token]));
      expect(ok.rows[0].r).toBe(true);
      const p = (await q<Row>(`select dues_reminders, statements, unsubscribed_all from public.email_preferences where person_id = $1::uuid`, [f.adaPerson])).rows[0];
      expect(p).toEqual({ dues_reminders: false, statements: true, unsubscribed_all: false });
      expect((await q<{ event: string; detail: string }>(`select event, detail from public.email_log where event = 'unsubscribed'`)).rows).toEqual([{ event: "unsubscribed", detail: "dues_reminders" }]);

      await asAnon(() => db.query(`select public.email_unsubscribe($1, 'dues_reminders', true)`, [token]));
      expect((await q<Row>(`select dues_reminders from public.email_preferences where person_id = $1::uuid`, [f.adaPerson])).rows[0].dues_reminders).toBe(true);
      await asAnon(() => db.query(`select public.email_unsubscribe($1, 'all', false)`, [token]));
      expect((await q<Row>(`select unsubscribed_all from public.email_preferences where person_id = $1::uuid`, [f.adaPerson])).rows[0].unsubscribed_all).toBe(true);

      expect((await asAnon(() => db.query<{ r: boolean }>(`select public.email_unsubscribe($1, 'all', false) as r`, ["y".repeat(96)]))).rows[0].r).toBe(false);
      expect((await asAnon(() => db.query<{ r: boolean }>(`select public.email_unsubscribe($1, 'all', false) as r`, [token.slice(0, 95)]))).rows[0].r).toBe(false);
      expect((await fail(asAnon(() => db.query(`select public.email_unsubscribe($1, 'nonsense', false)`, [token])))).code).toBe("22023");
    });

    it("41. gives the signed-out role no table and no function except the two unsubscribe ones", async () => {
      await q(`select public.email_ensure_preferences($1::uuid)`, [f.adaPerson]);
      for (const t of ["email_settings", "reminder_rules", "email_preferences", "email_suppressions", "email_batches", "email_outbox", "email_log"]) {
        expect((await asAnon(() => db.query(`select * from public.${t}`))).rows, t).toEqual([]);
      }
      const { rows } = await q<{ fn: string }>(
        `select p.oid::regprocedure::text as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and (p.proname like 'email\\_%' or p.proname in ('set_my_email_preferences','my_email_preferences'))
            and has_function_privilege('anon', p.oid, 'execute') order by 1`,
      );
      expect(rows.map((r) => r.fn)).toEqual(["email_preference_for_token(text)", "email_unsubscribe(text,text,boolean)"]);
    });
  });

  // ------------------------------------------------------------------ isolation, redaction, purge

  describe("isolation, lint and redaction", () => {
    it("42. keeps another building out of every table and refuses direct writes", async () => {
      const b = await prepare("dues_reminder", [f.unit1]);
      await approve(b);
      await q(`select public.email_ensure_preferences($1::uuid)`, [f.adaPerson]);
      await q(`insert into public.email_suppressions (association_id, email, reason) values ($1::uuid, 'x@example.test', 'bounce')`, [f.damen]);
      for (const t of ["email_settings", "reminder_rules", "email_preferences", "email_suppressions", "email_batches", "email_outbox", "email_log"]) {
        const zara = await asUser(db, f.zaraUser, () => db.query(`select * from public.${t}`));
        expect(zara.rows, t).toEqual([]);
      }
      const e = await fail(
        asCy(() => db.query(`select public.email_prepare_batch($1::uuid, 'dues_reminder', $2::uuid[])`, [f.damen, arr([f.hoyneUnit])])),
      );
      expect(e.code).toBe("42501");
      const e2 = await fail(
        asUser(db, HOYNE_BOARD_USER, () => db.query(`select public.email_prepare_batch($1::uuid, 'dues_reminder', $2::uuid[])`, [f.damen, arr([f.unit1])])),
      );
      expect(e2.code).toBe("42501");

      // direct writes by any role are refused (no insert/update/delete policy)
      for (const user of [f.cyUser, f.adaUser, MEL_USER]) {
        for (const stmt of [
          `insert into public.email_settings (association_id) values ('${f.hoyne}')`,
          `insert into public.email_suppressions (association_id, email, reason) values ('${f.damen}', 'q@example.test', 'bounce')`,
          `insert into public.email_batches (association_id, kind) values ('${f.damen}', 'dues_reminder')`,
          `insert into public.email_log (association_id, event) values ('${f.damen}', 'queued')`,
          `insert into public.reminder_rules (association_id, kind, days) values ('${f.damen}', 'dues_overdue', 5)`,
          `insert into public.email_preferences (association_id, person_id) values ('${f.damen}', '${f.boPerson}')`,
        ]) {
          const err = await fail(asUser(db, user, () => db.query(stmt)));
          expect(err.message, stmt).toMatch(/row-level security|permission denied/i);
        }
        const upd = await asUser(db, user, () => db.query(`update public.email_outbox set status = 'cancelled'`));
        expect(upd.affectedRows).toBe(0);
        const del = await asUser(db, user, () => db.query(`delete from public.email_suppressions`));
        expect(del.affectedRows).toBe(0);
      }
    });

    it("43. refuses an outbox row whose person or unit belongs to another association", async () => {
      const b = await prepare("dues_reminder", [f.unit1]);
      const cross = (person: string, units: string) =>
        q(
          `insert into public.email_outbox (association_id, batch_id, kind, person_id, unit_ids, to_email, template_key, idempotency_key)
           values ($1::uuid, $2::uuid, 'dues_reminder', $3::uuid, $4::uuid[], 'z@example.test', 'dues_reminder', 'wk-' || gen_random_uuid())`,
          [f.damen, b, person, units],
        );
      expect((await fail(cross(f.zaraPerson, "{}"))).code).toBe("42501");
      expect((await fail(cross(f.adaPerson, arr([f.hoyneUnit])))).code).toBe("42501");
      const hb = await q<{ id: string }>(`insert into public.email_batches (association_id, kind) values ($1::uuid, 'dues_reminder') returning id`, [f.hoyne]);
      const e = await fail(
        q(
          `insert into public.email_outbox (association_id, batch_id, kind, person_id, to_email, template_key, idempotency_key)
           values ($1::uuid, $2::uuid, 'dues_reminder', $3::uuid, 'a@example.test', 'dues_reminder', 'wk-' || gen_random_uuid())`,
          [f.damen, hb.rows[0].id, f.adaPerson],
        ),
      );
      expect(e.code).toBe("42501");
      expect((await fail(q(`insert into public.email_preferences (association_id, person_id) values ($1::uuid, $2::uuid)`, [f.damen, f.zaraPerson]))).code).toBe("42501");
    });

    it("44. removes a person's addresses from the email tables on redaction, even after a send", async () => {
      await q(`insert into public.unit_owners (association_id, unit_id, person_id, effective_from) values ($1::uuid, $2::uuid, $3::uuid, '2020-01-01')`, [f.damen, f.unit2, DEE_PERSON]);
      await q(`update public.persons set email = 'dee@example.test' where id = $1::uuid`, [DEE_PERSON]);
      const b = await prepare("dues_reminder", [f.unit2]);
      await approve(b);
      const claimed = await claim(b);
      expect(claimed.rows.map((r) => r.to_email).sort()).toEqual(["bo@example.test", "dee@example.test"]);
      for (const r of claimed.rows) await markSent(r.outbox_id, r.claim_token, `prov-${r.to_email}`);
      await q(`insert into public.email_suppressions (association_id, email, reason) values ($1::uuid, 'dee@example.test', 'bounce')`, [f.damen]);

      // Still an owner: refused, exactly as before.
      const refuse = await fail(asCy(() => db.query(`select public.redact_person($1::uuid)`, [DEE_PERSON])));
      expect(refuse.message).toMatch(/still owns a unit/);

      await q(`update public.unit_owners set effective_to = '2026-06-01' where person_id = $1::uuid`, [DEE_PERSON]);
      await asCy(() => db.query(`select public.redact_person($1::uuid)`, [DEE_PERSON]));
      const o = (await q<Row>(`select to_email, to_name, facts, board_note from public.email_outbox where person_id = $1::uuid`, [DEE_PERSON])).rows[0];
      expect(o).toEqual({ to_email: "removed@invalid.invalid", to_name: null, facts: {}, board_note: null });
      expect((await q(`select 1 from public.email_log where person_id = $1::uuid and to_email is not null`, [DEE_PERSON])).rows).toHaveLength(0);
      expect((await q(`select 1 from public.email_preferences where person_id = $1::uuid`, [DEE_PERSON])).rows).toHaveLength(0);
      expect((await q(`select 1 from public.email_suppressions where email = 'dee@example.test'`)).rows).toHaveLength(0);
      // Bo's message is untouched.
      expect((await q<Row>(`select to_email from public.email_outbox where person_id = $1::uuid`, [f.boPerson])).rows[0].to_email).toBe("bo@example.test");
    });

    it("45. purges history older than 24 months, keeps recent, refuses under 12, service only", async () => {
      const a = await sendReminderTo(f.unit1, "prov-purge");
      await q(`update public.email_outbox set created_at = now() - interval '30 months' where id = $1::uuid`, [a.id]);
      await q(`update public.email_log set created_at = now() - interval '30 months' where outbox_id = $1::uuid`, [a.id]);
      const recent = await sendReminderTo(f.unit2, "prov-keep");
      expect((await fail(asCy(() => db.query(`select public.email_purge(24)`)))).code).toBe("42501");
      expect((await fail(asService(db, () => db.query(`select public.email_purge(11)`)))).code).toBe("22023");
      const n = await asService(db, () => db.query<{ n: number }>(`select public.email_purge(24) as n`));
      expect(n.rows[0].n).toBe(1);
      const left = (await q<{ id: string }>(`select id from public.email_outbox`)).rows.map((r) => r.id);
      expect(left).toEqual([recent.id]);
      expect((await q(`select 1 from public.email_log where outbox_id = $1::uuid`, [recent.id])).rows.length).toBeGreaterThan(0);
    });

    it("47. keeps the service-only functions and internal helpers away from signed-in users", async () => {
      const execFor = async (role: string, fn: string) =>
        (await q<{ ok: boolean }>(`select has_function_privilege($1, $2::regprocedure, 'execute') as ok`, [role, fn])).rows[0].ok;
      for (const fn of ["public.email_run_rules(date)", "public.email_record_event(text,text,text,text,boolean)", "public.email_purge(integer)"]) {
        expect(await execFor("authenticated", fn), fn).toBe(false);
        expect(await execFor("anon", fn), fn).toBe(false);
        expect(await execFor("service_role", fn), fn).toBe(true);
      }
      for (const fn of [
        "public.email_log_event(uuid,uuid,uuid,text,text,text,text,text,text)",
        "public.email_unit_facts(uuid,date)",
        "public.email_statement_facts(uuid,date,date)",
        "public.email_facts_current(text,jsonb)",
        "public.email_pref_allows(uuid,text)",
        "public.email_daily_remaining(uuid)",
        "public.email_platform_hourly_limit()",
        "public.email_today()",
        "public.email_skip_reason(uuid,uuid,text,text,uuid)",
        "public.email_ensure_preferences(uuid)",
        "public.email_redact_person(uuid,text)",
      ]) {
        expect(await execFor("authenticated", fn), fn).toBe(false);
        expect(await execFor("anon", fn), fn).toBe(false);
      }
      // claim/mark_* are for the board admin and the service key, never signed out
      for (const fn of ["public.email_claim(uuid,integer)", "public.email_mark_sent(uuid,uuid,text,text)", "public.email_mark_failed(uuid,uuid,text,boolean)"]) {
        expect(await execFor("anon", fn), fn).toBe(false);
        expect(await execFor("service_role", fn), fn).toBe(true);
      }
    });

    it("48. leaves existing data alone and keeps redact_person's earlier refusals", async () => {
      // The seeded charges, owners and grants are all still there after 0055.
      expect((await q<{ n: number }>(`select count(*)::int as n from public.assessment_charges`)).rows[0].n).toBe(2);
      // redact_person still refuses a live accountant and a live grant.
      const e = await fail(asCy(() => db.query(`select public.redact_person($1::uuid)`, [f.niaPerson])));
      expect(e.message).toMatch(/revoke this person's access/);
      const self = await fail(asCy(() => db.query(`select public.redact_person($1::uuid)`, [f.cyPerson])));
      expect(self.message).toMatch(/your own personal data/);
    });
  });

  it("only service-role JWTs count as the service (a user token cannot claim it)", async () => {
    const { rows } = await asCy(() => db.query<{ s: boolean }>(`select public.email_is_service() as s`));
    expect(rows[0].s).toBe(false);
    const svc = await asService(db, () => db.query<{ s: boolean }>(`select public.email_is_service() as s`));
    expect(svc.rows[0].s).toBe(true);
  });

  it("rejects malformed addresses at the table: spaces, commas, angle brackets, line breaks", async () => {
    const b = await prepare("dues_reminder", [f.unit1]);
    for (const bad of ["a b@example.test", "a,b@example.test", "<a@example.test>", "a@example.test\nBcc: x@y.test", "a@example", "A@Example.test"]) {
      const e = await fail(
        q(
          `insert into public.email_outbox (association_id, batch_id, kind, person_id, to_email, template_key, idempotency_key)
           values ($1::uuid, $2::uuid, 'dues_reminder', $3::uuid, $4, 'dues_reminder', 'wk-' || gen_random_uuid())`,
          [f.damen, b, f.adaPerson, bad],
        ),
      );
      expect(e.code, JSON.stringify(bad)).toBe("23514");
    }
  });
  // ------------------------------------------------------------------ the net rule (REVIEW-4 #5)
  describe("the net rule: unapplied payments count before anyone is dunned", () => {
    const unappliedPayment = (unit: string, amount: number) =>
      q(
        `insert into public.payments (association_id, unit_id, received_on, amount, method, fund_id, journal_entry_id)
         values ($1::uuid, $2::uuid, '2026-02-01', $3::numeric, 'check', $4::uuid, $5::uuid)`,
        [f.damen, unit, amount, OPERATING, JOURNAL],
      );
    const saveRule = (min = 1) =>
      asCy(() => db.query(`select public.email_save_rule($1::uuid, 'dues_overdue', 7, $2, 7, 3, true)`, [f.damen, min]));
    const run = (day: string) =>
      asService(db, () => db.query<{ batch_id: string; queued: number }>(`select * from public.email_run_rules($1::date)`, [day]));

    it("a unit whose unapplied payment covers what is overdue is not prepared", async () => {
      await unappliedPayment(f.unit1, 500); // Ada: 500 overdue, 500 paid but not applied
      const b = await prepare("dues_reminder", [f.unit1, f.unit2]);
      expect((await outbox(b)).map((r) => r.to_email)).toEqual(["bo@example.test"]);
    });

    it("a partial credit still leaves the unit in, with the credit in the facts", async () => {
      await unappliedPayment(f.unit1, 100);
      const b = await prepare("dues_reminder", [f.unit1]);
      const [row] = await outbox(b);
      expect(row.facts.units[0]).toMatchObject({ owed: "500.00", overdue: "500.00", credit: "100.00", net: "400.00" });
    });

    it("a payment that arrives after approval makes the message stale (balance_changed)", async () => {
      const b = await prepare("dues_reminder", [f.unit1]);
      await approve(b);
      await unappliedPayment(f.unit1, 500);
      expect((await claim(b)).rows).toHaveLength(0);
      expect((await outbox(b))[0]).toMatchObject({ status: "skipped", skip_reason: "balance_changed" });
    });

    it("the standing rule uses the net figure for selection and the minimum amount", async () => {
      await unappliedPayment(f.unit1, 500);
      await unappliedPayment(f.unit2, 100); // Bo: 750 owed, 100 unapplied: net 650
      await saveRule(700); // minimum 700 on the NET: Bo (650) is below it, Ada (0) is paid up
      expect((await run("2026-10-14")).rows).toHaveLength(0);
      await q(`update public.reminder_rules set last_run_on = null`);
      await saveRule(600);
      const r = await run("2026-10-14");
      expect((await outbox(r.rows[0].batch_id)).map((x) => x.to_email)).toEqual(["bo@example.test"]);
    });
  });
});
