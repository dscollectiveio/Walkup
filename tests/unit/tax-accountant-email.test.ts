import { describe, expect, it } from "vitest";
import { accountantEmail, EMAIL_BODY_MAX, mailtoHref, type AccountantEmailInput } from "@/lib/tax/accountant-email";

function input(over: Partial<AccountantEmailInput> = {}): AccountantEmailInput {
  return {
    variant: "1120h",
    association: { legalName: "2158 N. Damen Condominium Association", displayName: "2158 N. Damen" },
    accountant: { firstName: "Pat", email: "pat@example.com" },
    fiscalYear: { label: "2026", startsOn: "2026-01-01", endsOn: "2026-12-31" },
    taxYear: 2026,
    figures: {
      exemptIncomeCents: 48_000_00,
      nonexemptIncomeCents: 1_250_00,
      grossIncomeCents: 49_250_00,
      exemptExpendituresCents: 41_000_00,
      totalExpendituresCents: 42_500_00,
      nonexemptByAccount: [
        { name: "Interest Income", cents: 350_00 },
        { name: "Laundry Income", cents: 900_00 },
      ],
    },
    tests: {
      income: { ratio: 48_000_00 / 49_250_00, threshold: 0.6, passed: true, verified: false },
      expenditure: { ratio: 41_000_00 / 42_500_00, threshold: 0.9, passed: true, verified: false },
    },
    estimatedTaxCents: 345_00,
    parametersVerified: false,
    parameters: { rateCondo: 0.3, specificDeductionCents: 100_00 },
    due: { on: "2027-04-15", basis: "estimated", citation: null },
    contractors: [
      { name: "Damen Plumbing", totalCents: 2_400_00, w9OnFile: true },
      { name: "Snow Co", totalCents: 650_00, w9OnFile: false },
    ],
    threshold: { cents: 2_000_00, verified: false },
    openItems: ["Confirm the laundry income is non-exempt", "Line 2 interest came from the reserve account"],
    attachments: ["Form 1120-H 2026 editable.pdf", "Form 1120-H 2026 worksheet.xlsx"],
    senderName: "Doug",
    ...over,
  };
}

const TIN_SHAPES = [/\d{2}-\d{7}/, /\d{3}-\d{2}-\d{4}/, /\d{9,}/];

describe("accountantEmail subjects", () => {
  it("names the building, the form and the year per variant", () => {
    expect(accountantEmail(input()).subject).toBe("2158 N. Damen — Form 1120-H 2026: figures for your review");
    expect(accountantEmail(input({ variant: "1099" })).subject).toBe("2158 N. Damen — 1099-NEC contractor list for 2026");
    expect(accountantEmail(input({ variant: "heads_up" })).subject).toBe("2158 N. Damen — what's coming this tax season");
  });
});

describe("accountantEmail 1120h body", () => {
  it("greets by first name, or 'there' when no accountant is on file", () => {
    expect(accountantEmail(input()).body.startsWith("Hi Pat,")).toBe(true);
    expect(accountantEmail(input({ accountant: null })).body.startsWith("Hi there,")).toBe(true);
  });

  it("carries the five figures, both test percentages, and says nobody has checked them", () => {
    const { body } = accountantEmail(input());
    expect(body).toContain("Owner fees (exempt function income): $48,000.00 — 97.5% of $49,250.00 gross income (needs 60%)");
    expect(body).toContain("Spending on the building (exempt function expenditures): $41,000.00 — 96.5% of $42,500.00 total spending (needs 90%)");
    expect(body).toContain("Income that isn't owner fees: $1,250.00 (Laundry Income $900.00, Interest Income $350.00)");
    expect(body).toContain("Nobody has checked them against this year's IRS instructions yet");
    expect(body).toContain("fiscal year January 1, 2026 to December 31, 2026");
    expect(body).toContain("Nothing has been filed. The board will review your changes before signing.");
    expect(body.endsWith("Thanks,\nDoug, 2158 N. Damen")).toBe(true);
  });

  it("names the rate and deduction from the parameters and says whether a person has checked them", () => {
    expect(accountantEmail(input()).body).toContain(
      "Walkup's estimate of tax due before any deductions: $345.00 (provisional; the 30% rate and $100.00 specific deduction are not yet checked against this year's instructions)",
    );
    expect(accountantEmail(input({ parametersVerified: true })).body).toContain(
      "the 30% rate and $100.00 specific deduction are checked against this year's instructions",
    );
    // No parameters on file: no estimate, and no number is invented.
    const none = accountantEmail(input({ estimatedTaxCents: null, parameters: null })).body;
    expect(none).toContain("Walkup's estimate of tax due before any deductions: not available — the rate or specific deduction isn't on file in Walkup");
    expect(none).not.toContain("30%");
  });

  it("falls back to 'threshold not on file' when the tests can't be run", () => {
    const { body } = accountantEmail(input({ tests: null }));
    expect(body).toContain("97.5% of $49,250.00 gross income (test threshold not on file in Walkup)");
    expect(body).not.toContain("needs 60%");
  });

  it("words the due date as verified, estimated or not on file", () => {
    expect(
      accountantEmail(input({ due: { on: "2027-04-15", basis: "verified", citation: "Instructions for Form 1120-H (2025), When To File" } })).body,
    ).toContain("Due date on file: April 15, 2027 (Instructions for Form 1120-H (2025), When To File)");
    expect(accountantEmail(input()).body).toContain("Due date on file: April 15, 2027 (estimated — please confirm)");
    expect(accountantEmail(input({ due: { on: null, basis: "none", citation: null } })).body).toContain("Due date: not on file — can you confirm it?");
  });

  it("names every attachment on its own line and explains the card caveat", () => {
    const { body } = accountantEmail(input());
    expect(body).toContain("I'm attaching:\n- Form 1120-H 2026 editable.pdf\n- Form 1120-H 2026 worksheet.xlsx");
    expect(body).toContain("(Our contractor payment totals include every payment we recorded; tell us if any were by card, which the processor reports instead.)");
    expect(accountantEmail(input({ attachments: [] })).body).toContain("I'll send the files separately.");
  });

  it("caps open items at five", () => {
    const openItems = Array.from({ length: 8 }, (_, i) => `Open item ${i + 1}`);
    const { body } = accountantEmail(input({ openItems }));
    expect(body.match(/^- Open item \d+$/gm)).toHaveLength(5);
    expect(body).toContain("- Open item 5");
    expect(body).not.toContain("Open item 6");
    expect(accountantEmail(input({ openItems: [] })).body).not.toContain("Open items:");
  });

  it("stays within the mailto budget with long inputs, keeping the figures", () => {
    const long = input({
      association: { legalName: "The Two Thousand One Hundred Fifty-Eight North Damen Avenue Condominium Owners Association of Chicago, Incorporated", displayName: "2158 N. Damen" },
      due: { on: "2027-04-15", basis: "verified", citation: "Instructions for Form 1120-H (2025), When To File — ".repeat(6) },
      openItems: Array.from({ length: 8 }, (_, i) => `Open item ${i + 1}: ${"a long explanation of what still needs a look ".repeat(5)}`),
      attachments: Array.from({ length: 6 }, (_, i) => `Form 1120-H 2026 some very long attachment name number ${i + 1} for the accountant.pdf`),
      figures: {
        ...input().figures,
        nonexemptByAccount: Array.from({ length: 10 }, (_, i) => ({ name: `Account number ${i + 1} with a long name`, cents: (i + 1) * 100_00 })),
      },
      senderName: "Douglas Alexander Smart, Treasurer",
    });
    const { body } = accountantEmail(long);
    expect(body.length).toBeLessThanOrEqual(EMAIL_BODY_MAX);
    expect(body).toContain("$48,000.00");
    expect(body).toContain("$41,000.00");
    expect(body).toContain("Nothing has been filed.");
    expect(body.endsWith("Douglas Alexander Smart, Treasurer, 2158 N. Damen")).toBe(true);
  });

  it("never carries anything shaped like a TIN, EIN or account number", () => {
    const leaky = {
      openItems: ["Our EIN is 36-1234567", "The owner's SSN 123-45-6789 is on the W-9", "Bank account 123456789012"],
      contractors: [{ name: "Acme 98-7654321 LLC", totalCents: 3_000_00, w9OnFile: true }],
      attachments: ["Form 1120-H 2026 worksheet.xlsx"],
    };
    for (const variant of ["1120h", "1099", "heads_up"] as const) {
      const { subject, body } = accountantEmail(input({ ...leaky, variant }));
      for (const shape of TIN_SHAPES) {
        expect(body).not.toMatch(shape);
        expect(subject).not.toMatch(shape);
      }
    }
    expect(accountantEmail(input(leaky)).body).toContain("Our EIN is [removed]");
  });
});

describe("accountantEmail 1099 body", () => {
  it("lists contractors largest first with W-9 status, states the threshold as of the payment year, and asks about IRIS", () => {
    const { body } = accountantEmail(input({ variant: "1099", due: { on: "2027-01-31", basis: "estimated", citation: null } }));
    expect(body).toContain("Here's who 2158 N. Damen Condominium Association paid for services in 2026");
    expect(body).toContain("- Damen Plumbing: $2,400.00 — W-9 on file: yes\n- Snow Co: $650.00 — W-9 on file: no");
    expect(body).toContain(
      "The reporting threshold for payments made in 2026 is $2,000.00 per contractor (not yet checked against this year's instructions) — 1 of the 2 is at or above it.",
    );
    expect(body).toContain("Their TINs are on the W-9s, which I'll send separately — Walkup stores only the last four digits.");
    expect(body).toContain("Copy A can't be printed from the IRS PDF — should we file through IRIS or do you handle that?");
    expect(body).toContain("Due date on file: January 31, 2027 (estimated — please confirm)");
  });

  it("says checked when the threshold is, and asks the CPA when none is on file", () => {
    expect(accountantEmail(input({ variant: "1099", threshold: { cents: 2_000_00, verified: true } })).body).toContain(
      "$2,000.00 per contractor (checked against this year's instructions)",
    );
    const none = accountantEmail(input({ variant: "1099", threshold: null })).body;
    expect(none).toContain("The reporting threshold for payments made in 2026 isn't on file in Walkup — can you tell us which of these need a 1099?");
    expect(none).not.toContain("$2,000.00");
  });

  it("shows up to eight contractors, then 'and N more'", () => {
    const contractors = Array.from({ length: 12 }, (_, i) => ({ name: `Vendor ${i + 1}`, totalCents: (12 - i) * 1_000_00, w9OnFile: true }));
    const { body } = accountantEmail(input({ variant: "1099", contractors }));
    expect(body.match(/^- Vendor \d+:/gm)).toHaveLength(8);
    expect(body).toContain("- Vendor 1: $12,000.00");
    expect(body).toContain("- and 4 more");
    expect(body.length).toBeLessThanOrEqual(EMAIL_BODY_MAX);
  });
});

describe("accountantEmail heads_up body", () => {
  it("lists every deadline with estimated marks, counts contractors and W-9s, and promises the figures 60 days before the due date", () => {
    const { body } = accountantEmail(
      input({
        variant: "heads_up",
        deadlines: [
          { name: "Form 1120-H", dueOn: "2027-04-15", basis: "estimated" },
          { name: "1099-NEC to contractors", dueOn: "2027-01-31", basis: "verified" },
          { name: "Illinois annual report", dueOn: null, basis: "none" },
        ],
        contractors: [
          { name: "Damen Plumbing", totalCents: 2_400_00, w9OnFile: false },
          { name: "Roof Co", totalCents: 9_000_00, w9OnFile: true },
          { name: "Snow Co", totalCents: 650_00, w9OnFile: false },
        ],
      }),
    );
    expect(body).toContain("- Form 1120-H: April 15, 2027 (estimated)");
    expect(body).toContain("- 1099-NEC to contractors: January 31, 2027\n");
    expect(body).not.toContain("January 31, 2027 (estimated)");
    expect(body).toContain("- Illinois annual report: not on file — can you confirm it?");
    expect(body).toContain("2 contractors are at or above the 1099 threshold so far (threshold not yet checked against this year's instructions); 1 W-9 still outstanding.");
    expect(body).toContain("We'll send the 1120-H figures by February 14, 2027");
    expect(body).toContain("Nothing on this list has been filed yet.");
  });

  it("stands on the 1120-H due date alone when no list is given, and asks for the date when there is none", () => {
    expect(accountantEmail(input({ variant: "heads_up", contractors: [] })).body).toContain("- Form 1120-H: April 15, 2027 (estimated)");
    expect(accountantEmail(input({ variant: "heads_up", contractors: [] })).body).toContain("No contractor is at or above the 1099 threshold so far");
    const none = accountantEmail(input({ variant: "heads_up", due: { on: null, basis: "none", citation: null } })).body;
    expect(none).toContain("- Form 1120-H: not on file — can you confirm it?");
    expect(none).toContain("We'll send the 1120-H figures once the year's books are closed — can you confirm the due date?");
  });
});

describe("mailtoHref", () => {
  it("opens a draft with no recipient when no accountant is on file", () => {
    const href = mailtoHref(null, "Subject", "Line one\nLine two");
    expect(href.startsWith("mailto:?subject=Subject&body=")).toBe(true);
    expect(mailtoHref("  ", "S", "b").startsWith("mailto:?subject=")).toBe(true);
  });

  it("addresses the accountant and keeps the paragraphs (CRLF per RFC 6068)", () => {
    const { subject, body } = accountantEmail(input());
    const href = mailtoHref("pat@example.com", subject, body);
    expect(href.startsWith("mailto:pat%40example.com?subject=")).toBe(true);
    const params = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    expect(params.get("subject")).toBe(subject);
    expect(params.get("body")).toBe(body.replace(/\n/g, "\r\n"));
    expect(href).toContain("%0D%0A");
  });
});
