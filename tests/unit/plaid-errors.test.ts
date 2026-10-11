import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isProductNotEnabled } from "@/lib/plaid";

const plaidError = (data: Record<string, unknown>) => ({ response: { data } });

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
