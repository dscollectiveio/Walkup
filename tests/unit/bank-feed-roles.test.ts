import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const linkTokenCreate = vi.fn(async () => ({ data: { link_token: "link-sandbox-x" } }));
const itemPublicTokenExchange = vi.fn(async () => ({ data: { access_token: "access-sandbox-x", item_id: "item-1" } }));
const itemRemove = vi.fn(async () => ({}));
vi.mock("@/lib/plaid", async (orig) => ({
  ...(await orig<typeof import("@/lib/plaid")>()),
  plaidClient: () => ({ linkTokenCreate, itemPublicTokenExchange, itemRemove }),
}));
vi.mock("@/lib/security/secret-box", () => ({ sealSecret: (s: string) => `sealed:${s}` }));

let role: boolean;
let storeError: { code: string; message: string } | null;
const rpc = vi.fn(async (name: string) => {
  if (name === "has_role_in") return { data: role, error: null };
  if (name === "store_bank_connection") return storeError ? { data: null, error: storeError } : { data: "conn-1", error: null };
  return { data: null, error: null };
});
function builder() {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "update", "limit", "order"]) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: [{ id: "assoc-1" }], count: 0, error: null }).then(resolve);
  return chain;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc,
    from: () => builder(),
    auth: { getUser: async () => ({ data: { user: { id: "11111111-1111-1111-1111-111111111111" } } }) },
  }),
}));

import { connectBank, createLinkToken } from "@/app/bank-feed/actions";

beforeEach(() => {
  vi.clearAllMocks();
  role = true;
  storeError = null;
});

describe("Plaid Link is board-admin only (REVIEW-2 #2)", () => {
  it("refuses a Link token to anyone who is not a board admin", async () => {
    role = false;
    const r = await createLinkToken();
    expect(r.error).toMatch(/board admin/i);
    expect(linkTokenCreate).not.toHaveBeenCalled();
  });

  it("does not exchange a public token before the role check", async () => {
    role = false;
    const r = await connectBank("public-sandbox-x", "Bank");
    expect(r.error).toMatch(/board admin/i);
    expect(itemPublicTokenExchange).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith("store_bank_connection", expect.anything());
  });

  it("mints a token for a board admin", async () => {
    expect((await createLinkToken()).linkToken).toBe("link-sandbox-x");
  });

  it("retires the Plaid Item when the token could not be stored, without leaking the database message", async () => {
    storeError = { code: "42501", message: 'new row violates policy "bank_connections" on table x' };
    const r = await connectBank("public-sandbox-x", "Bank");
    expect(itemRemove).toHaveBeenCalledWith({ access_token: "access-sandbox-x" });
    expect(r.error).not.toMatch(/policy|table|42501/);
  });
});
