import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./repairs-fake-db";

/**
 * The Repairs server actions against an in-memory Supabase fake (repairs-spec
 * §5.1, §8, §9, §10, §12, §13). The model (runStructured, webResearch) and
 * Google are mocked; after() only records its callback. What matters here is
 * what each action sends where, and how database answers become sentences.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { afterCallbacks, runStructured, webResearch, state, searchNearby, geocode } = vi.hoisted(() => ({
  afterCallbacks: [] as (() => unknown)[],
  runStructured: vi.fn(),
  webResearch: vi.fn(),
  searchNearby: vi.fn(),
  geocode: vi.fn(),
  state: { db: null as unknown as import("./repairs-fake-db").FakeDb },
}));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (fn: () => unknown) => afterCallbacks.push(fn),
}));
vi.mock("@/lib/ai/structured", () => ({ runStructured: (...a: unknown[]) => runStructured(...a) }));
vi.mock("@/lib/ai/web-research", () => ({
  webResearch: (...a: unknown[]) => webResearch(...a),
  loadRedactionTerms: async () => ({ names: ["Ada Lovelace"], addresses: ["2158 N Damen Ave"], keep: [] }),
}));
vi.mock("@/lib/google/places", async (orig) => ({
  ...(await orig<typeof import("@/lib/google/places")>()),
  searchNearby: (...a: unknown[]) => searchNearby(...a),
  geocode: (...a: unknown[]) => geocode(...a),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.db.client }));

import { closeOutTicket, createTicket, markOwnersTold, setTicketPlan, updateTicketDetails } from "@/app/maintenance/actions";
import { readBidText, recordBid, requestQuotes } from "@/app/maintenance/bid-actions";
import { createDraft, markMessageSent } from "@/app/contractors/actions";
import { archiveContractor, deleteContractor, updateRates } from "@/app/contractors/vendor-actions";
import { saveCandidate, searchPlaces, startWebSearch } from "@/app/repairs/find/actions";
import { addUpkeepTask, markUpkeepDone } from "@/app/repairs/upkeep-actions";
import { markBillPaid } from "@/app/bills/actions";
import { GET as calendarGET } from "@/app/repairs/calendar/route";

const ASSOC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TICKET = "11111111-1111-4111-8111-111111111111";
const UNIT = "22222222-2222-4222-8222-222222222222";
const ACME = "33333333-3333-4333-8333-333333333333";
const PHONEONLY = "44444444-4444-4444-8444-444444444444";
const NOPE = "55555555-5555-4555-8555-555555555555";
const KEY = "66666666-6666-4666-8666-666666666666";
const BILL = "77777777-7777-4777-8777-777777777777";
const PAYMENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let db: FakeDb;
let board = true;

beforeEach(() => {
  db = new FakeDb();
  state.db = db;
  board = true;
  afterCallbacks.length = 0;
  runStructured.mockReset();
  webResearch.mockReset();
  searchNearby.mockReset();
  geocode.mockReset();
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.GOOGLE_PLACES_KEY = "g-key";
  delete process.env.WALKUP_AI_DISABLED;

  db.tables.associations = [{
    id: ASSOC, display_name: "Damen", legal_name: "2158 N. Damen Condominium Association", street_address: "2158 N Damen Ave",
    city: "Chicago", state_code: "IL", postal_code: "60647", latitude: 41.92, longitude: -87.678,
  }];
  db.tables.persons = [{ id: "person-1", association_id: ASSOC, full_name: "Doug Smart", phone: "312-555-0100", email: "doug@example.com", auth_user_id: "user-1" }];
  db.tables.tickets = [{
    id: TICKET, association_id: ASSOC, reference: 14, title: "Water coming through bathroom ceiling", description: "From the light fixture",
    unit_id: UNIT, units: { label: "Unit 1" }, location_detail: "bathroom", access_notes: "Key with Bo", status: "open", priority: "normal",
    trade: "plumbing", emergency_kind: null, assigned_vendor_id: null, upkeep_task_id: null, reported_by: "person-2", created_at: "2026-10-14T10:00:00Z",
  }];
  db.tables.vendors = [
    { id: ACME, association_id: ASSOC, name: "Acme Plumbing", contact_name: "Pat Lee", email: "pat@acme.example", phone: "312-555-0142", status: "preferred", do_not_use_reason: null, archived_at: null, google_place_id: "place-acme", website_url: "https://acmeplumbing.com/" },
    { id: PHONEONLY, association_id: ASSOC, name: "Phone Only Drains", contact_name: null, email: null, phone: "312-555-0199", status: "okay", do_not_use_reason: null, archived_at: null, google_place_id: null, website_url: null },
    { id: NOPE, association_id: ASSOC, name: "Leaky Larry", contact_name: null, email: "larry@example.com", phone: null, status: "do_not_use", do_not_use_reason: "Left the job half done", archived_at: null, google_place_id: null, website_url: null },
  ];
  db.rpcHandlers.is_board = () => ({ data: board, error: null });
  db.rpcHandlers.can_manage_repairs = () => ({ data: board, error: null });
  db.rpcHandlers.is_member = () => ({ data: true, error: null });
  db.rpcHandlers.can_read_financials = () => ({ data: board, error: null });
  db.rpcHandlers.current_person_id = () => ({ data: "person-1", error: null });
  db.rpcHandlers.claim_ai_call = () => ({ data: "claim-1", error: null });
  db.rpcHandlers.google_calls_today = () => ({ data: 3, error: null });
});

const report = {
  clientKey: KEY, title: "Water coming through the ceiling", description: "water is pouring from the light fixture",
  where: UNIT, location_detail: "", access_notes: "", priority: "normal" as const, emergencyConfirmed: true,
};

describe("createTicket", () => {
  it("marks a confirmed emergency urgent with its trade, and triages in the background", async () => {
    const r = await createTicket(report);
    expect(r).toMatchObject({ ok: true, alreadyExisted: false, emergency: "flooding" });
    const insert = db.writes.find((w) => w.table === "tickets" && w.op === "insert")?.payload as Record<string, unknown>;
    expect(insert).toMatchObject({ association_id: ASSOC, unit_id: UNIT, priority: "urgent", emergency_kind: "flooding", trade: "plumbing", client_key: KEY });
    expect(insert).not.toHaveProperty("reported_by");
    expect(insert).not.toHaveProperty("created_at");
    expect(afterCallbacks).toHaveLength(1);
  });

  it("keeps the reporter's urgency and no emergency when they said it's under control", async () => {
    await createTicket({ ...report, description: "the pipe above is leaking", emergencyConfirmed: false, where: "shared" });
    const insert = db.writes.find((w) => w.table === "tickets" && w.op === "insert")?.payload as Record<string, unknown>;
    expect(insert).toMatchObject({ priority: "normal", emergency_kind: null, unit_id: null, trade: "plumbing" });
  });

  it("returns the existing ticket for a retried submit, without triaging again", async () => {
    db.tables.tickets.push({ id: "t-existing", association_id: ASSOC, reference: 15, emergency_kind: null, client_key: KEY });
    db.fail("tickets", "insert", { code: "23505", message: "duplicate key value violates unique constraint \"tickets_client_key\"" });
    const r = await createTicket(report);
    expect(r).toEqual({ ok: true, ticketId: "t-existing", reference: 15, emergency: null, alreadyExisted: true });
    expect(afterCallbacks).toHaveLength(0);
  });

  it("explains an RLS refusal and never shows the raw message", async () => {
    db.fail("tickets", "insert", { code: "42501", message: "new row violates row-level security policy" });
    expect(await createTicket(report)).toEqual({ error: "You can report problems in shared areas or in your own unit." });
    db.fail("tickets", "insert", { code: "XX000", message: "internal detail" });
    expect(await createTicket(report)).toEqual({ error: "Something went wrong saving that. Try again." });
  });

  it("validates before touching the database", async () => {
    expect(await createTicket({ ...report, title: "ab" })).toEqual({ error: "Give it a short title, at least 4 letters." });
    expect(db.writes).toHaveLength(0);
  });

  it("doesn't triage when AI isn't configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await createTicket(report);
    expect(afterCallbacks).toHaveLength(0);
  });
});

describe("board edits", () => {
  const details = {
    title: "Water coming through bathroom ceiling", description: "From the light fixture", where: "shared", location_detail: "bathroom",
    access_notes: "Key with Bo", priority: "normal" as const, trade: "plumbing", emergency_kind: null, priorityReason: null, accessNotesWhenShared: null,
  };

  it("asks what happens to access notes before a unit problem becomes shared", async () => {
    expect(await updateTicketDetails(TICKET, details)).toEqual({
      error: "Decide what happens to the access notes before sharing this problem with every owner.",
    });
    expect(await updateTicketDetails(TICKET, { ...details, accessNotesWhenShared: "clear" })).toEqual({ ok: true });
    const upd = db.writes.find((w) => w.table === "tickets" && w.op === "update")?.payload as Record<string, unknown>;
    expect(upd).toMatchObject({ unit_id: null, access_notes: null });
  });

  it("names the reporter when lowering urgency needs a reason", async () => {
    db.tables.persons.push({ id: "person-2", association_id: ASSOC, full_name: "Ada Lovelace" });
    db.rpcHandlers.set_ticket_priority = () => ({ data: null, error: { code: "22023", message: "say why", hint: "reason_required" } });
    db.tables.tickets[0].priority = "urgent";
    expect(await updateTicketDetails(TICKET, { ...details, where: UNIT })).toEqual({
      error: "Say why you're lowering the urgency. Ada will see it.",
    });
  });

  it("refuses a do-not-use or archived contractor before the plan RPC, and sends only given keys", async () => {
    expect(await setTicketPlan(TICKET, { assigned_vendor_id: NOPE })).toEqual({
      error: "The board marked Leaky Larry as do not use: Left the job half done. Change their status first if you want to use them.",
    });
    db.tables.vendors[1].archived_at = "2026-10-01T00:00:00Z";
    expect(await setTicketPlan(TICKET, { assigned_vendor_id: PHONEONLY })).toEqual({ error: "Phone Only Drains is archived. Restore them first." });
    expect(db.rpcs.some((r) => r.name === "set_ticket_plan")).toBe(false);

    expect(await setTicketPlan(TICKET, { assigned_vendor_id: ACME, estimated_cost: "$1,250.5" })).toEqual({ ok: true });
    const plan = db.rpcs.find((r) => r.name === "set_ticket_plan");
    expect(plan?.args).toEqual({ p_ticket_id: TICKET, p_fields: { assigned_vendor_id: ACME, estimated_cost: "1250.50" } });
  });

  it("closes out in one RPC and offers a review when the caller hasn't reviewed the contractor", async () => {
    db.tables.tickets[0].assigned_vendor_id = ACME;
    db.rpcHandlers.close_out_ticket = () => ({ data: [{ upkeep_logged: false, task_next_due_on: null }], error: null });
    const r = await closeOutTicket(TICKET, { status: "resolved", actual_cost: "480", expense_id: null, resolution_note: "Replaced the wax ring", log_upkeep: false });
    expect(r).toEqual({ ok: true, reviewPrompt: { vendorId: ACME, vendorName: "Acme Plumbing" }, upkeepLogged: false, nextDueOn: null });
    expect(db.rpcs.find((x) => x.name === "close_out_ticket")?.args).toMatchObject({ p_status: "resolved", p_actual_cost: "480.00" });
    db.tables.contractor_reviews = [{ id: "r1", vendor_id: ACME, ticket_id: TICKET, created_by: "user-1" }];
    const again = await closeOutTicket(TICKET, { status: "closed", actual_cost: null, expense_id: null, resolution_note: null, log_upkeep: false });
    expect(again).toMatchObject({ reviewPrompt: null });
  });

  it("writes the owners-told note with a date that won't go stale", async () => {
    await markOwnersTold(TICKET, "2026-10-22");
    const note = db.writes.find((w) => w.table === "ticket_comments")?.payload as Record<string, unknown>;
    expect(note).toMatchObject({ body: "Owners were told about the visit on Thu, Oct 22.", is_internal: false });
  });
});

describe("quotes", () => {
  it("drafts emails, scripts calls for contractors without email, in one RPC", async () => {
    db.rpcHandlers.ticket_photos = () => ({ data: [{}, {}], error: null });
    db.rpcHandlers.request_ticket_quotes = (args) => {
      const reqs = args.p_requests as { vendor_id: string; by_phone: boolean; subject: string | null; body: string | null; to_email: string | null }[];
      db.tables.contractor_messages = reqs.filter((q) => !q.by_phone).map((q) => ({ id: `m-${q.vendor_id}`, subject: q.subject, body: q.body, to_email: q.to_email }));
      return {
        data: reqs.map((q) => ({ vendor_id: q.vendor_id, bid_id: `b-${q.vendor_id}`, message_id: q.by_phone ? null : `m-${q.vendor_id}`, outcome: q.by_phone ? "by_phone" : "drafted" })),
        error: null,
      };
    };
    const r = await requestQuotes(TICKET, [{ vendorId: ACME, byPhone: false }, { vendorId: PHONEONLY, byPhone: false }, { vendorId: ACME, byPhone: true }], true);
    if (!("ok" in r)) throw new Error(r.error);
    const sent = db.rpcs.find((x) => x.name === "request_ticket_quotes")?.args.p_requests as { vendor_id: string; by_phone: boolean; body: string | null }[];
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ vendor_id: PHONEONLY, by_phone: true, body: null });
    expect(sent[0].body).toContain("I've attached 2 photos.");
    expect(sent[0].body).not.toContain("Key with Bo");
    expect(r.drafts[0]).toMatchObject({ vendorName: "Acme Plumbing", to: ["pat@acme.example"], messageId: `m-${ACME}` });
    expect(r.calls[0]).toMatchObject({ vendorName: "Phone Only Drains", phone: "312-555-0199" });
    expect(r.calls[0].script).toContain("Where: Inside Unit 1: bathroom");
  });

  it("refuses more than five contractors", async () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ vendorId: `${i}0000000-0000-4000-8000-000000000000`, byPhone: false }));
    expect(await requestQuotes(TICKET, six, false)).toEqual({ error: "Pick up to 5 contractors." });
  });

  it("records a quote against the contractor's requested bid, which becomes received", async () => {
    db.tables.ticket_bids = [{ id: "b1", ticket_id: TICKET, vendor_id: ACME, status: "requested", amount: null }];
    const r = await recordBid({
      ticket_id: TICKET, vendor_id: ACME, bid_id: null, amount: "$4,250", amount_kind: "estimate", received_on: null, valid_until: null,
      can_start_on: null, duration_text: null, scope_text: "Main stack", warranty_text: null, exclusions_text: null, payment_terms_text: "50% deposit", notes: null, document_id: null,
    });
    expect(r).toEqual({ ok: true, bidId: "b1" });
    expect(db.tables.ticket_bids[0]).toMatchObject({ status: "received", amount: "4250.00", amount_kind: "estimate", payment_terms_text: "50% deposit" });
  });

  it("reads pasted quote text with tax IDs redacted, and never more than a quote", async () => {
    expect(await readBidText("short")).toEqual({ error: "Paste at least a line of the quote." });
    expect(await readBidText("x".repeat(20_001))).toEqual({ error: "That's longer than a quote. Paste just the quote." });
    runStructured.mockResolvedValue({
      ok: true,
      data: { contractorName: "Acme", total: "$4,250", amountKind: "fixed", quoteDate: null, validUntil: null, canStartOn: null, duration: null, scope: "Stack", exclusions: null, warranty: null, paymentTerms: null, lineItems: [], confidence: 0.9 },
      meta: { model: "m", fellBack: false, durationMs: 1 },
    });
    const r = await readBidText("Acme Plumbing quote. EIN 12-3456789. Total $4,250 fixed.");
    expect(r).toMatchObject({ ok: true, confidence: 0.9, prefill: { amount: "4250.00", amountKind: "fixed" } });
    const call = runStructured.mock.calls[0][0];
    expect(call).toMatchObject({ kind: "bid_read", effort: "medium", maxTokens: 8000, timeoutMs: 90_000 });
    expect(call.content[0].text).not.toContain("12-3456789");
  });
});

describe("contractor emails", () => {
  it("returns the open draft instead of a second one", async () => {
    db.tables.contractor_messages = [{ id: "m-old", vendor_id: ACME, ticket_id: null, kind: "coi_request", status: "draft", subject: "Old", body: "Body", to_email: "pat@acme.example" }];
    db.fail("contractor_messages", "insert", { code: "23505", message: "contractor_messages_one_draft" });
    const r = await createDraft({ vendorId: ACME, kind: "coi_request" });
    expect(r).toEqual({ ok: true, messageId: "m-old", to: ["pat@acme.example"], subject: "Old", body: "Body", existing: true });
  });

  it("fills the template from structured facts", async () => {
    const r = await createDraft({ vendorId: ACME, kind: "coi_request" });
    if (!("ok" in r)) throw new Error(r.error);
    expect(r.subject).toBe("Damen: certificate of insurance");
    expect(r.body).toContain("Hi Pat,");
    expect(r.body).toContain("2158 N. Damen Condominium Association");
    expect(r.body).toContain("Doug Smart");
  });

  it("marking an already-sent email sent again is harmless", async () => {
    db.tables.contractor_messages = [{ id: "m1", status: "sent", sent_at: "2026-10-10T10:00:00Z" }];
    expect(await markMessageSent("88888888-8888-4888-8888-888888888888")).toEqual({ error: "Only a board member can mark an email sent." });
    db.tables.contractor_messages[0].id = "88888888-8888-4888-8888-888888888888";
    expect(await markMessageSent("88888888-8888-4888-8888-888888888888")).toEqual({ ok: true, sentAt: "2026-10-10T10:00:00Z" });
  });
});

describe("contractor directory", () => {
  it("dates rates only when a rate changed", async () => {
    db.tables.vendors[0].rate_hourly = "95.00";
    db.tables.vendors[0].rate_trip_fee = null;
    db.tables.vendors[0].rate_after_hours = null;
    await updateRates(ACME, { hourly: "95", tripFee: null, afterHours: null, paymentMethods: "Check" });
    expect(db.tables.vendors[0]).not.toHaveProperty("rates_as_of");
    await updateRates(ACME, { hourly: "$110", tripFee: null, afterHours: null, paymentMethods: "Check" });
    expect(db.tables.vendors[0].rate_hourly).toBe("110.00");
    expect(db.tables.vendors[0].rates_as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("archives and counts the open problems they stay on", async () => {
    db.tables.tickets[0].assigned_vendor_id = ACME;
    expect(await archiveContractor(ACME, "Retired")).toEqual({ ok: true, openTickets: 1 });
    expect(db.tables.vendors[0].archived_reason).toBe("Retired");
  });

  it("explains why a linked contractor can't be deleted", async () => {
    db.fail("vendors", "delete", { code: "23503", message: "fk" });
    expect(await deleteContractor(ACME)).toEqual({
      error: "They're linked to payments, problems or tax forms, so they can't be deleted. Archive them instead.",
    });
  });
});

describe("find: Google", () => {
  it("is off without a key", async () => {
    delete process.env.GOOGLE_PLACES_KEY;
    expect(await searchPlaces({ trade: "plumbing", phrase: "" })).toEqual({ source: { state: "off" }, candidates: [] });
  });

  it("searches with vocabulary words only, drops results beyond 15 miles, and marks saved contractors", async () => {
    searchNearby.mockResolvedValue([
      { placeId: "place-acme", name: "Acme Plumbing", address: "1 Main", phone: null, website: null, rating: 4.8, reviewCount: 120, latitude: 41.93, longitude: -87.68, businessStatus: "OPERATIONAL" },
      { placeId: "place-far", name: "Far Away Pipes", address: null, phone: null, website: null, rating: 5, reviewCount: 3, latitude: 42.5, longitude: -87.68 },
      { placeId: "place-new", name: "New Pipes", address: null, phone: "(312) 555-0111", website: null, rating: null, reviewCount: null, latitude: null, longitude: null },
    ]);
    const r = await searchPlaces({ trade: "plumbing", phrase: "Ada's sewer backup at 2158 Damen", miles: 15 });
    expect(searchNearby).toHaveBeenCalledWith("sewer backup", 41.92, -87.678, { includedType: "plumber" });
    expect(r.source).toMatchObject({ state: "ok", cached: false });
    expect(r.candidates.map((c) => c.candidateId)).toEqual(["g:place-acme", "g:place-new"]);
    expect(r.candidates[0].alreadySaved).toMatchObject({ vendorId: ACME, status: "preferred" });
    expect(db.writes.find((w) => w.table === "google_api_calls")?.payload).toMatchObject({ kind: "text_search", trade: "plumbing" });
    expect(db.tables.contractor_search_cache[0]).toMatchObject({ provider: "google", query_key: "sewer backup", location_key: "41.920,-87.678|hrs" });

    searchNearby.mockClear();
    const again = await searchPlaces({ trade: "plumbing", phrase: "sewer backup", miles: 15 });
    expect(searchNearby).not.toHaveBeenCalled();
    expect(again.source).toMatchObject({ state: "ok", cached: true });
  });

  it("stops at the daily Google budget and reports Google being down plainly", async () => {
    db.rpcHandlers.google_calls_today = () => ({ data: 60, error: null });
    expect((await searchPlaces({ trade: "plumbing", phrase: "" })).source).toEqual({ state: "quota", used: 60, limit: 60 });
    db.rpcHandlers.google_calls_today = () => ({ data: 0, error: null });
    const { GoogleUnavailableError } = await import("@/lib/google/places");
    searchNearby.mockRejectedValue(new GoogleUnavailableError("down"));
    expect((await searchPlaces({ trade: "roofing", phrase: "" })).source).toEqual({ state: "error", message: "Google didn't answer. Try again in a minute." });
  });

  it("geocodes once and stores the coordinates through the RPC; no street address means no search", async () => {
    db.tables.associations[0].latitude = null;
    db.tables.associations[0].longitude = null;
    geocode.mockResolvedValue({ latitude: 41.9, longitude: -87.7 });
    searchNearby.mockResolvedValue([]);
    await searchPlaces({ trade: "plumbing", phrase: "" });
    expect(db.rpcs.find((x) => x.name === "set_association_coordinates")?.args).toEqual({ p_association_id: ASSOC, p_latitude: 41.9, p_longitude: -87.7 });
    db.tables.associations[0].street_address = null;
    expect((await searchPlaces({ trade: "plumbing", phrase: "" })).source).toEqual({ state: "no_address" });
  });
});

describe("find: web research", () => {
  it("is off without an API key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await startWebSearch({ trade: "plumbing", phrase: "", wants: [] })).toMatchObject({ off: true });
  });

  it("returns a fresh cached search without spending quota", async () => {
    db.tables.contractor_search_cache = [{
      id: "row-1", association_id: ASSOC, provider: "web", trade: "plumbing", query_key: "|emergency", location_key: "60647",
      ai_state: "done", fetched_at: new Date().toISOString(),
    }];
    expect(await startWebSearch({ trade: "plumbing", phrase: "", wants: ["emergency", "bogus" as never] })).toEqual({ ok: true, rowId: "row-1", state: "done" });
    expect(db.rpcs.some((x) => x.name === "claim_ai_call")).toBe(false);
  });

  it("says so at the quota, before anything starts", async () => {
    db.rpcHandlers.claim_ai_call = () => ({ data: null, error: { code: "P0001", message: "quota", hint: "ai_quota" } });
    const r = await startWebSearch({ trade: "plumbing", phrase: "", wants: [] });
    expect(r).toMatchObject({ quota: true });
    expect(afterCallbacks).toHaveLength(0);
  });

  it("claims, runs in the background with a scrubbed task, verifies and caches", async () => {
    db.tables.contractor_search_cache = [];
    const r = await startWebSearch({ trade: "plumbing", phrase: "Ada sewer rodding", wants: ["free_estimates"] });
    expect(r).toMatchObject({ ok: true, state: "running" });
    const row = db.tables.contractor_search_cache[0];
    expect(row).toMatchObject({ provider: "web", query_key: "sewer rodding|free_estimates", location_key: "60647", ai_state: "running" });

    webResearch.mockImplementation(async (opts: { nameOf: (i: unknown) => string; task: string }) => {
      opts.nameOf({ name: "Kept" });
      opts.nameOf({ name: "Dropped" });
      return { ok: true, result: { items: [{ name: "Kept", sourceUrls: ["https://kept.example/"] }], sources: [{ url: "https://kept.example/", title: null }], fetchedAt: "2026-10-14T18:00:00Z", partial: false, checkedPages: 3 }, meta: {} };
    });
    await afterCallbacks[0]();
    const opts = webResearch.mock.calls[0][0];
    expect(opts).toMatchObject({ kind: "contractor_search", claim: { id: "claim-1" }, maxSearches: 4, userLocation: { city: "Chicago", region: "IL", country: "US", postal_code: "60647" } });
    expect(opts.task).toContain("do plumbing work (specifically: sewer rodding)");
    expect(opts.task).not.toContain("Ada");
    expect(opts.task).not.toContain("Damen Ave");
    expect(row).toMatchObject({ ai_state: "done", dropped_count: 1, fetched_at: "2026-10-14T18:00:00Z" });
    expect(row.results_json).toEqual([{ name: "Kept", sourceUrls: ["https://kept.example/"] }]);
  });

  it("records a failed run without losing earlier results", async () => {
    db.tables.contractor_search_cache = [{
      id: "row-2", association_id: ASSOC, provider: "web", trade: "plumbing", query_key: "|", location_key: "60647",
      ai_state: "done", fetched_at: "2020-01-01T00:00:00Z", results_json: [{ name: "Old" }],
    }];
    webResearch.mockResolvedValue({ ok: false, reason: "The search stopped before it finished. Try again.", configured: true });
    await startWebSearch({ trade: "plumbing", phrase: "", wants: [] });
    await afterCallbacks[0]();
    expect(db.tables.contractor_search_cache[0]).toMatchObject({ ai_state: "failed", ai_error: "The search stopped before it finished. Try again.", results_json: [{ name: "Old" }] });
  });
});

describe("find: save", () => {
  beforeEach(() => {
    db.tables.contractor_search_cache = [
      {
        id: "g-row", association_id: ASSOC, provider: "google", fetched_at: new Date().toISOString(),
        results_json: [{ placeId: "place-new", name: "New Pipes", address: "9 Elm", phone: "(312) 555-0111", website: null, rating: 4.4, reviewCount: 40, latitude: null, longitude: null, businessStatus: "OPERATIONAL" }],
      },
      {
        id: "99999999-9999-4999-8999-999999999999", association_id: ASSOC, provider: "web", fetched_at: new Date().toISOString(),
        results_json: [
          { name: "Leaky Larry", websiteUrl: null, phone: null, email: null, sourceUrls: [] },
          { name: "Web Drains", websiteUrl: "https://webdrains.example/", phone: null, email: "hi@webdrains.example", emergencyService: true, mentionsCondoWork: true, smallJobsWelcome: null, freeEstimates: true, sourceUrls: ["https://webdrains.example/"] },
        ],
      },
    ];
  });

  it("saves a Google result from the cache, never from the browser", async () => {
    const r = await saveCandidate("g:place-new", "plumbing");
    expect(r).toMatchObject({ ok: true, alreadySaved: false });
    const v = db.tables.vendors[db.tables.vendors.length - 1];
    expect(v).toMatchObject({ name: "New Pipes", google_place_id: "place-new", google_rating: 4.4, google_business_status: "OPERATIONAL", source: "google", trades: ["plumbing"], status: "okay" });
  });

  it("saves a web result with its verified flags as tags and its sources", async () => {
    await saveCandidate("w:99999999-9999-4999-8999-999999999999:1", "plumbing");
    const v = db.tables.vendors[db.tables.vendors.length - 1];
    expect(v).toMatchObject({ name: "Web Drains", source: "web", emergency_service: true, job_tags: ["condo_work", "free_estimates"], source_urls: ["https://webdrains.example/"] });
  });

  it("refuses expired results and the board's do-not-use contractors", async () => {
    expect(await saveCandidate("g:place-gone", "plumbing")).toMatchObject({ ok: false, reason: "expired" });
    expect(await saveCandidate("w:99999999-9999-4999-8999-999999999999:0", "plumbing")).toMatchObject({
      ok: false, reason: "do_not_use", message: "Your board marked Leaky Larry as do not use: Left the job half done.",
    });
    db.tables.contractor_search_cache[0].fetched_at = "2020-01-01T00:00:00Z";
    expect(await saveCandidate("g:place-new", "plumbing")).toMatchObject({ ok: false, reason: "expired" });
  });

  it("offers the existing contractor when the name is taken", async () => {
    // Another board member saved the same name a moment earlier (after this search was matched).
    const query = db.query.bind(db);
    db.query = ((table: string) => {
      const q = query(table);
      if (table === "vendors") {
        const insert = q.insert;
        q.insert = (p) => {
          db.tables.vendors.push({ id: "v-np", association_id: ASSOC, name: "New Pipes", status: "okay" });
          return insert(p);
        };
      }
      return q;
    }) as typeof db.query;
    db.fail("vendors", "insert", { code: "23505", message: "vendors_association_id_name_key" });
    const r = await saveCandidate("g:place-new", "plumbing");
    expect(r).toEqual({ ok: false, reason: "name_taken", message: "You already have a contractor called New Pipes.", existingVendorId: "v-np" });
  });
});

describe("upkeep and bills", () => {
  it("adds a task in one RPC with a guessed trade and the building's today", async () => {
    db.rpcHandlers.add_upkeep_task = () => ({ data: [{ task_id: "task-1", task_next_due_on: "2026-11-30" }], error: null });
    const r = await addUpkeepTask({ name: "Gutters cleared", description: null, interval_months: 12, due_month: 11, vendor_id: null, estimated_cost: "$300" });
    expect(r).toEqual({ ok: true, taskId: "task-1", nextDueOn: "2026-11-30" });
    const args = db.rpcs.find((x) => x.name === "add_upkeep_task")?.args;
    expect(args).toMatchObject({ p_trade: "gutters", p_estimated_cost: "300.00", p_due_month: 11, p_last_done_on: null, p_next_due_on: null });
    expect(String(args?.p_initial_next_due)).toMatch(/-11-30$/);
  });

  it("refuses a usual month for monthly jobs and a future last-done date", async () => {
    expect(await addUpkeepTask({ name: "Mop", description: null, interval_months: 1, due_month: 3, vendor_id: null, estimated_cost: null })).toEqual({
      error: 'Pick "Any time" for monthly jobs, or choose a different interval.',
    });
    expect(await addUpkeepTask({ name: "Mop", description: null, interval_months: 12, due_month: null, vendor_id: null, estimated_cost: null, last_done_on: "2999-01-01" })).toEqual({
      error: "The last-done date can't be in the future.",
    });
  });

  it("marks upkeep done in one RPC and offers a review of who did it", async () => {
    db.rpcHandlers.mark_upkeep_done = () => ({ data: [{ log_id: "log-1", task_last_done_on: "2026-10-14", task_next_due_on: "2027-09-30" }], error: null });
    const r = await markUpkeepDone("12121212-1212-4212-8212-121212121212", { done_on: "2026-10-01", cost: "240", vendor_id: ACME, note: null });
    expect(r).toEqual({ ok: true, nextDueOn: "2027-09-30", logId: "log-1", reviewPrompt: { vendorId: ACME, vendorName: "Acme Plumbing" } });
  });

  it("will not mark a bill paid without a transaction to tie it to", async () => {
    expect(await markBillPaid(BILL, { due_on: "2026-10-15", paid_on: "2026-10-14", amount: null, note: null, expense_id: "" })).toEqual({
      error: "Pick the transaction in the books that paid it.",
    });
  });

  it("maps a second mark-paid to 'Already marked paid' with the current due date", async () => {
    db.tables.recurring_bills = [{ id: BILL, next_due_on: "2026-11-15" }];
    db.rpcHandlers.mark_bill_paid = () => ({ data: null, error: { code: "23505", message: "that due date is already marked paid" } });
    const r = await markBillPaid(BILL, { due_on: "2026-10-15", paid_on: "2026-10-14", amount: null, note: null, expense_id: PAYMENT });
    expect(r).toMatchObject({ nextDueOn: "2026-11-15" });
    expect((r as { error: string }).error).toMatch(/^Already marked paid for /);
    db.rpcHandlers.mark_bill_paid = () => ({ data: null, error: { code: "22023", message: "this bill is paused; resume it first" } });
    expect(await markBillPaid(BILL, { due_on: "2026-11-15", paid_on: "2026-10-14", amount: null, note: null, expense_id: PAYMENT })).toEqual({ error: "This bill is paused; resume it first." });
    db.rpcHandlers.mark_bill_paid = () => ({ data: [{ payment_id: "p1", bill_next_due_on: "2026-12-15" }], error: null });
    expect(await markBillPaid(BILL, { due_on: "2026-11-15", paid_on: "2026-11-14", amount: "$80", note: null, expense_id: PAYMENT })).toEqual({ ok: true, nextDueOn: "2026-12-15" });
  });
});

describe("calendar export", () => {
  const request = { nextUrl: { origin: "https://walkup.test" } } as never;

  it("is for members only", async () => {
    db.rpcHandlers.is_member = () => ({ data: false, error: null });
    const res = await calendarGET(request);
    expect(res.status).toBe(403);
  });

  it("lists upkeep, visits and (for the board) renewals as an .ics download", async () => {
    db.tables.upkeep_tasks = [{ id: "task-1", association_id: ASSOC, name: "Boiler service", next_due_on: "2026-09-30", interval_months: 12, due_month: 9, description: null, updated_at: "2026-10-01T00:00:00Z", is_active: true }];
    db.tables.tickets[0].scheduled_for = "2099-10-22";
    db.tables.tickets[0].scheduled_window = "8 to 10am";
    db.tables.tickets[0].updated_at = "2026-10-01T00:00:00Z";
    db.tables.insurance_policies = [{ id: "pol-1", association_id: ASSOC, coverage: "property", carrier_name: "Acme Mutual", effective_to: "2099-03-01", renewal_reminder_days: 60, created_at: "2026-01-01T00:00:00Z", replaced_at: null, archived_at: null }];
    const res = await calendarGET(request);
    expect(res.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="Walkup upkeep.ics"');
    const text = await res.text();
    expect(text).toContain("UID:upkeep-task-1@walkup");
    expect(text).toContain(`UID:visit-${TICKET}@walkup`);
    expect(text).toContain("UID:insurance-pol-1-renews@walkup");

    board = false;
    const owner = await (await calendarGET(request)).text();
    expect(owner).not.toContain("insurance-pol-1");
  });
});
