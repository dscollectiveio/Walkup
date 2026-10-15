/**
 * Plain-English words for what the import functions say (import-spec 7.1, 8.1). Pure.
 * No em dashes, and "contractor", never "vendor".
 */

export const ERROR_HEADING: Record<string, string> = {
  date_bad: "Date",
  amount_bad: "Amount",
  description_missing: "Description",
  before_opening: "Already counted",
  already_in_books: "Already in your books",
  already_in_bank_feed: "Already in the bank feed",
  fiscal_year_missing: "Year missing",
  fiscal_year_closed: "Year closed",
  category_missing: "Category",
  category_unmapped: "Category",
  transfer_not_supported: "Transfer",
  ar_not_allowed: "Dues owed",
  sign_expense: "Amount",
  sign_income: "Amount",
  fund_unmapped: "Fund",
  fund_unknown: "Fund",
  unit_unknown: "Unit",
  unit_missing: "Unit",
  unit_long: "Unit",
  payee_unknown: "Contractor",
  owner_name_missing: "Owner",
  owner_conflict: "Owner",
  email_bad: "Email",
  percent_bad: "Ownership",
  dues_bad: "Dues",
  account_unknown: "Account",
  account_type: "Account",
  name_missing: "Name",
  name_long: "Name",
  tin_not_accepted: "Tax ID",
  parse_formula: "Formula",
  parse_cell_long: "Cell too long",
  parse_amount_conflict: "Amount",
  parse_amount_comma: "Amount",
};

export function errorHeading(code: string): string {
  return ERROR_HEADING[code] ?? "Problem";
}

/** The field a row error belongs to, mapped to the input that fixes it in the fix table. */
export const ERROR_FIELD_TO_MAPPED: Record<string, string> = {
  date: "date",
  amount: "amount",
  description: "description",
  category: "category_key",
  fund: "fund_key",
  unit: "unit_label",
  payee: "payee",
  unit_label: "unit_label",
  owner_name: "owner_name",
  email: "email",
  ownership_percent: "ownership_percent",
  dues_amount: "dues_amount",
  name: "name",
  account: "account_key",
};

export interface RpcErrorLike {
  code?: string | null;
  message?: string | null;
  hint?: string | null;
}

export const GENERIC_IMPORT_ERROR = "Something went wrong. Nothing was imported.";

function sentence(text: string): string {
  const t = text.trim();
  if (!t) return GENERIC_IMPORT_ERROR;
  const s = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

/** What to show for a Postgres error from an import function (8.1 plus the undo and setup cases). */
export function importErrorMessage(error: RpcErrorLike | null | undefined): { message: string; hint: string | null } {
  if (!error) return { message: GENERIC_IMPORT_ERROR, hint: null };
  const hint = error.hint ?? null;
  const code = error.code ?? "";
  if (code === "42501") return { message: "Only a board admin can import.", hint };
  if (hint === "preview_stale") {
    return { message: "Something changed since the preview (a unit, a year, an account). Review the preview again.", hint };
  }
  if (hint === "batch_errors") return { message: "Fix the problems at the top of the preview first.", hint };
  if (hint === "nothing") return { message: "There is nothing to import.", hint };
  if (hint === "rows_missing") return { message: "The file was not fully loaded. Start the import again.", hint };
  if (hint === "too_many_open") return { message: "Finish or cancel an earlier import first.", hint };
  if (hint === "exempt_required") return { message: "Say whether this counts toward your tax-exempt activity.", hint };
  if (hint === "year_closed") {
    return { message: "A fiscal year these entries are in has closed, so they can no longer be reversed.", hint };
  }
  if (hint === "fy_not_december") {
    return { message: "Add this fiscal year by hand: your year does not end in December.", hint };
  }
  if (hint === "fy_overlap") {
    return { message: "That year overlaps a fiscal year you already have. Add it by hand.", hint };
  }
  if (hint?.startsWith("already_imported:")) return { message: "This file was already imported.", hint };
  if (hint === "in_use") return { message: sentence(error.message ?? ""), hint };
  if (code === "23505") return { message: "This file was already imported.", hint };
  if (code === "23514" || /fiscal year .* closed|period/i.test(error.message ?? "")) {
    return { message: "That fiscal year is closed. Skip those rows or choose another date.", hint };
  }
  if (code === "22023" && error.message) return { message: sentence(error.message), hint };
  return { message: GENERIC_IMPORT_ERROR, hint };
}

/** The earlier batch id inside a hint like "already_imported:<uuid>". */
export function alreadyImportedBatchId(hint: string | null | undefined): string | null {
  const m = /^already_imported:([0-9a-f-]{36})$/i.exec(hint ?? "");
  return m ? m[1] : null;
}
