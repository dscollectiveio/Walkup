import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/security/safe-next";

describe("safeNext (REVIEW-2 #7)", () => {
  it("keeps ordinary same-site paths", () => {
    for (const ok of ["/", "/documents", "/reset-password", "/invite/abc123", "/dues?tab=needs&x=1#top", "/a/b-c_d.e~f%20g"]) {
      expect(safeNext(ok)).toBe(ok);
    }
  });

  it("rejects the spellings that leave the site", () => {
    const bad = [
      "//evil.example",
      "/\\evil.example",
      "/\\/evil.example",
      "/\t/evil.example",
      "/\r\n/evil.example",
      "/\u0000/evil.example",
      "/%5Cevil.example",
      "/%5cevil.example",
      "/%09/evil.example",
      "/%0a/evil.example",
      "/%2F/evil.example",
      "/%252F%252Fevil.example",
      "%2F%2Fevil.example",
      "https://evil.example",
      "http:/evil.example",
      "javascript:alert(1)",
      "evil.example",
      "",
      "/ evil",
      "/ /evil.example",
      "/／evil.example",
      "/%E0%A4%A",
      "/" + "a".repeat(3000),
    ];
    for (const b of bad) expect(safeNext(b), JSON.stringify(b)).toBe("/");
  });

  it("falls back for missing values and honours a custom fallback", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext("//x", "/login")).toBe("/login");
  });

  it("every result resolves to this origin", () => {
    for (const raw of ["/\\evil.com", "/\t/evil.com", "//evil.com", "/ok"]) {
      expect(new URL(safeNext(raw), "https://app.example").origin).toBe("https://app.example");
    }
  });

  it("the places that read next/redirect go through it", () => {
    const root = path.resolve(__dirname, "../../src");
    for (const f of ["app/auth/confirm/route.ts", "app/login/mfa-challenge/actions.ts", "app/login/mfa-challenge/page.tsx"]) {
      const text = readFileSync(path.join(root, f), "utf8");
      expect(text, f).toContain("safeNext(");
      expect(text, f).not.toMatch(/startsWith\(\s*["']\/["']\s*\)\s*&&\s*!/);
    }
  });
});
