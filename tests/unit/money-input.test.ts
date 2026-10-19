import { describe, expect, it } from "vitest";
import { caretAfterFormat, cleanFromNumber, cleanInteger, cleanMoney, displayInteger, displayMoney, moneyToCents } from "@/lib/format/money-input";

describe("typing dollars", () => {
  it("formats whole dollars with commas and a dollar sign", () => {
    expect(displayMoney(cleanMoney("5400"))).toBe("$5,400");
    expect(displayMoney(cleanMoney("123456"))).toBe("$123,456");
    expect(displayMoney(cleanMoney("1234567"))).toBe("$1,234,567");
    expect(displayMoney(cleanMoney("12"))).toBe("$12");
  });

  it("accepts what a person might type or paste", () => {
    expect(cleanMoney("$5,400")).toBe("5400");
    expect(cleanMoney("  $ 5 400 ")).toBe("5400");
    expect(cleanMoney("abc")).toBe("");
    expect(cleanMoney("")).toBe("");
  });

  it("drops leading zeros and starts a decimal with a zero", () => {
    expect(cleanMoney("007")).toBe("7");
    expect(cleanMoney("0")).toBe("0");
    expect(cleanMoney(".5")).toBe("0.5");
  });

  it("keeps up to two decimals, shown only when typed", () => {
    expect(displayMoney(cleanMoney("1234.5"))).toBe("$1,234.5");
    expect(displayMoney(cleanMoney("1234.567"))).toBe("$1,234.56");
    expect(displayMoney(cleanMoney("1234."))).toBe("$1,234.");
    expect(cleanMoney("12.3.4")).toBe("12.34");
  });

  it("converts to whole cents without floating point", () => {
    expect(moneyToCents("5400")).toBe(540000);
    expect(moneyToCents("1234.5")).toBe(123450);
    expect(moneyToCents("0.07")).toBe(7);
    expect(moneyToCents("")).toBe(0);
  });

  it("starts from a saved number", () => {
    expect(cleanFromNumber(5400)).toBe("5400");
    expect(displayMoney(cleanFromNumber(12.5))).toBe("$12.5");
    expect(cleanFromNumber(null)).toBe("");
    expect(cleanFromNumber(0)).toBe("");
  });

  it("limits the length so a slip cannot make a billion-dollar plan", () => {
    expect(cleanMoney("1234567890123")).toBe("123456789");
  });

  it("keeps the caret on the same digit when a comma appears", () => {
    // Typing the 4th digit of "540" -> "5400": caret at the end stays at the end.
    expect(caretAfterFormat("5400", 4, "$5,400")).toBe(6);
    // Typing a "1" after the first digit of "$540" (caret after the 5) -> "$5,140".
    expect(caretAfterFormat("$5140", 3, "$5,140")).toBe(4);
    // Deleting everything puts the caret after the dollar sign or at the start.
    expect(caretAfterFormat("", 0, "")).toBe(0);
  });

  it("formats whole numbers like square footage with commas", () => {
    expect(displayInteger(cleanInteger("1250"))).toBe("1,250");
    expect(displayInteger(cleanInteger("850"))).toBe("850");
    expect(displayInteger(cleanInteger("1,250 sq ft"))).toBe("1,250");
    expect(displayInteger(cleanInteger("1234567"))).toBe("1,234,567");
    expect(cleanInteger("0012")).toBe("12");
    expect(cleanInteger("abc")).toBe("");
    expect(cleanInteger("123456789")).toBe("1234567");
  });
});

