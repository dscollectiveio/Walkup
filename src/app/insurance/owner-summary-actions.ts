"use server";

import { friendlyDbError } from "@/lib/insurance/errors";
import { ownerSummarySchema, ownerSummarySourceHash, type OwnerSummaryContent } from "@/lib/insurance/owner-summary";
import { loadPolicy } from "@/lib/insurance/queries";
import { actionContext, isUuid, revalidateInsurance } from "./action-helpers";

/**
 * "What the master policy means for you" (insurance-spec §8.10, decision 9).
 * The board edits a draft and publishes a frozen snapshot; owners read only
 * the published copy, through owner_insurance_summary(). The source policy's
 * hash at publish time lets the board see when the summary has gone stale.
 */

const BOARD_ONLY = "Only a board member can change the owner summary.";
const SHAPE = "The summary is not in the expected shape. Reload and try again.";

export async function saveOwnerSummaryDraft(content: OwnerSummaryContent, sourcePolicyId: string | null): Promise<{ ok: true } | { error: string }> {
  const ctx = await actionContext(BOARD_ONLY);
  if ("error" in ctx) return ctx;
  const parsed = ownerSummarySchema.safeParse(content);
  if (!parsed.success) return { error: SHAPE };
  const source = sourcePolicyId && isUuid(sourcePolicyId) ? sourcePolicyId : null;
  // Only the draft: the published snapshot stays as owners see it. While a
  // version is published, its source policy (and hash) describe that version,
  // so they change only when the board publishes again.
  const { data: existing } = await ctx.supabase
    .from("insurance_owner_summaries")
    .select("published_at")
    .eq("association_id", ctx.association.id)
    .maybeSingle();
  const published = Boolean((existing as { published_at: string | null } | null)?.published_at);
  const { error } = await ctx.supabase
    .from("insurance_owner_summaries")
    .upsert(
      {
        association_id: ctx.association.id,
        draft: parsed.data,
        ...(published ? {} : { source_policy_id: source }),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "association_id" },
    );
  if (error) return error.code === "42501" ? { error: BOARD_ONLY } : friendlyDbError(error, "Walkup couldn't save the draft. Try again.");
  revalidateInsurance();
  return { ok: true };
}

export async function publishOwnerSummary(
  content: OwnerSummaryContent,
  sourcePolicyId: string | null,
): Promise<{ ok: true; publishedAt: string } | { error: string }> {
  const ctx = await actionContext("Only a board member can publish the summary.");
  if ("error" in ctx) return ctx;
  const parsed = ownerSummarySchema.safeParse(content);
  if (!parsed.success) return { error: SHAPE };

  let hash: string | null = null;
  let source: string | null = null;
  if (sourcePolicyId) {
    if (!isUuid(sourcePolicyId)) return { error: "That policy was not found." };
    const policy = await loadPolicy(ctx.supabase, sourcePolicyId);
    if (!policy) return { error: "That policy was not found." };
    source = policy.id;
    hash = ownerSummarySourceHash(policy);
  }

  const { data, error } = await ctx.supabase.rpc("publish_insurance_owner_summary", {
    p_association_id: ctx.association.id,
    p_content: parsed.data,
    p_source_policy_id: source,
    p_source_hash: hash,
  });
  if (error) return friendlyDbError(error, "Walkup couldn't publish the summary. Try again.");
  revalidateInsurance("/building");
  return { ok: true, publishedAt: String(data) };
}

export async function unpublishOwnerSummary(): Promise<{ ok: true } | { error: string }> {
  const ctx = await actionContext("Only a board member can unpublish the summary.");
  if ("error" in ctx) return ctx;
  const { error } = await ctx.supabase
    .from("insurance_owner_summaries")
    .update({ published: null, published_at: null, published_by: null, updated_at: new Date().toISOString() })
    .eq("association_id", ctx.association.id);
  if (error) return friendlyDbError(error, "Walkup couldn't unpublish the summary. Try again.");
  revalidateInsurance("/building");
  return { ok: true };
}
