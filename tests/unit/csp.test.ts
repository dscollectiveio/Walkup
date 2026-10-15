import { describe, expect, it } from "vitest";
import { buildCsp } from "@/lib/security/csp";

function directive(csp: string, name: string): string[] {
  const part = csp.split("; ").find((d) => d.startsWith(`${name} `) || d === name);
  return part ? part.split(" ").slice(1) : [];
}

describe("img-src", () => {
  it("allows our own Supabase https origin for signed photo URLs, not wss", () => {
    const csp = buildCsp({ nonce: "n", supabaseUrl: "https://abc.supabase.co", dev: false });
    const img = directive(csp, "img-src");
    expect(img).toContain("https://abc.supabase.co");
    expect(img.some((s) => s.startsWith("wss:"))).toBe(false);
  });

  it("allows no other remote origin", () => {
    const csp = buildCsp({ nonce: "n", supabaseUrl: "https://abc.supabase.co", dev: false });
    expect(directive(csp, "img-src")).toEqual(["'self'", "data:", "blob:", "https://abc.supabase.co"]);
  });

  it("stays closed when the Supabase URL is missing or malformed", () => {
    for (const supabaseUrl of [undefined, "not a url"]) {
      const csp = buildCsp({ nonce: "n", supabaseUrl, dev: false });
      expect(directive(csp, "img-src")).toEqual(["'self'", "data:", "blob:"]);
    }
  });

  it("leaves connect-src as it was (uploads already reach Supabase)", () => {
    const csp = buildCsp({ nonce: "n", supabaseUrl: "https://abc.supabase.co", dev: false });
    const connect = directive(csp, "connect-src");
    expect(connect).toContain("https://abc.supabase.co");
    expect(connect).toContain("wss://abc.supabase.co");
  });
});
