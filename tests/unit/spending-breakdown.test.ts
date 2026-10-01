import { describe, expect, it } from "vitest";
import { buildBreakdown } from "@/components/home/charts/breakdown";

const slices = [
  { label: "Utilities", valueCents: 4100_00 },
  { label: "Insurance", valueCents: 7200_00 },
  { label: "Repairs", valueCents: 3800_00 },
  { label: "Landscaping", valueCents: 2000_00 },
  { label: "Fees", valueCents: 300_00 },
  { label: "Legal", valueCents: 200_00 },
  { label: "Software", valueCents: 100_00 },
];

describe("buildBreakdown", () => {
  it("ranks by size, shares the total, and folds the tail into Other", () => {
    const b = buildBreakdown(slices, { maxRows: 5, monthCount: 12 });
    expect(b.rows.map((r) => r.label)).toEqual(["Insurance", "Utilities", "Repairs", "Landscaping", "Other"]);
    expect(b.rows.at(-1)!.valueCents).toBe(600_00);
    expect(b.totalCents).toBe(17700_00);
    expect(b.rows[0].pctLabel).toBe(41);
    expect(b.rows.reduce((s, r) => s + r.pct, 0)).toBeCloseTo(100);
    expect(b.biggest?.label).toBe("Insurance");
  });

  it("gives a per-month average per row, or none without a month count", () => {
    expect(buildBreakdown(slices, { monthCount: 12 }).rows[0].perMonthCents).toBe(600_00);
    expect(buildBreakdown(slices).rows[0].perMonthCents).toBeNull();
  });

  it("never calls Other the biggest, and handles no spending", () => {
    const b = buildBreakdown([{ label: "A", valueCents: 1 }, { label: "B", valueCents: 1 }], { maxRows: 1 });
    expect(b.rows.map((r) => r.label)).toEqual(["Other"]);
    expect(b.biggest?.label).toBe("Other");
    expect(buildBreakdown([{ label: "A", valueCents: 0 }]).rows).toEqual([]);
  });
});
