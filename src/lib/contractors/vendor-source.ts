/**
 * Where a viewer reads contractors from (migration 0081, DECISIONS #49). Pure: no server or browser imports.
 *
 * The `vendors` table holds each contractor's tax identity (entity type, last four digits of the TIN, W-9
 * flags, 1099 exemption). Only the board and the accountant read the table. A property manager reads
 * contractors through `vendors_manager`, a view with the same rows and every column except those five, so a
 * query written for the table does not work for a manager unless it goes through here.
 *
 * Rules for a caller:
 *   - `vendorSource(canReadFinancials)` picks the table or the view.
 *   - `vendorColumns(list, canReadFinancials)` drops the tax columns from a select list for a manager, so a
 *     shared column list does not ask the view for something it does not have.
 *   - A manager's rows have no `w9_on_file` or `is_1099_exempt`. Pass `taxFlag()` where a boolean is needed so
 *     "not shown to this viewer" never reads as "missing".
 */

/** Columns only a financial reader (board, accountant) may read from a contractor. */
export const VENDOR_TAX_COLUMNS = ["entity_type", "tin_last4", "w9_on_file", "w9_received_on", "is_1099_exempt"] as const;

export const VENDOR_TABLE = "vendors";
export const VENDOR_MANAGER_VIEW = "vendors_manager";

export function vendorSource(canReadFinancials: boolean): typeof VENDOR_TABLE | typeof VENDOR_MANAGER_VIEW {
  return canReadFinancials ? VENDOR_TABLE : VENDOR_MANAGER_VIEW;
}

/** Split a select list on its top-level commas (a comma inside parentheses belongs to an embed). */
function splitTopLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** The column name a select item reads: "w9_on_file", "alias:w9_on_file" and "w9_on_file::text" all give "w9_on_file". */
function columnOf(item: string): string {
  const noCast = item.split("::")[0].trim();
  const aliased = noCast.match(/^[A-Za-z0-9_]+:([A-Za-z0-9_]+)$/);
  return aliased ? aliased[1] : noCast;
}

/** A select list for contractors: unchanged for a financial reader, without the tax columns for anyone else. */
export function vendorColumns(list: string, canReadFinancials: boolean): string {
  if (canReadFinancials) return list;
  const tax = new Set<string>(VENDOR_TAX_COLUMNS);
  return splitTopLevel(list)
    .filter((item) => !tax.has(columnOf(item)))
    .join(", ");
}

/**
 * A tax flag as a boolean for code that warns when it is false. A financial reader gets the real value; anyone
 * else gets `true`, because the answer is not theirs to see and must not read as a missing W-9.
 */
export function taxFlag(value: unknown, canReadFinancials: boolean): boolean {
  return canReadFinancials ? value === true : true;
}

/** True for a select list that asks for any tax column (used by tests and by the source-text guard). */
export function asksForTaxColumns(list: string): boolean {
  const tax = new Set<string>(VENDOR_TAX_COLUMNS);
  return splitTopLevel(list).some((item) => tax.has(columnOf(item)));
}

/**
 * Rows of a contractor query whose select list was built at run time (vendorColumns). The query client can only
 * type a select list it can read as a literal, so these come back loosely typed; read each field with a cast, as
 * the pages already do.
 */
export function vendorRows(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}
