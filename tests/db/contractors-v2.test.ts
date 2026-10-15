import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { applyMigrations, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";
import { EXTRA, addVendors, boBoard, pgError, queries, seededDb, zaraBoard } from "./repairs-helpers";

/**
 * Migration 0053 contractors v2 (repairs-spec §3.2.9, §3.5, §3.6, tests
 * §17.2 `contractors-v2`): vendors v2, the notes log, review edits and
 * deletes, the search cache, the Google budget, coordinates, and contractor
 * message defaults.
 */
describe("contractors v2 (0053)", () => {
  let db: PGlite;
  let f: Fixture;
  const { q, one, rows, count } = queries(() => db);

  beforeEach(async () => {
    ({ db, f } = await seededDb());
    await addVendors(db, f);
  });
  afterEach(async () => {
    await db.close();
  });

  const addNote = (user: string, body = "Called Tuesday, quoted $400 by phone", assoc: string = f.damen, vendor: string = EXTRA.damenVendor) =>
    q<{ id: string }>(user, `insert into public.contractor_notes (association_id, vendor_id, body) values ($1::uuid, $2::uuid, $3) returning id`, [
      assoc,
      vendor,
      body,
    ]);
  const addReview = (user: string, tags: string[] = []) =>
    q<{ id: string }>(
      user,
      `insert into public.contractor_reviews (association_id, vendor_id, rating, body, tags) values ($1::uuid, $2::uuid, 4, 'Quick and tidy', $3::text[]) returning id`,
      [f.damen, EXTRA.damenVendor, tags],
    );

  it("1. vendors accept source 'web' and refuse an unknown source", async () => {
    await q(f.cyUser, `insert into public.vendors (association_id, name, source, source_urls) values ($1::uuid, 'Found Online Plumbing', 'web', '{https://example.test}')`, [
      f.damen,
    ]);
    expect((await pgError(q(f.cyUser, `insert into public.vendors (association_id, name, source) values ($1::uuid, 'Mystery Co', 'yelp')`, [f.damen]))).code).toBe("23514");
  });

  it("2. contractor notes: the board writes, the author and time are stamped, the accountant and owners can't read, Hoyne can't add to a Damen contractor", async () => {
    await zaraBoard(db, f);
    const id = (await addNote(f.cyUser)).rows[0].id;
    const n = await one<{ author_person_id: string; created_by: string; recent: boolean }>(
      null,
      `select author_person_id, created_by, created_at > now() - interval '1 minute' as recent from public.contractor_notes where id = $1::uuid`,
      [id],
    );
    expect(n).toEqual({ author_person_id: f.cyPerson, created_by: f.cyUser, recent: true });
    expect(await rows(f.niaUser, `select id from public.contractor_notes`)).toEqual([]);
    expect(await rows(f.adaUser, `select id from public.contractor_notes`)).toEqual([]);
    await expect(addNote(f.adaUser)).rejects.toThrow(/row-level security/);
    await expect(addNote(f.zaraUser)).rejects.toThrow(/row-level security/);
    expect((await pgError(addNote(f.zaraUser, "Mine", f.hoyne, EXTRA.damenVendor))).code).toBe("42501");

    // The author edits their own; the stamp moves, the author doesn't.
    await q(f.cyUser, `update public.contractor_notes set body = 'Quoted $450', author_person_id = $2::uuid where id = $1::uuid`, [id, f.adaPerson]);
    const edited = await one<{ body: string; author_person_id: string; edited: boolean }>(
      null,
      `select body, author_person_id, edited_at is not null as edited from public.contractor_notes where id = $1::uuid`,
      [id],
    );
    expect(edited).toEqual({ body: "Quoted $450", author_person_id: f.cyPerson, edited: true });
  });

  it("3. contractor notes: board members can't delete any note, their own included; an admin can", async () => {
    await boBoard(db, f);
    const bos = (await addNote(f.boUser, "Bo's note")).rows[0].id;
    expect((await q(f.boUser, `delete from public.contractor_notes where id = $1::uuid`, [bos])).affectedRows).toBe(0);
    expect((await q(f.boUser, `update public.contractor_notes set body = 'Edited by Bo' where id = $1::uuid`, [bos])).affectedRows).toBe(1);
    const cys = (await addNote(f.cyUser)).rows[0].id;
    expect((await q(f.boUser, `update public.contractor_notes set body = 'Not mine' where id = $1::uuid`, [cys])).affectedRows).toBe(0);
    expect((await q(f.cyUser, `delete from public.contractor_notes where id = $1::uuid`, [bos])).affectedRows).toBe(1);
  });

  it("4. editing a review stamps edited_at and pins the contractor; an unknown tag is refused", async () => {
    const id = (await addReview(f.cyUser, ["on_time"])).rows[0].id;
    await q(f.cyUser, `update public.contractor_reviews set rating = 5, tags = '{on_time,would_hire_again}', vendor_id = $2::uuid where id = $1::uuid`, [
      id,
      EXTRA.damenVendor2,
    ]);
    const r = await one<{ rating: number; vendor_id: string; edited: boolean; tags: string[] }>(
      null,
      `select rating, vendor_id, edited_at is not null as edited, tags from public.contractor_reviews where id = $1::uuid`,
      [id],
    );
    expect(r).toEqual({ rating: 5, vendor_id: EXTRA.damenVendor, edited: true, tags: ["on_time", "would_hire_again"] });
    expect((await pgError(addReview(f.cyUser, ["cheap"]))).code).toBe("23514");
  });

  it("5. reviews: a board member can no longer delete their own review; an admin can", async () => {
    await boBoard(db, f);
    const id = (await addReview(f.boUser)).rows[0].id;
    expect((await q(f.boUser, `delete from public.contractor_reviews where id = $1::uuid`, [id])).affectedRows).toBe(0);
    expect((await q(f.cyUser, `delete from public.contractor_reviews where id = $1::uuid`, [id])).affectedRows).toBe(1);
  });

  it("5b. a review's upkeep entry must be in the same association", async () => {
    await db.query(
      `insert into public.upkeep_tasks (id, association_id, name, interval_months, next_due_on) values ($1::uuid, $2::uuid, 'Hoyne gutters', 12, '2026-11-30')`,
      [EXTRA.hoyneTask, f.hoyne],
    );
    const log = await one<{ id: string }>(
      null,
      `insert into public.upkeep_log (association_id, task_id, done_on) values ($1::uuid, $2::uuid, '2026-09-01') returning id`,
      [f.hoyne, EXTRA.hoyneTask],
    );
    const id = (await addReview(f.cyUser)).rows[0].id;
    expect((await pgError(q(f.cyUser, `update public.contractor_reviews set upkeep_log_id = $2::uuid where id = $1::uuid`, [id, log.id]))).code).toBe("42501");
  });

  it("6. the search cache holds several queries per trade, defaults to ai_state done, and the board can clear it", async () => {
    const cache = (provider: string, query: string) =>
      q(
        f.cyUser,
        `insert into public.contractor_search_cache (association_id, provider, trade, query_key, location_key, results_json) values ($1::uuid, $2, 'plumbing', $3, '60614', '[]')`,
        [f.damen, provider, query],
      );
    await cache("google", "");
    await cache("google", "sink leak");
    await cache("web", "sink leak");
    expect((await pgError(cache("web", "sink leak"))).code).toBe("23505");
    const states = await rows<{ ai_state: string }>(f.cyUser, `select ai_state from public.contractor_search_cache`);
    expect(states.map((s) => s.ai_state)).toEqual(["done", "done", "done"]);
    expect((await q(f.adaUser, `delete from public.contractor_search_cache`)).affectedRows).toBe(0);
    expect((await q(f.cyUser, `delete from public.contractor_search_cache where provider = 'web'`)).affectedRows).toBe(1);
    expect(await count(`select 1 from public.contractor_search_cache`)).toBe(2);
  });

  it("7. google_calls_today counts from Chicago midnight for the board and returns 0 for owners", async () => {
    await db.query(
      `insert into public.google_api_calls (association_id, kind, trade, called_by, called_at)
       select $1::uuid, 'text_search', 'plumbing', $2::uuid, b + d
         from (select date_trunc('day', now() at time zone 'America/Chicago') at time zone 'America/Chicago' as b) x,
              unnest(array[interval '-1 minute', interval '1 minute']) d`,
      [f.damen, f.cyUser],
    );
    const today = (user: string) => one<{ n: number }>(user, `select public.google_calls_today($1::uuid) as n`, [f.damen]);
    expect((await today(f.cyUser)).n).toBe(1);
    expect((await today(f.adaUser)).n).toBe(0);
    expect((await today(f.zaraUser)).n).toBe(0);
  });

  it("8. set_association_coordinates: a board member fills empty coordinates once; it never overwrites; owners and out-of-range values are refused", async () => {
    await boBoard(db, f);
    const set = (user: string, lat: number, lng: number) =>
      one<{ ok: boolean }>(user, `select public.set_association_coordinates($1::uuid, $2, $3) as ok`, [f.damen, lat, lng]);
    expect((await pgError(set(f.adaUser, 41.9, -87.6))).code).toBe("42501");
    expect((await pgError(set(f.boUser, 91, -87.6))).code).toBe("22023");
    expect((await set(f.boUser, 41.9187654321, -87.6779))).toEqual({ ok: true });
    expect((await set(f.boUser, 40, -80))).toEqual({ ok: false });
    const a = await one<{ latitude: string; longitude: string }>(null, `select latitude::text, longitude::text from public.associations where id = $1::uuid`, [f.damen]);
    expect(a).toEqual({ latitude: "41.918765", longitude: "-87.677900" });
  });

  const message = (user: string, fields: { status?: string; ticket?: string | null; kind?: string; createdBy?: string; approvedBy?: string } = {}) =>
    q<{ id: string }>(
      user,
      `insert into public.contractor_messages (association_id, vendor_id, ticket_id, kind, subject, body, status, created_by, approved_by)
       values ($1::uuid, $2::uuid, $3::uuid, $4, 'About the leak', 'Can you come Tuesday?', $5::public.message_status, $6::uuid, $7::uuid) returning id`,
      [
        f.damen,
        EXTRA.damenVendor,
        fields.ticket === undefined ? f.ticketCommon : fields.ticket,
        fields.kind ?? "general",
        fields.status ?? "draft",
        fields.createdBy ?? null,
        fields.approvedBy ?? null,
      ],
    );
  const msgRow = (id: string) =>
    one<{ status: string; created_by: string; approved_by: string | null; sent: boolean; subject: string }>(
      null,
      `select status::text, created_by, approved_by, sent_at is not null as sent, subject from public.contractor_messages where id = $1::uuid`,
      [id],
    );

  it("9. contractor messages: defaults from the caller, sent is frozen, editing an approved message returns it to draft", async () => {
    await boBoard(db, f);
    const id = (await message(f.cyUser, { createdBy: f.boUser, approvedBy: f.boUser })).rows[0].id;
    expect(await msgRow(id)).toMatchObject({ status: "draft", created_by: f.cyUser, approved_by: f.boUser });

    await q(f.boUser, `update public.contractor_messages set status = 'approved', approved_by = $2::uuid where id = $1::uuid`, [id, f.cyUser]);
    expect(await msgRow(id)).toMatchObject({ status: "approved", approved_by: f.boUser });

    await q(f.cyUser, `update public.contractor_messages set subject = 'About the roof leak' where id = $1::uuid`, [id]);
    expect(await msgRow(id)).toMatchObject({ status: "draft", approved_by: null, subject: "About the roof leak" });

    await q(f.cyUser, `update public.contractor_messages set status = 'sent' where id = $1::uuid`, [id]);
    expect(await msgRow(id)).toMatchObject({ status: "sent", approved_by: f.cyUser, sent: true });

    for (const change of [`status = 'draft'`, `subject = 'Changed'`, `body = 'Changed'`, `to_email = 'x@example.test'`]) {
      expect((await pgError(q(f.cyUser, `update public.contractor_messages set ${change} where id = $1::uuid`, [id]))).code, change).toBe("42501");
    }
  });

  it("10. one open draft per contractor, ticket and kind", async () => {
    await message(f.cyUser);
    expect((await pgError(message(f.cyUser))).code).toBe("23505");
    await message(f.cyUser, { kind: "quote_request" });
    await message(f.cyUser, { ticket: null });
    expect((await pgError(message(f.cyUser, { ticket: null }))).code).toBe("23505");
    await q(f.cyUser, `update public.contractor_messages set status = 'cancelled' where kind = 'general' and ticket_id is not null`);
    await message(f.cyUser);
  });

  it("12. vendors.job_tags and contractor_reviews.tags refuse unknown values", async () => {
    await q(f.cyUser, `update public.vendors set job_tags = '{condo_work,free_estimates}' where id = $1::uuid`, [EXTRA.damenVendor]);
    expect((await pgError(q(f.cyUser, `update public.vendors set job_tags = '{cheap}' where id = $1::uuid`, [EXTRA.damenVendor]))).code).toBe("23514");
    expect((await pgError(addReview(f.cyUser, ["fast"]))).code).toBe("23514");
  });

  it("13. the existing 0040 checks still hold (status sync, do-not-use reason, place saved once)", async () => {
    const r = await one<{ is_preferred: boolean; updated: boolean }>(
      f.cyUser,
      `update public.vendors set status = 'preferred' where id = $1::uuid returning is_preferred, updated_at > now() - interval '1 minute' as updated`,
      [EXTRA.damenVendor2],
    );
    expect(r).toEqual({ is_preferred: true, updated: true });
    expect((await pgError(q(f.cyUser, `update public.vendors set status = 'do_not_use', do_not_use_reason = null where id = $1::uuid`, [EXTRA.damenVendor2]))).code).toBe(
      "23514",
    );
    const place = () =>
      q(f.cyUser, `insert into public.vendors (association_id, name, source, google_place_id) values ($1::uuid, 'Roofer', 'google', 'place-1')`, [f.damen]);
    await place();
    expect((await pgError(place())).code).toBe("23505");
  });
});

describe("contractors v2: legacy drafts (migration path)", () => {
  let db: PGlite;
  let f: Fixture;
  const { rows } = queries(() => db);
  const VENDOR = "ab000000-0000-0000-0000-0000000000e1";

  beforeAll(async () => {
    db = await freshDb({ before: "0053" });
    f = await seed(db);
    await db.query(`insert into public.vendors (id, association_id, name) values ($1::uuid, $2::uuid, 'Damen Plumbing')`, [VENDOR, f.damen]);
    await db.query(
      `insert into public.contractor_messages (association_id, vendor_id, ticket_id, subject, body, status, created_at)
       values ($1::uuid, $2::uuid, $3::uuid, 'Older', 'Older draft', 'draft', now() - interval '2 days'),
              ($1::uuid, $2::uuid, $3::uuid, 'Newer', 'Newer draft', 'draft', now() - interval '1 day')`,
      [f.damen, VENDOR, f.ticketCommon],
    );
    await applyMigrations(db, { from: "0053" });
  });
  afterAll(async () => {
    await db.close();
  });

  it("11. 0053 cancels legacy duplicate drafts before the one-draft index", async () => {
    const r = await rows<{ subject: string; status: string; kind: string }>(
      null,
      `select subject, status::text, kind from public.contractor_messages order by subject`,
    );
    expect(r).toEqual([
      { subject: "Newer", status: "draft", kind: "general" },
      { subject: "Older", status: "cancelled", kind: "general" },
    ]);
  });
});
