import { describe, expect, it } from "vitest";
import { COI_SOON_DAYS, complianceFor, LICENSE_SOON_DAYS, usedRecently, type ComplianceInput } from "@/lib/contractors/compliance";

const TODAY = "2026-10-14";
const v = (over: Partial<ComplianceInput> = {}): ComplianceInput => ({
  insured_until: "2027-06-01", license_number: "PL-1234", license_expires_on: "2027-06-01",
  w9_on_file: true, is_1099_exempt: false, status: "okay", archived_at: null, inUse: true, tradeNeedsLicense: true, ...over,
});
const keys = (input: ComplianceInput) => complianceFor(input, TODAY).items.map((i) => i.key);

describe("complianceFor", () => {
  it("an unreadable date is a problem, never silently fine (REVIEW-4 #15)", () => {
    expect(keys(v({ insured_until: "not a date" }))).toEqual(["coi_expired"]);
    expect(keys(v({ license_expires_on: "soon" }))).toEqual(["license_expired"]);
    expect(complianceFor(v({ insured_until: "garbage" }), TODAY).worst).toBe("bad");
  });

  it("is clean when everything is on file and current", () => {
    expect(complianceFor(v(), TODAY)).toEqual({ items: [], worst: "ok" });
  });

  it("uses 30 days for certificates and 60 for licenses", () => {
    expect(COI_SOON_DAYS).toBe(30);
    expect(LICENSE_SOON_DAYS).toBe(60);
    expect(keys(v({ insured_until: "2026-11-13" }))).toEqual(["coi_soon"]); // 30 days
    expect(keys(v({ insured_until: "2026-11-14" }))).toEqual([]); // 31 days
    expect(keys(v({ insured_until: TODAY }))).toEqual(["coi_soon"]);
    expect(keys(v({ insured_until: "2026-10-13" }))).toEqual(["coi_expired"]);
    expect(keys(v({ license_expires_on: "2026-12-13" }))).toEqual(["license_soon"]); // 60 days
    expect(keys(v({ license_expires_on: "2026-12-14" }))).toEqual([]);
    expect(keys(v({ license_expires_on: "2026-01-01" }))).toEqual(["license_expired"]);
  });

  it("words each item and its action", () => {
    const r = complianceFor(v({ insured_until: "2026-10-01", license_expires_on: "2026-11-01" }), TODAY);
    expect(r.worst).toBe("bad");
    expect(r.items).toEqual([
      { key: "coi_expired", tone: "bad", text: "Insurance certificate expired Thu, Oct 1", action: "request_coi" },
      { key: "license_soon", tone: "warning", text: "License expires Sun, Nov 1", action: "edit" },
    ]);
    const missing = complianceFor(v({ insured_until: null, license_number: null, license_expires_on: null, w9_on_file: false }), TODAY);
    expect(missing.worst).toBe("warning");
    expect(missing.items).toEqual([
      { key: "coi_missing", tone: "warning", text: "No insurance certificate on file", action: "request_coi" },
      { key: "license_missing", tone: "warning", text: "No license number on file", action: "edit" },
      { key: "w9_missing", tone: "warning", text: "No W-9 on file", action: "request_w9" },
    ]);
  });

  it("puts bad items first", () => {
    expect(keys(v({ insured_until: null, license_expires_on: "2026-01-01" }))).toEqual(["license_expired", "coi_missing"]);
  });

  it("raises missing paperwork only for contractors in use", () => {
    const unused = v({ inUse: false, insured_until: null, license_number: null, license_expires_on: null, w9_on_file: false });
    expect(keys(unused)).toEqual([]);
    // Expired and expiring still show.
    expect(keys({ ...unused, insured_until: "2026-09-01", license_expires_on: "2026-11-01" })).toEqual(["coi_expired", "license_soon"]);
  });

  it("asks for a license number only where the trade usually has one, and a W-9 only when not exempt", () => {
    expect(keys(v({ license_number: null, license_expires_on: null, tradeNeedsLicense: false }))).toEqual([]);
    expect(keys(v({ license_number: "  ", license_expires_on: null }))).toEqual(["license_missing"]);
    expect(keys(v({ w9_on_file: false, is_1099_exempt: true }))).toEqual([]);
  });

  it("returns nothing for archived and do-not-use contractors", () => {
    const expired = { insured_until: "2026-01-01", w9_on_file: false };
    expect(complianceFor(v({ ...expired, archived_at: "2026-09-01T00:00:00Z" }), TODAY)).toEqual({ items: [], worst: "ok" });
    expect(complianceFor(v({ ...expired, status: "do_not_use" }), TODAY)).toEqual({ items: [], worst: "ok" });
  });
});

describe("usedRecently", () => {
  it("is within the last 365 days, up to today", () => {
    expect(usedRecently("2026-10-14", TODAY)).toBe(true);
    expect(usedRecently("2025-10-14", TODAY)).toBe(true);
    expect(usedRecently("2025-10-13", TODAY)).toBe(false);
    expect(usedRecently("2026-10-15", TODAY)).toBe(false);
    expect(usedRecently(null, TODAY)).toBe(false);
  });
});
