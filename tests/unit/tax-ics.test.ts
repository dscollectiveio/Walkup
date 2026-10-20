import { describe, expect, it } from "vitest";
import type { Deadline } from "@/lib/tax/deadlines";
import { buildCalendar, escapeText, foldLine } from "@/lib/tax/ics";

const deadline = (over: Partial<Deadline> & Pick<Deadline, "key" | "formCode" | "name">): Deadline => ({
  taxYear: 2025,
  kind: "Federal tax return",
  dueOn: "2026-04-15",
  basis: "verified",
  citation: "Instructions for Form 1120-H (2025), When To File",
  note: null,
  status: "not_started",
  formId: null,
  overdue: false,
  daysLeft: 73,
  href: "/tax#forms",
  milestones: [],
  ...over,
});

const h1120 = deadline({
  key: "irs_1120h:2025",
  formCode: "irs_1120h",
  name: "Form 1120-H",
  note: "A due date on a weekend moves to the next business day.",
  milestones: [{ key: "send", label: "Send Form 1120-H to your accountant", on: "2026-02-14" }],
});
const nec = deadline({
  key: "irs_1099_nec:2025:v-acme",
  formCode: "irs_1099_nec",
  vendorId: "v-acme",
  name: "1099-NEC — Acme, Plumbing; Sons\\Daughters",
  kind: "Federal filing",
  dueOn: "2026-01-31",
  basis: "estimated",
  citation: null,
  note: "Estimated — not yet checked against this year's instructions.",
});
const undated = deadline({ key: "irs_1120:2025", formCode: "irs_1120", name: "Form 1120", dueOn: null, basis: "none", citation: null, note: "ask your CPA" });

const base = { associationId: "assoc-1", associationName: "2158 N. Damen Condominium Association", deadlines: [h1120, nec, undated], generatedAt: "2026-01-02T00:05:00Z" };

const unfold = (ics: string) => ics.replace(/\r\n[ \t]/g, "");
const lines = (ics: string) => unfold(ics).split("\r\n").filter(Boolean);
const events = (ics: string) => unfold(ics).split("BEGIN:VEVENT").slice(1);
const octets = (s: string) => new TextEncoder().encode(s).length;

describe("buildCalendar", () => {
  const ics = buildCalendar(base);

  it("is a VCALENDAR with CRLF line endings and the Walkup header", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Walkup//Taxes//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
    expect(lines(ics)).toContain("X-WR-CALNAME:Walkup: 2158 N. Damen Condominium Association taxes");
  });

  it("writes one all-day event per dated deadline, skipping the ones with no date", () => {
    const ev = events(ics);
    // Two deadlines with dates plus one milestone.
    expect(ev).toHaveLength(3);
    expect(ics).not.toContain("Form 1120 due");
    expect(ev[0]).toContain("DTSTART;VALUE=DATE:20260415\r\nDTEND;VALUE=DATE:20260416\r\n");
    // DTEND is the next day, across a month end.
    expect(ev[2]).toContain("DTSTART;VALUE=DATE:20260131\r\nDTEND;VALUE=DATE:20260201\r\n");
  });

  it("gives every event a stable UID and a SEQUENCE that grows with each download", () => {
    const ev = events(ics);
    expect(ev[0]).toContain("UID:walkup-tax-assoc-1-irs_1120h:2025@walkup.app\r\n");
    expect(ev[2]).toContain("UID:walkup-tax-assoc-1-irs_1099_nec:2025:v-acme@walkup.app\r\n");
    // 2026-01-02T00:05Z is 1,445 minutes after 2026-01-01T00:00Z.
    expect(ev.every((e) => e.includes("SEQUENCE:1445\r\n"))).toBe(true);
    expect(ev[0]).toContain("DTSTAMP:20260102T000500Z\r\n");

    const later = buildCalendar({ ...base, generatedAt: "2026-10-11T15:30:00Z" });
    const uids = (s: string) => lines(s).filter((l) => l.startsWith("UID:"));
    expect(uids(later)).toEqual(uids(ics));
    expect(later).toContain("SEQUENCE:408450\r\n");
    expect(later).toContain("DTSTAMP:20261011T153000Z\r\n");
  });

  it("marks a verified date CONFIRMED and an estimated one TENTATIVE with '(estimated)' in the title", () => {
    const ev = events(ics);
    expect(ev[0]).toContain("SUMMARY:Walkup: Form 1120-H due\r\nSTATUS:CONFIRMED\r\n");
    expect(ev[2]).toContain("SUMMARY:Walkup: 1099-NEC — Acme\\, Plumbing\\; Sons\\\\Daughters due (estimated)\r\nSTATUS:TENTATIVE\r\n");
  });

  it("describes where the date came from, then links back to the Taxes tab", () => {
    const ev = events(ics);
    expect(ev[0]).toContain(
      "DESCRIPTION:Federal tax return\\nDue date from: Instructions for Form 1120-H (2025)\\, When To File\\nA due date on a weekend moves to the next business day.\\n/tax\r\n",
    );
    expect(ev[2]).toContain("DESCRIPTION:Federal filing\\nEstimated — not yet checked against this year's instructions.\\n/tax\r\n");
    const withUrl = buildCalendar({ ...base, appUrl: "https://walkup.app/" });
    expect(unfold(withUrl)).toContain("\\nhttps://walkup.app/tax\r\n");
    expect(unfold(withUrl)).not.toContain("\\n/tax\r\n");
  });

  it("alarms 30 and 7 days out, plus 60 for the returns", () => {
    const triggers = (e: string) => e.split("\r\n").filter((l) => l.startsWith("TRIGGER:")).map((l) => l.slice("TRIGGER:".length));
    const ev = events(ics);
    expect(triggers(ev[0])).toEqual(["-P60D", "-P30D", "-P7D"]);
    expect(triggers(ev[2])).toEqual(["-P30D", "-P7D"]);
    const alarm = ev[0].slice(ev[0].indexOf("BEGIN:VALARM"), ev[0].indexOf("END:VALARM"));
    expect(alarm).toContain("ACTION:DISPLAY\r\n");
    expect(alarm).toContain("DESCRIPTION:Walkup: Form 1120-H due\r\n");
    expect(ev[0].split("BEGIN:VALARM")).toHaveLength(4);
  });

  it("adds a day-of event per milestone with its own UID and one alarm", () => {
    const m = events(ics)[1];
    expect(m).toContain("UID:walkup-tax-assoc-1-irs_1120h:2025-send@walkup.app\r\n");
    expect(m).toContain("DTSTART;VALUE=DATE:20260214\r\nDTEND;VALUE=DATE:20260215\r\n");
    expect(m).toContain("SUMMARY:Walkup: Send Form 1120-H to your accountant\r\n");
    expect(m).toContain("DESCRIPTION:Form 1120-H is due April 15\\, 2026.\\n/tax\r\n");
    expect(m.split("BEGIN:VALARM")).toHaveLength(2);
    expect(m).toContain("TRIGGER:-P0D\r\n");
  });

  it("folds long lines at 75 octets without splitting a multi-byte character, and unfolds back exactly", () => {
    const longName = `1099-NEC — ${"Très long nom — ".repeat(8)}Plomberie`;
    const out = buildCalendar({ ...base, deadlines: [deadline({ key: "irs_1099_nec:2025:v-long", formCode: "irs_1099_nec", name: longName, basis: "estimated", citation: null, note: "x" })] });
    const physical = out.split("\r\n");
    expect(physical.some((l) => l.startsWith(" "))).toBe(true);
    for (const l of physical) expect(octets(l)).toBeLessThanOrEqual(75);
    expect(lines(out)).toContain(`SUMMARY:Walkup: ${escapeText(longName)} due (estimated)`);
  });
});

describe("foldLine / escapeText", () => {
  it("leaves a 75-octet line alone and folds the 76th octet onto a continuation line", () => {
    const seventyFive = "A".repeat(75);
    expect(foldLine(seventyFive)).toBe(seventyFive);
    expect(foldLine(`${seventyFive}B`)).toBe(`${seventyFive}\r\n B`);
    // Continuation lines count their leading space: 74 more characters fit, then it folds again.
    const folded = foldLine("A".repeat(75 + 74 + 1)).split("\r\n");
    expect(folded.map((l) => octets(l))).toEqual([75, 75, 2]);
  });

  it("keeps an em dash whole when it straddles the boundary", () => {
    const line = `${"A".repeat(74)}—B`; // the dash is 3 octets; 74 + 3 > 75
    expect(foldLine(line)).toBe(`${"A".repeat(74)}\r\n —B`);
  });

  it("escapes TEXT the RFC 5545 way", () => {
    expect(escapeText("a\\b;c,d\ne\r\nf")).toBe("a\\\\b\\;c\\,d\\ne\\nf");
    expect(escapeText("plain: colon stays")).toBe("plain: colon stays");
  });
});
