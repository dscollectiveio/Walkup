import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { isSealed, openSecret, sealSecret, sealingEnabled } from "@/lib/security/secret-box";

const KEY_A = Buffer.alloc(32, 7).toString("base64");
const KEY_B = Buffer.alloc(32, 9).toString("base64");

describe("secret box (Plaid tokens at rest)", () => {
  beforeEach(() => {
    vi.stubEnv("BANK_TOKEN_KEY", KEY_A);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("seals to ciphertext that doesn't contain the secret, and opens it again", () => {
    const sealed = sealSecret("access-production-abc123");
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain("abc123");
    expect(openSecret(sealed)).toBe("access-production-abc123");
  });

  it("uses a fresh nonce each time, so the same secret never looks the same twice", () => {
    expect(sealSecret("same")).not.toBe(sealSecret("same"));
  });

  it("refuses a tampered value and a different key", () => {
    const sealed = sealSecret("secret");
    const parts = sealed.split(":");
    // Always change the first character (it is "A" about 1 time in 64, which would tamper with nothing).
    parts[4] = (parts[4][0] === "A" ? "B" : "A") + parts[4].slice(1);
    expect(() => openSecret(parts.join(":"))).toThrow();
    vi.stubEnv("BANK_TOKEN_KEY", KEY_B);
    expect(() => openSecret(sealed)).toThrow();
  });

  it("passes legacy plain text straight through, with or without a key", () => {
    expect(openSecret("access-sandbox-legacy")).toBe("access-sandbox-legacy");
    vi.stubEnv("BANK_TOKEN_KEY", "");
    expect(openSecret("access-sandbox-legacy")).toBe("access-sandbox-legacy");
  });

  it("with no key, stores plain (so a deploy can't break bank sync) but can't open sealed values", () => {
    const sealed = sealSecret("tok");
    vi.stubEnv("BANK_TOKEN_KEY", "");
    expect(sealingEnabled()).toBe(false);
    expect(sealSecret("tok")).toBe("tok");
    expect(() => openSecret(sealed)).toThrow(/not set/);
  });

  it("rejects a key of the wrong size", () => {
    vi.stubEnv("BANK_TOKEN_KEY", Buffer.alloc(16).toString("base64"));
    expect(() => sealSecret("x")).toThrow(/32 bytes/);
  });
});
