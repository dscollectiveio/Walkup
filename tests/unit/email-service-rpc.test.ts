import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const created: { url: string; key: string }[] = [];
const rpc = vi.fn(async () => ({ data: [{ ok: true }], error: null }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (url: string, key: string) => {
    created.push({ url, key });
    return { rpc, from: () => { throw new Error("tables are not reachable from serviceRpc"); } };
  },
}));

import { SERVICE_RPC_ALLOWED, serviceRpc } from "@/lib/email-outbox/service-rpc";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("serviceRpc", () => {
  it("allows exactly the six named functions", () => {
    expect([...SERVICE_RPC_ALLOWED].sort()).toEqual(["email_claim", "email_mark_failed", "email_mark_sent", "email_purge", "email_record_event", "email_run_rules"]);
  });

  it("refuses any other name at run time, before reading the key", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    await expect(serviceRpc("redact_person" as never, {})).rejects.toThrow(/not an allowed function/);
    await expect(serviceRpc("email_set_sending" as never, {})).rejects.toThrow();
    expect(created).toHaveLength(0);
  });

  it("calls the function with the service key and a stateless client", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    const r = await serviceRpc("email_purge", { p_months: 24 });
    expect(r).toEqual({ data: [{ ok: true }], error: null });
    expect(created[0]).toEqual({ url: "https://x.supabase.test", key: "service-key" });
    expect(rpc).toHaveBeenCalledWith("email_purge", { p_months: 24 });
  });

  it("returns an error, not the key, when the environment is incomplete", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const r = await serviceRpc("email_purge", {});
    expect(r.data).toBeNull();
    expect(r.error?.message).toBe("The service key is not configured.");
  });

  it("is imported only by the reminder cron and the Resend webhook, and no other file reads the service key", () => {
    const root = path.resolve(import.meta.dirname, "../../src");
    const importers: string[] = [];
    const keyReaders: string[] = [];
    for (const file of walk(root)) {
      const rel = path.relative(root, file).split(path.sep).join("/");
      const src = readFileSync(file, "utf8");
      if (/from ["']@\/lib\/email-outbox\/service-rpc["']|from ["']\.\/service-rpc["']/.test(src)) importers.push(rel);
      if (src.includes("SUPABASE_SERVICE_ROLE_KEY")) keyReaders.push(rel);
    }
    expect(importers.sort()).toEqual(["app/api/cron/email-reminders/route.ts", "app/api/email/webhook/route.ts"]);
    // The bank sync cron (DECISIONS #28) and the Plaid webhook (PL3) keep their own; email adds only service-rpc.ts.
    expect(keyReaders.sort()).toEqual([
      "app/api/cron/sync-bank-feeds/route.ts",
      "app/api/plaid/webhook/route.ts",
      "lib/email-outbox/service-rpc.ts",
    ]);
  });
});
