import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser } from "./harness";
import { pgError, queries, seededDb, boBoard } from "./repairs-helpers";
import type { Fixture } from "./fixtures";
import { STORAGE_PATH_CASES } from "../fixtures/storage-paths";

/**
 * Migration 0079, part A: documents an owner (own unit only), a board member or a board admin adds for one
 * unit. Visibility is the existing documents_select rule (a unit-pinned document is read by that unit's
 * owners and the board); the accountant's branch (0074) does not reach the new category.
 */

let db: PGlite;
let f: Fixture;
const h = queries(() => db);
const { q, one, rows, count } = h;

const DEE_USER = "dddd0000-0000-0000-0000-0000000000e1";
const DEE_PERSON = "eeee0000-0000-0000-0000-0000000000e1";

afterEach(async () => {
  await db?.close();
});

beforeEach(async () => {
  ({ db, f } = await seededDb());
});

let n = 0;
const sha = (i: number) => i.toString(16).padStart(64, "0");
const pathFor = (unit: string, i: number, assoc: string = f.damen) =>
  `${assoc}/units/${unit}/${1760000000000 + i}-${String(i).padStart(6, "a").slice(-6)}-file${i}.pdf`;

type Registered = { document_id: string | null; duplicate: boolean };

/** Register a file; `i` makes the path and the checksum unique unless the test passes its own. */
async function register(
  user: string,
  unit: string,
  o: { i?: number; path?: string; checksum?: string; kind?: string; mime?: string; size?: number; title?: string | null } = {},
): Promise<Registered> {
  const i = o.i ?? ++n;
  const r = await one<Registered>(
    user,
    `select * from public.register_unit_document($1::uuid, $2, $3, $4, $5::bigint, $6, $7, $8)`,
    [unit, o.path ?? pathFor(unit, i), `file${i}.pdf`, o.mime ?? "application/pdf", o.size ?? 1000, o.checksum ?? sha(i), o.kind ?? "lease", o.title ?? null],
  );
  return r;
}
const tryRegister = (user: string, unit: string, o: Parameters<typeof register>[2] = {}) => pgError(register(user, unit, o));

async function addDee() {
  await db.query(`insert into auth.users (id, email) values ($1::uuid, 'dee@example.test')`, [DEE_USER]);
  await db.query(
    `insert into public.persons (id, association_id, full_name, email, auth_user_id) values ($1::uuid, $2::uuid, 'Dee Park', 'dee@example.test', $3::uuid)`,
    [DEE_PERSON, f.damen, DEE_USER],
  );
  await db.query(
    `insert into public.unit_owners (association_id, unit_id, person_id, effective_from) values ($1::uuid, $2::uuid, $3::uuid, '2020-01-01')`,
    [f.damen, f.unit1, DEE_PERSON],
  );
  await db.query(
    `insert into public.role_grants (association_id, person_id, role, granted_on) values ($1::uuid, $2::uuid, 'owner', '2020-01-01')`,
    [f.damen, DEE_PERSON],
  );
}

const readable = async (user: string) =>
  (await rows<{ id: string }>(user, `select id from public.documents where restricted_to_unit_id is not null`)).map((r) => r.id);

describe("the category", () => {
  it("is seeded for every association, board only by default, and is a system category", async () => {
    const r = await rows<{ association_id: string; default_visibility: string; is_system: boolean; label: string }>(
      null,
      `select association_id, default_visibility, is_system, label from public.document_categories where slug = 'unit_owner_upload' order by association_id`,
    );
    expect(r).toHaveLength(2);
    for (const c of r) expect(c).toMatchObject({ default_visibility: "board_only", is_system: true, label: "Unit document" });
  });

  it("is seeded for an association created later", async () => {
    await db.query(
      `insert into public.associations (id, legal_name, display_name, state_code, incorporated_on)
       values ('33333333-3333-3333-3333-333333333333', 'New Condo Association', 'New Condo', 'IL', '2020-01-01')`,
    );
    expect(await count(`select 1 from public.document_categories where association_id = '33333333-3333-3333-3333-333333333333' and slug = 'unit_owner_upload'`)).toBe(1);
  });

  it("a unit document cannot be made visible to all owners", async () => {
    const id = (await register(f.adaUser, f.unit1)).document_id!;
    const err = await pgError(q(f.cyUser, `update public.documents set visibility = 'all_owners', restricted_to_unit_id = null where id = $1::uuid`, [id]));
    expect(err.message).toMatch(/shared with all owners/i);
  });
});

describe("who can add a document", () => {
  it("an owner adds one for their own unit, filed and pinned the way the feature promises", async () => {
    const r = await register(f.adaUser, f.unit1, { kind: "ho6_certificate", title: "  My HO6  " });
    expect(r).toMatchObject({ duplicate: false });
    const d = await one<Record<string, unknown>>(
      null,
      `select d.visibility, d.restricted_to_unit_id, d.labels, d.review_state, d.extraction_state, d.source, d.title, d.uploaded_by, c.slug
         from public.documents d join public.document_categories c on c.id = d.category_id where d.id = $1::uuid`,
      [r.document_id],
    );
    expect(d).toMatchObject({
      visibility: "board_only",
      restricted_to_unit_id: f.unit1,
      labels: ["HO6 insurance certificate"],
      review_state: "ok",
      extraction_state: "skipped",
      source: "upload",
      title: "My HO6",
      uploaded_by: f.adaUser,
      slug: "unit_owner_upload",
    });
  });

  it("an owner cannot add one for another owner's unit, another building's unit, or a unit that does not exist", async () => {
    const other = await tryRegister(f.adaUser, f.unit2);
    const foreign = await tryRegister(f.adaUser, f.hoyneUnit);
    const missing = await tryRegister(f.adaUser, "aaaa1111-0000-0000-0000-0000000000ff");
    for (const e of [other, foreign, missing]) expect(e.code).toBe("42501");
    // The same answer for all three, so it cannot be used to find units.
    expect(new Set([other.message, foreign.message, missing.message]).size).toBe(1);
  });

  it("the accountant cannot add one, live or expired, and neither can an owner of another building", async () => {
    for (const user of [f.niaUser, f.vicUser, f.zaraUser]) expect((await tryRegister(user, f.unit1)).code).toBe("42501");
    expect(await count(`select 1 from public.documents where category_id in (select id from public.document_categories where slug = 'unit_owner_upload')`)).toBe(0);
  });

  it("a password-only (aal1) session cannot add one", async () => {
    await expect(
      asUser(db, f.adaUser, () => db.query(`select * from public.register_unit_document($1::uuid, $2, 'a.pdf', 'application/pdf', 10, $3, 'lease', null)`, [f.unit1, pathFor(f.unit1, 900), sha(900)]), { aal: "aal1" }),
    ).rejects.toThrow(/add documents for this unit/i);
  });

  it("board members and board admins can add one for any unit, without a notice to themselves", async () => {
    await boBoard(db, f);
    const byMember = await register(f.boUser, f.unit1, { kind: "proof_of_ownership" });
    const byAdmin = await register(f.cyUser, f.unit2);
    expect(byMember.document_id && byAdmin.document_id).toBeTruthy();
    expect(await count(`select 1 from public.owner_document_notices`)).toBe(0);
    expect((await tryRegister(f.cyUser, f.hoyneUnit)).code).toBe("42501");
  });

  it("an owner cannot insert into documents directly", async () => {
    const cat = (await one<{ id: string }>(null, `select id from public.document_categories where slug = 'unit_owner_upload' and association_id = $1::uuid`, [f.damen])).id;
    await expect(
      q(f.adaUser, `insert into public.documents (association_id, storage_path, filename, category_id, restricted_to_unit_id) values ($1::uuid, $2, 'x.pdf', $3::uuid, $4::uuid)`, [f.damen, pathFor(f.unit1, 800), cat, f.unit1]),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe("what is checked before the row is written", () => {
  it("the kind must be one of the four", async () => {
    for (const kind of ["", "mortgage", "LEASE", "ho6"]) expect((await tryRegister(f.adaUser, f.unit1, { kind })).code).toBe("22023");
    for (const kind of ["ho6_certificate", "lease", "proof_of_ownership", "other"]) {
      expect((await register(f.adaUser, f.unit1, { kind })).document_id).toBeTruthy();
    }
    const labels = (await rows<{ l: string }>(null, `select labels[1] as l from public.documents where restricted_to_unit_id = $1::uuid order by l`, [f.unit1])).map((r) => r.l);
    expect(labels).toEqual(["HO6 insurance certificate", "Lease", "Other", "Proof of ownership"]);
  });

  it("the path must be a unit document path for this very unit", async () => {
    const wrongUnit = pathFor(f.unit2, 701);
    const hub = `${f.damen}/1760000000000-abc123-file.pdf`;
    const ticket = `${f.damen}/tickets/${f.ticketCommon}/1760000000000-abc123-file.pdf`;
    const foreignAssoc = pathFor(f.unit1, 702, f.hoyne);
    for (const path of [wrongUnit, hub, ticket, foreignAssoc, "", "junk"]) {
      expect((await tryRegister(f.adaUser, f.unit1, { path })).code, path).toBe("22023");
    }
  });

  it("type, size, checksum and name are checked", async () => {
    expect((await tryRegister(f.adaUser, f.unit1, { mime: "application/zip" })).code).toBe("22023");
    expect((await tryRegister(f.adaUser, f.unit1, { size: 0 })).code).toBe("22023");
    expect((await tryRegister(f.adaUser, f.unit1, { size: 26214401 })).code).toBe("22023");
    expect((await tryRegister(f.adaUser, f.unit1, { checksum: "abc" })).code).toBe("22023");
    expect((await register(f.adaUser, f.unit1, { size: 26214400 })).document_id).toBeTruthy();
  });

  it("a retried registration of the same path returns the same document; another person's path is refused", async () => {
    const path = pathFor(f.unit1, 710);
    const first = await register(f.adaUser, f.unit1, { path, checksum: sha(710) });
    const again = await register(f.adaUser, f.unit1, { path, checksum: sha(710) });
    expect(again).toEqual({ document_id: first.document_id, duplicate: false });
    await addDee();
    expect((await tryRegister(DEE_USER, f.unit1, { path, checksum: sha(710) })).code).toBe("22023");
    expect(await count(`select 1 from public.documents where storage_path = '${path}'`)).toBe(1);
  });

  it("identical bytes: the same unit gets the existing document, anywhere else gets nothing about it", async () => {
    const first = await register(f.adaUser, f.unit1, { checksum: sha(720) });
    await addDee();
    const sameUnit = await register(DEE_USER, f.unit1, { checksum: sha(720) });
    expect(sameUnit).toEqual({ document_id: first.document_id, duplicate: true });
    const otherUnit = await register(f.boUser, f.unit2, { checksum: sha(720) });
    expect(otherUnit).toEqual({ document_id: null, duplicate: true });
    // A hub document with the same bytes is not revealed either.
    await db.query(
      `insert into public.documents (association_id, storage_path, filename, checksum, visibility) values ($1::uuid, $2, 'bylaws.pdf', $3, 'board_only')`,
      [f.damen, `${f.damen}/1760000000000-abc123-bylaws.pdf`, sha(721)],
    );
    expect(await register(f.adaUser, f.unit1, { checksum: sha(721) })).toEqual({ document_id: null, duplicate: true });
    expect(await count(`select 1 from public.documents where restricted_to_unit_id is not null`)).toBe(1);
  });

  it("at most 20 a day per person", async () => {
    for (let i = 0; i < 20; i++) await register(f.adaUser, f.unit1, { i: 1000 + i });
    expect(await tryRegister(f.adaUser, f.unit1, { i: 1100 })).toMatchObject({ code: "P0001", hint: "daily_limit" });
    // Someone else, and the next day, are not held up by it.
    expect((await register(f.boUser, f.unit2, { i: 1101 })).document_id).toBeTruthy();
  });

  it("at most 100 live documents per unit", async () => {
    const cat = (await one<{ id: string }>(null, `select id from public.document_categories where slug = 'unit_owner_upload' and association_id = $1::uuid`, [f.damen])).id;
    await db.query(
      `insert into public.documents (association_id, storage_path, filename, checksum, category_id, restricted_to_unit_id, uploaded_by, uploaded_at)
       select $1::uuid, $1::text || '/units/' || $2::text || '/' || g, 'f' || g, lpad(to_hex(g + 50000), 64, '0'), $3::uuid, $2::uuid, $4::uuid, now() - interval '3 days'
         from generate_series(1, 100) g`,
      [f.damen, f.unit2, cat, f.boUser],
    );
    expect(await tryRegister(f.boUser, f.unit2, { i: 1200 })).toMatchObject({ code: "P0001", hint: "unit_limit" });
    // Binned ones do not count.
    await db.query(`update public.documents set deleted_at = now() where storage_path like '%/units/%' and filename = 'f1'`);
    expect((await register(f.boUser, f.unit2, { i: 1201 })).document_id).toBeTruthy();
  });
});

describe("who can read them", () => {
  it("the uploader, the unit's other owners and the board; not other owners and not the accountant", async () => {
    await addDee();
    const { document_id: id } = await register(f.adaUser, f.unit1, { kind: "ho6_certificate" });
    expect(await readable(f.adaUser)).toEqual([id]);
    expect(await readable(f.cyUser)).toEqual([id]);
    expect(await readable(DEE_USER)).toEqual([id]);
    expect(await readable(f.boUser)).toEqual([]);
    expect(await readable(f.niaUser)).toEqual([]);
    expect(await readable(f.vicUser)).toEqual([]);
    expect(await readable(f.zaraUser)).toEqual([]);
  });

  it("the accountant cannot read it by id either, even when the document list is searched", async () => {
    const { document_id: id } = await register(f.adaUser, f.unit1);
    expect(await rows(f.niaUser, `select id from public.documents where id = $1::uuid`, [id])).toEqual([]);
    expect(await rows(f.niaUser, `select id from public.documents where to_tsvector('english', coalesce(title, '') || ' ' || filename) @@ plainto_tsquery('english', 'file')`)).toEqual([]);
  });

  it("a board-only document pinned to the unit stays readable by the unit's owner (documents_select, unchanged)", async () => {
    const id = (await one<{ id: string }>(null, `insert into public.documents (association_id, storage_path, filename, visibility, restricted_to_unit_id) values ($1::uuid, $2, 'notice.pdf', 'board_only', $3::uuid) returning id`, [f.damen, `${f.damen}/1760000000000-abc123-notice.pdf`, f.unit1])).id;
    expect(await readable(f.adaUser)).toEqual([id]);
    expect(await readable(f.boUser)).toEqual([]);
  });

  it("an owner who no longer owns the unit loses sight of it", async () => {
    const { document_id: id } = await register(f.adaUser, f.unit1);
    await db.query(`update public.unit_owners set effective_to = current_date - 1 where unit_id = $1::uuid and person_id = $2::uuid`, [f.unit1, f.adaPerson]);
    expect(await readable(f.adaUser)).toEqual([]);
    expect(await rows(f.adaUser, `select * from public.unit_owner_documents($1::uuid)`, [f.unit1])).toEqual([]);
    expect((await pgError(q(f.adaUser, `select public.remove_unit_document($1::uuid)`, [id]))).code).toBe("42501");
  });
});

describe("unit_owner_documents", () => {
  type Row = { document_id: string; kind: string; added_by_kind: string; added_by_name: string | null; can_remove: boolean; title: string };
  const list = (user: string, unit: string) => rows<Row>(user, `select * from public.unit_owner_documents($1::uuid)`, [unit]);

  it("lists a unit's documents to its owners and the board with the right labels, and to nobody else", async () => {
    await addDee();
    await boBoard(db, f);
    const ada = (await register(f.adaUser, f.unit1, { kind: "lease", title: "Lease 2026" })).document_id!;
    const board = (await register(f.cyUser, f.unit1, { kind: "other" })).document_id!;

    const mine = await list(f.adaUser, f.unit1);
    expect(mine.map((r) => r.document_id).sort()).toEqual([ada, board].sort());
    expect(mine.find((r) => r.document_id === ada)).toMatchObject({ kind: "Lease", added_by_kind: "you", added_by_name: null, can_remove: true, title: "Lease 2026" });
    expect(mine.find((r) => r.document_id === board)).toMatchObject({ added_by_kind: "board", added_by_name: null, can_remove: false });

    const coOwner = await list(DEE_USER, f.unit1);
    expect(coOwner.find((r) => r.document_id === ada)).toMatchObject({ added_by_kind: "owner", added_by_name: null, can_remove: false });

    const admin = await list(f.cyUser, f.unit1);
    expect(admin.find((r) => r.document_id === ada)).toMatchObject({ added_by_name: "Ada Okonkwo", can_remove: true });

    expect(await list(f.niaUser, f.unit1)).toEqual([]);
    expect(await list(f.zaraUser, f.unit1)).toEqual([]);
    expect(await list(f.adaUser, f.unit2)).toEqual([]);
    expect(await list(f.vicUser, f.unit1)).toEqual([]);
  });

  it("leaves out binned documents and documents in other categories", async () => {
    const id = (await register(f.adaUser, f.unit1)).document_id!;
    await db.query(`insert into public.documents (association_id, storage_path, filename, visibility, restricted_to_unit_id) values ($1::uuid, $2, 'notice.pdf', 'board_only', $3::uuid)`, [f.damen, `${f.damen}/1760000000000-abc123-notice.pdf`, f.unit1]);
    expect((await list(f.adaUser, f.unit1)).map((r) => r.document_id)).toEqual([id]);
    await db.query(`update public.documents set deleted_at = now() where id = $1::uuid`, [id]);
    expect(await list(f.adaUser, f.unit1)).toEqual([]);
  });
});

describe("the board's notices", () => {
  type Notice = { notice_id: string; document_id: string; unit_label: string; uploaded_by_name: string | null; kind: string };
  const notices = (user: string) => rows<Notice>(user, `select * from public.list_owner_document_notices($1::uuid)`, [f.damen]);

  it("an owner's upload gives the board a notice naming the unit, the owner and the kind", async () => {
    const id = (await register(f.adaUser, f.unit1, { kind: "ho6_certificate" })).document_id!;
    const list = await notices(f.cyUser);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ document_id: id, unit_label: "Unit 1", uploaded_by_name: "Ada Okonkwo", kind: "HO6 insurance certificate" });
  });

  it("owners and the accountant get no notices, from the function or the table", async () => {
    await register(f.adaUser, f.unit1);
    for (const user of [f.adaUser, f.boUser, f.niaUser, f.vicUser, f.zaraUser]) {
      expect(await notices(user)).toEqual([]);
      expect(await rows(user, `select * from public.owner_document_notices`)).toEqual([]);
    }
    expect(await rows(f.cyUser, `select * from public.owner_document_notices`)).toHaveLength(1);
  });

  it("nobody writes the table directly", async () => {
    const { document_id: id } = await register(f.adaUser, f.unit1);
    await expect(
      q(f.cyUser, `insert into public.owner_document_notices (association_id, document_id, unit_id) values ($1::uuid, $2::uuid, $3::uuid)`, [f.damen, id, f.unit1]),
    ).rejects.toThrow(/row-level security/i);
    expect((await q(f.cyUser, `update public.owner_document_notices set seen_at = now()`)).affectedRows).toBe(0);
    expect((await q(f.cyUser, `delete from public.owner_document_notices`)).affectedRows).toBe(0);
  });

  it("only the board marks them seen, and a seen notice leaves the list", async () => {
    await register(f.adaUser, f.unit1);
    await register(f.boUser, f.unit2);
    const [first] = await notices(f.cyUser);
    expect((await pgError(q(f.adaUser, `select public.mark_owner_document_notices_seen($1::uuid)`, [f.damen]))).code).toBe("42501");
    expect((await pgError(q(f.niaUser, `select public.mark_owner_document_notices_seen($1::uuid)`, [f.damen]))).code).toBe("42501");
    expect((await pgError(q(f.zaraUser, `select public.mark_owner_document_notices_seen($1::uuid)`, [f.damen]))).code).toBe("42501");

    const one1 = await one<{ c: number }>(f.cyUser, `select public.mark_owner_document_notices_seen($1::uuid, array[$2::uuid]) as c`, [f.damen, first.notice_id]);
    expect(one1.c).toBe(1);
    expect(await notices(f.cyUser)).toHaveLength(1);
    const rest = await one<{ c: number }>(f.cyUser, `select public.mark_owner_document_notices_seen($1::uuid) as c`, [f.damen]);
    expect(rest.c).toBe(1);
    expect(await notices(f.cyUser)).toEqual([]);
  });

  it("a removed document drops out of the list", async () => {
    const id = (await register(f.adaUser, f.unit1)).document_id!;
    await q(f.adaUser, `select public.remove_unit_document($1::uuid)`, [id]);
    expect(await notices(f.cyUser)).toEqual([]);
  });
});

describe("removing a document", () => {
  const remove = (user: string, id: string) => q(user, `select public.remove_unit_document($1::uuid)`, [id]);
  const deleted = async (id: string) => (await one<{ d: boolean }>(null, `select deleted_at is not null as d from public.documents where id = $1::uuid`, [id])).d;

  it("an owner removes their own upload (a soft delete)", async () => {
    const id = (await register(f.adaUser, f.unit1)).document_id!;
    await remove(f.adaUser, id);
    expect(await deleted(id)).toBe(true);
    // Still there for the board's trash.
    expect(await rows(f.cyUser, `select id from public.documents where id = $1::uuid`, [id])).toHaveLength(1);
    expect(await rows(f.adaUser, `select id from public.documents where id = $1::uuid`, [id])).toHaveLength(0);
    expect((await pgError(remove(f.adaUser, id))).code).toBe("42501");
  });

  it("not someone else's upload, not another unit's, not the accountant", async () => {
    await addDee();
    const id = (await register(f.adaUser, f.unit1)).document_id!;
    for (const user of [DEE_USER, f.boUser, f.niaUser, f.vicUser, f.zaraUser]) {
      expect((await pgError(remove(user, id))).code, user).toBe("42501");
    }
    expect(await deleted(id)).toBe(false);
  });

  it("an owner cannot remove it after 30 days; the board can bin any at any time", async () => {
    const id = (await register(f.adaUser, f.unit1)).document_id!;
    await db.query(`update public.documents set uploaded_at = now() - interval '31 days' where id = $1::uuid`, [id]);
    const e = await pgError(remove(f.adaUser, id));
    expect(e).toMatchObject({ code: "42501", hint: "window_closed" });
    const list = await rows<{ can_remove: boolean }>(f.adaUser, `select can_remove from public.unit_owner_documents($1::uuid)`, [f.unit1]);
    expect(list).toEqual([{ can_remove: false }]);
    await remove(f.cyUser, id);
    expect(await deleted(id)).toBe(true);
  });

  it("29 days is still inside the window", async () => {
    const id = (await register(f.adaUser, f.unit1)).document_id!;
    await db.query(`update public.documents set uploaded_at = now() - interval '29 days' where id = $1::uuid`, [id]);
    await remove(f.adaUser, id);
    expect(await deleted(id)).toBe(true);
  });

  it("only unit documents: any other document is refused, for the board too", async () => {
    const other = (await one<{ id: string }>(null, `insert into public.documents (association_id, storage_path, filename, visibility, restricted_to_unit_id, uploaded_by) values ($1::uuid, $2, 'notice.pdf', 'board_only', $3::uuid, $4::uuid) returning id`, [f.damen, `${f.damen}/1760000000000-abc123-notice.pdf`, f.unit1, f.adaUser])).id;
    expect((await pgError(remove(f.adaUser, other))).code).toBe("42501");
    expect((await pgError(remove(f.cyUser, other))).code).toBe("42501");
    expect((await pgError(remove(f.cyUser, "aaaa1111-0000-0000-0000-0000000000ee"))).code).toBe("42501");
  });
});

describe("the functions and the path", () => {
  it("anon cannot execute any of them", async () => {
    for (const fn of [
      "register_unit_document(uuid, text, text, text, bigint, text, text, text)",
      "unit_owner_documents(uuid)",
      "remove_unit_document(uuid)",
      "list_owner_document_notices(uuid)",
      "mark_owner_document_notices_seen(uuid, uuid[])",
      "unit_document_association_id(uuid)",
      "unit_document_upload_allowed(text)",
    ]) {
      const r = await one<{ ok: boolean }>(null, `select has_function_privilege('anon', 'public.${fn}', 'execute') as ok`);
      expect(r.ok, fn).toBe(false);
    }
  });

  it("unit_document_association_id answers only for the board and the unit's owners", async () => {
    const ask = (user: string, unit: string) => one<{ a: string | null }>(user, `select public.unit_document_association_id($1::uuid) as a`, [unit]).then((r) => r.a);
    expect(await ask(f.adaUser, f.unit1)).toBe(f.damen);
    expect(await ask(f.cyUser, f.unit2)).toBe(f.damen);
    expect(await ask(f.adaUser, f.unit2)).toBeNull();
    expect(await ask(f.niaUser, f.unit1)).toBeNull();
    expect(await ask(f.zaraUser, f.unit1)).toBeNull();
  });

  it("unit_document_path recognises exactly the unit document shape", async () => {
    const parse = (name: string) => rows<{ association_id: string; unit_id: string }>(null, `select * from public.unit_document_path($1)`, [name]);
    expect(await parse(pathFor(f.unit1, 1))).toEqual([{ association_id: f.damen, unit_id: f.unit1 }]);
    for (const bad of ["", `${f.damen}/units/${f.unit1}/a.pdf`, `${f.damen}/unit/${f.unit1}/1760000000000-abc123-a.pdf`, `${f.damen}/units/x/1760000000000-abc123-a.pdf`]) {
      expect(await parse(bad)).toEqual([]);
    }
    // Hub documents and ticket photos are not unit documents, and unit documents are not either of those.
    for (const c of STORAGE_PATH_CASES) expect(await parse(c.name), c.name).toEqual([]);
    expect(await rows(null, `select * from public.storage_path_kind($1)`, [pathFor(f.unit1, 1)])).toEqual([]);
  });

  it("unit_document_upload_allowed refuses a path that already has a document", async () => {
    const allowed = (user: string, name: string) => one<{ ok: boolean }>(user, `select public.unit_document_upload_allowed($1) as ok`, [name]).then((r) => r.ok);
    expect(await allowed(f.adaUser, pathFor(f.unit1, 2))).toBe(true);
    expect(await allowed(f.adaUser, pathFor(f.unit2, 2))).toBe(false);
    expect(await allowed(f.niaUser, pathFor(f.unit1, 2))).toBe(false);
    expect(await allowed(f.cyUser, pathFor(f.unit2, 2))).toBe(true);
    const path = pathFor(f.unit1, 3);
    await register(f.adaUser, f.unit1, { path, checksum: sha(3) });
    expect(await allowed(f.adaUser, path)).toBe(false);
  });
});
