"use server";

import { friendlyDbError } from "@/lib/insurance/errors";
import { actionContext, cleanText, isUuid, revalidateInsurance } from "./action-helpers";

/**
 * Owners asking the board for proof of the building's insurance
 * (insurance-spec §8.10a, decision 9). Owners write only through
 * request_insurance_proof(); the board closes requests here or by marking the
 * certificate email sent.
 */

export async function requestInsuranceProof(input: { kind: "certificate" | "question"; note: string | null }): Promise<{ ok: true } | { error: string }> {
  const ctx = await actionContext(false);
  if ("error" in ctx) return ctx;
  const kind = input.kind === "question" ? "question" : "certificate";
  const note = cleanText(input.note, 1000);
  const { error } = await ctx.supabase.rpc("request_insurance_proof", {
    p_association: ctx.association.id,
    p_kind: kind,
    p_note: note,
  });
  // The RPC's rate limit ("You've asked three times today…") passes through as written.
  if (error) return friendlyDbError(error, "Walkup couldn't send that to the board. Try again.");
  revalidateInsurance();
  return { ok: true };
}

export async function closeOwnerRequest(requestId: string, status: "done" | "dismissed"): Promise<{ ok: true } | { error: string }> {
  const ctx = await actionContext("Only a board member can handle these requests.");
  if ("error" in ctx) return ctx;
  if (!isUuid(requestId)) return { error: "That request was not found." };
  if (status !== "done" && status !== "dismissed") return { error: "Unknown status." };
  const { data: auth } = await ctx.supabase.auth.getUser();
  const { data, error } = await ctx.supabase
    .from("insurance_owner_requests")
    .update({ status, handled_by: auth.user?.id ?? null, handled_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("status", "open")
    .select("id");
  if (error) return friendlyDbError(error, "Walkup couldn't update this request. Try again.");
  if (!data || data.length === 0) return { error: "This request was already handled." };
  revalidateInsurance();
  return { ok: true };
}
