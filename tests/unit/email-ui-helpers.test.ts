import { describe, expect, it } from "vitest";
import { dailyLimit, emailStatus, isWarmingUp, optoutWords } from "@/lib/email-outbox/status";
import { SKIP_REASON_WORDS, skipReasonWords, skipSummary, statusWords } from "@/lib/email-outbox/reasons";
import { leftOutSentence, resultSentence, reviewHeading, summarizeBatch } from "@/lib/email-outbox/review";
import { INVALID_LINK, isValidToken, unsubscribeResult } from "@/lib/email-outbox/unsubscribe";
import { scrubDetail } from "@/lib/email-outbox/webhook-events";
import { previewRule, previewSentence } from "@/lib/collections/rule-preview";
import { buildCollections } from "@/lib/collections/build";
import { formatBalanceWords, formatMoney, sumMoney } from "@/lib/email-outbox/format";
import { rangeLabel } from "@/lib/statements/period";

describe("emailStatus and limits", () => {
  const on = { sending_enabled: true, enabled_at: "2026-10-01T00:00:00Z", daily_cap: 60, suspended_at: null, suspended_reason: null };
  it("says suspended before anything else, then not set up, off, on", () => {
    expect(emailStatus(true, { ...on, suspended_at: "2026-10-02T00:00:00Z" })).toBe("suspended");
    expect(emailStatus(false, on)).toBe("not_set_up");
    expect(emailStatus(true, null)).toBe("off");
    expect(emailStatus(true, { ...on, sending_enabled: false })).toBe("off");
    expect(emailStatus(true, on)).toBe("on");
  });
  it("applies 20 a day for the first seven days, then the board's limit", () => {
    const now = Date.parse("2026-10-04T00:00:00Z");
    expect(isWarmingUp(on, now)).toBe(true);
    expect(dailyLimit(on, now)).toBe(20);
    expect(dailyLimit({ ...on, daily_cap: 10 }, now)).toBe(10);
    const later = Date.parse("2026-10-09T00:00:00Z");
    expect(isWarmingUp(on, later)).toBe(false);
    expect(dailyLimit(on, later)).toBe(60);
  });
  it("words an opt-out", () => {
    expect(optoutWords({ dues_reminders: false, statements: true, announcements: true, unsubscribed_all: false })).toBe("reminders");
    expect(optoutWords({ dues_reminders: false, statements: false, announcements: true, unsubscribed_all: false })).toBe("reminders, statements");
    expect(optoutWords({ dues_reminders: true, statements: true, announcements: true, unsubscribed_all: true })).toBe("all");
  });
});

describe("reason and status words", () => {
  it("has words for every reason the database writes, none with a dash", () => {
    for (const k of ["no_email", "suppressed", "opted_out", "weekly_cap", "daily_cap", "platform_cap", "balance_changed", "address_changed", "sending_off", "left_out", "cancelled", "unknown_outcome"]) {
      expect(SKIP_REASON_WORDS[k], k).toBeTruthy();
    }
    for (const w of Object.values(SKIP_REASON_WORDS)) expect(w).not.toMatch(/[–—]/);
    expect(skipReasonWords("nonsense")).toBe("left out");
    expect(skipReasonWords(null)).toBe("left out");
  });
  it("reads a summary and each status", () => {
    expect(skipSummary([{ reason: "no_email", n: 1 }, { reason: "opted_out", n: 2 }])).toBe("no email address (1), opted out (2)");
    expect(statusWords("sent", { manual: true })).toBe("Marked sent by hand");
    expect(statusWords("sent", {})).toBe("Sent");
    expect(statusWords("complained", {})).toBe("Spam report");
    expect(statusWords("failed", { error: "Invalid to" })).toBe("Failed: Invalid to");
    expect(statusWords("skipped", { reason: "opted_out" })).toBe("Skipped: opted out");
    expect(statusWords("cancelled", { reason: "left_out" })).toBe("Left out");
  });
});

describe("review summary", () => {
  it("counts ready, left out, waiting, done and writes the sentences", () => {
    const s = summarizeBatch([
      { status: "draft", skip_reason: null }, { status: "draft", skip_reason: null },
      { status: "skipped", skip_reason: "opted_out" }, { status: "skipped", skip_reason: "no_email" },
      { status: "cancelled", skip_reason: "left_out" }, { status: "cancelled", skip_reason: "cancelled" },
    ]);
    expect(s).toMatchObject({ ready: 2, leftOut: 3 });
    expect(leftOutSentence(s)).toBe("3 people left out: you left them out (1), no email address (1), opted out (1)");
    expect(leftOutSentence(summarizeBatch([{ status: "draft", skip_reason: null }]))).toBeNull();
    const after = summarizeBatch([
      ...Array.from({ length: 5 }, () => ({ status: "sent", skip_reason: null })),
      { status: "delivered", skip_reason: null }, { status: "skipped", skip_reason: "balance_changed" }, { status: "failed", skip_reason: null },
      { status: "queued", skip_reason: null }, { status: "sending", skip_reason: null },
    ]);
    expect(after).toMatchObject({ sent: 6, skipped: 1, failed: 1, waiting: 2, done: 8, total: 10 });
    expect(resultSentence(after)).toBe("Sent 6. 1 skipped. 1 failed.");
    expect(leftOutSentence({ ...s, leftOut: 1, leftOutCounts: [{ reason: "opted_out", n: 1 }] })).toBe("1 person left out: opted out (1)");
  });
  it("titles each kind", () => {
    expect(reviewHeading("dues_reminder")).toBe("Review reminders");
    expect(reviewHeading("statement")).toBe("Review statements");
    expect(reviewHeading("annual_statement")).toBe("Review statements");
    expect(reviewHeading("late_fee_notice")).toBe("Review the late fee notice");
    expect(reviewHeading("announcement")).toBe("Review the announcement email");
  });
});

describe("unsubscribe choices", () => {
  const all = { dues_reminders: true, statements: true, announcements: true, stop_all: false };
  it("accepts only a 96 character lower-case hex token", () => {
    expect(isValidToken("a".repeat(96))).toBe(true);
    for (const bad of ["a".repeat(95), "A".repeat(96), "g".repeat(96), "", null, 12, `${"a".repeat(95)} `]) expect(isValidToken(bad)).toBe(false);
  });
  it("turns one kind off and says so", () => {
    const r = unsubscribeResult(all, { ...all, dues_reminders: false }, "2158 N. Damen");
    expect(r.changes).toEqual([{ scope: "dues_reminders", subscribe: false }]);
    expect(r.message).toBe("You're unsubscribed from dues reminders and late fee notices. You won't get those from 2158 N. Damen through Walkup.");
  });
  it("lists several kinds", () => {
    const r = unsubscribeResult(all, { ...all, statements: false, announcements: false }, "X");
    expect(r.message).toBe("You're unsubscribed from statements and announcements. You won't get those from X through Walkup.");
  });
  it("stops everything with one change and ignores the rest", () => {
    const r = unsubscribeResult(all, { ...all, stop_all: true, statements: false }, "X");
    expect(r.changes).toEqual([{ scope: "all", subscribe: false }]);
    expect(r.message).toBe("You're unsubscribed from all email from X through Walkup.");
  });
  it("turns things back on, and says Saved when nothing changed", () => {
    expect(unsubscribeResult({ ...all, statements: false }, all, "X")).toEqual({ changes: [{ scope: "statements", subscribe: true }], message: "Saved." });
    expect(unsubscribeResult(all, all, "X")).toEqual({ changes: [], message: "Saved." });
    expect(unsubscribeResult({ ...all, stop_all: true }, { ...all, stop_all: false }, "X").changes).toEqual([{ scope: "all", subscribe: true }]);
  });
  it("has no dash in its copy", () => {
    expect(INVALID_LINK).not.toMatch(/[–—]/);
  });
});

describe("webhook detail", () => {
  it("removes addresses and control characters and cuts to 200", () => {
    expect(scrubDetail("550 5.1.1 <ada@example.test> user unknown")).toBe("550 5.1.1 <[address]> user unknown".replace("<[address]>", "<[address]>"));
    expect(scrubDetail("a\r\nb ada@example.test")).toBe("a b [address]");
    expect(scrubDetail("x".repeat(500))).toHaveLength(200);
    expect(scrubDetail(undefined as never)).toBe("");
  });
});

describe("money words", () => {
  it("formats with commas and credit words and sums exactly", () => {
    expect(formatMoney("1234567.80")).toBe("$1,234,567.80");
    expect(formatMoney("-12.50")).toBe("-$12.50");
    expect(formatBalanceWords("-12.50")).toBe("$12.50 credit");
    expect(formatBalanceWords("0.00")).toBe("$0.00");
    expect(sumMoney(["0.10", "0.20", "0.70"])).toBe("1.00");
    expect(() => formatMoney("twelve")).toThrow();
  });
  it("labels an all-activity statement", () => {
    expect(rangeLabel("2000-01-01", "2026-10-14", true)).toBe("Through October 14, 2026");
    expect(rangeLabel("2026-01-01", "2026-03-31", false)).toBe("Q1 2026");
  });
});

describe("rule preview", () => {
  const TODAY = "2026-10-14";
  const units = [{ id: "u1", label: "Unit 1" }, { id: "u2", label: "Unit 2" }, { id: "u3", label: "Unit 3" }];
  const charge = (unit: string, due: string, cents: number) => ({ id: `c-${unit}-${due}`, unit_id: unit, charge_type: "assessment" as const, due_on: due, balanceCents: cents });
  const owners = units.map((u) => ({ unit_id: u.id, person_id: `p-${u.id}`, full_name: u.label, email: `${u.id}@example.test` }));
  const charges = [charge("u1", "2026-09-01", 50000), charge("u2", "2026-10-10", 20000), charge("u3", "2026-10-18", 30000)];
  const behind = buildCollections({ todayIso: TODAY, units, charges, owners, messages: [], suppressed: new Map(), optedOutPersonIds: new Set() });
  const input = { todayIso: TODAY, behind, units, charges, owners, suppressed: new Map(), optedOutPersonIds: new Set<string>(), recentlyEmailedUnitIds: new Set<string>() };
  const overdue = { kind: "dues_overdue" as const, days: 7, minAmountCents: 100, repeatEveryDays: 7, maxReminders: 3 };

  it("lists units overdue long enough, and nobody for a longer threshold", () => {
    expect(previewRule(overdue, input).labels).toEqual(["Unit 1"]);
    expect(previewRule({ ...overdue, days: 3 }, input).labels.sort()).toEqual(["Unit 1", "Unit 2"]);
    expect(previewRule({ ...overdue, days: 60 }, input).labels).toEqual([]);
  });
  it("respects the minimum amount, opt-outs, blocks and the weekly window", () => {
    expect(previewRule({ ...overdue, minAmountCents: 60000 }, input).labels).toEqual([]);
    expect(previewRule(overdue, { ...input, optedOutPersonIds: new Set(["p-u1"]) }).labels).toEqual([]);
    expect(previewRule(overdue, { ...input, suppressed: new Map([["u1@example.test", "bounce" as const]]) }).labels).toEqual([]);
    expect(previewRule(overdue, { ...input, recentlyEmailedUnitIds: new Set(["u1"]) }).labels).toEqual([]);
  });
  it("previews the heads-up rule for units not yet overdue", () => {
    const upcoming = { kind: "dues_upcoming" as const, days: 7, minAmountCents: 100, repeatEveryDays: 7, maxReminders: 1 };
    expect(previewRule(upcoming, input).labels).toEqual(["Unit 3"]);
    expect(previewRule({ ...upcoming, days: 2 }, input).labels).toEqual([]);
  });
  it("writes the sentence", () => {
    expect(previewSentence([])).toBe("Today this would email nobody.");
    expect(previewSentence(["Unit 2"])).toBe("Today this would email 1 owner: Unit 2.");
    expect(previewSentence(["Unit 2", "Unit 5"])).toBe("Today this would email 2 owners: Unit 2, Unit 5.");
  });
});
