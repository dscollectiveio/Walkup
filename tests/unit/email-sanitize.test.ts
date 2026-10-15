import { describe, expect, it } from "vitest";
import { cleanHeaderText, displayNameFor, escapeHtml, fromHeader, safeFilename, tagValue } from "@/lib/email-outbox/sanitize";

const INJECTIONS = ["a\r\nBcc: evil@x.test", "a\nBcc: evil@x.test", "a\rBcc: evil@x.test", "a\u0000b", "a\u2028Bcc: x", "a\u0085b", "a\u001b[31mb", "a\tb"];

describe("cleanHeaderText", () => {
  it("removes CR, LF, NUL and other control characters from every field", () => {
    for (const s of INJECTIONS) {
      const out = cleanHeaderText(s);
      expect(out, JSON.stringify(s)).not.toMatch(/[\r\n\u0000\u2028\u2029\u0085\u001b\t]/);
    }
  });

  it("turns a line break into a single space so words do not run together", () => {
    expect(cleanHeaderText("Dues\r\nreminder")).toBe("Dues reminder");
  });

  it("leaves a percent-encoded break alone: it is text, not a break", () => {
    expect(cleanHeaderText("a%0d%0aBcc: x")).toBe("a%0d%0aBcc: x");
  });

  it("collapses spaces, trims and cuts to the limit", () => {
    expect(cleanHeaderText("  a   b  ")).toBe("a b");
    expect(cleanHeaderText("x".repeat(300), 200)).toHaveLength(200);
    expect(cleanHeaderText("é".repeat(10))).toBe("é".repeat(10));
  });
});

describe("displayNameFor and fromHeader", () => {
  it("prefixes Walkup on behalf of and keeps it to 78 characters", () => {
    expect(displayNameFor("2158 N. Damen")).toBe("Walkup on behalf of 2158 N. Damen");
    expect(displayNameFor("N".repeat(200))).toHaveLength(78);
    expect(displayNameFor("")).toBe("Walkup on behalf of your building");
  });

  it("drops quotes, angle brackets, backslashes and line breaks from the name", () => {
    const n = displayNameFor('Evil" <x@y.test>\r\nBcc: z\\');
    expect(n).not.toMatch(/["<>\\\r\n]/);
  });

  it("builds a quoted display name with an angle-bracket address", () => {
    expect(fromHeader("Hoyne & Sons", "notifications@walkuphoa.com")).toBe('"Walkup on behalf of Hoyne & Sons" <notifications@walkuphoa.com>');
  });

  it("refuses an address that is not one plain mailbox", () => {
    for (const bad of ["a@b.test, c@d.test", "a b@c.test", "<a@b.test>", "a@b.test\r\nBcc: x@y.test", "no-at-sign"]) {
      expect(() => fromHeader("X", bad), bad).toThrow();
    }
  });

  it("never lets an association name end the quoted string early", () => {
    const h = fromHeader('"; Bcc: x@y.test; "', "notifications@walkuphoa.com");
    expect(h.match(/"/g)).toHaveLength(2);
    expect(h).not.toMatch(/[\r\n]/);
  });
});

describe("escapeHtml, safeFilename, tagValue", () => {
  it("escapes the five HTML characters", () => {
    expect(escapeHtml(`<script>alert("x")&'</script>`)).toBe("&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;&lt;/script&gt;");
  });

  it("keeps only letters, digits, space, dot, underscore and hyphen in a file name", () => {
    expect(safeFilename("Statement Unit 2 Q3 2026.pdf")).toBe("Statement Unit 2 Q3 2026.pdf");
    expect(safeFilename("../../etc/passwd\r\n")).not.toMatch(/[\/\\\r\n]/);
    expect(safeFilename("Müller Unit")).toBe("Muller Unit");
    expect(safeFilename("x".repeat(200)).length).toBeLessThanOrEqual(80);
    expect(safeFilename("")).toBe("file");
  });

  it("limits a provider tag to letters, digits, underscore and hyphen", () => {
    expect(tagValue("abc-123_x y,z\r\n")).toBe("abc-123_x_y_z__");
  });
});
