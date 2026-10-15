import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const serviceRpc = vi.fn();
vi.mock("@/lib/email-outbox/service-rpc", () => ({ serviceRpc: (...a: unknown[]) => serviceRpc(...(a as [])) }));
const runSender = vi.fn();
vi.mock("@/lib/email-outbox/send-batch", async (orig) => ({ ...(await orig<typeof import("@/lib/email-outbox/send-batch")>()), runSender: (...a: unknown[]) => runSender(...(a as [])) }));
vi.mock("@/lib/email-outbox/deps", () => ({ senderSite: { siteUrl: "https://www.walkuphoa.com", legalEntity: "DS Collective LLC", legalAddress: "1 Example St" } }));
vi.mock("@/lib/site-config", async (orig) => ({ ...(await orig<typeof import("@/lib/site-config")>()), LEGAL_ADDRESS: "1 Example Street, Chicago, IL 60601" }));
const anonRpc = vi.fn();
const anonClient = vi.fn(() => ({ rpc: anonRpc }));
vi.mock("@supabase/supabase-js", () => ({ createClient: (...a: unknown[]) => anonClient(...(a as [])) }));

import { GET as cron } from "@/app/api/cron/email-reminders/route";
import { POST as webhook } from "@/app/api/email/webhook/route";
import { GET as oneClickGet, POST as oneClickPost } from "@/app/unsubscribe/[token]/one-click/route";

const req = (url: string, init: RequestInit = {}) => new Request(url, init) as unknown as import("next/server").NextRequest;
const KEY = Buffer.from("walkup-webhook-key-0123456789abcdef");
const SECRET = `whsec_${KEY.toString("base64")}`;

function signed(body: unknown, over: { id?: string; ts?: number; secret?: Buffer } = {}) {
  const raw = JSON.stringify(body);
  const id = over.id ?? "msg_1";
  const ts = String(over.ts ?? Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", over.secret ?? KEY).update(`${id}.${ts}.${raw}`).digest("base64");
  return req("https://www.walkuphoa.com/api/email/webhook", {
    method: "POST",
    body: raw,
    headers: { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${sig}`, "content-type": "application/json" },
  });
}

beforeEach(() => {
  serviceRpc.mockReset();
  runSender.mockReset();
  anonRpc.mockReset();
  anonClient.mockClear();
  process.env.CRON_SECRET = "cron-secret";
  process.env.RESEND_API_KEY = "re_test";
  process.env.RESEND_WEBHOOK_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  delete process.env.EMAIL_SENDING_DISABLED;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/cron/email-reminders", () => {
  const call = (auth?: string) => cron(req("https://www.walkuphoa.com/api/cron/email-reminders", { headers: auth ? { authorization: auth } : {} }));

  it("500s without CRON_SECRET and 401s without the bearer, touching nothing", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("Bearer x")).status).toBe(500);
    process.env.CRON_SECRET = "cron-secret";
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect((await call("cron-secret")).status).toBe(401);
    expect(serviceRpc).not.toHaveBeenCalled();
    expect(runSender).not.toHaveBeenCalled();
  });

  it("skips quietly when sending is not set up", async () => {
    delete process.env.RESEND_API_KEY;
    const res = await call("Bearer cron-secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ skipped: "no_key" });
    expect(serviceRpc).not.toHaveBeenCalled();
  });

  it("runs the rules, sends, purges, and reports counts only", async () => {
    serviceRpc.mockImplementation(async (name: string) =>
      name === "email_run_rules" ? { data: [{ association_id: "a", batch_id: "b", queued: 2 }], error: null } : { data: 4, error: null },
    );
    runSender.mockResolvedValue({ sent: 2, failed: 0, skipped: 0, remaining: false, stoppedBecause: "empty" });
    const res = await call("Bearer cron-secret");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ rules: [{ queued: 2 }], sent: 2, failed: 0, remaining: false, stoppedBecause: "empty", purged: 4 });
    expect(JSON.stringify(body)).not.toMatch(/example|@|batch_id|association_id/);
    expect(serviceRpc).toHaveBeenCalledWith("email_run_rules", { p_today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(serviceRpc).toHaveBeenCalledWith("email_purge", { p_months: 24 });
    expect(runSender).toHaveBeenCalledWith(expect.objectContaining({ batchId: null, maxMessages: 150, budgetMs: 240_000 }));
  });

  it("500s, without sending, when the rules cannot run", async () => {
    serviceRpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    const res = await call("Bearer cron-secret");
    expect(res.status).toBe(500);
    expect(runSender).not.toHaveBeenCalled();
  });
});

describe("POST /api/email/webhook", () => {
  it("500s when the signing secret is not configured", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    expect((await webhook(signed({ type: "email.delivered", data: { email_id: "re_1" } }))).status).toBe(500);
    expect(serviceRpc).not.toHaveBeenCalled();
  });

  it("400s a bad signature, an old timestamp and a missing header with no database call", async () => {
    const body = { type: "email.delivered", data: { email_id: "re_1" } };
    expect((await webhook(signed(body, { secret: Buffer.from("other") }))).status).toBe(400);
    expect((await webhook(signed(body, { ts: Math.floor(Date.now() / 1000) - 3600 }))).status).toBe(400);
    expect((await webhook(req("https://www.walkuphoa.com/api/email/webhook", { method: "POST", body: JSON.stringify(body) }))).status).toBe(400);
    const tampered = signed(body);
    const res = await webhook(req("https://www.walkuphoa.com/api/email/webhook", { method: "POST", body: JSON.stringify({ ...body, type: "email.bounced" }), headers: Object.fromEntries(tampered.headers.entries()) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid signature" });
    expect(serviceRpc).not.toHaveBeenCalled();
  });

  it("records a delivery", async () => {
    serviceRpc.mockResolvedValue({ data: "delivered", error: null });
    const res = await webhook(signed({ type: "email.delivered", data: { email_id: "re_1" } }, { id: "msg_9" }));
    expect(res.status).toBe(200);
    expect(serviceRpc).toHaveBeenCalledWith("email_record_event", { p_provider_message_id: "re_1", p_event: "email.delivered", p_detail: "", p_svix_id: "msg_9", p_permanent: true });
  });

  it("marks only a Permanent bounce as permanent and scrubs the address from the detail", async () => {
    serviceRpc.mockResolvedValue({ data: "bounced", error: null });
    await webhook(signed({ type: "email.bounced", data: { email_id: "re_1", bounce: { type: "Permanent", message: "550 <ada@example.test> no such user" } } }));
    expect(serviceRpc).toHaveBeenLastCalledWith("email_record_event", expect.objectContaining({ p_permanent: true, p_detail: "550 <[address]> no such user" }));
    await webhook(signed({ type: "email.bounced", data: { email_id: "re_1", bounce: { type: "Transient", message: "mailbox full" } } }));
    expect(serviceRpc).toHaveBeenLastCalledWith("email_record_event", expect.objectContaining({ p_permanent: false }));
    await webhook(signed({ type: "email.bounced", data: { email_id: "re_1", bounce: { type: "Undetermined" } } }));
    expect(serviceRpc).toHaveBeenLastCalledWith("email_record_event", expect.objectContaining({ p_permanent: false }));
  });

  it("answers 200 and does nothing for events it does not record", async () => {
    for (const body of [{ type: "email.opened", data: { email_id: "re_1" } }, { type: "email.delivered", data: {} }, { type: "email.sent" }]) {
      const res = await webhook(signed(body));
      expect(res.status).toBe(200);
    }
    expect(serviceRpc).not.toHaveBeenCalled();
    const junk = req("https://www.walkuphoa.com/api/email/webhook", { method: "POST", body: "not json", headers: {} });
    expect((await webhook(junk)).status).toBe(400); // unsigned
  });

  it("500s when the database call fails so Resend retries", async () => {
    serviceRpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    expect((await webhook(signed({ type: "email.complained", data: { email_id: "re_1" } }))).status).toBe(500);
  });
});

describe("/unsubscribe/[token]/one-click", () => {
  const token = "a".repeat(96);
  const ctx = (t: string) => ({ params: Promise.resolve({ token: t }) });

  it("unsubscribes from everything with the anon key and no session", async () => {
    anonRpc.mockResolvedValue({ data: true, error: null });
    const res = await oneClickPost(req(`https://www.walkuphoa.com/unsubscribe/${token}/one-click`, { method: "POST", body: "List-Unsubscribe=One-Click" }), ctx(token));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(anonRpc).toHaveBeenCalledWith("email_unsubscribe", { p_token: token, p_scope: "all", p_subscribe: false });
    expect(anonClient).toHaveBeenCalledWith("https://x.supabase.test", "anon-key", { auth: { persistSession: false, autoRefreshToken: false } });
  });

  it("answers 200 for a token that is not valid, without calling the database", async () => {
    const res = await oneClickPost(req("https://www.walkuphoa.com/unsubscribe/nope/one-click", { method: "POST" }), ctx("nope"));
    expect(res.status).toBe(200);
    expect(anonRpc).not.toHaveBeenCalled();
  });

  it("answers 200 for a well formed token that matches nobody, so validity does not leak", async () => {
    anonRpc.mockResolvedValue({ data: false, error: null });
    const res = await oneClickPost(req(`https://www.walkuphoa.com/unsubscribe/${token}/one-click`, { method: "POST" }), ctx(token));
    expect(res.status).toBe(200);
  });

  it("changes nothing on GET: it redirects to the page", async () => {
    const res = await oneClickGet(req(`https://www.walkuphoa.com/unsubscribe/${token}/one-click`), ctx(token));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`https://www.walkuphoa.com/unsubscribe/${token}`);
    expect(anonRpc).not.toHaveBeenCalled();
  });
});
