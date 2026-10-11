import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isLoginRequired, isProductNotEnabled } from "@/lib/plaid";

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
