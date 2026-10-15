// Regression tests for docs/security/REVIEW-2-server.md findings 6 and 14 on stored contractor email data.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

const writes: { table: string; op: string; row: Record<string, unknown> }[] = [];
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "limit", "order"]) c[m] = () => c;
      c.insert = (row: Record<string, unknown>) => {
        writes.push({ table, op: "insert", row });
        return { select: () => Promise.resolve({ data: [{ id: "v1" }], error: null }) };
      };
      c.update = (row: Record<string, unknown>) => {
        writes.push({ table, op: "update", row });
        const u: Record<string, unknown> = {};
        for (const m of ["eq", "in"]) u[m] = () => u;
        u.select = () => Promise.resolve({ data: [{ id: "m1", vendor_id: "v1", ticket_id: null }], error: null });
        return u;
      };
      c.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: table === "associations" ? [{ id: "a1" }] : [], error: null }).then(r);
      return c;
    },
    rpc: async () => ({ data: true, error: null }),
  }),
}));

import { addVendor } from "@/app/contractors/vendor-actions";
import { updateDraft } from "@/app/contractors/actions";

const UUID = "11111111-1111-4111-8111-111111111111";
function form(over: Record<string, string>) {
  const f = new FormData();
  f.set("name", "Acme Plumbing");
  f.append("trades", "plumbing");
  f.set("phone", "(312) 555-0142");
  f.set("status", "okay");
  for (const [k, v] of Object.entries(over)) f.set(k, v);
  return f;
}

beforeEach(() => {
  writes.length = 0;
});

describe("6. a saved contractor's email is one plain mailbox", () => {
  it("refuses an email that carries mailto parameters or a second address", async () => {
    for (const email of ["info@acme.com?bcc=attacker@evil.example", "a@b.com,c@d.com", "not an email"]) {
      const r = await addVendor(null, form({ email }));
      expect(r, email).toMatchObject({ error: expect.stringMatching(/email/i) });
    }
    expect(writes).toEqual([]);
  });

  it("keeps an ordinary one", async () => {
    expect(await addVendor(null, form({ email: "info@acme.com" }))).toMatchObject({ ok: true });
    expect(writes[0].row.email).toBe("info@acme.com");
  });
});

describe("14. a stored draft has a one-line subject and one recipient", () => {
  it("collapses line breaks in the subject and drops a recipient list", async () => {
    const r = await updateDraft(UUID, { subject: "Quote\r\nBcc: x@y.example", body: "Hello", to: ["a@b.com,evil@x.example"] });
    expect(r).toEqual({ ok: true });
    const row = writes.find((w) => w.table === "contractor_messages")!.row;
    expect(row.subject).toBe("Quote Bcc: x@y.example");
    expect(row.to_email).toBeNull();
  });

  it("keeps a plain recipient", async () => {
    await updateDraft(UUID, { subject: "Quote", body: "Hello", to: ["pat@acme.com"] });
    expect(writes.find((w) => w.table === "contractor_messages")!.row.to_email).toBe("pat@acme.com");
  });
});
