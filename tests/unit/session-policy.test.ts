import { describe, expect, it } from "vitest";
import {
  ACTIVITY_REFRESH_MS,
  decodeActivity,
  encodeActivity,
  FRESH_SIGNIN_MESSAGE,
  FRESH_SIGNIN_MS,
  IDLE_TIMEOUT_MS,
  idleDecision,
  isFreshSignIn,
  isPrefetchRequest,
  lastTotpAt,
  parseActivity,
} from "@/lib/security/session-policy";

const now = Date.parse("2026-10-20T12:00:00Z");

describe("idle timeout", () => {
  it("is twelve hours, refreshed at most once a minute", () => {
    expect(IDLE_TIMEOUT_MS).toBe(12 * 60 * 60 * 1000);
    expect(ACTIVITY_REFRESH_MS).toBe(60_000);
  });

  it("leaves a cookie younger than a minute alone", () => {
    expect(idleDecision(now - 59_999, now)).toEqual({ action: "keep" });
    expect(idleDecision(now, now)).toEqual({ action: "keep" });
  });

  it("rewrites it once it is a minute old", () => {
    expect(idleDecision(now - 60_000, now)).toEqual({ action: "stamp" });
    expect(idleDecision(now - IDLE_TIMEOUT_MS + 1, now)).toEqual({ action: "stamp" });
  });

  it("expires at exactly twelve hours and after", () => {
    expect(idleDecision(now - IDLE_TIMEOUT_MS, now)).toEqual({ action: "expire" });
    expect(idleDecision(now - IDLE_TIMEOUT_MS * 3, now)).toEqual({ action: "expire" });
  });

  it("stamps a session with no cookie instead of signing it out", () => {
    expect(idleDecision(null, now)).toEqual({ action: "stamp" });
  });
});

describe("activity cookie parsing", () => {
  it("reads epoch milliseconds", () => {
    expect(parseActivity(String(now - 5000), now)).toBe(now - 5000);
  });
  it("treats junk, empty and future values as no cookie", () => {
    expect(parseActivity(undefined, now)).toBeNull();
    expect(parseActivity("", now)).toBeNull();
    expect(parseActivity("abc", now)).toBeNull();
    expect(parseActivity("-5", now)).toBeNull();
    expect(parseActivity("1e12", now)).toBeNull();
    expect(parseActivity(String(now + 10 * 60_000), now)).toBeNull();
  });
});

describe("fresh sign-in", () => {
  const sec = (ms: number) => Math.floor(ms / 1000);

  it("is fifteen minutes", () => {
    expect(FRESH_SIGNIN_MS).toBe(15 * 60 * 1000);
  });

  it("accepts a two-step code from the last fifteen minutes", () => {
    const amr = [{ method: "password", timestamp: sec(now - 3600_000) }, { method: "totp", timestamp: sec(now - 14 * 60_000) }];
    expect(isFreshSignIn(amr, now)).toBe(true);
  });

  it("refuses an older code, a password alone, or no claim", () => {
    expect(isFreshSignIn([{ method: "totp", timestamp: sec(now - 16 * 60_000) }], now)).toBe(false);
    expect(isFreshSignIn([{ method: "password", timestamp: sec(now - 1000) }], now)).toBe(false);
    expect(isFreshSignIn(undefined, now)).toBe(false);
    expect(isFreshSignIn("totp", now)).toBe(false);
    expect(isFreshSignIn([], now)).toBe(false);
  });

  it("uses the latest totp entry and ignores a timestamp from the future", () => {
    const amr = [{ method: "totp", timestamp: sec(now - 3600_000) }, { method: "totp", timestamp: sec(now - 60_000) }];
    expect(lastTotpAt(amr)).toBe(sec(now - 60_000));
    expect(isFreshSignIn([{ method: "totp", timestamp: sec(now + 3600_000) }], now)).toBe(false);
  });

  it("the message tells the person what to do and has no em dash", () => {
    expect(FRESH_SIGNIN_MESSAGE).toMatch(/confirm your sign-in/i);
    expect(FRESH_SIGNIN_MESSAGE).toContain("/confirm-sign-in");
    expect(FRESH_SIGNIN_MESSAGE).not.toContain("—");
  });
});

describe("the signed activity cookie", () => {
  const now = Date.parse("2026-10-23T18:00:00Z");

  it("round-trips with a secret, and refuses a cookie signed with another or with no signature", async () => {
    const cookie = await encodeActivity(now - 5000, "secret-one");
    expect(cookie).toMatch(/^\d{13}\.[0-9a-f]{64}$/);
    expect(await decodeActivity(cookie, "secret-one", now)).toBe(now - 5000);
    expect(await decodeActivity(cookie, "secret-two", now)).toBeNull();
    expect(await decodeActivity(String(now - 5000), "secret-one", now)).toBeNull(); // the old bare number
    expect(await decodeActivity(`${now - 5000}.${"0".repeat(64)}`, "secret-one", now)).toBeNull();
    expect(await decodeActivity(`${now}.${cookie.split(".")[1]}`, "secret-one", now)).toBeNull(); // moved the time, kept the signature
    expect(await decodeActivity(`${cookie}.x`, "secret-one", now)).toBeNull();
  });

  it("stays the bare number when no secret is set", async () => {
    expect(await encodeActivity(now, undefined)).toBe(String(now));
    expect(await decodeActivity(String(now - 5000), undefined, now)).toBe(now - 5000);
    expect(await decodeActivity(undefined, undefined, now)).toBeNull();
  });

  it("recognizes a prefetch by any of the headers browsers and Next send", () => {
    const h = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });
    expect(isPrefetchRequest(h({ "next-router-prefetch": "1" }))).toBe(true);
    expect(isPrefetchRequest(h({ purpose: "prefetch" }))).toBe(true);
    expect(isPrefetchRequest(h({ "sec-purpose": "prefetch;prerender" }))).toBe(true);
    expect(isPrefetchRequest(h({}))).toBe(false);
  });
});
