import { describe, expect, it } from "vitest";
import {
  findBlanks,
  fitsMailto,
  gmailComposeHref,
  MAILTO_SAFE_LENGTH,
  mailtoHref,
  mailtoPasteHref,
  outlookComposeHref,
  parseEmailList,
  parseEmailListDetailed,
  PASTE_HINT,
  pasteHref,
  plainTextEmail,
} from "@/lib/email/mailto";

const query = (href: string) => new URLSearchParams(href.slice(href.indexOf("?") + 1));

describe("mailtoHref", () => {
  it("sends CRLF bodies and encodes the subject", () => {
    const href = mailtoHref("a@x.com", "Q&A? #1", "One\nTwo\r\nThree");
    expect(href).toContain("%0D%0A");
    expect(href).toContain("subject=Q%26A%3F%20%231");
    expect(query(href).get("body")).toBe("One\r\nTwo\r\nThree");
  });
  it("handles one, several, null and empty recipients", () => {
    expect(mailtoHref("a@x.com", "S", "b").startsWith("mailto:a%40x.com?")).toBe(true);
    expect(mailtoHref([" a@x.com ", "", "b@x.com"], "S", "b").startsWith("mailto:a%40x.com,b%40x.com?")).toBe(true);
    expect(mailtoHref(null, "S", "b").startsWith("mailto:?subject=S&body=b")).toBe(true);
    expect(mailtoHref([], "S", "b").startsWith("mailto:?subject=")).toBe(true);
  });
  it("adds cc and bcc after subject and body", () => {
    const href = mailtoHref("me@x.com", "S", "b", { cc: ["c@x.com"], bcc: ["d@x.com", "e@x.com"] });
    expect(href).toBe("mailto:me%40x.com?subject=S&body=b&cc=c%40x.com&bcc=d%40x.com,e%40x.com");
    expect(mailtoHref("me@x.com", "S", "b", { cc: [], bcc: [] })).toBe("mailto:me%40x.com?subject=S&body=b");
  });
});

describe("web mail compose links", () => {
  it("Gmail: exact base and parameter names", () => {
    const href = gmailComposeHref("a@x.com", "Hi", "One\nTwo", { bcc: ["b@x.com"] });
    expect(href.startsWith("https://mail.google.com/mail/?view=cm&fs=1&to=a%40x.com")).toBe(true);
    const q = query(href);
    expect(q.get("su")).toBe("Hi");
    expect(q.get("body")).toBe("One\r\nTwo");
    expect(q.get("bcc")).toBe("b@x.com");
  });
  it("Outlook.com: exact base and parameter names", () => {
    const href = outlookComposeHref(["a@x.com"], "Hi", "One\nTwo", { bcc: ["b@x.com"], cc: ["c@x.com"] });
    expect(href.startsWith("https://outlook.live.com/mail/0/deeplink/compose?to=a%40x.com")).toBe(true);
    const q = query(href);
    expect(q.get("subject")).toBe("Hi");
    expect(q.get("body")).toBe("One\r\nTwo");
    expect(q.get("cc")).toBe("c@x.com");
    expect(q.get("bcc")).toBe("b@x.com");
  });
});

describe("length guard", () => {
  it("fits at 1,800 and not at 1,801", () => {
    expect(MAILTO_SAFE_LENGTH).toBe(1800);
    expect(fitsMailto("12345", "x".repeat(1795))).toBe(true);
    expect(fitsMailto("12345", "x".repeat(1796))).toBe(false);
  });
  it("paste links carry no body text except the hint", () => {
    for (const app of ["mailto", "gmail", "outlook"] as const) {
      const href = pasteHref(app, "a@x.com", "Subject", { bcc: ["b@x.com"] });
      expect(query(href).get("body")).toBe(PASTE_HINT);
      expect(href).toContain("b%40x.com");
    }
    expect(mailtoPasteHref(null, "S")).toBe(pasteHref("mailto", null, "S"));
  });
});

describe("parseEmailListDetailed", () => {
  it("splits, dedupes case-insensitively and reports the rest", () => {
    expect(parseEmailListDetailed("a@x.com; B@x.com, a@X.com  bob@acme")).toEqual({
      emails: ["a@x.com", "B@x.com"],
      invalid: ["bob@acme"],
    });
    expect(parseEmailList("a@x.com; B@x.com, a@X.com  bob@acme")).toEqual(["a@x.com", "B@x.com"]);
    expect(parseEmailList("<pat@acme.com>")).toEqual(["pat@acme.com"]);
  });
});

describe("findBlanks", () => {
  it("finds blanks across subject and body, unique, in order", () => {
    expect(
      findBlanks("About [preferred dates]", "Quote [check: $12,500] and [link removed], [preferred dates] again"),
    ).toEqual(["[preferred dates]", "[check: $12,500]", "[link removed]"]);
  });
  it("ignores very long brackets and brackets across lines", () => {
    expect(findBlanks("", `[${"x".repeat(61)}] and [across\nlines]`)).toEqual([]);
  });
});

describe("plainTextEmail", () => {
  it("puts the subject first", () => {
    expect(plainTextEmail("Hi", "Body")).toBe("Subject: Hi\n\nBody");
  });
});
