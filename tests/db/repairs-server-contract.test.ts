import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Fixture } from "./fixtures";
import { EXTRA, addVendors, queries, seededDb } from "./repairs-helpers";

/**
 * The Repairs server actions build their RPC payloads in TypeScript; 0053
 * validates them again in SQL. These tests feed what the TypeScript side
 * actually produces (post-processed triage, template emails, plan fields from
 * the zod schemas) into the real functions, so the two sides can't drift
 * apart (repairs-spec §5.1, §7.2, §8.2).
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => { throw new Error("not used"); } }));

import { postProcessTriage } from "@/lib/repairs/triage";
import { storedTriageSchema, ticketPlanSchema } from "@/lib/repairs/validate";
import { callScript, quoteRequestDraft } from "@/lib/repairs/drafts";

describe("Repairs server payloads against 0053", () => {
  let db: PGlite;
  let f: Fixture;
  const { q, one, rows } = queries(() => db);

  beforeEach(async () => {
    ({ db, f } = await seededDb());
    await addVendors(db, f);
  });
  afterEach(async () => {
    await db.close();
  });

  const reportShared = async (user: string, title: string) =>
    (await one<{ id: string }>(user, `insert into public.tickets (association_id, title, priority) values ($1::uuid, $2, 'normal') returning id`, [f.damen, title])).id;

  it("a post-processed triage is accepted from the reporter and parses back", async () => {
    const id = await reportShared(f.adaUser, "Water coming through the hallway ceiling");
    const stored = postProcessTriage(
      {
        trade: "other",
        secondaryTrade: "plumbing",
        urgency: "urgent",
        emergency: "flooding",
        searchPhrase: "Ada's ceiling leak repair at 2158 N Damen in unit 2B, the water pipe drip",
        reason: `Water is coming through — ${"a long reason ".repeat(30)}`,
        questionsForReporter: ["Is water still coming in?", "q".repeat(400), "Which floor?", "Anything else?"],
        confidence: 3,
      },
      "claude-opus-5-5",
      new Date().toISOString(),
    );
    // The reporter's finished AI call that REVIEW-1 #13 requires before a "done" triage.
    const claim = await one<{ id: string }>(f.adaUser, `select public.claim_ai_call($1::uuid, 'ticket_triage') as id`, [f.damen]);
    await q(f.adaUser, `select public.finish_ai_call($1::uuid, true)`, [claim.id]);
    await q(f.adaUser, `select public.record_ticket_triage($1::uuid, $2::jsonb, $3)`, [id, JSON.stringify(stored), stored.trade]);
    const back = await one<{ triage: unknown; trade: string }>(
      null,
      `select d.triage, t.trade from public.ticket_board_details d join public.tickets t on t.id = d.ticket_id where d.ticket_id = $1::uuid`,
      [id],
    );
    expect(storedTriageSchema.safeParse(back.triage).success).toBe(true);
    expect(back.trade).toBe(stored.trade);
  });

  it("the skipped and failed states are accepted too", async () => {
    const at = new Date().toISOString();
    for (const payload of [
      { state: "skipped", reason: "reporter_limit", at },
      { state: "skipped", reason: "quota", at },
      { state: "skipped", reason: "not_configured", at },
      { state: "failed", reason: "error", at },
    ]) {
      await q(f.cyUser, `select public.record_ticket_triage($1::uuid, $2::jsonb, null)`, [f.ticketCommon, JSON.stringify(payload)]);
    }
    const t = await one<{ triage: unknown }>(null, `select triage from public.ticket_board_details where ticket_id = $1::uuid`, [f.ticketCommon]);
    expect(storedTriageSchema.safeParse(t.triage).success).toBe(true);
  });

  it("template quote requests and a phone request go through request_ticket_quotes", async () => {
    const draft = quoteRequestDraft(
      {
        association: { displayName: "Damen", legalName: "2158 N. Damen Condominium Association", address: "2158 N Damen Ave, Chicago, IL 60647" },
        sender: { name: "Cy Board", phone: "312-555-0100" },
        contractor: { name: "Damen Plumbing", contactName: "Pat Lee" },
      },
      { reference: 1, title: "Roof leak over the stairs", description: "x".repeat(3900), where: "Shared area: back stairwell", photosAttached: 3 },
    );
    const result = await rows<{ vendor_id: string; outcome: string; message_id: string | null }>(
      f.cyUser,
      `select * from public.request_ticket_quotes($1::uuid, $2::jsonb)`,
      [
        f.ticketCommon,
        JSON.stringify([
          { vendor_id: EXTRA.damenVendor, by_phone: false, to_email: "pat@example.com", subject: draft.subject, body: draft.body },
          { vendor_id: EXTRA.damenVendor2, by_phone: true, to_email: null, subject: null, body: null },
        ]),
      ],
    );
    expect(result.map((r) => r.outcome).sort()).toEqual(["by_phone", "drafted"]);
    const msg = await one<{ body: string; kind: string }>(null, `select body, kind from public.contractor_messages where id = $1::uuid`, [
      result.find((r) => r.outcome === "drafted")!.message_id,
    ]);
    expect(msg).toEqual({ body: draft.body, kind: "quote_request" });
    expect(callScript({ title: "Roof leak", where: "Shared area" })).toContain("Job: Roof leak.");
  });

  it("plan fields from ticketPlanSchema are accepted by set_ticket_plan", async () => {
    const fields = ticketPlanSchema.parse({
      assigned_vendor_id: EXTRA.damenVendor, scheduled_for: "2026-10-22", scheduled_window: "8 to 10am", estimated_cost: "$1,250.5", due_on: null,
    });
    await q(f.cyUser, `select public.set_ticket_plan($1::uuid, $2::jsonb)`, [f.ticketCommon, JSON.stringify(fields)]);
    const t = await one<{ vendor: string; window: string; estimate: string; due: string | null }>(
      null,
      `select t.assigned_vendor_id::text as vendor, t.scheduled_window as window, d.estimated_cost::text as estimate, d.due_on::text as due
         from public.tickets t join public.ticket_board_details d on d.ticket_id = t.id where t.id = $1::uuid`,
      [f.ticketCommon],
    );
    expect(t).toEqual({ vendor: EXTRA.damenVendor, window: "8 to 10am", estimate: "1250.50", due: null });
  });
});
