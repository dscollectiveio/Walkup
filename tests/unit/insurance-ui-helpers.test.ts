import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { canRetry, effectiveState, itemCounts, itemState, readChip, type ReadRow } from "@/app/insurance/import/read-state";
import { questionFor, QUESTION_KEYS } from "@/app/insurance/facts/questions";
import { pagesLabel } from "@/app/insurance/review-data";
import { viewFor } from "@/app/insurance/components/insurance-tabs";
import { basisLabel } from "@/app/insurance/components/basis-chip";
import { policyChip } from "@/app/insurance/components/status-chip";
import { FACT_KEYS } from "@/lib/insurance/facts";

const NOW = Date.parse("2026-10-14T12:00:00Z");

function read(over: Partial<ReadRow> = {}): ReadRow {
  return {
    id: "r1", document_id: "d1", mode: "policy", state: "done", method: "text", attempts: 1,
    result: null, saved: {}, error: null, started_at: "2026-10-14T11:59:00Z", created_at: "2026-10-14T11:58:00Z",
    quote_request_id: null, replaces_policy_id: null, documents: { filename: "dec.pdf" },
    ...over,
  };
}

const twoPolicies = {
  documentKind: "renewal_package", notes: "", method: "text", pageCount: 3, redactedCount: 0, truncatedPolicies: 0, readAt: "",
  policies: [{}, {}],
} as unknown as ReadRow["result"];

describe("read-state", () => {
  it("a run still running past 330 s shows as timed out", () => {
    expect(effectiveState(read({ state: "running", started_at: "2026-10-14T11:54:00Z" }), NOW)).toBe("timed_out");
    expect(effectiveState(read({ state: "running", started_at: "2026-10-14T11:58:00Z" }), NOW)).toBe("running");
  });

  it("a read queued past 330 s that never started shows as timed out", () => {
    expect(effectiveState(read({ state: "queued", started_at: null, created_at: "2026-10-14T11:50:00Z" }), NOW)).toBe("timed_out");
    expect(effectiveState(read({ state: "queued", started_at: null, created_at: "2026-10-14T11:59:30Z" }), NOW)).toBe("queued");
  });

  it("items: saved, skipped, open", () => {
    const r = read({ result: twoPolicies, saved: { "0": { policy_id: "p1" } } });
    expect(itemState(r, 0)).toEqual({ kind: "saved", policyId: "p1" });
    expect(itemState(r, 1)).toEqual({ kind: "open" });
    expect(itemCounts(r)).toEqual({ total: 2, open: 1, saved: 1, skipped: 0 });
    expect(readChip(r, NOW).text).toBe("Partly saved");
    expect(readChip(read({ result: twoPolicies }), NOW).text).toBe("Ready to review");
    expect(readChip(read({ result: twoPolicies, saved: { "0": { policy_id: "p" }, "1": { quote_id: "q" } } }), NOW).text).toBe("Saved");
    expect(readChip(read({ result: twoPolicies, saved: { "0": { skipped: true }, "1": { skipped: true } } }), NOW).text).toBe("Skipped");
  });

  it("chips for running and failed reads", () => {
    expect(readChip(read({ state: "running" }), NOW).text).toBe("Reading…");
    expect(readChip(read({ state: "unreadable" }), NOW).text).toBe("Couldn't read");
  });

  it("retry: by state and the cap of 3", () => {
    expect(canRetry({ attempts: 1 }, "failed")).toBe(true);
    expect(canRetry({ attempts: 3 }, "timed_out")).toBe(false);
    expect(canRetry({ attempts: 0 }, "unreadable")).toBe(false);
    expect(canRetry({ attempts: 0 }, "quota")).toBe(true);
  });
});

describe("facts questions", () => {
  it("every fact key belongs to exactly one question", () => {
    for (const k of FACT_KEYS) {
      const owners = Object.entries(QUESTION_KEYS).filter(([, keys]) => keys.includes(k));
      expect(owners.length, k).toBe(1);
    }
    expect(questionFor("employee_count")).toBe("has_employees");
    expect(questionFor("owners_ho6_min_liability")).toBe("owners_must_carry_ho6");
    expect(questionFor("flood_zone")).toBe("flood_zone");
  });
});

describe("small UI helpers", () => {
  it("pagesLabel", () => {
    expect(pagesLabel([])).toBe("");
    expect(pagesLabel([2])).toBe(", page 2");
    expect(pagesLabel([3, 1, 2])).toBe(", pages 1 to 3");
  });

  it("viewFor keeps the legacy keys working", () => {
    expect(viewFor(undefined)).toBe("overview");
    expect(viewFor("quotes")).toBe("quotes");
    expect(viewFor("policy")).toBe("overview");
    expect(viewFor("nonsense")).toBe("overview");
  });

  it("basis labels", () => {
    expect(basisLabel("statute", "Illinois")).toBe("Illinois law");
    expect(basisLabel("common_practice", "Illinois")).toBe("Commonly carried");
    expect(basisLabel("your_documents", "Illinois")).toBe("Your declaration");
    expect(basisLabel("your_data", "Illinois")).toBe("Your numbers");
  });

  it("policy chips (§9.2)", () => {
    const base = { renewed: false, effective_from: "2026-03-01", effective_to: "2027-03-01", renewal_reminder_days: 60 };
    expect(policyChip({ ...base, status: "active" }, "2026-10-14")).toEqual({ tone: "good", text: "Active" });
    expect(policyChip({ ...base, status: "active" }, "2027-01-30")).toEqual({ tone: "warning", text: "Renews in 30 days" });
    expect(policyChip({ ...base, status: "active", renewed: true }, "2027-01-30")).toEqual({ tone: "info", text: "Renewal saved" });
    expect(policyChip({ ...base, status: "upcoming" }, "2026-01-01").text).toBe("Starts Mar 1");
    expect(policyChip({ ...base, status: "expired" }, "2027-05-01").text).toBe("Ended Mar 1");
    expect(policyChip({ ...base, status: "replaced" }, "2027-05-01")).toEqual({ tone: "neutral", text: "Replaced" });
    expect(policyChip({ ...base, status: "archived" }, "2027-05-01")).toEqual({ tone: "neutral", text: "Archived" });
  });
});
