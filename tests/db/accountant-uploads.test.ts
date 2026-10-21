import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { addStorageStub, asUser } from "./harness";
import { pgError, queries, seededDb } from "./repairs-helpers";
import type { Fixture } from "./fixtures";

/**
 * Migration 0081, part A: the accountant adds documents in five accounting categories, and removes their own
 * for 30 days. Nothing else about document writes changes: the board's policies are untouched, and the
 * accountant still has no insert, update or delete policy on documents (register and remove are definer
 * functions). The storage policies are Supabase only, so what is proved here is the helper functions behind
 * them, against the storage stub.
 */

let db: PGlite;
let f: Fixture;
const { q, one, rows, count } = queries(() => db);

const ANN_USER = "dddd0000-0000-0000-0000-0000000000c1"; // a second accountant, to prove "own"
const ANN_PERSON = "eeee0000-0000-0000-0000-0000000000c1";

const CATEGORIES = ["tax_form", "financial_statement", "bank_statement", "invoice", "receipt"] as const;
const OTHER_CATEGORIES = ["insurance", "vendor_document", "governing", "minutes", "contract", "correspondence", "legal_notice", "permit", "maintenance", "unit_record", "unit_owner_upload", "other"];

afterEach(async () => {
  await db?.close();
});

beforeEach(async () => {
  ({ db, f } = await seededDb());
});

let n = 0;
const sha = (i: number) => i.toString(16).padStart(64, "0");
const pathFor = (i: number, assoc: string = f.damen) => `${assoc}/${1760000000000 + i}-${String(i).padStart(6, "a").slice(-6)}-file${i}.pdf`;

type Registered = { document_id: string | null; duplicate: boolean };

async function register(
  user: string,
  o: { i?: number; path?: string; checksum?: string; category?: string | null; mime?: string; size?: number; title?: string | null; filename?: string } = {},
): Promise<Registered> {
  const i = o.i ?? ++n;
  return one<Registered>(
    user,
    `select * from public.register_accountant_document($1, $2, $3, $4::bigint, $5, $6, $7)`,
    [
      o.path ?? pathFor(i),
      o.filename ?? `file${i}.pdf`,
      o.mime ?? "application/pdf",
      o.size ?? 1000,
      o.checksum ?? sha(i),
      o.category === undefined ? "invoice" : o.category,
      o.title ?? null,
    ],
  );
}
const tryRegister = (user: string, o: Parameters<typeof register>[1] = {}) => pgError(register(user, o));
const remove = (user: string, id: string) => q(user, `select public.remove_accountant_upload($1::uuid)`, [id]);
const tryRemove = (user: string, id: string) => pgError(remove(user, id));

async function addAnn() {
  await db.query(`insert into auth.users (id, email) values ($1::uuid, 'ann@example.test')`, [ANN_USER]);
  await db.query(
    `insert into public.persons (id, association_id, full_name, email, auth_user_id) values ($1::uuid, $2::uuid, 'Ann Ledger', 'ann@example.test', $3::uuid)`,
    [ANN_PERSON, f.damen, ANN_USER],
  );
  await db.query(
    `insert into public.role_grants (association_id, person_id, role, granted_on, expires_on) values ($1::uuid, $2::uuid, 'accountant', current_date, current_date + 90)`,
    [f.damen, ANN_PERSON],
  );
}

const category = async (slug: string, assoc: string = f.damen) =>
  (await one<{ id: string }>(null, `select id from public.document_categories where association_id = $1::uuid and slug = $2`, [assoc, slug])).id;

/** A document filed by the board straight into the table, as the hub does. */
async function boardDoc(slug: string, i: number, o: { unit?: string | null; uploadedBy?: string | null } = {}) {
  return (
    await one<{ id: string }>(
      null,
      `insert into public.documents (association_id, storage_path, filename, checksum, category_id, restricted_to_unit_id, uploaded_by, visibility)
       values ($1::uuid, $2, $3, $4, $5::uuid, $6::uuid, $7::uuid, 'board_only') returning id`,
      [f.damen, pathFor(i), `board${i}.pdf`, sha(i), await category(slug), o.unit ?? null, o.uploadedBy === undefined ? f.cyUser : o.uploadedBy],
    )
  ).id;
}

describe("what the accountant can add", () => {
  it("a file in each of the five categories, filed the way the feature promises", async () => {
    for (const slug of CATEGORIES) {
      const r = await register(f.niaUser, { category: slug, title: "  Q3  " });
      expect(r).toMatchObject({ duplicate: false });
      const d = await one<Record<string, unknown>>(
        null,
        `select d.visibility, d.restricted_to_unit_id, d.tag_source, d.review_state, d.extraction_state, d.source, d.title, d.uploaded_by, d.deleted_at, c.slug
           from public.documents d join public.document_categories c on c.id = d.category_id where d.id = $1::uuid`,
        [r.document_id],
      );
      expect(d, slug).toMatchObject({
        visibility: "board_only",
        restricted_to_unit_id: null,
        tag_source: "manual",
        review_state: "ok",
        extraction_state: "skipped",
        source: "upload",
        title: "Q3",
        uploaded_by: f.niaUser,
        deleted_at: null,
        slug,
      });
    }
  });

  it("a financial statement stays board only even though the category's default is all owners", async () => {
    const r = await register(f.niaUser, { category: "financial_statement" });
    expect((await one<{ visibility: string }>(null, `select visibility from public.documents where id = $1::uuid`, [r.document_id])).visibility).toBe("board_only");
    expect(await rows(f.adaUser, `select 1 from public.documents where id = $1::uuid`, [r.document_id])).toEqual([]);
  });

  it("no other category, no 'decide later', no unknown name", async () => {
    for (const slug of [...OTHER_CATEGORIES, "", "TAX_FORM", "nonsense"]) {
      const e = await tryRegister(f.niaUser, { category: slug });
      expect(e, slug).toMatchObject({ code: "22023", hint: "category" });
    }
    expect((await tryRegister(f.niaUser, { category: null })).hint).toBe("category");
    expect(await count(`select 1 from public.documents where uploaded_by = '${f.niaUser}'`)).toBe(0);
  });

  it("not for a unit: the function has no unit argument, and a unit path is not a hub path", async () => {
    const unitPath = `${f.damen}/units/${f.unit1}/1760000000000-abc123-file.pdf`;
    expect((await tryRegister(f.niaUser, { path: unitPath })).code).toBe("22023");
    const fn = await one<{ args: string }>(null, `select pg_get_function_identity_arguments('public.register_accountant_document'::regproc) as args`);
    expect(fn.args).not.toMatch(/unit/i);
  });

  it("only a hub path: ticket photo paths and junk are refused", async () => {
    const ticket = `${f.damen}/tickets/${f.ticketCommon}/1760000000000-abc123-file.pdf`;
    for (const path of [ticket, "", "junk", `${f.damen}/x.pdf`]) expect((await tryRegister(f.niaUser, { path })).code, path).toBe("22023");
  });
});

describe("who may register", () => {
  it("an expired accountant, an owner, a board admin and an accountant of another building may not", async () => {
    for (const user of [f.vicUser, f.adaUser, f.cyUser, f.zaraUser]) expect((await tryRegister(user)).code, user).toBe("42501");
    expect(await count(`select 1 from public.documents where storage_path like '%file%'`)).toBe(0);
  });

  it("an accountant of another building cannot register under this building's path", async () => {
    expect((await tryRegister(f.niaUser, { path: pathFor(1, f.hoyne) })).code).toBe("42501");
  });

  it("a password-only (aal1) session may not", async () => {
    await expect(
      asUser(db, f.niaUser, () => db.query(`select * from public.register_accountant_document($1, 'a.pdf', 'application/pdf', 10, $2, 'invoice', null)`, [pathFor(900), sha(900)]), { aal: "aal1" }),
    ).rejects.toThrow(/add documents here/i);
  });

  it("a signed-out caller may not", async () => {
    const e = await pgError(db.query(`select * from public.register_accountant_document($1, 'a.pdf', 'application/pdf', 10, $2, 'invoice', null)`, [pathFor(901), sha(901)]));
    expect(e.code).toBe("42501");
  });
});

describe("what is checked before the row is written", () => {
  it("type, size, checksum and name", async () => {
    expect((await tryRegister(f.niaUser, { mime: "application/zip" })).code).toBe("22023");
    expect((await tryRegister(f.niaUser, { size: 0 })).code).toBe("22023");
    expect((await tryRegister(f.niaUser, { size: 26214401 })).code).toBe("22023");
    expect((await tryRegister(f.niaUser, { checksum: "abc" })).code).toBe("22023");
    expect((await tryRegister(f.niaUser, { filename: "   " })).code).toBe("22023");
    expect((await register(f.niaUser, { size: 26214400 })).document_id).toBeTruthy();
  });

  it("a retried registration of the same path returns the same document; another accountant's path is refused", async () => {
    await addAnn();
    const path = pathFor(710);
    const first = await register(f.niaUser, { path, checksum: sha(710) });
    expect(await register(f.niaUser, { path, checksum: sha(710) })).toEqual({ document_id: first.document_id, duplicate: false });
    expect((await tryRegister(ANN_USER, { path, checksum: sha(710) })).code).toBe("22023");
    expect(await count(`select 1 from public.documents where storage_path = '${path}'`)).toBe(1);
  });

  it("identical bytes: a document the accountant reads is returned, anything else reveals nothing", async () => {
    const taxId = await boardDoc("tax_form", 720);
    expect(await register(f.niaUser, { checksum: sha(720) })).toEqual({ document_id: taxId, duplicate: true });
    await boardDoc("contract", 721);
    expect(await register(f.niaUser, { checksum: sha(721) })).toEqual({ document_id: null, duplicate: true });
    await boardDoc("invoice", 722, { unit: f.unit1 });
    expect((await register(f.niaUser, { checksum: sha(722) })).duplicate).toBe(true);
    expect(await count(`select 1 from public.documents where uploaded_by = '${f.niaUser}'`)).toBe(0);
  });

  it("a binned document with the same bytes does not block a new upload", async () => {
    const id = await boardDoc("invoice", 730);
    await db.query(`update public.documents set deleted_at = now() where id = $1::uuid`, [id]);
    expect((await register(f.niaUser, { checksum: sha(730) })).document_id).toBeTruthy();
  });

  it("at most 20 a day per person", async () => {
    await addAnn();
    for (let i = 0; i < 20; i++) await register(f.niaUser, { i: 1000 + i });
    expect(await tryRegister(f.niaUser, { i: 1100 })).toMatchObject({ code: "P0001", hint: "daily_limit" });
    expect((await register(ANN_USER, { i: 1101 })).document_id).toBeTruthy();
  });

  it("with a storage object: must exist, be the caller's, and match the size and type", async () => {
    await addStorageStub(db);
    const put = (path: string, o: { owner?: string; size?: number; mime?: string } = {}) =>
      db.query(`insert into storage.objects (bucket_id, name, owner_id, metadata) values ('documents', $1, $2, $3::jsonb)`, [
        path,
        o.owner ?? f.niaUser,
        JSON.stringify({ size: o.size ?? 1000, mimetype: o.mime ?? "application/pdf" }),
      ]);

    expect(await tryRegister(f.niaUser, { i: 1 })).toMatchObject({ code: "22023", hint: "not_uploaded" });
    await put(pathFor(2), { owner: f.cyUser });
    expect((await tryRegister(f.niaUser, { i: 2 })).hint).toBe("not_uploaded");
    await put(pathFor(3), { size: 999 });
    expect((await tryRegister(f.niaUser, { i: 3 })).hint).toBe("not_uploaded");
    await put(pathFor(4), { mime: "image/png" });
    expect((await tryRegister(f.niaUser, { i: 4 })).hint).toBe("not_uploaded");
    await put(pathFor(5), { mime: "application/pdf; charset=binary" });
    expect((await register(f.niaUser, { i: 5 })).document_id).toBeTruthy();
  });
});

describe("what the storage policies ask", () => {
  beforeEach(async () => {
    await addStorageStub(db);
  });
  const allowed = async (user: string, name: string) =>
    (await one<{ ok: boolean }>(user, `select public.accountant_upload_allowed($1) as ok`, [name])).ok;
  const pendingOk = async (user: string, name: string) =>
    (await one<{ ok: boolean }>(user, `select public.accountant_upload_pending_allowed($1) as ok`, [name])).ok;

  it("the accountant may upload a hub path in their own building, and nothing else", async () => {
    expect(await allowed(f.niaUser, pathFor(1))).toBe(true);
    expect(await allowed(f.niaUser, pathFor(1, f.hoyne))).toBe(false);
    expect(await allowed(f.niaUser, `${f.damen}/tickets/${f.ticketCommon}/1760000000000-abc123-p.jpg`)).toBe(false);
    expect(await allowed(f.niaUser, `${f.damen}/units/${f.unit1}/1760000000000-abc123-p.pdf`)).toBe(false);
    expect(await allowed(f.niaUser, "../x")).toBe(false);
  });

  it("an expired accountant, an owner and a signed-out caller may not", async () => {
    for (const user of [f.vicUser, f.adaUser, f.zaraUser]) expect(await allowed(user, pathFor(1)), user).toBe(false);
    expect((await one<{ ok: boolean }>(null, `select public.accountant_upload_allowed($1) as ok`, [pathFor(1)])).ok).toBe(false);
  });

  it("a path that already has a document is closed to a second upload", async () => {
    const r = await register(f.niaUser, { i: 7 }).catch(() => null);
    expect(r).toBeNull(); // no stored object yet
    await db.query(`insert into storage.objects (bucket_id, name, owner_id, metadata) values ('documents', $1, $2, '{"size":1000,"mimetype":"application/pdf"}'::jsonb)`, [pathFor(7), f.niaUser]);
    await register(f.niaUser, { i: 7 });
    expect(await allowed(f.niaUser, pathFor(7))).toBe(false);
    expect(await pendingOk(f.niaUser, pathFor(7))).toBe(false);
  });

  it("the 31st unregistered upload in a day is refused", async () => {
    await db.query(
      `insert into storage.objects (bucket_id, name, owner_id, metadata)
       select 'documents', $1::text || '/' || (1760000000000 + g)::text || '-abcdef-f' || g || '.pdf', $2, '{}'::jsonb from generate_series(1, 30) g`,
      [f.damen, f.niaUser],
    );
    expect(await allowed(f.niaUser, pathFor(500))).toBe(false);
    // One fewer and the next is allowed again.
    await db.query(`delete from storage.objects where name like '%-f30.pdf'`);
    expect(await allowed(f.niaUser, pathFor(500))).toBe(true);
  });

  it("an unregistered object may be read and deleted back only by the accountant's own path rules", async () => {
    expect(await pendingOk(f.niaUser, pathFor(8))).toBe(true);
    expect(await pendingOk(f.niaUser, pathFor(8, f.hoyne))).toBe(false);
    expect(await pendingOk(f.vicUser, pathFor(8))).toBe(false);
    expect(await pendingOk(f.adaUser, pathFor(8))).toBe(false);
  });
});

describe("what the accountant still cannot do to documents", () => {
  it("insert, update or delete a document directly", async () => {
    const mine = (await register(f.niaUser, { category: "tax_form" })).document_id!;
    const cat = await category("invoice");
    await expect(
      q(f.niaUser, `insert into public.documents (association_id, storage_path, filename, category_id) values ($1::uuid, $2, 'x.pdf', $3::uuid)`, [f.damen, pathFor(800), cat]),
    ).rejects.toThrow(/row-level security/i);
    for (const set of [`title = 'Renamed'`, `visibility = 'all_owners'`, `category_id = '${cat}'`, `deleted_at = now()`, `extraction_state = 'pending'`, `labels = array['x']`]) {
      expect((await q(f.niaUser, `update public.documents set ${set} where id = $1::uuid`, [mine])).affectedRows, set).toBe(0);
    }
    expect((await q(f.niaUser, `delete from public.documents where id = $1::uuid`, [mine])).affectedRows).toBe(0);
    expect(await count(`select 1 from public.documents where id = '${mine}' and title <> 'Renamed' and deleted_at is null`)).toBe(1);
  });

  it("change anyone else's document, or reach an unreadable category", async () => {
    const theirs = await boardDoc("tax_form", 810);
    const contract = await boardDoc("contract", 811);
    expect((await q(f.niaUser, `update public.documents set title = 'x' where id = $1::uuid`, [theirs])).affectedRows).toBe(0);
    expect(await rows(f.niaUser, `select 1 from public.documents where id = $1::uuid`, [contract])).toEqual([]);
  });

  it("share with all owners (the visibility guard still refuses it) or refile", async () => {
    const mine = (await register(f.niaUser)).document_id!;
    const e = await pgError(q(f.cyUser, `update public.documents set visibility = 'all_owners' where id = $1::uuid`, [mine]));
    expect(e.message).toMatch(/shared with all owners/i);
    expect((await q(f.niaUser, `update public.documents set category_id = null where id = $1::uuid`, [mine])).affectedRows).toBe(0);
  });
});

describe("who can read an accountant's upload", () => {
  it("the accountant who added it, the other accountant and the board; not owners, not an expired accountant", async () => {
    await addAnn();
    const id = (await register(f.niaUser, { category: "bank_statement" })).document_id!;
    const sees = async (user: string) => (await rows(user, `select 1 from public.documents where id = $1::uuid`, [id])).length;
    expect(await sees(f.niaUser)).toBe(1);
    expect(await sees(ANN_USER)).toBe(1);
    expect(await sees(f.cyUser)).toBe(1);
    expect(await sees(f.adaUser)).toBe(0);
    expect(await sees(f.vicUser)).toBe(0);
    expect(await sees(f.zaraUser)).toBe(0);
  });
});

describe("removing your own upload", () => {
  it("within 30 days: the accountant no longer sees it, the board still does, in the bin", async () => {
    const id = (await register(f.niaUser)).document_id!;
    await remove(f.niaUser, id);
    expect((await one<{ deleted_at: string | null }>(null, `select deleted_at from public.documents where id = $1::uuid`, [id])).deleted_at).not.toBeNull();
    expect(await rows(f.niaUser, `select 1 from public.documents where id = $1::uuid`, [id])).toEqual([]);
    expect(await rows(f.cyUser, `select 1 from public.documents where id = $1::uuid and deleted_at is not null`, [id])).toHaveLength(1);
  });

  it("on day 29 yes, after day 30 no", async () => {
    const recent = (await register(f.niaUser)).document_id!;
    const old = (await register(f.niaUser)).document_id!;
    await db.query(`update public.documents set uploaded_at = now() - interval '29 days' where id = $1::uuid`, [recent]);
    await db.query(`update public.documents set uploaded_at = now() - interval '31 days' where id = $1::uuid`, [old]);
    await remove(f.niaUser, recent);
    expect(await tryRemove(f.niaUser, old)).toMatchObject({ code: "42501", hint: "window_closed" });
    expect(await count(`select 1 from public.documents where id = '${old}' and deleted_at is null`)).toBe(1);
  });

  it("not someone else's: the board's, an owner's, or another accountant's", async () => {
    await addAnn();
    const boards = await boardDoc("tax_form", 820);
    const annDoc = (await register(ANN_USER)).document_id!;
    for (const id of [boards, annDoc]) expect((await tryRemove(f.niaUser, id)).code, id).toBe("42501");
    expect(await count(`select 1 from public.documents where deleted_at is not null`)).toBe(0);
  });

  it("not once the accountant's access has ended, and not by an owner or a signed-out caller", async () => {
    const id = (await register(f.niaUser)).document_id!;
    await db.query(`update public.role_grants set granted_on = current_date - 100, expires_on = current_date - 1 where person_id = $1::uuid`, [f.niaPerson]);
    expect((await tryRemove(f.niaUser, id)).code).toBe("42501");
    expect((await tryRemove(f.adaUser, id)).code).toBe("42501");
    expect((await pgError(db.query(`select public.remove_accountant_upload($1::uuid)`, [id]))).code).toBe("42501");
  });

  it("not a document in another category, a unit document, a binned one or one that does not exist", async () => {
    const insurance = await boardDoc("insurance", 830, { uploadedBy: f.niaUser });
    const pinned = await boardDoc("invoice", 831, { unit: f.unit1, uploadedBy: f.niaUser });
    const binned = (await register(f.niaUser)).document_id!;
    await db.query(`update public.documents set deleted_at = now() where id = $1::uuid`, [binned]);
    for (const id of [insurance, pinned, binned, "aaaa1111-0000-0000-0000-0000000000ff"]) expect((await tryRemove(f.niaUser, id)).code, id).toBe("42501");
  });

  it("a password-only (aal1) session may not", async () => {
    const id = (await register(f.niaUser)).document_id!;
    await expect(asUser(db, f.niaUser, () => db.query(`select public.remove_accountant_upload($1::uuid)`, [id]), { aal: "aal1" })).rejects.toThrow(/can't remove/i);
  });

  it("the board can still restore it, which the accountant cannot", async () => {
    const id = (await register(f.niaUser)).document_id!;
    await remove(f.niaUser, id);
    expect((await q(f.niaUser, `update public.documents set deleted_at = null where id = $1::uuid`, [id])).affectedRows).toBe(0);
    expect((await q(f.cyUser, `update public.documents set deleted_at = null where id = $1::uuid`, [id])).affectedRows).toBe(1);
  });
});

describe("the board is unchanged", () => {
  it("still adds, renames and bins documents directly", async () => {
    const cat = await category("contract");
    const id = (
      await one<{ id: string }>(f.cyUser, `insert into public.documents (association_id, storage_path, filename, category_id) values ($1::uuid, $2, 'c.pdf', $3::uuid) returning id`, [f.damen, pathFor(840), cat])
    ).id;
    expect((await q(f.cyUser, `update public.documents set title = 'Renamed' where id = $1::uuid`, [id])).affectedRows).toBe(1);
    expect((await q(f.cyUser, `update public.documents set deleted_at = now() where id = $1::uuid`, [id])).affectedRows).toBe(1);
  });
});

describe("function privileges", () => {
  const fns = [
    "accountant_upload_category(text)",
    "accountant_upload_association_id(text)",
    "accountant_upload_pending_count(uuid)",
    "accountant_upload_allowed(text)",
    "accountant_upload_pending_allowed(text)",
    "register_accountant_document(text, text, text, bigint, text, text, text)",
    "remove_accountant_upload(uuid)",
  ];

  it("none is callable by a signed-out visitor, all by a signed-in one", async () => {
    for (const fn of fns) {
      const r = await one<{ anon: boolean; auth: boolean }>(
        null,
        `select has_function_privilege('anon', 'public.${fn}'::regprocedure, 'execute') as anon,
                has_function_privilege('authenticated', 'public.${fn}'::regprocedure, 'execute') as auth`,
      );
      expect(r, fn).toEqual({ anon: false, auth: true });
    }
  });

  it("each pins search_path to empty", async () => {
    for (const fn of fns) {
      const r = await one<{ cfg: string[] | null }>(null, `select proconfig as cfg from pg_proc where oid = 'public.${fn}'::regprocedure`);
      expect((r.cfg ?? []).some((c) => c.startsWith("search_path=")), fn).toBe(true);
    }
  });

  it("the category list in SQL is the five in the unit test's list", async () => {
    const accepted = (
      await rows<{ slug: string }>(null, `select slug from public.document_categories where association_id = $1::uuid and public.accountant_upload_category(slug)`, [f.damen])
    ).map((r) => r.slug);
    expect(accepted.sort()).toEqual([...CATEGORIES].sort());
  });
});
