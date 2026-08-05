import { beforeEach, afterEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

/**
 * Migration 0020 — the document hub.
 *
 * The bulk of this file is the visibility model, because that is the part with
 * a blast radius. A document hub that shows one owner another owner's
 * delinquency notice is worse than no document hub.
 */
describe("document hub (0020)", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
  });

  afterEach(async () => {
    await db.close();
  });

  /** Cy, board_admin of Damen, files a document. Returns its id. */
  async function file(
    opts: {
      filename?: string;
      visibility?: string;
      unit?: string | null;
      checksum?: string | null;
    } = {},
  ) {
    const assoc = f.damen;
    const filename = opts.filename ?? "doc.pdf";
    const { rows } = await asUser(db, f.cyUser, () =>
      db.query<{ id: string }>(
        `insert into documents
           (association_id, storage_path, filename, visibility, restricted_to_unit_id, checksum)
         values ($1, $2, $3, $4, $5, $6)
         returning id`,
        [
          assoc,
          `${assoc}/${Date.now()}-${filename}-${Math.round(performance.now() * 1000)}`,
          filename,
          opts.visibility ?? "board_only",
          opts.unit ?? null,
          opts.checksum ?? null,
        ],
      ),
    );
    return rows[0].id;
  }

  async function visibleTo(userId: string): Promise<string[]> {
    const { rows } = await asUser(db, userId, () =>
      db.query<{ id: string }>(`select id from documents order by filename`),
    );
    return rows.map((r) => r.id);
  }

  // --------------------------------------------------------------------------
  // Visibility
  // --------------------------------------------------------------------------

  it("defaults a new document to board-only", async () => {
    // The safe default matters more than the happy path: a column added later
    // must not be able to widen access by omission.
    const id = await file({ filename: "unspecified.pdf" });

    const { rows } = await db.query<{ visibility: string }>(
      `select visibility from documents where id = $1`,
      [id],
    );
    expect(rows[0].visibility).toBe("board_only");
    expect(await visibleTo(f.adaUser)).not.toContain(id);
  });

  it("lets an owner read the declaration", async () => {
    // The gap this migration exists to close. Before 0020 no owner could read
    // a single document, including the governing documents of their own
    // building.
    const id = await file({ filename: "declaration.pdf", visibility: "all_owners" });

    expect(await visibleTo(f.adaUser)).toContain(id);
    expect(await visibleTo(f.boUser)).toContain(id);
    expect(await visibleTo(f.cyUser)).toContain(id);
  });

  it("shows a unit-pinned document to that unit's owner and no other", async () => {
    // A delinquency notice for unit 1. Ada owns unit 1; Bo owns unit 2.
    const id = await file({
      filename: "notice-unit1.pdf",
      visibility: "board_only",
      unit: f.unit1,
    });

    expect(await visibleTo(f.adaUser)).toContain(id);
    expect(await visibleTo(f.boUser)).not.toContain(id);
    expect(await visibleTo(f.cyUser)).toContain(id);
  });

  it("keeps a pinned document from the other owners even when marked all_owners", async () => {
    // Pinning narrows; it never widens. Marking a unit-specific letter
    // all_owners by mistake must not broadcast it to the building.
    const id = await file({
      filename: "pinned-wide.pdf",
      visibility: "all_owners",
      unit: f.unit1,
    });

    expect(await visibleTo(f.adaUser)).toContain(id);
    expect(await visibleTo(f.boUser)).not.toContain(id);
  });

  it("lets the accountant read everything the board can", async () => {
    const id = await file({ filename: "bank-statement.pdf" });
    // Nia's accountant grant is current; Vic's expired in 2024.
    expect(await visibleTo(f.niaUser)).toContain(id);
    expect(await visibleTo(f.vicUser)).not.toContain(id);
  });

  it("never leaks across associations", async () => {
    const damen = await file({ filename: "damen.pdf", visibility: "all_owners" });

    // Hoyne has no board member in the fixture, and granting Zara one would
    // change what the read side of this test is proving. The file is planted
    // directly instead — this test is about who can read, not who can write.
    const { rows } = await db.query<{ id: string }>(
      `insert into documents (association_id, storage_path, filename, visibility)
       values ($1, $2, 'hoyne.pdf', 'all_owners') returning id`,
      [f.hoyne, `${f.hoyne}/hoyne.pdf`],
    );
    const hoyne = rows[0].id;

    expect(await visibleTo(f.zaraUser)).toEqual([hoyne]);
    expect(await visibleTo(f.adaUser)).toEqual([damen]);
  });

  // --------------------------------------------------------------------------
  // Trash
  // --------------------------------------------------------------------------

  it("hides a binned document from owners but keeps it for the board", async () => {
    const id = await file({ filename: "minutes.pdf", visibility: "all_owners" });
    expect(await visibleTo(f.adaUser)).toContain(id);

    await asUser(db, f.cyUser, () =>
      db.query(`update documents set deleted_at = now() where id = $1`, [id]),
    );

    // Gone for the owner; still in the board's trash to restore from.
    expect(await visibleTo(f.adaUser)).not.toContain(id);
    expect(await visibleTo(f.cyUser)).toContain(id);
  });

  it("lets a board member bin a document but only board_admin destroy one", async () => {
    const id = await file({ filename: "bin-me.pdf" });

    await db.query(
      `insert into role_grants (association_id, person_id, role, granted_on)
       values ($1, $2, 'board_member', '2024-01-01')`,
      [f.damen, f.boPerson],
    );

    // Soft delete is an UPDATE — is_board, so board_member may.
    await asUser(db, f.boUser, () =>
      db.query(`update documents set deleted_at = now() where id = $1`, [id]),
    );
    const { rows: binned } = await db.query<{ n: number }>(
      `select count(*)::int as n from documents where id = $1 and deleted_at is not null`,
      [id],
    );
    expect(binned[0].n).toBe(1);

    // Purge is a DELETE — board_admin only. A board_member's delete matches no
    // row rather than raising.
    await asUser(db, f.boUser, () => db.query(`delete from documents where id = $1`, [id]));
    const { rows: still } = await db.query<{ n: number }>(
      `select count(*)::int as n from documents where id = $1`,
      [id],
    );
    expect(still[0].n).toBe(1);

    await asUser(db, f.cyUser, () => db.query(`delete from documents where id = $1`, [id]));
    const { rows: gone } = await db.query<{ n: number }>(
      `select count(*)::int as n from documents where id = $1`,
      [id],
    );
    expect(gone[0].n).toBe(0);
  });

  // --------------------------------------------------------------------------
  // Duplicates and titles
  // --------------------------------------------------------------------------

  it("refuses a second copy of identical bytes", async () => {
    await file({ filename: "w9.pdf", checksum: "abc123" });
    await expect(file({ filename: "w9-copy.pdf", checksum: "abc123" })).rejects.toThrow();
  });

  it("allows re-uploading a file that was binned", async () => {
    const id = await file({ filename: "w9.pdf", checksum: "abc123" });
    await asUser(db, f.cyUser, () =>
      db.query(`update documents set deleted_at = now() where id = $1`, [id]),
    );
    await expect(file({ filename: "w9.pdf", checksum: "abc123" })).resolves.toBeTruthy();
  });

  it("titles a document after its filename until someone renames it", async () => {
    const id = await file({ filename: "SCAN_0042.pdf" });
    const { rows: a } = await db.query<{ title: string }>(
      `select title from documents where id = $1`,
      [id],
    );
    expect(a[0].title).toBe("SCAN_0042.pdf");

    // Clearing the title falls back rather than leaving the list blank.
    await asUser(db, f.cyUser, () =>
      db.query(`update documents set title = '   ' where id = $1`, [id]),
    );
    const { rows: b } = await db.query<{ title: string }>(
      `select title from documents where id = $1`,
      [id],
    );
    expect(b[0].title).toBe("SCAN_0042.pdf");
  });

  // --------------------------------------------------------------------------
  // Categories
  // --------------------------------------------------------------------------

  it("seeds the category set for every association", async () => {
    const { rows } = await db.query<{ association_id: string; n: number }>(
      `select association_id, count(*)::int as n
         from document_categories group by 1 order by 1`,
    );
    expect(rows.map((r) => r.n)).toEqual([16, 16]);
  });

  it("gives owners the category labels, since they file nothing but read some", async () => {
    const { rows } = await asUser(db, f.adaUser, () =>
      db.query(`select slug from document_categories`),
    );
    expect(rows.length).toBe(16);
  });

  it("refuses to delete a seeded category that documents may be filed under", async () => {
    await asUser(db, f.cyUser, () =>
      db.query(`delete from document_categories where slug = 'governing' and association_id = $1`, [
        f.damen,
      ]),
    );
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from document_categories
        where slug = 'governing' and association_id = $1`,
      [f.damen],
    );
    expect(rows[0].n).toBe(1);
  });

  it("defaults governing documents and minutes to owner-visible", async () => {
    const { rows } = await db.query<{ slug: string; default_visibility: string }>(
      `select slug, default_visibility from document_categories
        where association_id = $1 and default_visibility = 'all_owners' order by slug`,
      [f.damen],
    );
    expect(rows.map((r) => r.slug)).toEqual(["financial_statement", "governing", "minutes"]);
  });

  // --------------------------------------------------------------------------
  // Folders
  // --------------------------------------------------------------------------

  async function folder(name: string, parent: string | null = null) {
    const { rows } = await asUser(db, f.cyUser, () =>
      db.query<{ id: string }>(
        `insert into folders (association_id, name, parent_id) values ($1, $2, $3) returning id`,
        [f.damen, name, parent],
      ),
    );
    return rows[0].id;
  }

  it("caps folder nesting at three deep", async () => {
    const a = await folder("2026");
    const b = await folder("Insurance", a);
    await folder("Renewal", b);
    await expect(folder("Too deep", await folder("Third", b))).rejects.toThrow(/three deep/);
  });

  it("refuses two folders with the same name under the same parent", async () => {
    await folder("Insurance");
    await expect(folder("insurance")).rejects.toThrow();
  });

  it("unfiles documents when their folder is deleted rather than deleting them", async () => {
    const id = await file({ filename: "in-folder.pdf" });
    const fid = await folder("Insurance");
    await asUser(db, f.cyUser, () =>
      db.query(`update documents set folder_id = $1 where id = $2`, [fid, id]),
    );

    await asUser(db, f.cyUser, () => db.query(`delete from folders where id = $1`, [fid]));

    const { rows } = await db.query<{ n: number; folder_id: string | null }>(
      `select count(*)::int as n, max(folder_id::text) as folder_id
         from documents where id = $1`,
      [id],
    );
    expect(rows[0].n).toBe(1);
    expect(rows[0].folder_id).toBeNull();
  });

  it("keeps folders away from owners", async () => {
    await folder("Insurance");
    const { rows } = await asUser(db, f.adaUser, () => db.query(`select id from folders`));
    expect(rows).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // Saved views and rules
  // --------------------------------------------------------------------------

  it("keeps a private saved view private and a shared one shared", async () => {
    await asUser(db, f.cyUser, () =>
      db.query(
        `insert into saved_views (association_id, name, filter, owner_person_id, is_shared)
         values ($1, 'My drafts', '{"tag":"invoice"}'::jsonb, $2, false)`,
        [f.damen, f.cyPerson],
      ),
    );
    await asUser(db, f.cyUser, () =>
      db.query(
        `insert into saved_views (association_id, name, filter, owner_person_id, is_shared)
         values ($1, 'Tax 2026', '{"tag":"tax_form"}'::jsonb, $2, true)`,
        [f.damen, f.cyPerson],
      ),
    );

    const { rows } = await asUser(db, f.niaUser, () =>
      db.query<{ name: string }>(`select name from saved_views order by name`),
    );
    expect(rows.map((r) => r.name)).toEqual(["Tax 2026"]);
  });

  it("will not let someone save a view under another person's name", async () => {
    await expect(
      asUser(db, f.niaUser, () =>
        db.query(
          `insert into saved_views (association_id, name, filter, owner_person_id)
           values ($1, 'Not mine', '{}'::jsonb, $2)`,
          [f.damen, f.cyPerson],
        ),
      ),
    ).rejects.toThrow();
  });

  it("restricts auto-filing rules to board_admin", async () => {
    await db.query(
      `insert into role_grants (association_id, person_id, role, granted_on)
       values ($1, $2, 'board_member', '2024-01-01')`,
      [f.damen, f.boPerson],
    );

    // A rule decides where other people's documents land — a board_member
    // reads them but does not write them.
    await expect(
      asUser(db, f.boUser, () =>
        db.query(
          `insert into tag_rules (association_id, match_type, match_value)
           values ($1, 'sender_email', 'broker@example.test')`,
          [f.damen],
        ),
      ),
    ).rejects.toThrow();

    await expect(
      asUser(db, f.cyUser, () =>
        db.query(
          `insert into tag_rules (association_id, match_type, match_value)
           values ($1, 'sender_email', 'broker@example.test')`,
          [f.damen],
        ),
      ),
    ).resolves.toBeTruthy();
  });

  // --------------------------------------------------------------------------
  // Links
  // --------------------------------------------------------------------------

  it("refuses a link to a table that does not exist", async () => {
    const id = await file({ filename: "receipt.pdf" });
    await expect(
      asUser(db, f.cyUser, () =>
        db.query(
          `insert into document_links (association_id, document_id, target_table, target_id)
           values ($1, $2, 'meetings', $3)`,
          [f.damen, id, f.unit1],
        ),
      ),
    ).rejects.toThrow();
  });

  it("accepts the links the hub actually writes", async () => {
    const id = await file({ filename: "receipt.pdf" });
    for (const [table, target] of [
      ["units", f.unit1],
      ["vendors", f.damen],
      ["tickets", f.ticketCommon],
    ] as const) {
      await expect(
        asUser(db, f.cyUser, () =>
          db.query(
            `insert into document_links (association_id, document_id, target_table, target_id, relation)
             values ($1, $2, $3, $4, 'source')`,
            [f.damen, id, table, target],
          ),
        ),
      ).resolves.toBeTruthy();
    }
  });
});
