import { describe, expect, it } from "vitest";
import {
  ESTIMATED_NOTE,
  addDays,
  daysBetween,
  filingYearFor,
  nextDeadline,
  taxDeadlines,
  type DeadlineForm,
  type DeadlineInput,
  type DeadlineTemplate,
} from "@/lib/tax/deadlines";

// A December fiscal year that has just ended, seen on the first of February:
// the 1120-H is coming up, the 1099s were due yesterday-ish, the Illinois
// annual report (March anniversary) is at the end of this month.
const FY2025 = { id: "fy-2025", label: "2025", startsOn: "2025-01-01", endsOn: "2025-12-31", taxYear: 2025 };

function input(over: Partial<DeadlineInput> = {}): DeadlineInput {
  return {
    today: "2026-02-01",
    association: { stateCode: "IL", fiscalYearEndMonth: 12, incorporatedOn: "2004-03-11", informationReturnsFiling: "paper" },
    fiscalYear: FY2025,
    contractorYear: 2025,
    templates: [],
    forms: [],
    locked1120hFiscalYearIds: [],
    outcomes: [
      { formCode: "irs_1120h", taxYear: 2025, determination: "eligible", name: "Form 1120-H" },
      { formCode: "il_1120", taxYear: 2025, determination: "ask_cpa", name: "Illinois IL-1120" },
      { formCode: "il_sos_annual_report", taxYear: 2025, determination: "required", name: "Illinois annual report" },
      { formCode: "irs_1099_nec", taxYear: 2025, vendorId: "v-acme", determination: "required", name: "1099-NEC — Acme Plumbing" },
      { formCode: "irs_1099_nec", taxYear: 2025, vendorId: "v-snow", determination: "required", name: "1099-NEC — Snow Co" },
      { formCode: "irs_1096", taxYear: 2025, determination: "required", name: "Form 1096" },
    ],
    accountantSet: false,
    ...over,
  };
}

const form = (over: Partial<DeadlineForm> & Pick<DeadlineForm, "formCode" | "taxYear">): DeadlineForm => ({
  id: `form-${over.formCode}-${over.taxYear}${over.vendorId ? `-${over.vendorId}` : ""}`,
  vendorId: null,
  status: "not_started",
  filedOn: null,
  sentToAccountantAt: null,
  ...over,
});

const template = (over: Partial<DeadlineTemplate> & Pick<DeadlineTemplate, "formCode" | "taxYear" | "dueRule">): DeadlineTemplate => ({
  dueRuleCitation: "a citation",
  notes: null,
  verified: true,
  active: true,
  ...over,
});

const byKey = (input_: DeadlineInput) => new Map(taxDeadlines(input_).map((d) => [d.key, d]));

describe("taxDeadlines — where a date comes from", () => {
  it("lets a verified, active template's cited rule beat the estimate, and carries its notes", () => {
    const d = byKey(
      input({
        templates: [
          template({
            formCode: "irs_1120h",
            taxYear: 2025,
            dueRule: "FY_END + 4 MONTHS, DAY 15",
            dueRuleCitation: "Instructions for Form 1120-H (2025), When To File",
            notes: "A due date on a weekend moves to the next business day.",
          }),
        ],
      }),
    ).get("irs_1120h:2025")!;
    expect(d).toMatchObject({
      dueOn: "2026-04-15",
      basis: "verified",
      citation: "Instructions for Form 1120-H (2025), When To File",
      note: "A due date on a weekend moves to the next business day.",
    });
  });

  it("ignores a template that is unverified, inactive, for another year, or has a rule it can't read", () => {
    const cases: DeadlineTemplate[][] = [
      [template({ formCode: "irs_1120h", taxYear: 2025, dueRule: "FY_END + 5 MONTHS, DAY 15", verified: false })],
      [template({ formCode: "irs_1120h", taxYear: 2025, dueRule: "FY_END + 5 MONTHS, DAY 15", active: false })],
      [template({ formCode: "irs_1120h", taxYear: 2024, dueRule: "FY_END + 5 MONTHS, DAY 15" })],
      [template({ formCode: "irs_1120h", taxYear: 2025, dueRule: "April 15" })],
    ];
    for (const templates of cases) {
      const d = byKey(input({ templates })).get("irs_1120h:2025")!;
      expect(d).toMatchObject({ dueOn: "2026-04-15", basis: "estimated", citation: null, note: ESTIMATED_NOTE });
    }
  });

  it("estimates 1120-H and IL-1120 on the 15th of the 4th month after the fiscal year ends — and says so", () => {
    const dec = byKey(input());
    expect(dec.get("irs_1120h:2025")).toMatchObject({ dueOn: "2026-04-15", basis: "estimated", note: ESTIMATED_NOTE, kind: "Federal tax return" });
    expect(dec.get("il_1120:2025")).toMatchObject({ dueOn: "2026-04-15", basis: "estimated", note: ESTIMATED_NOTE, kind: "Illinois return" });

    const march = byKey(
      input({
        today: "2026-04-10",
        fiscalYear: { id: "fy-mar", label: "2025–26", startsOn: "2025-04-01", endsOn: "2026-03-31", taxYear: 2026 },
        outcomes: [{ formCode: "irs_1120h", taxYear: 2026, determination: "eligible" }],
      }),
    );
    expect(march.get("irs_1120h:2026")).toMatchObject({ dueOn: "2026-07-15", basis: "estimated", name: "Form 1120-H" });
  });

  it("won't estimate a June-30 year: basis none, with the reason and 'ask your CPA'", () => {
    const d = byKey(
      input({
        today: "2026-07-10",
        fiscalYear: { id: "fy-jun", label: "2025–26", startsOn: "2025-07-01", endsOn: "2026-06-30", taxYear: 2026 },
        outcomes: [{ formCode: "irs_1120h", taxYear: 2026, determination: "eligible" }],
        accountantSet: true,
      }),
    ).get("irs_1120h:2026")!;
    expect(d.basis).toBe("none");
    expect(d.dueOn).toBeNull();
    expect(d.daysLeft).toBeNull();
    expect(d.overdue).toBe(false);
    expect(d.note).toContain("June 30");
    expect(d.note).toContain("Ask your CPA");
    expect(d.milestones).toEqual([]);
  });

  it("won't use a verified FY_END rule for a June-30 year either: the general rule doesn't cover it", () => {
    const june = { id: "fy-jun", label: "2025–26", startsOn: "2025-07-01", endsOn: "2026-06-30", taxYear: 2026 };
    const templates = [
      template({ formCode: "irs_1120h", taxYear: 2026, dueRule: "FY_END + 4 MONTHS, DAY 15", notes: "June 30 year ends: the 3rd month." }),
      template({ formCode: "il_1120", taxYear: 2026, dueRule: "FY_END + 4 MONTHS, DAY 15" }),
    ];
    const outcomes = [
      { formCode: "irs_1120h", taxYear: 2026, determination: "eligible" },
      { formCode: "il_1120", taxYear: 2026, determination: "ask_cpa" },
    ];
    const rows = byKey(input({ today: "2026-07-10", fiscalYear: june, templates, outcomes }));
    for (const key of ["irs_1120h:2026", "il_1120:2026"]) {
      const d = rows.get(key)!;
      expect(d).toMatchObject({ basis: "none", dueOn: null, citation: null, daysLeft: null, overdue: false, milestones: [] });
      expect(d.note).toContain("June 30");
      expect(d.note).toContain("Ask your CPA");
    }
  });

  it("has no estimate for Form 1120 — none, ask your CPA — unless a verified template says otherwise", () => {
    const outcomes = [{ formCode: "irs_1120", taxYear: 2025, determination: "likely_required" }];
    const none = byKey(input({ outcomes })).get("irs_1120:2025")!;
    expect(none).toMatchObject({ basis: "none", dueOn: null });
    expect(none.note).toContain("Ask your CPA");
    const verified = byKey(
      input({ outcomes, templates: [template({ formCode: "irs_1120", taxYear: 2025, dueRule: "FY_END + 4 MONTHS, DAY 15", dueRuleCitation: "Form 1120 instructions" })] }),
    ).get("irs_1120:2025")!;
    expect(verified).toMatchObject({ basis: "verified", dueOn: "2026-04-15", citation: "Form 1120 instructions" });
  });

  it("puts 1099-NECs on January 31 after the payment year, one per contractor, keyed by vendor", () => {
    const d = byKey(input());
    expect(d.get("irs_1099_nec:2025:v-acme")).toMatchObject({
      dueOn: "2026-01-31",
      basis: "estimated",
      vendorId: "v-acme",
      name: "1099-NEC — Acme Plumbing",
      kind: "Federal filing",
      overdue: true,
      daysLeft: -1,
    });
    expect(d.get("irs_1099_nec:2025:v-snow")!.dueOn).toBe("2026-01-31");
  });

  it("shows Form 1096 only when the board files 1099s on paper", () => {
    expect(byKey(input()).get("irs_1096:2025")).toMatchObject({ dueOn: "2026-01-31", basis: "estimated", name: "Form 1096" });
    const electronic = input({ association: { ...input().association, informationReturnsFiling: "electronic" } });
    expect(byKey(electronic).has("irs_1096:2025")).toBe(false);
    const unknown = input({ association: { ...input().association, informationReturnsFiling: null } });
    expect(byKey(unknown).has("irs_1096:2025")).toBe(false);
  });

  it("estimates the Illinois annual report on the last day of the month before the anniversary month", () => {
    // Incorporated March 11: the month before March is February; 2026 isn't a leap year.
    expect(byKey(input()).get("il_sos_annual_report:2025")).toMatchObject({
      dueOn: "2026-02-28",
      basis: "estimated",
      kind: "Secretary of State",
      name: "Illinois annual report",
      daysLeft: 27,
    });
    // A January anniversary: the month before is December of the prior year.
    const january = (today: string) =>
      byKey(input({ today, association: { ...input().association, incorporatedOn: "2010-01-20" } })).get("il_sos_annual_report:2025")!;
    expect(january("2026-02-01")).toMatchObject({ dueOn: "2025-12-31", overdue: true, daysLeft: -32 });
    expect(january("2026-06-01")).toMatchObject({ dueOn: "2026-12-31", overdue: false });
  });

  it("can't estimate the annual report without an incorporation date, and says what to add", () => {
    const d = byKey(input({ association: { ...input().association, incorporatedOn: null } })).get("il_sos_annual_report:2025")!;
    expect(d.basis).toBe("none");
    expect(d.note).toContain("incorporation date");
  });

  it("uses an Illinois annual-report template from any year — the newest verified one", () => {
    const d = byKey(
      input({
        templates: [
          template({ formCode: "il_sos_annual_report", taxYear: 2022, dueRule: "INCORPORATION_ANNIVERSARY_MONTH, DAY 1", dueRuleCitation: "old" }),
          template({ formCode: "il_sos_annual_report", taxYear: 2024, dueRule: "INCORPORATION_ANNIVERSARY_MONTH, DAY 15", dueRuleCitation: "805 ILCS 105/114.10" }),
          template({ formCode: "il_sos_annual_report", taxYear: 2025, dueRule: "INCORPORATION_ANNIVERSARY_MONTH, DAY 20", verified: false }),
        ],
      }),
    ).get("il_sos_annual_report:2025")!;
    expect(d).toMatchObject({ dueOn: "2026-03-15", basis: "verified", citation: "805 ILCS 105/114.10" });
  });

  it("matches a 1099 template on the contractor year, not the fiscal year's tax year", () => {
    const fiscal2026 = { ...FY2025, id: "fy-2026", label: "2026", startsOn: "2026-01-01", endsOn: "2026-12-31", taxYear: 2026 };
    const base = input({
      today: "2026-12-15",
      fiscalYear: fiscal2026,
      contractorYear: 2026,
      outcomes: [{ formCode: "irs_1099_nec", taxYear: 2026, vendorId: "v-acme", determination: "required", name: "1099-NEC — Acme Plumbing" }],
    });
    const rule = "CAL_YEAR_END + 1 MONTHS, DAY 31";
    const matched = byKey(input({ ...base, templates: [template({ formCode: "irs_1099_nec", taxYear: 2026, dueRule: rule, dueRuleCitation: "IRC 6071(c)" })] }));
    expect(matched.get("irs_1099_nec:2026:v-acme")).toMatchObject({ dueOn: "2027-01-31", basis: "verified", citation: "IRC 6071(c)" });
    const otherYear = byKey(input({ ...base, templates: [template({ formCode: "irs_1099_nec", taxYear: 2025, dueRule: rule })] }));
    expect(otherYear.get("irs_1099_nec:2026:v-acme")).toMatchObject({ dueOn: "2027-01-31", basis: "estimated" });
  });

  it("gives Illinois filings only to Illinois buildings", () => {
    const nh = taxDeadlines(input({ association: { ...input().association, stateCode: "NH" } }));
    expect(nh.some((d) => d.formCode === "il_1120" || d.formCode === "il_sos_annual_report")).toBe(false);
    expect(nh.some((d) => d.formCode === "irs_1120h")).toBe(true);
  });

  it("never lists a form the determination says isn't required, or a code it doesn't know", () => {
    const keys = [
      ...byKey(
        input({
          outcomes: [
            { formCode: "irs_1120h", taxYear: 2025, determination: "not_required" },
            { formCode: "irs_1120", taxYear: 2025, determination: "likely_required" },
            { formCode: "other", taxYear: 2025, determination: "required" },
          ],
        }),
      ).keys(),
    ];
    expect(keys).toEqual(["irs_1120:2025"]);
  });
});

describe("taxDeadlines — what's already done", () => {
  it("drops a filed form, and an 1120-H whose fiscal year is locked", () => {
    const filed = byKey(
      input({
        forms: [
          form({ formCode: "irs_1120h", taxYear: 2025, status: "filed", filedOn: "2026-01-20" }),
          form({ formCode: "irs_1099_nec", taxYear: 2025, vendorId: "v-acme", status: "filed", filedOn: "2026-01-25" }),
        ],
      }),
    );
    expect(filed.has("irs_1120h:2025")).toBe(false);
    expect(filed.has("irs_1099_nec:2025:v-acme")).toBe(false);
    expect(filed.has("irs_1099_nec:2025:v-snow")).toBe(true);

    const locked = byKey(input({ locked1120hFiscalYearIds: ["fy-2025"] }));
    expect(locked.has("irs_1120h:2025")).toBe(false);
    expect(locked.has("il_1120:2025")).toBe(true);
  });

  it("reads the form's status as the board's steps, and links to the form once it exists", () => {
    const status = (f: Partial<DeadlineForm> | null) => {
      const d = byKey(input({ forms: f ? [form({ formCode: "irs_1120h", taxYear: 2025, ...f })] : [] })).get("irs_1120h:2025")!;
      return { status: d.status, href: d.href, formId: d.formId };
    };
    expect(status(null)).toEqual({ status: "not_started", href: "/tax#forms", formId: null });
    expect(status({ status: "not_started" })).toMatchObject({ status: "not_started", href: "/tax/forms/form-irs_1120h-2025", formId: "form-irs_1120h-2025" });
    expect(status({ status: "draft" }).status).toBe("started");
    expect(status({ status: "in_review" }).status).toBe("started");
    expect(status({ status: "in_review", sentToAccountantAt: "2026-02-01T10:00:00Z" }).status).toBe("with_accountant");
    expect(status({ status: "ready_to_sign", sentToAccountantAt: "2026-02-01T10:00:00Z" }).status).toBe("ready_to_sign");
  });

  it("keeps an overdue deadline for 120 days, then rolls to the next instance", () => {
    const at = (today: string) => byKey(input({ today })).get("irs_1120h:2025") ?? byKey(input({ today })).get("irs_1120h:2026");
    expect(at("2026-05-01")).toMatchObject({ key: "irs_1120h:2025", dueOn: "2026-04-15", overdue: true, daysLeft: -16 });
    // Day 120 after April 15 is August 13: still showing.
    expect(at("2026-08-13")).toMatchObject({ key: "irs_1120h:2025", dueOn: "2026-04-15", overdue: true, daysLeft: -120 });
    // Day 121: the next year's return takes its place, and it isn't overdue.
    expect(at("2026-08-14")).toMatchObject({
      key: "irs_1120h:2026",
      taxYear: 2026,
      dueOn: "2027-04-15",
      basis: "estimated",
      overdue: false,
      status: "not_started",
    });
  });

  it("rolls the annual report to the next cycle the same way", () => {
    // March anniversary → due Feb 28, 2026; stale after June 28; then Feb 28, 2027.
    expect(byKey(input({ today: "2026-06-28" })).get("il_sos_annual_report:2025")).toMatchObject({ dueOn: "2026-02-28", overdue: true });
    expect(byKey(input({ today: "2026-06-29" })).get("il_sos_annual_report:2025")).toMatchObject({ dueOn: "2027-02-28", overdue: false });
  });
});

describe("taxDeadlines — milestones", () => {
  const only1120h = (over: Partial<DeadlineInput> = {}) =>
    byKey(input({ outcomes: [{ formCode: "irs_1120h", taxYear: 2025, determination: "eligible", name: "Form 1120-H" }], ...over })).get("irs_1120h:2025")!;

  it("asks for the figures to go to the accountant 60 days ahead when one is on file and nothing was sent", () => {
    expect(only1120h({ accountantSet: true }).milestones).toEqual([
      { key: "send", label: "Send Form 1120-H to your accountant", on: "2026-02-14" },
    ]);
    // Still the right nudge once the form is started but not yet sent.
    expect(only1120h({ accountantSet: true, forms: [form({ formCode: "irs_1120h", taxYear: 2025, status: "draft" })] }).milestones.map((m) => m.key)).toEqual(["send"]);
  });

  it("stops asking once it's been sent, and doesn't fall back to 'start' for a started form", () => {
    const sent = only1120h({
      accountantSet: true,
      forms: [form({ formCode: "irs_1120h", taxYear: 2025, status: "draft", sentToAccountantAt: "2026-02-10T12:00:00Z" })],
    });
    expect(sent.status).toBe("with_accountant");
    expect(sent.milestones).toEqual([]);
  });

  it("otherwise says to start 45 days ahead, only while nothing has been started", () => {
    expect(only1120h().milestones).toEqual([{ key: "start", label: "Start Form 1120-H", on: "2026-03-01" }]);
    expect(only1120h({ forms: [form({ formCode: "irs_1120h", taxYear: 2025, status: "draft" })] }).milestones).toEqual([]);
    expect(only1120h({ forms: [form({ formCode: "irs_1120h", taxYear: 2025, status: "ready_to_sign" })] }).milestones).toEqual([]);
  });

  it("names the contractor in a 1099's milestone", () => {
    const d = byKey(input({ accountantSet: true })).get("irs_1099_nec:2025:v-acme")!;
    expect(d.milestones).toEqual([{ key: "send", label: "Send 1099-NEC — Acme Plumbing to your accountant", on: "2025-12-02" }]);
  });
});

describe("taxDeadlines — order and the next one up", () => {
  it("sorts by date, soonest first, with undated deadlines last", () => {
    const keys = taxDeadlines(
      input({
        outcomes: [
          ...input().outcomes,
          { formCode: "irs_1120", taxYear: 2025, determination: "likely_required", name: "Form 1120" },
        ],
      }),
    ).map((d) => `${d.key} ${d.dueOn ?? "—"}`);
    expect(keys).toEqual([
      "irs_1099_nec:2025:v-acme 2026-01-31",
      "irs_1099_nec:2025:v-snow 2026-01-31",
      "irs_1096:2025 2026-01-31",
      "il_sos_annual_report:2025 2026-02-28",
      "irs_1120h:2025 2026-04-15",
      "il_1120:2025 2026-04-15",
      "irs_1120:2025 —",
    ]);
  });

  it("nextDeadline is the soonest with a date, overdue included; null when none has one", () => {
    const all = taxDeadlines(input());
    expect(nextDeadline(all)!.key).toBe("irs_1099_nec:2025:v-acme");
    expect(nextDeadline([...all].reverse())!.key).toBe("irs_1099_nec:2025:v-acme");
    const undated = taxDeadlines(input({ outcomes: [{ formCode: "irs_1120", taxYear: 2025, determination: "likely_required" }] }));
    expect(nextDeadline(undated)).toBeNull();
    expect(nextDeadline([])).toBeNull();
  });
});

describe("filingYearFor", () => {
  const years = [
    { id: "fy-2024", label: "2024", starts_on: "2024-01-01", ends_on: "2024-12-31" },
    { id: "fy-2025", label: "2025", starts_on: "2025-01-01", ends_on: "2025-12-31" },
    { id: "fy-2026", label: "2026", starts_on: "2026-01-01", ends_on: "2026-12-31" },
  ];
  const filed2025 = [form({ formCode: "irs_1120h", taxYear: 2025, status: "filed", filedOn: "2026-03-01" })];

  it("picks the year that just ended while its return is still open", () => {
    expect(filingYearFor(years, [], [], "2026-02-01")!.id).toBe("fy-2025");
    expect(filingYearFor(years, [], [], "2026-12-30")!.id).toBe("fy-2025");
    // A filed form for another year changes nothing.
    expect(filingYearFor(years, [form({ formCode: "irs_1120h", taxYear: 2024, status: "filed", filedOn: "2025-04-01" })], [], "2026-02-01")!.id).toBe("fy-2025");
  });

  it("moves on to the current year once that return is filed or its figures are locked", () => {
    expect(filingYearFor(years, filed2025, [], "2026-02-01")!.id).toBe("fy-2026");
    expect(filingYearFor(years, [], ["fy-2025"], "2026-02-01")!.id).toBe("fy-2026");
  });

  it("uses the current year when nothing has ended within the last 12 months", () => {
    expect(filingYearFor(years.slice(2), [], [], "2026-02-01")!.id).toBe("fy-2026");
    // The year that ended more than 12 months ago is too old to be "next to file".
    expect(filingYearFor([years[0], years[2]], [], [], "2026-02-01")!.id).toBe("fy-2026");
    expect(filingYearFor(years, [], [], "2026-01-01")!.id).toBe("fy-2025");
  });

  it("falls back to the newest year, and to null with nothing on file", () => {
    expect(filingYearFor(years.slice(0, 2), filed2025, [], "2027-06-01")!.id).toBe("fy-2025");
    expect(filingYearFor([], [], [], "2026-02-01")).toBeNull();
  });
});

describe("ISO-only date arithmetic", () => {
  it("counts whole days across a DST change (spring forward)", () => {
    // US clocks jump on March 8, 2026; a Date-based count would be 44.96 days.
    const d = byKey(input({ today: "2026-03-01" })).get("irs_1120h:2025")!;
    expect(d.daysLeft).toBe(45);
    expect(d.milestones).toEqual([{ key: "start", label: "Start Form 1120-H", on: "2026-03-01" }]);
    expect(daysBetween("2026-03-01", "2026-04-15")).toBe(45);
    expect(addDays("2026-04-15", -45)).toBe("2026-03-01");
  });

  it("counts whole days across the fall-back as well, and crosses year ends", () => {
    // Clocks fall back November 1, 2026.
    const d = byKey(
      input({
        today: "2026-10-20",
        contractorYear: 2026,
        accountantSet: true,
        outcomes: [{ formCode: "irs_1099_nec", taxYear: 2026, vendorId: "v-acme", determination: "required", name: "1099-NEC — Acme Plumbing" }],
      }),
    ).get("irs_1099_nec:2026:v-acme")!;
    expect(d.dueOn).toBe("2027-01-31");
    expect(d.daysLeft).toBe(103);
    expect(d.milestones[0].on).toBe("2026-12-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
  });

  it("returns nothing but ISO strings", () => {
    for (const d of taxDeadlines(input({ accountantSet: true }))) {
      for (const v of [d.dueOn, ...d.milestones.map((m) => m.on)]) {
        if (v !== null) expect(v).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });
});
