import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { cachedKeyFetcher, verifyPlaidWebhook, type PlaidJwk } from "@/lib/plaid/webhook-verify";
import { itemToFlag } from "@/lib/plaid/webhook-events";

const NOW = 1_800_000_000;
const b64 = (v: unknown) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

function setup() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "kid-1", alg: "ES256", use: "sig", expired_at: null } as PlaidJwk;
  const body = JSON.stringify({ webhook_type: "ITEM", webhook_code: "ERROR", item_id: "item-1" });
  const jwt = (opts: { alg?: string; iat?: number; body?: string; kid?: string; key?: typeof privateKey } = {}) => {
    const h = b64({ alg: opts.alg ?? "ES256", kid: opts.kid ?? "kid-1", typ: "JWT" });
    const p = b64({
      iat: opts.iat ?? NOW,
      request_body_sha256: createHash("sha256").update(opts.body ?? body).digest("hex"),
    });
    const sig = sign("sha256", Buffer.from(`${h}.${p}`), { key: opts.key ?? privateKey, dsaEncoding: "ieee-p1363" });
    return `${h}.${p}.${sig.toString("base64url")}`;
  };
  const fetchKey = vi.fn(async (kid: string) => (kid === "kid-1" ? jwk : null));
  const run = (header: string | null, rawBody = body, extra: Partial<Parameters<typeof verifyPlaidWebhook>[0]> = {}) =>
    verifyPlaidWebhook({ rawBody, verificationHeader: header, fetchKey, nowSeconds: NOW, ...extra });
  return { body, jwt, fetchKey, run, jwk };
}

describe("verifyPlaidWebhook", () => {
  it("accepts a correctly signed, fresh delivery", async () => {
    const { run, jwt } = setup();
    expect(await run(jwt())).toEqual({ ok: true });
  });

  it("rejects a tampered body", async () => {
    const { run, jwt, body } = setup();
    expect(await run(jwt(), body.replace("item-1", "item-2"))).toEqual({ ok: false, reason: "body_mismatch" });
  });

  it("rejects a stale iat, and one from the future", async () => {
    const { run, jwt } = setup();
    expect(await run(jwt({ iat: NOW - 301 }))).toEqual({ ok: false, reason: "stale" });
    expect(await run(jwt({ iat: NOW + 301 }))).toEqual({ ok: false, reason: "stale" });
    expect(await run(jwt({ iat: NOW - 299 }))).toEqual({ ok: true });
  });

  it("rejects any alg other than ES256, before fetching a key", async () => {
    const { run, jwt, fetchKey } = setup();
    for (const alg of ["none", "HS256", "RS256", "es256"]) {
      expect(await run(jwt({ alg }))).toEqual({ ok: false, reason: "bad_alg" });
    }
    expect(fetchKey).not.toHaveBeenCalled();
  });

  it("rejects a signature made with a different key", async () => {
    const { run, jwt } = setup();
    const other = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
    expect(await run(jwt({ key: other }))).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects an unknown kid and an expired key", async () => {
    const { run, jwt, jwk } = setup();
    expect(await run(jwt({ kid: "nope" }))).toEqual({ ok: false, reason: "unknown_key" });
    jwk.expired_at = NOW - 1;
    expect(await run(jwt())).toEqual({ ok: false, reason: "expired_key" });
  });

  it("reports a failed key fetch separately so the route can ask Plaid to retry", async () => {
    const { jwt, body } = setup();
    const r = await verifyPlaidWebhook({
      rawBody: body,
      verificationHeader: jwt(),
      fetchKey: async () => {
        throw new Error("network");
      },
      nowSeconds: NOW,
    });
    expect(r).toEqual({ ok: false, reason: "key_fetch_failed" });
  });

  it("rejects missing and malformed headers", async () => {
    const { run } = setup();
    expect(await run(null)).toEqual({ ok: false, reason: "missing_header" });
    expect(await run("abc")).toEqual({ ok: false, reason: "malformed" });
    expect(await run("a.b.c")).toEqual({ ok: false, reason: "malformed" });
    expect(await run("..")).toEqual({ ok: false, reason: "malformed" });
  });

  it("accepts a repeat delivery (verification is stateless; the flag is idempotent)", async () => {
    const { run, jwt } = setup();
    const header = jwt();
    expect(await run(header)).toEqual({ ok: true });
    expect(await run(header)).toEqual({ ok: true });
  });
});

describe("cachedKeyFetcher", () => {
  it("fetches once per kid within the ttl and remembers a miss only briefly (REVIEW-2 #13)", async () => {
    let t = 0;
    const key = { kty: "EC", crv: "P-256", x: "x", y: "y" } as PlaidJwk;
    const inner = vi.fn(async (kid: string) => (kid === "a" ? key : null));
    const get = cachedKeyFetcher(inner, { ttlSeconds: 10, missTtlSeconds: 60, nowSeconds: () => t });
    await get("a");
    await get("a");
    expect(inner).toHaveBeenCalledTimes(1);
    expect(await get("missing")).toBeNull();
    expect(await get("missing")).toBeNull();
    expect(inner).toHaveBeenCalledTimes(2); // the second miss never reached Plaid
    t = 11;
    await get("a");
    expect(inner).toHaveBeenCalledTimes(3);
    t = 61;
    await get("missing");
    expect(inner).toHaveBeenCalledTimes(4); // forgotten after the miss ttl
  });

  it("a flood of random kids makes one Plaid call each at most, and not more than the concurrency cap at once", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const inner = vi.fn(async () => {
      await gate;
      return null;
    });
    const get = cachedKeyFetcher(inner, { maxConcurrent: 2 });
    const p1 = get("k1");
    const p2 = get("k2");
    await expect(get("k3")).rejects.toThrow();
    expect(inner).toHaveBeenCalledTimes(2);
    release();
    await Promise.all([p1, p2]);
    await get("k1");
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it("two calls for the same kid share one request", async () => {
    const inner = vi.fn(async () => null);
    const get = cachedKeyFetcher(inner);
    await Promise.all([get("same"), get("same"), get("same")]);
    expect(inner).toHaveBeenCalledTimes(1);
  });
});

describe("itemToFlag (the allow-list)", () => {
  const ev = (webhook_code: string, extra: Record<string, unknown> = {}) => ({
    webhook_type: "ITEM",
    webhook_code,
    item_id: "item-1",
    ...extra,
  });
  it("acts on the four item events", () => {
    expect(itemToFlag(ev("ERROR", { error: { error_code: "ITEM_LOGIN_REQUIRED" } }))).toBe("item-1");
    expect(itemToFlag(ev("PENDING_DISCONNECT"))).toBe("item-1");
    expect(itemToFlag(ev("USER_PERMISSION_REVOKED"))).toBe("item-1");
    expect(itemToFlag(ev("USER_ACCOUNT_REVOKED"))).toBe("item-1");
  });
  it("ignores everything else", () => {
    expect(itemToFlag(ev("ERROR", { error: { error_code: "INTERNAL_SERVER_ERROR" } }))).toBeNull();
    expect(itemToFlag(ev("ERROR"))).toBeNull();
    expect(itemToFlag(ev("LOGIN_REPAIRED"))).toBeNull();
    expect(itemToFlag(ev("NEW_ACCOUNTS_AVAILABLE"))).toBeNull();
    expect(itemToFlag({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "item-1" })).toBeNull();
    expect(itemToFlag(null)).toBeNull();
    expect(itemToFlag("x")).toBeNull();
  });
  it("refuses an item id that is not shaped like one", () => {
    expect(itemToFlag(ev("PENDING_DISCONNECT", { item_id: "a b" }))).toBeNull();
    expect(itemToFlag(ev("PENDING_DISCONNECT", { item_id: "x".repeat(200) }))).toBeNull();
    expect(itemToFlag(ev("PENDING_DISCONNECT", { item_id: 5 }))).toBeNull();
  });
});
