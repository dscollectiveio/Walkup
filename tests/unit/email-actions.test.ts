import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpc = vi.fn();
const fromChain = { select: () => fromChain, eq: () => fromChain, maybeSingle: async () => ({ data: { id: "b", status: "approved" } }), overlaps: () => fromChain, order: () => fromChain, limit: () => fromChain };
const createClient = vi.fn(async () => ({ rpc, from: () => fromChain }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));

let viewer: { associationId: string; isBoard: boolean; isBoardAdmin: boolean } | null = null;
vi.mock("@/lib/owner/viewer", () => ({ getViewer: async () => viewer }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const afterCallbacks: (() => Promise<void>)[] = [];
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => afterCallbacks.push(fn) }));
const runSender = vi.fn(async () => ({ sent: 1, failed: 0, skipped: 0, remaining: false, stoppedBecause: "empty" }));
vi.mock("@/lib/email-outbox/send-batch", () => ({ runSender: (...a: unknown[]) => runSender(...(a as [])) }));
vi.mock("@/lib/email-outbox/deps", () => ({ boardSessionDeps: () => ({}), senderSite: { siteUrl: "https://www.walkuphoa.com", legalEntity: "DS Collective LLC", legalAddress: "1 Example St" } }));
vi.mock("@/lib/site-config", async (orig) => ({ ...(await orig<typeof import("@/lib/site-config")>()), LEGAL_ADDRESS: "1 Example Street, Chicago, IL 60601" }));
vi.mock("@/lib/collections/data", () => ({ loadCollections: vi.fn() }));

import {
  approveBatch,
  cancelBatch,
  clearSuppression,
  leaveOut,
  markSentByHand,
  prepareReminders,
  prepareStatements,
  resumeBatch,
  saveDraftNote,
  saveReminderRule,
  setDailyCap,
  setSendingEnabled,
} from "@/app/dues/email-actions";
import { ADMIN_ONLY, BOARD_ONLY_PREPARE, SOMETHING_WRONG, countsFromRows, mapDbError, parseRuleInput, validateNote, validateUnitIds } from "@/lib/email-outbox/actions-core";

const UUID = "11111111-1111-4111-8111-111111111111";
const UUID2 = "22222222-2222-4222-8222-222222222222";
const ASSOC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const admin = { associationId: ASSOC, isBoard: true, isBoardAdmin: true };
const member = { associationId: ASSOC, isBoard: true, isBoardAdmin: false };

beforeEach(() => {
  rpc.mockReset();
  createClient.mockClear();
  runSender.mockClear();
  afterCallbacks.length = 0;
  viewer = admin;
  process.env.RESEND_API_KEY = "re_test";
  delete process.env.EMAIL_SENDING_DISABLED;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ruleInput", () => {
  const base = { kind: "dues_overdue", days: 7, minAmount: "25.00", repeatEveryDays: 7, maxReminders: 3, enabled: false };
  it("accepts a sane rule", () => {
    expect(parseRuleInput(base).ok).toBe(true);
    expect(parseRuleInput({ ...base, minAmount: "25" }).ok).toBe(true);
  });
  it("says exactly what is wrong", () => {
    const r = parseRuleInput({ days: 0, minAmount: "abc", repeatEveryDays: 3, maxReminders: 9, kind: "dues_overdue", enabled: true });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.fieldErrors).toEqual({
        days: "Use at least 1 day.",
        minAmount: "Enter an amount like 25 or 25.00.",
        repeatEveryDays: "Reminders go out at most once a week.",
        maxReminders: "Six reminders is the most.",
      });
    }
    const big = parseRuleInput({ ...base, days: 91 });
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.fieldErrors.days).toBe("Use 90 days or fewer.");
    expect(parseRuleInput({ ...base, days: 90 }).ok).toBe(true);
  });
});

describe("mapDbError", () => {
  it("maps each code to its sentence", () => {
    expect(mapDbError({ code: "42501" })).toBe("Only a board admin can do that.");
    expect(mapDbError({ code: "22023", hint: "sending_off" })).toBe("Turn on sending first.");
    expect(mapDbError({ code: "22023", hint: "no_reply_to" })).toBe("Add the board contact email on Building Info first. Replies go there.");
    expect(mapDbError({ code: "53400", hint: "weekly_cap" })).toBe("This person already got this kind of email this week.");
    expect(mapDbError({ code: "22023", message: "that late fee is not charged or is already settled" })).toBe("that late fee is not charged or is already settled");
  });
  it("hides anything else and logs only the code", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(mapDbError({ code: "23505", message: "duplicate key value violates unique constraint (ada@example.test)" }, "x")).toBe(SOMETHING_WRONG);
    expect(err.mock.calls.flat().join(" ")).not.toContain("ada@example.test");
  });
});

describe("validators", () => {
  it("rejects links, addresses and long notes", () => {
    for (const bad of ["see http://x.test", "go to www.x.test", "mail me@x.test", "x".repeat(501)]) expect(validateNote(bad).ok, bad).toBe(false);
    expect(validateNote("  Call me on Tuesday.  ")).toEqual({ ok: true, value: "Call me on Tuesday." });
    expect(validateNote("   ")).toEqual({ ok: true, value: null });
    expect(validateNote("x".repeat(500)).ok).toBe(true);
  });
  it("checks unit ids", () => {
    expect(validateUnitIds([])).toMatchObject({ ok: false });
    expect(validateUnitIds(["nope"])).toMatchObject({ ok: false });
    expect(validateUnitIds(Array.from({ length: 101 }, () => UUID))).toMatchObject({ ok: false });
    expect(validateUnitIds([UUID, UUID, UUID2])).toEqual({ ok: true, value: [UUID, UUID2] });
  });
  it("counts drafts and skips by reason, leaving cancelled rows out", () => {
    expect(
      countsFromRows([
        { status: "draft", skip_reason: null },
        { status: "draft", skip_reason: null },
        { status: "skipped", skip_reason: "opted_out" },
        { status: "skipped", skip_reason: "opted_out" },
        { status: "skipped", skip_reason: "no_email" },
        { status: "cancelled", skip_reason: "left_out" },
      ]),
    ).toEqual({ drafts: 2, skipped: [{ reason: "opted_out", n: 2 }, { reason: "no_email", n: 1 }] });
  });
});

describe("approveBatch", () => {
  it("refuses before any database call when sending is not set up", async () => {
    delete process.env.RESEND_API_KEY;
    const r = await approveBatch(UUID);
    expect(r).toEqual({ error: "Sending from Walkup isn't set up on this account, so emails are drafts you open in your own email app." });
    expect(createClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(0);
  });

  it("refuses under the kill switch", async () => {
    process.env.EMAIL_SENDING_DISABLED = "1";
    expect(await approveBatch(UUID)).toMatchObject({ error: expect.stringContaining("isn't set up") });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("refuses a board member who is not an admin, without touching the database", async () => {
    viewer = member;
    expect(await approveBatch(UUID)).toEqual({ error: ADMIN_ONLY });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("approves, then starts the sender in the background under the same session", async () => {
    rpc.mockResolvedValueOnce({ data: [{ queued: 3, skipped: 1 }], error: null });
    const r = await approveBatch(UUID);
    expect(r).toEqual({ ok: true, queued: 3, skipped: 1 });
    expect(rpc).toHaveBeenCalledWith("email_approve_batch", { p_batch_id: UUID });
    expect(afterCallbacks).toHaveLength(1);
    expect(runSender).not.toHaveBeenCalled(); // not before the response is sent
    await afterCallbacks[0]();
    expect(runSender).toHaveBeenCalledWith(expect.objectContaining({ batchId: UUID }));
  });

  it("passes the database's reason through as a hint", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", hint: "sending_off", message: "email sending is off for this building" } });
    expect(await approveBatch(UUID)).toEqual({ error: "Turn on sending first.", hint: "sending_off" });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", hint: "no_reply_to", message: "x" } });
    expect(await approveBatch(UUID)).toMatchObject({ hint: "no_reply_to" });
    expect(afterCallbacks).toHaveLength(0);
  });

  it("does not let a crashing sender escape the background task", async () => {
    rpc.mockResolvedValueOnce({ data: [{ queued: 1, skipped: 0 }], error: null });
    runSender.mockRejectedValueOnce(new Error("boom"));
    await approveBatch(UUID);
    await expect(afterCallbacks[0]()).resolves.toBeUndefined();
  });

  it("rejects an id that is not a uuid", async () => {
    expect(await approveBatch("not-a-uuid")).toEqual({ error: SOMETHING_WRONG });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("resumeBatch", () => {
  it("is for an admin and needs sending set up", async () => {
    viewer = member;
    expect(await resumeBatch(UUID)).toEqual({ error: ADMIN_ONLY });
    viewer = admin;
    delete process.env.RESEND_API_KEY;
    expect(await resumeBatch(UUID)).toMatchObject({ error: expect.stringContaining("isn't set up") });
    process.env.RESEND_API_KEY = "re_test";
    expect(await resumeBatch(UUID)).toEqual({ ok: true });
    expect(afterCallbacks).toHaveLength(1);
  });
});

describe("prepare", () => {
  it("is for the board only and never needs Resend", async () => {
    delete process.env.RESEND_API_KEY;
    viewer = null;
    expect(await prepareReminders({ unitIds: [UUID] })).toEqual({ error: BOARD_ONLY_PREPARE });
    viewer = { associationId: ASSOC, isBoard: false, isBoardAdmin: false };
    expect(await prepareReminders({ unitIds: [UUID] })).toEqual({ error: BOARD_ONLY_PREPARE });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("calls the database with the caller's own association and the chosen units", async () => {
    rpc.mockResolvedValueOnce({ data: UUID2, error: null });
    const chain = { select: () => ({ eq: async () => ({ data: [{ status: "draft", skip_reason: null }, { status: "skipped", skip_reason: "opted_out" }], error: null }) }) };
    createClient.mockResolvedValueOnce({ rpc, from: () => chain } as never);
    const r = await prepareReminders({ unitIds: [UUID] });
    expect(r).toEqual({ ok: true, batchId: UUID2, counts: { drafts: 1, skipped: [{ reason: "opted_out", n: 1 }] } });
    expect(rpc).toHaveBeenCalledWith("email_prepare_batch", { p_association_id: ASSOC, p_kind: "dues_reminder", p_unit_ids: [UUID] });
  });

  it("cancels an empty batch and says why", async () => {
    rpc.mockResolvedValueOnce({ data: UUID2, error: null }).mockResolvedValueOnce({ data: null, error: null });
    const chain = { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
    createClient.mockResolvedValueOnce({ rpc, from: () => chain } as never);
    expect(await prepareReminders({ unitIds: [UUID] })).toEqual({ error: "None of those units has an overdue balance." });
    expect(rpc).toHaveBeenLastCalledWith("email_cancel_batch", { p_batch_id: UUID2 });
  });

  it("checks the statement period before calling the database", async () => {
    expect(await prepareStatements({ unitIds: [UUID], from: "2026-03-01", to: "2026-01-01" })).toEqual({ error: "Choose a start and end date, with the end on or after the start." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uses annual_statement for a full calendar year", async () => {
    rpc.mockResolvedValueOnce({ data: UUID2, error: null });
    const chain = { select: () => ({ eq: async () => ({ data: [{ status: "draft", skip_reason: null }], error: null }) }) };
    createClient.mockResolvedValueOnce({ rpc, from: () => chain } as never);
    await prepareStatements({ unitIds: [UUID], from: "2025-01-01", to: "2025-12-31" });
    expect(rpc).toHaveBeenCalledWith("email_prepare_batch", expect.objectContaining({ p_kind: "annual_statement", p_period_start: "2025-01-01", p_period_end: "2025-12-31" }));
  });
});

describe("review, settings and rules", () => {
  it("rejects a note with a link before calling the database", async () => {
    expect(await saveDraftNote(UUID, "see http://x.test")).toEqual({ error: "Leave out links and email addresses." });
    expect(await saveDraftNote(UUID, "x".repeat(501))).toEqual({ error: "Keep the note to 500 characters." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("saves a note, leaves out, cancels, marks sent by hand", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await saveDraftNote(UUID, "Please call.")).toEqual({ ok: true });
    expect(rpc).toHaveBeenLastCalledWith("email_edit_draft", { p_outbox_id: UUID, p_board_note: "Please call.", p_left_out: false });
    expect(await leaveOut(UUID)).toEqual({ ok: true });
    expect(rpc).toHaveBeenLastCalledWith("email_edit_draft", { p_outbox_id: UUID, p_board_note: null, p_left_out: true });
    expect(await cancelBatch(UUID)).toEqual({ ok: true });
    viewer = member; // any board member may mark a draft sent
    expect(await markSentByHand(UUID)).toEqual({ ok: true });
    expect(rpc).toHaveBeenLastCalledWith("email_mark_sent_by_hand", { p_outbox_id: UUID });
  });

  it("limits settings to a board admin and validates the daily limit", async () => {
    viewer = member;
    expect(await setSendingEnabled(true)).toEqual({ error: ADMIN_ONLY });
    expect(await setDailyCap(50)).toEqual({ error: ADMIN_ONLY });
    expect(await clearSuppression("a@example.test")).toEqual({ error: ADMIN_ONLY });
    expect(await saveReminderRule({ kind: "dues_overdue", days: 7, minAmount: "1.00", repeatEveryDays: 7, maxReminders: 3, enabled: true })).toEqual({ error: ADMIN_ONLY });
    expect(createClient).not.toHaveBeenCalled();
    viewer = admin;
    expect(await setDailyCap(0)).toEqual({ error: "Use a number from 1 to 200." });
    expect(await setDailyCap(201)).toEqual({ error: "Use a number from 1 to 200." });
    expect(await setDailyCap(1.5)).toEqual({ error: "Use a number from 1 to 200." });
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await setDailyCap(80)).toEqual({ ok: true });
    expect(rpc).toHaveBeenLastCalledWith("email_set_daily_cap", { p_association_id: ASSOC, p_cap: 80 });
    expect(await clearSuppression("  Ada@Example.test ")).toEqual({ ok: true });
    expect(rpc).toHaveBeenLastCalledWith("email_clear_suppression", { p_association_id: ASSOC, p_email: "ada@example.test" });
    expect(await clearSuppression("not an address")).toEqual({ error: "That doesn't look like an email address." });
  });

  it("returns field errors for a bad rule and maps the database's sending_off", async () => {
    const bad = await saveReminderRule({ kind: "dues_overdue", days: 0, minAmount: "1.00", repeatEveryDays: 7, maxReminders: 3, enabled: true });
    expect(bad).toEqual({ error: "Check the highlighted fields.", fieldErrors: { days: "Use at least 1 day." } });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", hint: "sending_off", message: "x" } });
    expect(await saveReminderRule({ kind: "dues_overdue", days: 7, minAmount: "1.00", repeatEveryDays: 7, maxReminders: 3, enabled: true })).toEqual({ error: "Turn on sending first." });
  });
});
