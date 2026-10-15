import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The model is never called: runStructured is replaced, and the PDF helpers too.
const runStructured = vi.fn();
vi.mock("@/lib/ai/structured", () => ({ runStructured: (...args: unknown[]) => runStructured(...args) }));
const extractPdfPages = vi.fn();
vi.mock("@/lib/documents/extract-text", () => ({ extractPdfPages: (...args: unknown[]) => extractPdfPages(...args) }));
vi.mock("unpdf", () => ({ getDocumentProxy: async () => ({ numPages: 3 }) }));

import { aiFailure } from "@/lib/ai/errors";
import { READ_COPY, readStateFor, runInsuranceRead } from "@/lib/insurance/read";
import { OutlineSchema, PolicyDetailSchema, READ_SYSTEM, type Outline, type PolicyDetail } from "@/lib/insurance/read-schema";

const READ_ID = "11111111-1111-4111-8111-111111111111";
const STARTED = "2026-10-14T15:00:00.123456+00:00";
const page = (n: number) => `Declarations page ${n}. Building limit $2,400,000. Deductible $5,000. Policy CPP 1234567.`;

interface Write { table: string; patch: Record<string, unknown>; filters: [string, string, unknown][] }

function fakeSupabase(opts: {
  claimed?: Record<string, unknown> | null;
  doc?: Record<string, unknown> | null;
  bytes?: Uint8Array;
}) {
  const writes: Write[] = [];
  const rpcs: string[] = [];
  const claimed = opts.claimed === undefined
    ? { id: READ_ID, association_id: "assoc-1", document_id: "doc-1", mode: "policy", attempts: 2, started_at: STARTED }
    : opts.claimed;
  const from = (table: string) => {
    let patch: Record<string, unknown> | null = null;
    const filters: [string, string, unknown][] = [];
    const b = {
      select: () => b,
      update: (p: Record<string, unknown>) => {
        patch = p;
        return b;
      },
      eq: (col: string, v: unknown) => {
        filters.push(["eq", col, v]);
        return b;
      },
      maybeSingle: async () => ({ data: table === "documents" ? opts.doc ?? null : null, error: null }),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        if (patch) writes.push({ table, patch, filters });
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      },
    };
    return b;
  };
  const supabase = {
    from,
    rpc: async (name: string) => {
      rpcs.push(name);
      return name === "claim_insurance_read" ? { data: claimed ? [claimed] : [], error: null } : { data: null, error: null };
    },
    storage: {
      from: () => ({
        download: async () => ({ data: new Blob([(opts.bytes ?? new Uint8Array([37, 80, 68, 70])) as BlobPart]), error: null }),
      }),
    },
  };
  return { supabase: supabase as never, writes, rpcs };
}

const insuranceDoc = (mime = "application/pdf", slug = "insurance") => ({
  storage_path: "assoc-1/insurance/dec.pdf", mime_type: mime, byte_size: 50_000, filename: "dec.pdf",
  document_categories: { slug },
});

function outline(n: number): Outline {
  return {
    documentKind: n > 1 ? "renewal_package" : "declarations",
    policies: Array.from({ length: n }, (_, i) => ({
      isQuote: false,
      coverage: (["property", "general_liability", "directors_officers"] as const)[i % 3],
      sections: [],
      carrierName: "West Bend Mutual",
      policyNumber: `CPP-00${i}`,
      label: "Condominium package policy",
      pages: [i + 1],
    })),
    notes: "",
  };
}

const detail = (key: string, value: string): PolicyDetail => ({
  fields: [
    { name: "carrier_name", candidates: [{ value: "West Bend Mutual", page: 1, snippet: "Company: West Bend Mutual" }], confidence: 0.95 },
    { name: key, candidates: [{ value, page: 1, snippet: `${key} ${value}` }], confidence: 0.95 },
  ],
  endorsements: [],
  exclusions: [],
  premiumLines: [],
  notes: "",
});

const ok = <T,>(data: T) => ({ ok: true, data, meta: { model: "claude-opus-5-5", fellBack: false, durationMs: 1 } });

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  runStructured.mockReset();
  extractPdfPages.mockReset();
  extractPdfPages.mockResolvedValue([page(1), page(2), page(3)]);
});
afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

const lastWrite = (writes: Write[]) => writes[writes.length - 1];

describe("runInsuranceRead", () => {
  it("skips when nothing could be claimed (another tab, or the cap)", async () => {
    const { supabase, writes } = fakeSupabase({ claimed: null, doc: insuranceDoc() });
    expect(await runInsuranceRead(supabase, READ_ID)).toEqual({ state: "skipped" });
    expect(writes).toHaveLength(0);
    expect(runStructured).not.toHaveBeenCalled();
  });

  it("a document filed as a tax form is unreadable, and the model is never called", async () => {
    const { supabase, writes } = fakeSupabase({ doc: insuranceDoc("application/pdf", "tax_form") });
    const r = await runInsuranceRead(supabase, READ_ID);
    expect(r.state).toBe("unreadable");
    expect(lastWrite(writes).patch).toMatchObject({ state: "unreadable", error: READ_COPY.notInsurance });
    expect(runStructured).not.toHaveBeenCalled();
  });

  it("not configured: not_configured, and the attempt is given back", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { supabase, writes } = fakeSupabase({ doc: insuranceDoc() });
    const r = await runInsuranceRead(supabase, READ_ID);
    expect(r.state).toBe("not_configured");
    expect(lastWrite(writes).patch).toMatchObject({ state: "not_configured", attempts: 1 });
    expect(runStructured).not.toHaveBeenCalled();
  });

  it("quota on pass 1: state quota, attempts written back as the claimed value minus 1", async () => {
    runStructured.mockResolvedValueOnce(aiFailure("quota", "insurance_read", { scope: "building", limit: 20 }));
    const { supabase, writes } = fakeSupabase({ doc: insuranceDoc() });
    const r = await runInsuranceRead(supabase, READ_ID);
    expect(r.state).toBe("quota");
    expect(lastWrite(writes).patch).toMatchObject({ state: "quota", attempts: 1 });
    expect(runStructured).toHaveBeenCalledTimes(1);
  });

  it("timeout on pass 1: timed_out, and the attempt counts", async () => {
    runStructured.mockResolvedValueOnce(aiFailure("timeout", "insurance_read"));
    const { supabase, writes } = fakeSupabase({ doc: insuranceDoc() });
    expect((await runInsuranceRead(supabase, READ_ID)).state).toBe("timed_out");
    const w = lastWrite(writes).patch;
    expect(w.state).toBe("timed_out");
    expect(w).not.toHaveProperty("attempts");
  });

  it("one of three pass-2 items failing: done, with that item's detailError", async () => {
    runStructured
      .mockResolvedValueOnce(ok(outline(3)))
      .mockResolvedValueOnce(ok(detail("building_limit", "$2,400,000")))
      .mockResolvedValueOnce(aiFailure("too_long", "insurance_read"))
      .mockResolvedValueOnce(ok(detail("do_limit", "$1,000,000")));
    const { supabase, writes } = fakeSupabase({ doc: insuranceDoc() });
    expect((await runInsuranceRead(supabase, READ_ID)).state).toBe("done");
    const w = lastWrite(writes).patch as { state: string; method: string; page_count: number; result: { policies: { detailError: string | null; coverage: string }[] } };
    expect(w.state).toBe("done");
    expect(w.method).toBe("text");
    expect(w.page_count).toBe(3);
    expect(w.result.policies.map((p) => p.detailError)).toEqual([null, "too_long", null]);
    expect(w.result.policies[1].coverage).toBe("general_liability");
  });

  it("every pass-2 item failing takes the read's state from the first failure", async () => {
    runStructured
      .mockResolvedValueOnce(ok(outline(2)))
      .mockResolvedValueOnce(aiFailure("busy", "insurance_read"))
      .mockResolvedValueOnce(aiFailure("timeout", "insurance_read"));
    const { supabase, writes } = fakeSupabase({ doc: insuranceDoc() });
    expect((await runInsuranceRead(supabase, READ_ID)).state).toBe("failed");
    expect(lastWrite(writes).patch.state).toBe("failed");
  });

  it("calls the model with the read prompt, the schemas, the budgets and the text pages only", async () => {
    runStructured
      .mockResolvedValueOnce(ok(outline(1)))
      .mockResolvedValueOnce(ok(detail("building_limit", "$2,400,000")));
    const { supabase } = fakeSupabase({ doc: insuranceDoc() });
    await runInsuranceRead(supabase, READ_ID);
    const [pass1, pass2] = runStructured.mock.calls.map((c) => c[0]);
    expect(pass1).toMatchObject({ kind: "insurance_read", system: READ_SYSTEM, schema: OutlineSchema, effort: "low", maxTokens: 8000, associationId: "assoc-1" });
    expect(pass1.timeoutMs).toBeLessThanOrEqual(90_000);
    expect(pass2).toMatchObject({ kind: "insurance_read", schema: PolicyDetailSchema, effort: "medium", maxTokens: 16000 });
    const pass2Text = pass2.content.map((b: { text?: string }) => b.text ?? "").join("\n");
    expect(pass2Text).toContain("=== Page 1 ===");
    expect(pass2Text).not.toContain("=== Page 2 ===");
  });

  it("a scanned PDF goes to the model natively, with the page note", async () => {
    extractPdfPages.mockResolvedValue(null);
    runStructured
      .mockResolvedValueOnce(ok(outline(1)))
      .mockResolvedValueOnce(ok(detail("building_limit", "$2,400,000")));
    const { supabase, writes } = fakeSupabase({ doc: insuranceDoc() });
    expect((await runInsuranceRead(supabase, READ_ID)).state).toBe("done");
    const pass2 = runStructured.mock.calls[1][0];
    expect(pass2.content[0]).toMatchObject({ type: "document", source: { type: "base64", media_type: "application/pdf" } });
    expect(pass2.content[1].text).toContain("Read only pages 1 of this PDF");
    expect(lastWrite(writes).patch).toMatchObject({ method: "native_pdf", page_count: 3 });
  });

  it("a quote read marks every candidate forceReview", async () => {
    runStructured
      .mockResolvedValueOnce(ok(outline(1)))
      .mockResolvedValueOnce(ok(detail("building_limit", "$2,400,000")));
    const { supabase, writes } = fakeSupabase({
      doc: insuranceDoc(),
      claimed: { id: READ_ID, association_id: "assoc-1", document_id: "doc-1", mode: "quote", attempts: 1, started_at: STARTED },
    });
    await runInsuranceRead(supabase, READ_ID);
    const result = lastWrite(writes).patch.result as { policies: { fields: { candidates: { forceReview?: boolean }[] }[] }[] };
    const all = result.policies.flatMap((p) => p.fields.flatMap((f) => f.candidates));
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((c) => c.forceReview === true)).toBe(true);
  });

  it("not_insurance ends done with no policies and no pass 2", async () => {
    runStructured.mockResolvedValueOnce(ok({ documentKind: "not_insurance", policies: [], notes: "" }));
    const { supabase, writes } = fakeSupabase({ doc: insuranceDoc() });
    expect((await runInsuranceRead(supabase, READ_ID)).state).toBe("done");
    expect(runStructured).toHaveBeenCalledTimes(1);
    expect((lastWrite(writes).patch.result as { policies: unknown[] }).policies).toEqual([]);
  });

  it("every write is guarded by the read id, running state and the claimed started_at", async () => {
    runStructured
      .mockResolvedValueOnce(ok(outline(1)))
      .mockResolvedValueOnce(ok(detail("building_limit", "$2,400,000")));
    const { supabase, writes } = fakeSupabase({ doc: insuranceDoc() });
    await runInsuranceRead(supabase, READ_ID);
    const quota = fakeSupabase({ doc: insuranceDoc("application/pdf", "tax_form") });
    await runInsuranceRead(quota.supabase, READ_ID);
    const all = [...writes, ...quota.writes].filter((w) => w.table === "insurance_document_reads");
    expect(all.length).toBeGreaterThan(0);
    for (const w of all) {
      expect(w.filters).toEqual(expect.arrayContaining([
        ["eq", "id", READ_ID], ["eq", "state", "running"], ["eq", "started_at", STARTED],
      ]));
    }
  });
});

describe("readStateFor (§7.1.7 step 7)", () => {
  it("maps each failure to a state, its copy and whether the attempt is given back", () => {
    expect(readStateFor("quota", "text")).toEqual({ state: "quota", error: READ_COPY.quota, giveBack: true });
    expect(readStateFor("quota_unknown", "text").state).toBe("quota");
    expect(readStateFor("not_configured", "image")).toMatchObject({ state: "not_configured", giveBack: true });
    expect(readStateFor("timeout", "text")).toMatchObject({ state: "timed_out", giveBack: false });
    expect(readStateFor("too_long", "native_pdf")).toMatchObject({ state: "unreadable", error: READ_COPY.tooLarge });
    expect(readStateFor("bad_request", "image")).toMatchObject({ state: "unreadable" });
    expect(readStateFor("busy", "text")).toEqual({ state: "failed", error: READ_COPY.busy, giveBack: false });
    expect(readStateFor("refused", "text")).toEqual({ state: "failed", error: READ_COPY.failed, giveBack: false });
  });
});
