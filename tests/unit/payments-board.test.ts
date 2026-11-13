import { describe, expect, it } from "vitest";
import { attentionItems, payoutSuggestion, pendingBadges, type BoardOnlineRow } from "@/lib/payments/board-view";
import { matchPayouts } from "@/lib/payments/payout-match";

// The board side of online dues payments (DECISIONS #57, plan Phase 5).

const row = (over: Partial<BoardOnlineRow>): BoardOnlineRow => ({
  id: "p1",
  unitId: "u1",
  status: "processing",
  amountCents: 40_000,
  createdAt: "2026-11-10T12:00:00",
  failureReason: null,
  ...over,
});
const label = (id: string) => ({ u1: "Unit 1", u2: "Unit 2" })[id] ?? "A unit";

describe("pending badges", () => {
  it("sum what's on its way per unit; failed, canceled and deposited don't count", () => {
    const b = pendingBadges([
      row({ id: "a", status: "processing" }),
      row({ id: "b", status: "succeeded", amountCents: 12_550 }),
      row({ id: "c", unitId: "u2", status: "failed" }),
      row({ id: "d", unitId: "u2", status: "deposited" }),
    ]);
    expect([...b]).toEqual([["u1", "$525.50 paid online, pending"]]);
  });
});

describe("online payments to look at", () => {
  const now = Date.parse("2026-11-12T12:00:00");

  it("lists failed, refunded and disputed from the last 45 days, newest first", () => {
    const items = attentionItems(
      [
        row({ id: "old", status: "failed", createdAt: "2026-09-01T12:00:00" }),
        row({ id: "f", status: "failed", failureReason: "insufficient funds", createdAt: "2026-11-09T12:00:00" }),
        row({ id: "r", unitId: "u2", status: "refunded", createdAt: "2026-11-11T12:00:00" }),
        row({ id: "ok", status: "succeeded" }),
      ],
      label,
      now,
    );
    expect(items.map((i) => i.id)).toEqual(["r", "f"]);
    expect(items[1]).toEqual({
      id: "f",
      unitId: "u1",
      tone: "bad",
      text: "Unit 1: $400 paid online Nov 9 didn't go through (insufficient funds). It still counts as owed, and the owner has been shown this.",
    });
    expect(items[0].tone).toBe("warning");
    expect(items[0].text).toMatch(/refunded in Stripe/);
    for (const i of items) expect(i.text).not.toContain("—");
  });
});

describe("payout suggestion", () => {
  it("is ready only when every fee is known and dues less fees equal the payout", () => {
    const base = {
      payoutId: "po",
      amountCents: 79_360,
      arrivalDate: "2026-11-14",
      payments: [
        { unitId: "u1", amountCents: 40_000, feeCents: 320 },
        { unitId: "u2", amountCents: 40_000, feeCents: 320 },
      ],
    };
    expect(payoutSuggestion(base, label)).toEqual({
      ready: true,
      text: "Stripe payout: 2 online dues payments, $800 less $6.40 in fees",
      detail: "Unit 1 $400 · Unit 2 $400",
    });
    expect(payoutSuggestion({ ...base, amountCents: 79_000 }, label).ready).toBe(false);
    expect(payoutSuggestion({ ...base, payments: [{ ...base.payments[0], feeCents: null }, base.payments[1]] }, label).ready).toBe(false);
    expect(payoutSuggestion({ ...base, payments: [] }, label).ready).toBe(false);
  });
});

describe("matching payouts to deposits", () => {
  const dep = (id: string, amountCents: number, postedOn: string, description = "DEPOSIT") => ({ id, amountCents, postedOn, description });

  it("matches to the cent within a week of the arrival date, preferring a Stripe-labeled deposit", () => {
    const m = matchPayouts(
      [{ id: "po1", amountCents: 79_360, arrivalDate: "2026-11-14" }],
      [dep("a", 79_360, "2026-11-15"), dep("b", 79_360, "2026-11-16", "STRIPE TRANSFER"), dep("c", 79_361, "2026-11-14")],
    );
    expect(m.get("po1")?.id).toBe("b");
  });

  it("ignores a deposit more than a week away, or a payout with no arrival date", () => {
    expect(matchPayouts([{ id: "po1", amountCents: 100, arrivalDate: "2026-11-01" }], [dep("a", 100, "2026-11-09")]).size).toBe(0);
    expect(matchPayouts([{ id: "po1", amountCents: 100, arrivalDate: null }], [dep("a", 100, "2026-11-01")]).size).toBe(0);
  });

  it("two same-size payouts never claim the same deposit", () => {
    const m = matchPayouts(
      [
        { id: "po1", amountCents: 100, arrivalDate: "2026-11-01" },
        { id: "po2", amountCents: 100, arrivalDate: "2026-11-08" },
      ],
      [dep("a", 100, "2026-11-02"), dep("b", 100, "2026-11-08")],
    );
    expect(m.get("po1")?.id).toBe("a");
    expect(m.get("po2")?.id).toBe("b");
    const one = matchPayouts(
      [
        { id: "po1", amountCents: 100, arrivalDate: "2026-11-01" },
        { id: "po2", amountCents: 100, arrivalDate: "2026-11-02" },
      ],
      [dep("a", 100, "2026-11-02")],
    );
    expect(one.size).toBe(1);
  });
});
