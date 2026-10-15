// Regression test for docs/security/REVIEW-2-server.md finding 19: the stored object is read again once the
// documents row exists, and a swapped object retires the row.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/documents/pipeline", () => ({ runExtraction: vi.fn() }));

const ASSOC = "11111111-1111-4111-8111-111111111111";
const PATH = `${ASSOC}/1760000000000-abc123-bylaws.txt`;
const BYTES_A = new TextEncoder().encode("Bylaws of the association. Article 1: Name.");
const BYTES_B = new TextEncoder().encode("Totally different text swapped in after the check.");

let downloads: Uint8Array[] = [];
const updates: Record<string, unknown>[] = [];
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async () => ({ data: null, error: null }),
    storage: {
      from: () => ({
        download: async () => {
          const bytes = downloads.shift() ?? BYTES_A;
          return { data: new Blob([bytes as BlobPart], { type: "text/plain" }), error: null };
        },
        remove: async () => ({ error: null }),
      }),
    },
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "limit", "order", "in"]) c[m] = () => c;
      c.insert = () => ({ select: () => ({ single: async () => ({ data: { id: "doc-1" }, error: null }) }) });
      c.update = (row: Record<string, unknown>) => {
        updates.push({ table, ...row });
        return { eq: async () => ({ error: null }) };
      };
      c.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: table === "associations" ? [{ id: ASSOC }] : [], error: null }).then(r);
      return c;
    },
  }),
}));

import { registerUpload } from "@/app/documents/upload/actions";

beforeEach(() => {
  downloads = [];
  updates.length = 0;
});

describe("19. registerUpload re-reads the object after the row exists", () => {
  it("registers when the bytes are unchanged", async () => {
    downloads = [BYTES_A, BYTES_A];
    const r = await registerUpload({ path: PATH, filename: "bylaws.txt", purpose: "document", read: false });
    expect(r).toMatchObject({ ok: true, documentId: "doc-1" });
    expect(updates).toEqual([]);
  });

  it("retires the row and refuses when the object was swapped between the check and the insert", async () => {
    downloads = [BYTES_A, BYTES_B];
    const r = await registerUpload({ path: PATH, filename: "bylaws.txt", purpose: "document", read: false });
    expect("error" in r).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ table: "documents", extraction_state: "skipped" });
    expect(typeof updates[0].deleted_at).toBe("string");
  });
});
