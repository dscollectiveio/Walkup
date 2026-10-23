import { describe, expect, it } from "vitest";
import { maskEmail } from "@/lib/access/contact-mask";

describe("what the accountant sees of other people's email", () => {
  const officers = new Set(["pat@example.test"]);

  it("shows everything to the board and to anyone else who sees all contacts", () => {
    expect(maskEmail("ada@example.test", { seesAll: true, officers })).toBe("ada@example.test");
  });

  it("shows the accountant the Treasurer's and the President's address, whatever its case, and 'on file' for the rest", () => {
    const opts = { seesAll: false, officers };
    expect(maskEmail("pat@example.test", opts)).toBe("pat@example.test");
    expect(maskEmail(" Pat@Example.test ", opts)).toBe(" Pat@Example.test ");
    expect(maskEmail("ada@example.test", opts)).toBe("on file");
  });

  it("leaves a missing address missing, so 'no email' still reads right", () => {
    expect(maskEmail(null, { seesAll: false, officers })).toBeNull();
    expect(maskEmail("", { seesAll: false, officers })).toBe("");
  });
});
