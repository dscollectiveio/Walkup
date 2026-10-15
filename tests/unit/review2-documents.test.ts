// Regression tests for docs/security/REVIEW-2-server.md findings 1, 19 and 25 on the document actions.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

const { runExtraction } = vi.hoisted(() => ({ runExtraction: vi.fn(async () => ({ state: "done", detail: "ok" })) }));
vi.mock("@/lib/documents/pipeline", () => ({ runExtraction }));

let isBoard = true;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "limit"]) c[m] = () => c;
      c.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: "d1", association_id: "a1" }], error: null }).then(r);
      return c;
    },
    rpc: async (name: string) => (name === "is_board" ? { data: isBoard, error: null } : { data: null, error: null }),
  }),
}));

import { rerunExtraction } from "@/app/documents/actions";
import { documentError } from "@/lib/documents/errors";

beforeEach(() => {
  runExtraction.mockClear();
  isBoard = true;
});

describe("1. rerunExtraction is board only", () => {
  it("an owner who can see the document gets a refusal and no paid read", async () => {
    isBoard = false;
    const r = await rerunExtraction("d1");
    expect(r.error).toMatch(/board member/i);
    expect(runExtraction).not.toHaveBeenCalled();
  });

  it("a board member still reads it again", async () => {
    expect(await rerunExtraction("d1")).toMatchObject({ ok: true });
    expect(runExtraction).toHaveBeenCalledTimes(1);
  });

  it("the deprecated multi-file actions that skipped the role check are gone", async () => {
    const actions = await import("@/app/documents/actions");
    const links = await import("@/app/documents/link-actions");
    expect("uploadDocuments" in actions).toBe(false);
    expect("uploadAndLinkDocument" in links).toBe(false);
  });
});

describe("25. database text does not reach the page", () => {
  it("maps codes to sentences and logs only the code", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(documentError({ code: "42501", message: "new row violates row-level security policy" })).toBe("Only a board member can do that.");
    const generic = documentError({ code: "23514", message: 'violates check constraint "documents_visibility_check" on table documents' });
    expect(generic).not.toMatch(/constraint|documents_/);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/constraint|documents_/);
    expect(documentError({ code: "22023", message: "Pick a category first." })).toBe("Pick a category first.");
    log.mockRestore();
  });
});
