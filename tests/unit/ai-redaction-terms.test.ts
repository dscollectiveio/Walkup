import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadRedactionTerms } from "@/lib/ai/redaction";

function fake(opts: { peopleError?: boolean; assocMissing?: boolean }) {
  const chain = (table: string) => {
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.eq = () => c;
    c.maybeSingle = () =>
      Promise.resolve(
        opts.assocMissing ? { data: null, error: null } : { data: { legal_name: "Oak", display_name: "Oak", street_address: "1 Main St", city: "Chicago", state_code: "IL" }, error: null },
      );
    c.then = (r: (v: unknown) => unknown) =>
      Promise.resolve(opts.peopleError ? { data: null, error: { code: "XX000" } } : { data: [{ full_name: "Jane Doe" }], error: null }).then(r);
    void table;
    return c;
  };
  return { from: chain } as never;
}

describe("loadRedactionTerms does not fail open (REVIEW-2 #11)", () => {
  it("reports unavailable when the people lookup fails", async () => {
    expect((await loadRedactionTerms(fake({ peopleError: true }), "a1")).unavailable).toBe(true);
  });
  it("reports unavailable when the association cannot be read", async () => {
    expect((await loadRedactionTerms(fake({ assocMissing: true }), "a1")).unavailable).toBe(true);
  });
  it("is available, with names and the address, when both reads work", async () => {
    const r = await loadRedactionTerms(fake({}), "a1");
    expect(r.unavailable).toBeUndefined();
    expect(r.names).toContain("Jane Doe");
    expect(r.addresses).toContain("1 Main St");
  });
});
