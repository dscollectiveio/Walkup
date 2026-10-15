import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  bidSchema, closeOutSchema, isoDate, MONEY_TEXT, normaliseMoneyInput, parseStoredTriage, storedTriageSchema,
  ticketDetailsSchema, ticketPlanSchema, ticketReportSchema,
} from "@/lib/repairs/validate";

const UUID = "11111111-1111-4111-8111-111111111111";
const firstMessage = (r: { success: boolean; error?: ZodError }) => r.error?.issues[0]?.message;

describe("money input", () => {
  it("normalises what people type", () => {
    expect(normaliseMoneyInput("$1,250.5")).toBe("1250.50");
    expect(normaliseMoneyInput("1250")).toBe("1250.00");
    expect(normaliseMoneyInput(" 980.25 ")).toBe("980.25");
    expect(normaliseMoneyInput("0.5")).toBe("0.50");
    expect(normaliseMoneyInput("007")).toBe("7.00");
    expect(normaliseMoneyInput("")).toBeNull();
    expect(normaliseMoneyInput("  ")).toBeNull();
  });

  it("refuses anything else with a ZodError", () => {
    for (const bad of ["1M", "-5", "1.234", "abc", "1,25.0.0", "1e3", "1234567890123"]) {
      expect(() => normaliseMoneyInput(bad), bad).toThrow(ZodError);
    }
    expect(MONEY_TEXT.test("999999999999.99")).toBe(true);
  });
});

describe("isoDate", () => {
  it("needs a real calendar date", () => {
    expect(isoDate.safeParse("2028-02-29").success).toBe(true);
    expect(isoDate.safeParse("2027-02-29").success).toBe(false);
    expect(isoDate.safeParse("2026-13-01").success).toBe(false);
    expect(isoDate.safeParse("10/14/2026").success).toBe(false);
  });
});

describe("ticketReportSchema", () => {
  const base = { clientKey: UUID, title: "Leak in the stairwell", where: "shared", priority: "normal", emergencyConfirmed: false };

  it("accepts a report and blanks empty optional text", () => {
    const r = ticketReportSchema.parse({ ...base, description: "  ", location_detail: "", access_notes: undefined });
    expect(r).toMatchObject({ title: "Leak in the stairwell", description: null, location_detail: null, access_notes: null });
    expect(ticketReportSchema.safeParse({ ...base, where: UUID }).success).toBe(true);
  });

  it("explains a short or long title", () => {
    expect(firstMessage(ticketReportSchema.safeParse({ ...base, title: " ab " }))).toBe("Give it a short title, at least 4 letters.");
    expect(firstMessage(ticketReportSchema.safeParse({ ...base, title: "x".repeat(121) }))).toBe("Keep the title under 120 characters.");
  });

  it("refuses a bad where, priority or client key", () => {
    expect(ticketReportSchema.safeParse({ ...base, where: "unit 2" }).success).toBe(false);
    expect(ticketReportSchema.safeParse({ ...base, priority: "panic" }).success).toBe(false);
    expect(ticketReportSchema.safeParse({ ...base, clientKey: "nope" }).success).toBe(false);
  });
});

describe("board schemas", () => {
  it("ticketDetailsSchema checks the trade and emergency kind", () => {
    const base = {
      title: "Leak", description: null, where: "shared", location_detail: null, access_notes: null, priority: "urgent",
      trade: "plumbing", emergency_kind: "flooding", priorityReason: null, accessNotesWhenShared: null,
    };
    expect(ticketDetailsSchema.safeParse(base).success).toBe(true);
    expect(firstMessage(ticketDetailsSchema.safeParse({ ...base, trade: "astrology" }))).toBe("Choose a kind of work.");
    expect(ticketDetailsSchema.safeParse({ ...base, emergency_kind: "volcano" }).success).toBe(false);
    expect(ticketDetailsSchema.safeParse({ ...base, trade: null, emergency_kind: null }).success).toBe(true);
  });

  it("ticketPlanSchema normalises the estimate and checks dates", () => {
    expect(ticketPlanSchema.parse({ estimated_cost: "$2,000", due_on: "2026-11-01" })).toEqual({ estimated_cost: "2000.00", due_on: "2026-11-01" });
    expect(ticketPlanSchema.safeParse({ scheduled_for: "2026-02-30" }).success).toBe(false);
    expect(ticketPlanSchema.parse({ estimated_cost: null })).toEqual({ estimated_cost: null });
  });

  it("closeOutSchema", () => {
    expect(closeOutSchema.parse({ status: "resolved", actual_cost: "1,100", expense_id: null, resolution_note: " Replaced the trap ", log_upkeep: true }))
      .toEqual({ status: "resolved", actual_cost: "1100.00", expense_id: null, resolution_note: "Replaced the trap", log_upkeep: true });
    expect(closeOutSchema.safeParse({ status: "open", actual_cost: null, expense_id: null, resolution_note: null, log_upkeep: false }).success).toBe(false);
  });

  it("bidSchema needs an amount", () => {
    const base = {
      ticket_id: UUID, vendor_id: UUID, bid_id: null, amount: "4,250", amount_kind: "fixed", received_on: "2026-10-10", valid_until: null,
      can_start_on: null, duration_text: null, scope_text: null, warranty_text: null, exclusions_text: null, payment_terms_text: null,
      notes: null, document_id: null,
    };
    expect(bidSchema.parse(base).amount).toBe("4250.00");
    expect(firstMessage(bidSchema.safeParse({ ...base, amount: "" }))).toBe("Enter the amount they quoted.");
    expect(bidSchema.safeParse({ ...base, amount: "-1" }).success).toBe(false);
  });
});

describe("storedTriageSchema", () => {
  const ok = { state: "done", trade: "plumbing", urgency: "urgent", emergency: "flooding", search_phrase: "pipe leak", questions: ["Is it still dripping?"], confidence: 0.8, at: "2026-10-14T12:00:00Z" };

  it("accepts a good triage", () => {
    expect(storedTriageSchema.safeParse(ok).success).toBe(true);
    expect(parseStoredTriage({ state: "skipped", reason: "quota", at: "2026-10-14T12:00:00Z" })).toEqual({ state: "skipped", reason: "quota", at: "2026-10-14T12:00:00Z" });
  });

  it("refuses unknown keys, four questions and bad enums", () => {
    expect(parseStoredTriage({ ...ok, hack: 1 })).toBeNull();
    expect(parseStoredTriage({ ...ok, questions: ["a", "b", "c", "d"] })).toBeNull();
    expect(parseStoredTriage({ ...ok, questions: ["x".repeat(141)] })).toBeNull();
    expect(parseStoredTriage({ ...ok, urgency: "panic" })).toBeNull();
    expect(parseStoredTriage({ ...ok, emergency: "volcano" })).toBeNull();
    expect(parseStoredTriage({ ...ok, state: "maybe" })).toBeNull();
    expect(parseStoredTriage({ ...ok, trade: "astrology" })).toBeNull();
    expect(parseStoredTriage({ ...ok, confidence: 2 })).toBeNull();
    expect(parseStoredTriage({ ...ok, at: undefined })).toBeNull();
    expect(parseStoredTriage("done")).toBeNull();
  });
});
