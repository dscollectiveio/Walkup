// scripts/security/lib.mjs
//
// Shared helpers for the Walkup RLS attack harness: config loading, raw
// HTTP calls to Supabase Auth / PostgREST / RPC / Storage, and a TOTP
// (RFC 6238) implementation using only node:crypto so the harness can
// step a throwaway test account up to AAL2 without a human typing a code.
//
// SECURITY NOTE: this file reads credentials from a gitignored env file at
// runtime. Nothing is hardcoded, and nothing here should ever print a
// password, access token, or TOTP secret — only PASS/FAIL and short reasons.
//
// Plain Node ESM, no dependencies beyond the runtime.

import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------

/**
 * Reads SUPABASE_URL / SUPABASE_ANON_KEY from process.env, falling back to
 * sensible defaults for the `security-test` branch so the harness can be run
 * with no setup by the person who wired this up. Override via env vars to
 * point at a different branch later (per the README).
 */
export function loadConfig() {
  const url = process.env.SUPABASE_URL || "https://brwauxmdjgfrdqfbgezg.supabase.co";
  const anonKey =
    process.env.SUPABASE_ANON_KEY ||
    "sb_publishable_ziqvfBHcD_h0_eTF7D2eng_TbyZoCDj";
  const credsPath =
    process.env.STAGING_CREDENTIALS_PATH ||
    new URL("../../.env.staging-credentials.local", import.meta.url).pathname;

  if (!url || !anonKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_ANON_KEY (or their built-in defaults) are required."
    );
  }

  return { url: url.replace(/\/+$/, ""), anonKey, credsPath };
}

/**
 * Parses a simple KEY=VALUE env file (no quoting, no interpolation — matches
 * .env.staging-credentials.local) into an object. Never logs the file's
 * contents.
 */
export function readCredentials(path) {
  const text = readFileSync(path, "utf8");
  const out = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  for (const required of [
    "ADMIN_A_EMAIL",
    "ADMIN_A_PASSWORD",
    "ADMIN_B_EMAIL",
    "ADMIN_B_PASSWORD",
    "OWNER_A_EMAIL",
    "OWNER_A_PASSWORD",
  ]) {
    if (!out[required]) {
      throw new Error(`Missing ${required} in credentials file (${path}).`);
    }
  }
  return out;
}

// ----------------------------------------------------------------------------
// Low-level HTTP
// ----------------------------------------------------------------------------

/**
 * A thin fetch wrapper for Supabase's Auth / PostgREST / RPC / Storage REST
 * surfaces. Always sends `apikey`; sends `Authorization: Bearer <token>`
 * when a token is given, otherwise falls back to the anon key as the
 * bearer too (that's what an anonymous client does in practice).
 */
export async function request(cfg, path, { method = "GET", token, body, headers = {} } = {}) {
  const res = await fetch(`${cfg.url}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      apikey: cfg.anonKey,
      Authorization: `Bearer ${token || cfg.anonKey}`,
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, ok: res.ok, body: json, headers: res.headers };
}

// ----------------------------------------------------------------------------
// Auth: password sign-in, TOTP enrollment, step-up to AAL2
// ----------------------------------------------------------------------------

/** POST /auth/v1/token?grant_type=password. Returns an AAL1 session. */
export async function signInPassword(cfg, email, password) {
  const res = await request(cfg, "/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email, password },
  });
  if (!res.ok) {
    throw new Error(`sign-in failed for ${maskEmail(email)}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body; // { access_token, refresh_token, user, ... }
}

/** GET /auth/v1/factors — list this session's MFA factors. */
export async function listFactors(cfg, accessToken) {
  const res = await request(cfg, "/auth/v1/user", { token: accessToken });
  if (!res.ok) throw new Error(`listFactors failed: ${res.status}`);
  return res.body?.factors || [];
}

/** DELETE /auth/v1/factors/:id */
export async function unenrollFactor(cfg, accessToken, factorId) {
  return request(cfg, `/auth/v1/factors/${factorId}`, { method: "DELETE", token: accessToken });
}

/** POST /auth/v1/factors — enroll a fresh TOTP factor. */
export async function enrollTotp(cfg, accessToken, friendlyName) {
  const res = await request(cfg, "/auth/v1/factors", {
    method: "POST",
    token: accessToken,
    body: { factor_type: "totp", friendly_name: friendlyName },
  });
  if (!res.ok) {
    throw new Error(`enrollTotp failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  // body: { id, type, totp: { qr_code, secret, uri } }
  return res.body;
}

/** POST /auth/v1/factors/:id/challenge */
export async function challengeFactor(cfg, accessToken, factorId) {
  const res = await request(cfg, `/auth/v1/factors/${factorId}/challenge`, {
    method: "POST",
    token: accessToken,
  });
  if (!res.ok) throw new Error(`challengeFactor failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body; // { id: challengeId, expires_at }
}

/** POST /auth/v1/factors/:id/verify — on success, returns an AAL2 session. */
export async function verifyFactor(cfg, accessToken, factorId, challengeId, code) {
  const res = await request(cfg, `/auth/v1/factors/${factorId}/verify`, {
    method: "POST",
    token: accessToken,
    body: { challenge_id: challengeId, code },
  });
  if (!res.ok) throw new Error(`verifyFactor failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body; // { access_token, refresh_token, user, ... } — aal2
}

/**
 * Full flow: sign in with a password, clean up any leftover unverified
 * factors from a previous aborted run, enroll a brand-new TOTP factor,
 * compute the code ourselves, verify it, and return both the AAL1 and
 * AAL2 access tokens plus a cleanup() to remove the factor again so
 * re-running this harness doesn't pile up factors on the throwaway
 * accounts.
 */
export async function getAal1AndAal2(cfg, email, password, label) {
  const aal1 = await signInPassword(cfg, email, password);

  // Clean up unverified factors from any previous interrupted run.
  const existing = await listFactors(cfg, aal1.access_token);
  for (const f of existing) {
    if (f.status !== "verified" && String(f.friendly_name || "").startsWith("security-test-")) {
      await unenrollFactor(cfg, aal1.access_token, f.id);
    }
  }

  const friendlyName = `security-test-${label}-${Date.now()}`;
  const enrolled = await enrollTotp(cfg, aal1.access_token, friendlyName);
  const secret = enrolled.totp?.secret;
  if (!secret) throw new Error("enrollTotp did not return a TOTP secret");

  const challenge = await challengeFactor(cfg, aal1.access_token, enrolled.id);
  const code = totpCode(secret);
  const aal2 = await verifyFactor(cfg, aal1.access_token, enrolled.id, challenge.id, code);

  return {
    aal1Token: aal1.access_token,
    aal2Token: aal2.access_token,
    factorId: enrolled.id,
    userId: aal1.user?.id,
    async cleanup() {
      // Use the aal2 token — Supabase requires step-up to remove a verified
      // factor in some configurations; aal1 is accepted in others. Try aal2
      // first, fall back to aal1.
      let res = await unenrollFactor(cfg, aal2.access_token, enrolled.id);
      if (!res.ok) {
        res = await unenrollFactor(cfg, aal1.access_token, enrolled.id);
      }
      return res;
    },
  };
}

function maskEmail(email) {
  const [user, domain] = String(email).split("@");
  if (!domain) return "***";
  return `${user.slice(0, 2)}***@${domain}`;
}

// ----------------------------------------------------------------------------
// TOTP (RFC 6238) over HOTP (RFC 4226), SHA-1, 30s step, 6 digits — the
// Supabase/GoTrue default, matching any standard authenticator app.
// ----------------------------------------------------------------------------

function base32Decode(base32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = base32.replace(/=+$/, "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of clean) {
    const val = alphabet.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function hotp(secretBuffer, counter, digits = 6) {
  const counterBuffer = Buffer.alloc(8);
  // Big-endian 64-bit counter.
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", secretBuffer).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binCode % 10 ** digits).padStart(digits, "0");
}

/** Computes the current 6-digit TOTP code for a base32 secret, step=30s. */
export function totpCode(base32Secret, { step = 30, digits = 6, at = Date.now() } = {}) {
  const counter = Math.floor(at / 1000 / step);
  return hotp(base32Decode(base32Secret), counter, digits);
}

// ----------------------------------------------------------------------------
// PostgREST / RPC / Storage convenience wrappers
// ----------------------------------------------------------------------------

export function pgrest(cfg, token) {
  return {
    select: (table, query = "") =>
      request(cfg, `/rest/v1/${table}${query ? `?${query}` : ""}`, { token }),
    insert: (table, rows, { returning = "representation" } = {}) =>
      request(cfg, `/rest/v1/${table}`, {
        method: "POST",
        token,
        body: rows,
        headers: { Prefer: `return=${returning}` },
      }),
    update: (table, query, patch, { returning = "representation" } = {}) =>
      request(cfg, `/rest/v1/${table}?${query}`, {
        method: "PATCH",
        token,
        body: patch,
        headers: { Prefer: `return=${returning}` },
      }),
    delete: (table, query) =>
      request(cfg, `/rest/v1/${table}?${query}`, { method: "DELETE", token }),
    rpc: (fn, args = {}) =>
      request(cfg, `/rest/v1/rpc/${fn}`, { method: "POST", token, body: args }),
  };
}

export function storage(cfg, token) {
  return {
    list: (bucket, prefix = "") =>
      request(cfg, `/storage/v1/object/list/${bucket}`, {
        method: "POST",
        token,
        body: { prefix, limit: 100 },
      }),
    upload: (bucket, path, contents, contentType = "text/plain") =>
      fetch(`${cfg.url}/storage/v1/object/${bucket}/${path}`, {
        method: "POST",
        headers: {
          apikey: cfg.anonKey,
          Authorization: `Bearer ${token || cfg.anonKey}`,
          "Content-Type": contentType,
        },
        body: contents,
      }).then(async (res) => ({ status: res.status, ok: res.ok, body: await res.text() })),
    download: (bucket, path) =>
      fetch(`${cfg.url}/storage/v1/object/${bucket}/${path}`, {
        headers: { apikey: cfg.anonKey, Authorization: `Bearer ${token || cfg.anonKey}` },
      }).then(async (res) => ({ status: res.status, ok: res.ok, body: await res.text() })),
    remove: (bucket, paths) =>
      request(cfg, `/storage/v1/object/${bucket}`, {
        method: "DELETE",
        token,
        body: { prefixes: paths },
      }),
    createSignedUrl: (bucket, path, expiresIn = 60) =>
      request(cfg, `/storage/v1/object/sign/${bucket}/${path}`, {
        method: "POST",
        token,
        body: { expiresIn },
      }),
  };
}

// ----------------------------------------------------------------------------
// Small reporting helper used by attack-rls.mjs
// ----------------------------------------------------------------------------

export function makeReporter() {
  const results = [];
  return {
    results,
    pass(name, reason) {
      results.push({ name, result: "PASS", reason });
      console.log(`PASS  ${name} — ${reason}`);
    },
    fail(name, reason) {
      results.push({ name, result: "FAIL", reason });
      console.log(`FAIL  ${name} — ${reason}`);
    },
    skip(name, reason) {
      results.push({ name, result: "SKIP", reason });
      console.log(`SKIP  ${name} — ${reason}`);
    },
  };
}
