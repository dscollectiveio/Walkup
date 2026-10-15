// Regression tests for docs/security/REVIEW-2-server.md findings 12, 13, 20 and 23.
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let signedIn: { id: string } | null = { id: "user-1" };
vi.mock("@/lib/supabase/server", () => ({ getUser: async () => signedIn }));
const { googleResolve, suggestAddresses } = vi.hoisted(() => ({
  googleResolve: vi.fn(async () => ({ street: "1 Main St" })),
  suggestAddresses: vi.fn(async () => []),
}));
vi.mock("@/lib/address/suggest", () => ({ googleResolve, suggestAddresses }));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/address/route";
import { resetRateLimits, takeToken } from "@/lib/security/rate-limit";
import { verifyPlaidWebhook } from "@/lib/plaid/webhook-verify";

const get = (qs: string) => GET(new NextRequest(`http://localhost/api/address?${qs}`));

beforeEach(() => {
  resetRateLimits();
  signedIn = { id: "user-1" };
  googleResolve.mockClear();
  suggestAddresses.mockClear();
});

describe("12. /api/address has a per-person ceiling", () => {
  it("answers 429 with Retry-After after 30 calls in a minute, per person", async () => {
    for (let i = 0; i < 30; i++) expect((await get("q=2158+n+dam")).status).toBe(200);
    const blocked = await get("q=2158+n+dam");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(suggestAddresses).toHaveBeenCalledTimes(30);
    signedIn = { id: "user-2" };
    expect((await get("q=2158+n+dam")).status).toBe(200);
  });

  it("refuses a place id that is not id-shaped before spending a Google call", async () => {
    expect((await get(`id=${"a".repeat(301)}`)).status).toBe(400);
    expect((await get("id=a/b?c")).status).toBe(400);
    expect(googleResolve).not.toHaveBeenCalled();
    expect((await get("id=ChIJabc_-123")).status).toBe(200);
  });

  it("still needs a signed-in user", async () => {
    signedIn = null;
    expect((await get("q=x")).status).toBe(401);
  });

  it("takeToken counts a window and starts a new one", () => {
    expect(takeToken("k", 2, 1000, 0)).toEqual({ ok: true });
    expect(takeToken("k", 2, 1000, 1)).toEqual({ ok: true });
    expect(takeToken("k", 2, 1000, 2)).toMatchObject({ ok: false });
    expect(takeToken("k", 2, 1000, 1001)).toEqual({ ok: true });
  });
});

describe("13. a forged Plaid-Verification header cannot choose any key id", () => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const fetchKey = vi.fn(async () => null);
  const run = (kid: unknown) =>
    verifyPlaidWebhook({
      rawBody: "{}",
      verificationHeader: `${b64({ alg: "ES256", kid })}.${b64({ iat: 1 })}.${Buffer.alloc(64).toString("base64url")}`,
      fetchKey,
      nowSeconds: 1,
    });

  it("rejects a kid that is not a plain id without calling Plaid", async () => {
    for (const kid of ["../x", "a b", "x".repeat(65), "a\nb", 5, ""]) {
      expect(await run(kid)).toEqual({ ok: false, reason: "malformed" });
    }
    expect(fetchKey).not.toHaveBeenCalled();
  });
});

describe("20 and 23. the email migration", () => {
  const sql = readFileSync(path.resolve(__dirname, "../../supabase/migrations/0055_email_reminders.sql"), "utf8");
  const fn = (name: string) => {
    const start = sql.indexOf(`create or replace function public.${name}(`);
    expect(start, name).toBeGreaterThan(-1);
    return sql.slice(start, sql.indexOf("\n$$;", start) > -1 ? sql.indexOf("\n$$;", start) : sql.indexOf("end $$;", start));
  };

  it("a standing rule runs only while the person who enabled it is still an active board admin", () => {
    const body = fn("email_run_rules");
    expect(body).toMatch(/from public\.role_grants g join public\.persons gp on gp\.id = g\.person_id/);
    expect(body).toMatch(/gp\.auth_user_id = r\.enabled_by/);
    expect(body).toMatch(/g\.role = 'board_admin' and g\.revoked_at is null/);
    expect(body).toMatch(/g\.expires_on is null or g\.expires_on >= p_today/);
  });

  it("only a bounce can be cleared; a spam complaint stays", () => {
    const body = fn("email_clear_suppression");
    expect(body).toMatch(/reason = 'bounce'/);
  });
});
