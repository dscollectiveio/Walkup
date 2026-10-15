import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Fixture } from "./fixtures";
import { EXTRA, addHoyneTicket, addVendors, chicagoToday, pgError, queries, seededDb, zaraBoard } from "./repairs-helpers";

/**
 * Migration 0053 quotes per ticket (repairs-spec §3.4, tests §17.2
 * `ticket-bids`): ticket_bids, accept_ticket_bid, request_ticket_quotes and
 * the "marked as sent" follow-ups on contractor_messages.
 */
describe("ticket bids (0053)", () => {
  let db: PGlite;
  let f: Fixture;
  const { q, one, rows, count } = queries(() => db);
  const THIRD = "ab000000-0000-0000-0000-0000000000d3";

  beforeEach(async () => {
    ({ db, f } = await seededDb());
    await addVendors(db, f);
    await db.query(`insert into public.vendors (id, association_id, name, trades) values ($1::uuid, $2::uuid, 'Third Plumbing', '{plumbing}')`, [
      THIRD,
      f.damen,
    ]);
  });
  afterEach(async () => {
    await db.close();
  });

  const bid = (user: string, vendor: string, fields: { status?: string; amount?: string | null; ticket?: string; assoc?: string } = {}) =>
    q<{ id: string }>(
      user,
      `insert into public.ticket_bids (association_id, ticket_id, vendor_id, status, amount) values ($1::uuid, $2::uuid, $3::uuid, $4, $5::numeric) returning id`,
      [fields.assoc ?? f.damen, fields.ticket ?? f.ticketCommon, vendor, fields.status ?? "received", fields.amount === undefined ? "500" : fields.amount],
    );
  const bidRow = (id: string) =>
    one<{ status: string; decided: boolean; decline_reason: string | null; requested_on: string | null }>(
      null,
      `select status, decided_at is not null as decided, decline_reason, requested_on::text from public.ticket_bids where id = $1::uuid`,
      [id],
    );
  const accept = (user: string, id: string) => q(user, `select public.accept_ticket_bid($1::uuid)`, [id]);

  it("1. the board records quotes; the accountant reads them; owners and Hoyne cannot", async () => {
    await zaraBoard(db, f);
    await bid(f.cyUser, EXTRA.damenVendor);
    expect(await rows(f.niaUser, `select id from public.ticket_bids`)).toHaveLength(1);
    expect(await rows(f.adaUser, `select id from public.ticket_bids`)).toEqual([]);
    expect(await rows(f.zaraUser, `select id from public.ticket_bids`)).toEqual([]);
    await expect(bid(f.adaUser, EXTRA.damenVendor2)).rejects.toThrow(/row-level security/);
    await expect(bid(f.niaUser, EXTRA.damenVendor2)).rejects.toThrow(/row-level security/);
    await expect(bid(f.zaraUser, EXTRA.damenVendor2)).rejects.toThrow(/row-level security/);
  });

  it("2. one live quote per contractor per ticket", async () => {
    await bid(f.cyUser, EXTRA.damenVendor);
    expect((await pgError(bid(f.cyUser, EXTRA.damenVendor, { amount: "600" }))).code).toBe("23505");
    // A withdrawn one doesn't count.
    await q(f.cyUser, `update public.ticket_bids set status = 'withdrawn'`);
    await bid(f.cyUser, EXTRA.damenVendor, { amount: "600" });
  });

  it("3. a received quote needs an amount; a declined one gets decided_at from the trigger", async () => {
    expect((await pgError(bid(f.cyUser, EXTRA.damenVendor, { amount: null }))).code).toBe("23514");
    const { rows: r } = await bid(f.cyUser, EXTRA.damenVendor);
    await q(f.cyUser, `update public.ticket_bids set status = 'declined', decline_reason = 'Too high', decided_at = null where id = $1::uuid`, [r[0].id]);
    expect(await bidRow(r[0].id)).toMatchObject({ status: "declined", decided: true, decline_reason: "Too high" });
    await q(f.cyUser, `update public.ticket_bids set status = 'received' where id = $1::uuid`, [r[0].id]);
    expect(await bidRow(r[0].id)).toMatchObject({ status: "received", decided: false, decline_reason: null });
  });

  it("4. accept_ticket_bid chooses the contractor and sets the estimate without changing the status", async () => {
    const a = (await bid(f.cyUser, EXTRA.damenVendor, { amount: "500" })).rows[0].id;
    const b = (await bid(f.cyUser, EXTRA.damenVendor2, { amount: "700" })).rows[0].id;
    const c = (await bid(f.cyUser, THIRD, { status: "requested", amount: null })).rows[0].id;
    await accept(f.cyUser, a);
    const t = await one<{ assigned_vendor_id: string; status: string }>(null, `select assigned_vendor_id, status from public.tickets where id = $1::uuid`, [f.ticketCommon]);
    expect(t).toEqual({ assigned_vendor_id: EXTRA.damenVendor, status: "open" });
    const d = await one<{ e: string }>(null, `select estimated_cost::text as e from public.ticket_board_details where ticket_id = $1::uuid`, [f.ticketCommon]);
    expect(d.e).toBe("500.00");
    expect(await bidRow(a)).toMatchObject({ status: "accepted", decided: true });
    expect(await bidRow(b)).toMatchObject({ status: "declined", decided: true, decline_reason: "Another quote was accepted." });
    expect(await bidRow(c)).toMatchObject({ status: "withdrawn", decided: false });
  });

  it("5. only one accepted quote; accepting another switches it", async () => {
    const a = (await bid(f.cyUser, EXTRA.damenVendor, { amount: "500" })).rows[0].id;
    const b = (await bid(f.cyUser, EXTRA.damenVendor2, { amount: "700" })).rows[0].id;
    await accept(f.cyUser, a);
    expect((await pgError(q(f.cyUser, `update public.ticket_bids set status = 'accepted' where id = $1::uuid`, [b]))).code).toBe("23505");
    await accept(f.cyUser, b);
    expect(await bidRow(a)).toMatchObject({ status: "declined" });
    expect(await bidRow(b)).toMatchObject({ status: "accepted" });
    const t = await one<{ v: string; e: string }>(
      null,
      `select t.assigned_vendor_id as v, d.estimated_cost::text as e from public.tickets t join public.ticket_board_details d on d.ticket_id = t.id where t.id = $1::uuid`,
      [f.ticketCommon],
    );
    expect(t).toEqual({ v: EXTRA.damenVendor2, e: "700.00" });
    expect(await count(`select 1 from public.ticket_bids where status = 'accepted'`)).toBe(1);
  });

  it("6. accept_ticket_bid refuses owners and quotes without an amount", async () => {
    const a = (await bid(f.cyUser, EXTRA.damenVendor, { amount: "500" })).rows[0].id;
    const c = (await bid(f.cyUser, THIRD, { status: "requested", amount: null })).rows[0].id;
    expect((await pgError(accept(f.adaUser, a))).code).toBe("42501");
    expect((await pgError(accept(f.niaUser, a))).code).toBe("42501");
    expect((await pgError(accept(f.cyUser, c))).code).toBe("22023");
  });

  it("7. quotes refuse another association's ticket, contractor or document, and a message for a different contractor", async () => {
    await addHoyneTicket(db, f);
    expect((await pgError(bid(f.cyUser, EXTRA.damenVendor, { ticket: EXTRA.hoyneTicket }))).code).toBe("42501");
    expect((await pgError(bid(f.cyUser, EXTRA.hoyneVendor))).code).toBe("42501");

    const doc = await one<{ id: string }>(
      null,
      `insert into public.documents (association_id, storage_path, filename, mime_type, byte_size, checksum)
       values ($1::uuid, $2, 'quote.pdf', 'application/pdf', 1000, $3) returning id`,
      [f.hoyne, `${f.hoyne}/1760000000001-abc123-quote.pdf`, "d".repeat(64)],
    );
    const { rows: r } = await bid(f.cyUser, EXTRA.damenVendor);
    expect((await pgError(q(f.cyUser, `update public.ticket_bids set document_id = $2::uuid where id = $1::uuid`, [r[0].id, doc.id]))).code).toBe("42501");

    const msg = await one<{ id: string }>(
      f.cyUser,
      `insert into public.contractor_messages (association_id, vendor_id, ticket_id, kind, subject, body) values ($1::uuid, $2::uuid, $3::uuid, 'quote_request', 'Quote?', 'Please quote.') returning id`,
      [f.damen, EXTRA.damenVendor2, f.ticketCommon],
    );
    expect((await pgError(q(f.cyUser, `update public.ticket_bids set message_id = $2::uuid where id = $1::uuid`, [r[0].id, msg.id]))).code).toBe("42501");
  });

  it("8. quote events are board-only", async () => {
    const a = (await bid(f.cyUser, EXTRA.damenVendor)).rows[0].id;
    await accept(f.cyUser, a);
    const quoteKinds = (user: string) =>
      rows<{ kind: string }>(user, `select kind from public.ticket_events where ticket_id = $1::uuid and kind like 'quote_%' order by kind`, [f.ticketCommon]);
    expect((await quoteKinds(f.cyUser)).map((r) => r.kind)).toEqual(["quote_accepted", "quote_received"]);
    expect((await quoteKinds(f.niaUser)).map((r) => r.kind)).toEqual(["quote_accepted", "quote_received"]);
    expect(await quoteKinds(f.adaUser)).toEqual([]);
    // The contractor's name still reaches the owner through the assignment event.
    expect((await rows(f.adaUser, `select id from public.ticket_events where ticket_id = $1::uuid and kind = 'contractor_assigned'`, [f.ticketCommon])).length).toBe(1);
  });

  it("9. quote writes are audited", async () => {
    const a = (await bid(f.cyUser, EXTRA.damenVendor)).rows[0].id;
    await q(f.cyUser, `update public.ticket_bids set amount = 450 where id = $1::uuid`, [a]);
    await q(f.cyUser, `delete from public.ticket_bids where id = $1::uuid`, [a]);
    const audit = await rows<{ action: string; actor_user_id: string }>(
      null,
      `select action, actor_user_id from public.audit_log where table_name = 'ticket_bids' and record_id = $1::uuid order by id`,
      [a],
    );
    expect(audit).toEqual([
      { action: "insert", actor_user_id: f.cyUser },
      { action: "update", actor_user_id: f.cyUser },
      { action: "delete", actor_user_id: f.cyUser },
    ]);
  });

  const requestQuotes = (user: string, requests: unknown[]) =>
    q<{ vendor_id: string; bid_id: string | null; message_id: string | null; outcome: string }>(
      user,
      `select * from public.request_ticket_quotes($1::uuid, $2::jsonb)`,
      [f.ticketCommon, JSON.stringify(requests)],
    );
  const email = (vendor: string, subject = "Quote for a roof leak") => ({
    vendor_id: vendor,
    by_phone: false,
    to_email: "office@example.test",
    subject,
    body: "Could you quote for this?",
  });

  it("10. request_ticket_quotes writes bids, drafts and links together", async () => {
    const today = await chicagoToday(db);
    const r = (await requestQuotes(f.cyUser, [email(EXTRA.damenVendor), email(EXTRA.damenVendor2), { vendor_id: THIRD, by_phone: true }])).rows;
    expect(r.map((x) => x.outcome)).toEqual(["drafted", "drafted", "by_phone"]);
    const bids = await rows<{ vendor_id: string; message_id: string | null; requested_by_phone: boolean; requested_on: string | null }>(
      null,
      `select vendor_id, message_id, requested_by_phone, requested_on::text from public.ticket_bids order by requested_by_phone, vendor_id`,
    );
    expect(bids.filter((b) => b.message_id !== null)).toHaveLength(2);
    const phone = bids.find((b) => b.requested_by_phone)!;
    expect(phone).toMatchObject({ vendor_id: THIRD, message_id: null, requested_on: today });
    const drafts = await rows<{ kind: string; status: string; vendor_id: string }>(
      null,
      `select kind, status::text, vendor_id from public.contractor_messages order by vendor_id`,
    );
    expect(drafts.every((d) => d.kind === "quote_request" && d.status === "draft")).toBe(true);
    expect(drafts).toHaveLength(2);

    const again = (await requestQuotes(f.cyUser, [email(EXTRA.damenVendor), email(EXTRA.damenDoNotUse), email(EXTRA.damenArchived), email(EXTRA.hoyneVendor)])).rows;
    expect(again.map((x) => x.outcome)).toEqual(["already_asked", "not_available", "not_available", "not_available"]);

    const six = Array.from({ length: 6 }, () => email(EXTRA.damenVendor));
    expect((await pgError(requestQuotes(f.cyUser, six))).code).toBe("22023");
    expect((await pgError(requestQuotes(f.cyUser, []))).code).toBe("22023");
    expect((await pgError(requestQuotes(f.adaUser, [email(EXTRA.damenVendor)]))).code).toBe("42501");
  });

  it("10b. a failing request list leaves no bids or drafts behind", async () => {
    await db.query(`insert into public.vendors (id, association_id, name) values ('ab000000-0000-0000-0000-0000000000d4', $1::uuid, 'Fourth Co')`, [f.damen]);
    const e = await pgError(
      requestQuotes(f.cyUser, [email(EXTRA.damenVendor), email(EXTRA.damenVendor2), email("ab000000-0000-0000-0000-0000000000d4", "  ")]),
    );
    expect(e.code).toBe("22023");
    expect(await count(`select 1 from public.ticket_bids`)).toBe(0);
    expect(await count(`select 1 from public.contractor_messages`)).toBe(0);
  });

  it("11. marking a quote request sent stamps its bid's requested_on", async () => {
    const today = await chicagoToday(db);
    const r = (await requestQuotes(f.cyUser, [email(EXTRA.damenVendor)])).rows[0];
    expect((await bidRow(r.bid_id!)).requested_on).toBeNull();
    await q(f.cyUser, `update public.contractor_messages set status = 'sent' where id = $1::uuid`, [r.message_id]);
    expect((await bidRow(r.bid_id!)).requested_on).toBe(today);
  });

  it("12. marking a go-ahead sent moves an open ticket with that contractor to in progress", async () => {
    await q(f.cyUser, `update public.tickets set assigned_vendor_id = $1::uuid where id in ($2::uuid, $3::uuid)`, [EXTRA.damenVendor, f.ticketCommon, f.ticketUnit1]);
    const goAhead = async (vendor: string, ticket: string) => {
      const m = await one<{ id: string }>(
        f.cyUser,
        `insert into public.contractor_messages (association_id, vendor_id, ticket_id, kind, subject, body) values ($1::uuid, $2::uuid, $3::uuid, 'job', 'Go ahead', 'Please go ahead.') returning id`,
        [f.damen, vendor, ticket],
      );
      await q(f.cyUser, `update public.contractor_messages set status = 'sent' where id = $1::uuid`, [m.id]);
    };
    await goAhead(EXTRA.damenVendor, f.ticketCommon);
    await goAhead(EXTRA.damenVendor2, f.ticketUnit1);
    const st = await rows<{ id: string; status: string }>(null, `select id, status::text from public.tickets where id in ($1::uuid, $2::uuid)`, [
      f.ticketCommon,
      f.ticketUnit1,
    ]);
    expect(Object.fromEntries(st.map((s) => [s.id, s.status]))).toEqual({ [f.ticketCommon]: "in_progress", [f.ticketUnit1]: "open" });
  });
});
