import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { deadConnectionReason, isLoginRequired, isProductNotEnabled, isSyncMutationDuringPagination } from "@/lib/plaid";

const plaidError = (data: Record<string, unknown>) => ({ response: { data } });

describe("isLoginRequired", () => {
  it("recognises the errors only a fresh sign-in at the bank can fix", () => {
    for (const code of ["ITEM_LOGIN_REQUIRED", "ITEM_LOCKED", "ACCESS_NOT_GRANTED"]) {
      expect(isLoginRequired(plaidError({ error_type: "ITEM_ERROR", error_code: code }))).toBe(true);
    }
  });
  it("treats everything else as an ordinary failure", () => {
    expect(isLoginRequired(plaidError({ error_code: "RATE_LIMIT_EXCEEDED" }))).toBe(false);
    expect(isLoginRequired(plaidError({ error_code: "INVALID_PRODUCT" }))).toBe(false);
    expect(isLoginRequired(new Error("network"))).toBe(false);
    expect(isLoginRequired(undefined)).toBe(false);
  });
});

describe("isProductNotEnabled", () => {
  it("recognises Plaid refusing a product this client isn't approved for", () => {
    expect(isProductNotEnabled(plaidError({ error_code: "INVALID_PRODUCT" }))).toBe(true);
    expect(isProductNotEnabled(plaidError({ error_code: "PRODUCT_NOT_ENABLED" }))).toBe(true);
    expect(
      isProductNotEnabled(
        plaidError({ error_message: 'client is not authorized to access the following products: ["balance"]' }),
      ),
    ).toBe(true);
  });
  it("does not swallow other failures", () => {
    expect(isProductNotEnabled(plaidError({ error_code: "ITEM_LOGIN_REQUIRED" }))).toBe(false);
    expect(isProductNotEnabled(new Error("network"))).toBe(false);
    expect(isProductNotEnabled(undefined)).toBe(false);
  });
});

describe("deadConnectionReason", () => {
  it("recognises a dead Item or token, with a distinct message for each", () => {
    const messages = new Set<string>();
    for (const code of ["ITEM_NOT_FOUND", "INVALID_ACCESS_TOKEN", "USER_PERMISSION_REVOKED", "INVALID_PRODUCT"]) {
      const r = deadConnectionReason(plaidError({ error_code: code }));
      expect(r?.code).toBe(code);
      messages.add(r!.message);
    }
    expect(messages.size).toBe(4);
  });
  it("leaves login problems and ordinary failures alone", () => {
    for (const code of ["ITEM_LOGIN_REQUIRED", "RATE_LIMIT_EXCEEDED", "INTERNAL_SERVER_ERROR", "constructor", "__proto__"]) {
      expect(deadConnectionReason(plaidError({ error_code: code }))).toBeNull();
    }
    expect(deadConnectionReason(new Error("network"))).toBeNull();
    expect(deadConnectionReason(undefined)).toBeNull();
    expect(deadConnectionReason(null)).toBeNull();
  });
});

describe("isSyncMutationDuringPagination", () => {
  it("matches only Plaid's mutation code", () => {
    expect(isSyncMutationDuringPagination(plaidError({ error_code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" }))).toBe(true);
    expect(isSyncMutationDuringPagination(plaidError({ error_code: "ITEM_LOGIN_REQUIRED" }))).toBe(false);
    expect(isSyncMutationDuringPagination(undefined)).toBe(false);
  });
});

describe("plaidErrorLog", () => {
  it("keeps Plaid's error codes and request id, and drops the request config with its secret and token", async () => {
    const { plaidErrorLog } = await import("@/lib/plaid");
    const axiosLike = Object.assign(new Error("Request failed with status code 400"), {
      config: {
        headers: { "PLAID-SECRET": "super-secret-value", "PLAID-CLIENT-ID": "client-123" },
        data: JSON.stringify({ access_token: "access-production-abc123" }),
      },
      response: {
        status: 400,
        data: { error_type: "ITEM_ERROR", error_code: "ITEM_LOGIN_REQUIRED", request_id: "req-42" },
      },
    });
    const logged = JSON.stringify(plaidErrorLog(axiosLike));
    expect(logged).toContain("req-42");
    expect(logged).toContain("ITEM_LOGIN_REQUIRED");
    for (const secret of ["super-secret-value", "access-production-abc123", "client-123"]) {
      expect(logged).not.toContain(secret);
    }
  });

  it("copes with things that are not axios errors", async () => {
    const { plaidErrorLog } = await import("@/lib/plaid");
    expect(plaidErrorLog(undefined)).toMatchObject({ name: "unknown" });
    expect(plaidErrorLog(new Error("x"))).toMatchObject({ name: "Error" });
  });
});

describe("Plaid code never logs a caught error directly", () => {
  it("has no console call that passes a catch variable", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f)) files.push(p);
      }
    };
    for (const d of ["src/lib/plaid", "src/app/bank-feed", "src/app/api/cron"]) walk(d);
    files.push("src/lib/plaid.ts");
    const offenders = files.filter((f) => /console\.\w+\([^)]*,\s*(cause|fallback|err|error|e)\s*\)/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
