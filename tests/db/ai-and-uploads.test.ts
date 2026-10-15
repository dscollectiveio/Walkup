import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { addStorageStub, applyMigrations, asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";
import { STORAGE_PATH_CASES } from "../fixtures/storage-paths";

/**
 * Migration 0051 (foundation-spec section 3, tests 12.1): the metered AI
 * usage log, the ticket visibility and photo-permission helpers, storage
 * path parsing, attach/remove/list ticket photos, and the document_links
 * same-association guard. Numbered comments match the spec's test list.
 */

const HOYNE_SHARED = "7c000000-0000-0000-0000-000000000101";
const CLOSED_COMMON = "7c000000-0000-0000-0000-000000000004";
const RESOLVED_UNIT1 = "7c000000-0000-0000-0000-000000000005";
const SECOND_COMMON = "7c000000-0000-0000-0000-000000000006";

type PgError = { code?: string; hint?: string; detail?: string; message: string };

async function pgError(p: Promise<unknown>): Promise<PgError> {
  try {
    await p;
  } catch (e) {
    const x = e as PgError;
    return { code: x.code, hint: x.hint, detail: x.detail, message: x.message };
  }
  throw new Error("expected the statement to fail");
}

// Unique, well-formed timestamps and checksums for every photo in a file.
let counter = 0;
const nextTs = () => 1_760_000_000_000 + ++counter;
const checksumFor = (n: number) => `c0ffee${n.toString(16).padStart(58, "0")}`;
const freshChecksum = () => checksumFor(1_000_000 + ++counter);

const photoPath = (assoc: string, ticketId: string) => `${assoc}/tickets/${ticketId}/${nextTs()}-abc123-p.jpg`;
const hubPath = (assoc: string) => `${assoc}/${nextTs()}-abc123-minutes.pdf`;

type AttachRow = {
  document_id: string | null;
  duplicate: boolean;
  storage_path: string | null;
  linked: boolean;
  narrower_audience: boolean;
};

function setupHelpers(getDb: () => PGlite, getF: () => Fixture) {
  const assocOf = (ticketId: string) => (ticketId === HOYNE_SHARED ? getF().hoyne : getF().damen);

  /** attach_ticket_photo as `user`, with a fresh path for that ticket unless given. */
  async function photo(
    user: string,
    ticketId: string,
    opts: { checksum?: string; path?: string; mime?: string; size?: number; title?: string } = {},
  ): Promise<AttachRow & { path: string; checksum: string }> {
    const path = opts.path ?? photoPath(assocOf(ticketId), ticketId);
    const checksum = opts.checksum ?? freshChecksum();
    const { rows } = await asUser(getDb(), user, () =>
      getDb().query<AttachRow>(
        `select * from public.attach_ticket_photo($1::uuid, $2, 'p.jpg', $3, $4::bigint, $5, $6)`,
        [ticketId, path, opts.mime ?? "image/jpeg", opts.size ?? 1000, checksum, opts.title ?? null],
      ),
    );
    return { ...rows[0], path, checksum };
  }

  /** A documents row written as superuser (the hub's own upload path). */
  async function seedDoc(
    assoc: string,
    opts: { checksum?: string; visibility?: "board_only" | "all_owners"; unitId?: string; storagePath?: string } = {},
  ): Promise<string> {
    const { rows } = await getDb().query<{ id: string }>(
      `insert into public.documents
         (association_id, storage_path, filename, mime_type, byte_size, checksum, visibility, restricted_to_unit_id)
       values ($1::uuid, $2, 'minutes.pdf', 'application/pdf', 1000, $3, $4, $5::uuid)
       returning id`,
      [
        assoc,
        opts.storagePath ?? hubPath(assoc),
        opts.checksum ?? freshChecksum(),
        opts.visibility ?? "board_only",
        opts.unitId ?? null,
      ],
    );
    return rows[0].id;
  }

  async function canSelectDoc(user: string, docId: string): Promise<boolean> {
    const { rows } = await asUser(getDb(), user, () =>
      getDb().query(`select id from public.documents where id = $1::uuid`, [docId]),
    );
    return rows.length === 1;
  }

  async function linkCount(docId: string, ticketId?: string): Promise<number> {
    const { rows } = await getDb().query<{ n: number }>(
      `select count(*)::int as n from public.document_links
        where document_id = $1::uuid and ($2::uuid is null or (target_table = 'tickets' and target_id = $2::uuid))`,
      [docId, ticketId ?? null],
    );
    return rows[0].n;
  }

  async function sqlBool(user: string | null, sql: string, params: unknown[]): Promise<boolean> {
    const run = () => getDb().query<{ v: boolean }>(sql, params);
    const { rows } = user === null ? await run() : await asUser(getDb(), user, run);
    return rows[0].v;
  }

  return { photo, seedDoc, canSelectDoc, linkCount, sqlBool };
}

describe("ai and uploads (0051)", () => {
  let db: PGlite;
  let f: Fixture;
  const h = setupHelpers(
    () => db,
    () => f,
  );

  beforeAll(async () => {
    db = await freshDb();
    f = await seed(db);
    await db.exec(`
      -- Zara becomes Hoyne's board admin, so cross-association cases have a board on both sides.
      insert into role_grants (association_id, person_id, role, granted_on, expires_on)
      values ('22222222-2222-2222-2222-222222222222', 'eeee0000-0000-0000-0000-00000000000e',
              'board_admin', '2024-01-01', null);

      -- A Hoyne shared-area ticket.
      insert into tickets (id, association_id, title, status, priority, unit_id, opened_on)
      values ('${HOYNE_SHARED}', '22222222-2222-2222-2222-222222222222',
              'Hoyne gutter loose', 'open', 'normal', null, '2026-03-01');

      -- A closed Damen shared-area ticket and a resolved Damen unit-1 ticket.
      insert into tickets (id, association_id, title, status, priority, unit_id, opened_on, resolved_at)
      values ('${CLOSED_COMMON}', '11111111-1111-1111-1111-111111111111',
              'Front door closer (fixed)', 'closed', 'normal', null, '2026-01-10', now()),
             ('${RESOLVED_UNIT1}', '11111111-1111-1111-1111-111111111111',
              'Ada window latch (fixed)', 'resolved', 'low', 'aaaa1111-0000-0000-0000-000000000001', '2026-01-11', now());

      -- One finished Hoyne ai_calls row.
      insert into ai_calls (association_id, kind, step, model, ok, called_by, finished_at)
      values ('22222222-2222-2222-2222-222222222222', 'contractor_search', 'main',
              'claude-opus-5-5', true, 'dddd0000-0000-0000-0000-00000000000e', now());
    `);
  });

  // --------------------------------------------------------------------------
  // ai_calls
  // --------------------------------------------------------------------------
  describe("ai_calls: claiming and finishing", () => {
    let marketLimit: number;

    const claim = async (user: string, kind: string, assoc = f.damen, aal: "aal1" | "aal2" = "aal2") => {
      const { rows } = await asUser(
        db,
        user,
        () => db.query<{ id: string }>(`select public.claim_ai_call($1::uuid, $2) as id`, [assoc, kind]),
        { aal },
      );
      return rows[0].id;
    };

    const finish = async (
      user: string,
      id: string,
      ok: boolean,
      extra: { code?: string | null; error?: string | null; input?: number; output?: number; model?: string } = {},
    ) => {
      const { rows } = await asUser(db, user, () =>
        db.query<{ done: boolean }>(
          `select public.finish_ai_call(
             p_id => $1::uuid, p_ok => $2, p_error_code => $3, p_error => $4,
             p_model => $5, p_input_tokens => $6, p_output_tokens => $7) as done`,
          [id, ok, extra.code ?? null, extra.error ?? null, extra.model ?? null, extra.input ?? 0, extra.output ?? 0],
        ),
      );
      return rows[0].done;
    };

    const today = async (user: string, kind: string, assoc = f.damen) => {
      const { rows } = await asUser(db, user, () =>
        db.query<{ n: number }>(`select public.ai_calls_today($1::uuid, $2) as n`, [assoc, kind]),
      );
      return rows[0].n;
    };

    const row = async (id: string) => {
      const { rows } = await db.query<Record<string, unknown>>(`select * from public.ai_calls where id = $1::uuid`, [
        id,
      ]);
      return rows[0];
    };

    beforeAll(async () => {
      const { rows } = await db.query<{ n: number }>(`select public.ai_daily_limit('insurance_market') as n`);
      marketLimit = rows[0].n;
    });

    afterEach(async () => {
      // Followups first: parent_id is on delete restrict.
      await db.exec(`
        delete from public.ai_calls where association_id = '${f.damen}' and step = 'followup';
        delete from public.ai_calls where association_id = '${f.damen}';
      `);
    });

    it("ai_daily_limit: the agreed limits, including the insurance values and coi_read", async () => {
      const { rows } = await db.query<{ kind: string; n: number | null }>(
        `select k as kind, public.ai_daily_limit(k) as n
           from unnest(array['insurance_read', 'insurance_summary', 'insurance_market', 'insurance_draft',
                             'ticket_triage', 'contractor_search', 'contractor_draft', 'bid_read',
                             'coi_read', 'document_classify', 'nonsense']) as k`,
      );
      expect(Object.fromEntries(rows.map((r) => [r.kind, r.n]))).toEqual({
        insurance_read: 20,
        insurance_summary: 20,
        insurance_market: 6,
        insurance_draft: 40,
        ticket_triage: 60,
        contractor_search: 12,
        contractor_draft: 40,
        bid_read: 25,
        coi_read: 25,
        document_classify: 200,
        nonsense: null,
      });
    });

    // 1
    it("claim_ai_call: board claims a scarce kind", async () => {
      const id = await claim(f.cyUser, "insurance_market");
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      const r = await row(id);
      expect(r).toMatchObject({
        step: "main",
        ok: false,
        error_code: "in_flight",
        called_by: f.cyUser,
        model: null,
        association_id: f.damen,
        kind: "insurance_market",
      });
    });

    it("claim_ai_call: coi_read is a known kind for the board", async () => {
      const id = await claim(f.cyUser, "coi_read");
      expect((await row(id)).kind).toBe("coi_read");
    });

    // 2
    it("claim_ai_call: owner may claim triage only", async () => {
      expect(await claim(f.adaUser, "ticket_triage")).toBeTruthy();
      expect((await pgError(claim(f.adaUser, "contractor_search"))).code).toBe("42501");
      expect((await pgError(claim(f.adaUser, "insurance_market"))).code).toBe("42501");
    });

    // 3
    it("claim_ai_call: accountant may not claim board kinds", async () => {
      expect((await pgError(claim(f.niaUser, "insurance_draft"))).code).toBe("42501");
      expect(await claim(f.niaUser, "ticket_triage")).toBeTruthy();
    });

    // 4
    it("claim_ai_call: refuses another building", async () => {
      expect((await pgError(claim(f.zaraUser, "ticket_triage", f.damen))).code).toBe("42501");
    });

    it("claim_ai_call: refuses an expired accountant", async () => {
      expect((await pgError(claim(f.vicUser, "ticket_triage"))).code).toBe("42501");
    });

    it("claim_ai_call: refuses an aal1 session", async () => {
      expect((await pgError(claim(f.cyUser, "insurance_market", f.damen, "aal1"))).code).toBe("42501");
    });

    // 5
    it("claim_ai_call: rejects an unknown kind", async () => {
      expect((await pgError(claim(f.cyUser, "horoscope"))).code).toBe("22023");
    });

    // 6
    it("claim_ai_call: stops at the building limit", async () => {
      for (let i = 0; i < marketLimit; i++) {
        expect(await finish(f.cyUser, await claim(f.cyUser, "insurance_market"), true)).toBe(true);
      }
      const err = await pgError(claim(f.cyUser, "insurance_market"));
      expect(err).toMatchObject({ code: "P0001", hint: "ai_quota", detail: `${marketLimit}/${marketLimit}` });
    });

    // 7
    // Sequential on one connection: this proves in-flight rows count against the limit. The advisory lock that
    // serialises true concurrent claims is correct by reading (taken before the count, held to commit) but cannot
    // be exercised in PGlite (REVIEW-1 #18).
    it("claim_ai_call: in-flight calls count against the limit (the claim lock itself is not testable here)", async () => {
      for (let i = 0; i < marketLimit; i++) await claim(f.cyUser, "insurance_market");
      expect((await pgError(claim(f.cyUser, "insurance_market"))).hint).toBe("ai_quota");
    });

    // 8
    it("claim_ai_call: stale in-flight calls stop counting", async () => {
      for (let i = 0; i < marketLimit; i++) await claim(f.cyUser, "insurance_market");
      await db.exec(`
        update public.ai_calls set created_at = now() - interval '6 minutes'
         where association_id = '${f.damen}' and error_code = 'in_flight'`);
      expect(await claim(f.cyUser, "insurance_market")).toBeTruthy();
    });

    // 9
    it("claim_ai_call: platform failures don't count, attempts are capped", async () => {
      for (let i = 0; i < 2 * marketLimit; i++) {
        await finish(f.cyUser, await claim(f.cyUser, "insurance_market"), false, { code: "busy" });
      }
      expect(await today(f.cyUser, "insurance_market")).toBe(0);
      const err = await pgError(claim(f.cyUser, "insurance_market"));
      expect(err).toMatchObject({ code: "P0001", hint: "ai_attempts" });
    });

    // 10
    it("claim_ai_call: request-caused failures count", async () => {
      for (const code of ["refused", "too_long", "bad_request"]) {
        await finish(f.cyUser, await claim(f.cyUser, "insurance_market"), false, { code });
      }
      for (let i = 3; i < marketLimit; i++) {
        await finish(f.cyUser, await claim(f.cyUser, "insurance_market"), true);
      }
      expect((await pgError(claim(f.cyUser, "insurance_market"))).hint).toBe("ai_quota");
    });

    // 11
    it("claim_ai_call: an owner's own triage cap", async () => {
      for (let i = 0; i < 10; i++) {
        await finish(f.adaUser, await claim(f.adaUser, "ticket_triage"), true);
      }
      const err = await pgError(claim(f.adaUser, "ticket_triage"));
      expect(err).toMatchObject({ code: "P0001", hint: "ai_quota_person", detail: "10/10" });
      expect(await claim(f.boUser, "ticket_triage")).toBeTruthy();
    });

    // 12
    it("claim_ai_call: day boundary is Chicago midnight", async () => {
      await db.query(
        `insert into public.ai_calls (association_id, kind, step, model, ok, called_by, created_at, finished_at)
         select $1::uuid, 'insurance_market', 'main', 'claude-opus-5-5', true, $2::uuid,
                public.ai_day_start() - interval '1 minute', public.ai_day_start() - interval '1 minute'
           from generate_series(1, $3::int)`,
        [f.damen, f.cyUser, marketLimit],
      );
      const id = await claim(f.cyUser, "insurance_market");
      expect(id).toBeTruthy();
      await finish(f.cyUser, id, false, { code: "busy" });

      await db.query(
        `insert into public.ai_calls (association_id, kind, step, model, ok, called_by, created_at, finished_at)
         values ($1::uuid, 'insurance_market', 'main', 'claude-opus-5-5', true, $2::uuid,
                 public.ai_day_start() + interval '1 minute', public.ai_day_start() + interval '1 minute')`,
        [f.damen, f.cyUser],
      );
      expect(await today(f.cyUser, "insurance_market")).toBe(1);

      // And the boundary really is Chicago's, not UTC's.
      const { rows } = await db.query<{ local: string }>(
        `select to_char(public.ai_day_start() at time zone 'America/Chicago', 'HH24:MI:SS') as local`,
      );
      expect(rows[0].local).toBe("00:00:00");
    });

    // 13
    it("finish_ai_call: only the claimer, only once", async () => {
      const id = await claim(f.cyUser, "insurance_market");
      expect(await finish(f.adaUser, id, true)).toBe(false);
      expect(await finish(f.cyUser, id, true, { model: "claude-opus-5-5", input: 1200, output: 340 })).toBe(true);
      expect(await row(id)).toMatchObject({
        ok: true,
        error_code: null,
        model: "claude-opus-5-5",
        input_tokens: 1200,
        output_tokens: 340,
      });
      expect((await row(id)).finished_at).not.toBeNull();
      expect(await finish(f.cyUser, id, false, { code: "busy" })).toBe(false);

      const other = await claim(f.cyUser, "insurance_market");
      expect((await pgError(finish(f.cyUser, other, false, { code: "in_flight" }))).code).toBe("22023");
    });

    // 14
    it("finish_ai_call: clamps negatives and truncates the error", async () => {
      const id = await claim(f.cyUser, "insurance_market");
      expect(await finish(f.cyUser, id, false, { input: -5, output: -1, error: "x".repeat(900) })).toBe(true);
      const r = await row(id);
      expect(r.input_tokens).toBe(0);
      expect(r.output_tokens).toBe(0);
      expect((r.error as string).length).toBe(500);
      expect(r.error_code).toBe("unknown");
    });

    // 15
    it("record_ai_call: a followup under my own recent claim", async () => {
      const parent = await claim(f.cyUser, "insurance_market");
      const before = await today(f.cyUser, "insurance_market");
      const { rows } = await asUser(db, f.cyUser, () =>
        db.query<{ id: string }>(
          `select public.record_ai_call(p_parent_id => $1::uuid, p_model => 'claude-opus-5-5', p_ok => true,
                                        p_input_tokens => 50) as id`,
          [parent],
        ),
      );
      expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
      expect(await row(rows[0].id)).toMatchObject({
        step: "followup",
        parent_id: parent,
        association_id: f.damen,
        kind: "insurance_market",
        ok: true,
        input_tokens: 50,
      });
      expect(await today(f.cyUser, "insurance_market")).toBe(before);
    });

    // 16
    it("record_ai_call: refuses someone else's or an old parent", async () => {
      const record = (user: string, parent: string) =>
        asUser(db, user, () =>
          db.query(`select public.record_ai_call($1::uuid, 'claude-opus-5-5', true)`, [parent]),
        );
      const parent = await claim(f.cyUser, "insurance_market");
      expect((await pgError(record(f.adaUser, parent))).code).toBe("42501");

      for (let i = 0; i < 3; i++) await record(f.cyUser, parent);
      expect(await pgError(record(f.cyUser, parent))).toMatchObject({ code: "P0001", hint: "ai_followups" });

      const old = await claim(f.cyUser, "insurance_market");
      await db.query(`update public.ai_calls set created_at = now() - interval '20 minutes' where id = $1::uuid`, [
        old,
      ]);
      expect((await pgError(record(f.cyUser, old))).code).toBe("42501");
    });

    // 17
    it("ai_calls: board reads, owner and accountant don't", async () => {
      await claim(f.cyUser, "insurance_market");
      await claim(f.adaUser, "ticket_triage");
      const read = (user: string) =>
        asUser(db, user, () =>
          db.query(`select id from public.ai_calls where association_id = $1::uuid`, [f.damen]),
        );
      expect((await read(f.cyUser)).rows).toHaveLength(2);
      expect((await read(f.adaUser)).rows).toHaveLength(0);
      expect((await read(f.niaUser)).rows).toHaveLength(0);
    });

    // 18
    it("ai_calls: Hoyne's board can't read Damen's rows", async () => {
      await claim(f.cyUser, "insurance_market");
      const { rows } = await asUser(db, f.zaraUser, () =>
        db.query<{ association_id: string; kind: string }>(`select association_id, kind from public.ai_calls`),
      );
      expect(rows).toEqual([{ association_id: f.hoyne, kind: "contractor_search" }]);
    });

    // 19
    it("ai_calls: no direct writes", async () => {
      const id = await claim(f.cyUser, "insurance_market");
      const err = await pgError(
        asUser(db, f.cyUser, () =>
          db.query(`insert into public.ai_calls (association_id, kind) values ($1::uuid, 'insurance_market')`, [
            f.damen,
          ]),
        ),
      );
      expect(err.message).toMatch(/row-level security/);
      const upd = await asUser(db, f.cyUser, () =>
        db.query(`update public.ai_calls set ok = true, error_code = null where id = $1::uuid`, [id]),
      );
      expect(upd.affectedRows).toBe(0);
      const del = await asUser(db, f.cyUser, () => db.query(`delete from public.ai_calls where id = $1::uuid`, [id]));
      expect(del.affectedRows).toBe(0);
      expect((await row(id)).error_code).toBe("in_flight");
    });

    // 20
    it("ai_calls_today: an owner sees the building's true count", async () => {
      await claim(f.cyUser, "insurance_market");
      await finish(f.cyUser, await claim(f.cyUser, "insurance_market"), true);
      expect(await today(f.adaUser, "insurance_market")).toBe(2);
    });

    it("ai_calls_today: refuses another building", async () => {
      expect((await pgError(today(f.zaraUser, "insurance_market", f.damen))).code).toBe("42501");
    });

    // 21
    it("ai_quota_status: board only, every kind", async () => {
      await claim(f.cyUser, "insurance_market");
      const { rows } = await asUser(db, f.cyUser, () =>
        db.query<{ kind: string; used: number; attempts: number; daily_limit: number; expected: number }>(
          `select s.*, public.ai_daily_limit(s.kind) as expected from public.ai_quota_status($1::uuid) s`,
          [f.damen],
        ),
      );
      expect(rows).toHaveLength(10);
      expect(rows.map((r) => r.kind)).toContain("coi_read");
      for (const r of rows) expect(r.daily_limit).toBe(r.expected);
      expect(rows.find((r) => r.kind === "insurance_market")).toMatchObject({ used: 1, attempts: 1 });

      const status = (user: string, assoc: string) =>
        asUser(db, user, () => db.query(`select * from public.ai_quota_status($1::uuid)`, [assoc]));
      expect((await pgError(status(f.adaUser, f.damen))).code).toBe("42501");
      expect((await pgError(status(f.zaraUser, f.damen))).code).toBe("42501");
    });
  });

  // --------------------------------------------------------------------------
  // Tickets and paths
  // --------------------------------------------------------------------------
  describe("tickets and paths", () => {
    const fn = (name: string, user: string, ticketId: string) =>
      h.sqlBool(user, `select public.${name}($1::uuid) as v`, [ticketId]);

    // 22
    it("can_see_ticket: owner sees shared and own, not a neighbour's", async () => {
      expect(await fn("can_see_ticket", f.adaUser, f.ticketCommon)).toBe(true);
      expect(await fn("can_see_ticket", f.adaUser, f.ticketUnit1)).toBe(true);
      expect(await fn("can_see_ticket", f.adaUser, f.ticketUnit2)).toBe(false);
    });

    // 23
    it("can_see_ticket: other buildings see nothing, shared areas included", async () => {
      expect(await fn("can_see_ticket", f.zaraUser, f.ticketCommon)).toBe(false);
      expect(await fn("can_see_ticket", f.zaraUser, HOYNE_SHARED)).toBe(true);
      expect(await fn("can_see_ticket", f.adaUser, HOYNE_SHARED)).toBe(false);
    });

    // 24
    it("can_see_ticket: board and active accountant see all; expired accountant none", async () => {
      for (const t of [f.ticketCommon, f.ticketUnit1, f.ticketUnit2, CLOSED_COMMON, RESOLVED_UNIT1]) {
        expect(await fn("can_see_ticket", f.cyUser, t)).toBe(true);
        expect(await fn("can_see_ticket", f.niaUser, t)).toBe(true);
        expect(await fn("can_see_ticket", f.vicUser, t)).toBe(false);
      }
    });

    // 25
    it("can_add_ticket_photo: board, owners on open own and shared tickets", async () => {
      const all = [f.ticketCommon, f.ticketUnit1, f.ticketUnit2, CLOSED_COMMON, RESOLVED_UNIT1];
      for (const t of all) {
        expect(await fn("can_add_ticket_photo", f.cyUser, t)).toBe(true);
        expect(await fn("can_add_ticket_photo", f.niaUser, t)).toBe(false);
      }
      expect(await fn("can_add_ticket_photo", f.adaUser, f.ticketCommon)).toBe(true);
      expect(await fn("can_add_ticket_photo", f.adaUser, f.ticketUnit1)).toBe(true);
      expect(await fn("can_add_ticket_photo", f.adaUser, f.ticketUnit2)).toBe(false);
      expect(await fn("can_add_ticket_photo", f.adaUser, CLOSED_COMMON)).toBe(false);
      expect(await fn("can_add_ticket_photo", f.adaUser, RESOLVED_UNIT1)).toBe(false);
      expect(await fn("can_add_ticket_photo", f.zaraUser, f.ticketCommon)).toBe(false);
      expect(await fn("can_add_ticket_photo", f.zaraUser, HOYNE_SHARED)).toBe(true);
    });

    // 26
    it("ticket_photo_permission: ok, closed, no", async () => {
      const perm = async (user: string, t: string) => {
        const { rows } = await asUser(db, user, () =>
          db.query<{ v: string }>(`select public.ticket_photo_permission($1::uuid) as v`, [t]),
        );
        return rows[0].v;
      };
      expect(await perm(f.adaUser, f.ticketCommon)).toBe("ok");
      expect(await perm(f.adaUser, CLOSED_COMMON)).toBe("closed");
      expect(await perm(f.adaUser, RESOLVED_UNIT1)).toBe("closed");
      expect(await perm(f.adaUser, f.ticketUnit2)).toBe("no");
      expect(await perm(f.niaUser, f.ticketCommon)).toBe("no");
    });

    // 27
    it("ticket_association_id: only for a visible ticket", async () => {
      const assoc = async (user: string, t: string) => {
        const { rows } = await asUser(db, user, () =>
          db.query<{ v: string | null }>(`select public.ticket_association_id($1::uuid) as v`, [t]),
        );
        return rows[0].v;
      };
      expect(await assoc(f.adaUser, f.ticketCommon)).toBe(f.damen);
      expect(await assoc(f.adaUser, f.ticketUnit2)).toBeNull();
      expect(await assoc(f.zaraUser, f.ticketCommon)).toBeNull();
    });

    // 28
    it("storage_path_kind: classifies document and photo paths, rejects junk", async () => {
      for (const c of STORAGE_PATH_CASES) {
        const { rows } = await asUser(db, f.adaUser, () =>
          db.query<{ kind: string; association_id: string; ticket_id: string | null }>(
            `select kind, association_id::text, ticket_id::text from public.storage_path_kind($1)`,
            [c.name],
          ),
        );
        if (c.expected === null) {
          expect(rows, c.name).toEqual([]);
        } else if (c.expected.kind === "document") {
          expect(rows, c.name).toEqual([{ kind: "document", association_id: c.expected.associationId, ticket_id: null }]);
        } else {
          expect(rows, c.name).toEqual([
            { kind: "ticket_photo", association_id: c.expected.associationId, ticket_id: c.expected.ticketId },
          ]);
        }
      }
      const { rows } = await db.query(`select * from public.storage_path_kind(null)`);
      expect(rows).toEqual([]);
    });

    const uploadAllowed = (user: string, path: string) =>
      h.sqlBool(user, `select public.ticket_photo_upload_allowed($1) as v`, [path]);

    // 29
    it("ticket_photo_upload_allowed: owner on open own and shared tickets only", async () => {
      expect(await uploadAllowed(f.adaUser, photoPath(f.damen, f.ticketUnit1))).toBe(true);
      expect(await uploadAllowed(f.adaUser, photoPath(f.damen, f.ticketCommon))).toBe(true);
      expect(await uploadAllowed(f.adaUser, photoPath(f.damen, f.ticketUnit2))).toBe(false);
      expect(await uploadAllowed(f.adaUser, photoPath(f.damen, CLOSED_COMMON))).toBe(false);
      expect(await uploadAllowed(f.niaUser, photoPath(f.damen, f.ticketCommon))).toBe(false);
      expect(await uploadAllowed(f.adaUser, hubPath(f.damen))).toBe(false);
    });

    // 30
    it("ticket_photo_upload_allowed: association in path must match the ticket's", async () => {
      expect(await uploadAllowed(f.cyUser, photoPath(f.hoyne, f.ticketCommon))).toBe(false);
      expect(await uploadAllowed(f.cyUser, photoPath(f.damen, f.ticketCommon))).toBe(true);
    });

    // 31
    it("ticket_photo_upload_allowed: false once the path is registered", async () => {
      const p = await h.photo(f.adaUser, f.ticketCommon);
      expect(p.linked).toBe(true);
      expect(await uploadAllowed(f.adaUser, p.path)).toBe(false);
    });

    // 32
    it("pending_upload_allowed: hub paths for the board, own open photo paths, never once registered", async () => {
      const pending = (user: string, path: string) =>
        h.sqlBool(user, `select public.pending_upload_allowed($1) as v`, [path]);
      const hub = hubPath(f.damen);
      expect(await pending(f.cyUser, hub)).toBe(true);
      expect(await pending(f.adaUser, hub)).toBe(false);
      expect(await pending(f.niaUser, hub)).toBe(false);
      expect(await pending(f.zaraUser, hub)).toBe(false);

      const photo = photoPath(f.damen, f.ticketUnit1);
      expect(await pending(f.adaUser, photo)).toBe(true);
      expect(await pending(f.boUser, photo)).toBe(false);
      expect(await pending(f.niaUser, photo)).toBe(false);

      await h.seedDoc(f.damen, { storagePath: hub });
      expect(await pending(f.cyUser, hub)).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // attach_ticket_photo (no storage schema: the storage check is skipped)
  // --------------------------------------------------------------------------
  describe("attach_ticket_photo", () => {
    const docRow = async (id: string) => {
      const { rows } = await db.query<Record<string, unknown>>(
        `select d.*, c.slug as category_slug
           from public.documents d left join public.document_categories c on c.id = d.category_id
          where d.id = $1::uuid`,
        [id],
      );
      return rows[0];
    };
    const docsAt = async (path: string) => {
      const { rows } = await db.query<{ n: number }>(
        `select count(*)::int as n from public.documents where storage_path = $1`,
        [path],
      );
      return rows[0].n;
    };

    // 33
    it("files an owner's unit photo for that unit only", async () => {
      const p = await h.photo(f.adaUser, f.ticketUnit1);
      expect(p).toMatchObject({ duplicate: false, storage_path: p.path, linked: true, narrower_audience: false });
      expect(p.document_id).toBeTruthy();
      const d = await docRow(p.document_id!);
      expect(d).toMatchObject({
        category_slug: "maintenance",
        restricted_to_unit_id: f.unit1,
        visibility: "board_only",
        extraction_state: "skipped",
        uploaded_by: f.adaUser,
        tag_source: "manual",
        mime_type: "image/jpeg",
      });
      const { rows: links } = await db.query(
        `select target_table, target_id, relation from public.document_links where document_id = $1::uuid`,
        [p.document_id],
      );
      expect(links).toEqual([{ target_table: "tickets", target_id: f.ticketUnit1, relation: "photo" }]);
      expect(await h.canSelectDoc(f.adaUser, p.document_id!)).toBe(true);
      expect(await h.canSelectDoc(f.cyUser, p.document_id!)).toBe(true);
      expect(await h.canSelectDoc(f.boUser, p.document_id!)).toBe(false);
    });

    // 34
    it("shared-area photos are visible to every owner", async () => {
      const p = await h.photo(f.adaUser, f.ticketCommon);
      const d = await docRow(p.document_id!);
      expect(d).toMatchObject({ visibility: "all_owners", restricted_to_unit_id: null });
      expect(await h.canSelectDoc(f.boUser, p.document_id!)).toBe(true);
      expect(await h.canSelectDoc(f.zaraUser, p.document_id!)).toBe(false);
    });

    // 35
    it("refuses a neighbour's ticket, another building, an accountant", async () => {
      for (const [user, ticket] of [
        [f.adaUser, f.ticketUnit2],
        [f.zaraUser, f.ticketCommon],
        [f.niaUser, f.ticketCommon],
      ] as const) {
        const path = photoPath(f.damen, ticket);
        const err = await pgError(h.photo(user, ticket, { path }));
        expect(err.code).toBe("42501");
        expect(await docsAt(path)).toBe(0);
      }
      // A ticket that doesn't exist gets the same answer.
      const ghost = "7c000000-0000-0000-0000-0000000000ff";
      expect((await pgError(h.photo(f.cyUser, ghost, { path: photoPath(f.damen, ghost) }))).code).toBe("42501");
    });

    // 36
    it("owners can't add to a closed problem; the board can", async () => {
      const err = await pgError(h.photo(f.adaUser, CLOSED_COMMON));
      expect(err).toMatchObject({ code: "42501", hint: "ticket_closed" });
      const p = await h.photo(f.cyUser, CLOSED_COMMON);
      expect(p.linked).toBe(true);
    });

    // 37
    it("refuses a path for another ticket", async () => {
      const err = await pgError(h.photo(f.adaUser, f.ticketCommon, { path: photoPath(f.damen, f.ticketUnit1) }));
      expect(err.code).toBe("22023");
      const hub = await pgError(h.photo(f.adaUser, f.ticketCommon, { path: hubPath(f.damen) }));
      expect(hub.code).toBe("22023");
    });

    // 38
    it("refuses non-photo types and oversize files", async () => {
      expect((await pgError(h.photo(f.adaUser, f.ticketCommon, { mime: "application/pdf" }))).code).toBe("22023");
      expect((await pgError(h.photo(f.adaUser, f.ticketCommon, { size: 15728641 }))).code).toBe("22023");
      expect((await pgError(h.photo(f.adaUser, f.ticketCommon, { checksum: "nope" }))).code).toBe("22023");
      // Exactly 15 MB is fine.
      expect((await h.photo(f.adaUser, f.ticketCommon, { size: 15728640 })).linked).toBe(true);
    });

    // 39
    it("same bytes twice on one problem link once", async () => {
      const first = await h.photo(f.adaUser, f.ticketCommon);
      const second = await h.photo(f.adaUser, f.ticketCommon, { checksum: first.checksum });
      expect(second).toMatchObject({
        document_id: first.document_id,
        duplicate: true,
        storage_path: first.path,
        linked: true,
        narrower_audience: false,
      });
      expect(await h.linkCount(first.document_id!)).toBe(1);
      expect(await docsAt(second.path)).toBe(0);
    });

    // 40
    it("re-registering the same path is idempotent for the uploader only", async () => {
      const first = await h.photo(f.adaUser, f.ticketCommon);
      const again = await h.photo(f.adaUser, f.ticketCommon, { path: first.path, checksum: first.checksum });
      expect(again).toMatchObject({
        document_id: first.document_id,
        duplicate: false,
        storage_path: first.path,
        linked: true,
      });
      expect(await h.linkCount(first.document_id!)).toBe(1);
      const err = await pgError(h.photo(f.boUser, f.ticketCommon, { path: first.path, checksum: first.checksum }));
      expect(err.code).toBe("22023");
    });

    // 41
    it("same bytes on another shared problem with the same audience link the existing photo", async () => {
      await db.exec(`
        insert into tickets (id, association_id, title, status, priority, unit_id, opened_on)
        values ('${SECOND_COMMON}', '${f.damen}', 'Basement light out', 'open', 'normal', null, '2026-03-02')
        on conflict (id) do nothing`);
      const ada = await h.photo(f.adaUser, f.ticketCommon);
      const bo = await h.photo(f.boUser, SECOND_COMMON, { checksum: ada.checksum });
      expect(bo).toMatchObject({
        document_id: ada.document_id,
        duplicate: true,
        storage_path: ada.path,
        linked: true,
        narrower_audience: false,
      });
      expect(await h.canSelectDoc(f.boUser, ada.document_id!)).toBe(true);
      expect(await h.linkCount(ada.document_id!)).toBe(2);
    });

    // 42
    it("same bytes as a neighbour's unit photo reveal nothing and link nothing", async () => {
      const ada = await h.photo(f.adaUser, f.ticketUnit1);
      const bo = await h.photo(f.boUser, f.ticketUnit2, { checksum: ada.checksum });
      expect(bo).toMatchObject({
        document_id: null,
        duplicate: true,
        storage_path: null,
        linked: false,
        narrower_audience: false,
      });
      expect(await h.linkCount(ada.document_id!)).toBe(1);
      expect(await h.canSelectDoc(f.boUser, ada.document_id!)).toBe(false);
    });

    // foundation-spec 17, Repairs (e)
    it("same bytes with a narrower audience say so to a caller who can see them, and nobody else", async () => {
      // Ada's own unit photo re-used on the shared-area problem.
      const ada = await h.photo(f.adaUser, f.ticketUnit1);
      const shared = await h.photo(f.adaUser, f.ticketCommon, { checksum: ada.checksum });
      expect(shared).toMatchObject({
        document_id: null,
        duplicate: true,
        storage_path: null,
        linked: false,
        narrower_audience: true,
      });
      expect(await h.linkCount(ada.document_id!)).toBe(1);

      // Bo can't see Ada's unit photo, so he learns nothing about its audience.
      const bo = await h.photo(f.boUser, f.ticketCommon, { checksum: ada.checksum });
      expect(bo).toMatchObject({ document_id: null, linked: false, narrower_audience: false });

      // A board-only hub document re-used on a unit problem by the board.
      const checksum = freshChecksum();
      await h.seedDoc(f.damen, { checksum, visibility: "board_only" });
      const cy = await h.photo(f.cyUser, f.ticketUnit1, { checksum });
      expect(cy).toMatchObject({ document_id: null, linked: false, narrower_audience: true });
    });

    // 43
    it("same bytes as a board-only hub document reveal nothing", async () => {
      const checksum = freshChecksum();
      const docId = await h.seedDoc(f.damen, { checksum, visibility: "board_only" });
      const ada = await h.photo(f.adaUser, f.ticketCommon, { checksum });
      expect(ada).toMatchObject({
        document_id: null,
        duplicate: true,
        storage_path: null,
        linked: false,
        narrower_audience: false,
      });
      expect(await h.linkCount(docId)).toBe(0);
    });

    // 44
    it("stops at 20 live photos; binned ones don't count", async () => {
      const ticket = "7c000000-0000-0000-0000-000000000044";
      await db.exec(`
        insert into tickets (id, association_id, title, status, priority, unit_id, opened_on)
        values ('${ticket}', '${f.damen}', 'Storm damage, rear fence', 'open', 'normal', null, '2026-03-03')`);
      const ids: string[] = [];
      for (let i = 0; i < 20; i++) ids.push((await h.photo(f.adaUser, ticket)).document_id!);
      const err = await pgError(h.photo(f.adaUser, ticket));
      expect(err).toMatchObject({ code: "P0001", hint: "photo_limit" });
      await db.query(`update public.documents set deleted_at = now() where id = $1::uuid`, [ids[0]]);
      expect((await h.photo(f.adaUser, ticket)).linked).toBe(true);
    });

    // 45
    it("writes audit rows as the caller", async () => {
      const p = await h.photo(f.adaUser, f.ticketCommon);
      const { rows: link } = await db.query<{ id: string }>(
        `select id from public.document_links where document_id = $1::uuid`,
        [p.document_id],
      );
      const { rows } = await db.query<{ table_name: string; actor_user_id: string; action: string }>(
        `select table_name, actor_user_id, action from public.audit_log
          where record_id in ($1::uuid, $2::uuid) order by table_name`,
        [p.document_id, link[0].id],
      );
      expect(rows).toEqual([
        { table_name: "document_links", actor_user_id: f.adaUser, action: "insert" },
        { table_name: "documents", actor_user_id: f.adaUser, action: "insert" },
      ]);
    });
  });

  // --------------------------------------------------------------------------
  // remove_ticket_photo and ticket_photos
  // --------------------------------------------------------------------------
  describe("remove_ticket_photo and ticket_photos", () => {
    const remove = (user: string, ticket: string, docId: string) =>
      asUser(db, user, () =>
        db.query(`select public.remove_ticket_photo($1::uuid, $2::uuid)`, [ticket, docId]),
      );

    type PhotoRow = {
      document_id: string;
      link_id: string;
      added_by_kind: string;
      added_by_name: string | null;
      can_remove: boolean;
      storage_path: string;
    };
    const photos = async (user: string, ticket: string) => {
      const { rows } = await asUser(db, user, () =>
        db.query<PhotoRow>(`select * from public.ticket_photos($1::uuid)`, [ticket]),
      );
      return rows;
    };
    const deletedAt = async (docId: string) => {
      const { rows } = await db.query<{ deleted_at: string | null }>(
        `select deleted_at from public.documents where id = $1::uuid`,
        [docId],
      );
      return rows[0].deleted_at;
    };
    const newShared = async (id: string, title: string) => {
      await db.exec(`
        insert into tickets (id, association_id, title, status, priority, unit_id, opened_on)
        values ('${id}', '${f.damen}', '${title}', 'open', 'normal', null, '2026-04-01')
        on conflict (id) do nothing`);
      return id;
    };

    // 51
    it("remove_ticket_photo: the uploader while open, never a neighbour", async () => {
      const mine = await h.photo(f.adaUser, f.ticketUnit1);
      await remove(f.adaUser, f.ticketUnit1, mine.document_id!);
      expect(await h.linkCount(mine.document_id!)).toBe(0);
      expect(await deletedAt(mine.document_id!)).not.toBeNull();

      const shared = await h.photo(f.adaUser, f.ticketCommon);
      expect((await pgError(remove(f.boUser, f.ticketCommon, shared.document_id!))).code).toBe("42501");
      expect(await h.linkCount(shared.document_id!)).toBe(1);
      // Wrong ticket for the document: same refusal.
      expect((await pgError(remove(f.adaUser, f.ticketUnit1, shared.document_id!))).code).toBe("42501");
    });

    // 52
    it("remove_ticket_photo: not once the problem is closed, except the board", async () => {
      const p = await h.photo(f.cyUser, CLOSED_COMMON);
      await db.query(`update public.documents set uploaded_by = $1::uuid where id = $2::uuid`, [
        f.adaUser,
        p.document_id,
      ]);
      expect((await pgError(remove(f.adaUser, CLOSED_COMMON, p.document_id!))).code).toBe("42501");
      await remove(f.cyUser, CLOSED_COMMON, p.document_id!);
      expect(await h.linkCount(p.document_id!)).toBe(0);
    });

    // 53
    it("remove_ticket_photo: a document linked to two problems stays live when one link goes", async () => {
      await newShared(SECOND_COMMON, "Basement light out");
      const ada = await h.photo(f.adaUser, f.ticketCommon);
      const bo = await h.photo(f.boUser, SECOND_COMMON, { checksum: ada.checksum });
      expect(bo.document_id).toBe(ada.document_id);
      expect((await pgError(remove(f.boUser, SECOND_COMMON, ada.document_id!))).code).toBe("42501");
      await remove(f.cyUser, SECOND_COMMON, ada.document_id!);
      expect(await h.linkCount(ada.document_id!)).toBe(1);
      expect(await deletedAt(ada.document_id!)).toBeNull();
    });

    // 54
    it("ticket_photos: owners see their own and shared photos", async () => {
      const unit = await h.photo(f.adaUser, f.ticketUnit1);
      const shared = await h.photo(f.adaUser, f.ticketCommon);
      expect((await photos(f.adaUser, f.ticketUnit1)).map((r) => r.document_id)).toContain(unit.document_id);
      expect((await photos(f.adaUser, f.ticketCommon)).map((r) => r.document_id)).toContain(shared.document_id);
      expect((await photos(f.boUser, f.ticketCommon)).map((r) => r.document_id)).toContain(shared.document_id);
      expect(await photos(f.boUser, f.ticketUnit1)).toEqual([]);
    });

    // 55
    it("ticket_photos: other buildings get nothing", async () => {
      await h.photo(f.adaUser, f.ticketCommon);
      expect(await photos(f.zaraUser, f.ticketCommon)).toEqual([]);
    });

    // 56
    it("ticket_photos: names only for board and accountant", async () => {
      const ada = await h.photo(f.adaUser, f.ticketCommon);
      const cy = await h.photo(f.cyUser, f.ticketCommon);
      const pick = async (user: string, docId: string) =>
        (await photos(user, f.ticketCommon)).find((r) => r.document_id === docId);

      for (const user of [f.cyUser, f.niaUser]) {
        expect(await pick(user, ada.document_id!)).toMatchObject({
          added_by_kind: "owner",
          added_by_name: "Ada Okonkwo",
        });
      }
      expect(await pick(f.boUser, ada.document_id!)).toMatchObject({ added_by_kind: "owner", added_by_name: null });
      expect(await pick(f.adaUser, ada.document_id!)).toMatchObject({ added_by_kind: "you", added_by_name: null });
      expect(await pick(f.boUser, cy.document_id!)).toMatchObject({ added_by_kind: "board", added_by_name: null });
    });

    // 57
    it("ticket_photos: can_remove follows the rule", async () => {
      const ticket = await newShared("7c000000-0000-0000-0000-000000000057", "Hallway carpet torn");
      const ada = await h.photo(f.adaUser, ticket);
      const cy = await h.photo(f.cyUser, ticket);
      const canRemove = async (user: string, docId: string) =>
        (await photos(user, ticket)).find((r) => r.document_id === docId)?.can_remove;

      expect(await canRemove(f.adaUser, ada.document_id!)).toBe(true);
      expect(await canRemove(f.adaUser, cy.document_id!)).toBe(false);
      expect(await canRemove(f.cyUser, ada.document_id!)).toBe(true);
      expect(await canRemove(f.cyUser, cy.document_id!)).toBe(true);

      await db.query(`update public.tickets set status = 'closed', resolved_at = now() where id = $1::uuid`, [ticket]);
      expect(await canRemove(f.adaUser, ada.document_id!)).toBe(false);
      expect(await canRemove(f.cyUser, ada.document_id!)).toBe(true);
    });

    // 58
    it("ticket_photos: binned photos disappear", async () => {
      const ticket = await newShared("7c000000-0000-0000-0000-000000000058", "Mailbox lock stuck");
      const p = await h.photo(f.adaUser, ticket);
      expect(await photos(f.adaUser, ticket)).toHaveLength(1);
      await db.query(`update public.documents set deleted_at = now() where id = $1::uuid`, [p.document_id]);
      expect(await photos(f.adaUser, ticket)).toEqual([]);
      expect(await photos(f.boUser, ticket)).toEqual([]);
      expect(await photos(f.cyUser, ticket)).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // document_links guard
  // --------------------------------------------------------------------------
  describe("document_links guard", () => {
    const link = (user: string, assoc: string, docId: string, targetTable: string, targetId: string, relation = "source") =>
      asUser(db, user, () =>
        db.query<{ id: string }>(
          `insert into public.document_links (association_id, document_id, target_table, target_id, relation)
           values ($1::uuid, $2::uuid, $3, $4::uuid, $5) returning id`,
          [assoc, docId, targetTable, targetId, relation],
        ),
      );

    // 59
    it("refuses a link to another association's document", async () => {
      const hoyneDoc = await h.seedDoc(f.hoyne);
      expect((await pgError(link(f.cyUser, f.damen, hoyneDoc, "tickets", f.ticketCommon, "photo"))).code).toBe(
        "42501",
      );

      const damenDoc = await h.seedDoc(f.damen);
      const { rows } = await link(f.cyUser, f.damen, damenDoc, "associations", f.damen);
      const err = await pgError(
        asUser(db, f.cyUser, () =>
          db.query(`update public.document_links set document_id = $1::uuid where id = $2::uuid`, [
            hoyneDoc,
            rows[0].id,
          ]),
        ),
      );
      expect(err.code).toBe("42501");
    });

    // 60
    it("same-association links still work", async () => {
      const damenDoc = await h.seedDoc(f.damen);
      const { rows } = await link(f.cyUser, f.damen, damenDoc, "tickets", f.ticketCommon, "photo");
      expect(rows).toHaveLength(1);
    });
  });
});

// ----------------------------------------------------------------------------
// attach_ticket_photo with a storage stub
// ----------------------------------------------------------------------------
describe("ai and uploads (0051) with a storage.objects stub", () => {
  let db: PGlite;
  let f: Fixture;
  const h = setupHelpers(
    () => db,
    () => f,
  );

  const putObject = (
    name: string,
    ownerId: string,
    metadata: Record<string, unknown> = { size: 1000, mimetype: "image/jpeg" },
    createdAt = "now()",
  ) =>
    db.query(
      `insert into storage.objects (bucket_id, name, owner_id, metadata, created_at)
       values ('documents', $1, $2, $3::jsonb, ${createdAt})`,
      [name, ownerId, JSON.stringify(metadata)],
    );

  beforeAll(async () => {
    db = await freshDb();
    f = await seed(db);
    await addStorageStub(db);
  });

  afterEach(async () => {
    await db.exec(`delete from storage.objects`);
  });

  // 46
  it("attach_ticket_photo: refuses when nothing was uploaded at that path", async () => {
    const err = await pgError(h.photo(f.adaUser, f.ticketCommon));
    expect(err).toMatchObject({ code: "22023", hint: "not_uploaded" });
  });

  // 47
  it("attach_ticket_photo: refuses an object uploaded by someone else", async () => {
    const path = photoPath(f.damen, f.ticketCommon);
    await putObject(path, f.boUser);
    const err = await pgError(h.photo(f.adaUser, f.ticketCommon, { path }));
    expect(err).toMatchObject({ code: "22023", hint: "not_uploaded" });
  });

  // 48
  it("attach_ticket_photo: refuses a size or type that differs from the stored object", async () => {
    const lying = photoPath(f.damen, f.ticketCommon);
    await putObject(lying, f.adaUser, { size: 2000, mimetype: "application/pdf" });
    const err = await pgError(h.photo(f.adaUser, f.ticketCommon, { path: lying }));
    expect(err).toMatchObject({ code: "22023", hint: "not_uploaded" });

    const honest = photoPath(f.damen, f.ticketCommon);
    await putObject(honest, f.adaUser, { size: 1000, mimetype: "image/jpeg; charset=binary" });
    const ok = await h.photo(f.adaUser, f.ticketCommon, { path: honest });
    expect(ok).toMatchObject({ duplicate: false, storage_path: honest, linked: true });
  });

  // 49
  it("ticket_photo_pending_count: counts my unregistered photo objects in this building only", async () => {
    const registered = photoPath(f.damen, f.ticketUnit1);
    await putObject(photoPath(f.damen, f.ticketCommon), f.adaUser);
    await putObject(photoPath(f.damen, f.ticketUnit1), f.adaUser);
    await putObject(registered, f.adaUser);
    await h.seedDoc(f.damen, { storagePath: registered });
    await putObject(photoPath(f.damen, f.ticketCommon), f.boUser);
    await putObject(`${f.hoyne}/tickets/7c000000-0000-0000-0000-000000000101/${nextTs()}-abc123-p.jpg`, f.adaUser);
    // A hub document upload is not a photo upload.
    await putObject(hubPath(f.damen), f.adaUser);

    const { rows } = await asUser(db, f.adaUser, () =>
      db.query<{ n: number }>(`select public.ticket_photo_pending_count($1::uuid) as n`, [f.damen]),
    );
    expect(rows[0].n).toBe(2);
  });

  // 50
  it("ticket_photo_upload_allowed: stops at 30 unregistered photo uploads a day", async () => {
    for (let i = 0; i < 30; i++) await putObject(photoPath(f.damen, f.ticketCommon), f.adaUser);
    const allowed = () =>
      h.sqlBool(f.adaUser, `select public.ticket_photo_upload_allowed($1) as v`, [photoPath(f.damen, f.ticketCommon)]);
    expect(await allowed()).toBe(false);
    await db.exec(`update storage.objects set created_at = now() - interval '2 days'`);
    expect(await allowed()).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// The migration path (harness `before` / `applyMigrations`, repairs-spec 17.1)
// ----------------------------------------------------------------------------
describe("0051 applied on top of existing data", () => {
  it("applies after seeded rows and existing document links, and adds what it should", async () => {
    const db = await freshDb({ before: "0051" });
    const f = await seed(db);
    const exists = async () => {
      const { rows } = await db.query<{ t: string | null }>(`select to_regclass('public.ai_calls')::text as t`);
      return rows[0].t;
    };
    expect(await exists()).toBeNull();

    // A legacy hub document with a link, as the hub writes them today.
    await db.exec(`
      insert into public.documents (id, association_id, storage_path, filename)
      values ('d0c00000-0000-0000-0000-000000000001', '${f.damen}', '${f.damen}/legacy-minutes.pdf', 'minutes.pdf');
      insert into public.document_links (association_id, document_id, target_table, target_id, relation)
      values ('${f.damen}', 'd0c00000-0000-0000-0000-000000000001', 'tickets', '${f.ticketCommon}', 'source');
    `);

    await applyMigrations(db, { from: "0051" });
    expect(await exists()).toBe("ai_calls");
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from public.document_links`);
    expect(rows[0].n).toBe(1);
    await db.close();
  });
});
