// Search text for the problems list (repairs-spec §5.7). Pure.

/**
 * A PostgREST `ilike` value for use inside `or(...)`: LIKE wildcards in the
 * search are escaped (so "50%" finds "50%", not everything), the whole value
 * is wrapped in `%…%`, then quoted the way PostgREST quotes reserved
 * characters (`,` `.` `:` `(` `)`) inside `or()`.
 *
 *   postgrestIlikeValue('a,b "c"') === '"%a,b \\"c\\"%"'
 */
export function postgrestIlikeValue(q: string): string {
  const like = String(q ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
  const wrapped = `%${like}%`;
  return `"${wrapped.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** "#12" or "12" (after trimming) is a problem number; anything else is text. */
export function referenceFromQuery(q: string): number | null {
  const m = /^#?\s*(\d{1,9})$/.exec(String(q ?? "").trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
