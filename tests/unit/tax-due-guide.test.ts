import { describe, expect, it } from "vitest";
import { dueGuide } from "@/lib/tax/due-guide";

const base = { verified: false, hasDate: true, incorporatedOn: "2004-03-11", fiscalYearEnd: "2026-12-31" };

describe("how to get a due date", () => {
  it("says nothing for a checked date", () => {
    expect(dueGuide({ ...base, formCode: "irs_1120h", verified: true })).toBeNull();
  });

  it("explains the 1120-H rule and the June 30 exception", () => {
    expect(dueGuide({ ...base, formCode: "irs_1120h" })?.how).toMatch(/April 15/);
    expect(dueGuide({ ...base, formCode: "irs_1120h", fiscalYearEnd: "2026-06-30" })?.how).toMatch(/June 30/);
  });

  it("tells the board to add the incorporation date for the Illinois annual report, with the link", () => {
    const g = dueGuide({ ...base, formCode: "il_sos_annual_report", incorporatedOn: null });
    expect(g?.set).toEqual([{ label: "Add your incorporation date", href: "/building" }]);
    expect(dueGuide({ ...base, formCode: "il_sos_annual_report" })?.set).toEqual([]);
  });

  it("covers the 1099-NEC and 1096", () => {
    expect(dueGuide({ ...base, formCode: "irs_1099_nec" })?.how).toMatch(/January 31/);
    expect(dueGuide({ ...base, formCode: "irs_1096" })?.how).toMatch(/online/);
  });
});
