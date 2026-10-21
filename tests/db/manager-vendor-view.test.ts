import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser } from "./harness";
import type { Fixture } from "./fixtures";
import { EXTRA, addVendors, boBoard, pgError, queries, seededDb } from "./repairs-helpers";

/**
 * Migration 0081, part C: a property manager no longer reads the vendors table, which carries each
 * contractor's tax identity. They read contractors through vendors_manager (every column except the five tax
 * ones); the board and the accountant keep the table. The two invoker functions that look a contractor up for
 * a manager read the view, so a manager's quote requests and plans still work.
 */

const PAT_USER = "dddd0000-0000-0000-0000-0000000000a1"; // property manager, Damen
const LEE_USER = "dddd0000-0000-0000-0000-0000000000a2"; // attorney, Damen
const OLA_USER = "dddd0000-0000-0000-0000-0000000000a3"; // observer, Damen
const EXP_USER = "dddd0000-0000-0000-0000-0000000000a4"; // property manager whose grant has ended
const HPM_USER = "dddd0000-0000-0000-0000-0000000000a5"; // property manager, Hoyne
const PAT = "eeee0000-0000-0000-0000-0000000000a1";
const LEE = "eeee0000-0000-0000-0000-0000000000a2";
const OLA = "eeee0000-0000-0000-0000-0000000000a3";
const EXP = "eeee0000-0000-0000-0000-0000000000a4";
const HPM = "eeee0000-0000-0000-0000-0000000000a5";

const TAX_COLUMNS = ["entity_type", "tin_last4", "w9_on_file", "w9_received_on", "is_1099_exempt"];

let db: PGlite;
let f: Fixture;
const { q, one, rows, count } = queries(() => db);

beforeEach(async () => {
  ({ db, f } = await seededDb());
  await db.exec(`
    insert into auth.users (id, email) values
      ('${PAT_USER}', 'pat@example.test'), ('${LEE_USER}', 'lee@example.test'), ('${OLA_USER}', 'ola@example.test'),
      ('${EXP_USER}', 'exp@example.test'), ('${HPM_USER}', 'hpm@example.test');
    insert into public.persons (id, association_id, full_name, email, auth_user_id) values
      ('${PAT}', '${f.damen}', 'Pat Manager', 'pat@example.test', '${PAT_USER}'),
      ('${LEE}', '${f.damen}', 'Lee Counsel', 'lee@example.test', '${LEE_USER}'),
      ('${OLA}', '${f.damen}', 'Ola Observer', 'ola@example.test', '${OLA_USER}'),
      ('${EXP}', '${f.damen}', 'Exp Manager', 'exp@example.test', '${EXP_USER}'),
      ('${HPM}', '${f.hoyne}', 'Hoyne Manager', 'hpm@example.test', '${HPM_USER}');
    insert into public.role_grants (association_id, person_id, role, granted_on, expires_on) values
      ('${f.damen}', '${PAT}', 'property_manager', current_date, current_date + 90),
      ('${f.damen}', '${LEE}', 'attorney', current_date, current_date + 90),
      ('${f.damen}', '${OLA}', 'observer', current_date, current_date + 90),
      ('${f.damen}', '${EXP}', 'property_manager', current_date - 100, current_date - 1),
      ('${f.hoyne}', '${HPM}', 'property_manager', current_date, current_date + 90);
  `);
  await addVendors(db, f);
  // Tax identity on every contractor, so a leak would show.
  await db.query(`update public.vendors set entity_type = 'sole_prop', tin_last4 = '4821', w9_on_file = true, w9_received_on = '2026-03-02', is_1099_exempt = false`);
});
afterEach(async () => {
  await db.close();
});

const pat = (sql: string, params: unknown[] = []) => q(PAT_USER, sql, params);

describe("the vendors table", () => {
  it("a property manager reads nothing from it, not even a contractor's name", async () => {
    expect(await rows(PAT_USER, `select 1 from public.vendors`)).toHaveLength(0);
    expect(await rows(PAT_USER, `select id, name from public.vendors`)).toHaveLength(0);
    expect(await rows(PAT_USER, `select tin_last4, w9_on_file from public.vendors`)).toHaveLength(0);
    expect(await rows(PAT_USER, `select count(*) filter (where tin_last4 is not null)::int as n from public.vendors`)).toEqual([{ n: 0 }]);
  });

  it("board admin, board member and accountant read all of it, tax identity included", async () => {
    await boBoard(db, f);
    for (const user of [f.cyUser, f.boUser, f.niaUser]) {
      const r = await rows<{ tin_last4: string; w9_on_file: boolean; entity_type: string }>(user, `select tin_last4, w9_on_file, entity_type from public.vendors`);
      expect(r, user).toHaveLength(4); // the four Damen contractors; Hoyne's is another building's
      expect(r[0]).toEqual({ tin_last4: "4821", w9_on_file: true, entity_type: "sole_prop" });
    }
  });

  it("an attorney, an observer, an owner, an expired manager and another building's manager read none of it", async () => {
    for (const user of [LEE_USER, OLA_USER, f.adaUser, EXP_USER, f.zaraUser]) {
      expect(await rows(user, `select 1 from public.vendors where association_id = '${f.damen}'`), user).toHaveLength(0);
    }
    // Hoyne's own manager reads none of the table either, and none of Damen's contractors.
    expect(await rows(HPM_USER, `select 1 from public.vendors`)).toHaveLength(0);
  });

  it("a manager still cannot write: insert, update, delete", async () => {
    expect((await pgError(pat(`insert into public.vendors (association_id, name) values ($1::uuid, 'New Co')`, [f.damen]))).code).toBe("42501");
    expect((await pat(`update public.vendors set name = 'Renamed', w9_on_file = false`)).affectedRows).toBe(0);
    expect((await pat(`delete from public.vendors`)).affectedRows).toBe(0);
    expect(await count(`select 1 from public.vendors where name = 'Renamed'`)).toBe(0);
  });
});

describe("vendors_manager", () => {
  it("has every vendors column except the five tax ones", async () => {
    const cols = async (rel: string) =>
      (await rows<{ column_name: string }>(null, `select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`, [rel])).map((r) => r.column_name).sort();
    const view = await cols("vendors_manager");
    const table = await cols("vendors");
    for (const c of TAX_COLUMNS) expect(view, c).not.toContain(c);
    // A column added to vendors later must be added to the view on purpose (or left out on purpose, here).
    expect(view).toEqual(table.filter((c) => !TAX_COLUMNS.includes(c)));
  });

  it("a manager reads this building's contractors, archived and do-not-use ones included, and no other building's", async () => {
    const r = await rows<{ id: string; name: string }>(PAT_USER, `select id, name from public.vendors_manager order by name`);
    expect(r.map((x) => x.name)).toEqual(["Damen Plumbing", "Lakeside Heating", "Never Again Co", "Old Masonry"]);
    expect(r.map((x) => x.id)).not.toContain(EXTRA.hoyneVendor);
    expect((await rows(HPM_USER, `select name from public.vendors_manager`)).map((x) => (x as { name: string }).name)).toEqual(["Hoyne Roofing"]);
  });

  it("carries the rest of the contractor: contact, trades, paperwork dates, rates, status", async () => {
    await db.query(
      `update public.vendors set phone = '312-555-0101', email = 'a@b.test', insured_until = '2027-05-01', license_expires_on = '2027-06-01', emergency_service = true, rate_hourly = 95 where id = $1::uuid`,
      [EXTRA.damenVendor],
    );
    const v = await one<Record<string, unknown>>(
      PAT_USER,
      `select name, phone, email, trades, status, insured_until::text, license_expires_on::text, emergency_service, rate_hourly::text from public.vendors_manager where id = $1::uuid`,
      [EXTRA.damenVendor],
    );
    expect(v).toMatchObject({ name: "Damen Plumbing", phone: "312-555-0101", email: "a@b.test", trades: ["plumbing"], status: "preferred", insured_until: "2027-05-01", license_expires_on: "2027-06-01", emergency_service: true, rate_hourly: "95.00" });
  });

  it("a tax column cannot be selected through it, by name, by star or as a row", async () => {
    for (const c of TAX_COLUMNS) expect((await pgError(pat(`select ${c} from public.vendors_manager`))).code, c).toBe("42703");
    const star = await one<Record<string, unknown>>(PAT_USER, `select * from public.vendors_manager limit 1`);
    for (const c of TAX_COLUMNS) expect(Object.keys(star)).not.toContain(c);
    const asJson = await rows<{ j: Record<string, unknown> }>(PAT_USER, `select to_jsonb(v) as j from public.vendors_manager v`);
    for (const r of asJson) for (const c of TAX_COLUMNS) expect(Object.keys(r.j)).not.toContain(c);
    expect(JSON.stringify(asJson)).not.toContain("4821");
    const text = await rows<{ t: string }>(PAT_USER, `select v::text as t from public.vendors_manager v`);
    expect(text.join(" ")).not.toContain("4821");
  });

  it("a manager cannot get the tax columns by joining the view to the table", async () => {
    const r = await rows(PAT_USER, `select t.tin_last4 from public.vendors_manager m join public.vendors t on t.id = m.id`);
    expect(r).toHaveLength(0);
  });

  it("is read only: no insert, update or delete through it, for anyone", async () => {
    for (const user of [PAT_USER, f.cyUser]) {
      expect((await pgError(q(user, `insert into public.vendors_manager (association_id, name) values ($1::uuid, 'New Co')`, [f.damen]))).code, user).toBe("42501");
      expect((await pgError(q(user, `update public.vendors_manager set name = 'x'`))).code, user).toBe("42501");
      expect((await pgError(q(user, `delete from public.vendors_manager`))).code, user).toBe("42501");
    }
  });

  it("board and accountant read it too, with the same rows as the table", async () => {
    for (const user of [f.cyUser, f.niaUser]) {
      expect(await rows(user, `select 1 from public.vendors_manager`), user).toHaveLength(4);
    }
  });

  it("shows nothing to an attorney, an observer, an owner, an expired manager, a signed-out caller or a password-only session", async () => {
    for (const user of [LEE_USER, OLA_USER, f.adaUser, EXP_USER, f.zaraUser]) {
      expect(await rows(user, `select 1 from public.vendors_manager where association_id = '${f.damen}'`), user).toHaveLength(0);
    }
    expect(await rows(null, `select 1 from public.vendors_manager`)).toHaveLength(0);
    const aal1 = await asUser(db, PAT_USER, () => db.query(`select 1 from public.vendors_manager`), { aal: "aal1" });
    expect(aal1.rows).toHaveLength(0);
  });

  it("is a security barrier view, so a caller's own filter cannot run ahead of the access check", async () => {
    const r = await one<{ opts: string[] | null }>(null, `select reloptions as opts from pg_class where oid = 'public.vendors_manager'::regclass`);
    expect(r.opts ?? []).toContain("security_barrier=true");
  });

  it("is not callable-by or readable-by a signed-out visitor", async () => {
    const r = await one<{ anon: boolean; auth: boolean }>(
      null,
      `select has_table_privilege('anon', 'public.vendors_manager', 'select') as anon, has_table_privilege('authenticated', 'public.vendors_manager', 'select') as auth`,
    );
    expect(r).toEqual({ anon: false, auth: true });
  });
});

describe("what a manager does with contractors keeps working", () => {
  it("asks for quotes from an available contractor, by phone", async () => {
    const r = await pat(`select * from public.request_ticket_quotes($1::uuid, $2::jsonb)`, [f.ticketCommon, JSON.stringify([{ vendor_id: EXTRA.damenVendor, by_phone: true }])]);
    expect(r.rows).toEqual([expect.objectContaining({ vendor_id: EXTRA.damenVendor, outcome: "by_phone" })]);
    expect(await rows(PAT_USER, `select 1 from public.ticket_bids`)).toHaveLength(1);
  });

  it("is told 'not available' for an archived, do-not-use or other building's contractor, never a hidden success", async () => {
    const asks = JSON.stringify([EXTRA.damenArchived, EXTRA.damenDoNotUse, EXTRA.hoyneVendor].map((vendor_id) => ({ vendor_id, by_phone: true })));
    const r = await pat(`select * from public.request_ticket_quotes($1::uuid, $2::jsonb)`, [f.ticketCommon, asks]);
    expect((r.rows as { outcome: string }[]).map((x) => x.outcome)).toEqual(["not_available", "not_available", "not_available"]);
    expect(await rows(PAT_USER, `select 1 from public.ticket_bids`)).toHaveLength(0);
  });

  it("plans a problem with an available contractor, and is refused a do-not-use or archived one", async () => {
    await pat(`select public.set_ticket_plan($1::uuid, $2::jsonb)`, [f.ticketCommon, JSON.stringify({ assigned_vendor_id: EXTRA.damenVendor })]);
    expect((await one<{ v: string }>(null, `select assigned_vendor_id::text as v from public.tickets where id = $1::uuid`, [f.ticketCommon])).v).toBe(EXTRA.damenVendor);
    for (const bad of [EXTRA.damenDoNotUse, EXTRA.damenArchived]) {
      const e = await pgError(pat(`select public.set_ticket_plan($1::uuid, $2::jsonb)`, [f.ticketCommon, JSON.stringify({ assigned_vendor_id: bad })]));
      expect(e, bad).toMatchObject({ code: "22023", hint: "do_not_use" });
    }
  });

  it("assigns a contractor straight on the ticket, and reads the ticket's contractor name through the definer function", async () => {
    expect((await pat(`update public.tickets set assigned_vendor_id = $2::uuid where id = $1::uuid`, [f.ticketCommon, EXTRA.damenVendor])).affectedRows).toBe(1);
    const names = await rows<{ contractor_name: string }>(PAT_USER, `select * from public.ticket_contractor_names(array[$1::uuid])`, [f.ticketCommon]);
    expect(names).toEqual([{ ticket_id: f.ticketCommon, contractor_name: "Damen Plumbing" }]);
  });

  it("still reads the reviews, notes and messages that go with a contractor (their policies are not about vendors)", async () => {
    for (const t of ["contractor_reviews", "contractor_notes", "contractor_messages"]) {
      await expect(rows(PAT_USER, `select 1 from public.${t}`), t).resolves.toEqual([]);
    }
  });

  it("board and accountant: the 1099 view and the vendor paperwork they use are unchanged", async () => {
    for (const user of [f.cyUser, f.niaUser]) {
      const r = await rows<{ name: string; w9_on_file: boolean }>(user, `select name, w9_on_file from public.vendors where w9_on_file`);
      expect(r.length, user).toBeGreaterThan(0);
    }
  });
});
