import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const calls: string[] = [];
vi.mock("@/lib/documents/classify", () => ({
  CONFIDENCE_THRESHOLD: 0.85,
  classifyDocument: async () => {
    calls.push("classifyDocument");
    return { ok: false, configured: true, reason: "stub" };
  },
}));
vi.mock("@/lib/documents/extract-text", () => ({
  extractDocumentText: async () => ({ ok: true, text: "Bylaws of the association. Article 1." }),
}));

import { runExtraction } from "@/lib/documents/pipeline";

/** The client as a member sees it: row and object readable, writes filtered by RLS. */
function client(isBoard: boolean) {
  const row = {
    id: "d1", association_id: "a1", storage_path: "a1/x.txt", filename: "bylaws.txt",
    mime_type: "text/plain", category_id: null, tag_source: null, extraction_attempts: 0,
  };
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order"]) b[m] = () => b;
    b.limit = () => Promise.resolve({ data: table === "documents" ? [row] : [], error: null });
    b.update = () => {
      calls.push(`UPDATE ${table}`);
      return { eq: () => Promise.resolve({ data: [], error: null }) };
    };
    b.then = (r: (v: unknown) => unknown) =>
      Promise.resolve({ data: table === "document_categories" ? [{ slug: "governing", label: "Governing" }] : [], error: null }).then(r);
    return b;
  };
  return {
    from: (t: string) => builder(t),
    rpc: async (name: string) => (name === "is_board" ? { data: isBoard, error: null } : { data: null, error: null }),
    storage: { from: () => ({ download: async () => ({ data: new Blob(["x"]), error: null }) }) },
  } as never;
}

beforeEach(() => {
  calls.length = 0;
});

describe("runExtraction is board-only (REVIEW-2 #1)", () => {
  it("an owner never reaches the model and writes nothing", async () => {
    const r = await runExtraction(client(false), "d1");
    expect(r.state).toBe("failed");
    expect(calls).toEqual([]);
  });

  it("a board member still gets the read", async () => {
    await runExtraction(client(true), "d1");
    expect(calls).toContain("classifyDocument");
  });
});
