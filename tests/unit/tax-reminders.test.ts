import { describe, expect, it } from "vitest";
import { assembleReminders, homeTaxDeadlines, nextFilingReminder, type HomeTaxRows } from "@/lib/home/reminders";
import type { Deadline } from "@/lib/tax/deadlines";

// The first of February 2026 for an Illinois building on a calendar fiscal
// year: 2025 has ended, its 1099s were due yesterday, the annual report (March
// anniversary) is at the end of this month and the 1120-H is in April. The
// $600 threshold is the one in force on Dec 31, 2025.
const FY2024 = { id: "fy-2024", label: "2024", starts_on: "2024-01-01", ends_on: "2024-12-31" };
const FY2025 = { id: "fy-2025", label: "2025", starts_on: "2025-01-01", ends_on: "2025-12-31" };
const FY2026 = { id: "fy-2026", label: "2026", starts_on: "2026-01-01", ends_on: "2026-12-31" };

function rows(over: Partial<HomeTaxRows> = {}): HomeTaxRows {
  return {
    todayIso: "2026-02-01",
    association: {
      stateCode: "IL",
      fiscalYearEndMonth: 12,
      incorporatedOn: "2004-03-11",
      informationReturnsFiling: "paper",
      accountantSet: false,
    },
    fiscalYears: [FY2024, FY2025, FY2026],
    contractorYear: 2025,
    thresholdCents: 60000,
    contractors: [
      { vendorId: "v-acme", name: "Acme Plumbing", totalCents: 500000, w9OnFile: false },
      { vendorId: "v-snow", name: "Snow Co", totalCents: 120000, w9OnFile: true },
      { vendorId: "v-small", name: "Small Jobs", totalCents: 40000, w9OnFile: false },
    ],
    templates: [],
    forms: [],
    locked1120hFiscalYearIds: [],
    ...over,
  };
}

const keysOf = (r: HomeTaxRows) => homeTaxDeadlines(r).deadlines.map((d) => d.key);
const at = (iso: string) => new Date(`${iso}T00:00:00`).getTime();
const TODAY = new Date("2026-02-01T00:00:00");

/** A hand-built deadline, for the cases that need an exact shape. */
const deadline = (over: Partial<Deadline> & Pick<Deadline, "key" | "formCode" | "dueOn">): Deadline => ({
  taxYear: 2025,
  name: "Form 1120-H",
  kind: "Federal tax return",
  basis: "estimated",
  citation: null,
  note: null,
  status: "not_started",
  formId: null,
  overdue: false,
  daysLeft: null,
  href: "/tax#forms",
  milestones: [],
  ...over,
});

describe("homeTaxDeadlines — the light list Home builds from its own rows", () => {
  it("lists the return, the Illinois filings and one 1099 per contractor at or above the threshold", () => {
    const { deadlines, filingYear, contractorsMissingW9 } = homeTaxDeadlines(rows());
    expect(filingYear?.id).toBe("fy-2025");
    expect(deadlines.map((d) => `${d.key} ${d.dueOn}`)).toEqual([
      "irs_1099_nec:2025:v-acme 2026-01-31",
      "irs_1099_nec:2025:v-snow 2026-01-31",
      "irs_1096:2025 2026-01-31",
      "il_sos_annual_report:2025 2026-02-28",
      "irs_1120h:2025 2026-04-15",
      "il_1120:2025 2026-04-15",
    ]);
    expect(deadlines.find((d) => d.key === "irs_1099_nec:2025:v-acme")?.name).toBe("1099-NEC: Acme Plumbing");
    // Every date is a built-in estimate, and says so.
    expect(deadlines.every((d) => d.basis === "estimated")).toBe(true);
    // Small Jobs is under the threshold, so only Acme's missing W-9 counts.
    expect(contractorsMissingW9).toBe(1);
  });

  it("applies the threshold at or above, and counts the W-9 gaps the same way", () => {
    const exactly = rows({ contractors: [{ vendorId: "v-edge", name: "Edge", totalCents: 60000, w9OnFile: false }] });
    expect(keysOf(exactly)).toContain("irs_1099_nec:2025:v-edge");
    expect(homeTaxDeadlines(exactly).contractorsMissingW9).toBe(1);

    const under = rows({ contractors: [{ vendorId: "v-edge", name: "Edge", totalCents: 59999, w9OnFile: false }] });
    expect(keysOf(under).some((k) => k.startsWith("irs_1099_nec"))).toBe(false);
    expect(keysOf(under)).not.toContain("irs_1096:2025");
    expect(homeTaxDeadlines(under).contractorsMissingW9).toBe(0);
  });

  it("with no threshold on file, keeps one 1099 row with nobody behind it and nudges everyone paid for a W-9", () => {
    const r = homeTaxDeadlines(rows({ thresholdCents: null }));
    const nec = r.deadlines.filter((d) => d.formCode === "irs_1099_nec");
    expect(nec.map((d) => d.key)).toEqual(["irs_1099_nec:2025"]);
    expect(nec[0].name).toBe("Form 1099-NEC");
    expect(nec[0].vendorId).toBeUndefined();
    // No contractor is "over" an unknown threshold, so no Form 1096 either.
    expect(r.deadlines.some((d) => d.formCode === "irs_1096")).toBe(false);
    expect(r.contractorsMissingW9).toBe(2);
  });

  it("dates Form 1096 only when the board files 1099s on paper and someone is over the threshold", () => {
    const method = (m: HomeTaxRows["association"]["informationReturnsFiling"]) =>
      keysOf(rows({ association: { ...rows().association, informationReturnsFiling: m } }));
    expect(method("paper")).toContain("irs_1096:2025");
    expect(method("electronic")).not.toContain("irs_1096:2025");
    expect(method(null)).not.toContain("irs_1096:2025");
    expect(keysOf(rows({ contractors: [] }))).not.toContain("irs_1096:2025");
  });

  it("without a fiscal year on file, skips the return but still dates the 1099s and the annual report", () => {
    const r = homeTaxDeadlines(rows({ fiscalYears: [] }));
    expect(r.filingYear).toBeNull();
    expect(r.deadlines.some((d) => d.formCode === "irs_1120h" || d.formCode === "il_1120")).toBe(false);
    expect(r.deadlines.map((d) => d.key)).toEqual(
      expect.arrayContaining(["irs_1099_nec:2025:v-acme", "irs_1096:2025", "il_sos_annual_report:2026"]),
    );
    expect(r.deadlines.find((d) => d.formCode === "il_sos_annual_report")?.dueOn).toBe("2026-02-28");
  });

  it("gives Illinois filings only to Illinois buildings, and no annual report without an incorporation date", () => {
    const nh = keysOf(rows({ association: { ...rows().association, stateCode: "NH" } }));
    expect(nh.some((k) => k.startsWith("il_"))).toBe(false);
    expect(nh).toContain("irs_1120h:2025");

    const noDate = keysOf(rows({ association: { ...rows().association, incorporatedOn: null } }));
    expect(noDate).toContain("il_1120:2025");
    expect(noDate.some((k) => k.startsWith("il_sos_annual_report"))).toBe(false);
  });

  it("picks the filing year the way the Taxes tab does: the year just ended until its return is filed", () => {
    const filed = rows({
      forms: [{ id: "f1", formCode: "irs_1120h", taxYear: 2025, vendorId: null, status: "filed", filedOn: "2026-01-20", sentToAccountantAt: null }],
    });
    const r = homeTaxDeadlines(filed);
    expect(r.filingYear?.id).toBe("fy-2026");
    expect(r.deadlines.find((d) => d.formCode === "irs_1120h")).toMatchObject({ key: "irs_1120h:2026", dueOn: "2027-04-15" });

    const locked = homeTaxDeadlines(rows({ locked1120hFiscalYearIds: ["fy-2025"] }));
    expect(locked.filingYear?.id).toBe("fy-2026");
  });

  it("lets a verified, active template's cited rule replace the estimate", () => {
    const r = homeTaxDeadlines(
      rows({
        templates: [
          {
            formCode: "irs_1120h",
            taxYear: 2025,
            dueRule: "FY_END + 4 MONTHS, DAY 15",
            dueRuleCitation: "Instructions for Form 1120-H (2025), When To File",
            notes: null,
            verified: true,
            active: true,
          },
        ],
      }),
    );
    expect(r.deadlines.find((d) => d.key === "irs_1120h:2025")).toMatchObject({
      dueOn: "2026-04-15",
      basis: "verified",
      citation: "Instructions for Form 1120-H (2025), When To File",
    });
    expect(r.deadlines.find((d) => d.key === "il_1120:2025")?.basis).toBe("estimated");
  });

  it("asks to send the figures to the accountant 60 days ahead once one is on file", () => {
    const r = homeTaxDeadlines(rows({ association: { ...rows().association, accountantSet: true } }));
    expect(r.deadlines.find((d) => d.key === "irs_1120h:2025")?.milestones).toEqual([
      { key: "send", label: "Send Form 1120-H to your accountant", on: "2026-02-14" },
    ]);
  });
});

describe("assembleReminders — tax deadlines in Coming up", () => {
  const base = { bills: [], policies: [], upcomingChargeDates: [], today: TODAY };
  const remind = (over: Partial<HomeTaxRows> = {}, today = TODAY) =>
    assembleReminders({ ...base, today, taxDeadlines: homeTaxDeadlines(rows({ todayIso: today.toISOString().slice(0, 10), ...over })).deadlines });

  it("groups the 1099s into one row on the earliest date, keyed by year, and never lists a contractor on its own", () => {
    const r = remind();
    const nec = r.find((x) => x.filingKey === "irs_1099_nec:2025")!;
    expect(nec).toMatchObject({ name: "2 1099-NECs to contractors", kind: "Federal filing", unverified: true, overdue: true });
    expect(nec.due.getTime()).toBe(at("2026-01-31"));
    expect(r.filter((x) => x.name.includes("1099")).length).toBe(1);

    const one = remind({ contractors: [{ vendorId: "v-acme", name: "Acme Plumbing", totalCents: 500000, w9OnFile: true }] });
    expect(one.find((x) => x.filingKey === "irs_1099_nec:2025")?.name).toBe("1 1099-NEC to a contractor");

    // The "threshold not on file" row has no count to give.
    expect(remind({ thresholdCents: null }).find((x) => x.filingKey === "irs_1099_nec:2025")?.name).toBe("1099-NECs to contractors");
  });

  it("gives every other dated deadline its own row, keyed, and flags an estimate in words", () => {
    const r = remind();
    const h = r.find((x) => x.filingKey === "irs_1120h:2025")!;
    expect(h).toMatchObject({ name: "Form 1120-H", kind: "Federal tax return", unverified: true, overdue: false });
    expect(h.due.getTime()).toBe(at("2026-04-15"));
    expect(r.map((x) => x.filingKey).filter(Boolean)).toEqual([
      "irs_1099_nec:2025",
      "irs_1096:2025",
      "il_sos_annual_report:2025",
      "irs_1120h:2025",
      "il_1120:2025",
    ]);

    const verified = remind({
      templates: [{ formCode: "irs_1120h", taxYear: 2025, dueRule: "FY_END + 4 MONTHS, DAY 15", dueRuleCitation: "cited", notes: null, verified: true, active: true }],
    });
    expect(verified.find((x) => x.filingKey === "irs_1120h:2025")?.unverified).toBe(false);
    expect(verified.find((x) => x.filingKey === "il_1120:2025")?.unverified).toBe(true);
  });

  it("turns a milestone inside the 120-day horizon into a nudge that says what it's for", () => {
    const r = remind({ association: { ...rows().association, accountantSet: true } });
    const send = r.find((x) => x.name === "Send Form 1120-H to your accountant")!;
    expect(send).toMatchObject({ kind: "Form 1120-H due April 15", unverified: true });
    expect(send.due.getTime()).toBe(at("2026-02-14"));
    expect(send.filingKey).toBeUndefined();
    // The nudge sorts ahead of the filing it belongs to.
    expect(r.findIndex((x) => x === send)).toBeLessThan(r.findIndex((x) => x.filingKey === "irs_1120h:2025"));
  });

  it("groups the 1099 nudges the same way, naming the contractor when there is just one", () => {
    // October: this year's contractors (Acme and Snow Co clear the threshold),
    // due next January, "send" on December 2.
    const october = new Date("2026-10-20T00:00:00");
    const r = remind(
      { fiscalYears: [FY2026], contractorYear: 2026, association: { ...rows().association, accountantSet: true } },
      october,
    );
    const send = r.find((x) => x.name === "Send 2 1099-NECs to your accountant")!;
    expect(send).toMatchObject({ kind: "1099-NECs due January 31, 2027", unverified: true });
    expect(send.due.getTime()).toBe(at("2026-12-02"));
    expect(r.some((x) => x.name.startsWith("Send 1099-NEC: "))).toBe(false);

    const one = remind(
      {
        fiscalYears: [FY2026],
        contractorYear: 2026,
        contractors: [{ vendorId: "v-acme", name: "Acme Plumbing", totalCents: 500000, w9OnFile: true }],
        association: { ...rows().association, accountantSet: true },
      },
      october,
    );
    expect(one.find((x) => x.name === "Send 1099-NEC: Acme Plumbing to your accountant")).toMatchObject({ kind: "1099-NEC due January 31, 2027" });
  });

  it("reads a slipped milestone as today, drops one beyond the horizon, and none once the filing itself is overdue", () => {
    const slipped = deadline({
      key: "irs_1120h:2025",
      formCode: "irs_1120h",
      dueOn: "2026-04-15",
      milestones: [{ key: "start", label: "Start Form 1120-H", on: "2026-01-20" }],
    });
    const far = deadline({
      key: "il_sos_annual_report:2026",
      formCode: "il_sos_annual_report",
      name: "Illinois annual report",
      kind: "Secretary of State",
      dueOn: "2026-12-31",
      milestones: [{ key: "start", label: "Start Illinois annual report", on: "2026-11-16" }],
    });
    const late = deadline({
      key: "irs_1096:2025",
      formCode: "irs_1096",
      name: "Form 1096",
      kind: "Federal filing",
      dueOn: "2026-01-31",
      overdue: true,
      milestones: [{ key: "send", label: "Send Form 1096 to your accountant", on: "2025-12-02" }],
    });
    const r = assembleReminders({ ...base, taxDeadlines: [slipped, far, late] });
    const start = r.find((x) => x.name === "Start Form 1120-H")!;
    expect(start.due.getTime()).toBe(TODAY.getTime());
    expect(r.some((x) => x.name === "Start Illinois annual report")).toBe(false);
    expect(r.some((x) => x.name === "Send Form 1096 to your accountant")).toBe(false);
    // The overdue filing itself stays, on its real date.
    expect(r.find((x) => x.filingKey === "irs_1096:2025")).toMatchObject({ overdue: true });
    expect(r.find((x) => x.filingKey === "irs_1096:2025")!.due.getTime()).toBe(at("2026-01-31"));
  });

  it("leaves out a deadline Walkup won't put a date on", () => {
    const undated = deadline({ key: "irs_1120:2025", formCode: "irs_1120", name: "Form 1120", dueOn: null, basis: "none" });
    expect(assembleReminders({ ...base, taxDeadlines: [undated] })).toEqual([]);
  });

  it("says nothing about taxes without deadlines, and keeps the December 1 W-9 nudge", () => {
    const quiet = assembleReminders({ ...base, today: new Date("2026-09-30T00:00:00"), contractorsMissingW9: 2 });
    expect(quiet.map((x) => x.name)).toEqual(["Collect 2 W-9s"]);
    expect(quiet[0].due.getTime()).toBe(at("2026-12-01"));
    expect(nextFilingReminder(quiet)).toBeNull();
  });
});

describe("nextFilingReminder", () => {
  it("is the soonest filing by key — a bill or a nudge due sooner doesn't count", () => {
    const r = assembleReminders({
      bills: [{ name: "Water", next_due_on: "2026-02-05", autopay_arranged: false }],
      policies: [],
      upcomingChargeDates: [],
      today: TODAY,
      taxDeadlines: homeTaxDeadlines(rows({ contractors: [], association: { ...rows().association, accountantSet: true } })).deadlines,
    });
    // The annual report's "send" nudge slipped (Dec 30) and reads as today;
    // then Water (Feb 5) and "Send Form 1120-H" (Feb 14) — all ahead of the
    // first filing itself, the annual report on Feb 28.
    expect(r.slice(0, 3).map((x) => x.name)).toEqual([
      "Send Illinois annual report to your accountant",
      "Water",
      "Send Form 1120-H to your accountant",
    ]);
    expect(nextFilingReminder(r)).toMatchObject({ name: "Illinois annual report", filingKey: "il_sos_annual_report:2025" });
  });

  it("is an overdue filing first, since it sorts first", () => {
    expect(nextFilingReminder(assembleReminders({ bills: [], policies: [], upcomingChargeDates: [], today: TODAY, taxDeadlines: homeTaxDeadlines(rows()).deadlines }))).toMatchObject({
      filingKey: "irs_1099_nec:2025",
      overdue: true,
    });
  });
});
