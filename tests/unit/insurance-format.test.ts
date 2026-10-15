import { describe, expect, it } from "vitest";
import {
  bp4FromFraction,
  formatMoney,
  formatPercent,
  formatPhone,
  fractionFromBp4,
  longDate,
  mulCentsBp4,
  periodLabel,
  telHref,
} from "@/lib/insurance/format";

describe("format", () => {
  it("formatMoney", () => {
    expect(formatMoney("2400000.00")).toBe("$2,400,000");
    expect(formatMoney("1255.33")).toBe("$1,255.33");
    expect(formatMoney("5000.00", { cents: true })).toBe("$5,000.00");
    expect(formatMoney("0.00")).toBe("$0");
    expect(formatMoney("999")).toBe("$999");
    expect(formatMoney(null)).toBeNull();
    expect(formatMoney("abc")).toBeNull();
  });

  it("formatPercent and the bp4 round trip", () => {
    expect(formatPercent("0.0200")).toBe("2%");
    expect(formatPercent("0.0125")).toBe("1.25%");
    expect(formatPercent("0.0250")).toBe("2.5%");
    expect(formatPercent("1.0000")).toBe("100%");
    expect(formatPercent(null)).toBeNull();
    expect(bp4FromFraction("0.0200")).toBe(200);
    expect(bp4FromFraction("1")).toBe(10000);
    expect(fractionFromBp4(200)).toBe("0.0200");
    expect(fractionFromBp4(10000)).toBe("1.0000");
  });

  it("dates", () => {
    expect(longDate("2027-03-01")).toBe("March 1, 2027");
    expect(periodLabel("2026-03-01", "2027-03-01")).toBe("Mar 1, 2026 to Mar 1, 2027");
  });

  it("phones", () => {
    expect(formatPhone("3125550100")).toBe("(312) 555-0100");
    expect(formatPhone("+1 312.555.0100")).toBe("(312) 555-0100");
    expect(formatPhone(" 555-0100 ")).toBe("555-0100");
    expect(formatPhone("")).toBeNull();
    expect(telHref("(312) 555-0100")).toBe("tel:+13125550100");
    expect(telHref("555-0100")).toBeNull();
  });

  it("mulCentsBp4 is exact at the numeric(14,2) ceiling, where floats are not", () => {
    // 99,999,999,999,999 cents × 2% = 1,999,999,999,999.98 cents → rounds to 2,000,000,000,000.
    expect(mulCentsBp4(99999999999999, 200)).toBe(2000000000000);
    // The intermediate product passes 2^53; the result matches exact BigInt arithmetic.
    expect(99999999999999 * 9999 > Number.MAX_SAFE_INTEGER).toBe(true);
    expect(mulCentsBp4(99999999999999, 9999)).toBe(Number((BigInt(99999999999999) * BigInt(9999) + BigInt(5000)) / BigInt(10000)));
    expect(mulCentsBp4(99999999999999, 10000)).toBe(99999999999999);
    expect(mulCentsBp4(240000000, 1000)).toBe(24000000);
    expect(mulCentsBp4(1, 5000)).toBe(1); // half up
    expect(mulCentsBp4(1, 4999)).toBe(0);
    expect(() => mulCentsBp4(1.5, 100)).toThrow();
  });
});
