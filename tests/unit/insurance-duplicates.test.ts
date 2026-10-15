import { describe, expect, it } from "vitest";
import { findDuplicatePolicy, type DuplicateCandidate } from "@/lib/insurance/duplicates";

const existing = (over: Partial<DuplicateCandidate> & { id: string }): DuplicateCandidate => ({
  coverage: "property",
  carrier_name: "West Bend Mutual Insurance Co.",
  effective_from: "2026-03-01",
  policy_number: "BOP 123-45",
  created_at: "2026-03-02T00:00:00Z",
  archived_at: null,
  ...over,
});

const candidate = { coverage: "property", carrier_name: "west bend mutual insurance company", effective_from: "2026-03-01", policy_number: "bop12345" };

describe("findDuplicatePolicy", () => {
  it("same coverage, carrier (Co. vs company, case, punctuation) and date → match", () => {
    expect(findDuplicatePolicy(candidate, [existing({ id: "a" })], null)?.id).toBe("a");
  });

  it("different policy numbers → no match", () => {
    expect(findDuplicatePolicy({ ...candidate, policy_number: "BOP-999" }, [existing({ id: "a" })], null)).toBeNull();
  });

  it("one number missing → match", () => {
    expect(findDuplicatePolicy({ ...candidate, policy_number: null }, [existing({ id: "a" })], null)?.id).toBe("a");
    expect(findDuplicatePolicy(candidate, [existing({ id: "a", policy_number: null })], null)?.id).toBe("a");
  });

  it("archived policies and the one being edited are ignored", () => {
    expect(findDuplicatePolicy(candidate, [existing({ id: "a", archived_at: "2026-04-01T00:00:00Z" })], null)).toBeNull();
    expect(findDuplicatePolicy(candidate, [existing({ id: "a" })], "a")).toBeNull();
  });

  it("different coverage or start date → no match; the oldest match wins", () => {
    expect(findDuplicatePolicy({ ...candidate, coverage: "umbrella" }, [existing({ id: "a" })], null)).toBeNull();
    expect(findDuplicatePolicy({ ...candidate, effective_from: "2026-03-02" }, [existing({ id: "a" })], null)).toBeNull();
    const found = findDuplicatePolicy(candidate, [
      existing({ id: "late", created_at: "2026-05-01T00:00:00Z" }),
      existing({ id: "early", created_at: "2026-03-01T00:00:00Z" }),
    ], null);
    expect(found?.id).toBe("early");
  });
});
