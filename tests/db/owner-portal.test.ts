import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed } from "./fixtures";
import { pgError, queries, seededDb, zaraBoard, boBoard } from "./repairs-helpers";
import type { Fixture } from "./fixtures";

/**
 * Migration 0054, the owner portal (owner-portal-spec section 10.1). Numbering
 * in the test names follows the spec's test plan.
 */

const MIGRATION = path.resolve(import.meta.dirname, "../../supabase/migrations/0054_owner_portal.sql");

const CASH = "acc00000-0000-0000-0000-000000001000";
const AR = "acc00000-0000-0000-0000-000000001200";
const OPERATING = "ffff0000-0000-0000-0000-000000000001";
const FY_2026 = "f1500000-0000-0000-0000-000000000001";

const FEB_CHARGE = "cccc0000-0000-0000-0000-0000000000f2";
const LATE_FEE = "cccc0000-0000-0000-0000-0000000000f3";
const DEE_USER = "dddd0000-0000-0000-0000-0000000000a1";
const GUS_USER = "dddd0000-0000-0000-0000-0000000000a2";
const NOLOGIN_PERSON = "eeee0000-0000-0000-0000-0000000000b1";
const FORMER_PERSON = "eeee0000-0000-0000-0000-0000000000b2";

let db: PGlite;
let f: Fixture;
const h = queries(() => db);
const { q, one, rows, count } = h;

afterEach(async () => {
  await db?.close();
});

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

/** Bo (unit 2): Jan 750 (fixture), Feb 750, a 25 late fee; 1,000 paid, 750 applied to January; the late fee waived. */
async function boLedger() {
  await db.query(
    `insert into public.assessment_charges (id, association_id, unit_id, charge_type, period_start, due_on, amount) values
       ($1::uuid, $3::uuid, $4::uuid, 'assessment', '2026-02-01', '2026-02-01', 750.00),
       ($2::uuid, $3::uuid, $4::uuid, 'late_fee',   '2026-02-01', '2026-02-15', 25.00)`,
    [FEB_CHARGE, LATE_FEE, f.damen, f.unit2],
  );
  await q(
    f.cyUser,
    `select public.record_payment($1::uuid, $2::uuid, $3::uuid, '2026-03-01'::date, 1000, $4::uuid, $5::uuid, $6::uuid,
        'check', 'chk-100', jsonb_build_array(jsonb_build_object('charge_id', $7::text, 'amount', 750)))`,
    [f.damen, f.unit2, FY_2026, OPERATING, CASH, AR, f.boCharge],
  );
  await db.query(`update public.assessment_charges set waived_at = '2026-03-05T12:00:00Z' where id = $1::uuid`, [LATE_FEE]);
}

type Summary = {
  unit_id: string; unit_label: string; owed: string; overdue: string; credit: string; net: string; open_charges: number;
  oldest_overdue_on: string | null; next_due_on: string | null; next_due_amount: string | null;
  last_payment_on: string | null; last_payment_amount: string | null;
};
type Line = {
  seq: number; line_date: string | null; kind: string; description: string; charge: string | null;
  payment: string | null; adjustment: string | null; balance: string; charge_id: string | null; payment_id: string | null;
};

const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v);
const normalise = <T extends object>(r: T[]): T[] =>
  r.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, iso(v)])) as T);
const summary = (user: string | null, unit: string, asOf: string | null = null, opts?: { aal?: "aal1" | "aal2" }) =>
  (opts
    ? asUser(db, user!, () => db.query<Summary>(`select * from public.unit_statement_summary($1::uuid, coalesce($2::date, current_date))`, [unit, asOf]), opts).then((r) => r.rows)
    : rows<Summary>(user, `select * from public.unit_statement_summary($1::uuid, coalesce($2::date, current_date))`, [unit, asOf])
  ).then(normalise);
const statement = (user: string | null, unit: string, from: string | null = null, to: string | null = null) =>
  rows<Line>(user, `select * from public.unit_statement($1::uuid, $2::date, $3::date) order by seq`, [unit, from, to]).then(normalise);

describe("statements", () => {
  beforeEach(async () => {
    ({ db, f } = await seededDb());
    await boLedger();
  });

  it("1. Ada reads her own summary", async () => {
    const [s] = await summary(f.adaUser, f.unit1);
    expect(s).toMatchObject({ unit_label: "Unit 1", owed: "500.00", overdue: "500.00", credit: "0.00", net: "500.00", open_charges: 1 });
  });

  it("2. Ada gets zero rows for Bo's unit from both functions", async () => {
    expect(await summary(f.adaUser, f.unit2)).toEqual([]);
    expect(await statement(f.adaUser, f.unit2)).toEqual([]);
  });

  it("3. Neither Ada nor Zara can read across associations", async () => {
    expect(await summary(f.adaUser, f.hoyneUnit)).toEqual([]);
    expect(await statement(f.adaUser, f.hoyneUnit)).toEqual([]);
    expect(await summary(f.zaraUser, f.unit1)).toEqual([]);
    expect(await statement(f.zaraUser, f.unit2)).toEqual([]);
    // Zara still reads her own (empty) unit: a row of zeros, not a miss.
    const [own] = await summary(f.zaraUser, f.hoyneUnit);
    expect(own).toMatchObject({ owed: "0.00", net: "0.00", open_charges: 0 });
  });

  it("4. The board admin and a live accountant read any unit; an expired accountant reads none", async () => {
    expect(await summary(f.cyUser, f.unit2)).toHaveLength(1);
    expect(await statement(f.cyUser, f.unit1)).toHaveLength(1);
    expect(await summary(f.niaUser, f.unit2)).toHaveLength(1);
    expect(await statement(f.niaUser, f.unit2)).not.toHaveLength(0);
    expect(await summary(f.vicUser, f.unit1)).toEqual([]);
    expect(await statement(f.vicUser, f.unit1)).toEqual([]);
  });

  it("5. A password-only (aal1) session gets nothing, even for her own unit", async () => {
    expect(await summary(f.adaUser, f.unit1, null, { aal: "aal1" })).toEqual([]);
    expect(await summary(f.adaUser, f.unit1, null, { aal: "aal2" })).toHaveLength(1);
  });

  it("6. anon cannot execute either function", async () => {
    for (const fn of ["unit_statement_summary(uuid, date)", "unit_statement(uuid, date, date)"]) {
      const { rows: r } = await db.query<{ ok: boolean }>(`select has_function_privilege('anon', 'public.${fn}', 'execute') as ok`);
      expect(r[0].ok).toBe(false);
    }
    await db.exec("set role anon");
    try {
      await expect(db.query(`select * from public.unit_statement_summary('${f.unit1}'::uuid)`)).rejects.toThrow(/permission denied/i);
    } finally {
      await db.exec("reset role");
    }
  });

  it("7. authenticated cannot execute the internal core functions", async () => {
    await expect(q(f.cyUser, `select * from public.unit_position_core($1::uuid)`, [f.unit1])).rejects.toThrow(/permission denied/i);
    await expect(q(f.cyUser, `select * from public.unit_statement_core($1::uuid)`, [f.unit1])).rejects.toThrow(/permission denied/i);
  });

  it("8. the running balance ties to owed minus unapplied credit", async () => {
    const [s] = await summary(f.boUser, f.unit2);
    expect(s).toMatchObject({ owed: "750.00", credit: "250.00", net: "500.00" });
    const lines = await statement(f.boUser, f.unit2);
    expect(lines.at(-1)!.balance).toBe("500.00");
    expect(lines.map((l) => l.kind)).toEqual(["charge", "charge", "charge", "payment", "waiver"]);
    expect(lines.map((l) => l.balance)).toEqual(["750.00", "1500.00", "1525.00", "525.00", "500.00"]);
    const gap = await one<{ balance_owed: string }>(f.cyUser, `select balance_owed::text from public.unit_balances where unit_id = $1::uuid`, [f.unit2]);
    expect(gap.balance_owed).toBe("750.00");
    expect(Number(gap.balance_owed) - Number(s.credit)).toBe(Number(lines.at(-1)!.balance));
    expect(lines.find((l) => l.kind === "waiver")).toMatchObject({ adjustment: "25.00", description: "Charge waived: late fee" });
    expect(lines[0].description).toBe("Dues for January 2026");
    expect(lines.find((l) => l.kind === "payment")!.description).toBe("Payment received by check (chk-100)");
  });

  it("9. with p_from the first line is the opening balance at seq 0", async () => {
    const lines = await statement(f.boUser, f.unit2, "2026-02-01");
    expect(lines[0]).toMatchObject({ seq: 0, kind: "opening", balance: "750.00", description: "Balance before this statement" });
    expect(lines[1].kind).toBe("charge");
    expect(lines.at(-1)!.balance).toBe("500.00");
  });

  it("10. p_to before the payment leaves out the payment and the waiver", async () => {
    const lines = await statement(f.boUser, f.unit2, null, "2026-02-28");
    expect(lines.map((l) => l.kind)).toEqual(["charge", "charge", "charge"]);
    expect(lines.at(-1)!.balance).toBe("1525.00");
  });

  it("11. a written-off charge is an adjustment of the unpaid remainder and the totals still tie", async () => {
    await db.query(
      `insert into public.assessment_charges (association_id, unit_id, charge_type, period_start, due_on, amount, written_off_at)
       values ($1::uuid, $2::uuid, 'special_assessment', '2026-04-01', '2026-04-01', 100.00, '2026-05-01T12:00:00Z')`,
      [f.damen, f.unit3],
    );
    const lines = await statement(f.cyUser, f.unit3);
    expect(lines.map((l) => l.kind)).toEqual(["charge", "write_off"]);
    expect(lines[0].description).toBe("Special assessment");
    expect(lines[1]).toMatchObject({ adjustment: "100.00", description: "Charge written off: special assessment", balance: "0.00" });
    const [s] = await summary(f.cyUser, f.unit3);
    expect(s).toMatchObject({ owed: "0.00", net: "0.00", open_charges: 0 });
  });

  it("12. next due and last payment", async () => {
    const early = (await summary(f.boUser, f.unit2, "2026-01-15"))[0];
    expect(early).toMatchObject({ next_due_on: "2026-02-01", next_due_amount: "750.00", overdue: "0.00", last_payment_on: "2026-03-01", last_payment_amount: "1000.00" });
    const late = (await summary(f.boUser, f.unit2, "2026-12-31"))[0];
    expect(late.next_due_on).toBeNull();
    expect(late.next_due_amount).toBeNull();
    expect(late).toMatchObject({ overdue: "750.00", oldest_overdue_on: "2026-02-01" });
    const none = (await summary(f.zaraUser, f.hoyneUnit))[0];
    expect(none.last_payment_on).toBeNull();
    expect(none.last_payment_amount).toBeNull();
  });

  it("13. money is text with two decimals, never '0'", async () => {
    const [s] = await summary(f.zaraUser, f.hoyneUnit);
    for (const k of ["owed", "overdue", "credit", "net"] as const) expect(s[k]).toBe("0.00");
    for (const l of await statement(f.boUser, f.unit2)) {
      expect(typeof l.balance).toBe("string");
      expect(l.balance).toMatch(/^-?\d+\.\d{2}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

interface SaveOpts {
  id?: string | null; title?: string; body?: string; audience?: "all" | "units"; units?: string[];
  pinned?: boolean; doc?: string | null; expires?: string | null; publish?: boolean; assoc?: string;
}
const save = (user: string | null, o: SaveOpts = {}) =>
  one<{ id: string }>(
    user,
    `select public.save_announcement($1::uuid, $2::uuid, $3, $4, $5, $6::uuid[], $7::boolean, $8::uuid, $9::date, $10::boolean) as id`,
    [o.assoc ?? f.damen, o.id ?? null, o.title ?? "Water off Tuesday", o.body ?? "The water will be off from 9 to 11.", o.audience ?? "all",
      o.units ?? [], o.pinned ?? false, o.doc ?? null, o.expires ?? null, o.publish ?? true],
  ).then((r) => r.id);
const visible = (user: string, extra = "") => rows<{ id: string }>(user, `select id from public.announcements ${extra} order by created_at`);
const doc = async (assoc: string, o: { visibility?: string; unit?: string | null; deleted?: boolean; name?: string } = {}) =>
  (await one<{ id: string }>(
    null,
    `insert into public.documents (association_id, storage_path, filename, visibility, restricted_to_unit_id, deleted_at)
     values ($1::uuid, $2, $3, $4, $5::uuid, $6) returning id`,
    [assoc, `${assoc}/${o.name ?? crypto.randomUUID()}.pdf`, `${o.name ?? "file"}.pdf`, o.visibility ?? "board_only", o.unit ?? null, o.deleted ? new Date().toISOString() : null],
  )).id;

describe("announcements", () => {
  beforeEach(async () => {
    ({ db, f } = await seededDb());
  });

  it("14. the board posts; an owner and a foreign owner cannot", async () => {
    const id = await save(f.cyUser);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await pgError(save(f.adaUser))).code).toBe("42501");
    expect((await pgError(save(f.zaraUser))).code).toBe("42501");
    // Zara as the Hoyne board still cannot post to Damen, nor to a Damen unit.
    await zaraBoard(db, f);
    expect((await pgError(save(f.zaraUser, { assoc: f.damen }))).code).toBe("42501");
    expect((await pgError(save(f.zaraUser, { assoc: f.hoyne, audience: "units", units: [f.unit1] }))).code).toBe("42501");
    expect(await save(f.zaraUser, { assoc: f.hoyne })).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("15. an owner cannot write any of the three tables", async () => {
    const id = await save(f.cyUser, { audience: "units", units: [f.unit1] });
    await q(f.adaUser, `select public.mark_announcement_read($1::uuid)`, [id]);
    const insA = q(f.adaUser, `insert into public.announcements (association_id, title, body, status, published_at) values ($1::uuid, 'x', 'y', 'published', now())`, [f.damen]);
    expect((await pgError(insA)).message).toMatch(/row-level security/i);
    const insU = q(f.adaUser, `insert into public.announcement_units (association_id, announcement_id, unit_id) values ($1::uuid, $2::uuid, $3::uuid)`, [f.damen, id, f.unit2]);
    expect((await pgError(insU)).message).toMatch(/row-level security/i);
    const insR = q(f.adaUser, `insert into public.announcement_reads (association_id, announcement_id, person_id) values ($1::uuid, $2::uuid, $3::uuid)`, [f.damen, id, f.adaPerson]);
    expect((await pgError(insR)).message).toMatch(/row-level security/i);
    for (const t of ["announcements", "announcement_units", "announcement_reads"]) {
      expect((await q(f.adaUser, `update public.${t} set id = id`)).affectedRows).toBe(0);
      expect((await q(f.adaUser, `delete from public.${t}`)).affectedRows).toBe(0);
    }
    // The board has no write policy either: the RPCs are the only way in.
    const boardIns = q(f.cyUser, `insert into public.announcements (association_id, title, body) values ($1::uuid, 'x', 'y')`, [f.damen]);
    expect((await pgError(boardIns)).message).toMatch(/row-level security/i);
    expect(await count(`select 1 from public.announcements`)).toBe(1);
  });

  it("16. audience all: owners and a live accountant see it; drafts only the board", async () => {
    const posted = await save(f.cyUser);
    const draft = await save(f.cyUser, { title: "Draft", publish: false });
    const ids = async (u: string) => (await visible(u)).map((r) => r.id);
    expect(await ids(f.adaUser)).toEqual([posted]);
    expect(await ids(f.boUser)).toEqual([posted]);
    expect(await ids(f.zaraUser)).toEqual([]);
    expect(await ids(f.niaUser)).toEqual([posted]);
    expect(await ids(f.vicUser)).toEqual([]);
    expect((await ids(f.cyUser)).sort()).toEqual([posted, draft].sort());
  });

  it("17. chosen units: only that unit's owner and the board", async () => {
    const id = await save(f.cyUser, { audience: "units", units: [f.unit2] });
    expect((await visible(f.boUser)).map((r) => r.id)).toEqual([id]);
    expect(await visible(f.adaUser)).toEqual([]);
    expect((await visible(f.cyUser)).map((r) => r.id)).toEqual([id]);
    const au = await rows(f.boUser, `select unit_id from public.announcement_units`);
    expect(au).toHaveLength(1);
    expect(await rows(f.adaUser, `select unit_id from public.announcement_units`)).toEqual([]);
  });

  it("18. expiry hides it from owners, not the board; the RPC refuses a past end date", async () => {
    const id = await save(f.cyUser);
    await db.query(`update public.announcements set expires_on = current_date - 1 where id = $1::uuid`, [id]);
    expect(await visible(f.adaUser)).toEqual([]);
    expect(await visible(f.cyUser)).toHaveLength(1);
    const err = await pgError(save(f.cyUser, { expires: "2020-01-01" }));
    expect(err.code).toBe("22023");
    expect(err.hint).toBe("expires_past");
    // Ends today: still visible.
    const today = await save(f.cyUser, { title: "Ends today", expires: new Date().toISOString().slice(0, 10) });
    expect((await visible(f.adaUser)).map((r) => r.id)).toEqual([today]);
  });

  it("19. chosen units needs units, and they must be this association's", async () => {
    const none = await pgError(save(f.cyUser, { audience: "units", units: [] }));
    expect(none).toMatchObject({ code: "22023", hint: "no_units" });
    expect((await pgError(save(f.cyUser, { audience: "units", units: [f.hoyneUnit] }))).code).toBe("42501");
    expect((await pgError(save(f.cyUser, { audience: "everyone" as "all" }))).code).toBe("22023");
  });

  it("20. at most three pinned; archiving unpins; a draft cannot be pinned", async () => {
    for (let i = 0; i < 3; i++) await save(f.cyUser, { title: `Pinned ${i}`, pinned: true });
    const fourth = await pgError(save(f.cyUser, { title: "Pinned 3", pinned: true }));
    expect(fourth.code).toBe("23514");
    expect(fourth.message).toMatch(/three announcements/);
    const loose = await save(f.cyUser, { title: "Loose" });
    const viaPin = await pgError(q(f.cyUser, `select public.set_announcement_pinned($1::uuid, true)`, [loose]));
    expect(viaPin.code).toBe("23514");
    const [first] = await rows<{ id: string }>(f.cyUser, `select id from public.announcements where pinned order by created_at limit 1`);
    await q(f.cyUser, `select public.set_announcement_status($1::uuid, 'archived')`, [first.id]);
    expect((await one<{ pinned: boolean }>(f.cyUser, `select pinned from public.announcements where id = $1::uuid`, [first.id])).pinned).toBe(false);
    await q(f.cyUser, `select public.set_announcement_pinned($1::uuid, true)`, [loose]);
    const draft = await save(f.cyUser, { title: "Draft", publish: false });
    const bad = await pgError(db.query(`update public.announcements set pinned = true where id = $1::uuid`, [draft]));
    expect(bad.code).toBe("23514");
    // A draft saved with the pin box ticked is saved unpinned.
    const d2 = await save(f.cyUser, { title: "Draft 2", publish: false, pinned: true });
    expect((await one<{ pinned: boolean }>(null, `select pinned from public.announcements where id = $1::uuid`, [d2])).pinned).toBe(false);
  });

  it("21. lifecycle: no way back to a draft; restore keeps published_at; edits stamp edited_at", async () => {
    const id = await save(f.cyUser);
    const before = await one<{ published_at: string; edited_at: string | null }>(null, `select published_at::text, edited_at::text from public.announcements where id = $1::uuid`, [id]);
    expect(before.edited_at).toBeNull();
    const back = await pgError(db.query(`update public.announcements set status = 'draft', published_at = null where id = $1::uuid`, [id]));
    expect(back.code).toBe("23514");
    await q(f.cyUser, `select public.set_announcement_status($1::uuid, 'archived')`, [id]);
    const archived = await one<{ status: string; archived_at: string | null }>(null, `select status, archived_at::text from public.announcements where id = $1::uuid`, [id]);
    expect(archived.status).toBe("archived");
    expect(archived.archived_at).not.toBeNull();
    expect(await visible(f.adaUser)).toEqual([]);
    expect((await pgError(save(f.cyUser, { id, title: "Nope" }))).code).toBe("22023");
    await q(f.cyUser, `select public.set_announcement_status($1::uuid, 'published')`, [id]);
    const restored = await one<{ published_at: string; archived_at: string | null; status: string }>(null, `select published_at::text, archived_at::text, status from public.announcements where id = $1::uuid`, [id]);
    expect(restored).toMatchObject({ status: "published", archived_at: null, published_at: before.published_at });
    await save(f.cyUser, { id, title: "Water off Wednesday" });
    expect((await one<{ edited_at: string | null }>(null, `select edited_at::text from public.announcements where id = $1::uuid`, [id])).edited_at).not.toBeNull();
    // Editing a draft is not an "edit".
    const d = await save(f.cyUser, { publish: false });
    await save(f.cyUser, { id: d, publish: false, title: "Changed" });
    expect((await one<{ edited_at: string | null }>(null, `select edited_at::text from public.announcements where id = $1::uuid`, [d])).edited_at).toBeNull();
    // Posting a draft sets published_at.
    await save(f.cyUser, { id: d, publish: true });
    expect((await one<{ status: string; published_at: string | null }>(null, `select status, published_at::text from public.announcements where id = $1::uuid`, [d]))).toMatchObject({ status: "published" });
  });

  it("22. a draft can be deleted; a posted announcement cannot", async () => {
    const d = await save(f.cyUser, { publish: false });
    const p = await save(f.cyUser);
    await q(f.cyUser, `select public.delete_announcement_draft($1::uuid)`, [d]);
    expect(await count(`select 1 from public.announcements where id = '${d}'`)).toBe(0);
    expect((await pgError(q(f.cyUser, `select public.delete_announcement_draft($1::uuid)`, [p]))).code).toBe("22023");
    expect((await pgError(q(f.adaUser, `select public.delete_announcement_draft($1::uuid)`, [p]))).code).toBe("42501");
  });

  it("23. an attachment must already be readable by exactly this audience", async () => {
    const boardOnly = await doc(f.damen);
    const shared = await doc(f.damen, { visibility: "all_owners" });
    const unit2Doc = await doc(f.damen, { unit: f.unit2 });
    const hoyneDoc = await doc(f.hoyne, { visibility: "all_owners" });
    const gone = await doc(f.damen, { visibility: "all_owners", deleted: true });
    const err = await pgError(save(f.cyUser, { doc: boardOnly }));
    expect(err).toMatchObject({ code: "22023", hint: "attachment_not_shared" });
    expect(await save(f.cyUser, { doc: shared })).toBeTruthy();
    expect(await save(f.cyUser, { doc: shared, audience: "units", units: [f.unit1] })).toBeTruthy();
    expect(await save(f.cyUser, { doc: unit2Doc, audience: "units", units: [f.unit2] })).toBeTruthy();
    expect((await pgError(save(f.cyUser, { doc: unit2Doc, audience: "units", units: [f.unit1, f.unit2] }))).hint).toBe("attachment_not_shared");
    expect((await pgError(save(f.cyUser, { doc: unit2Doc }))).hint).toBe("attachment_not_shared");
    expect((await pgError(save(f.cyUser, { doc: hoyneDoc }))).hint).toBe("attachment_missing");
    expect((await pgError(save(f.cyUser, { doc: gone }))).hint).toBe("attachment_missing");
    // The owner who can see the post can open its file (the Document Hub's own rule).
    const visibleDocs = await rows<{ id: string }>(f.boUser, `select id from public.documents`);
    expect(visibleDocs.map((d) => d.id).sort()).toEqual([shared, unit2Doc].sort());
  });

  it("24. reading is recorded once, only for what the caller can see, and only the reader sees the row", async () => {
    const all = await save(f.cyUser);
    const unit1Only = await save(f.cyUser, { audience: "units", units: [f.unit1], title: "Unit 1 only" });
    await q(f.adaUser, `select public.mark_announcement_read($1::uuid)`, [all]);
    await q(f.adaUser, `select public.mark_announcement_read($1::uuid)`, [all]);
    await q(f.boUser, `select public.mark_announcement_read($1::uuid)`, [all]);
    await q(f.boUser, `select public.mark_announcement_read($1::uuid)`, [unit1Only]);
    expect(await count(`select 1 from public.announcement_reads`)).toBe(2);
    expect(await rows(f.adaUser, `select person_id from public.announcement_reads`)).toEqual([{ person_id: f.adaPerson }]);
    expect(await rows(f.cyUser, `select 1 from public.announcement_reads`)).toEqual([]);
    // Not signed in as a person: a silent no-op, not an error.
    await db.query(`insert into auth.users (id, email) values ($1::uuid, 'dee@example.test')`, [DEE_USER]);
    await q(DEE_USER, `select public.mark_announcement_read($1::uuid)`, [all]);
    expect(await count(`select 1 from public.announcement_reads`)).toBe(2);
  });

  it("25. unread counts what is visible, new, and not yet opened", async () => {
    const a = await save(f.cyUser, { title: "One" });
    await save(f.cyUser, { title: "Two" });
    await save(f.cyUser, { title: "For unit 2", audience: "units", units: [f.unit2] });
    const old = await save(f.cyUser, { title: "Old" });
    await db.query(`update public.announcements set published_at = now() - interval '100 days' where id = $1::uuid`, [old]);
    await save(f.cyUser, { title: "Draft", publish: false });
    const unread = (u: string) => one<{ n: number }>(u, `select public.announcements_unread($1::uuid) as n`, [f.damen]).then((r) => r.n);
    expect(await unread(f.adaUser)).toBe(2);
    expect(await unread(f.boUser)).toBe(3);
    await q(f.adaUser, `select public.mark_announcement_read($1::uuid)`, [a]);
    expect(await unread(f.adaUser)).toBe(1);
    expect(await unread(f.zaraUser)).toBe(0);
    await db.query(`insert into auth.users (id, email) values ($1::uuid, 'dee@example.test')`, [DEE_USER]);
    expect(await unread(DEE_USER)).toBe(0);
  });

  it("26. reader stats: counts to the board only, ended ownerships excluded", async () => {
    await db.query(
      `insert into public.persons (id, association_id, full_name, email) values
         ($1::uuid, $3::uuid, 'Lou Nologin', 'lou@example.test'),
         ($2::uuid, $3::uuid, 'Former Owner', 'former@example.test')`,
      [NOLOGIN_PERSON, FORMER_PERSON, f.damen],
    );
    await db.query(
      `insert into public.unit_owners (association_id, unit_id, person_id, effective_from, effective_to) values
         ($1::uuid, $2::uuid, $3::uuid, '2020-01-01', null),
         ($1::uuid, $2::uuid, $4::uuid, '2015-01-01', '2019-12-31')`,
      [f.damen, f.unit2, NOLOGIN_PERSON, FORMER_PERSON],
    );
    const id = await save(f.cyUser);
    await q(f.adaUser, `select public.mark_announcement_read($1::uuid)`, [id]);
    const stats = await rows<{ announcement_id: string; readers_total: number; readers_read: number; no_login: number }>(
      f.cyUser, `select * from public.announcement_reader_stats($1::uuid)`, [f.damen]);
    expect(stats).toEqual([{ announcement_id: id, readers_total: 3, readers_read: 1, no_login: 1 }]);
    expect(await rows(f.adaUser, `select * from public.announcement_reader_stats($1::uuid)`, [f.damen])).toEqual([]);
    expect(await rows(f.zaraUser, `select * from public.announcement_reader_stats($1::uuid)`, [f.damen])).toEqual([]);
    expect(await rows(f.niaUser, `select * from public.announcement_reader_stats($1::uuid)`, [f.damen])).toEqual([]);
    // Units audience counts only that unit's current owners.
    const u2 = await save(f.cyUser, { audience: "units", units: [f.unit2], title: "Unit 2" });
    const s2 = await rows<{ announcement_id: string; readers_total: number; no_login: number }>(f.cyUser, `select * from public.announcement_reader_stats($1::uuid)`, [f.damen]);
    expect(s2.find((r) => r.announcement_id === u2)).toMatchObject({ readers_total: 1, no_login: 1 });
  });

  it("27. document_links accepts announcements, still rejects an unknown table and still accepts the earlier targets", async () => {
    const shared = await doc(f.damen, { visibility: "all_owners" });
    const id = await save(f.cyUser, { doc: shared });
    const link = (table: string, target: string) =>
      db.query(`insert into public.document_links (association_id, document_id, target_table, target_id, relation) values ($1::uuid, $2::uuid, $3, $4::uuid, 'source')`, [f.damen, shared, table, target]);
    await link("announcements", id);
    expect((await pgError(link("mystery_table", id))).code).toBe("23514");
    for (const t of ["associations", "units", "persons", "vendors", "journal_entries", "expenses", "assessment_charges", "payments", "insurance_policies", "tickets", "recurring_bills", "fiscal_years", "tax_forms", "insurance_quotes", "insurance_claims"]) {
      await link(t, id);
    }
  });

  it("28. same-association triggers refuse a cross-association row, even from the superuser", async () => {
    const id = await save(f.cyUser);
    const hoyneDoc = await doc(f.hoyne, { visibility: "all_owners" });
    const u = pgError(db.query(`insert into public.announcement_units (association_id, announcement_id, unit_id) values ($1::uuid, $2::uuid, $3::uuid)`, [f.damen, id, f.hoyneUnit]));
    expect((await u).code).toBe("42501");
    const r = pgError(db.query(`insert into public.announcement_reads (association_id, announcement_id, person_id) values ($1::uuid, $2::uuid, $3::uuid)`, [f.damen, id, f.zaraPerson]));
    expect((await r).code).toBe("42501");
    const a = pgError(db.query(`insert into public.announcements (association_id, title, body, attachment_document_id) values ($1::uuid, 't', 'b', $2::uuid)`, [f.damen, hoyneDoc]));
    expect((await a).code).toBe("42501");
  });

  it("29. posting is audited; reading is not", async () => {
    const id = await save(f.cyUser, { audience: "units", units: [f.unit1] });
    await q(f.adaUser, `select public.mark_announcement_read($1::uuid)`, [id]);
    const logged = await rows<{ table_name: string; action: string }>(null, `select table_name, action from public.audit_log where table_name like 'announcement%' order by table_name`);
    expect(logged.filter((l) => l.table_name === "announcements").length).toBeGreaterThanOrEqual(1);
    expect(logged.some((l) => l.table_name === "announcement_units")).toBe(true);
    expect(logged.some((l) => l.table_name === "announcement_reads")).toBe(false);
  });

  it("an announcement belongs to the association: delete of the association is restricted", async () => {
    await save(f.cyUser);
    await expect(db.query(`delete from public.associations where id = $1::uuid`, [f.damen])).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Invites and profile
// ---------------------------------------------------------------------------

async function inviteFor(personId: string | null, role = "owner", assoc?: string) {
  const email = personId === null ? "gus@example.test" : "lou@example.test";
  return one<{ id: string; token: string }>(
    f.cyUser,
    `insert into public.invites (association_id, role, person_id, email, created_by)
     values ($1::uuid, $2::public.app_role, $3::uuid, $5, $4::uuid) returning id, token`,
    [assoc ?? f.damen, role, personId, f.cyUser, email],
  );
}
async function addLoginless() {
  await db.query(`insert into public.persons (id, association_id, full_name, email) values ($1::uuid, $2::uuid, 'Lou Nologin', 'dee@example.test')`, [NOLOGIN_PERSON, f.damen]);
  await db.query(`insert into public.unit_owners (association_id, unit_id, person_id, effective_from) values ($1::uuid, $2::uuid, $3::uuid, '2020-01-01')`, [f.damen, f.unit2, NOLOGIN_PERSON]);
}
const redeem = (user: string, token: string, name = "Louise N") =>
  q(user, `select public.redeem_invite($1, $2) as a`, [token, name]);

describe("invites and profile", () => {
  beforeEach(async () => {
    ({ db, f } = await seededDb());
    await db.query(`insert into auth.users (id, email) values ($1::uuid, 'dee@example.test'), ($2::uuid, 'gus@example.test')`, [DEE_USER, GUS_USER]);
    await addLoginless();
  });

  it("30. the invite guard refuses another association's person and any role but owner", async () => {
    expect((await pgError(inviteFor(f.zaraPerson))).code).toBe("42501");
    expect((await pgError(inviteFor(NOLOGIN_PERSON, "board_admin"))).code).toBe("23514");
    expect((await pgError(inviteFor(NOLOGIN_PERSON, "accountant"))).code).toBe("23514");
    expect(await inviteFor(NOLOGIN_PERSON)).toBeTruthy();
    // The old shape (no person) still takes any role.
    expect(await inviteFor(null, "board_member")).toBeTruthy();
  });

  it("31. claiming a record links the login to the existing person", async () => {
    const inv = await inviteFor(NOLOGIN_PERSON);
    const before = await count(`select 1 from public.persons`);
    await redeem(DEE_USER, inv.token, "Someone Else");
    expect(await count(`select 1 from public.persons`)).toBe(before);
    expect(await one(null, `select full_name, auth_user_id from public.persons where id = $1::uuid`, [NOLOGIN_PERSON])).toEqual({ full_name: "Lou Nologin", auth_user_id: DEE_USER });
    expect(await count(`select 1 from public.role_grants where person_id = '${NOLOGIN_PERSON}' and role = 'owner' and revoked_at is null`)).toBe(1);
    expect((await one<{ redeemed_at: string | null }>(null, `select redeemed_at::text from public.invites where id = $1::uuid`, [inv.id])).redeemed_at).not.toBeNull();
    // The new login now owns the unit.
    const ctx = await one<{ owned_unit_ids: string[] }>(DEE_USER, `select * from public.viewer_context($1::uuid)`, [f.damen]);
    expect(ctx.owned_unit_ids).toEqual([f.unit2]);
  });

  it("32. a person who already has a login cannot be claimed; stale tokens fail; the old path still creates a person", async () => {
    const taken = await inviteFor(f.boPerson);
    const err = await pgError(redeem(DEE_USER, taken.token));
    expect(err.code).toBe("23505");
    const bad = await pgError(redeem(DEE_USER, "not-a-token"));
    expect(bad.code).toBe("P0002");
    const plain = await inviteFor(null);
    const before = await count(`select 1 from public.persons`);
    await redeem(GUS_USER, plain.token, "Gus Newcomer");
    expect(await count(`select 1 from public.persons`)).toBe(before + 1);
    expect(await one(null, `select full_name from public.persons where auth_user_id = $1::uuid`, [GUS_USER])).toEqual({ full_name: "Gus Newcomer" });
    // Used once only.
    expect((await pgError(redeem(DEE_USER, plain.token))).code).toBe("P0002");
  });

  it("33. claiming revives a revoked owner grant", async () => {
    await db.query(`insert into public.role_grants (association_id, person_id, role, granted_on, revoked_at) values ($1::uuid, $2::uuid, 'owner', '2020-01-01', now())`, [f.damen, NOLOGIN_PERSON]);
    const inv = await inviteFor(NOLOGIN_PERSON);
    await redeem(DEE_USER, inv.token);
    expect(await count(`select 1 from public.role_grants where person_id = '${NOLOGIN_PERSON}' and role = 'owner' and revoked_at is null`)).toBe(1);
    expect(await count(`select 1 from public.role_grants where person_id = '${NOLOGIN_PERSON}' and role = 'owner'`)).toBe(1);
  });

  it("34. a non-board person edits only phone and mailing address; the board edits anything; definer functions still work", async () => {
    for (const col of ["full_name = 'Ada Renamed'", "email = 'new@example.test'", `auth_user_id = '${DEE_USER}'`]) {
      const e = await pgError(q(f.adaUser, `update public.persons set ${col} where id = $1::uuid`, [f.adaPerson]));
      expect(e.code, col).toBe("42501");
    }
    const ok = await q(f.adaUser, `update public.persons set phone = '312-555-0100', mailing_address = '1 Main St' where id = $1::uuid`, [f.adaPerson]);
    expect(ok.affectedRows).toBe(1);
    const board = await q(f.cyUser, `update public.persons set full_name = 'Bo L.', email = 'bo2@example.test' where id = $1::uuid`, [f.boPerson]);
    expect(board.affectedRows).toBe(1);
    // redact_person (a definer function) rewrites name, email and login of a former owner.
    await db.query(`update public.unit_owners set effective_to = '2025-01-01' where person_id = $1::uuid`, [f.boPerson]);
    await db.query(`update public.role_grants set revoked_at = now() where person_id = $1::uuid`, [f.boPerson]);
    await q(f.cyUser, `select public.redact_person($1::uuid)`, [f.boPerson]);
    expect(await one(null, `select full_name, auth_user_id from public.persons where id = $1::uuid`, [f.boPerson])).toEqual({ full_name: "Former member", auth_user_id: null });
  });

  it("35. update_my_profile changes only the caller's phone and address", async () => {
    await q(f.adaUser, `select public.update_my_profile($1::uuid, '  312-555-0100 ', ' 1 Main St ')`, [f.damen]);
    expect(await one(null, `select phone, mailing_address from public.persons where id = $1::uuid`, [f.adaPerson])).toEqual({ phone: "312-555-0100", mailing_address: "1 Main St" });
    expect(await one(null, `select phone from public.persons where id = $1::uuid`, [f.boPerson])).toEqual({ phone: null });
    await q(f.adaUser, `select public.update_my_profile($1::uuid, '', '   ')`, [f.damen]);
    expect(await one(null, `select phone, mailing_address from public.persons where id = $1::uuid`, [f.adaPerson])).toEqual({ phone: null, mailing_address: null });
    expect((await pgError(q(f.adaUser, `select public.update_my_profile($1::uuid, $2, null)`, [f.damen, "9".repeat(41)]))).code).toBe("22023");
    expect((await pgError(q(f.adaUser, `select public.update_my_profile($1::uuid, null, $2)`, [f.damen, "x".repeat(301)]))).code).toBe("22023");
    expect((await pgError(q(DEE_USER, `select public.update_my_profile($1::uuid, '1', '2')`, [f.damen]))).code).toBe("42501");
    expect((await pgError(q(f.zaraUser, `select public.update_my_profile($1::uuid, '1', '2')`, [f.damen]))).code).toBe("42501");
  });

  it("36. board_roster lists live board grants to members only", async () => {
    await boBoard(db, f);
    await db.query(`insert into public.role_grants (association_id, person_id, role, granted_on, expires_on) values ($1::uuid, $2::uuid, 'board_member', '2020-01-01', '2021-01-01')`, [f.damen, f.vicPerson]);
    await db.query(`insert into public.role_grants (association_id, person_id, role, granted_on, revoked_at) values ($1::uuid, $2::uuid, 'board_member', '2020-01-01', now())`, [f.damen, f.adaPerson]);
    const r = await rows<{ full_name: string; role: string }>(f.adaUser, `select * from public.board_roster($1::uuid)`, [f.damen]);
    expect(r).toEqual([{ full_name: "Cy Ferreira", role: "board_admin" }, { full_name: "Bo Lindqvist", role: "board_member" }]);
    expect(await rows(f.zaraUser, `select * from public.board_roster($1::uuid)`, [f.damen])).toEqual([]);
    expect(await rows(DEE_USER, `select * from public.board_roster($1::uuid)`, [f.damen])).toEqual([]);
  });

  it("37. viewer_context", async () => {
    const ada = await one<{ person_id: string; roles: string[]; is_board: boolean; is_board_admin: boolean; can_read_financials: boolean; owned_unit_ids: string[] }>(
      f.adaUser, `select * from public.viewer_context($1::uuid)`, [f.damen]);
    expect(ada).toMatchObject({ person_id: f.adaPerson, roles: ["owner"], is_board: false, is_board_admin: false, can_read_financials: false, owned_unit_ids: [f.unit1] });
    const cy = await one<{ roles: string[]; is_board: boolean; is_board_admin: boolean; can_read_financials: boolean; owned_unit_ids: string[] }>(
      f.cyUser, `select * from public.viewer_context($1::uuid)`, [f.damen]);
    expect(cy).toMatchObject({ roles: ["board_admin", "owner"], is_board: true, is_board_admin: true, can_read_financials: true, owned_unit_ids: [f.unit3] });
    const nia = await one<{ roles: string[]; is_board: boolean; can_read_financials: boolean }>(f.niaUser, `select * from public.viewer_context($1::uuid)`, [f.damen]);
    expect(nia).toMatchObject({ roles: ["accountant"], is_board: false, can_read_financials: true });
    expect(await rows(f.zaraUser, `select * from public.viewer_context($1::uuid)`, [f.damen])).toEqual([]);
    const low = await asUser(db, f.adaUser, () => db.query(`select * from public.viewer_context($1::uuid)`, [f.damen]), { aal: "aal1" });
    expect(low.rows).toEqual([]);
  });

  const report = (user: string, unit: string) =>
    one<{ id: string }>(
      user,
      `insert into public.dues_payment_reports (association_id, unit_id, reported_by, amount, paid_on, method)
       values ($1::uuid, $2::uuid, $3::uuid, 450, '2026-10-03', 'zelle') returning id`,
      [f.damen, unit, user],
    ).then((r) => r.id);

  it("38. only the reporter can withdraw, and only while it is waiting", async () => {
    const id = await report(f.adaUser, f.unit1);
    expect((await pgError(q(f.boUser, `select public.withdraw_payment_report($1::uuid)`, [id]))).code).toBe("42501");
    expect((await pgError(q(f.cyUser, `select public.withdraw_payment_report($1::uuid)`, [id]))).code).toBe("42501");
    await q(f.adaUser, `select public.withdraw_payment_report($1::uuid)`, [id]);
    expect(await one(null, `select status, resolution_note, resolved_by from public.dues_payment_reports where id = $1::uuid`, [id])).toEqual({
      status: "dismissed", resolution_note: "Withdrawn by the person who sent it", resolved_by: f.adaUser,
    });
    expect((await pgError(q(f.adaUser, `select public.withdraw_payment_report($1::uuid)`, [id]))).code).toBe("22023");
    // One the board answered.
    const second = await report(f.adaUser, f.unit1);
    await q(f.cyUser, `update public.dues_payment_reports set status = 'dismissed', resolved_at = now(), resolved_by = $2::uuid, resolution_note = 'not found' where id = $1::uuid`, [second, f.cyUser]);
    expect((await pgError(q(f.adaUser, `select public.withdraw_payment_report($1::uuid)`, [second]))).code).toBe("22023");
    // aal1 cannot withdraw.
    const third = await report(f.adaUser, f.unit1);
    const low = await pgError(asUser(db, f.adaUser, () => db.query(`select public.withdraw_payment_report($1::uuid)`, [third]), { aal: "aal1" }));
    expect(low.code).toBe("42501");
  });

  it("39. the eleventh waiting report for a unit is refused; withdrawing one frees a slot", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push(await report(f.adaUser, f.unit1));
    const err = await pgError(report(f.adaUser, f.unit1));
    expect(err).toMatchObject({ code: "53400", hint: "report_cap" });
    // Another unit is unaffected.
    expect(await report(f.boUser, f.unit2)).toBeTruthy();
    await q(f.adaUser, `select public.withdraw_payment_report($1::uuid)`, [ids[0]]);
    expect(await report(f.adaUser, f.unit1)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Lint-style checks and the migration path
// ---------------------------------------------------------------------------

describe("migration 0054 hygiene", () => {
  it("41. no function it creates is executable by anon; the core functions are not executable by authenticated", async () => {
    const sql = await readFile(MIGRATION, "utf8");
    const names = [...new Set([...sql.matchAll(/create or replace function public\.([a-z0-9_]+)\(/g)].map((m) => m[1]))];
    expect(names.length).toBeGreaterThanOrEqual(20);
    db = await freshDb();
    const { rows: r } = await db.query<{ fn: string; anon: boolean; auth: boolean; definer: boolean; config: string[] | null }>(
      `select p.oid::regprocedure::text as fn, p.proname,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth,
              p.prosecdef as definer, p.proconfig as config
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any($1::text[])`,
      [names],
    );
    expect(r.length).toBeGreaterThanOrEqual(names.length);
    expect(r.filter((x) => x.anon).map((x) => x.fn)).toEqual([]);
    const cores = r.filter((x) => /_core\(/.test(x.fn));
    expect(cores).toHaveLength(2);
    expect(cores.filter((x) => x.auth)).toEqual([]);
    expect(r.filter((x) => !/_core\(/.test(x.fn) && !x.auth).map((x) => x.fn)).toEqual([]);
    // Every definer function pins its search_path.
    expect(r.filter((x) => x.definer && !(x.config ?? []).some((c) => c.startsWith("search_path="))).map((x) => x.fn)).toEqual([]);
  });

  it("every new table has association_id with a restricted foreign key, RLS, and (except reads) an audit trigger", async () => {
    db = await freshDb();
    for (const t of ["announcements", "announcement_units", "announcement_reads"]) {
      const { rows: r } = await db.query<{ rls: boolean; fk: string | null }>(
        `select c.relrowsecurity as rls,
                (select rc.delete_rule from information_schema.referential_constraints rc
                   join information_schema.key_column_usage k on k.constraint_name = rc.constraint_name
                  where k.table_name = $1 and k.column_name = 'association_id' limit 1) as fk
           from pg_class c where c.relname = $1 and c.relnamespace = 'public'::regnamespace`,
        [t],
      );
      expect(r[0], t).toEqual({ rls: true, fk: "RESTRICT" });
    }
    const { rows: trg } = await db.query<{ tgrelid: string }>(
      `select tgrelid::regclass::text as tgrelid from pg_trigger where tgname in ('audit_announcements', 'audit_announcement_units')`,
    );
    expect(trg.map((t) => t.tgrelid).sort()).toEqual(["announcement_units", "announcements"]);
  });

  it("42. applying 0054 on top of seeded data keeps every row and leaves invites.person_id null", async () => {
    db = await freshDb({ before: "0054" });
    f = await seed(db);
    await db.query(`insert into public.invites (association_id, role, email, created_by) values ($1::uuid, 'owner', 'x@example.test', $2::uuid)`, [f.damen, f.cyUser]);
    await db.query(
      `insert into public.dues_payment_reports (association_id, unit_id, reported_by, amount, paid_on, method)
       values ($1::uuid, $2::uuid, $3::uuid, 450, '2026-10-03', 'zelle')`,
      [f.damen, f.unit1, f.adaUser],
    );
    const before = await db.query<{ n: number }>(`select (select count(*) from public.invites)::int + (select count(*) from public.dues_payment_reports)::int + (select count(*) from public.persons)::int as n`);
    await db.exec(await readFile(MIGRATION, "utf8"));
    const after = await db.query<{ n: number }>(`select (select count(*) from public.invites)::int + (select count(*) from public.dues_payment_reports)::int + (select count(*) from public.persons)::int as n`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    const inv = await db.query<{ person_id: string | null }>(`select person_id from public.invites`);
    expect(inv.rows).toEqual([{ person_id: null }]);
  });
});
