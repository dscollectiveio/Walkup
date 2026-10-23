import { describe, expect, it } from "vitest";
import { REFUND_OFFER, REFUND_WINDOW_DAYS, refundEligibilityFromRow, renderRefundNotice } from "@/lib/billing/refund";

describe("the refund offer and request", () => {
  it("states Doug's offer in words, with no em dashes", () => {
    expect(REFUND_WINDOW_DAYS).toBe(14);
    expect(REFUND_OFFER.body).toContain("2 free months");
    expect(REFUND_OFFER.body).toContain("$15 a month for the following 4 months");
    for (const text of Object.values(REFUND_OFFER)) expect(text).not.toContain("—");
  });

  it("reads the eligibility row, and treats a missing or odd one as no request", () => {
    expect(refundEligibilityFromRow(null)).toBeNull();
    expect(refundEligibilityFromRow({ eligible: true, charged_on: "2026-10-20", until: "2026-11-03", open_kind: null })).toEqual({
      eligible: true,
      chargedOn: "2026-10-20",
      until: "2026-11-03",
      openKind: null,
    });
    expect(refundEligibilityFromRow({ eligible: false, open_kind: "offer" })?.openKind).toBe("offer");
    expect(refundEligibilityFromRow({ eligible: false, open_kind: "nonsense" })?.openKind).toBeNull();
  });

  it("tells support what to do, and escapes what a customer typed", () => {
    const refund = renderRefundNotice({ kind: "refund", associationName: "2158 N. Damen", requesterName: "Cy Ferreira", planName: "Starter", chargedOn: "2026-10-20", reason: "<b>Too pricey</b>" });
    expect(refund.subject).toBe("2158 N. Damen asked for a yearly refund");
    expect(refund.text).toContain("refund the yearly charge in Stripe");
    expect(refund.html).toContain("&lt;b&gt;Too pricey&lt;/b&gt;");
    expect(refund.html).not.toContain("<b>Too pricey</b>");
    const offer = renderRefundNotice({ kind: "offer", associationName: "A", requesterName: null, planName: null, chargedOn: null, reason: null });
    expect(offer.text).toContain("A board admin at A took the stay offer");
    expect(offer.text).toContain("2 free months, then $15 a month for 4 months");
  });
});
