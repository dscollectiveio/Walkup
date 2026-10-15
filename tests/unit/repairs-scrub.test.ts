import { describe, expect, it } from "vitest";
import { scrubForModel } from "@/lib/repairs/scrub";

describe("scrubForModel", () => {
  it("removes emails, phones, tax IDs, unit references and dollar amounts", () => {
    const out = scrubForModel(
      "Leak in unit 2B, call me at (312) 555-0142 or ada@example.com. Plumber quoted $1,250. My SSN is 123-45-6789. Also #3 has it.",
      2000,
    );
    expect(out).not.toMatch(/ada@example\.com/);
    expect(out).not.toMatch(/555-0142|312/);
    expect(out).not.toMatch(/123-45-6789/);
    expect(out).not.toMatch(/unit 2B|#3/i);
    expect(out).not.toMatch(/\$1,250|1,250/);
    expect(out).toContain("Leak in");
    expect(out).toContain("[removed]");
  });

  it("keeps the words about the work", () => {
    expect(scrubForModel("Radiator cold in the back bedroom", 2000)).toBe("Radiator cold in the back bedroom");
  });

  it("cuts at a word boundary", () => {
    expect(scrubForModel("water coming through the ceiling", 18)).toBe("water coming");
    expect(scrubForModel("water coming through the ceiling", 19)).toBe("water coming");
    expect(scrubForModel("water coming through the ceiling", 20)).toBe("water coming through");
    expect(scrubForModel("abcdefghijklmnop", 5)).toBe("abcde");
    const long = "drip ".repeat(600);
    const cut = scrubForModel(long, 5000);
    expect(cut.length).toBeLessThanOrEqual(2000);
    expect(cut.endsWith("drip")).toBe(true);
  });

  it("is empty for nothing", () => {
    expect(scrubForModel(null, 100)).toBe("");
    expect(scrubForModel("   ", 100)).toBe("");
  });
});

describe("scrubForModel at the 2,000 cap", () => {
  it("drops a word scrubWebTask cut in half", () => {
    const out = scrubForModel(`${"a".repeat(1995)} radiator`, 2000);
    expect(out).toBe("a".repeat(1995));
  });
});
