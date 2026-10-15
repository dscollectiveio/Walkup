"use server";

import { todayIso } from "@/lib/dates";
import { parseMoneyLoose } from "@/lib/insurance/declarations";
import { friendlyDbError } from "@/lib/insurance/errors";
import { actionContext, cleanText, isIsoDate, isUuid, revalidateInsurance } from "./action-helpers";

/**
 * Claims against a policy (insurance-spec §8.7), linked to the repair that
 * caused them when there is one, so the ticket shows the claim and the claim
 * shows the ticket.
 */

const BOARD_ONLY = "Only a board member can record a claim.";
const STATUSES = ["open", "paid", "denied", "withdrawn"] as const;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface ClaimInput {
  id: string | null;
  policyId: string;
  ticketId: string | null;
  dateOfLoss: string;
  reportedOn: string | null;
  claimNumber: string | null;
  description: string;
  amountClaimed: string | null;
  amountPaid: string | null;
  deductibleApplied: string | null;
  status: "open" | "paid" | "denied" | "withdrawn";
  closedOn: string | null;
  adjusterName: string | null;
  adjusterEmail: string | null;
  adjusterPhone: string | null;
  notes: string | null;
}

function money(raw: string | null, key: string, label: string, errors: Record<string, string>): string | null {
  const t = String(raw ?? "").trim();
  if (t === "") return null;
  const v = parseMoneyLoose(t);
  if (v === null) errors[key] = `${label}: "${t}" isn't a value Walkup can save. Use digits, like 12500 or $12,500.`;
  return v;
}

export async function saveClaim(input: ClaimInput): Promise<{ ok: true; claimId: string } | { error: string; fieldErrors?: Record<string, string> }> {
  const ctx = await actionContext(BOARD_ONLY);
  if ("error" in ctx) return ctx;
  const { supabase, association } = ctx;
  const today = todayIso();
  const fieldErrors: Record<string, string> = {};

  const claimId = input.id && isUuid(input.id) ? input.id : null;
  if (input.id && !claimId) return { error: "That claim was not found." };
  if (!isUuid(input.policyId)) fieldErrors.policyId = "Choose the policy.";
  if (!isIsoDate(input.dateOfLoss)) fieldErrors.dateOfLoss = "Enter the date of the loss.";
  else if (input.dateOfLoss > today) fieldErrors.dateOfLoss = "The date of the loss can't be in the future.";
  if (input.reportedOn && !isIsoDate(input.reportedOn)) fieldErrors.reportedOn = "Use the date picker.";
  const description = cleanText(input.description, 4000);
  if (!description) fieldErrors.description = "Say briefly what happened.";
  const status = (STATUSES as readonly string[]).includes(input.status) ? input.status : null;
  if (!status) fieldErrors.status = "Choose a status.";
  const amountClaimed = money(input.amountClaimed, "amountClaimed", "Amount claimed", fieldErrors);
  const amountPaid = money(input.amountPaid, "amountPaid", "Amount paid", fieldErrors);
  const deductibleApplied = money(input.deductibleApplied, "deductibleApplied", "Deductible applied", fieldErrors);
  const adjusterEmail = cleanText(input.adjusterEmail, 320);
  if (adjusterEmail && !EMAIL_RE.test(adjusterEmail)) fieldErrors.adjusterEmail = "Check the adjuster's email address.";
  if (input.closedOn && !isIsoDate(input.closedOn)) fieldErrors.closedOn = "Use the date picker.";
  const ticketId = input.ticketId && isUuid(input.ticketId) ? input.ticketId : null;
  const keys = Object.keys(fieldErrors);
  if (keys.length) return { error: fieldErrors[keys[0]], fieldErrors };

  // closedOn defaults to today when the claim leaves "open" without one.
  let closedOn = status === "open" ? null : input.closedOn || null;
  let previousTicket: string | null = null;
  if (claimId) {
    const { data } = await supabase.from("insurance_claims").select("status, closed_on, ticket_id").eq("id", claimId).maybeSingle();
    const before = data as { status: string; closed_on: string | null; ticket_id: string | null } | null;
    if (!before) return { error: "That claim was not found." };
    previousTicket = before.ticket_id;
    if (status !== "open" && !closedOn) closedOn = before.status === "open" ? today : before.closed_on ?? today;
  } else if (status !== "open" && !closedOn) {
    closedOn = today;
  }

  const { data: me } = await supabase.auth.getUser();
  const row = {
    policy_id: input.policyId,
    ticket_id: ticketId,
    date_of_loss: input.dateOfLoss,
    reported_on: input.reportedOn || null,
    claim_number: cleanText(input.claimNumber, 100),
    description,
    amount_claimed: amountClaimed,
    amount_paid: amountPaid,
    deductible_applied: deductibleApplied,
    status,
    closed_on: closedOn,
    adjuster_name: cleanText(input.adjusterName, 200),
    adjuster_email: adjusterEmail,
    adjuster_phone: cleanText(input.adjusterPhone, 40),
    notes: cleanText(input.notes, 4000),
    updated_at: new Date().toISOString(),
    updated_by: me.user?.id ?? null,
  };

  let savedId: string;
  if (claimId) {
    const { data, error } = await supabase.from("insurance_claims").update(row).eq("id", claimId).select("id");
    if (error) return friendlyDbError(error, "Walkup couldn't save this claim. Try again.");
    if (!data || data.length === 0) return { error: BOARD_ONLY };
    savedId = claimId;
  } else {
    const { data, error } = await supabase
      .from("insurance_claims")
      .insert({ ...row, association_id: association.id })
      .select("id")
      .single();
    if (error || !data) return friendlyDbError(error ?? { message: "" }, "Walkup couldn't save this claim. Try again.");
    savedId = (data as { id: string }).id;
  }

  const tickets = [...new Set([ticketId, previousTicket].filter((t): t is string => Boolean(t)))];
  revalidateInsurance(...tickets.map((t) => `/maintenance/${t}`), ...(tickets.length ? ["/repairs"] : []));
  return { ok: true, claimId: savedId };
}

export async function deleteClaim(claimId: string): Promise<{ ok: true } | { error: string }> {
  const ctx = await actionContext(false);
  if ("error" in ctx) return ctx;
  if (!isUuid(claimId)) return { error: "That claim was not found." };
  const { data } = await ctx.supabase.from("insurance_claims").select("ticket_id").eq("id", claimId).maybeSingle();
  const ticket = (data as { ticket_id: string | null } | null)?.ticket_id ?? null;
  const { error } = await ctx.supabase.rpc("delete_insurance_claim", { p_claim_id: claimId });
  if (error) return friendlyDbError(error, "Walkup couldn't delete this claim. Try again.");
  revalidateInsurance(...(ticket ? [`/maintenance/${ticket}`, "/repairs"] : []));
  return { ok: true };
}
