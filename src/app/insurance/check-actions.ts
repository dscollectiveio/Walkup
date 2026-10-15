"use server";

import { RULES } from "@/lib/insurance/coverage-check";
import { friendlyDbError } from "@/lib/insurance/errors";
import { actionContext, cleanText, isUuid, revalidateInsurance } from "./action-helpers";

/**
 * "Not relevant to us" on a coverage-check finding, with a reason
 * (insurance-spec §8.11). Tied to the policy when the finding is, so a
 * renewal shows the finding again. Any board member may take one back.
 */

const BOARD_ONLY = "Only a board member can change the coverage check.";
const RULE_IDS = new Set(RULES.map((r) => r.id));

export async function dismissFinding(input: { ruleId: string; policyId: string | null; findingKey?: string; reason: string }): Promise<{ ok: true } | { error: string }> {
  const ctx = await actionContext(BOARD_ONLY);
  if ("error" in ctx) return ctx;
  if (!RULE_IDS.has(input.ruleId)) return { error: "That finding no longer applies. Reload to see the current check." };
  const reason = cleanText(input.reason, 500);
  if (!reason) return { error: "Say briefly why this doesn't apply to you." };
  // The finding's own id: the rule id, or the rule id and a suffix ("DOC-REQ-01:flood").
  const findingKey = input.findingKey ?? "";
  if (findingKey !== "" && findingKey !== input.ruleId && !(findingKey.startsWith(`${input.ruleId}:`) && findingKey.length <= 100)) {
    return { error: "That finding no longer applies. Reload to see the current check." };
  }
  const policyId = input.policyId && isUuid(input.policyId) ? input.policyId : null;
  const { error } = await ctx.supabase.from("insurance_finding_dismissals").insert({
    association_id: ctx.association.id,
    rule_id: input.ruleId,
    policy_id: policyId,
    finding_key: findingKey,
    reason,
  });
  if (error) {
    if (error.code === "23505") return { error: "This finding is already marked not relevant." };
    return friendlyDbError(error, "Walkup couldn't save that. Try again.");
  }
  revalidateInsurance();
  return { ok: true };
}

export async function restoreFinding(dismissalId: string): Promise<{ ok: true } | { error: string }> {
  const ctx = await actionContext(BOARD_ONLY);
  if ("error" in ctx) return ctx;
  if (!isUuid(dismissalId)) return { error: "That finding was not found." };
  const { data, error } = await ctx.supabase.from("insurance_finding_dismissals").delete().eq("id", dismissalId).select("id");
  if (error) return friendlyDbError(error, "Walkup couldn't restore that finding. Try again.");
  if (!data || data.length === 0) return { error: "That finding was not found." };
  revalidateInsurance();
  return { ok: true };
}
