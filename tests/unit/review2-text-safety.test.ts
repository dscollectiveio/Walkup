import { vi } from "vitest";
// Regression tests for docs/security/REVIEW-2-server.md findings 9, 10, 14, 15, 16: text that reaches a model,
// a mail client, a calendar or a PostgREST filter.
import { describe, expect, it } from "vitest";
import { redactTaxIds } from "@/lib/documents/redact";
import { headerForAi } from "@/lib/import/shape";
import { buildAiMappingRequest } from "@/lib/import/ai-mapping";
import { mailtoHref, mailtoLink, gmailComposeHref } from "@/lib/email/mailto";
import { buildRepairsCalendar } from "@/lib/upkeep/ics";
import { escapeText } from "@/lib/tax/ics";
import { listDocuments } from "@/lib/documents/access";

vi.mock("server-only", () => ({}));

const LS = String.fromCharCode(0x2028);
const NEL = String.fromCharCode(0x85);
const VT = String.fromCharCode(0x0b);
const FF = String.fromCharCode(0x0c);

describe("10. redactTaxIds survives look-alike separators and digits", () => {
  const cases = [
    "SSN 123-45-6789",
    "SSN 123–45–6789", // en dash
    "SSN 123‑45‑6789", // non-breaking hyphen
    "SSN 123 – 45 – 6789",
    "SSN 123-45-\n6789", // PDF line break
    "SSN 123.45.6789",
    "SSN １２３-４５-６７８９", // full-width digits
    "EIN 12–3456789",
    "TIN 123 456 789",
    "TIN 1 2 3 4 5 6 7 8 9",
    "TIN 123456789",
    "SSN 123 45 6789",
    "123-456-789",
  ];
  for (const c of cases) {
    it(`redacts ${JSON.stringify(c)}`, () => {
      const r = redactTaxIds(c);
      expect(r.count).toBeGreaterThan(0);
      expect(r.text).not.toMatch(/\d{3}/);
    });
  }

  it("leaves ordinary figures alone", () => {
    for (const t of ["Units 101 102 103", "Call (312) 555-0142", "Invoice 2026-10-14 for $1,250.00", "Policy BOP-1234567"]) {
      expect(redactTaxIds(t).text, t).toBe(t);
    }
  });
});

describe("9. a headerless import file never sends its first row as column names", () => {
  it("hides names, street addresses, amounts and dates that stand where a header should", () => {
    for (const [i, h] of ["Jane Doe", "415 W Oakdale Ave Unit 2B", "1,250.00", "10/14/2026", "Chicago IL"].entries()) {
      expect(headerForAi(h, i), h).toBe(`[column ${i + 1}]`);
    }
  });

  it("keeps real column titles", () => {
    for (const h of ["Owner Name", "Unit Number", "Mailing Address", "Email", "Phone", "Dues Amount", "Square Feet", "Balance"]) {
      expect(headerForAi(h, 0), h).toBe(h);
    }
  });

  it("the request text carries no value from a headerless file", () => {
    const headers = ["Jane Doe", "415 W Oakdale Ave Unit 2B", "1,250.00", "Chicago IL 60657", "Oct 14 2026"];
    const req = buildAiMappingRequest("units_owners", headers, [["John Roe", "416 W Oakdale", "1,250.00", "x", "y"]]);
    const sent = req.text.slice(req.text.indexOf("Columns:"));
    expect(sent).not.toMatch(/Jane|Doe|Oakdale|1,250|Chicago|60657/);
  });
});

describe("14. mail links", () => {
  it("drops a recipient that carries a second address or header, and puts the subject on one line", () => {
    const href = mailtoHref(["a@b.com,evil@x.example", "ok@b.com"], "Hi\r\nBcc: x@y.example", "body");
    expect(href).toMatch(/^mailto:ok%40b\.com\?/);
    expect(href).not.toMatch(/evil/i);
    expect(href.split("&body=")[0]).not.toMatch(/%0D|%0A/i);
    expect(href.split("&body=")[0]).toBe("mailto:ok%40b.com?subject=Hi%20Bcc%3A%20x%40y.example");
  });

  it("drops recipients with brackets, quotes, semicolons or whitespace in the Gmail link too", () => {
    const href = gmailComposeHref(["<a@b.com>", 'a"@b.com', "a@b.com;c@d.com", "a b@c.com", "fine@b.com"], "S", "B");
    expect(href).toContain("to=fine%40b.com&");
  });

  it("mailtoLink encodes parameters smuggled into a stored address", () => {
    const href = mailtoLink("info@acme.example?bcc=attacker@evil.example&subject=x");
    expect(href).not.toMatch(/[?&=]/);
    expect(mailtoLink("pat@example.com")).toBe("mailto:pat@example.com");
  });
});

describe("16. calendar text cannot start a new line", () => {
  it("escapeText turns every separator into a space", () => {
    for (const ch of [LS, NEL, VT, FF, "\t", "\u007f"]) {
      expect(escapeText(`a${ch}b`)).toBe("a b");
    }
    expect(escapeText("a\nb,c;d")).toBe("a\\nb\\,c\\;d");
  });

  it("a ticket title with U+2028 and U+0085 stays inside its SUMMARY line", () => {
    const ics = buildRepairsCalendar({
      associationId: "a",
      associationName: "A",
      generatedAt: "2026-10-14T00:00:00Z",
      items: [{
        uid: "x@walkup", sequence: 1, date: "2026-11-01",
        title: `Boiler${LS}BEGIN:VEVENT${LS}SUMMARY:Pay evil.example${NEL}END:VEVENT`,
        description: "d", url: "https://walkup.example/x", alarmDaysBefore: null,
      }],
    });
    expect(ics.includes(LS)).toBe(false);
    expect(ics.includes(NEL)).toBe(false);
    const lines = ics.split(new RegExp(`\\r\\n|[${LS}${NEL}\\n\\r]`));
    expect(lines.filter((l) => /^(BEGIN:VEVENT|SUMMARY:Pay|END:VEVENT)/.test(l))).toEqual(["BEGIN:VEVENT", "END:VEVENT"]);
  });
});

describe("15. document search words cannot add filters", () => {
  it("quotes the term for or()", async () => {
    let seen = "";
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "not", "is"]) chain[m] = () => chain;
    chain.or = (expr: string) => {
      seen = expr;
      return chain;
    };
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
    const supabase = { from: () => chain } as never;
    await listDocuments(supabase, { q: 'roof),id.neq.0,(title.ilike."x' });
    expect(seen).toBe(
      'title.ilike."%roof),id.neq.0,(title.ilike.\\"x%",filename.ilike."%roof),id.neq.0,(title.ilike.\\"x%",extracted_text.ilike."%roof),id.neq.0,(title.ilike.\\"x%"',
    );
  });
});
