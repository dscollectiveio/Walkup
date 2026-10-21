import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCOUNTANT_REMOVE_DAYS,
  ACCOUNTANT_UPLOAD_CATEGORIES,
  ACCOUNTANT_UPLOAD_COPY,
  accountantCategoryOptions,
  accountantRemovalDaysLeft,
  canAccountantRemove,
  isAccountantUploadCategory,
} from "@/lib/documents/accountant-uploads";
import { parseStoragePath, parseUnitDocumentPath } from "@/lib/documents/upload-paths";

const MIGRATION = readFileSync(path.resolve(import.meta.dirname, "../../supabase/migrations/0081_accountant_uploads_and_manager_view.sql"), "utf8");
const MIGRATION_0074 = readFileSync(path.resolve(import.meta.dirname, "../../supabase/migrations/0074_access_hardening.sql"), "utf8");

const DAY = 86_400_000;
const USER = "dddd0000-0000-0000-0000-00000000000f";
const doc = (over: Partial<Parameters<typeof canAccountantRemove>[0]> = {}) => ({
  uploadedBy: USER,
  uploadedAt: "2026-10-01T12:00:00Z",
  deletedAt: null,
  restrictedToUnitId: null,
  categorySlug: "invoice",
  ...over,
});
const at = (days: number) => Date.parse("2026-10-01T12:00:00Z") + days * DAY;

describe("the five categories", () => {
  it("are tax form, financial statement, bank statement, invoice and receipt, in that order", () => {
    expect(ACCOUNTANT_UPLOAD_CATEGORIES.map((c) => c.slug)).toEqual(["tax_form", "financial_statement", "bank_statement", "invoice", "receipt"]);
  });

  it("match the list in the migration, and each is a category the accountant already reads (0074)", () => {
    const sql = MIGRATION.match(/accountant_upload_category\(p_slug text\)[\s\S]*?p_slug in \(([^)]*)\)/)![1];
    const inSql = [...sql.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(inSql.sort()).toEqual(ACCOUNTANT_UPLOAD_CATEGORIES.map((c) => c.slug).sort());
    const readable = MIGRATION_0074.match(/accountant_document_category[\s\S]*?c\.slug in \(([^)]*)\)/)![1];
    for (const c of ACCOUNTANT_UPLOAD_CATEGORIES) expect(readable).toContain(`'${c.slug}'`);
  });

  it("accepts only those slugs", () => {
    for (const c of ACCOUNTANT_UPLOAD_CATEGORIES) expect(isAccountantUploadCategory(c.slug)).toBe(true);
    for (const bad of ["", "insurance", "vendor_document", "unit_owner_upload", "TAX_FORM", null, undefined, 4, {}]) {
      expect(isAccountantUploadCategory(bad)).toBe(false);
    }
  });

  it("limits a building's category list to the five, in the accountant's order, with no 'decide later'", () => {
    const all = ["insurance", "receipt", "governing", "tax_form", "invoice", "bank_statement", "financial_statement", "other"].map((slug) => ({ slug, id: slug }));
    expect(accountantCategoryOptions(all).map((c) => c.slug)).toEqual(["tax_form", "financial_statement", "bank_statement", "invoice", "receipt"]);
    expect(accountantCategoryOptions([{ slug: "invoice" }, { slug: "other" }]).map((c) => c.slug)).toEqual(["invoice"]);
    expect(accountantCategoryOptions([])).toEqual([]);
  });
});

describe("the 30 day removal window", () => {
  it("matches the migration", () => {
    expect(ACCOUNTANT_REMOVE_DAYS).toBe(30);
    expect(MIGRATION).toContain("interval '30 days'");
  });

  it("counts whole days left and stops at zero", () => {
    expect(accountantRemovalDaysLeft("2026-10-01T12:00:00Z", at(0))).toBe(30);
    expect(accountantRemovalDaysLeft("2026-10-01T12:00:00Z", at(10))).toBe(20);
    expect(accountantRemovalDaysLeft("2026-10-01T12:00:00Z", at(29.5))).toBe(1);
    expect(accountantRemovalDaysLeft("2026-10-01T12:00:00Z", at(30))).toBe(0);
    expect(accountantRemovalDaysLeft("2026-10-01T12:00:00Z", at(45))).toBe(0);
    expect(accountantRemovalDaysLeft("not a date", at(1))).toBe(0);
  });
});

describe("canAccountantRemove: when the page shows Remove", () => {
  it("their own, recent, unpinned, in one of the five", () => {
    expect(canAccountantRemove(doc(), USER, at(5))).toBe(true);
    expect(canAccountantRemove(doc({ categorySlug: "receipt" }), USER, at(29))).toBe(true);
  });

  it("not someone else's, not when signed out", () => {
    expect(canAccountantRemove(doc({ uploadedBy: "other" }), USER, at(5))).toBe(false);
    expect(canAccountantRemove(doc({ uploadedBy: null }), USER, at(5))).toBe(false);
    expect(canAccountantRemove(doc(), null, at(5))).toBe(false);
  });

  it("not after 30 days, once binned, when pinned to a unit, or in another category", () => {
    expect(canAccountantRemove(doc(), USER, at(30))).toBe(false);
    expect(canAccountantRemove(doc({ deletedAt: "2026-10-02T00:00:00Z" }), USER, at(5))).toBe(false);
    expect(canAccountantRemove(doc({ restrictedToUnitId: "u1" }), USER, at(5))).toBe(false);
    for (const categorySlug of ["insurance", "unit_owner_upload", null]) {
      expect(canAccountantRemove(doc({ categorySlug }), USER, at(5)), String(categorySlug)).toBe(false);
    }
  });
});

describe("the upload path", () => {
  const DAMEN = "11111111-1111-1111-1111-111111111111";
  it("is the hub path, never a unit or ticket path (what accountant_upload_association_id accepts)", () => {
    const hub = `${DAMEN}/1760000000000-abc123-statement.pdf`;
    expect(parseStoragePath(hub)).toEqual({ kind: "document", associationId: DAMEN });
    const unit = `${DAMEN}/units/aaaa1111-0000-0000-0000-000000000001/1760000000000-abc123-x.pdf`;
    expect(parseStoragePath(unit)).toBeNull();
    expect(parseUnitDocumentPath(unit)).not.toBeNull();
    expect(MIGRATION).toContain("k.kind = 'document'");
  });
});

describe("the migration's promises", () => {
  it("every new function pins search_path to empty and is revoked from public and anon", () => {
    const names = [
      "accountant_upload_category(text)",
      "accountant_upload_association_id(text)",
      "accountant_upload_pending_count(uuid)",
      "accountant_upload_allowed(text)",
      "accountant_upload_pending_allowed(text)",
      "register_accountant_document(text, text, text, bigint, text, text, text)",
      "remove_accountant_upload(uuid)",
    ];
    for (const n of names) expect(MIGRATION, n).toContain(`revoke all on function public.${n} from public, anon;`);
    const defs = MIGRATION.match(/create or replace function public\.[\s\S]*?\$\$;?/g) ?? [];
    expect(defs.length).toBeGreaterThanOrEqual(7);
    for (const d of defs) expect(d.slice(0, 600), d.slice(0, 60)).toContain("set search_path = ''");
  });

  it("gives the accountant no policy on documents itself", () => {
    expect(MIGRATION).not.toMatch(/create policy \w+ on public\.documents/);
    expect(MIGRATION).not.toMatch(/drop policy[^;]*public\.documents/);
  });

  it("files uploads board only, unpinned, as a person's choice, and never queues the AI", () => {
    expect(MIGRATION).toContain("'board_only'");
    expect(MIGRATION).toContain("'manual'");
    expect(MIGRATION).toContain("'skipped'");
  });
});

describe("copy", () => {
  it("has no em dashes", () => {
    for (const text of Object.values(ACCOUNTANT_UPLOAD_COPY)) expect(text).not.toMatch(/[—–]/);
  });
  it("never mentions a vendor or a role the owner pages would not", () => {
    for (const text of Object.values(ACCOUNTANT_UPLOAD_COPY)) expect(text).not.toMatch(/vendor/i);
  });
});
