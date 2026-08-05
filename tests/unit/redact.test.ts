import { describe, expect, it } from "vitest";
import { redactTaxIds, REDACTION_MARKER } from "@/lib/documents/redact";

/**
 * The one piece of the extraction pipeline that must not be wrong.
 *
 * A W-9 carries a full Social Security number for any sole proprietor.
 * DECISIONS #4 keeps those out of this database deliberately, and reading text
 * out of documents is the obvious way to undo that by accident — so this runs
 * before the classifier prompt, before the database, and before search.
 */
describe("tax id redaction", () => {
  it("removes a Social Security number in the usual shape", () => {
    const { text, count } = redactTaxIds("Taxpayer ID: 123-45-6789 (sole proprietor)");
    expect(text).not.toContain("123-45-6789");
    expect(text).toBe(`Taxpayer ID: ${REDACTION_MARKER} (sole proprietor)`);
    expect(count).toBe(1);
  });

  it("removes an SSN written with spaces", () => {
    const { text } = redactTaxIds("SSN 123 45 6789");
    expect(text).not.toMatch(/\d{3}[-\s]\d{2}[-\s]\d{4}/);
  });

  it("removes an EIN", () => {
    const { text } = redactTaxIds("EIN: 36-4412290");
    expect(text).not.toContain("36-4412290");
  });

  it("removes an unpunctuated nine-digit number", () => {
    // A W-9 filled in by hand often has no dashes at all.
    const { text } = redactTaxIds("Enter your TIN: 123456789");
    expect(text).not.toContain("123456789");
  });

  it("removes every occurrence, not just the first", () => {
    const { text, count } = redactTaxIds("123-45-6789 and later 987-65-4321");
    expect(count).toBe(2);
    expect(text).not.toMatch(/\d{3}-\d{2}-\d{4}/);
  });

  it("leaves ordinary document text alone", () => {
    // The redactor is deliberately over-inclusive, but it must not eat the
    // things a board actually searches for.
    const original =
      "Policy AB-123456 renews 2026-01-01 for $12,500.00 at 2158 N. Damen, Chicago IL 60647.";
    const { text, count } = redactTaxIds(original);
    expect(text).toBe(original);
    expect(count).toBe(0);
  });

  it("does not mistake a phone number or a year for a TIN", () => {
    const original = "Call (773) 555-0142 before 2026. Invoice 4412 paid.";
    const { text, count } = redactTaxIds(original);
    expect(text).toBe(original);
    expect(count).toBe(0);
  });

  it("over-redacts rather than under-redacts a bare long number", () => {
    // A nine-digit run that happens to be a reference number gets redacted
    // too. That is the intended trade: a slightly worse search index costs
    // less than one leaked SSN.
    const { count } = redactTaxIds("Reference 400123456 on file");
    expect(count).toBe(1);
  });
});
