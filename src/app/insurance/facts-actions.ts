"use server";

import { CONSTRUCTION_TYPES, FACT_KEYS, isFactKey, parseFactsInput } from "@/lib/insurance/facts";
import { friendlyDbError } from "@/lib/insurance/errors";
import { actionContext, revalidateInsurance } from "./action-helpers";

/**
 * Building facts for the coverage check (insurance-spec §8.8). The form
 * names the questions it shows in a hidden `_keys` field (the ?only= view
 * shows just a few), so an unanswered radio or an unticked checkbox group
 * clears only its own fact and nothing else is touched.
 */

const BOARD_ONLY = "Only a board member can change these facts.";

/** The facts the form showed: `_keys` when present, else every fact key the form posted. */
function postedKeys(formData: FormData): string[] {
  const listed = String(formData.get("_keys") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(isFactKey);
  if (listed.length) return [...new Set(listed)];
  return FACT_KEYS.filter((k) => formData.has(k));
}

export async function saveBuildingFacts(_prev: unknown, formData: FormData): Promise<{ ok: true } | { error: string }> {
  const ctx = await actionContext(BOARD_ONLY);
  if ("error" in ctx) return ctx;
  const { supabase, association } = ctx;

  const keys = postedKeys(formData);
  if (keys.length === 0) return { error: "Answer at least one question." };
  const input: Record<string, string | string[] | null> = {};
  for (const key of keys) {
    input[key] = key === "declaration_required_lines"
      ? formData.getAll(key).map(String)
      : formData.has(key) ? String(formData.get(key) ?? "") : "";
  }
  const parsed = parseFactsInput(input);
  if (!parsed.ok) return { error: parsed.error };

  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("insurance_building_facts")
    .upsert(
      { association_id: association.id, ...parsed.patch, updated_at: new Date().toISOString(), updated_by: auth.user?.id ?? null },
      { onConflict: "association_id" },
    );
  if (error) {
    return error.code === "42501" ? { error: BOARD_ONLY } : friendlyDbError(error, "Walkup couldn't save these facts. Try again.");
  }
  revalidateInsurance();
  return { ok: true };
}

const CONSTRUCTION = new Set<string>(CONSTRUCTION_TYPES.map((c) => c.value));

function year(v: number | null, label: string): { ok: true; value: number | null } | { ok: false; error: string } {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (!Number.isInteger(v) || v < 1700 || v > 2100) return { ok: false, error: `${label}: use a four-digit year.` };
  return { ok: true, value: v };
}

export async function saveBuildingBasics(input: {
  yearBuilt: number | null; constructionType: string | null; stories: number | null; roofReplacedYear: number | null;
}): Promise<{ ok: true } | { error: string }> {
  const ctx = await actionContext(BOARD_ONLY);
  if ("error" in ctx) return ctx;
  const built = year(input.yearBuilt, "Year built");
  if (!built.ok) return built;
  const roof = year(input.roofReplacedYear, "Roof last replaced");
  if (!roof.ok) return roof;
  const construction = input.constructionType?.trim() || null;
  if (construction && !CONSTRUCTION.has(construction)) return { error: "Choose a construction type from the list." };
  const stories = input.stories ?? null;
  if (stories !== null && (!Number.isInteger(stories) || stories < 1 || stories > 200)) {
    return { error: "Stories: use a whole number from 1 to 200." };
  }
  const { error } = await ctx.supabase.rpc("update_insurance_building_basics", {
    p_association_id: ctx.association.id,
    p_year_built: built.value,
    p_construction_type: construction,
    p_stories: stories,
    p_roof_replaced_year: roof.value,
  });
  if (error) return friendlyDbError(error, "Walkup couldn't save these facts. Try again.");
  revalidateInsurance("/building");
  return { ok: true };
}
