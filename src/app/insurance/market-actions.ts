"use server";

import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { finishMarketResearch, runMarketResearch } from "@/lib/insurance/market";
import { revalidateInsurance } from "./action-helpers";

/**
 * "Search for agencies" / "Search for insurers" (insurance-spec §8.9). Claims
 * the search and returns at once; the web research runs in after() and the
 * Marketplace polls the cache row (§9.6). A building without AI configured
 * is told so before anything shows "Searching".
 */
export async function startMarketSearch(
  kind: "agencies" | "insurers",
  force = false,
): Promise<{ ok: true; state: "cached" | "running" | "started"; notice?: string } | { error: string; configured?: boolean; quota?: boolean }> {
  if (kind !== "agencies" && kind !== "insurers") return { error: "Unknown search." };
  const supabase = await createClient();
  const r = await runMarketResearch(supabase, kind, { force: force === true });
  if ("error" in r) return r;
  if (r.state !== "started") {
    return { ok: true, state: r.state, ...("notice" in r && r.notice ? { notice: r.notice } : {}) };
  }
  const job = r.job;
  const bg = createClient();
  after(async () => {
    await finishMarketResearch(await bg, job);
    revalidateInsurance();
  });
  revalidateInsurance();
  return { ok: true, state: "started" };
}
