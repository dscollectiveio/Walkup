import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  addDays, canFollowUp, contactSourceBadge, draftedByLine, followUpOpensOn, hostOf, messageStatusText, moneyInputText,
  premiumVsNow, requestChip, roundUpTo10k, validityText,
} from "@/app/insurance/quote-helpers";
import { inForceByCoverage, requestCoverages } from "@/app/insurance/quotes-data";
import type { Finding } from "@/lib/insurance/coverage-check";
import * as ownerSummary from "@/lib/insurance/owner-summary";
import * as ownerSummaryText from "@/lib/insurance/owner-summary-text";
import type { PolicyWithStatus } from "@/lib/insurance/queries";

const TODAY = "2026-10-14";

function policy(over: Partial<PolicyWithStatus>): PolicyWithStatus {
  return {
    id: "p", coverage: "property", carrier_name: "Acme", annual_premium: "12000.00", effective_from: "2026-03-01",
    effective_to: "2027-03-01", archived_at: null, replaced_by_policy_id: null, replaced_at: null, renewal_reminder_days: 60,
    status: "active", renewed: false, successor_id: null,
    ...over,
  } as PolicyWithStatus;
}

function finding(over: Partial<Finding>): Finding {
  return {
    id: "X", ruleId: "X", severity: "gap", basis: "statute", line: "do", policyId: null, title: "t", detail: "d", question: null,
    citation: null, missingFacts: [], notOnFile: false, answerableFields: [], dismissed: null,
    ...over,
  };
}

describe("quote request rows (§9.7 item 2)", () => {
  it("status chips say what happened, in words", () => {
    expect(requestChip("draft", null, TODAY)).toEqual({ tone: "info", text: "Draft ready" });
    expect(requestChip("sent", "2026-10-01T15:00:00Z", TODAY).text).toBe("Sent Oct 1");
    expect(requestChip("sent", "2025-12-30T15:00:00Z", TODAY).text).toBe("Sent Dec 30, 2025");
    expect(requestChip("quote_received", null, TODAY).text).toBe("Quote received");
    expect(requestChip("declined", null, TODAY).text).toBe("Declined");
    expect(requestChip("expired", null, TODAY).text).toBe("Expired");
    expect(requestChip("accepted", null, TODAY).text).toBe("Chosen");
  });

  it("a follow-up opens 7 days after sending", () => {
    expect(followUpOpensOn("2026-10-07T23:00:00Z")).toBe("2026-10-14");
    expect(canFollowUp("2026-10-07T09:00:00Z", TODAY)).toBe(true);
    expect(canFollowUp("2026-10-08T09:00:00Z", TODAY)).toBe(false);
    expect(canFollowUp(null, TODAY)).toBe(false);
  });

  it("addDays crosses months and years", () => {
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("quotes received (§9.7 item 3)", () => {
  it("validity: valid until, expiring within 7 days, expired", () => {
    expect(validityText(null, TODAY)).toBeNull();
    expect(validityText("2026-11-30", TODAY)).toEqual({ text: "Valid until Nov 30", warning: false });
    expect(validityText("2026-10-21", TODAY)).toEqual({ text: "Expires in 7 days", warning: true });
    expect(validityText("2026-10-15", TODAY)).toEqual({ text: "Expires in 1 day", warning: true });
    expect(validityText("2026-10-14", TODAY)).toEqual({ text: "Expires today", warning: true });
    expect(validityText("2026-10-13", TODAY)).toEqual({ text: "Expired", warning: true });
  });

  it("premium against now: whole percent from cents, no float", () => {
    expect(premiumVsNow("13440.00", "12000.00")).toBe("+12% vs now");
    expect(premiumVsNow("10560.00", "12000.00")).toBe("−12% vs now");
    expect(premiumVsNow("12000.00", "12000.00")).toBe("Same as now");
    expect(premiumVsNow("12001.00", "12000.00")).toBe("Same as now");
    expect(premiumVsNow("12000.00", null)).toBeNull();
    expect(premiumVsNow("12000.00", "0.00")).toBeNull();
  });
});

describe("emails (§9.7 item 4)", () => {
  it("status and who drafted it", () => {
    expect(messageStatusText("draft", null, TODAY)).toBe("Draft");
    expect(messageStatusText("sent", "2026-10-02T10:00:00Z", TODAY)).toBe("Sent Oct 2");
    expect(messageStatusText("cancelled", null, TODAY)).toBe("Cancelled");
    expect(draftedByLine("model")).toBe("Drafted by Walkup");
    expect(draftedByLine("template")).toBe("From Walkup's template");
    expect(draftedByLine("board")).toBe("Edited by you");
  });
});

describe("contacts (§9.6 item 3)", () => {
  it("source badges", () => {
    expect(contactSourceBadge("web", "2026-09-01T10:00:00Z", TODAY)).toBe("Found on the web Sep 1");
    expect(contactSourceBadge("policy", null, TODAY)).toBe("From a policy");
    expect(contactSourceBadge("partner", null, TODAY)).toBe("Listed with Walkup");
    expect(contactSourceBadge("manual", null, TODAY)).toBe("Added by you");
  });

  it("host names for source links", () => {
    expect(hostOf("https://www.acme-insurance.com/about")).toBe("acme-insurance.com");
    expect(hostOf("not a url")).toBe("not a url");
  });
});

describe("request flow (§9.7.2)", () => {
  it("the crime limit rounds the funds total up to the next $10,000", () => {
    expect(roundUpTo10k("184321.55")).toBe("190000.00");
    expect(roundUpTo10k("190000.00")).toBe("190000.00");
    expect(roundUpTo10k("0.01")).toBe("10000.00");
    expect(roundUpTo10k("0.00")).toBeNull();
    expect(roundUpTo10k(null)).toBeNull();
    expect(roundUpTo10k("junk")).toBeNull();
  });

  it("money inputs start formatted", () => {
    expect(moneyInputText("2400000.00")).toBe("$2,400,000");
    expect(moneyInputText(null)).toBe("");
  });

  it("what you'd ask for: lines in force, plus gap and ask findings marked as from the check", () => {
    const policies = [policy({ id: "m", coverage: "property" }), policy({ id: "g", coverage: "general_liability" }), policy({ id: "x", coverage: "umbrella", status: "expired" })];
    const check = {
      findings: [
        finding({ line: "do", severity: "gap" }),
        finding({ line: "crime", severity: "ask" }),
        finding({ line: "flood", severity: "info" }),
        finding({ line: "cyber", severity: "gap", dismissed: { reason: "n/a" } }),
        finding({ line: "property", severity: "gap" }),
      ],
    } as unknown as Parameters<typeof requestCoverages>[1];
    expect(requestCoverages(policies, check)).toEqual([
      { coverage: "property", fromCheck: false },
      { coverage: "general_liability", fromCheck: false },
      { coverage: "directors_officers", fromCheck: true },
      { coverage: "fidelity_crime", fromCheck: true },
    ]);
  });

  it("the in-force policy per coverage is the latest started", () => {
    const map = inForceByCoverage([
      policy({ id: "old", effective_from: "2025-03-01" }),
      policy({ id: "new", effective_from: "2026-03-01" }),
      policy({ id: "up", effective_from: "2027-03-01", status: "upcoming" }),
    ]);
    expect(map.get("property")?.id).toBe("new");
  });
});

describe("owner summary wording split (client-safe module)", () => {
  it("owner-summary.ts re-exports the same wording", () => {
    expect(ownerSummary.COVERAGE_FORM_OWNER_WORDS).toBe(ownerSummaryText.COVERAGE_FORM_OWNER_WORDS);
    expect(ownerSummary.LEFT_TO_OWNERS).toBe(ownerSummaryText.LEFT_TO_OWNERS);
    expect(ownerSummary.certificateInstructions).toBe(ownerSummaryText.certificateInstructions);
  });

  it("the client-safe module doesn't pull in node:crypto", async () => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(new URL("../../src/lib/insurance/owner-summary-text.ts", import.meta.url), "utf8");
    expect(text).not.toMatch(/from "node:crypto"/);
    expect(text).not.toMatch(/^import (?!type )[^;]*"\.\/owner-summary"/m);
  });
});
