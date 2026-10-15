import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { bidPrefillFrom, bidReadContent, BID_READ_SYSTEM, type BidReadOutput } from "@/lib/repairs/bid-read";
import { cutText, isoDateOrNull, parseMoneyText } from "@/lib/repairs/parse";

// repairs-spec §8.4: what a quote's figures may become, and what they may not.

describe("parseMoneyText", () => {
  it("accepts one plain dollar amount", () => {
    expect(parseMoneyText("$4,250")).toBe("4250.00");
    expect(parseMoneyText("4250.00")).toBe("4250.00");
    expect(parseMoneyText("$4,250.5")).toBe("4250.50");
    expect(parseMoneyText("  $480 ")).toBe("480.00");
    expect(parseMoneyText("$1,234,567.89")).toBe("1234567.89");
    expect(parseMoneyText("USD 900")).toBe("900.00");
    expect(parseMoneyText("0.99")).toBe("0.99");
  });

  it("refuses ranges, shorthand, percentages, rates and junk", () => {
    for (const bad of ["$4,000-$5,000", "$4,000 to $5,000", "4.2k", "$4k", "10%", "$95/hr", "about $400", "-500", "$4,25", "4,2500", "", "free", "1.234"]) {
      expect(parseMoneyText(bad), bad).toBeNull();
    }
    expect(parseMoneyText(null)).toBeNull();
  });
});

describe("isoDateOrNull and cutText", () => {
  it("keeps only real YYYY-MM-DD dates", () => {
    expect(isoDateOrNull("2026-11-30")).toBe("2026-11-30");
    expect(isoDateOrNull("2026-02-30")).toBeNull();
    expect(isoDateOrNull("11/30/2026")).toBeNull();
    expect(isoDateOrNull("valid for 30 days")).toBeNull();
    expect(isoDateOrNull(null)).toBeNull();
  });

  it("cuts at a word boundary, collapses spaces and writes dashes as commas", () => {
    expect(cutText("  Replace   wax ring — reseal tub  ", 200)).toBe("Replace wax ring, reseal tub");
    const cut = cutText("alpha beta gamma delta epsilon", 17);
    expect(cut).toBe("alpha beta gamma");
    expect(cutText("   ", 10)).toBeNull();
  });
});

describe("bidPrefillFrom", () => {
  const out: BidReadOutput = {
    contractorName: "Acme Plumbing",
    total: "$4,250.00",
    amountKind: "estimate",
    quoteDate: "2026-10-12",
    validUntil: "2026-11-12",
    canStartOn: "next week",
    duration: "Two days",
    scope: "Replace the main stack.",
    exclusions: null,
    warranty: "1 year parts and labour",
    paymentTerms: "50% deposit, rest when done",
    lineItems: [{ description: "Labour", amount: "$2,000" }],
    confidence: 1.4,
  };

  it("parses money, keeps real dates, clamps confidence and maps unknown kinds to null", () => {
    const { prefill, confidence } = bidPrefillFrom(out);
    expect(prefill.amount).toBe("4250.00");
    expect(prefill.amountKind).toBe("estimate");
    expect(prefill.receivedOn).toBe("2026-10-12");
    expect(prefill.validUntil).toBe("2026-11-12");
    expect(prefill.canStartOn).toBeNull();
    expect(prefill.paymentTermsText).toBe("50% deposit, rest when done");
    expect(confidence).toBe(1);
    expect(bidPrefillFrom({ ...out, amountKind: "unknown", total: "$4,000-$5,000" }).prefill).toMatchObject({ amountKind: null, amount: null });
  });

  it("never adds up line items when there is no total", () => {
    expect(bidPrefillFrom({ ...out, total: null }).prefill.amount).toBeNull();
  });

  it("sends the quote text capped, under a fixed system prompt", () => {
    const [block] = bidReadContent("x".repeat(70_000));
    expect(block.text.startsWith("Contractor quote text:\n")).toBe(true);
    expect(block.text.length).toBe("Contractor quote text:\n".length + 60_000);
    expect(BID_READ_SYSTEM).toContain("never add numbers up yourself");
    expect(BID_READ_SYSTEM).not.toMatch(/—/);
  });
});
