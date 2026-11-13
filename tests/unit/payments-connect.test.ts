import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

vi.mock("server-only", () => ({}));

import {
  connectAuthorizeUrl,
  connectConfigProblem,
  signConnectState,
  verifyConnectState,
} from "@/lib/payments/connect";
import { PAYMENTS_SERVICE_RPC_ALLOWED, paymentsServiceRpc } from "@/lib/payments/service-rpc";

// Online dues payments setup (DECISIONS #57, plan Phase 2).

const env = {
  STRIPE_SECRET_KEY: "sk_test_abc",
  STRIPE_CONNECT_CLIENT_ID: "ca_123",
} as unknown as NodeJS.ProcessEnv;

describe("connect state", () => {
  const who = { associationId: "assoc-1", userId: "user-1" };

  it("round-trips who started it and for which building", () => {
    const s = signConnectState(who, { env, now: 1_000 });
    expect(verifyConnectState(s, { env, now: 2_000 })).toEqual({ ...who, expiresAt: 1_000 + 30 * 60_000 });
  });

  it("expires after 30 minutes", () => {
    const s = signConnectState(who, { env, now: 0 });
    expect(verifyConnectState(s, { env, now: 30 * 60_000 + 1 })).toBeNull();
  });

  it("rejects a changed payload, a changed signature, junk and another key", () => {
    const s = signConnectState(who, { env, now: 0 });
    const [payload, mac] = s.split(".");
    const other = Buffer.from(JSON.stringify({ ...who, associationId: "assoc-2", expiresAt: 9e15 })).toString("base64url");
    expect(verifyConnectState(`${other}.${mac}`, { env, now: 0 })).toBeNull();
    expect(verifyConnectState(`${payload}.${mac.slice(0, -2)}xx`, { env, now: 0 })).toBeNull();
    expect(verifyConnectState("nope", { env, now: 0 })).toBeNull();
    expect(verifyConnectState(`${s}.extra`, { env, now: 0 })).toBeNull();
    expect(verifyConnectState(null, { env, now: 0 })).toBeNull();
    const otherKey = { ...env, STRIPE_SECRET_KEY: "sk_test_other" } as NodeJS.ProcessEnv;
    expect(verifyConnectState(s, { env: otherKey, now: 0 })).toBeNull();
  });

  it("is different every time (a nonce), even for the same person", () => {
    expect(signConnectState(who, { env, now: 0 })).not.toBe(signConnectState(who, { env, now: 0 }));
  });
});

describe("connect config and URL", () => {
  it("is off until both the Stripe key and the Connect client id are set", () => {
    expect(connectConfigProblem({} as NodeJS.ProcessEnv)).toMatch(/aren't available/);
    expect(connectConfigProblem({ STRIPE_SECRET_KEY: "sk_test_abc" } as unknown as NodeJS.ProcessEnv)).toMatch(/aren't available/);
    expect(connectConfigProblem({ ...env, STRIPE_CONNECT_CLIENT_ID: "nope" } as NodeJS.ProcessEnv)).toMatch(/aren't available/);
    expect(connectConfigProblem(env)).toBeNull();
  });

  it("sends the board admin to Stripe's OAuth page for a Standard account", () => {
    const u = new URL(connectAuthorizeUrl({ state: "st", redirectUri: "http://localhost:3100/api/stripe/connect/callback", env }));
    expect(u.origin + u.pathname).toBe("https://connect.stripe.com/oauth/authorize");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      response_type: "code",
      client_id: "ca_123",
      scope: "read_write",
      state: "st",
      redirect_uri: "http://localhost:3100/api/stripe/connect/callback",
    });
  });
});

describe("payments service RPC", () => {
  it("calls only its own connect_* functions, none of which writes the ledger", async () => {
    expect(PAYMENTS_SERVICE_RPC_ALLOWED.every((n) => n.startsWith("connect_"))).toBe(true);
    await expect(paymentsServiceRpc("post_stripe_payout" as never, {})).rejects.toThrow(/not an allowed function/);
    await expect(paymentsServiceRpc("billing_claim_event" as never, {})).rejects.toThrow(/not an allowed function/);
  });

  it("is imported only by the Dues setup actions, the Connect routes and the Checkout reconcile", () => {
    const src = path.join(process.cwd(), "src");
    const allowed = new Set([
      "app/dues/online-payments-actions.ts",
      "app/api/stripe/connect/callback/route.ts",
      // Records how an owner's Checkout ended (Phase 3); can only move payment statuses forward.
      "lib/payments/reconcile.ts",
      // The Connect webhook (Phase 4).
      "app/api/stripe/connect/webhook/route.ts",
    ]);
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
        d.isDirectory() ? walk(path.join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [path.join(dir, d.name)] : []);
    const importers = walk(src)
      .filter((f) => /from ["']@\/lib\/payments\/service-rpc["']/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(src, f).split(path.sep).join("/"));
    expect(importers.filter((f) => !allowed.has(f))).toEqual([]);
  });
});
