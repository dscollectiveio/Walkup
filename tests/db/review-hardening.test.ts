import { afterEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { applyMigrations, asService, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";
import { EXTRA, boBoard, pgError, queries, seededDb } from "./repairs-helpers";

/**
 * docs/security/REVIEW-1-migrations.md, one regression test per reproduction.
 * Each of these failed before the fix (migrations 0051 to 0059 edited in place,
 * 0060_review_hardening.sql for objects the applied migrations created) and
 * passes after. Every test starts from a fresh database through the harness.
 */

let db: PGlite;
let f: Fixture;
const h = queries(() => db);
const { q, one, rows, count } = h;

afterEach(async () => {
  await db?.close();
});

const EVE = "dddd0000-0000-0000-0000-0000000000e1";
const CASH = "acc00000-0000-0000-0000-000000001000";
const INCOME = "acc00000-0000-0000-0000-000000004000";
const OPERATING = "ffff0000-0000-0000-0000-000000000001";
const FY = "f1500000-0000-0000-0000-000000000001";

async function newLogin(id: string, email: string) {
  await db.query(`insert into auth.users (id, email) values ($1::uuid, $2)`, [id, email]);
}

// ---------------------------------------------------------------------------
// 1. A board_member must not become board_admin (two routes)
// ---------------------------------------------------------------------------
describe("REVIEW-1 #1: board_member to board_admin escalation", () => {
  const setup = async () => {
    ({ db, f } = await seededDb());
    await boBoard(db, f);
    await newLogin(EVE, "eve@example.test");
  };

  it("1a. a board_member cannot mint an invite for any role above owner", async () => {
    await setup();
    for (const role of ["board_admin", "board_member", "accountant"]) {
      const e = await pgError(
        q(f.boUser, `insert into public.invites (association_id, role, email) values ($1::uuid, $2::public.app_role, 'eve@example.test')`, [f.damen, role]),
      );
      expect(e.code, role).toBe("42501");
    }
    expect(await count(`select 1 from public.invites`)).toBe(0);
  });

  it("1a. a board_member can still invite owners; a board_admin can invite any role and the admin invite works end to end", async () => {
    await setup();
    const owner = await q(f.boUser, `insert into public.invites (association_id, role, email) values ($1::uuid, 'owner', 'eve@example.test')`, [f.damen]);
    expect(owner.affectedRows).toBe(1);
    const admin = await one<{ token: string }>(f.cyUser, `insert into public.invites (association_id, role, email) values ($1::uuid, 'board_admin', 'eve@example.test') returning token`, [f.damen]);
    await q(EVE, `select public.redeem_invite($1, 'Eve Evil')`, [admin.token]);
    const roles = await rows<{ role: string }>(null, `select g.role::text from public.role_grants g join public.persons p on p.id = g.person_id where p.auth_user_id = $1::uuid`, [EVE]);
    expect(roles).toEqual([{ role: "board_admin" }]);
  });

  it("1b. a board_member cannot repoint the admin's login, their own, or another person's", async () => {
    await setup();
    for (const [target, label] of [[f.cyPerson, "the admin"], [f.boPerson, "themselves"], [f.adaPerson, "an owner"]] as const) {
      const e = await pgError(q(f.boUser, `update public.persons set auth_user_id = $1::uuid where id = $2::uuid`, [EVE, target]));
      expect(e.code, label).toBe("42501");
      expect(e.message, label).toMatch(/board admin/);
    }
    expect((await one<{ auth_user_id: string }>(null, `select auth_user_id from public.persons where id = $1::uuid`, [f.cyPerson])).auth_user_id).toBe(f.cyUser);
    // Cy still holds board_admin through the real login; Eve does not.
    const admin = (u: string) => one<{ ok: boolean }>(u, `select public.has_role_in($1::uuid, array['board_admin']::public.app_role[]) as ok`, [f.damen]);
    expect((await admin(f.cyUser)).ok).toBe(true);
    expect((await admin(EVE)).ok).toBe(false);
  });

  it("1b. a board_member cannot move a person to another association or create a person already bound to a login", async () => {
    await setup();
    const move = await pgError(q(f.boUser, `update public.persons set association_id = $1::uuid where id = $2::uuid`, [f.hoyne, f.adaPerson]));
    expect(["42501"]).toContain(move.code);
    const bound = await pgError(q(f.boUser, `insert into public.persons (association_id, full_name, auth_user_id) values ($1::uuid, 'Planted', $2::uuid)`, [f.damen, EVE]));
    expect(bound.code).toBe("42501");
    const loginless = await q(f.boUser, `insert into public.persons (association_id, full_name) values ($1::uuid, 'Plain Person')`, [f.damen]);
    expect(loginless.affectedRows).toBe(1);
  });

  it("1b. what still works: owner phone edits, board edits of others' phones, an admin repointing a login", async () => {
    await setup();
    expect((await q(f.adaUser, `update public.persons set phone = '312-555-0100' where id = $1::uuid`, [f.adaPerson])).affectedRows).toBe(1);
    expect((await q(f.boUser, `update public.persons set phone = '312-555-0101' where id = $1::uuid`, [f.adaPerson])).affectedRows).toBe(1);
    expect((await q(f.boUser, `update public.persons set full_name = 'Ada O.' where id = $1::uuid`, [f.adaPerson])).affectedRows).toBe(1);
    expect((await q(f.cyUser, `update public.persons set auth_user_id = $1::uuid where id = $2::uuid`, [EVE, f.vicPerson])).affectedRows).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. The AI quota cannot be refunded by the caller
// ---------------------------------------------------------------------------
describe("REVIEW-1 #2: not_started is not a refund", () => {
  it("40 claim-then-release loops stop at twice the limit (insurance_market, limit 6)", async () => {
    ({ db, f } = await seededDb());
    await boBoard(db, f);
    let granted = 0;
    let stoppedBy: string | undefined;
    for (let i = 0; i < 40; i++) {
      try {
        const { id } = await one<{ id: string }>(f.boUser, `select public.claim_ai_call($1::uuid, 'insurance_market') as id`, [f.damen]);
        granted++;
        const fin = await one<{ ok: boolean }>(f.boUser, `select public.finish_ai_call($1::uuid, false, 'not_started') as ok`, [id]);
        expect(fin.ok).toBe(true);
      } catch (e) {
        stoppedBy = (e as { hint?: string }).hint;
        break;
      }
    }
    expect(granted).toBe(12);
    expect(stoppedBy).toBe("ai_attempts");
  });

  it("an owner's personal triage cap cannot be refunded either", async () => {
    ({ db, f } = await seededDb());
    let granted = 0;
    let stoppedBy: string | undefined;
    for (let i = 0; i < 40; i++) {
      try {
        const { id } = await one<{ id: string }>(f.adaUser, `select public.claim_ai_call($1::uuid, 'ticket_triage') as id`, [f.damen]);
        granted++;
        await q(f.adaUser, `select public.finish_ai_call($1::uuid, false, 'not_started')`, [id]);
      } catch (e) {
        stoppedBy = (e as { hint?: string }).hint;
        break;
      }
    }
    expect(granted).toBe(10);
    expect(stoppedBy).toBe("ai_quota_person");
  });
});

// ---------------------------------------------------------------------------
// 3. Length limits must not freeze legacy rows
// ---------------------------------------------------------------------------
describe("REVIEW-1 #3: legacy rows outside the new limits stay editable", () => {
  const T_GAS = "7c000000-0000-0000-0000-0000000003a1";
  const T_LONG = "7c000000-0000-0000-0000-0000000003a2";
  const C_LONG = "7c000000-0000-0000-0000-0000000003b1";
  const M_LONG = "7c000000-0000-0000-0000-0000000003c1";
  const R_LONG = "7c000000-0000-0000-0000-0000000003d1";
  const V_ODD = "7c000000-0000-0000-0000-0000000003e1";

  const legacy = async () => {
    db = await freshDb({ before: "0053" });
    f = await seed(db);
    await db.query(`insert into public.tickets (id, association_id, title) values ($1::uuid, $3::uuid, 'Gas'), ($2::uuid, $3::uuid, 'Long description ticket')`, [T_GAS, T_LONG, f.damen]);
    await db.query(`update public.tickets set description = $1 where id = $2::uuid`, ["d".repeat(6000), T_LONG]);
    await db.query(`insert into public.ticket_comments (id, association_id, ticket_id, person_id, body) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5)`, [C_LONG, f.damen, f.ticketCommon, f.cyPerson, "c".repeat(5000)]);
    await db.query(`insert into public.vendors (id, association_id, name) values ($1::uuid, $2::uuid, 'Odd Vendor Co')`, [V_ODD, f.damen]);
    await db.query(`update public.vendors set website_url = 'javascript:alert(1)' where id = $1::uuid`, [V_ODD]);
    await db.query(`insert into public.contractor_messages (id, association_id, vendor_id, subject, body) values ($1::uuid, $2::uuid, $3::uuid, $4, 'short')`, [M_LONG, f.damen, V_ODD, "s".repeat(300)]);
    await db.query(`insert into public.contractor_reviews (id, association_id, vendor_id, rating, body) values ($1::uuid, $2::uuid, $3::uuid, 4, $4)`, [R_LONG, f.damen, V_ODD, "r".repeat(5000)]);
    await applyMigrations(db, { from: "0053" });
  };

  it("a legacy ticket with a 3-character title or a 6000-character description can still be closed and reprioritised", async () => {
    await legacy();
    expect((await q(f.cyUser, `update public.tickets set status = 'closed' where id = $1::uuid`, [T_GAS])).affectedRows).toBe(1);
    expect((await q(f.cyUser, `update public.tickets set priority = 'low' where id = $1::uuid`, [T_LONG])).affectedRows).toBe(1);
    const closed = await q(f.cyUser, `select * from public.close_out_ticket($1::uuid, 'closed', null, null, 'done', false)`, [T_LONG]);
    expect(closed.rows.length).toBeGreaterThanOrEqual(0);
  });

  it("new tickets and edits that touch the limited column are still refused", async () => {
    await legacy();
    expect((await pgError(q(f.cyUser, `insert into public.tickets (association_id, title) values ($1::uuid, 'abc')`, [f.damen]))).code).toBe("23514");
    expect((await pgError(q(f.cyUser, `update public.tickets set title = 'Hi' where id = $1::uuid`, [T_GAS]))).code).toBe("23514");
    expect((await pgError(q(f.cyUser, `update public.tickets set description = $2 where id = $1::uuid`, [T_GAS, "x".repeat(4001)]))).code).toBe("23514");
    expect((await pgError(q(f.cyUser, `insert into public.tickets (association_id, title) values ($1::uuid, $2)`, [f.damen, "t".repeat(121)]))).code).toBe("23514");
    expect((await q(f.cyUser, `update public.tickets set title = 'Gas smell in lobby' where id = $1::uuid`, [T_GAS])).affectedRows).toBe(1);
  });

  it("legacy comments, messages, reviews and contractor links stay editable; new bad values are refused", async () => {
    await legacy();
    // A legacy over-long comment: the board can still change something else on the row (is_internal).
    expect((await q(f.cyUser, `update public.ticket_comments set is_internal = true where id = $1::uuid`, [C_LONG])).affectedRows).toBe(1);
    expect((await pgError(q(f.cyUser, `update public.ticket_comments set body = $2 where id = $1::uuid`, [C_LONG, "c".repeat(4001)]))).code).toBe("23514");
    expect((await pgError(q(f.cyUser, `insert into public.ticket_comments (association_id, ticket_id, person_id, body) values ($1::uuid, $2::uuid, $3::uuid, '   ')`, [f.damen, f.ticketCommon, f.cyPerson]))).code).toBe("23514");

    expect((await q(f.cyUser, `update public.contractor_messages set to_email = 'x@example.test' where id = $1::uuid`, [M_LONG])).affectedRows).toBe(1);
    expect((await pgError(q(f.cyUser, `update public.contractor_messages set subject = $2 where id = $1::uuid`, [M_LONG, "s".repeat(201)]))).code).toBe("23514");

    expect((await db.query(`update public.contractor_reviews set rating = 5 where id = $1::uuid`, [R_LONG])).affectedRows).toBe(1);
    expect((await pgError(db.query(`update public.contractor_reviews set body = $2 where id = $1::uuid`, [R_LONG, "r".repeat(4001)]))).code).toBe("23514");
  });
});

// ---------------------------------------------------------------------------
// 4. One reversal per entry
// ---------------------------------------------------------------------------
describe("REVIEW-1 #4: an entry cannot be reversed twice", () => {
  const post = async () =>
    (
      await one<{ id: string }>(
        f.cyUser,
        `select public.post_journal_entry($1::uuid, $2::uuid, '2026-03-01', 'deposit', 'manual', $3::jsonb) as id`,
        [f.damen, FY, JSON.stringify([{ account_id: CASH, fund_id: OPERATING, debit: 100 }, { account_id: INCOME, fund_id: OPERATING, credit: 100 }])],
      )
    ).id;

  it("the second reversal is refused, a unique index backs it, and reversing the reversal still works", async () => {
    ({ db, f } = await seededDb());
    const id = await post();
    const r1 = (await one<{ id: string }>(f.cyUser, `select public.reverse_journal_entry($1::uuid) as id`, [id])).id;
    expect((await pgError(q(f.cyUser, `select public.reverse_journal_entry($1::uuid)`, [id]))).message).toMatch(/already been reversed/);

    // The state a race leaves: a second reversal written around the function.
    const e = await pgError(
      db.query(
        `insert into public.journal_entries (association_id, fiscal_year_id, entry_date, memo, source, reverses_entry_id, is_posted)
         values ($1::uuid, $2::uuid, '2026-03-01', 'dup', 'reversal', $3::uuid, false)`,
        [f.damen, FY, id],
      ),
    );
    expect(e.code).toBe("23505");

    // The chain stays linear: R1 can be reversed once (the 0059 parity rule counts the chain).
    const r2 = (await one<{ id: string }>(f.cyUser, `select public.reverse_journal_entry($1::uuid) as id`, [r1])).id;
    expect(r2).toBeTruthy();
    // Post / reverse / re-reverse leaves the deposit standing: the ledger and the 1120-H figures agree on 100.
    const net = await one<{ net: string }>(null, `select coalesce(sum(l.credit - l.debit), 0)::text as net from public.journal_lines l where l.account_id = $1 and l.journal_entry_id in ($2::uuid, $3::uuid, $4::uuid)`, [INCOME, id, r1, r2]);
    const fig = await one<{ exempt_income: string }>(f.cyUser, `select exempt_income::text from public.form_1120h_figures($1::uuid, $2::uuid)`, [f.damen, FY]);
    expect(Number(net.net)).toBe(100);
    expect(Number(fig.exempt_income)).toBe(100);
  });

  it("existing duplicate reversals do not fail the migration: the index is skipped with a notice", async () => {
    db = await freshDb({ before: "0060" });
    f = await seed(db);
    const id = (await one<{ id: string }>(f.cyUser, `select public.post_journal_entry($1::uuid, $2::uuid, '2026-03-01', 'deposit', 'manual', $3::jsonb) as id`, [
      f.damen, FY, JSON.stringify([{ account_id: CASH, fund_id: OPERATING, debit: 100 }, { account_id: INCOME, fund_id: OPERATING, credit: 100 }]),
    ])).id;
    await q(f.cyUser, `select public.reverse_journal_entry($1::uuid)`, [id]);
    // Pre-0060 the function allowed a race; write the second reversal the way it would have.
    await db.exec(`
      begin;
      insert into public.journal_entries (id, association_id, fiscal_year_id, entry_date, memo, source, reverses_entry_id, is_posted)
        values ('3e000000-0000-0000-0000-0000000000d1', '${f.damen}', '${FY}', '2026-03-01', 'dup', 'reversal', '${id}', false);
      insert into public.journal_lines (association_id, journal_entry_id, account_id, fund_id, debit, credit) values
        ('${f.damen}', '3e000000-0000-0000-0000-0000000000d1', '${CASH}', '${OPERATING}', 0, 100),
        ('${f.damen}', '3e000000-0000-0000-0000-0000000000d1', '${INCOME}', '${OPERATING}', 100, 0);
      update public.journal_entries set is_posted = true, posted_at = now() where id = '3e000000-0000-0000-0000-0000000000d1';
      commit;
    `);
    await applyMigrations(db, { from: "0060" });
    expect(await count(`select 1 from pg_indexes where schemaname = 'public' and indexname = 'journal_entries_one_reversal'`)).toBe(0);
    // The lock-and-check in the function still protects new entries.
    const id2 = (await one<{ id: string }>(f.cyUser, `select public.post_journal_entry($1::uuid, $2::uuid, '2026-03-02', 'again', 'manual', $3::jsonb) as id`, [
      f.damen, FY, JSON.stringify([{ account_id: CASH, fund_id: OPERATING, debit: 5 }, { account_id: INCOME, fund_id: OPERATING, credit: 5 }]),
    ])).id;
    await q(f.cyUser, `select public.reverse_journal_entry($1::uuid)`, [id2]);
    expect((await pgError(q(f.cyUser, `select public.reverse_journal_entry($1::uuid)`, [id2]))).message).toMatch(/already been reversed/);
  });
});

// ---------------------------------------------------------------------------
// 5. The 0057 guards must not block remediation of old bad rows
// ---------------------------------------------------------------------------
describe("REVIEW-1 #5: a legacy cross-association grant can be revoked", () => {
  it("revoking a grant, or end-dating an ownership, works; new cross rows and pointer changes are still refused", async () => {
    db = await freshDb({ before: "0057" });
    f = await seed(db);
    // Written before the guard existed: Zara (Hoyne) holds board_member in Damen, and Ada's unit row points at a Hoyne unit.
    await db.query(`insert into public.role_grants (association_id, person_id, role, granted_on) values ($1::uuid, $2::uuid, 'board_member', '2024-01-01')`, [f.damen, f.zaraPerson]);
    await db.query(`insert into public.unit_owners (association_id, unit_id, person_id, effective_from) values ($1::uuid, $2::uuid, $3::uuid, '2024-01-01')`, [f.damen, f.hoyneUnit, f.adaPerson]);
    await applyMigrations(db, { from: "0057" });

    const revoked = await q(f.cyUser, `update public.role_grants set revoked_at = now() where person_id = $1::uuid and association_id = $2::uuid`, [f.zaraPerson, f.damen]);
    expect(revoked.affectedRows).toBe(1);
    const ended = await q(f.cyUser, `update public.unit_owners set effective_to = '2025-01-01' where unit_id = $1::uuid and association_id = $2::uuid`, [f.hoyneUnit, f.damen]);
    expect(ended.affectedRows).toBe(1);

    expect((await pgError(q(f.cyUser, `insert into public.role_grants (association_id, person_id, role) values ($1::uuid, $2::uuid, 'accountant')`, [f.damen, f.zaraPerson]))).code).toBe("42501");
    expect((await pgError(q(f.cyUser, `update public.role_grants set person_id = $1::uuid where person_id = $2::uuid and association_id = $3::uuid and role = 'owner'`, [f.zaraPerson, f.boPerson, f.damen]))).code).toBe("42501");
    expect((await pgError(q(f.cyUser, `update public.unit_owners set unit_id = $1::uuid where unit_id = $2::uuid and association_id = $3::uuid`, [f.hoyneUnit, f.unit2, f.damen]))).code).toBe("42501");
  });
});

// ---------------------------------------------------------------------------
// 6 to 8. Insurance: archive, reads, sent messages
// ---------------------------------------------------------------------------
describe("REVIEW-1 #6 to #8: insurance guards", () => {
  const insuranceDoc = async () =>
    (
      await one<{ id: string }>(
        null,
        `insert into public.documents (association_id, storage_path, filename, mime_type, byte_size, category_id)
         values ($1::uuid, $2, 'declarations.pdf', 'application/pdf', 1000,
                 (select id from public.document_categories where association_id = $1::uuid and slug = 'insurance')) returning id`,
        [f.damen, `${f.damen}/1760000000001-abc123-declarations.pdf`],
      )
    ).id;

  it("6. only a board_admin can set archived_at, by the RPC or directly", async () => {
    ({ db, f } = await seededDb());
    await boBoard(db, f);
    const pid = (await one<{ id: string }>(null, `select id from public.insurance_policies where carrier_name = 'Carrier A'`)).id;
    expect((await pgError(q(f.boUser, `select public.archive_insurance_policy($1::uuid, true)`, [pid]))).message).toMatch(/board admin/);
    expect((await pgError(q(f.boUser, `update public.insurance_policies set archived_at = now() where id = $1::uuid`, [pid]))).code).toBe("42501");
    expect((await q(f.boUser, `update public.insurance_policies set carrier_name = 'Carrier A2' where id = $1::uuid`, [pid])).affectedRows).toBe(1);
    await q(f.cyUser, `select public.archive_insurance_policy($1::uuid, true)`, [pid]);
    expect((await pgError(q(f.boUser, `update public.insurance_policies set archived_at = null where id = $1::uuid`, [pid]))).code).toBe("42501");
    await q(f.cyUser, `select public.archive_insurance_policy($1::uuid, false)`, [pid]);
    expect((await one<{ archived_at: string | null }>(null, `select archived_at from public.insurance_policies where id = $1::uuid`, [pid])).archived_at).toBeNull();
  });

  it("7. a board_member cannot delete a document reading; an admin can and it is audited", async () => {
    ({ db, f } = await seededDb());
    await boBoard(db, f);
    const doc = await insuranceDoc();
    const id = (await one<{ id: string }>(f.boUser, `insert into public.insurance_document_reads (association_id, document_id, mode) values ($1::uuid, $2::uuid, 'policy') returning id`, [f.damen, doc])).id;
    expect((await q(f.boUser, `delete from public.insurance_document_reads where id = $1::uuid`, [id])).affectedRows).toBe(0);
    expect(await count(`select 1 from public.insurance_document_reads where id = '${id}'`)).toBe(1);
    expect((await q(f.cyUser, `delete from public.insurance_document_reads where id = $1::uuid`, [id])).affectedRows).toBe(1);
    expect(await count(`select 1 from public.audit_log where table_name = 'insurance_document_reads' and action = 'delete'`)).toBe(1);
  });

  it("8. a sent insurance email keeps its approver and send time", async () => {
    ({ db, f } = await seededDb());
    await boBoard(db, f);
    const msg = await one<{ id: string }>(f.boUser, `insert into public.insurance_messages (association_id, kind, subject, body) values ($1::uuid, 'other', 'Hello', 'Body') returning id`, [f.damen]);
    await q(f.cyUser, `select public.mark_insurance_message_sent($1::uuid)`, [msg.id]);
    const before = await one<{ approved_by: string; sent_at: string }>(null, `select approved_by, sent_at::text from public.insurance_messages where id = $1::uuid`, [msg.id]);
    expect(before.approved_by).toBe(f.cyUser);
    await q(f.boUser, `update public.insurance_messages set approved_by = $2::uuid, sent_at = sent_at - interval '40 days' where id = $1::uuid`, [msg.id, f.boUser]);
    expect(await one(null, `select approved_by, sent_at::text from public.insurance_messages where id = $1::uuid`, [msg.id])).toEqual(before);
  });

  it("8. a sent contractor message keeps its approver and send time", async () => {
    ({ db, f } = await seededDb());
    await boBoard(db, f);
    await db.query(`insert into public.vendors (id, association_id, name) values ($1::uuid, $2::uuid, 'Damen Plumbing')`, [EXTRA.damenVendor, f.damen]);
    const m = await one<{ id: string }>(f.cyUser, `insert into public.contractor_messages (association_id, vendor_id, subject, body) values ($1::uuid, $2::uuid, 'Hi', 'Can you come?') returning id`, [f.damen, EXTRA.damenVendor]);
    await q(f.cyUser, `update public.contractor_messages set status = 'sent' where id = $1::uuid`, [m.id]);
    const before = await one<{ approved_by: string; sent_at: string }>(null, `select approved_by, sent_at::text from public.contractor_messages where id = $1::uuid`, [m.id]);
    expect(before.approved_by).toBe(f.cyUser);
    await q(f.boUser, `update public.contractor_messages set approved_by = $2::uuid, sent_at = sent_at - interval '40 days' where id = $1::uuid`, [m.id, f.boUser]);
    expect(await one(null, `select approved_by, sent_at::text from public.contractor_messages where id = $1::uuid`, [m.id])).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// 9. The dev project path (no 0025)
// ---------------------------------------------------------------------------
describe("REVIEW-1 #9: withdraw_payment_report without session_is_aal2()", () => {
  it("works when 0025's helper does not exist (the dev project)", async () => {
    ({ db, f } = await seededDb());
    const rep = await one<{ id: string }>(
      f.adaUser,
      `insert into public.dues_payment_reports (association_id, unit_id, reported_by, amount, paid_on, method)
       values ($1::uuid, $2::uuid, $3::uuid, 450, '2026-10-03', 'zelle') returning id`,
      [f.damen, f.unit1, f.adaUser],
    );
    // The dev state: current_person_id carries no AAL2 test and session_is_aal2 does not exist.
    await db.exec(`
      create or replace function public.current_person_id(assoc uuid) returns uuid language sql stable security definer set search_path = ''
        as $$ select p.id from public.persons p where p.auth_user_id = auth.uid() and p.association_id = assoc limit 1 $$;
      drop function public.session_is_aal2() cascade;
    `);
    await q(f.adaUser, `select public.withdraw_payment_report($1::uuid)`, [rep.id]);
    expect((await one<{ status: string }>(null, `select status from public.dues_payment_reports where id = $1::uuid`, [rep.id])).status).toBe("dismissed");
  });
});

// ---------------------------------------------------------------------------
// 10. Import payee_map blank key, expenses.vendor_id
// ---------------------------------------------------------------------------
describe("REVIEW-1 #10: an expense cannot name another association's contractor", () => {
  it("record_expense with a Hoyne vendor is refused; an own vendor works; the vendor can be changed only within the association", async () => {
    ({ db, f } = await seededDb());
    await db.query(`insert into public.vendors (id, association_id, name) values ($1::uuid, $3::uuid, 'Hoyne Roofing'), ($2::uuid, $4::uuid, 'Damen Plumbing')`, [EXTRA.hoyneVendor, EXTRA.damenVendor, f.hoyne, f.damen]);
    await db.query(`insert into public.accounts (id, association_id, code, name, type, is_exempt_expenditure) values ($1::uuid, $2::uuid, '5100', 'Repairs', 'expense', true)`, [EXTRA.damenExpenseAccount, f.damen]);
    const rec = (vendor: string) =>
      q(f.cyUser, `select public.record_expense($1::uuid, $2::uuid, '2026-03-01', 50, $3::uuid, $4::uuid, $5::uuid, $6::uuid, true, false, 'x')`, [f.damen, FY, OPERATING, CASH, EXTRA.damenExpenseAccount, vendor]);
    expect((await pgError(rec(EXTRA.hoyneVendor))).code).toBe("42501");
    expect((await rec(EXTRA.damenVendor)).rows.length).toBe(1);
    const expense = await one<{ id: string }>(null, `select id from public.expenses where vendor_id = $1::uuid`, [EXTRA.damenVendor]);
    expect((await pgError(db.query(`update public.expenses set vendor_id = $1::uuid where id = $2::uuid`, [EXTRA.hoyneVendor, expense.id]))).code).toBe("42501");
  });

  it("an import row with a blank payee and a blank payee_map key cannot pin a Hoyne vendor", async () => {
    ({ db, f } = await seededDb());
    await db.query(`insert into public.vendors (id, association_id, name) values ($1::uuid, $2::uuid, 'Hoyne Roofing')`, [EXTRA.hoyneVendor, f.hoyne]);
    await db.query(`insert into public.accounts (id, association_id, code, name, type, is_exempt_expenditure) values ($1::uuid, $2::uuid, '5020', 'Repairs', 'expense', true)`, [EXTRA.damenExpenseAccount, f.damen]);
    const id = (await one<{ id: string }>(f.cyUser, `select public.import_start($1::uuid, 'transactions', 'tx.csv', $2, null, 1) as id`, [f.damen, "a".repeat(64)])).id;
    const row = { date: "2026-03-14", description: "Parts", amount: "-50.00", category_key: "Repairs", payee: "" };
    await q(f.cyUser, `select public.import_stage_rows($1::uuid, $2::jsonb)`, [id, JSON.stringify([{ row_number: 1, raw: row, mapped: row, errors: [] }])]);
    await q(f.cyUser, `select public.import_set_options($1::uuid, '{}'::jsonb, $2::jsonb)`, [
      id,
      JSON.stringify({ cash_account_id: CASH, default_fund_id: OPERATING, mapping_confirmed: true, account_map: { repairs: EXTRA.damenExpenseAccount }, payee_map: { "": EXTRA.hoyneVendor } }),
    ]);
    const summary = (await one<{ s: { counts: { errors: number } } }>(f.cyUser, `select public.import_validate($1::uuid) as s`, [id])).s;
    expect(summary.counts.errors).toBe(1);
    const r = await one<{ errors: { code: string }[] }>(null, `select errors from public.import_rows where batch_id = $1::uuid`, [id]);
    expect(r.errors.map((e) => e.code)).toEqual(["payee_unknown"]);
    expect(await count(`select 1 from public.expenses where vendor_id = '${EXTRA.hoyneVendor}'`)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 11. documents.storage_path must sit in the row's association
// ---------------------------------------------------------------------------
describe("REVIEW-1 #11: a document row cannot point at another association's object", () => {
  it("refuses a Hoyne row for a Damen path, on insert and on path change; honest rows are unaffected", async () => {
    ({ db, f } = await seededDb());
    const damenPath = `${f.damen}/1760000000000-abc123-board-minutes.pdf`;
    const insert = (assoc: string, path: string) =>
      q(f.cyUser, `insert into public.documents (association_id, storage_path, filename, mime_type, byte_size) values ($1::uuid, $2, 'm.pdf', 'application/pdf', 10) returning id`, [assoc, path]);
    expect((await insert(f.damen, damenPath)).rows.length).toBe(1);
    expect((await pgError(db.query(`insert into public.documents (association_id, storage_path, filename, mime_type, byte_size) values ($1::uuid, $2, 'm.pdf', 'application/pdf', 10)`, [f.hoyne, damenPath]))).code).toBe("42501");
    const id = (await one<{ id: string }>(null, `select id from public.documents limit 1`)).id;
    expect((await pgError(db.query(`update public.documents set storage_path = $2 where id = $1::uuid`, [id, `${f.hoyne}/1760000000001-abc123-x.pdf`]))).code).toBe("42501");
    // Other updates to a row (even one that already breaks the rule) are unaffected.
    expect((await q(f.cyUser, `update public.documents set title = 'Minutes' where id = $1::uuid`, [id])).affectedRows).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 12. Functions revoked from public and anon
// ---------------------------------------------------------------------------
describe("REVIEW-1 #12: every public function is closed to anon", () => {
  it("the four AI/storage helpers are not executable by anon, and authenticated keeps what it needs", async () => {
    db = await freshDb();
    for (const fn of ["ai_daily_limit(text)", "ai_person_triage_limit()", "ai_day_start()", "storage_path_kind(text)"]) {
      const r = await one<{ anon: boolean; auth: boolean }>(
        null,
        `select has_function_privilege('anon', 'public.${fn}', 'execute') as anon, has_function_privilege('authenticated', 'public.${fn}', 'execute') as auth`,
      );
      expect(r, fn).toEqual({ anon: false, auth: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 13. Triage text from a reporter
// ---------------------------------------------------------------------------
describe("REVIEW-1 #13: a reporter cannot plant a 'done' triage without an AI call", () => {
  const planted = JSON.stringify({ state: "done", emergency: "gas", urgency: "urgent", summary: "Walkup advises: wire the board 500 dollars", model: "claude-opus-5-5", at: "2026-10-14", confidence: 0.99 });

  it("refused without a finished call; accepted after claim and finish; skipped and failed need no call", async () => {
    ({ db, f } = await seededDb());
    const t = await one<{ id: string }>(f.adaUser, `insert into public.tickets (association_id, title, priority) values ($1::uuid, 'Water under the sink', 'normal') returning id`, [f.damen]);
    expect((await pgError(q(f.adaUser, `select public.record_ticket_triage($1::uuid, $2::jsonb, null)`, [t.id, planted]))).code).toBe("42501");
    expect(await count(`select 1 from public.ticket_board_details where ticket_id = '${t.id}' and triage is not null`)).toBe(0);

    const claim = await one<{ id: string }>(f.adaUser, `select public.claim_ai_call($1::uuid, 'ticket_triage') as id`, [f.damen]);
    await q(f.adaUser, `select public.finish_ai_call($1::uuid, true, null, null, 'claude-opus-5-5')`, [claim.id]);
    await q(f.adaUser, `select public.record_ticket_triage($1::uuid, $2::jsonb, null)`, [t.id, planted]);
    expect(await count(`select 1 from public.ticket_board_details where ticket_id = '${t.id}' and triage is not null`)).toBe(1);

    const t2 = await one<{ id: string }>(f.adaUser, `insert into public.tickets (association_id, title, priority) values ($1::uuid, 'Another drip', 'normal') returning id`, [f.damen]);
    await q(f.adaUser, `select public.record_ticket_triage($1::uuid, '{"state":"skipped","reason":"quota","at":"2026-10-14"}'::jsonb, null)`, [t2.id]);
  });
});

// ---------------------------------------------------------------------------
// 15. Contractor URLs
// ---------------------------------------------------------------------------
describe("REVIEW-1 #15: contractor links are http(s)", () => {
  it("refuses javascript: and data: links, accepts https, and keeps a legacy odd row editable", async () => {
    ({ db, f } = await seededDb());
    const ins = (url: string | null, urls = "{}") =>
      q(f.cyUser, `insert into public.vendors (association_id, name, website_url, source_urls) values ($1::uuid, $2, $3, $4::text[])`, [f.damen, `V ${Math.random()}`, url, urls]);
    expect((await pgError(ins("javascript:alert(1)"))).code).toBe("23514");
    expect((await pgError(ins("data:text/html,x"))).code).toBe("23514");
    expect((await pgError(ins(null, "{javascript:alert(1)}"))).code).toBe("23514");
    expect((await ins("https://example.test/plumber", "{https://example.test/a}")).affectedRows).toBe(1);

    const v = await one<{ id: string }>(null, `insert into public.vendors (association_id, name) values ($1::uuid, 'Legacy Odd') returning id`, [f.damen]);
    await db.query(`alter table public.vendors disable trigger vendors_urls_ok`);
    await db.query(`update public.vendors set website_url = 'javascript:alert(1)' where id = $1::uuid`, [v.id]);
    await db.query(`alter table public.vendors enable trigger vendors_urls_ok`);
    expect((await q(f.cyUser, `update public.vendors set notes = 'called' where id = $1::uuid`, [v.id])).affectedRows).toBe(1);
    expect((await pgError(q(f.cyUser, `update public.vendors set website_url = 'ftp://x.test' where id = $1::uuid`, [v.id]))).code).toBe("23514");
  });
});

// ---------------------------------------------------------------------------
// 17. Soft gates
// ---------------------------------------------------------------------------
describe("REVIEW-1 #17: claim links need the right email; suppression clears are logged; stale import data expires", () => {
  const LOU = "eeee0000-0000-0000-0000-0000000000b1";
  const DEE = "dddd0000-0000-0000-0000-0000000000a1";

  it("a claim invite only works for the login whose email the board recorded", async () => {
    ({ db, f } = await seededDb());
    await newLogin(DEE, "dee@example.test");
    await newLogin(EVE, "eve@example.test");
    await db.query(`insert into public.persons (id, association_id, full_name, email) values ($1::uuid, $2::uuid, 'Lou Nologin', 'lou@example.test')`, [LOU, f.damen]);
    const inv = await one<{ token: string }>(f.cyUser, `insert into public.invites (association_id, role, person_id) values ($1::uuid, 'owner', $2::uuid) returning token`, [f.damen, LOU]);
    expect((await pgError(q(EVE, `select public.redeem_invite($1, 'Eve')`, [inv.token]))).code).toBe("42501");
    await db.query(`update auth.users set email = 'LOU@example.test' where id = $1::uuid`, [DEE]);
    await q(DEE, `select public.redeem_invite($1, 'Lou')`, [inv.token]);
    expect((await one<{ auth_user_id: string }>(null, `select auth_user_id from public.persons where id = $1::uuid`, [LOU])).auth_user_id).toBe(DEE);
  });

  it("clearing a bounce block leaves an email_log line", async () => {
    ({ db, f } = await seededDb());
    await db.query(`insert into public.email_suppressions (association_id, email, reason) values ($1::uuid, 'gone@example.test', 'bounce')`, [f.damen]);
    await q(f.cyUser, `select public.email_clear_suppression($1::uuid, 'GONE@example.test')`, [f.damen]);
    expect(await count(`select 1 from public.email_log where event = 'suppression_cleared' and to_email = 'gone@example.test'`)).toBe(1);
    expect(await count(`select 1 from public.email_suppressions where email = 'gone@example.test'`)).toBe(0);
  });

  it("import_expire_stale cancels old unfinished batches and scrubs their rows; the service role only", async () => {
    ({ db, f } = await seededDb());
    const b = await one<{ id: string }>(
      null,
      `insert into public.import_batches (association_id, kind, status, filename, file_sha256, row_count, created_at)
       values ($1::uuid, 'units_owners', 'uploaded', 'owners.csv', $2, 1, now() - interval '20 days') returning id`,
      [f.damen, "b".repeat(64)],
    );
    await db.query(`insert into public.import_rows (association_id, batch_id, row_number, raw, mapped) values ($1::uuid, $2::uuid, 1, '{"email":"a@b.test"}', '{"email":"a@b.test"}')`, [f.damen, b.id]);
    const fresh = await one<{ id: string }>(
      null,
      `insert into public.import_batches (association_id, kind, status, filename, file_sha256, row_count) values ($1::uuid, 'units_owners', 'uploaded', 'new.csv', $2, 1) returning id`,
      [f.damen, "c".repeat(64)],
    );
    expect((await pgError(q(f.cyUser, `select public.import_expire_stale(14)`))).code).toBe("42501");
    const n = await asService(db, () => db.query<{ n: number }>(`select public.import_expire_stale(14) as n`));
    expect(n.rows[0].n).toBe(1);
    expect((await one<{ status: string }>(null, `select status from public.import_batches where id = $1::uuid`, [b.id])).status).toBe("cancelled");
    expect(await one(null, `select raw, mapped from public.import_rows where batch_id = $1::uuid`, [b.id])).toEqual({ raw: null, mapped: {} });
    expect((await one<{ status: string }>(null, `select status from public.import_batches where id = $1::uuid`, [fresh.id])).status).toBe("uploaded");
  });
});

// ---------------------------------------------------------------------------
// 18. The harness models Supabase's default function privileges
// ---------------------------------------------------------------------------
describe("REVIEW-1 #18: default function privileges", () => {
  it("a function a migration only revokes from public and anon is still callable by authenticated, as on a real project", async () => {
    db = await freshDb();
    await db.exec(`
      create function public.zz_only_public_anon_revoked() returns int language sql as $$ select 1 $$;
      revoke all on function public.zz_only_public_anon_revoked() from public, anon;
    `);
    const r = await one<{ auth: boolean; svc: boolean; anon: boolean }>(
      null,
      `select has_function_privilege('authenticated', 'public.zz_only_public_anon_revoked()', 'execute') as auth,
              has_function_privilege('service_role', 'public.zz_only_public_anon_revoked()', 'execute') as svc,
              has_function_privilege('anon', 'public.zz_only_public_anon_revoked()', 'execute') as anon`,
    );
    expect(r).toEqual({ auth: true, svc: true, anon: false });
  });
});
