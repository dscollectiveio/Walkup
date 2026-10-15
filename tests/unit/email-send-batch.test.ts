import { afterEach, describe, expect, it, vi } from "vitest";
import { runSender, type ClaimedRow, type SenderDeps } from "@/lib/email-outbox/send-batch";
import type { ResendResult, ResendSend } from "@/lib/email-outbox/resend";

const config = { ok: true as const, apiKey: "re_key", from: "notifications@walkuphoa.com" };
const site = { siteUrl: "https://www.walkuphoa.com", legalEntity: "DS Collective LLC", legalAddress: "1 Example St, Chicago, IL 60601" };
const UNIT = "aaaa1111-0000-0000-0000-000000000001";
const unitFacts = {
  unit_id: UNIT, label: "Unit 1", as_of: "2026-10-14", owed: "500.00", overdue: "500.00", credit: "0.00", net: "500.00",
  oldest_overdue_on: "2026-01-01", lines: [{ due_on: "2026-01-01", label: "Dues for January 2026", balance: "500.00" }],
};

let n = 0;
function row(over: Partial<ClaimedRow> = {}): ClaimedRow {
  n += 1;
  return {
    outbox_id: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
    claim_token: `11111111-1111-1111-1111-${String(n).padStart(12, "0")}`,
    association_id: "11111111-1111-1111-1111-111111111111",
    kind: "dues_reminder",
    to_email: "ada@example.test",
    to_name: "Ada Okonkwo",
    facts: { units: [unitFacts] },
    board_note: null,
    template_key: "dues_reminder",
    template_version: 1,
    idempotency_key: `wk-${n}`,
    attempts: 1,
    unsubscribe_token: "t".repeat(96),
    association_name: "2158 N. Damen",
    reply_to_email: "board@example.test",
    reply_to_name: "Cy Ferreira",
    batch_id: "22222222-2222-2222-2222-222222222222",
    has_login: true,
    ...over,
  };
}

function harness(opts: { batches?: ClaimedRow[][]; send?: (m: ResendSend) => Promise<ResendResult>; pdf?: SenderDeps["loadStatementPdf"]; markSentError?: boolean; announcement?: Awaited<ReturnType<SenderDeps["loadAnnouncement"]>> } = {}) {
  const queue = [...(opts.batches ?? [])];
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const sent: ResendSend[] = [];
  const sleeps: number[] = [];
  let clock = 0;
  const deps: SenderDeps = {
    rpc: (async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "email_claim") return { data: queue.shift() ?? [], error: null };
      if (name === "email_mark_sent" && opts.markSentError) return { data: null, error: { message: "boom" } };
      return { data: null, error: null };
    }) as SenderDeps["rpc"],
    loadAnnouncement: async () => opts.announcement ?? null,
    loadStatementPdf: opts.pdf ?? (async () => new Uint8Array([37, 80, 68, 70])),
    send: async (m) => {
      sent.push(m);
      return opts.send ? opts.send(m) : { ok: true, id: `re_${sent.length}` };
    },
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
    today: () => "2026-10-14",
  };
  return { deps, calls, sent, sleeps, advance: (ms: number) => (clock += ms) };
}

const named = <T extends { name: string }>(calls: T[], name: string): T[] => calls.filter((c) => c.name === name);

afterEach(() => vi.restoreAllMocks());

describe("runSender", () => {
  it("claims, sends in order with the interval, then records each send", async () => {
    const a = row({ to_email: "a@example.test" });
    const b = row({ to_email: "b@example.test" });
    const h = harness({ batches: [[a, b]] });
    const out = await runSender({ batchId: "B", deps: h.deps, config, site });
    expect(out).toMatchObject({ sent: 2, failed: 0, remaining: false, stoppedBecause: "empty" });
    expect(h.sent.map((m) => m.to)).toEqual(["a@example.test", "b@example.test"]);
    expect(h.sleeps).toEqual([600, 600]);
    expect(named(h.calls, "email_claim")[0].args).toEqual({ p_batch_id: "B", p_limit: 10 });
    const marks = named(h.calls, "email_mark_sent");
    expect(marks).toHaveLength(2);
    expect(marks[0].args).toMatchObject({ p_outbox_id: a.outbox_id, p_claim_token: a.claim_token, p_provider_message_id: "re_1" });
    // record happens after the send
    expect(h.calls.map((c) => c.name)).toEqual(["email_claim", "email_mark_sent", "email_mark_sent", "email_claim"]);
  });

  it("builds a complete message: from, reply-to, headers, tags, idempotency key", async () => {
    const r = row();
    const h = harness({ batches: [[r]] });
    await runSender({ batchId: null, deps: h.deps, config, site });
    const m = h.sent[0];
    expect(m.from).toBe('"Walkup on behalf of 2158 N. Damen" <notifications@walkuphoa.com>');
    expect(m.replyTo).toBe("board@example.test");
    expect(m.idempotencyKey).toBe(r.idempotency_key);
    expect(m.headers["List-Unsubscribe"]).toBe(`<https://www.walkuphoa.com/unsubscribe/${"t".repeat(96)}/one-click>`);
    expect(m.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(m.tags).toEqual([
      { name: "kind", value: "dues_reminder" },
      { name: "association", value: r.association_id },
      { name: "batch", value: r.batch_id },
    ]);
    expect(m.text).toContain("Hi Ada,");
    expect(m.html).toContain("<p");
  });

  it("does not resend when recording the send fails", async () => {
    const h = harness({ batches: [[row()]], markSentError: true });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await runSender({ batchId: "B", deps: h.deps, config, site });
    expect(out.sent).toBe(1);
    expect(h.sent).toHaveLength(1);
    expect(err).toHaveBeenCalledWith("[walkup-email] sent but not recorded", expect.any(String));
  });

  it("marks a validation error failed and not retryable, and keeps going", async () => {
    const h = harness({
      batches: [[row({ to_email: "a@example.test" }), row({ to_email: "b@example.test" })]],
      send: async (m) => (m.to === "a@example.test" ? { ok: false, retryable: false, status: 422, message: "Invalid to" } : { ok: true, id: "re_b" }),
    });
    const out = await runSender({ batchId: "B", deps: h.deps, config, site });
    expect(out).toMatchObject({ sent: 1, failed: 1 });
    expect(named(h.calls, "email_mark_failed")[0].args).toMatchObject({ p_error: "Invalid to", p_retryable: false });
  });

  it("marks a 5xx retryable, and honours a short retry-after", async () => {
    const h = harness({ batches: [[row()]], send: async () => ({ ok: false, retryable: true, status: 429, message: "slow down", retryAfterMs: 2000 }) });
    await runSender({ batchId: "B", deps: h.deps, config, site });
    expect(named(h.calls, "email_mark_failed")[0].args).toMatchObject({ p_retryable: true });
    expect(h.sleeps).toContain(2000);
  });

  it("stops at once when retry-after is longer than 30 seconds", async () => {
    const h = harness({ batches: [[row(), row()]], send: async () => ({ ok: false, retryable: true, status: 429, message: "slow", retryAfterMs: 120_000 }) });
    const out = await runSender({ batchId: "B", deps: h.deps, config, site });
    expect(out).toMatchObject({ stoppedBecause: "fatal", remaining: true });
    expect(h.sent).toHaveLength(1);
  });

  it("stops the loop when Resend rejects the key and leaves the other messages queued", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness({ batches: [[row(), row()]], send: async () => ({ ok: false, retryable: false, status: 401, message: "API key is invalid" }) });
    const out = await runSender({ batchId: "B", deps: h.deps, config, site });
    expect(out).toMatchObject({ stoppedBecause: "fatal", remaining: true });
    expect(h.sent).toHaveLength(1);
    const failed = named(h.calls, "email_mark_failed");
    expect(failed).toHaveLength(1);
    expect(String(failed[0].args.p_error)).toMatch(/^rejected_key/);
    expect(failed[0].args.p_retryable).toBe(true);
    expect(err).toHaveBeenCalledWith("[walkup-email] rejected_key");
  });

  it("stops at the time budget and at the message limit", async () => {
    const h = harness({ batches: [[row()], [row()], [row()]] });
    const timed = await runSender({ batchId: "B", deps: h.deps, config, site, budgetMs: 1000 });
    expect(timed.stoppedBecause).toBe("time");
    expect(timed.remaining).toBe(true);
    expect(timed.sent).toBe(2); // 600 ms each: the second send ends at 1200 ms

    const h2 = harness({ batches: [[row(), row()], [row()]] });
    const limited = await runSender({ batchId: null, deps: h2.deps, config, site, maxMessages: 2 });
    expect(limited.sent).toBe(2);
    expect(limited.stoppedBecause).toBe("time");
    expect(named(h2.calls, "email_claim")[0].args).toMatchObject({ p_limit: 2 });
  });

  it("stops when the claim itself fails", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness();
    h.deps.rpc = (async () => ({ data: null, error: { code: "42501", message: "not allowed" } })) as SenderDeps["rpc"];
    const out = await runSender({ batchId: "B", deps: h.deps, config, site });
    expect(out).toMatchObject({ stoppedBecause: "fatal", remaining: true, sent: 0 });
    expect(err).toHaveBeenCalledWith("[walkup-email] claim_failed", "42501");
  });

  it("fails a message with unreadable facts without retrying", async () => {
    const h = harness({ batches: [[row({ facts: { units: [{ bad: 1 }] } })]] });
    const out = await runSender({ batchId: "B", deps: h.deps, config, site });
    expect(out).toMatchObject({ sent: 0, failed: 1 });
    expect(named(h.calls, "email_mark_failed")[0].args).toMatchObject({
      p_error: "The saved details for this email could not be read.",
      p_retryable: false,
    });
    expect(h.sent).toHaveLength(0);
  });

  it("fails an unknown template without sending", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness({ batches: [[row({ template_version: 9 })]] });
    await runSender({ batchId: "B", deps: h.deps, config, site });
    expect(named(h.calls, "email_mark_failed")[0].args).toMatchObject({ p_retryable: false });
    expect(h.sent).toHaveLength(0);
  });

  it("attaches one PDF per unit to a statement and fails retryably when one cannot be built", async () => {
    const U2 = "aaaa1111-0000-0000-0000-000000000002";
    const stmt = (id: string, label: string) => ({ unit_id: id, label, from: "2026-07-01", to: "2026-09-30", opening: "0.00", charges: "500.00", payments: "0.00", adjustments: "0.00", closing: "500.00" });
    const r = row({ kind: "statement", template_key: "statement", facts: { units: [stmt(UNIT, "Unit 1"), stmt(U2, "Unit 2")] } });
    const h = harness({ batches: [[r]] });
    await runSender({ batchId: "B", deps: h.deps, config, site });
    expect(h.sent[0].attachments?.map((a) => a.filename)).toEqual(["Statement Unit 1 Q3 2026.pdf", "Statement Unit 2 Q3 2026.pdf"]);
    expect(h.sent[0].attachments?.[0].content).toBe(Buffer.from([37, 80, 68, 70]).toString("base64"));

    const bad = harness({ batches: [[row({ kind: "statement", template_key: "statement", facts: { units: [stmt(UNIT, "Unit 1")] } })]], pdf: async () => null });
    const out = await runSender({ batchId: "B", deps: bad.deps, config, site });
    expect(out.failed).toBe(1);
    expect(bad.sent).toHaveLength(0);
    expect(named(bad.calls, "email_mark_failed")[0].args).toMatchObject({ p_error: "Could not build the statement PDF.", p_retryable: true });
  });

  it("loads the announcement text, and fails if it is gone", async () => {
    const ann = row({ kind: "announcement", template_key: "announcement", facts: { announcement_id: "aaaa1111-0000-0000-0000-000000000009" } });
    const ok = harness({ batches: [[ann]], announcement: { title: "Water off", body: "Tuesday.", hasAttachment: false } });
    await runSender({ batchId: "B", deps: ok.deps, config, site });
    expect(ok.sent[0].subject).toBe("2158 N. Damen: Water off");
    const gone = harness({ batches: [[row({ kind: "announcement", template_key: "announcement", facts: { announcement_id: "aaaa1111-0000-0000-0000-000000000009" } })]] });
    await runSender({ batchId: "B", deps: gone.deps, config, site });
    expect(gone.sent).toHaveLength(0);
    expect(named(gone.calls, "email_mark_failed")[0].args.p_retryable).toBe(false);
  });

  it("falls back to The board and there when the names are empty", async () => {
    const h = harness({ batches: [[row({ reply_to_name: null, to_name: null })]] });
    await runSender({ batchId: "B", deps: h.deps, config, site });
    expect(h.sent[0].text).toContain("Hi there,");
    expect(h.sent[0].text).toContain("Thanks,\nThe board\n");
  });

  it("writes no address, amount or message text to the console, on every failure path (REVIEW-4 D3)", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    const printed = () => spies.flatMap((s) => s.mock.calls.flat().map(String)).join("\n");
    const mail = "private@example.test";
    const failWith = (status: number, retryable: boolean) => async () => ({ ok: false as const, retryable, status, message: `bad key ${mail}` });

    // Each path runs alone, so one failure cannot stop the others from being exercised.
    const paths: Record<string, ReturnType<typeof harness>> = {
      "bad facts (render_failed)": harness({ batches: [[row({ facts: { units: [{ bad: 1 }] }, to_email: mail })]] }),
      "unknown template version": harness({ batches: [[row({ template_version: 9, to_email: mail })]] }),
      "rejected key (401)": harness({ batches: [[row({ to_email: mail })]], send: failWith(401, false) }),
      "provider refuses (422)": harness({ batches: [[row({ to_email: mail })]], send: failWith(422, false) }),
      "provider slow (429)": harness({ batches: [[row({ to_email: mail })]], send: async () => ({ ok: false, retryable: true, status: 429, message: mail, retryAfterMs: 10 }) }),
      "sent but not recorded": harness({ batches: [[row({ to_email: mail })]], markSentError: true }),
      "sent": harness({ batches: [[row({ to_email: mail })]] }),
    };
    for (const [name, h] of Object.entries(paths)) {
      await runSender({ batchId: "B", deps: h.deps, config, site });
      const calls = h.calls.length;
      expect(calls, `${name} reached the sender`).toBeGreaterThan(0);
    }
    // The paths that print something printed it (otherwise this test proves nothing) ...
    expect(printed()).toMatch(/render_failed|rejected_key|sent but not recorded/);
    // ... and none of it carries an address, an amount or message text.
    expect(printed()).not.toMatch(/private@example\.test|\$\d|500\.00|Hi Ada/);
  });
});
