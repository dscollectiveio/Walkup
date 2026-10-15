import { describe, expect, it } from "vitest";
import {
  COMMA_DECIMAL_MESSAGE, detectDateOrder, normalizeDate, normalizeEmail, normalizeKey, normalizeMoney, normalizePercent,
  normalizePhone, normalizeTrade, shiftDecimal,
} from "@/lib/import/normalize";

const iso = (text: string, hint: "mdy" | "dmy" | "ymd" | "auto" = "mdy") => {
  const r = normalizeDate(text, hint);
  return r.ok ? r.iso : null;
};

describe("normalizeDate", () => {
  it("reads year-first dates in every common separator, with or without a time", () => {
    expect(iso("2026-02-03")).toBe("2026-02-03");
    expect(iso("2026/2/3")).toBe("2026-02-03");
    expect(iso("2026.02.03")).toBe("2026-02-03");
    expect(iso("2026-02-03 00:00:00")).toBe("2026-02-03");
    expect(iso("2026-02-03T13:45:00Z")).toBe("2026-02-03");
    expect(iso("20260203")).toBe("2026-02-03");
  });

  it("reads slash dates month-first unless told otherwise", () => {
    expect(iso("2/3/2026")).toBe("2026-02-03");
    expect(iso("02/03/26")).toBe("2026-02-03");
    expect(iso("2/3/2026", "dmy")).toBe("2026-03-02");
    expect(iso("14/3/2026", "dmy")).toBe("2026-03-14");
    expect(iso("14/3/2026", "mdy")).toBeNull();
    expect(iso("3-2-2026")).toBe("2026-03-02");
    expect(iso("14/3/2026", "auto")).toBe("2026-03-14");
    expect(iso("3/14/2026", "auto")).toBe("2026-03-14");
  });

  it("maps two-digit years: 00 to 69 are 20xx, 70 to 99 are 19xx", () => {
    expect(iso("1/2/00")).toBe("2000-01-02");
    expect(iso("1/2/69")).toBe("2069-01-02");
    expect(iso("1/2/95")).toBe("1995-01-02");
  });

  it("reads month names", () => {
    expect(iso("Feb 3, 2026")).toBe("2026-02-03");
    expect(iso("February 3 2026")).toBe("2026-02-03");
    expect(iso("Feb. 3rd, 2026")).toBe("2026-02-03");
    expect(iso("3 Feb 2026")).toBe("2026-02-03");
    expect(iso("03-Feb-26")).toBe("2026-02-03");
    expect(iso("Sept 9, 2025")).toBe("2025-09-09");
  });

  it("reads Excel serial numbers (days since 1899-12-30)", () => {
    expect(iso("46056")).toBe("2026-02-03");
    expect(iso("46056.75")).toBe("2026-02-03");
    expect(iso("61")).toBeNull(); // 1900 is before any association could have books
    expect(iso("0")).toBeNull();
    expect(iso("60001")).toBeNull();
  });

  it("refuses impossible and unreadable dates", () => {
    for (const bad of ["", "   ", "2026-02-30", "2026-13-01", "2/30/2026", "31/31/2026", "Feb 30, 2026", "banana", "2026", "Foo 3, 2026", "1/1/1800", "9999-01-01"]) {
      expect(iso(bad), bad).toBeNull();
    }
    expect(iso("2024-02-29")).toBe("2024-02-29");
    expect(iso("2025-02-29")).toBeNull();
  });

  it("chooses day-first for a whole column only when a first part is above 12 and no second part is", () => {
    expect(detectDateOrder(["13/2/2026", "1/2/2026"])).toBe("dmy");
    expect(detectDateOrder(["1/13/2026", "2/2/2026"])).toBe("mdy");
    expect(detectDateOrder(["1/2/2026"])).toBe("mdy");
    expect(detectDateOrder(["13/2/2026", "2/13/2026"])).toBe("mdy");
    expect(detectDateOrder(["2026-02-03"])).toBe("mdy");
  });
});

describe("normalizeMoney", () => {
  const ok = (t: string) => {
    const r = normalizeMoney(t);
    return r.ok ? r.text : null;
  };

  it("reads the usual forms into a two-decimal string", () => {
    expect(ok("450")).toBe("450.00");
    expect(ok("450.5")).toBe("450.50");
    expect(ok("$1,234.5")).toBe("1234.50");
    expect(ok("-$1,234.50")).toBe("-1234.50");
    expect(ok("$-1,234.50")).toBe("-1234.50");
    expect(ok("(1,234.50)")).toBe("-1234.50");
    expect(ok("123.45-")).toBe("-123.45");
    expect(ok("  $ 12.00 ")).toBe("12.00");
    expect(ok(".5")).toBe("0.50");
    expect(ok("007.10")).toBe("7.10");
    expect(ok("-0")).toBe("0.00");
    expect(ok("12 345.67")).toBe("12345.67");
  });

  it("a space is a thousands separator only between groups of exactly three digits (REVIEW-4 #16)", () => {
    expect(ok("12 34")).toBeNull();
    expect(ok("100 2000")).toBeNull();
    expect(ok("12 345 6")).toBeNull();
    // "100 200" is the one genuinely ambiguous shape (100,200 with a space, or two numbers). A
    // 1-3 digit group followed by groups of exactly three is read as thousands, as French-locale sheets write it.
    expect(ok("100 200")).toBe("100200.00");
    expect(ok("1 2345")).toBeNull();
    expect(ok("1234 567")).toBeNull();
    expect(ok("1 234")).toBe("1234.00");
    expect(ok("1 234 567.89")).toBe("1234567.89");
    expect(ok("($ 1 234.50)")).toBe("-1234.50");
  });

  it("never rounds: three decimals are refused", () => {
    expect(ok("12.345")).toBeNull();
    expect(ok("0.001")).toBeNull();
  });

  it("refuses CR and DR suffixes, text, exponents and absurd sizes", () => {
    for (const bad of ["100 CR", "100DR", "CR 100", "", "abc", "1e3", "1,23,456.00", "1234567890123", "12.", "--5", "5-5"]) {
      expect(ok(bad), bad).toBeNull();
    }
  });

  it("explains a European decimal comma instead of guessing", () => {
    for (const t of ["1.234,50", "12,50", "1234,5"]) {
      expect(normalizeMoney(t)).toEqual({ ok: false, message: COMMA_DECIMAL_MESSAGE });
    }
    expect(ok("1,234")).toBe("1234.00");
  });
});

describe("normalizePercent", () => {
  it("reads points", () => {
    expect(normalizePercent(["25", "25%", "25.5", ""])).toEqual({ ok: true, asFraction: false, values: ["25", "25", "25.5", null] });
  });

  it("reads fractions that add up to one, exactly", () => {
    expect(normalizePercent(["0.25", "0.25", "0.5"])).toEqual({ ok: true, asFraction: true, values: ["25", "25", "50"] });
    const r = normalizePercent(["0.333333", "0.333333", "0.333334"]);
    expect(r).toMatchObject({ ok: true, asFraction: true, values: ["33.3333", "33.3333", "33.3334"] });
  });

  it("treats small values that do not add up to one as points", () => {
    expect(normalizePercent(["0.5", "0.5", "0.4"])).toMatchObject({ ok: true, asFraction: false });
  });

  it("rejects a mix of fractions and percents", () => {
    expect(normalizePercent(["0.25", "40", "35"])).toEqual({ ok: false, error: "Some ownership values look like fractions and some like percents." });
  });

  it("keeps values over 100 and unreadable ones as typed, for the database to refuse", () => {
    const r = normalizePercent(["101", "abc", "50"]);
    expect(r).toMatchObject({ ok: true, values: ["101", "abc", "50"] });
  });
});

describe("shiftDecimal", () => {
  it("moves the point without a float", () => {
    expect(shiftDecimal("0.25", 2)).toBe("25");
    expect(shiftDecimal("1", 2)).toBe("100");
    expect(shiftDecimal("0.5", 2)).toBe("50");
    expect(shiftDecimal("0.0005", 2)).toBe("0.05");
    expect(shiftDecimal("0", 2)).toBe("0");
  });
});

describe("phone, email, trade, key", () => {
  it("keeps digits and phone punctuation only, up to 40 characters", () => {
    expect(normalizePhone("(312) 555-0142 ext. 5")).toBe("(312) 555-0142 x. 5");
    expect(normalizePhone("+1 312.555.0142")).toBe("+1 312.555.0142");
    expect(normalizePhone("call me <script>")).toBe("");
    expect(normalizePhone("1".repeat(60)).length).toBe(40);
  });

  it("reduces email forms to the address", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
    expect(normalizeEmail("Ada Okonkwo <Ada@Example.com>")).toBe("ada@example.com");
    expect(normalizeEmail("mailto:ada@example.com")).toBe("ada@example.com");
    expect(normalizeEmail("not an email")).toBe("not an email");
  });

  it("maps a trade word to the shared trade list, or keeps what was typed", () => {
    expect(normalizeTrade("Plumbing")).toEqual({ trade: "Plumbing", slug: "plumbing" });
    expect(normalizeTrade("plumber")).toEqual({ trade: "Plumbing", slug: "plumbing" });
    expect(normalizeTrade("HVAC")).toEqual({ trade: "Heating & cooling", slug: "hvac" });
    expect(normalizeTrade("Heating & cooling")).toEqual({ trade: "Heating & cooling", slug: "hvac" });
    expect(normalizeTrade("Roofing")).toEqual({ trade: "Roofing", slug: "roofing" });
    expect(normalizeTrade("Window Washing Wizards")).toMatchObject({ slug: expect.any(String) });
    expect(normalizeTrade("Piano Tuning")).toEqual({ trade: "Piano Tuning", slug: "piano tuning" });
    expect(normalizeTrade("  ")).toBeNull();
  });

  it("normalizeKey lowercases, trims and collapses spaces", () => {
    expect(normalizeKey("  Regular   ASSESSMENTS ")).toBe("regular assessments");
  });
});
