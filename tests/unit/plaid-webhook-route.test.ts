import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpc = vi.fn();
const keyGet = vi.fn();
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => ({ rpc })) }));

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k", alg: "ES256", expired_at: null };
vi.mock("@/lib/plaid", async (orig) => ({
  ...(await orig<typeof import("@/lib/plaid")>()),
  plaidClient: () => ({ webhookVerificationKeyGet: keyGet }),
}));

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
function signed(body: string, over: { iat?: number; alg?: string } = {}) {
  const h = b64({ alg: over.alg ?? "ES256", kid: "k" });
  const p = b64({
    iat: over.iat ?? Math.floor(Date.now() / 1000),
    request_body_sha256: createHash("sha256").update(body).digest("hex"),
  });
  const s = sign("sha256", Buffer.from(`${h}.${p}`), { key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${h}.${p}.${s.toString("base64url")}`;
}
const post = async (body: string, header: string | null) => {
  const { POST } = await import("@/app/api/plaid/webhook/route");
  return POST(new Request("http://x/api/plaid/webhook", {
    method: "POST",
    body,
    headers: header ? { "plaid-verification": header } : {},
  }) as never);
};
const item = (code: string, extra = {}) => JSON.stringify({ webhook_type: "ITEM", webhook_code: code, item_id: "item-1", ...extra });

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: 1, error: null });
  keyGet.mockReset().mockResolvedValue({ data: { key: jwk } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/plaid/webhook", () => {
  it("flags the item for a verified PENDING_DISCONNECT", async () => {
    const body = item("PENDING_DISCONNECT");
    const res = await post(body, signed(body));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("flag_bank_item_for_attention", { p_item_id: "item-1" });
  });

  it("401s a tampered body, a stale delivery and a wrong alg, and never touches the database", async () => {
    const body = item("PENDING_DISCONNECT");
    expect((await post(body + " ", signed(body))).status).toBe(401);
    expect((await post(body, signed(body, { iat: Math.floor(Date.now() / 1000) - 600 }))).status).toBe(401);
    expect((await post(body, signed(body, { alg: "HS256" }))).status).toBe(401);
    expect((await post(body, null)).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("200s and does nothing for events outside the allow-list", async () => {
    const body = JSON.stringify({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "item-1" });
    expect((await post(body, signed(body))).status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("treats an unknown item id and a repeat delivery as a 200 no-op", async () => {
    rpc.mockResolvedValue({ data: 0, error: null });
    const body = item("USER_PERMISSION_REVOKED");
    const header = signed(body);
    expect((await post(body, header)).status).toBe(200);
    expect((await post(body, header)).status).toBe(200);
  });

  it("asks Plaid to retry when the database call or key fetch fails", async () => {
    const body = item("ERROR", { error: { error_code: "ITEM_LOGIN_REQUIRED" } });
    rpc.mockResolvedValue({ data: null, error: { code: "XX000" } });
    expect((await post(body, signed(body))).status).toBe(500);
    keyGet.mockRejectedValue(new Error("network"));
    // key is cached from the earlier calls in this module; a new kid forces a fetch
    const h = b64({ alg: "ES256", kid: "other" });
    expect((await post(body, `${h}.${b64({ iat: 1, request_body_sha256: "0".repeat(64) })}.${Buffer.alloc(64).toString("base64url")}`)).status).toBe(503);
  });

  it("logs no body content", async () => {
    const info = vi.mocked(console.info);
    const body = item("PENDING_DISCONNECT", { error: { error_message: "SECRET-TEXT" } });
    await post(body, signed(body));
    expect(JSON.stringify(info.mock.calls)).not.toContain("SECRET-TEXT");
  });
});
