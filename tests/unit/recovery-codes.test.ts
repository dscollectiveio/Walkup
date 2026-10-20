import { describe, expect, it } from "vitest";
import {
  LOCK_MINUTES,
  type LockState,
  MAX_FAILED_ATTEMPTS,
  RECOVERY_ALPHABET,
  RECOVERY_CODE_COUNT,
  afterAttempt,
  digestsFor,
  formatCode,
  generateCode,
  hashCode,
  hashesEqual,
  isLocked,
  makeCodeSet,
  minutesLeft,
  newSalt,
  normalizeCode,
} from "@/lib/security/recovery-codes";
import { codesFileText } from "@/lib/security/recovery-codes-text";

describe("recovery code format", () => {
  it("is ten characters from the look-alike-free alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const c = generateCode();
      expect(c).toHaveLength(10);
      for (const ch of c) expect(RECOVERY_ALPHABET).toContain(ch);
    }
    expect(RECOVERY_ALPHABET).not.toMatch(/[01OIl]/);
  });

  it("formats as XXXXX-XXXXX and normalizes what people type", () => {
    expect(formatCode("ABCDE23456")).toBe("ABCDE-23456");
    expect(normalizeCode("abcde-23456")).toBe("ABCDE23456");
    expect(normalizeCode("  ABCDE 23456 ")).toBe("ABCDE23456");
  });

  it("rejects anything that cannot be a code", () => {
    expect(normalizeCode("")).toBeNull();
    expect(normalizeCode("ABCDE-2345")).toBeNull();
    expect(normalizeCode("ABCDE-234567")).toBeNull();
    expect(normalizeCode("ABCDE-2345O")).toBeNull(); // O is not in the alphabet
    expect(normalizeCode("ABCDE-2345!")).toBeNull();
  });
});

describe("recovery code hashing", () => {
  it("makes ten distinct codes with distinct salts, and stores no plaintext", async () => {
    const set = await makeCodeSet();
    expect(set.codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(set.codes).size).toBe(RECOVERY_CODE_COUNT);
    expect(new Set(set.salts).size).toBe(RECOVERY_CODE_COUNT);
    for (let i = 0; i < set.codes.length; i++) {
      const plain = set.codes[i].replace("-", "");
      expect(set.hashes[i]).not.toContain(plain);
      expect(set.salts[i]).not.toContain(plain);
      // The typed form hashes to the stored hash.
      expect(hashesEqual(await hashCode(normalizeCode(set.codes[i])!, set.salts[i]), set.hashes[i])).toBe(true);
    }
  });

  it("is salted: the same code hashes differently under another salt", async () => {
    const a = await hashCode("ABCDE23456", newSalt());
    const b = await hashCode("ABCDE23456", newSalt());
    expect(a).not.toBe(b);
  });

  it("a wrong code does not match any digest", async () => {
    const set = await makeCodeSet(3);
    const digests = await digestsFor("ZZZZZ22222", set.salts);
    expect(digests.some((d) => set.hashes.includes(d))).toBe(false);
  });

  it("the right code matches exactly the digest for its own salt", async () => {
    const set = await makeCodeSet(3);
    const typed = normalizeCode(set.codes[1])!;
    const digests = await digestsFor(typed, set.salts);
    expect(digests.map((d, i) => d === set.hashes[i])).toEqual([false, true, false]);
  });

  it("compares hashes of different length as unequal", () => {
    expect(hashesEqual("abc", "abcd")).toBe(false);
  });
});

describe("download text", () => {
  it("lists every code with a storage note", () => {
    const text = codesFileText(["AAAAA-22222", "BBBBB-33333"], new Date("2026-10-20T12:00:00Z"));
    expect(text).toContain("AAAAA-22222");
    expect(text).toContain("BBBBB-33333");
    expect(text).toContain("Created 2026-10-20");
    expect(text).toMatch(/safe/i);
    expect(text).not.toContain("—");
  });
});

describe("lockout", () => {
  const t0 = Date.parse("2026-10-20T12:00:00Z");
  const clean: LockState = { failed: 0, lockedUntil: null };

  it("counts wrong codes and locks on the fifth for 15 minutes", () => {
    expect(MAX_FAILED_ATTEMPTS).toBe(5);
    expect(LOCK_MINUTES).toBe(15);
    let s = clean;
    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) {
      s = afterAttempt(s, false, t0);
      expect(s.failed).toBe(i);
      expect(isLocked(s, t0)).toBe(false);
    }
    s = afterAttempt(s, false, t0);
    expect(isLocked(s, t0)).toBe(true);
    expect(s.lockedUntil).toBe(t0 + 15 * 60_000);
    expect(minutesLeft(s, t0)).toBe(15);
    expect(minutesLeft(s, t0 + 14 * 60_000 + 1)).toBe(1);
  });

  it("ignores attempts while locked, even a right one", () => {
    const locked = { failed: 0, lockedUntil: t0 + 15 * 60_000 };
    expect(afterAttempt(locked, true, t0 + 1000)).toEqual(locked);
    expect(afterAttempt(locked, false, t0 + 1000)).toEqual(locked);
  });

  it("starts counting again after the lock runs out", () => {
    const locked = { failed: 0, lockedUntil: t0 + 15 * 60_000 };
    const after = t0 + 15 * 60_000 + 1;
    expect(isLocked(locked, after)).toBe(false);
    expect(afterAttempt(locked, false, after)).toEqual({ failed: 1, lockedUntil: null });
  });

  it("a good code clears the count", () => {
    expect(afterAttempt({ failed: 4, lockedUntil: null }, true, t0)).toEqual(clean);
  });
});
