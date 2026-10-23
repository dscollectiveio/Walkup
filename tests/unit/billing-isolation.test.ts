import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const created: { url: string; key: string }[] = [];
const rpc = vi.fn(async () => ({ data: true, error: null }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (url: string, key: string) => {
    created.push({ url, key });
    return { rpc, from: () => { throw new Error("tables are not reachable from billingServiceRpc"); } };
  },
}));

import { BILLING_SERVICE_RPC_ALLOWED, billingServiceRpc } from "@/lib/billing/service-rpc";
import { DUES_PAYMENTS_ENABLED } from "@/lib/site-config";

const SRC = path.resolve(import.meta.dirname, "../../src");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const BILLING_DIRS = ["lib/billing", "app/billing", "app/admin/billing", "app/api/stripe", "app/api/cron/billing-notices"];

/** Subscriptions plan 2.8: Walkup's fee never touches the association's money. */
describe("billing stays away from the association's money", () => {
  const files = BILLING_DIRS.flatMap((d) => walk(path.join(SRC, d)));

  it("finds the billing code", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it("never imports the ledger, bank, Plaid, dues or money modules", () => {
    const forbidden = /from ["']@\/lib\/(accounting|plaid|plaid\.ts|bank|dues|money|statements|collections|import|tax)(\/|["'])/;
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src, path.relative(SRC, file)).not.toMatch(forbidden);
      expect(src, path.relative(SRC, file)).not.toMatch(/from ["']@\/app\/(bank-feed|dues|ledger|budget|financial-statements)/);
    }
  });

  it("never calls a ledger, expense or bank-feed function or reads a money table", () => {
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src, path.relative(SRC, file)).not.toMatch(
        /post_journal_entry|record_expense|journal_entries|journal_lines|bank_transactions|bank_connections|assessment_charges|\.from\(["'`]/,
      );
    }
  });

  it("keeps dues payments through Walkup switched off", () => {
    expect(DUES_PAYMENTS_ENABLED).toBe(false);
  });

  it("never handles card data on our pages (hosted Stripe pages only)", () => {
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src, path.relative(SRC, file)).not.toMatch(/js\.stripe\.com|card_number|cardNumber|cvc|elements\(/i);
    }
  });
});

describe("billingServiceRpc", () => {
  it("allows exactly the fourteen billing functions", () => {
    expect([...BILLING_SERVICE_RPC_ALLOWED].sort()).toEqual([
      "billing_apply_subscription",
      "billing_claim_event",
      "billing_finish_event",
      "billing_generate_comp_notices",
      "billing_link_checkout",
      "billing_notice_candidates",
      "billing_notice_claim",
      "billing_notice_mark",
      "billing_open_read_only_notice",
      "billing_open_tier_notice",
      "billing_record_payment",
      "billing_tier_candidates",
      "platform_signup_alert_mark",
      "platform_signup_alerts_claim",
    ]);
  });

  it("refuses any other name before reading the key", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    await expect(billingServiceRpc("billing_grant_comp" as never, {})).rejects.toThrow(/not an allowed function/);
    await expect(billingServiceRpc("email_purge" as never, {})).rejects.toThrow(/not an allowed function/);
    expect(created).toHaveLength(0);
  });

  it("calls with a stateless service client", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    const r = await billingServiceRpc("billing_claim_event", { p_event_id: "evt_1" });
    expect(r).toEqual({ data: true, error: null });
    expect(created[0]).toEqual({ url: "https://x.supabase.test", key: "service-key" });
  });

  it("is imported only by the Stripe webhook route and the daily notices run", () => {
    const importers: string[] = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      const src = readFileSync(file, "utf8");
      if (/from ["']@\/lib\/billing\/service-rpc["']|from ["']\.\/service-rpc["']/.test(src) && !rel.startsWith("lib/email-outbox/")) importers.push(rel);
    }
    expect(importers.sort()).toEqual(["app/api/cron/billing-notices/route.ts", "app/api/stripe/webhook/route.ts"]);
  });

  it("the webhook path is public, exactly", () => {
    const proxy = readFileSync(path.join(SRC, "lib/supabase/proxy.ts"), "utf8");
    expect(proxy).toContain(`"/api/stripe/webhook"`);
    expect(proxy).not.toMatch(/"\/api\/stripe"/);
  });
});
