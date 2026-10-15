import { describe, expect, it, vi } from "vitest";
import { sendViaResend, type ResendSend } from "@/lib/email-outbox/resend";

const msg: ResendSend = {
  from: '"Walkup on behalf of 2158 N. Damen" <notifications@walkuphoa.com>',
  to: "ada@example.test",
  replyTo: "board@example.test",
  subject: "Dues reminder: Unit 1 has a balance of $500.00",
  text: "Hi Ada, secret body text",
  html: "<p>Hi Ada, secret body text</p>",
  headers: { "List-Unsubscribe": "<https://www.walkuphoa.com/unsubscribe/t/one-click>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  tags: [{ name: "kind", value: "dues_reminder" }, { name: "association", value: "11111111-1111-1111-1111-111111111111" }],
  idempotencyKey: "wk-abc",
  attachments: [{ filename: "Statement.pdf", content: "JVBERg==" }],
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } }));

describe("sendViaResend", () => {
  it("posts one recipient with the idempotency key, reply_to as an array and the list-unsubscribe headers", async () => {
    const fetchMock = vi.fn(() => json(200, { id: "re_123" }));
    const r = await sendViaResend("re_key", msg, fetchMock as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, id: "re_123" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_key");
    expect(headers["Idempotency-Key"]).toBe("wk-abc");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body.to).toEqual(["ada@example.test"]);
    expect(body.reply_to).toEqual(["board@example.test"]);
    expect(body.from).toBe(msg.from);
    expect(body.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(body.attachments).toEqual([{ filename: "Statement.pdf", content: "JVBERg==" }]);
    expect(body.tags).toEqual([{ name: "kind", value: "dues_reminder" }, { name: "association", value: "11111111-1111-1111-1111-111111111111" }]);
    expect(init.signal).toBeDefined();
  });

  it("omits attachments when there are none and cleans tags", async () => {
    const fetchMock = vi.fn(() => json(200, { id: "re_1" }));
    await sendViaResend("k", { ...msg, attachments: undefined, tags: [{ name: "k ind", value: "a,b\r\n" }] }, fetchMock as unknown as typeof fetch);
    const body = JSON.parse(((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body) as string);
    expect(body.attachments).toBeUndefined();
    expect(body.tags).toEqual([{ name: "k_ind", value: "a_b__" }]);
  });

  it("treats 429 as retryable and reads retry-after in seconds", async () => {
    const r = await sendViaResend("k", msg, (() => json(429, { name: "rate_limit_exceeded", message: "Too many requests" }, { "retry-after": "3" })) as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, retryable: true, status: 429, message: "Too many requests", retryAfterMs: 3000 });
  });

  it("treats 5xx and network errors and timeouts as retryable", async () => {
    const five = await sendViaResend("k", msg, (() => json(503, { message: "down" })) as unknown as typeof fetch);
    expect(five).toMatchObject({ ok: false, retryable: true, status: 503 });
    const net = await sendViaResend("k", msg, (() => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch);
    expect(net).toMatchObject({ ok: false, retryable: true, status: 0 });
    const timeout = await sendViaResend("k", msg, (() => Promise.reject(Object.assign(new Error("t"), { name: "TimeoutError" }))) as unknown as typeof fetch);
    expect(timeout).toMatchObject({ ok: false, retryable: true, status: 0, message: "The email service took too long to answer." });
  });

  it("does not retry validation or key errors", async () => {
    for (const status of [400, 401, 403, 404, 422]) {
      const r = await sendViaResend("k", msg, (() => json(status, { name: "validation_error", message: "Invalid `to` field" })) as unknown as typeof fetch);
      expect(r, String(status)).toMatchObject({ ok: false, retryable: false, status });
    }
  });

  it("retries a concurrent idempotent request but never a reused key with a different body", async () => {
    const busy = await sendViaResend("k", msg, (() => json(409, { name: "concurrent_idempotent_requests", message: "in flight" })) as unknown as typeof fetch);
    expect(busy).toMatchObject({ retryable: true });
    const reused = await sendViaResend("k", msg, (() => json(409, { name: "invalid_idempotent_request", message: "different payload" })) as unknown as typeof fetch);
    expect(reused).toMatchObject({ retryable: false });
  });

  it("cuts Resend's message to 300 characters and never repeats the email body", async () => {
    const r = await sendViaResend("k", msg, (() => json(422, { message: "x".repeat(900) })) as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toHaveLength(300);
      expect(r.message).not.toContain("secret body text");
    }
    const net = await sendViaResend("k", msg, (() => Promise.reject(new Error("boom with secret body text"))) as unknown as typeof fetch);
    if (!net.ok) expect(net.message).not.toContain("secret");
  });

  it("treats a success with no id as a retryable failure rather than losing the message", async () => {
    const r = await sendViaResend("k", msg, (() => json(200, {})) as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: false, retryable: true });
  });
});
