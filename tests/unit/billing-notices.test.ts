import { describe, expect, it } from "vitest";
import { computeEntitlement, type BillingFacts } from "@/lib/billing/entitlement-rules";
import {
  activeNotices,
  noticeBanner,
  readOnlyNoticeGiven,
  readOnlyNoticeNeeded,
  renderNoticeEmail,
  type BillingNotice,
} from "@/lib/billing/notices";

const NOW = new Date("2026-10-22T18:00:00Z");
const facts = (over: Partial<BillingFacts> = {}): BillingFacts => ({
  trialEndsAt: null,
  subscriptionStatus: null,
  planKey: null,
  billingInterval: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  paymentFailedAt: null,
  compActive: false,
  compKind: null,
  compExpiresOn: null,
  unitCount: 6,
  hasSubscription: false,
  stripeCustomerId: null,
  ...over,
});
const notice = (over: Partial<BillingNotice> = {}): BillingNotice => ({
  id: "n1",
  kind: "price_change",
  effectiveOn: "2026-12-01",
  detail: "Starter goes to $21 a month.",
  createdAt: "2026-10-01T00:00:00Z",
  emailedAt: null,
  ...over,
});

describe("readOnlyNoticeNeeded", () => {
  it("tells a building in its grace period the day read-only would start", () => {
    const needed = readOnlyNoticeNeeded(facts({ subscriptionStatus: "past_due", paymentFailedAt: "2026-10-20T12:00:00Z" }), NOW);
    // failed on the 20th, 14 days of grace: read-only from November 3
    expect(needed).toEqual({ anchorOn: "2026-10-20", effectiveOn: "2026-11-03" });
  });

  it("never promises less than 7 days", () => {
    const needed = readOnlyNoticeNeeded(facts({ subscriptionStatus: "past_due", paymentFailedAt: "2026-10-10T12:00:00Z" }), NOW);
    expect(needed?.effectiveOn).toBe("2026-10-29");
  });

  it("tells a building already past grace that it starts in 7 days", () => {
    const needed = readOnlyNoticeNeeded(facts({ subscriptionStatus: "canceled", currentPeriodEnd: "2026-08-01T00:00:00Z" }), NOW);
    expect(needed).toEqual({ anchorOn: "2026-07-31", effectiveOn: "2026-10-29" });
  });

  it("says nothing to a building in good standing, comped, or in its trial", () => {
    expect(readOnlyNoticeNeeded(facts({ subscriptionStatus: "active" }), NOW)).toBeNull();
    expect(readOnlyNoticeNeeded(facts({ compActive: true, compKind: "early_access" }), NOW)).toBeNull();
    expect(readOnlyNoticeNeeded(facts({ trialEndsAt: "2026-11-01T00:00:00Z" }), NOW)).toBeNull();
  });
});

describe("readOnlyNoticeGiven and the guard", () => {
  it("counts only an email sent at least 7 days ago, and not a price change", () => {
    expect(readOnlyNoticeGiven([], NOW)).toBe(false);
    expect(readOnlyNoticeGiven([notice({ kind: "read_only", emailedAt: null })], NOW)).toBe(false);
    expect(readOnlyNoticeGiven([notice({ kind: "read_only", emailedAt: "2026-10-20T00:00:00Z" })], NOW)).toBe(false);
    expect(readOnlyNoticeGiven([notice({ kind: "read_only", emailedAt: "2026-10-15T00:00:00Z" })], NOW)).toBe(true);
    expect(readOnlyNoticeGiven([notice({ kind: "early_access_end", emailedAt: "2026-07-01T00:00:00Z" })], NOW)).toBe(true);
    expect(readOnlyNoticeGiven([notice({ kind: "price_change", emailedAt: "2026-07-01T00:00:00Z" })], NOW)).toBe(false);
  });

  it("keeps a lapsed building fully working until it has been told, once enforcement is on", () => {
    const lapsed = facts({ subscriptionStatus: "canceled", currentPeriodEnd: "2026-08-01T00:00:00Z" });
    const base = { enabled: true, enforced: true, now: NOW };
    expect(computeEntitlement(lapsed, { ...base, noticeGiven: false }).readOnly).toBe(false);
    expect(computeEntitlement(lapsed, { ...base, noticeGiven: true }).readOnly).toBe(true);
    // No check requested: unchanged behavior.
    expect(computeEntitlement(lapsed, base).readOnly).toBe(true);
  });
});

describe("activeNotices", () => {
  it("hides a notice whose day has passed, and a read-only notice once the building has paid", () => {
    const list = [
      notice({ id: "a", effectiveOn: "2026-10-01" }),
      notice({ id: "b", effectiveOn: "2026-12-01" }),
      notice({ id: "c", kind: "read_only", effectiveOn: "2026-10-29" }),
    ];
    expect(activeNotices(list, "active", NOW).map((n) => n.id)).toEqual(["b"]);
    expect(activeNotices(list, "grace", NOW).map((n) => n.id)).toEqual(["c", "b"]);
  });
});

describe("the words", () => {
  const kinds = ["price_change", "read_only", "early_access_end", "founding_charge"] as const;

  it("writes every email with the date, the building, no em dashes and nothing about moving money", () => {
    for (const kind of kinds) {
      const mail = renderNoticeEmail({ kind, effectiveOn: "2026-12-01", detail: "Starter goes to $21 a month.", associationName: "2158 N. Damen", recipientName: "Cy Ferreira" });
      for (const part of [mail.subject, mail.text, mail.html]) {
        expect(part, kind).not.toContain("—");
        expect(part, kind).toContain("December 1, 2026");
      }
      expect(mail.text, kind).toContain("2158 N. Damen");
      expect(mail.text, kind).toMatch(/^Hi Cy,/);
      expect(mail.text, kind).toContain("required notice");
    }
  });

  it("puts the price details in the price-change email and escapes them in the HTML", () => {
    const mail = renderNoticeEmail({ kind: "price_change", effectiveOn: "2026-12-01", detail: "<b>Starter</b> goes to $21", associationName: "A & B", recipientName: null });
    expect(mail.text).toContain("<b>Starter</b> goes to $21");
    expect(mail.html).toContain("&lt;b&gt;Starter&lt;/b&gt; goes to $21");
    expect(mail.html).not.toContain("<b>Starter</b>");
    expect(mail.text).toMatch(/^Hi there,/);
  });

  it("writes banners with no em dashes and gives a read-only notice the attention tone", () => {
    for (const kind of kinds) {
      const b = noticeBanner(notice({ kind }), NOW);
      expect(`${b.headline} ${b.detail}`).not.toContain("—");
    }
    expect(noticeBanner(notice({ kind: "read_only", effectiveOn: "2026-10-29" }), NOW).tone).toBe("attention");
    expect(noticeBanner(notice({ effectiveOn: "2026-12-30" }), NOW).tone).toBe("neutral");
  });
});
