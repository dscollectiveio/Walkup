/**
 * What a document can be attached to. Client-safe (entity-documents.tsx reads
 * isLinkableTable in the browser); the pages to refresh after a link live in
 * link-revalidate.ts, which needs next/cache.
 *
 * A module of its own rather than exports from link-actions.ts: a "use
 * server" file may export only async functions, and both the old link
 * actions and the direct-upload actions need these. Client components import
 * the `LinkableTable` type only.
 *
 * Kept in step with the check constraint added in 0020
 * (document_links_target_table_known, widened in 0042) — a target this
 * doesn't list would be accepted here and rejected at the database, which is
 * a worse place to find out. No `meetings` entry: there is no meetings table.
 * No due-date entry: due dates are computed at render time (0017), never
 * stored, so nothing to point a link at. `tax_forms`: filled packets and
 * proof of filing attach to the form (0042, 0048). `insurance_quotes` and
 * `insurance_claims`: a quote's PDF and a claim's paperwork (0052).
 */
export const LINKABLE_TABLES = [
  "units",
  "persons",
  "vendors",
  "journal_entries",
  "expenses",
  "assessment_charges",
  "payments",
  "insurance_policies",
  "tickets",
  "recurring_bills",
  "fiscal_years",
  "tax_forms",
  "insurance_quotes",
  "insurance_claims",
] as const;

export type LinkableTable = (typeof LINKABLE_TABLES)[number];

export function isLinkableTable(value: string): value is LinkableTable {
  return (LINKABLE_TABLES as readonly string[]).includes(value);
}
