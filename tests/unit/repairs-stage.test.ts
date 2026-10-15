import { describe, expect, it } from "vitest";
import { compareForTriage, STAGE_LABEL, STAGES, ticketStage, type SortableTicket } from "@/lib/repairs/stage";

const TODAY = "2026-10-14";
const NO_BIDS = { requested: 0, received: 0, accepted: 0 };
const t = (over: Partial<Parameters<typeof ticketStage>[0]> = {}) => ({
  status: "open" as const, assigned_vendor_id: null, scheduled_for: null, ...over,
});

describe("ticketStage", () => {
  it("closed and fixed come first, whatever else is set", () => {
    expect(ticketStage(t({ status: "closed", scheduled_for: "2026-10-20" }), NO_BIDS, TODAY)).toBe("closed");
    expect(ticketStage(t({ status: "resolved", scheduled_for: "2026-10-20" }), { requested: 1, received: 0, accepted: 0 }, TODAY)).toBe("fixed");
  });

  it("a visit today or later is scheduled; a past one isn't", () => {
    expect(ticketStage(t({ scheduled_for: TODAY }), NO_BIDS, TODAY)).toBe("scheduled");
    expect(ticketStage(t({ status: "in_progress", scheduled_for: "2026-10-20" }), NO_BIDS, TODAY)).toBe("scheduled");
    expect(ticketStage(t({ scheduled_for: "2026-10-13" }), NO_BIDS, TODAY)).toBe("new");
  });

  it("in progress or waiting on the contractor is being worked on", () => {
    expect(ticketStage(t({ status: "in_progress" }), NO_BIDS, TODAY)).toBe("in_progress");
    expect(ticketStage(t({ status: "waiting_on_contractor", assigned_vendor_id: "v" }), NO_BIDS, TODAY)).toBe("in_progress");
  });

  it("quotes asked for or in, none accepted, is getting quotes", () => {
    expect(ticketStage(t(), { requested: 2, received: 0, accepted: 0 }, TODAY)).toBe("quoting");
    expect(ticketStage(t(), { requested: 0, received: 1, accepted: 0 }, TODAY)).toBe("quoting");
    expect(ticketStage(t({ assigned_vendor_id: "v" }), { requested: 1, received: 1, accepted: 1 }, TODAY)).toBe("chosen");
  });

  it("a contractor chosen while still open is chosen; otherwise new", () => {
    expect(ticketStage(t({ assigned_vendor_id: "v" }), NO_BIDS, TODAY)).toBe("chosen");
    expect(ticketStage(t(), NO_BIDS, TODAY)).toBe("new");
  });

  it("labels every stage", () => {
    expect(STAGES.map((s) => STAGE_LABEL[s])).toEqual(["New", "Getting quotes", "Contractor chosen", "Visit planned", "Being worked on", "Fixed", "Closed"]);
  });
});

describe("compareForTriage", () => {
  const row = (id: string, over: Partial<SortableTicket>): SortableTicket & { id: string } => ({
    id, emergency_kind: null, priority: "normal", due_on: null, created_at: "2026-10-01T10:00:00Z", ...over,
  });

  it("orders emergencies, then urgent, then overdue target dates, then newest", () => {
    const rows = [
      row("old-normal", { created_at: "2026-09-01T10:00:00Z" }),
      row("new-normal", { created_at: "2026-10-10T10:00:00Z" }),
      row("overdue", { due_on: "2026-10-01", created_at: "2026-08-01T10:00:00Z" }),
      row("due-later", { due_on: "2026-11-01", created_at: "2026-08-02T10:00:00Z" }),
      row("urgent", { priority: "urgent", created_at: "2026-07-01T10:00:00Z" }),
      row("emergency-low", { emergency_kind: "gas", priority: "low", created_at: "2026-06-01T10:00:00Z" }),
      row("emergency-urgent", { emergency_kind: "flooding", priority: "urgent", created_at: "2026-05-01T10:00:00Z" }),
    ];
    const sorted = [...rows].sort((a, b) => compareForTriage(a, b, TODAY)).map((r) => r.id);
    expect(sorted).toEqual(["emergency-urgent", "emergency-low", "urgent", "overdue", "new-normal", "old-normal", "due-later"]);
  });

  it("a target date of today is not overdue; ties fall to the higher reference", () => {
    const a = row("a", { due_on: TODAY, reference: 3 });
    const b = row("b", { reference: 4 });
    expect(compareForTriage(a, b, TODAY)).toBeGreaterThan(0);
    expect(compareForTriage(b, a, TODAY)).toBeLessThan(0);
  });
});
