import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

export const STATE_PATH = path.join(__dirname, "..", ".auth", "state.json");

/** Tiny .env.local loader (no dependency, never logs values). */
export function loadEnvLocal(): void {
  const file = path.join(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

export function devCreds() {
  loadEnvLocal();
  const { DEV_AUTH_EMAIL: email, DEV_AUTH_PASSWORD: password, DEV_AUTH_TOTP_SECRET: totp } = process.env;
  const missing = [
    !email && "DEV_AUTH_EMAIL",
    !password && "DEV_AUTH_PASSWORD",
    !totp && "DEV_AUTH_TOTP_SECRET",
  ].filter(Boolean) as string[];
  return { email, password, totp, missing };
}

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.replace(/[\s=-]/g, "").toUpperCase();
  let bits = "";
  for (const ch of clean) {
    const v = alphabet.indexOf(ch);
    if (v < 0) throw new Error("DEV_AUTH_TOTP_SECRET is not valid base32");
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** RFC 6238 TOTP (HMAC-SHA1, 30s step, 6 digits). */
export function totpCode(secret: string, nowMs = Date.now()): string {
  const counter = Math.floor(nowMs / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const off = h[h.length - 1] & 0xf;
  const n = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

/** Resolves a code with at least 5s of validity left, waiting for the next window if needed. */
export async function freshTotp(secret: string): Promise<string> {
  const left = 30_000 - (Date.now() % 30_000);
  if (left < 5_000) await new Promise((r) => setTimeout(r, left + 500));
  return totpCode(secret);
}

/** Password step then TOTP step. Throws a clear error if the dev account does not land signed in. */
export async function signInDevAccount(page: Page): Promise<void> {
  const { email, password, totp, missing } = devCreds();
  if (missing.length) throw new Error(`Missing ${missing.join(", ")}`);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email!);
  await page.locator("#password").fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // The server action redirects to "/", and the proxy may then bounce to the
  // MFA step: wait for the password step to leave exactly /login, then
  // re-request "/" so the final landing place (MFA or app) is deterministic.
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 30_000 });
  await page.goto("/");
  if (page.url().includes("mfa-challenge")) {
    await page.locator("#code").fill(await freshTotp(totp!));
    await page.getByRole("button", { name: "Verify" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
  }
  await page.goto("/");
  if (new URL(page.url()).pathname.startsWith("/login")) {
    throw new Error("Dev sign-in did not produce a usable session (still on " + new URL(page.url()).pathname + ")");
  }
}
