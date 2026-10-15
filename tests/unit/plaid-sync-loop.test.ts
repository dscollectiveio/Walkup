import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const transactionsSync = vi.fn();
vi.mock("@/lib/plaid", async (orig) => ({
  ...(await orig<typeof import("@/lib/plaid")>()),
  plaidClient: () => ({ transactionsSync }),
}));

import { MAX_PAGES_PER_RUN, syncOneConnection } from "@/lib/plaid/sync";

interface Call {
  table: string;
  op: string;
  args: unknown[];
}

/** A chainable stand-in for the Supabase query builder that records what was written. */
function fakeSupabase() {
  const calls: Call[] = [];
  const from = (table: string) => {
    let op = "select";
    let args: unknown[] = [];
    const chain: Record<string, unknown> = {};
    const result = () => ({ data: [], error: null });
    for (const m of ["select", "update", "upsert", "eq", "neq", "in", "is", "order"]) {
      chain[m] = (...a: unknown[]) => {
        if (m === "update" || m === "upsert") {
          op = m;
          args = a;
        }
        return chain;
      };
    }
    chain.then = (resolve: (v: unknown) => unknown) => {
      calls.push({ table, op, args });
      return Promise.resolve(result()).then(resolve);
    };
    return chain;
  };
  return { client: { from, rpc: vi.fn() } as never, calls };
}

const tx = (id: string) => ({
  transaction_id: id,
  account_id: "acct",
  date: "2026-10-01",
  amount: 12.5,
  name: `Payee ${id}`,
  pending: false,
  category: ["Food"],
});
const page = (ids: string[], next: string, hasMore: boolean, removed: string[] = []) => ({
  data: {
    added: ids.map(tx),
    modified: [],
    removed: removed.map((transaction_id) => ({ transaction_id })),
    next_cursor: next,
    has_more: hasMore,
  },
});
const plaidError = (error_code: string) => ({ response: { status: 400, data: { error_type: "ITEM_ERROR", error_code, request_id: "r1" } } });
const conn = { id: "c1", association_id: "a1", sync_cursor: "start" };

const cursors = (calls: Call[]) =>
  calls
    .filter((c) => c.table === "bank_connections" && c.op === "update")
    .map((c) => c.args[0] as Record<string, unknown>);

beforeEach(() => {
  transactionsSync.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("syncOneConnection paging", () => {
  it("saves the cursor after every committed page, then stamps the run", async () => {
    transactionsSync
      .mockResolvedValueOnce(page(["t1"], "c-1", true))
      .mockResolvedValueOnce(page(["t2"], "c-2", false));
    const { client, calls } = fakeSupabase();
    const r = await syncOneConnection(client, conn, "tok", { autoPost: false });
    expect(r).toMatchObject({ count: 2 });
    expect(transactionsSync.mock.calls.map((c) => c[0].cursor)).toEqual(["start", "c-1"]);
    const updates = cursors(calls);
    expect(updates[0]).toEqual({ sync_cursor: "c-1" });
    expect(updates[1]).toEqual({ sync_cursor: "c-2" });
    expect(updates[2]).toMatchObject({ status: "active" });
    // The cursor is written after that page's rows, not before.
    const order = calls.map((c) => `${c.table}:${c.op}`);
    expect(order.indexOf("bank_transactions:upsert")).toBeLessThan(order.indexOf("bank_connections:update"));
  });

  it("stops at the page cap, keeps the cursor, and reports more to do", async () => {
    let n = 0;
    transactionsSync.mockImplementation(async () => page([`t${n}`], `c-${++n}`, true));
    const { client, calls } = fakeSupabase();
    const r = await syncOneConnection(client, conn, "tok", { autoPost: false });
    expect(transactionsSync).toHaveBeenCalledTimes(MAX_PAGES_PER_RUN);
    expect(r).toMatchObject({ more: true, count: MAX_PAGES_PER_RUN });
    expect(cursors(calls).some((u) => u.sync_cursor === `c-${MAX_PAGES_PER_RUN}`)).toBe(true);
  });

  it("keeps the earlier pages' cursor when a later page fails", async () => {
    transactionsSync.mockResolvedValueOnce(page(["t1"], "c-1", true)).mockRejectedValueOnce(plaidError("INTERNAL_SERVER_ERROR"));
    const { client, calls } = fakeSupabase();
    const r = await syncOneConnection(client, conn, "tok", { autoPost: false });
    expect(r).toHaveProperty("error");
    expect(cursors(calls)).toEqual([{ sync_cursor: "c-1" }]);
  });

  it("restarts from the cursor the run began with after a mutation during pagination", async () => {
    transactionsSync
      .mockResolvedValueOnce(page(["t1"], "c-1", true))
      .mockRejectedValueOnce(plaidError("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"))
      .mockResolvedValueOnce(page(["t1", "t2"], "c-9", false));
    const { client } = fakeSupabase();
    const r = await syncOneConnection(client, conn, "tok", { autoPost: false });
    expect(transactionsSync.mock.calls.map((c) => c[0].cursor)).toEqual(["start", "c-1", "start"]);
    expect(r).toMatchObject({ count: 2 });
  });

  it("gives up restarting after a few mutations instead of looping forever", async () => {
    transactionsSync.mockRejectedValue(plaidError("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"));
    const { client } = fakeSupabase();
    const r = await syncOneConnection(client, conn, "tok", { autoPost: false });
    expect(r).toHaveProperty("error");
    expect(transactionsSync).toHaveBeenCalledTimes(4);
  });
});

describe("syncOneConnection dead tokens", () => {
  it.each(["ITEM_NOT_FOUND", "INVALID_ACCESS_TOKEN", "USER_PERMISSION_REVOKED", "INVALID_PRODUCT"])(
    "marks the connection error and says so distinctly for %s",
    async (code) => {
      transactionsSync.mockRejectedValue(plaidError(code));
      const { client, calls } = fakeSupabase();
      const r = await syncOneConnection(client, conn, "tok", { autoPost: false });
      expect(r).toMatchObject({ deadConnection: true });
      expect((r as { error: string }).error).toMatch(/Disconnect/);
      expect((r as { needsReconnect?: boolean }).needsReconnect).toBeUndefined();
      expect(cursors(calls)).toEqual([{ status: "error" }]);
      expect(transactionsSync).toHaveBeenCalledTimes(1);
    },
  );

  it("still treats a login problem as reconnectable, not dead", async () => {
    transactionsSync.mockRejectedValue(plaidError("ITEM_LOGIN_REQUIRED"));
    const { client } = fakeSupabase();
    const r = await syncOneConnection(client, conn, "tok", { autoPost: false });
    expect(r).toMatchObject({ needsReconnect: true });
    expect(r).not.toHaveProperty("deadConnection");
  });

  it("does not log the access token", async () => {
    transactionsSync.mockRejectedValue(Object.assign(plaidError("ITEM_NOT_FOUND"), { config: { data: "access-production-zzz" } }));
    const { client } = fakeSupabase();
    await syncOneConnection(client, conn, "access-production-zzz", { autoPost: false });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("access-production-zzz");
  });
});
