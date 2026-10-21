import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { vendorSource } from "./vendor-source";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Contractor names (and nothing else) for a list of contractor ids, id to name. Used where a page used to embed
 * `vendors(name)` in a query on another table: an embed reads the vendors table under the caller's policy, and
 * a property manager no longer reads that table (0081). Goes through vendors_manager for anyone who is not a
 * financial reader; a contractor the caller cannot read is simply absent from the map.
 */
export async function vendorNames(
  supabase: Supabase,
  ids: (string | null | undefined)[],
  canReadFinancials: boolean,
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
  const names = new Map<string, string>();
  if (unique.length === 0) return names;
  const { data } = await supabase.from(vendorSource(canReadFinancials)).select("id, name").in("id", unique);
  for (const v of (data ?? []) as { id: string; name: string }[]) names.set(v.id, v.name);
  return names;
}
