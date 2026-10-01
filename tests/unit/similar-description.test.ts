import { describe, expect, it } from "vitest";
import { isMatchableDescription, normalizeDescription } from "@/lib/plaid/similar";

describe("normalizeDescription", () => {
  it("treats reference numbers and punctuation as noise", () => {
    expect(normalizeDescription("COMED  8841 #22")).toBe("comed");
    expect(normalizeDescription("ComEd *PAYMENT 9120")).toBe(normalizeDescription("comed payment 1"));
  });
  it("keeps different payees different", () => {
    expect(normalizeDescription("West Bend Mutual")).not.toBe(normalizeDescription("Home Depot"));
  });
  it("won't match on nothing", () => {
    expect(isMatchableDescription(normalizeDescription("1234 #"))).toBe(false);
    expect(isMatchableDescription(normalizeDescription("ACH"))).toBe(true);
  });
});
