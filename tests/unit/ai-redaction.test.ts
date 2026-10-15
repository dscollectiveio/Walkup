import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadRedactionTerms, nameTerms } from "@/lib/ai/redaction";

describe("nameTerms", () => {
  it("adds each full name and its tokens of 3+ letters, minus particles", () => {
    expect(nameTerms(["Ada Okonkwo", "Jan van der Berg", "Bo Li", ""])).toEqual([
      "Ada Okonkwo", "Ada", "Okonkwo", "Jan van der Berg", "Jan", "Berg", "Bo Li",
    ]);
  });
});

describe("loadRedactionTerms", () => {
  it("reads people and the association under the caller's session", async () => {
    const tables: string[] = [];
    const supabase = {
      from(table: string) {
        tables.push(table);
        const result =
          table === "persons"
            ? { data: [{ full_name: "Ada Okonkwo" }, { full_name: null }], error: null }
            : {
                data: {
                  legal_name: "2158 N. Damen Condominium Association", display_name: "2158 N. Damen",
                  street_address: "2158 N. Damen Ave", city: "Chicago", state_code: "IL",
                },
                error: null,
              };
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => Promise.resolve(result),
          then: (resolve: (v: unknown) => void) => resolve(result),
        };
        return chain;
      },
    } as never;
    const terms = await loadRedactionTerms(supabase, "assoc");
    expect(tables.sort()).toEqual(["associations", "persons"]);
    expect(terms).toEqual({
      names: ["Ada Okonkwo", "Ada", "Okonkwo"],
      addresses: ["2158 N. Damen Ave", "2158 N. Damen Condominium Association", "2158 N. Damen"],
      keep: ["Chicago", "IL", "Illinois"],
    });
  });
});
