import { describe, expect, it } from "vitest";
import { equalShares, parseShare } from "@/lib/import/split";

describe("equalShares", () => {
  it("adds up to exactly 100.000000 for 1 to 40 units, with six decimals each", () => {
    for (let n = 1; n <= 40; n++) {
      const shares = equalShares(n);
      expect(shares).toHaveLength(n);
      for (const s of shares) expect(s).toMatch(/^\d{1,3}\.\d{6}$/);
      const millionths = shares.reduce((a, s) => a + Number(s.replace(".", "")), 0);
      expect(millionths, `n=${n}`).toBe(100_000_000);
    }
  });

  it("gives the extra millionths to the last units", () => {
    expect(equalShares(3)).toEqual(["33.333333", "33.333333", "33.333334"]);
    expect(equalShares(1)).toEqual(["100.000000"]);
    expect(equalShares(4)).toEqual(["25.000000", "25.000000", "25.000000", "25.000000"]);
    expect(equalShares(7).at(-1)).toBe("14.285715");
  });

  it("refuses zero, negative and fractional counts", () => {
    expect(() => equalShares(0)).toThrow();
    expect(() => equalShares(-1)).toThrow();
    expect(() => equalShares(2.5)).toThrow();
  });
});

describe("parseShare", () => {
  it("reads a share to six decimals, above 0 and at most 100", () => {
    expect(parseShare("33.3333")).toBe("33.333300");
    expect(parseShare("25%")).toBe("25.000000");
    expect(parseShare("100")).toBe("100.000000");
    expect(parseShare("0.000001")).toBe("0.000001");
  });
  it("refuses everything else", () => {
    for (const bad of ["0", "0.0", "100.000001", "101", "-5", "abc", "", "1.1234567", "1,5"]) expect(parseShare(bad), bad).toBeNull();
  });
});
