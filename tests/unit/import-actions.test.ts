import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const state = vi.hoisted(() => ({ supabase: null as unknown, createClientCalls: 0 }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    state.createClientCalls += 1;
    return state.supabase;
  },
  getUser: async () => ({ id: "user-1" }),
}));
vi.mock("@/lib/documents/access", () => ({ currentAssociationId: async () => "11111111-1111-4111-8111-111111111111" }));
const suggestMapping = vi.hoisted(() => vi.fn());
vi.mock("@/lib/import/ai-mapping", () => ({ suggestMapping }));

import {
  commitImport, createImportCategory, fixImportRow, markImportUpload, saveImportOptions, startImport, suggestColumnMapping,
  undoImport,
} from "@/app/building/import/actions";

const DOC = "22222222-2222-4222-8222-222222222222";
const BATCH = "33333333-3333-4333-8333-333333333333";
const ROW = "44444444-4444-4444-8444-444444444444";
const DIGEST = "a".repeat(64);

type Call = { fn: string; args: unknown[] };

interface Config {
  admin?: boolean;
  doc?: Record<string, unknown> | null;
  file?: string;
  rpc?: Record<string, { data?: unknown; error?: unknown } | ((args: Record<string, unknown>) => { data?: unknown; error?: unknown })>;
  tables?: Record<string, unknown[]>;
}

function fake(cfg: Config = {}) {
  const calls: Call[] = [];
  const tables: Record<string, unknown[]> = {
    documents: cfg.doc === null ? [] : [cfg.doc ?? { id: DOC, filename: "units.csv", title: "Import: units.csv", storage_path: "a/b.csv", uploaded_at: new Date().toISOString(), deleted_at: null, uploaded_by: "user-1" }],
    accounts: [], funds: [], import_batches: [], import_rows: [], document_links: [], associations: [], persons: [], units: [],
    ...(cfg.tables ?? {}),
  };
  const builder = (table: string) => {
    let op: "select" | "delete" | "update" = "select";
    const b: Record<string, unknown> = {};
    const chain = () => b;
    for (const m of ["eq", "in", "like", "is", "not", "lt", "order", "limit", "range", "neq"]) b[m] = () => chain();
    b.select = () => chain();
    b.delete = () => ((op = "delete"), chain());
    b.update = (v: unknown) => ((op = "update"), calls.push({ fn: `update:${table}`, args: [v] }), chain());
    b.then = (resolve: (v: unknown) => void) => {
      calls.push({ fn: `${op}:${table}`, args: [] });
      resolve({ data: op === "update" ? tables[table].slice(0, 1) : op === "delete" ? tables[table].slice(0, 1) : tables[table], error: null });
    };
    return b;
  };
  const supabase = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn: `rpc:${fn}`, args: [args] });
      if (fn === "has_role_in") return { data: cfg.admin !== false, error: null };
      const r = cfg.rpc?.[fn];
      const out = typeof r === "function" ? r(args) : r;
      if (out) return { data: out.data ?? null, error: out.error ?? null };
      if (fn === "import_start") return { data: BATCH, error: null };
      if (fn === "import_validate") return { data: { counts: { rows: 2, ok: 2, errors: 0, duplicates: 0, skipped: 0 }, batch_errors: [], digest: DIGEST }, error: null };
      return { data: null, error: null };
    },
    from: (table: string) => builder(table),
    storage: {
      from: () => ({
        download: async () => ({ data: new Blob([cfg.file ?? "Unit,Owner name,SSN\nUnit 1,Ada,123-45-6789\nUnit 2,Bo,987-65-4321\n"]), error: null }),
        remove: async (paths: string[]) => (calls.push({ fn: "storage.remove", args: [paths] }), { data: [], error: null }),
      }),
    },
  };
  state.supabase = supabase;
  state.createClientCalls = 0;
  return { calls, names: () => calls.map((c) => c.fn), rpcArgs: (fn: string) => calls.filter((c) => c.fn === `rpc:${fn}`).map((c) => c.args[0] as Record<string, unknown>) };
}

const input = (over: Record<string, unknown> = {}) => ({
  kind: "units_owners" as const,
  documentId: DOC,
  mapping: { unit_label: 0, owner_name: 1 },
  dateHint: "mdy" as const,
  keepCopy: false,
  ...over,
});

beforeEach(() => {
  state.supabase = null;
  state.createClientCalls = 0;
  suggestMapping.mockReset();
});

describe("startImport", () => {
  it("refuses a non-admin before any other call", async () => {
    const f = fake({ admin: false });
    const r = await startImport(input());
    expect(r).toEqual({ error: "Only a board admin can import." });
    expect(f.names()).toEqual(["rpc:has_role_in"]);
  });

  it("rejects unknown fields and malformed input before touching the database", async () => {
    const f = fake();
    expect(await startImport({ ...input(), extra: 1 } as never)).toMatchObject({ error: expect.stringMatching(/not right/) });
    expect(await startImport(input({ documentId: "nope" }))).toMatchObject({ error: expect.any(String) });
    expect(await startImport(input({ kind: "payroll" }))).toMatchObject({ error: expect.any(String) });
    expect(await startImport(input({ mapping: { "bad key!": 1 } }))).toMatchObject({ error: expect.any(String) });
    expect(await startImport(input({ mapping: { unit_label: 99 } }))).toMatchObject({ error: expect.any(String) });
    expect(await startImport(input({ dateHint: "ydm" }))).toMatchObject({ error: expect.any(String) });
    expect(f.calls).toEqual([]);
    expect(state.createClientCalls).toBe(0);
  });

  it("refuses a field that does not belong to the kind, a reused column, and a sensitive column", async () => {
    const f = fake();
    expect(await startImport(input({ mapping: { unit_label: 0, nonsense: 1 } }))).toMatchObject({ error: expect.stringMatching(/not right/) });
    expect(await startImport(input({ mapping: { unit_label: 0, owner_name: 0 } }))).toMatchObject({ error: expect.stringMatching(/Match the columns again/) });
    // Column 2 is "SSN" in the fixture file: a forged mapping cannot reach it.
    expect(await startImport(input({ mapping: { unit_label: 0, owner_name: 2 } }))).toMatchObject({ error: expect.stringMatching(/Match the columns again/) });
    expect(f.names()).not.toContain("rpc:import_start");
  });

  it("asks for the required matches in the spec's words", async () => {
    fake();
    expect(await startImport(input({ mapping: { owner_name: 1 } }))).toEqual({ error: "Match Unit to continue." });
  });

  it("stages in order, sets the starting options, removes the upload, then validates", async () => {
    const f = fake();
    const r = await startImport(input());
    expect(r).toMatchObject({ ok: true, batchId: BATCH });
    expect(f.names().filter((n) => n.startsWith("rpc:"))).toEqual([
      "rpc:has_role_in", "rpc:import_start", "rpc:import_stage_rows", "rpc:import_set_options", "rpc:import_validate",
    ]);
    const start = f.rpcArgs("import_start")[0];
    expect(start).toMatchObject({ p_kind: "units_owners", p_filename: "units.csv", p_source_document_id: null, p_row_count: 2 });
    expect(start.p_file_sha256).toMatch(/^[0-9a-f]{64}$/);
    // Only the mapped columns went to the database: no SSN anywhere.
    const staged = JSON.stringify(f.rpcArgs("import_stage_rows"));
    expect(staged).toContain("Ada");
    expect(staged).not.toContain("123-45-6789");
    expect(staged).not.toContain("987-65-4321");
    expect(f.names()).toContain("delete:documents");
    expect(f.names()).toContain("storage.remove");
    // The document is removed before the validation runs.
    expect(f.names().indexOf("delete:documents")).toBeLessThan(f.names().indexOf("rpc:import_validate"));
  });

  it("keeps the copy only when asked, and links the batch to it", async () => {
    const f = fake();
    const r = await startImport(input({ keepCopy: true }));
    expect(r).toMatchObject({ ok: true });
    expect(f.rpcArgs("import_start")[0].p_source_document_id).toBe(DOC);
    expect(f.names()).not.toContain("delete:documents");
  });

  it("never removes a document it did not title itself", async () => {
    const f = fake({ doc: { id: DOC, filename: "units.csv", title: "Units 2026 (board copy)", storage_path: "a/b.csv", uploaded_at: new Date().toISOString(), deleted_at: null } });
    const r = await startImport(input());
    expect(r).toMatchObject({ ok: true });
    expect(f.names()).not.toContain("delete:documents");
    expect(f.names()).not.toContain("storage.remove");
  });

  it("cancels the batch and removes the file when something fails after import_start", async () => {
    const f = fake({ rpc: { import_stage_rows: { error: { code: "XX000", message: "boom" } } } });
    const r = await startImport(input());
    expect(r).toMatchObject({ error: expect.any(String) });
    expect(f.names()).toContain("rpc:import_cancel");
    expect(f.rpcArgs("import_cancel")[0]).toEqual({ p_batch_id: BATCH });
    expect(f.names()).toContain("delete:documents");
    expect(f.names()).not.toContain("rpc:import_validate");
  });

  it("cancels when validation itself fails", async () => {
    const f = fake({ rpc: { import_validate: { error: { code: "XX000", message: "boom" } } } });
    expect(await startImport(input())).toMatchObject({ error: expect.any(String) });
    expect(f.names()).toContain("rpc:import_cancel");
    expect(f.names()).toContain("delete:documents");
  });

  it("reports a file that was already imported, with the earlier batch", async () => {
    const earlier = "55555555-5555-4555-8555-555555555555";
    const f = fake({
      rpc: { import_start: { error: { code: "23505", message: "this file was already imported", hint: `already_imported:${earlier}` } } },
      tables: { import_batches: [{ committed_at: "2026-10-01T12:00:00Z" }] },
    });
    const r = await startImport(input());
    expect(r).toEqual({ error: "You imported this file before.", alreadyImported: { batchId: earlier, on: "2026-10-01T12:00:00Z" } });
    expect(f.names()).not.toContain("rpc:import_stage_rows");
  });

  it("says plainly when the file cannot be found", async () => {
    fake({ doc: null });
    expect(await startImport(input())).toEqual({ error: "We couldn't find that upload. Upload the file again." });
  });

  it("starts a transactions import with the one cash account, the one fund and exact-name categories already chosen", async () => {
    const f = fake({
      file: "Date,Description,Amount,Category\n3/14/2026,Boiler,-450.00,Repairs\n3/15/2026,Dues,350.00,Mystery\n",
      tables: {
        accounts: [
          { id: "acc-cash", code: "1000", name: "Operating Cash", type: "asset", is_cash_account: true, is_active: true },
          { id: "acc-rep", code: "5020", name: "Repairs", type: "expense", is_cash_account: false, is_active: true },
        ],
        funds: [{ id: "fund-1", name: "Operating", kind: "operating" }],
      },
    });
    const r = await startImport(input({ kind: "transactions", mapping: { date: 0, description: 1, amount: 2, category_key: 3 } }));
    expect(r).toMatchObject({ ok: true });
    const opts = f.rpcArgs("import_set_options")[0].p_options as Record<string, unknown>;
    expect(opts).toEqual({ cash_account_id: "acc-cash", default_fund_id: "fund-1", account_map: { repairs: "acc-rep" } });
    expect(opts).not.toHaveProperty("mapping_confirmed");
  });
});

describe("saveImportOptions", () => {
  const batchRow = { id: BATCH, kind: "transactions", status: "validated", options: { account_map: { repairs: "acc-1" } }, mapping: {}, source_document_id: null, file_sha256: "x" };

  it("merges a map entry into the stored options and re-validates", async () => {
    const f = fake({ tables: { import_batches: [batchRow] } });
    const r = await saveImportOptions(BATCH, { account_map: { "regular assessments": "11111111-1111-4111-8111-111111111111" }, mapping_confirmed: false });
    expect(r).toMatchObject({ ok: true });
    const saved = f.rpcArgs("import_set_options")[0];
    expect(saved.p_mapping).toBeNull();
    expect(saved.p_options).toEqual({
      account_map: { repairs: "acc-1", "regular assessments": "11111111-1111-4111-8111-111111111111" },
      mapping_confirmed: false,
    });
    expect(f.names()).toContain("rpc:import_validate");
  });

  it("rejects keys the kind does not have and values of the wrong shape, before any write", async () => {
    const f = fake({ tables: { import_batches: [batchRow] } });
    expect(await saveImportOptions(BATCH, { as_of: "2026-01-01" })).toMatchObject({ error: expect.stringMatching(/not valid/) });
    expect(await saveImportOptions(BATCH, { cash_account_id: "not-a-uuid" })).toMatchObject({ error: expect.any(String) });
    expect(await saveImportOptions(BATCH, { mapping_confirmed: "yes" })).toMatchObject({ error: expect.any(String) });
    expect(await saveImportOptions("nope", {})).toMatchObject({ error: expect.any(String) });
    expect(f.names()).not.toContain("rpc:import_set_options");
  });

  it("refuses a non-admin", async () => {
    const f = fake({ admin: false, tables: { import_batches: [batchRow] } });
    expect(await saveImportOptions(BATCH, {})).toEqual({ error: "Only a board admin can import." });
    expect(f.names()).toEqual(["rpc:has_role_in"]);
  });
});

describe("fixImportRow", () => {
  it("normalises what was typed and drops keys the kind does not have", async () => {
    const f = fake({
      tables: {
        import_rows: [{ id: ROW, batch_id: BATCH }],
        import_batches: [{ id: BATCH, kind: "transactions", status: "validated", options: {}, mapping: { _date_hint: "mdy" }, source_document_id: null, file_sha256: "x" }],
      },
    });
    const r = await fixImportRow(ROW, { amount: "$1,234.5", date: "3/14/2026", payee: "  Acme ", is_admin: "true", money_in: "5" });
    expect(r).toMatchObject({ ok: true });
    expect(f.rpcArgs("import_update_row")[0]).toEqual({ p_row_id: ROW, p_mapped: { amount: "1234.50", date: "2026-03-14", payee: "Acme" } });
    expect(f.names()).toContain("rpc:import_validate");
  });

  it("keeps unreadable text as typed so the database can say what is wrong", async () => {
    const f = fake({
      tables: {
        import_rows: [{ id: ROW, batch_id: BATCH }],
        import_batches: [{ id: BATCH, kind: "transactions", status: "validated", options: {}, mapping: {}, source_document_id: null, file_sha256: "x" }],
      },
    });
    await fixImportRow(ROW, { amount: "12.345", date: "banana" });
    expect(f.rpcArgs("import_update_row")[0].p_mapped).toEqual({ amount: "12.345", date: "banana" });
  });
});

describe("createImportCategory", () => {
  it("refuses without an exempt answer before any call", async () => {
    const f = fake();
    for (const isExempt of [null, undefined]) {
      const r = await createImportCategory({ name: "Pool", type: "expense", isExempt: isExempt as never });
      expect(r).toEqual({ error: "Say whether this counts toward your tax-exempt activity." });
    }
    expect(f.calls).toEqual([]);
    expect(state.createClientCalls).toBe(0);
  });

  it("passes the answer exactly as given", async () => {
    const f = fake({ rpc: { import_create_account: { data: "acct-1" } } });
    expect(await createImportCategory({ name: " Pool ", type: "expense", isExempt: false })).toEqual({ ok: true, accountId: "acct-1" });
    expect(f.rpcArgs("import_create_account")[0]).toMatchObject({ p_name: "Pool", p_type: "expense", p_is_exempt: false });
  });

  it("rejects a type that is not income or expense", async () => {
    const f = fake();
    expect(await createImportCategory({ name: "Bank", type: "asset" as never, isExempt: true })).toMatchObject({ error: expect.any(String) });
    expect(f.names()).not.toContain("rpc:import_create_account");
  });
});

describe("commitImport and undoImport", () => {
  it("re-validates and reports a stale preview", async () => {
    const f = fake({ rpc: { import_commit: { error: { code: "22023", message: "x", hint: "preview_stale" } } } });
    const r = await commitImport(BATCH, DIGEST);
    expect(r).toMatchObject({ hint: "preview_stale" });
    expect(f.names()).toContain("rpc:import_validate");
  });

  it("maps a closed fiscal year and an unexpected failure to plain words", async () => {
    fake({ rpc: { import_commit: { error: { code: "23514", message: "fiscal year closed" } } } });
    expect(await commitImport(BATCH, DIGEST)).toEqual({ error: "That fiscal year is closed. Skip those rows or choose another date." });
    fake({ rpc: { import_commit: { error: { code: "XX000", message: "relation foo does not exist" } } } });
    expect(await commitImport(BATCH, DIGEST)).toEqual({ error: "Something went wrong. Nothing was imported." });
  });

  it("refuses a bad digest and a non-admin without calling commit", async () => {
    const f = fake();
    expect(await commitImport(BATCH, "short")).toMatchObject({ error: expect.any(String) });
    fake({ admin: false });
    expect(await commitImport(BATCH, DIGEST)).toEqual({ error: "Only a board admin can import." });
    expect(f.names()).not.toContain("rpc:import_commit");
  });

  it("undo shows the database's reason when something depends on the import", async () => {
    fake({ rpc: { import_undo: { error: { code: "22023", message: "one of these is used elsewhere (a repair, for example); remove that link first", hint: "in_use" } } } });
    expect(await undoImport(BATCH)).toEqual({ error: "One of these is used elsewhere (a repair, for example); remove that link first." });
  });
});

describe("markImportUpload", () => {
  it("titles a fresh, untouched, unlinked upload", async () => {
    const f = fake({ doc: { id: DOC, filename: "units.csv", title: "units.csv", uploaded_at: new Date().toISOString() } });
    expect(await markImportUpload(DOC)).toEqual({ ok: true, marked: true });
    expect(f.calls.find((c) => c.fn === "update:documents")?.args[0]).toEqual({ title: "Import: units.csv" });
  });

  it("leaves an old document, a renamed one or a linked one exactly as it is", async () => {
    const old = fake({ doc: { id: DOC, filename: "units.csv", title: "units.csv", uploaded_at: "2020-01-01T00:00:00Z" } });
    expect(await markImportUpload(DOC)).toEqual({ ok: true, marked: false });
    expect(old.names()).not.toContain("update:documents");
    const renamed = fake({ doc: { id: DOC, filename: "units.csv", title: "Board roster", uploaded_at: new Date().toISOString() } });
    expect(await markImportUpload(DOC)).toEqual({ ok: true, marked: false });
    expect(renamed.names()).not.toContain("update:documents");
    const linked = fake({ doc: { id: DOC, filename: "units.csv", title: "units.csv", uploaded_at: new Date().toISOString() }, tables: { document_links: [{ id: "l" }] } });
    expect(await markImportUpload(DOC)).toEqual({ ok: true, marked: false });
    expect(linked.names()).not.toContain("update:documents");
  });
});

describe("suggestColumnMapping", () => {
  it("refuses a non-admin before the model is called", async () => {
    fake({ admin: false });
    const r = await suggestColumnMapping({ kind: "units_owners", documentId: DOC });
    expect(r).toMatchObject({ ok: false, error: "Only a board admin can import." });
    expect(suggestMapping).not.toHaveBeenCalled();
  });

  it("passes the foundation's failure through for the status note", async () => {
    fake();
    suggestMapping.mockResolvedValue({ ok: false, code: "quota", reason: "Today's limit for document filing is used up.", configured: true, quota: true, counted: false });
    const r = await suggestColumnMapping({ kind: "units_owners", documentId: DOC });
    expect(r).toMatchObject({ ok: false, code: "quota", quota: true, configured: true, counted: false });
  });

  it("sends the file's columns (not its values) and returns only what the person has not already got", async () => {
    fake();
    suggestMapping.mockResolvedValue({
      ok: true,
      suggestion: [{ field: "unit_label", header: "Unit", index: 0, confidence: "high" }, { field: "phone", header: "Owner name", index: 1, confidence: "low" }],
      sent: { headers: ["Unit"], masks: [] },
    });
    const r = await suggestColumnMapping({ kind: "units_owners", documentId: DOC });
    expect(r).toMatchObject({ ok: true, suggestion: [{ field: "phone" }] });
    expect(suggestMapping.mock.calls[0][0].headers).toEqual(["Unit", "Owner name", "SSN"]);
  });
});
