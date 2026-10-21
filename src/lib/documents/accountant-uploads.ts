/**
 * What the accountant may add to Documents (migration 0081, DECISIONS #49). Pure, so server and client code and
 * the tests read one definition. The database is the real check (register_accountant_document,
 * remove_accountant_upload and the storage policies); this decides what to show and gives a plain answer first.
 *
 * No em dashes in any copy here.
 */

/** The only categories an accountant can add to, in the order the dropdown shows them. SQL: accountant_upload_category(). */
export const ACCOUNTANT_UPLOAD_CATEGORIES = [
  { slug: "tax_form", label: "Tax form" },
  { slug: "financial_statement", label: "Financial statement" },
  { slug: "bank_statement", label: "Bank statement" },
  { slug: "invoice", label: "Invoice or bill" },
  { slug: "receipt", label: "Receipt" },
] as const;

export type AccountantUploadCategory = (typeof ACCOUNTANT_UPLOAD_CATEGORIES)[number]["slug"];

/** An accountant can remove their own upload for this many days (SQL remove_accountant_upload). */
export const ACCOUNTANT_REMOVE_DAYS = 30;

export function isAccountantUploadCategory(value: unknown): value is AccountantUploadCategory {
  return typeof value === "string" && ACCOUNTANT_UPLOAD_CATEGORIES.some((c) => c.slug === value);
}

/** The categories from a building's list that the accountant may pick, in the accountant's order. */
export function accountantCategoryOptions<T extends { slug: string }>(all: readonly T[]): T[] {
  return ACCOUNTANT_UPLOAD_CATEGORIES.map((c) => all.find((x) => x.slug === c.slug)).filter((x): x is T => x !== undefined);
}

/** Whole days left in the removal window, 0 once it has passed. */
export function accountantRemovalDaysLeft(uploadedAtIso: string, nowMs: number): number {
  const uploaded = Date.parse(uploadedAtIso);
  if (Number.isNaN(uploaded)) return 0;
  const left = ACCOUNTANT_REMOVE_DAYS * 86_400_000 - (nowMs - uploaded);
  return left <= 0 ? 0 : Math.ceil(left / 86_400_000);
}

export interface RemovableCandidate {
  uploadedBy: string | null;
  uploadedAt: string;
  deletedAt: string | null;
  restrictedToUnitId: string | null;
  categorySlug: string | null;
}

/** Should the page offer "Remove" to this accountant on this document? Mirrors the checks in remove_accountant_upload. */
export function canAccountantRemove(doc: RemovableCandidate, userId: string | null, nowMs: number = Date.now()): boolean {
  return (
    userId !== null &&
    doc.uploadedBy === userId &&
    doc.deletedAt === null &&
    doc.restrictedToUnitId === null &&
    isAccountantUploadCategory(doc.categorySlug) &&
    accountantRemovalDaysLeft(doc.uploadedAt, nowMs) > 0
  );
}

export const ACCOUNTANT_UPLOAD_COPY = {
  help: "PDFs, photos, Word, Excel and text files, up to 25 MB each. The board can see them. Owners cannot.",
  categoryLabel: "File them as",
  categoryPlaceholder: "Choose a category",
  chooseFirst: "Choose a category first.",
  cantAdd: "You can't add documents here.",
  notThatCategory: "You can only add tax forms, financial statements, bank statements, invoices and receipts.",
  limitDaily: "You've added 20 documents today. Try again tomorrow.",
  remove: "Remove",
  removeConfirm: "Remove this document? The board can still restore it.",
  removeConfirmYes: "Remove",
  removeConfirmNo: "Keep it",
  removeFailed: "Couldn't remove the document. Try again.",
  removeRefused: "You can't remove this document.",
  removeWindowClosed: "You can only remove a document within 30 days of adding it. Ask the board to remove it.",
} as const;
