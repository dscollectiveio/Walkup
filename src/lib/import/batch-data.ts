import "server-only";
import type { Supabase } from "./server";

// The query builder's generic types are too deep to restate for a caller-supplied filter.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Filter = (q: any) => any;

/** PostgREST returns at most 1,000 rows a request, so a batch of up to 5,000 is read in pages. */
export async function fetchAllRows<T>(supabase: Supabase, batchId: string, columns: string, filter?: Filter): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 6000; from += 1000) {
    let q = supabase.from("import_rows").select(columns).eq("batch_id", batchId).order("row_number");
    if (filter) q = filter(q);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as T[];
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}
