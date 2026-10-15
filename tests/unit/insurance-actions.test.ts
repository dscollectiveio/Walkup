import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The insurance server actions against a small in-memory Supabase fake: the
 * model is mocked (runStructured), after() only records its callback, and
 * the loaders the actions share are stubbed. What matters here is what each
 * action sends where: values to the RPCs, facts (never names or figures) to
 * the model.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { afterCallbacks, runStructured, state } = vi.hoisted(() => ({
  afterCallbacks: [] as (() => unknown)[],
  runStructured: vi.fn(),
  state: { db: null as unknown as FakeDb },
}));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => afterCallbacks.push(fn) }));
vi.mock("@/lib/ai/structured", () => ({ runStructured: (...a: unknown[]) => runStructured(...a) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.db.client }));

const ASSOC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const association = {
  id: ASSOC, legal_name: "2158 N. Damen Condominium Association", display_name: "Damen", state_code: "IL",
  street_address: "2158 N Damen Ave", city: "Chicago", postal_code: "60647", year_built: 1905,
  construction_type: "joisted_masonry", stories: 3, roof_replaced_year: 2019,
};
vi.mock("@/lib/insurance/queries", () => ({
  currentAssociation: async () => association,
  isBoard: async () => state.db.board,
  unitCount: async () => 3,
  loadPolicies: async () => state.db.policies,
  loadPolicy: async () => null,
  loadCheckInput: async () => ({
    todayIso: "2026-10-14", stateCode: "IL", unitCount: 3, facts: null, policies: state.db.policies, fundsTotal: null,
    history: [], legalName: association.legal_name, quotesThisTerm: {}, dismissals: [],
  }),
}));

type Row = Record<string, unknown>;

class FakeDb {
  tables: Record<string, Row[]> = {};
  rpcs: { name: string; args: Row }[] = [];
  rpcResults: Record<string, { data: unknown; error: unknown }> = {};
  board = true;
  policies: Row[] = [];
  private n = 0;

  id() {
    this.n += 1;
    return `00000000-0000-4000-8000-${String(this.n).padStart(12, "0")}`;
  }

  get client() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const db = this;
    return {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      rpc: async (name: string, args: Row) => {
        db.rpcs.push({ name, args });
        return db.rpcResults[name] ?? { data: null, error: null };
      },
      from: (table: string) => db.query(table),
    };
  }

  query(table: string) {
    const rows = () => (this.tables[table] ??= []);
    const filters: ((r: Row) => boolean)[] = [];
    let mode: "select" | "insert" | "update" = "select";
    let payload: Row | Row[] | null = null;
    const matching = () => rows().filter((r) => filters.every((f) => f(r)));
    const run = () => {
      if (mode === "insert") {
        const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
        const inserted = list.map((p) => ({ id: this.id(), ...p }));
        rows().push(...inserted);
        return inserted;
      }
      if (mode === "update") {
        const hit = matching();
        for (const r of hit) Object.assign(r, payload);
        return hit;
      }
      return matching();
    };
    const b = {
      select: () => b,
      insert: (p: Row | Row[]) => {
        mode = "insert";
        payload = p;
        return b;
      },
      update: (p: Row) => {
        mode = "update";
        payload = p;
        return b;
      },
      eq: (c: string, v: unknown) => {
        filters.push((r) => r[c] === v);
        return b;
      },
      is: (c: string, v: unknown) => {
        filters.push((r) => (r[c] ?? null) === v);
        return b;
      },
      in: (c: string, vs: unknown[]) => {
        filters.push((r) => vs.includes(r[c]));
        return b;
      },
      ilike: (c: string, v: string) => {
        filters.push((r) => String(r[c] ?? "").toLowerCase() === v.replace(/\\(.)/g, "$1").toLowerCase());
        return b;
      },
      gte: (c: string, v: string) => {
        filters.push((r) => String(r[c] ?? "") >= v);
        return b;
      },
      lt: () => b,
      or: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      single: async () => ({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(resolve),
    };
    return b;
  }
}

import { createQuoteRequests } from "@/app/insurance/request-actions";
import { composeInsuranceEmail } from "@/app/insurance/message-actions";
import { startInsuranceRead } from "@/app/insurance/import-actions";
import { savePolicy, type SavePolicyInput } from "@/app/insurance/policy-actions";
import type { QuoteRequestPayloadV2 } from "@/lib/insurance/emails";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  state.db = new FakeDb();
  afterCallbacks.length = 0;
  runStructured.mockReset();
  process.env.ANTHROPIC_API_KEY = "test-key";
  state.db.tables.insurance_contacts = [
    { id: C1, association_id: ASSOC, name: "Acme Insurance Agency", person_name: "Pat Lee", kind: "agency", email: "quotes@acme.example", partner_id: null, is_current_agent: true, archived_at: null },
    { id: C2, association_id: ASSOC, name: "Lakeside Brokers", person_name: null, kind: "broker", email: "info@lakeside.example", partner_id: null, is_current_agent: false, archived_at: null },
  ];
  state.db.tables.persons = [{ id: "person-1", full_name: "Doug Smart", email: "doug@example.com", phone: null }];
  state.db.rpcResults.current_person_id = { data: "person-1", error: null };
});

const payload: QuoteRequestPayloadV2 = {
  version: 2,
  association: {
    legal_name: association.legal_name, address: "2158 N Damen Ave, Chicago, IL 60647", city: "Chicago", units: 3,
    year_built: 1905, construction: "joisted_masonry", stories: 3, roof_replaced_year: 2019,
    total_square_feet: 4200, has_sprinklers: false, has_amenities: true, rental_share: "0.3300",
  },
  coverages: [{ coverage: "property", wanted: { building_limit: "2400000.00" } }],
  deductibles_today: null,
  current: null,
  claims: [],
  include_claim_amounts: false,
  anything_else: null,
  contact: { name: "Doug Smart", email: "doug@example.com", phone: null },
};

describe("createQuoteRequests", () => {
  it("needs consent and an email for every contact", async () => {
    expect(await createQuoteRequests({ contactIds: [C1], payload, consent: false as unknown as true }))
      .toEqual({ error: "Tick the box confirming these details can be shared." });
    state.db.tables.insurance_contacts[1].email = null;
    expect(await createQuoteRequests({ contactIds: [C1, C2], payload, consent: true }))
      .toEqual({ error: "Lakeside Brokers has no email address. Add one or choose another contact." });
    expect(state.db.rpcs.some((r) => r.name === "create_insurance_quote_requests")).toBe(false);
  });

  it("drafts once from facts only, then one request and draft per contact in one RPC", async () => {
    runStructured.mockResolvedValue({ ok: false, code: "busy", reason: "busy", configured: true, counted: false });
    state.db.rpcResults.create_insurance_quote_requests = {
      data: [{ request_id: "r1", message_id: "m1" }, { request_id: "r2", message_id: "m2" }], error: null,
    };
    const r = await createQuoteRequests({ contactIds: [C1, C2], payload, consent: true });
    expect(r).toMatchObject({ ok: true, requestIds: ["r1", "r2"], messageIds: ["m1", "m2"], draftedBy: "template" });
    expect(runStructured).toHaveBeenCalledTimes(1);
    const sent = runStructured.mock.calls[0][0].content as string;
    for (const secret of ["Damen", "doug@example.com", "2400000", "Pat Lee", "acme"]) expect(sent).not.toContain(secret);

    const call = state.db.rpcs.find((x) => x.name === "create_insurance_quote_requests")!;
    const messages = call.args.p_messages as { body: string; to_email: string; facts_json: unknown }[];
    const requests = call.args.p_requests as { contact_id: string; coverages: string[] }[];
    expect(requests.map((q) => q.contact_id)).toEqual([C1, C2]);
    expect(requests[0].coverages).toEqual(["property"]);
    expect(messages[0].body.startsWith("Hello Pat Lee,")).toBe(true);
    expect(messages[1].body.startsWith("Hello there,")).toBe(true);
    expect(messages[0].body).toContain("Legal name: 2158 N. Damen Condominium Association");
    expect(messages.map((m) => m.to_email)).toEqual(["quotes@acme.example", "info@lakeside.example"]);
    expect(JSON.stringify(messages[0].facts_json)).not.toMatch(/[\d@]/);
  });
});

describe("composeInsuranceEmail", () => {
  it("a certificate request: the holder goes in the email, never to the model, and the owner's request is linked", async () => {
    state.db.tables.insurance_owner_requests = [{ id: "33333333-3333-4333-8333-333333333333", status: "open", message_id: null }];
    runStructured.mockResolvedValue({ ok: false, code: "refused", reason: "x", configured: true, counted: true });
    const r = await composeInsuranceEmail({
      kind: "certificate_request", contactId: C1, toEmail: null,
      ownerRequestId: "33333333-3333-4333-8333-333333333333",
      holder: { name: "Chase Bank, ISAOA/ATIMA", address: "PO Box 47020, Atlanta GA 30362, loan 99887766", kind: "mortgage_lender" },
    });
    if (!("ok" in r)) throw new Error(r.error);
    expect(r.body).toContain("Chase Bank, ISAOA/ATIMA");
    const sent = runStructured.mock.calls[0][0].content as string;
    expect(sent).not.toContain("Chase");
    expect(sent).not.toContain("99887766");
    expect(sent).toContain("mortgage_lender");
    const msg = state.db.tables.insurance_messages[0];
    expect(msg).toMatchObject({ kind: "certificate_request", status: "draft", to_email: "quotes@acme.example", drafted_by: "template" });
    expect(state.db.tables.insurance_owner_requests[0].message_id).toBe(r.messageId);
  });

  it("my own question is template-only: nothing goes to the model", async () => {
    const r = await composeInsuranceEmail({ kind: "coverage_question", contactId: C1, toEmail: null, question: "Does our policy cover sewer backup?" });
    if (!("ok" in r)) throw new Error(r.error);
    expect(runStructured).not.toHaveBeenCalled();
    expect(r.body).toContain("Does our policy cover sewer backup?");
    expect(r.draftedBy).toBe("template");
  });

  it("needs somewhere to send it, and a quote request goes through the request flow", async () => {
    expect(await composeInsuranceEmail({ kind: "documents_request", contactId: null, toEmail: null }))
      .toEqual({ error: "Choose a contact with an email address, or type one." });
    expect(await composeInsuranceEmail({ kind: "quote_request", contactId: C1, toEmail: null }))
      .toEqual({ error: "Use Ask for quotes to write quote requests." });
  });

  it("only the board writes to agents", async () => {
    state.db.board = false;
    expect(await composeInsuranceEmail({ kind: "documents_request", contactId: C1, toEmail: null }))
      .toEqual({ error: "Only a board member can write to agents." });
  });
});

describe("startInsuranceRead", () => {
  const DOC = "44444444-4444-4444-8444-444444444444";

  it("refuses a file not filed as Insurance (decision 7)", async () => {
    state.db.tables.documents = [{ id: DOC, filename: "1120-H.pdf", document_categories: { slug: "tax_forms" } }];
    expect(await startInsuranceRead({ documentId: DOC, mode: "policy" }))
      .toEqual({ error: "Walkup only reads files filed as Insurance. File this one as Insurance in the Document Hub first." });
    expect(state.db.tables.insurance_document_reads ?? []).toHaveLength(0);
  });

  it("creates a read and runs it in the background; a second start reuses it, whatever its state", async () => {
    state.db.tables.documents = [{ id: DOC, filename: "dec.pdf", document_categories: { slug: "insurance" } }];
    const first = await startInsuranceRead({ documentId: DOC, mode: "policy" });
    if (!("ok" in first)) throw new Error(first.error);
    expect(first.reused).toBe(false);
    expect(afterCallbacks).toHaveLength(1);
    const read = state.db.tables.insurance_document_reads[0];
    Object.assign(read, { state: "failed", attempts: 3, created_at: new Date().toISOString() });
    const again = await startInsuranceRead({ documentId: DOC, mode: "policy" });
    expect(again).toEqual({ ok: true, readId: first.readId, reused: true });
    expect(afterCallbacks).toHaveLength(1);
  });
});

describe("savePolicy", () => {
  const input = (over: Partial<SavePolicyInput> = {}): SavePolicyInput => ({
    policyId: null,
    clientToken: "55555555-5555-4555-8555-555555555555",
    coverage: "directors_officers",
    includedSections: [],
    values: { carrier_name: "Great American", effective_on: "2026-03-01", expires_on: "2027-03-01", annual_premium: "$1,250", do_limit: "$1,000,000", agency_name: "Acme Insurance Agency", agent_email: "quotes@acme.example" },
    meta: { do_limit: { source: "extracted", candidateIndex: 0 } },
    clearLegacy: false,
    endorsements: [],
    exclusions: [],
    premiumBreakdown: [],
    renewalReminderDays: 60,
    notes: null,
    agentContactId: null,
    options: { readId: "66666666-6666-4666-8666-666666666666", readIndex: 0, documentId: "77777777-7777-4777-8777-777777777777" },
    ...over,
  });

  it("returns field errors without calling the RPC", async () => {
    const r = await savePolicy(input({ values: { carrier_name: "Great American" } }));
    expect(r).toMatchObject({ fieldErrors: { annual_premium: "Annual premium is needed to save." } });
    expect(state.db.rpcs.some((x) => x.name === "save_insurance_policy")).toBe(false);
  });

  it("warns about a duplicate instead of saving", async () => {
    state.db.tables.insurance_policies = [{
      id: "dup-1", association_id: ASSOC, coverage: "directors_officers", carrier_name: "GREAT AMERICAN Co.",
      effective_from: "2026-03-01", policy_number: null, created_at: "2026-03-05T10:00:00Z", archived_at: null,
    }];
    expect(await savePolicy(input())).toEqual({ duplicateOf: { id: "dup-1", carrier: "GREAT AMERICAN Co.", savedOn: "2026-03-05" } });
  });

  it("sends columns, per-field sources and options; the agent becomes the current agent", async () => {
    state.db.rpcResults.save_insurance_policy = { data: "88888888-8888-4888-8888-888888888888", error: null };
    const r = await savePolicy(input());
    expect(r).toEqual({ ok: true, policyId: "88888888-8888-4888-8888-888888888888" });
    const call = state.db.rpcs.find((x) => x.name === "save_insurance_policy")!;
    expect(call.args.p_values).toMatchObject({
      coverage: "directors_officers", carrier_name: "Great American", annual_premium: "1250.00", do_limit: "1000000.00",
      included_sections: ["do"], renewal_reminder_days: 60, agent_contact_id: C1,
    });
    expect(call.args.p_values).not.toHaveProperty("building_limit");
    expect(call.args.p_sources).toEqual(expect.arrayContaining([
      { field_name: "do_limit", source: "extracted", candidate_index: 0 },
      { field_name: "carrier_name", source: "manual" },
    ]));
    expect(call.args.p_options).toEqual({
      document_id: "77777777-7777-4777-8777-777777777777", read_id: "66666666-6666-4666-8666-666666666666", read_index: 0,
      client_token: "55555555-5555-4555-8555-555555555555",
    });
    expect(state.db.rpcs.find((x) => x.name === "set_current_insurance_agent")?.args).toEqual({ p_contact_id: C1 });
    expect(afterCallbacks).toHaveLength(1); // the summary, in the background
  });

  it("maps the already-saved 23505 to its message and the saved id", async () => {
    state.db.rpcResults.save_insurance_policy = {
      data: null, error: { code: "23505", message: "This policy was already saved from this file.", details: "pol-9" },
    };
    expect(await savePolicy(input({ saveAsSeparate: true })))
      .toEqual({ error: "This policy was already saved from this file.", alreadySavedId: "pol-9" });
  });
});
