import { describe, expect, it } from "vitest";
import { plaidClientUserId } from "@/lib/plaid/client-user-id";

describe("plaidClientUserId", () => {
  it("is stable per person and different between people", () => {
    const a = "11111111-1111-1111-1111-111111111111";
    const b = "22222222-2222-2222-2222-222222222222";
    expect(plaidClientUserId(a)).toBe(plaidClientUserId(a));
    expect(plaidClientUserId(a)).not.toBe(plaidClientUserId(b));
  });
  it("does not contain the raw id", () => {
    const a = "11111111-1111-1111-1111-111111111111";
    expect(plaidClientUserId(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(plaidClientUserId(a)).not.toContain("1111");
  });
  it("refuses an empty id", () => {
    expect(() => plaidClientUserId("")).toThrow();
  });
});
