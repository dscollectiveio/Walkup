import { describe, expect, it } from "vitest";
import { netOverdue, netOwed } from "@/lib/email-outbox/templates/dues-reminder";
import { render, InvalidFactsError, UnknownTemplateError, type RenderContext } from "@/lib/email-outbox/templates";

const TOKEN = "a".repeat(96);
const ctx: RenderContext = {
  associationName: "2158 N. Damen",
  replyToName: "Cy Ferreira",
  replyToEmail: "board@example.test",
  recipientFirstName: "Ada",
  hasLogin: true,
  siteUrl: "https://www.walkuphoa.com",
  unsubscribeUrl: `https://www.walkuphoa.com/unsubscribe/${TOKEN}`,
  legalEntity: "DS Collective LLC",
  legalAddress: "1 Example St, Chicago, IL 60601",
  boardNote: null,
  todayIso: "2026-10-14",
};

const U1 = "aaaa1111-0000-0000-0000-000000000001";
const U3 = "aaaa1111-0000-0000-0000-000000000003";
const unit = (id: string, label: string, over: Partial<Record<string, unknown>> = {}) => ({
  unit_id: id,
  label,
  as_of: "2026-10-14",
  owed: "750.00",
  overdue: "750.00",
  credit: "0.00",
  net: "750.00",
  oldest_overdue_on: "2026-01-01",
  lines: [
    { due_on: "2026-01-01", label: "Dues for January 2026", balance: "500.00" },
    { due_on: "2026-02-01", label: "Dues for February 2026", balance: "250.00" },
  ],
  ...over,
});
const stmt = (over: Partial<Record<string, string>> = {}) => ({
  units: [{ unit_id: U1, label: "Unit 1", from: "2026-07-01", to: "2026-09-30", opening: "0.00", charges: "1500.00", payments: "500.00", adjustments: "0.00", closing: "1000.00", ...over }],
});
const FEE = "aaaa1111-0000-0000-0000-000000000009";
const lateFee = { units: [unit(U1, "Unit 1", { owed: "775.00" })], fee_charge_id: FEE, fee_amount: "25.00", fee_charged_on: "2026-02-15" };

const all = () => [
  render("dues_reminder", "dues_reminder", 1, { units: [unit(U1, "Unit 1")] }, ctx),
  render("dues_reminder", "dues_reminder", 1, { units: [unit(U1, "Unit 1"), unit(U3, "Unit 3")] }, { ...ctx, hasLogin: false, boardNote: "Please call me." }),
  render("dues_reminder", "dues_upcoming", 1, { units: [unit(U1, "Unit 1", { overdue: "0.00", oldest_overdue_on: null, owed: "300.00", lines: [{ due_on: "2026-10-20", label: "Dues for October 2026", balance: "300.00" }] })] }, ctx),
  render("late_fee_notice", "late_fee_notice", 1, lateFee, ctx),
  render("statement", "statement", 1, stmt(), ctx),
  render("annual_statement", "statement", 1, stmt({ from: "2025-01-01", to: "2025-12-31" }), ctx),
  render("announcement", "announcement", 1, { announcement_id: FEE }, ctx, { announcement: { title: "Water off", body: "Tuesday 9 to noon.", hasAttachment: false } }),
];

describe("dues reminder", () => {
  it("renders the exact single-unit text with login and no note", () => {
    const r = render("dues_reminder", "dues_reminder", 1, { units: [unit(U1, "Unit 1")] }, ctx);
    expect(r.subject).toBe("Dues reminder: Unit 1 has a balance of $750.00");
    expect(r.text.split("\n\n--\n")[0]).toBe(
      [
        "Hi Ada,",
        "",
        "This is a reminder from 2158 N. Damen. As of October 14, 2026, the board's books show a balance of $750.00 for Unit 1:",
        "",
        "  Dues for January 2026    due Jan 1   $500.00",
        "  Dues for February 2026   due Feb 1   $250.00",
        "  Total                                $750.00",
        "",
        "$750.00 of this is past due. The oldest unpaid charge was due on January 1, 2026.",
        "",
        "You can see your statement and how to pay when you sign in at https://www.walkuphoa.com/owner",
        "",
        "If you've already paid, thank you. Your payment may not be recorded yet. You can tell the board on the same page.",
        "",
        "Thanks,",
        "Cy Ferreira",
        "2158 N. Damen",
      ].join("\n"),
    );
  });

  it("without a login points to the board and never to payment details", () => {
    const r = render("dues_reminder", "dues_reminder", 1, { units: [unit(U1, "Unit 1")] }, { ...ctx, hasLogin: false });
    expect(r.text).toContain("To pay, use the details the board gave you, or reply to this email and we'll point you to them.");
    expect(r.text).toContain("Payment details are never sent by email. Only use the ones the board gave you.");
    expect(r.text).not.toContain("sign in");
    expect(r.text).toContain("If you've already paid, thank you. Your payment may not be recorded yet.\n");
  });

  it("adds the board's note when set", () => {
    const r = render("dues_reminder", "dues_reminder", 1, { units: [unit(U1, "Unit 1")] }, { ...ctx, boardNote: "Please call me." });
    expect(r.text).toContain("\n\nA note from the board: Please call me.\n\n");
  });

  it("lists one block per unit and a grand total for several units", () => {
    const r = render("dues_reminder", "dues_reminder", 1, { units: [unit(U1, "Unit 1"), unit(U3, "Unit 3")] }, ctx);
    expect(r.subject).toBe("Dues reminder: $1,500.00 across 2 units");
    expect(r.text).toContain("For Unit 1:");
    expect(r.text).toContain("For Unit 3:");
    expect(r.text).toContain("Total across your units   $1,500.00");
    expect(r.text).toContain("an owner of Unit 1 and Unit 3");
  });

  it("makes the rows add up when the facts hold only the first twelve lines", () => {
    const lines = Array.from({ length: 12 }, (_, i) => ({ due_on: `2025-${String(i + 1).padStart(2, "0")}-01`, label: `Dues ${i + 1}`, balance: "100.00" }));
    const r = render("dues_reminder", "dues_reminder", 1, { units: [unit(U1, "Unit 1", { owed: "1500.00", overdue: "1500.00", lines })] }, ctx);
    expect(r.text).toContain("Other open charges");
    expect(r.text).toContain("$300.00");
    expect(r.text).toMatch(/Total\s+\$1,500\.00/);
  });

  it("uses the net balance when a payment is not applied yet: subject, intro, rows and past-due amount", () => {
    const r = render("dues_reminder", "dues_reminder", 1, { units: [unit(U1, "Unit 1", { credit: "100.00", net: "650.00" })] }, ctx);
    expect(r.subject).toBe("Dues reminder: Unit 1 has a balance of $650.00");
    expect(r.text).toContain("the board's books show a balance of $650.00 for Unit 1:");
    expect(r.text).toMatch(/Total of open charges\s+\$750\.00/);
    expect(r.text).toMatch(/Payment not yet applied\s+-\$100\.00/);
    expect(r.text).toMatch(/Balance\s+\$650\.00/);
    expect(r.text).toContain("$650.00 of this is past due.");
    expect(r.text).toContain("a payment of $100.00 for Unit 1 that has not been applied to a charge yet. It is already taken off the balance above.");
    expect(r.text).not.toContain("$750.00 of this is past due");
  });

  it("totals several units on the net figures", () => {
    const r = render("dues_reminder", "dues_reminder", 1, { units: [unit(U1, "Unit 1", { credit: "100.00" }), unit(U3, "Unit 3")] }, ctx);
    expect(r.subject).toBe("Dues reminder: $1,400.00 across 2 units");
    expect(r.text).toContain("Total across your units   $1,400.00");
  });

  it("the late fee notice states the balance after an unapplied payment", () => {
    const r = render("late_fee_notice", "late_fee_notice", 1, { ...lateFee, units: [unit(U1, "Unit 1", { owed: "775.00", credit: "100.00" })] }, ctx);
    expect(r.text).toContain("including that fee, is $675.00, after a payment of $100.00 not yet applied to a charge.");
  });

  it("a payment bigger than the balance never reads as a negative or a reminder amount", () => {
    expect(netOwed({ owed: "300.00", credit: "500.00" })).toBe("0.00");
    expect(netOverdue({ overdue: "300.00", credit: "500.00" })).toBe("0.00");
    expect(netOwed({ owed: "300.00", credit: "0.00" })).toBe("300.00");
    expect(netOverdue({ overdue: "300.00", credit: "100.00" })).toBe("200.00");
  });
});

describe("upcoming, late fee, statement, announcement", () => {
  it("renders the upcoming heads-up from the earliest charge not yet due", () => {
    const r = all()[2];
    expect(r.subject).toBe("Dues reminder: $300.00 due Oct 20");
    expect(r.text).toContain("A friendly heads-up from 2158 N. Damen: Unit 1 has $300.00 due on October 20, 2026.");
  });

  it("renders the late fee notice without saying why it was allowed", () => {
    const r = all()[3];
    expect(r.subject).toBe("Late fee on Unit 1");
    expect(r.text).toContain("2158 N. Damen charged a late fee of $25.00 to Unit 1 on February 15, 2026.");
    expect(r.text).toContain("Your balance for Unit 1, including that fee, is $775.00.");
    expect(r.text).toContain("If you think the fee was charged by mistake, reply to this email and tell us why.");
    expect(r.text).not.toMatch(/law|statute|allowed|legal action|attorney|collections/i);
  });

  it("renders a statement with one PDF attachment per unit", () => {
    const r = all()[4];
    expect(r.subject).toBe("Statement for Unit 1, Q3 2026");
    expect(r.text).toContain("Your statement for Unit 1 for Q3 2026 is attached as a PDF.");
    expect(r.text).toContain("Balance at the end     $1,000.00");
    expect(r.text).not.toContain("Waived or written off");
    expect(r.attachments).toEqual([{ kind: "statement_pdf", unitId: U1, from: "2026-07-01", to: "2026-09-30", filename: "Statement Unit 1 Q3 2026.pdf" }]);
  });

  it("shows waived amounts only when there are some, and a negative closing balance as a credit", () => {
    const r = render("statement", "statement", 1, stmt({ adjustments: "25.00", closing: "-40.00" }), ctx);
    expect(r.text).toContain("Waived or written off");
    expect(r.text).toContain("$40.00 credit");
    expect(r.text).toContain("You have a credit of $40.00 on account.");
  });

  it("marks the annual statement as not a tax document", () => {
    const r = all()[5];
    expect(r.subject).toBe("Annual statement for Unit 1, 2025");
    expect(r.text).toContain("This is a record of your account with 2158 N. Damen. It is not a tax document.");
    expect(r.attachments?.[0].filename).toBe("Annual statement Unit 1 2025.pdf");
  });

  it("sends several statements as several attachments", () => {
    const f = stmt();
    f.units.push({ ...f.units[0], unit_id: U3, label: "Unit 3" });
    const r = render("statement", "statement", 1, f, ctx);
    expect(r.attachments).toHaveLength(2);
    expect(r.text).toContain("attached as PDFs");
  });

  it("renders an announcement exactly as written, with or without an attachment and login", () => {
    const body = "Line one.\n\nLine two <b>kept</b> as text.";
    const base = { announcement_id: FEE };
    const plain = render("announcement", "announcement", 1, base, ctx, { announcement: { title: "Roof", body, hasAttachment: false } });
    expect(plain.subject).toBe("2158 N. Damen: Roof");
    expect(plain.text).toContain(`Hi Ada,\n\n${body}\n\nYou can read this and earlier notices at https://www.walkuphoa.com/announcements`);
    const withFile = render("announcement", "announcement", 1, base, ctx, { announcement: { title: "Roof", body, hasAttachment: true } });
    expect(withFile.text).toContain("This notice has a file with it. Sign in at https://www.walkuphoa.com/announcements to open it.");
    const noLogin = render("announcement", "announcement", 1, base, { ...ctx, hasLogin: false }, { announcement: { title: "Roof", body, hasAttachment: true } });
    expect(noLogin.text).toContain("This notice has a file with it. Ask the board for the file.");
    expect(() => render("announcement", "announcement", 1, base, ctx)).toThrow(InvalidFactsError);
  });
});

describe("every message", () => {
  it("carries the footer, the unsubscribe link, the legal entity and the address", () => {
    for (const r of all()) {
      expect(r.text).toContain("\n--\nYou're getting this because the board of 2158 N. Damen has you down as an owner");
      expect(r.text).toContain("Reply to this email to reach Cy Ferreira at 2158 N. Damen.");
      expect(r.text).toContain(`Stop `);
      expect(r.text).toContain(`: https://www.walkuphoa.com/unsubscribe/${TOKEN}`);
      expect(r.text).toContain("Sent by Walkup on behalf of 2158 N. Damen. Walkup is operated by DS Collective LLC, 1 Example St, Chicago, IL 60601.");
      expect(r.text).toContain("Walkup does not collect or move money. Payment details are never sent by email.");
      expect(r.html).toContain(`href="https://www.walkuphoa.com/unsubscribe/${TOKEN}"`);
      expect(r.html).toContain("DS Collective LLC");
    }
  });

  it("uses the right unsubscribe category per kind", () => {
    const cats = all().map((r) => /Stop ([a-z ]+) or change your choices:/.exec(r.text)![1]);
    expect(cats).toEqual(["dues reminders", "dues reminders", "dues reminders", "dues reminders", "statements", "statements", "announcements"]);
  });

  it("has no em dash or en dash anywhere, and no marketing words", () => {
    for (const r of all()) {
      for (const part of [r.subject, r.text, r.html]) {
        expect(part).not.toMatch(/[–—]/);
        expect(part).not.toMatch(/\b(offer|sale|discount|upgrade|pricing)\b/i);
      }
    }
  });

  it("has no tracking pixel, remote image or script", () => {
    for (const r of all()) {
      expect(r.html).not.toMatch(/<img|<script|<iframe|src=|url\(/i);
      expect(r.html).toContain("<title>");
    }
  });

  it("never prints a dollar amount that is not in the facts", () => {
    const amounts = new Set(["$750.00", "$500.00", "$250.00", "$1,500.00"]);
    const r = render("dues_reminder", "dues_reminder", 1, { units: [unit(U1, "Unit 1"), unit(U3, "Unit 3")] }, ctx);
    for (const m of r.text.match(/\$[\d,]+\.\d{2}/g) ?? []) expect(amounts.has(m), m).toBe(true);
  });

  it("never prints an account, routing or Zelle detail even when other fields hold them", () => {
    const hostile = { ...ctx, associationName: "2158 N. Damen", replyToName: "Cy", legalAddress: "1 Example St" };
    for (const r of [render("dues_reminder", "dues_reminder", 1, { units: [unit(U1, "Unit 1")] }, hostile), ...all()]) {
      expect(r.text).not.toMatch(/routing|account number|zelle|venmo|\b\d{9}\b|\b\d{10,17}\b/i);
    }
  });

  it("escapes markup in names, notes and announcement bodies in the HTML part", () => {
    const evil = "<script>alert(1)</script>";
    const r = render("dues_reminder", "dues_reminder", 1, { units: [unit(U1, evil)] }, { ...ctx, boardNote: evil, associationName: evil });
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
    const a = render("announcement", "announcement", 1, { announcement_id: FEE }, ctx, { announcement: { title: evil, body: `${evil}\nSee you Tuesday.`, hasAttachment: false } });
    expect(a.html).not.toContain("<script>");
    expect(a.html).toContain("white-space:pre-wrap");
  });

  it("emails only the title for an announcement that carries a link, address, domain or account number (REVIEW-2 #8)", () => {
    for (const body of [
      "Pay the new assessment at https://evil.test/pay",
      "Send the check via pay@evil.test",
      "Pay now at evil-pay.com today",
      "Wire to account 123456789 by Friday",
      "Routing 071 000 013",
      "Call 312 555 0142 to confirm",
    ]) {
      const a = render("announcement", "announcement", 1, { announcement_id: FEE }, ctx, { announcement: { title: "Assessment", body, hasAttachment: false } });
      expect(a.text, body).not.toMatch(/evil|123456789|071/);
      expect(a.html, body).not.toContain("white-space:pre-wrap");
      expect(a.text).toContain("Assessment");
    }
    const ok = render("announcement", "announcement", 1, { announcement_id: FEE }, ctx, { announcement: { title: "Roof", body: "Roof work starts Monday at 8.", hasAttachment: false } });
    expect(ok.text).toContain("Roof work starts Monday at 8.");
  });

  it("strips control characters from the subject", () => {
    const r = render("dues_reminder", "dues_reminder", 1, { units: [unit(U1, "Unit\r\nBcc: x@y.test 1")] }, ctx);
    expect(r.subject).not.toMatch(/[\r\n]/);
  });

  it("refuses an unknown template, a wrong version and unreadable facts", () => {
    expect(() => render("dues_reminder", "nope", 1, { units: [unit(U1, "Unit 1")] }, ctx)).toThrow(UnknownTemplateError);
    expect(() => render("dues_reminder", "dues_reminder", 2, { units: [unit(U1, "Unit 1")] }, ctx)).toThrow(UnknownTemplateError);
    expect(() => render("statement", "dues_reminder", 1, stmt(), ctx)).toThrow(UnknownTemplateError);
    expect(() => render("dues_reminder", "dues_reminder", 1, { units: [{ nope: true }] }, ctx)).toThrow(InvalidFactsError);
  });
});
