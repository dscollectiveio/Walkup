/**
 * What one click may open to every owner (REVIEW-2 #17). An allow-list, not a
 * block-list: bank statements, tax forms, contractor paperwork (W-9s), insurance,
 * contracts, correspondence and anything unfiled stay board-only. A file attached from the announcement composer is
 * filed as "announcement_file" because attaching it to a notice for owners is the decision to share it (0089).
 */
export const SHAREABLE_CATEGORIES: ReadonlySet<string> = new Set(["governing", "minutes", "financial_statement", "announcement_file"]);

export function canShareWithOwners(categorySlug: string | null | undefined, restrictedToUnitId: string | null): boolean {
  return Boolean(categorySlug) && SHAREABLE_CATEGORIES.has(categorySlug as string) && restrictedToUnitId === null;
}
