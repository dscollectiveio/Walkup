import { describe, expect, it } from "vitest";
import { parseProfile, stripControls } from "@/lib/owner/profile";
import { hasPaymentDetails, reportLine, reportStatusWords, suggestedMemo, WITHDRAWN_NOTE } from "@/lib/owner/pay";
import { glanceLine, summariseRepairs, type TicketGlance } from "@/lib/owner/repairs-glance";
import { firstNameOf } from "@/lib/owner/viewer-names";
import { StatementDownload } from "@/components/owner/statement-download";
import { STATEMENT_PDF_ENABLED } from "@/lib/owner/flags";

describe("parseProfile", () => {
  it("accepts a normal phone and address, and blanks", () => {
    expect(parseProfile({ phone: " (312) 555-0100 ", mailingAddress: " 1 Main St\nChicago IL " })).toEqual({
      ok: true,
      phone: "(312) 555-0100",
      mailingAddress: "1 Main St\nChicago IL",
    });
    expect(parseProfile({ phone: "", mailingAddress: "" })).toEqual({ ok: true, phone: "", mailingAddress: "" });
    expect(parseProfile({ phone: "+1 312.555.0100 x22", mailingAddress: "" }).ok).toBe(true);
  });
  it("says what is wrong, per field", () => {
    const r = parseProfile({ phone: "call me maybe", mailingAddress: "x".repeat(301) });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.fieldErrors.phone).toBe("Use digits, spaces and + ( ) - only.");
      expect(r.fieldErrors.mailingAddress).toBe("Keep the address under 300 characters.");
    }
    expect(parseProfile({ phone: "1".repeat(41), mailingAddress: "" }).ok).toBe(false);
  });
  it("strips control characters but keeps line breaks", () => {
    expect(stripControls("a\u0000b\u0007c\nd")).toBe("abc\nd");
  });
  it("treats a missing field as empty", () => {
    expect(parseProfile({ phone: null, mailingAddress: undefined })).toEqual({ ok: true, phone: "", mailingAddress: "" });
  });
});

describe("pay words", () => {
  it("suggested memo", () => {
    expect(suggestedMemo("Unit 2", "2026-10-14")).toBe("Unit 2 dues Oct 2026");
  });
  it("report lines and status words", () => {
    const r = { id: "1", unit_id: "u", amount: "450.00", paid_on: "2026-10-03", method: "zelle", status: "pending" as const, resolution_note: null };
    expect(reportLine(r, "2026-10-14")).toBe("Oct 3 · $450.00 by Zelle");
    expect(reportStatusWords(r)).toEqual({ label: "Waiting for the board", tone: "warning", note: null });
    expect(reportStatusWords({ ...r, status: "matched" })).toEqual({ label: "Matched to a deposit", tone: "good", note: null });
    expect(reportStatusWords({ ...r, status: "dismissed", resolution_note: "No deposit found" })).toEqual({ label: "Not matched", tone: "neutral", note: "No deposit found" });
    expect(reportStatusWords({ ...r, status: "dismissed", resolution_note: WITHDRAWN_NOTE })).toEqual({ label: "Withdrawn", tone: "neutral", note: null });
  });
  it("knows when payment details are configured", () => {
    expect(hasPaymentDetails({ dues_payee_name: null, dues_account_number: null, dues_zelle_handle: null })).toBe(false);
    expect(hasPaymentDetails({ dues_payee_name: " ", dues_account_number: null, dues_zelle_handle: "" })).toBe(false);
    expect(hasPaymentDetails({ dues_payee_name: null, dues_account_number: null, dues_zelle_handle: "pay@example.com" })).toBe(true);
  });
});

describe("repairs glance", () => {
  const t = (o: Partial<TicketGlance>): TicketGlance => ({
    id: "t", reference: 12, title: "Leak", status: "open", resolved_at: null, scheduled_for: null, scheduled_window: null, updated_at: "2026-10-10T00:00:00Z", ...o,
  });
  const TODAY = "2026-10-14";
  it("fixed within 30 days asks the owner to confirm", () => {
    expect(glanceLine(t({ status: "resolved", resolved_at: "2026-10-10T12:00:00Z" }), TODAY)).toBe("Fixed Sat, Oct 10: is it fixed?");
  });
  it("a planned visit", () => {
    expect(glanceLine(t({ status: "in_progress", scheduled_for: "2026-10-16", scheduled_window: "morning" }), TODAY)).toBe("Visit planned for Fri, Oct 16, morning");
  });
  it("otherwise the status in words", () => {
    expect(glanceLine(t({}), TODAY)).toBe("Open");
    expect(glanceLine(t({ status: "resolved", resolved_at: "2026-08-01T00:00:00Z" }), TODAY)).toBe("Fixed");
  });
  it("counts open reports and ones waiting on the owner", () => {
    const rows = [
      t({ id: "1", status: "open" }),
      t({ id: "2", status: "in_progress" }),
      t({ id: "3", status: "resolved", resolved_at: "2026-10-12T00:00:00Z" }),
      t({ id: "4", status: "resolved", resolved_at: "2026-06-12T00:00:00Z" }),
      t({ id: "5", status: "closed", resolved_at: "2026-06-12T00:00:00Z" }),
    ];
    const s = summariseRepairs(rows, TODAY);
    expect(s.open).toBe(2);
    expect(s.waitingOnYou).toBe(1);
    expect(s.latest?.id).toBe("1");
    expect(summariseRepairs([], TODAY)).toEqual({ open: 0, waitingOnYou: 0, latest: null });
  });
});

describe("viewer names", () => {
  it("first word, or there", () => {
    expect(firstNameOf("Ada Okonkwo")).toBe("Ada");
    expect(firstNameOf("  ")).toBe("there");
    expect(firstNameOf("")).toBe("there");
  });
});

describe("StatementDownload", () => {
  it("renders nothing while the PDF route is switched off", () => {
    expect(StatementDownload({ unitId: "u", from: null, to: null, enabled: false })).toBeNull();
  });
  it("is switched on now that /statements/{unit}/pdf ships (money spec 8.6)", () => {
    expect(STATEMENT_PDF_ENABLED).toBe(true);
    expect(StatementDownload({ unitId: "u", from: null, to: null })).not.toBeNull();
  });
  it("links to the PDF route when enabled", () => {
    const el = StatementDownload({ unitId: "u1", from: "2026-01-01", to: "2026-12-31", enabled: true }) as unknown as {
      props: { href: string; children: string };
    };
    expect(el.props.href).toBe("/statements/u1/pdf?from=2026-01-01&to=2026-12-31");
    expect(el.props.children).toBe("Download PDF");
  });
});

import { inviteEmailBody, inviteEmailSubject } from "@/lib/owner/invite-email";

describe("invite email (owner-portal-spec 5.3)", () => {
  it("subject and body", () => {
    expect(inviteEmailSubject("2158 N. Damen")).toBe("Your 2158 N. Damen page on Walkup");
    const body = inviteEmailBody({ fullName: "Lou Nologin", associationName: "2158 N. Damen", inviteUrl: "https://www.walkuphoa.com/invite/abc", boardContactName: "Maria, treasurer" });
    expect(body.split("\n")[0]).toBe("Hi Lou,");
    expect(body).toContain("https://www.walkuphoa.com/invite/abc");
    expect(body).toContain("The link works once and expires in 7 days. You'll set up two-step sign-in the first time.");
    expect(body.endsWith("Thanks,\nMaria, treasurer")).toBe(true);
    expect(body).not.toContain("—");
  });
  it("falls back to The board and to there", () => {
    const body = inviteEmailBody({ fullName: " ", associationName: "A", inviteUrl: "u", boardContactName: null });
    expect(body.startsWith("Hi there,")).toBe(true);
    expect(body.endsWith("Thanks,\nThe board")).toBe(true);
  });
});
