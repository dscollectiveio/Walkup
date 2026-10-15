// Regression tests for docs/security/REVIEW-2-server.md findings 17, 21, 24, 26, 28 and 29, run against
// the server actions with a recording stand-in for the Supabase client.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/ai/client", () => ({ aiConfigured: () => false }));
vi.mock("@/lib/repairs/triage", () => ({ recordTriage: vi.fn(), triageAndRecord: vi.fn(), triageTicket: vi.fn() }));

type Row = Record<string, unknown>;
interface FakeOpts {
  tables?: Record<string, Row[]>;
  count?: number;
  rpcError?: { code: string; message: string } | null;
  user?: { id: string } | null;
}
const rpcCalls: { name: string; args: Row }[] = [];
const inserts: { table: string; row: Row }[] = [];
const orders: string[] = [];
let opts: FakeOpts = {};

function builder(table: string) {
  let head = false;
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "is", "in", "lte", "gte", "limit", "not"]) {
    chain[m] = (...args: unknown[]) => {
      if (m === "select" && (args[1] as { head?: boolean } | undefined)?.head) head = true;
      return chain;
    };
  }
  chain.order = (col: string) => {
    if (table === "associations") orders.push(col);
    return chain;
  };
  chain.insert = (row: Row) => {
    inserts.push({ table, row });
    return {
      select: () => Promise.resolve({ data: [{ id: "t1", reference: 7, emergency_kind: null }], error: null }),
    };
  };
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(
      head ? { data: null, count: opts.count ?? 0, error: null } : { data: opts.tables?.[table] ?? [], error: null },
    ).then(resolve);
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (t: string) => builder(t),
    rpc: async (name: string, args: Row) => {
      rpcCalls.push({ name, args });
      if (name === "record_assessment_charge") return { error: opts.rpcError ?? null };
      if (name === "has_role_in" || name === "is_board") return { data: true, error: null };
      return { data: null, error: null };
    },
    auth: { getUser: async () => ({ data: { user: opts.user === undefined ? { id: "u1" } : opts.user } }) },
  }),
}));

import { addUnitCharge } from "@/app/dues/actions";
import { createTicket } from "@/app/maintenance/actions";
import { canShareWithOwners } from "@/lib/owner/shareable-documents";
import { parseQuoteRequestPayload } from "@/lib/insurance/request-payload";
import { claimAutoSync, releaseAutoSync } from "@/lib/plaid/auto-sync-claim";
import { currentAssociationId } from "@/lib/documents/access";

beforeEach(() => {
  rpcCalls.length = 0;
  inserts.length = 0;
  orders.length = 0;
  opts = {};
});

describe("21. a late fee is the association's rule, once per unit and period", () => {
  const base = { unitId: "u-1", kind: "late_fee" as const, periodStart: "2026-09-01", amount: 1 };
  const tables = (existing: Row[]): Record<string, Row[]> => ({
    associations: [{ id: "a1", dues_late_fee_amount: "25.00" }],
    assessment_charges: existing,
    fiscal_years: [{ id: "fy" }],
    accounts: [{ id: "ar", code: "1200" }, { id: "inc", code: "4020" }],
    funds: [{ id: "fund" }],
  });

  it("ignores the amount the browser sent and posts the rule's", async () => {
    opts = { tables: tables([]) };
    const r = await addUnitCharge({ ...base, amount: 9999 });
    expect(r).toEqual({ ok: true });
    expect(rpcCalls.find((c) => c.name === "record_assessment_charge")?.args.p_amount).toBe(25);
  });

  it("a second click or a second board member finds the first charge and stops", async () => {
    opts = { tables: tables([{ id: "c1" }]) };
    const r = await addUnitCharge(base);
    expect(r).toEqual({ error: "A late fee for that period was already added." });
    expect(rpcCalls.some((c) => c.name === "record_assessment_charge")).toBe(false);
  });

  it("refuses a late fee when the association has no rule", async () => {
    const t = tables([]);
    t.associations = [{ id: "a1", dues_late_fee_amount: null }];
    opts = { tables: t };
    expect((await addUnitCharge(base)).error).toMatch(/Set the late fee/);
  });

  it("does not show a raw database message (25)", async () => {
    opts = { tables: tables([]), rpcError: { code: "23514", message: 'new row for relation "assessment_charges" violates check constraint "x"' } };
    const r = await addUnitCharge(base);
    expect(r.error).not.toMatch(/relation|constraint|assessment_charges/);
  });
});

describe("26. one person can report only so many problems in a day", () => {
  const input = {
    clientKey: "11111111-1111-4111-8111-111111111111",
    title: "Radiator is cold",
    where: "shared",
    priority: "normal" as const,
    emergencyConfirmed: false,
  };

  it("stops at the cap", async () => {
    opts = { tables: { associations: [{ id: "a1" }], persons: [{ id: "p1" }], tickets: [] }, count: 25 };
    const r = await createTicket(input);
    expect("error" in r).toBe(true);
    expect(inserts).toEqual([]);
  });

  it("lets a retry of an earlier submit through even at the cap", async () => {
    opts = {
      tables: { associations: [{ id: "a1" }], persons: [{ id: "p1" }], tickets: [{ id: "t0", reference: 3, emergency_kind: null }] },
      count: 25,
    };
    const r = await createTicket(input);
    expect(r).toMatchObject({ ok: true, ticketId: "t0", alreadyExisted: true });
  });

  it("creates under the cap", async () => {
    opts = { tables: { associations: [{ id: "a1" }], persons: [{ id: "p1" }] }, count: 3 };
    const r = await createTicket(input);
    expect(r).toMatchObject({ ok: true, ticketId: "t1" });
    expect(inserts.map((i) => i.table)).toEqual(["tickets"]);
  });
});

describe("17. only governing documents, minutes and financial statements can be shared with every owner", () => {
  it("allows the three", () => {
    for (const slug of ["governing", "minutes", "financial_statement"]) expect(canShareWithOwners(slug, null)).toBe(true);
  });
  it("refuses everything else, unfiled files and one unit's files", () => {
    for (const slug of ["bank_statement", "tax_form", "vendor_document", "insurance", "contract", "correspondence", "legal_notice", "unit_record", "other", "invoice"]) {
      expect(canShareWithOwners(slug, null), slug).toBe(false);
    }
    expect(canShareWithOwners(null, null)).toBe(false);
    expect(canShareWithOwners("governing", "unit-1")).toBe(false);
  });
});

describe("24. a quote request's details are bounded", () => {
  const good = {
    version: 2,
    association: { legal_name: "Oak Condo Assoc", address: "1 Main St", city: "Chicago", units: 12, year_built: 1960, construction: "masonry", stories: 3,
      roof_replaced_year: null, total_square_feet: 20000, has_sprinklers: false, has_amenities: null, rental_share: null },
    coverages: [{ coverage: "property", wanted: { building_limit: "2400000.00" } }],
    deductibles_today: null,
    current: null,
    claims: [],
    include_claim_amounts: false,
    anything_else: null,
    contact: { name: "Pat", email: "pat@example.com", phone: null },
  };

  it("accepts a normal request and drops unknown keys", () => {
    const r = parseQuoteRequestPayload({ ...good, injected: "x", association: { ...good.association, evil: 1 } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(JSON.stringify(r.value)).not.toMatch(/injected|evil/);
    }
  });

  it("refuses oversize text, counts and ranges", () => {
    const bad = [
      { ...good, association: { ...good.association, legal_name: "x".repeat(201) } },
      { ...good, association: { ...good.association, units: 1e9 } },
      { ...good, association: { ...good.association, year_built: 3000 } },
      { ...good, claims: Array.from({ length: 21 }, () => ({ date_of_loss: "2025-01-01", description: "x", status: "closed", amount_paid: null })) },
      { ...good, anything_else: "x".repeat(2001) },
      { ...good, coverages: [{ coverage: "not_a_coverage", wanted: {} }] },
      { ...good, coverages: Array.from({ length: 13 }, () => good.coverages[0]) },
      { ...good, version: 3 },
    ];
    for (const b of bad) expect(parseQuoteRequestPayload(b).ok).toBe(false);
  });
});

describe("28. only one instance wins the auto-sync", () => {
  function claimClient(winner: boolean) {
    const calls: string[] = [];
    const q: Record<string, unknown> = {};
    for (const m of ["update", "eq", "is"]) q[m] = (...a: unknown[]) => (calls.push(`${m}:${a.map(String).join(",")}`), q);
    q.select = () => Promise.resolve({ data: winner ? [{ id: "c1" }] : [], error: null });
    return { client: { from: () => q } as never, calls };
  }

  it("claims by compare-and-swap on the value it read", async () => {
    const won = claimClient(true);
    expect(await claimAutoSync(won.client, { id: "c1", last_synced_at: "2026-10-13T00:00:00Z" }, "2026-10-14T00:00:00Z")).toBe(true);
    expect(won.calls).toContain("eq:last_synced_at,2026-10-13T00:00:00Z");
    const never = claimClient(true);
    await claimAutoSync(never.client, { id: "c1", last_synced_at: null }, "2026-10-14T00:00:00Z");
    expect(never.calls).toContain("is:last_synced_at,null");
  });

  it("loses when someone else moved it first", async () => {
    expect(await claimAutoSync(claimClient(false).client, { id: "c1", last_synced_at: null }, "2026-10-14T00:00:00Z")).toBe(false);
  });

  it("puts the old value back only if nothing newer was written", async () => {
    const c = claimClient(true);
    await releaseAutoSync(c.client, { id: "c1", last_synced_at: "old" }, "claimed");
    expect(c.calls).toContain("eq:last_synced_at,claimed");
  });
});

describe("29. the association pick is deterministic", () => {
  it("orders before taking the first", async () => {
    opts = { tables: { associations: [{ id: "a1" }] } };
    const supabase = await (await import("@/lib/supabase/server")).createClient();
    expect(await currentAssociationId(supabase as never)).toBe("a1");
    expect(orders).toEqual(["created_at", "id"]);
  });
});
