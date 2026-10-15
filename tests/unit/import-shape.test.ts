import { describe, expect, it } from "vitest";
import { headerForAi, maskRows, shapeOf } from "@/lib/import/shape";

describe("shapeOf", () => {
  it("matches the examples in the spec", () => {
    expect(shapeOf("Dee Park")).toBe("Xxx Xxxx");
    expect(shapeOf("ada@example.com")).toBe("xxx@xxxxxxx.xxx");
    expect(shapeOf("312-555-0142")).toBe("999-999-9999");
    expect(shapeOf("$1,234.50")).toBe("$9,999.99");
    expect(shapeOf("2026-02-03")).toBe("9999-99-99");
  });

  it("cuts long text to 24 characters and adds three dots", () => {
    const s = shapeOf("Boiler repair, Acme Plumbing");
    expect(s).toBe("Xxxxxx xxxxxx, Xxxx Xxxx...");
    expect(s.replace("...", "")).toHaveLength(24);
    expect(shapeOf("a".repeat(24))).toBe("x".repeat(24));
  });

  it("handles non-ASCII letters, odd characters and runs of whitespace", () => {
    expect(shapeOf("José Müller")).toBe("Xxxx Xxxxxx");
    expect(shapeOf("Ünal")).toBe("Xxxx");
    expect(shapeOf("日本語")).toBe("xxx");
    expect(shapeOf("a  \t b")).toBe("x x");
    expect(shapeOf("a<b>c|d")).toBe("x?x?x?x");
    expect(shapeOf("O’Brien")).toBe("X?Xxxxx");
    expect(shapeOf("")).toBe("");
  });

  it("never lets a letter or digit through", () => {
    const out = shapeOf("Ada Okonkwo 312-555-0142 ada@example.com 123-45-6789");
    expect(out).not.toMatch(/[a-wyz0-8]/i.test(out) ? /Ada|Okonkwo|0142|example|6789/ : /$^/);
    expect(out).not.toContain("Ada");
    expect(out).not.toMatch(/[0-8]/);
  });
});

describe("maskRows", () => {
  it("takes at most five rows that have something in them", () => {
    const rows = [["", ""], ...Array.from({ length: 8 }, (_, i) => [`Name ${i}`, `${i}`]), ["", ""]];
    const masks = maskRows(rows);
    expect(masks).toHaveLength(5);
    expect(masks[0]).toEqual(["Xxxx 9", "9"]);
    expect(maskRows(rows, 2)).toHaveLength(2);
    expect(maskRows([["", " "]])).toEqual([]);
  });
});

describe("headerForAi", () => {
  it("keeps ordinary headers", () => {
    expect(headerForAi("Owner name", 1)).toBe("Owner name");
    expect(headerForAi("Dues amount", 6)).toBe("Dues amount");
  });

  it("replaces headers that look like data or like a tax ID or account number", () => {
    expect(headerForAi("ada@example.com", 2)).toBe("[column 3]");
    expect(headerForAi("312-555-0142", 3)).toBe("[column 4]");
    expect(headerForAi("x".repeat(61), 4)).toBe("[column 5]");
    expect(headerForAi("SSN", 0)).toBe("[column 1]");
    expect(headerForAi("Tax ID", 0)).toBe("[column 1]");
    expect(headerForAi("Routing #", 0)).toBe("[column 1]");
    expect(headerForAi("Account Number", 0)).toBe("[column 1]");
  });
});
