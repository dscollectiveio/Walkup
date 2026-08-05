import { beforeEach, afterEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

/**
 * Migration 0019 — documents in the audit log, and the uploader recorded.
 *
 * The storage half of 0019 cannot be tested here: PGlite has no storage
 * schema, which is exactly why that block is guarded. What IS testable is that
 * the guard works — the migration applies cleanly with no storage schema at
 * all, which every test in this file depends on to even reach `beforeEach`.
 * The bucket and its policies must be verified against Supabase (DECISIONS #21).
 */
describe("document storage and audit (0019)", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
  });

  afterEach(async () => {
    await db.close();
  });

  async function uploadAs(userId: string, filename: string) {
    return asUser(db, userId, () =>
      db.query<{ id: string }>(
        `insert into documents (association_id, storage_path, filename, mime_type, byte_size)
         values ($1, $2, $3, 'application/pdf', 1024)
         returning id`,
        [f.damen, `${f.damen}/${filename}`, filename],
      ),
    );
  }

  it("records who uploaded a document without being told", async () => {
    // uploaded_by is never set by the application. Before 0019 every row was
    // null; the default is what makes it impossible to forget.
    const { rows } = await uploadAs(f.cyUser, "declaration.pdf");

    const { rows: docs } = await db.query<{ uploaded_by: string }>(
      `select uploaded_by from documents where id = $1`,
      [rows[0].id],
    );
    expect(docs[0].uploaded_by).toBe(f.cyUser);
  });

  it("logs an upload to the audit trail", async () => {
    const { rows } = await uploadAs(f.cyUser, "minutes.pdf");

    const { rows: log } = await db.query<{
      action: string;
      actor_user_id: string;
      after_data: Record<string, unknown>;
    }>(
      `select action, actor_user_id, after_data
         from audit_log
        where table_name = 'documents' and record_id = $1`,
      [rows[0].id],
    );

    expect(log).toHaveLength(1);
    expect(log[0].action).toBe("insert");
    expect(log[0].actor_user_id).toBe(f.cyUser);
    expect(log[0].after_data.filename).toBe("minutes.pdf");
  });

  it("logs a hard delete, so the declaration cannot vanish silently", async () => {
    // This is the gap 0019 exists to close: board_admin has had DELETE on
    // documents since 0002 and it left no trace at all.
    const { rows } = await uploadAs(f.cyUser, "declaration.pdf");
    const id = rows[0].id;

    await asUser(db, f.cyUser, () =>
      db.query(`delete from documents where id = $1`, [id]),
    );

    const { rows: log } = await db.query<{ action: string; before_data: Record<string, unknown> }>(
      `select action, before_data from audit_log
        where table_name = 'documents' and record_id = $1 and action = 'delete'`,
      [id],
    );
    expect(log).toHaveLength(1);
    expect(log[0].before_data.filename).toBe("declaration.pdf");
  });

  it("logs a rename as an update", async () => {
    const { rows } = await uploadAs(f.cyUser, "scan001.pdf");
    const id = rows[0].id;

    await asUser(db, f.cyUser, () =>
      db.query(`update documents set filename = 'Insurance certificate.pdf' where id = $1`, [id]),
    );

    const { rows: log } = await db.query<{
      before_data: Record<string, unknown>;
      after_data: Record<string, unknown>;
    }>(
      `select before_data, after_data from audit_log
        where table_name = 'documents' and record_id = $1 and action = 'update'`,
      [id],
    );
    expect(log).toHaveLength(1);
    expect(log[0].before_data.filename).toBe("scan001.pdf");
    expect(log[0].after_data.filename).toBe("Insurance certificate.pdf");
  });

  it("never copies document contents into the audit log", async () => {
    // Forward-looking: extracted_text and extraction arrive in 0020. Auditing
    // them verbatim would make audit_log a permanent second copy of every
    // document — including a W-9's full SSN, which DECISIONS #4 keeps out of
    // this database on purpose. Trivially true today; a regression guard once
    // those columns exist.
    const { rows } = await uploadAs(f.cyUser, "w9.pdf");

    const { rows: log } = await db.query<{ after_data: Record<string, unknown> }>(
      `select after_data from audit_log
        where table_name = 'documents' and record_id = $1`,
      [rows[0].id],
    );
    expect(log[0].after_data).not.toHaveProperty("extracted_text");
    expect(log[0].after_data).not.toHaveProperty("extraction");
  });

  it("logs link changes, since a link is what makes a document evidence", async () => {
    const { rows } = await uploadAs(f.cyUser, "invoice.pdf");

    const { rows: link } = await asUser(db, f.cyUser, () =>
      db.query<{ id: string }>(
        `insert into document_links (association_id, document_id, target_table, target_id, relation)
         values ($1, $2, 'associations', $1, 'invoice') returning id`,
        [f.damen, rows[0].id],
      ),
    );

    await asUser(db, f.cyUser, () =>
      db.query(`delete from document_links where id = $1`, [link[0].id]),
    );

    const { rows: log } = await db.query<{ action: string }>(
      `select action from audit_log
        where table_name = 'document_links' and record_id = $1
        order by occurred_at`,
      [link[0].id],
    );
    expect(log.map((r) => r.action)).toEqual(["insert", "delete"]);
  });

  it("keeps the audit trigger off the public API", async () => {
    // Same posture as every trigger function since 0007.
    for (const role of ["anon", "authenticated"]) {
      const { rows } = await db.query<{ ok: boolean }>(
        `select has_function_privilege($1, 'public.tg_audit_document()', 'execute') as ok`,
        [role],
      );
      expect(rows[0].ok, `${role} must not execute tg_audit_document`).toBe(false);
    }
  });

  it("indexes the ordering the documents list actually uses", async () => {
    const { rows } = await db.query<{ indexname: string }>(
      `select indexname from pg_indexes
        where schemaname = 'public' and indexname = 'documents_association_uploaded_idx'`,
    );
    expect(rows).toHaveLength(1);
  });

  it("hides a document from owners unless something says otherwise", async () => {
    // 0020 opens governing documents to owners, but only on an explicit
    // visibility setting. An upload that says nothing stays board-only, which
    // is the property worth pinning: the failure mode of a permission model is
    // widening by omission.
    await uploadAs(f.cyUser, "bylaws.pdf");

    const { rows } = await asUser(db, f.adaUser, () =>
      db.query(`select id from documents`),
    );
    expect(rows).toEqual([]);
  });

  it("does not let an owner upload", async () => {
    await expect(uploadAs(f.adaUser, "sneaky.pdf")).rejects.toThrow();
  });
});
