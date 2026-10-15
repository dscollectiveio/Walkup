"use server";

import { todayIso } from "@/lib/dates";
import { isCoverageType, type CoverageType, type SectionKey } from "@/lib/insurance/coverage";
import { friendlyDbError } from "@/lib/insurance/errors";
import type { Endorsement, Exclusion, PremiumLine } from "@/lib/insurance/fields";
import { upsertAgentContact } from "@/lib/insurance/contacts";
import { parseLists, prepareFieldValues, type FieldMeta } from "@/lib/insurance/save-input";
import { actionContext, cleanText, isIsoDate, isUuid, revalidateInsurance } from "./action-helpers";

/**
 * Quotes (insurance-spec §8.3). Saved through save_insurance_quote, which
 * mirrors the policy save (idempotent per read item and per form), marks the
 * request answered and cancels its unsent drafts. A quote read never fills
 * anything in by itself (§7.1.6 step 8); that is decided before the form.
 */

const BOARD_ONLY = "Only a board member can save a quote.";

export interface SaveQuoteInput {
  quoteId: string | null;
  clientToken: string;
  coverage: CoverageType;
  includedSections: SectionKey[];
  values: Record<string, string | null>;
  meta: Record<string, FieldMeta>;
  endorsements: Endorsement[];
  exclusions: Exclusion[];
  premiumBreakdown: PremiumLine[];
  quotedOn: string;
  validUntil: string | null;
  contactId: string | null;
  quoteRequestId: string | null;
  notes: string | null;
  options: { documentId?: string; readId?: string; readIndex?: number };
}

export async function saveQuote(
  input: SaveQuoteInput,
): Promise<{ ok: true; quoteId: string } | { error: string; fieldErrors?: Record<string, string>; alreadySavedId?: string }> {
  const ctx = await actionContext(BOARD_ONLY);
  if ("error" in ctx) return ctx;
  const { supabase, association } = ctx;
  if (!isCoverageType(input.coverage)) return { error: "Choose the kind of policy." };
  const quoteId = input.quoteId && isUuid(input.quoteId) ? input.quoteId : null;
  if (input.quoteId && !quoteId) return { error: "That quote was not found." };

  const quotedOn = isIsoDate(input.quotedOn) ? input.quotedOn : todayIso();
  if (input.validUntil && !isIsoDate(input.validUntil)) {
    return { error: "Valid until: use the date picker.", fieldErrors: { valid_until: "Use the date picker." } };
  }
  const lists = parseLists(input);
  if (!lists.ok) return { error: lists.error };

  const prepared = prepareFieldValues({
    mode: "quote",
    coverage: input.coverage,
    includedSections: input.includedSections ?? [],
    values: input.values ?? {},
    meta: input.meta ?? {},
    isEdit: quoteId !== null,
  });
  if (!prepared.ok) return { error: prepared.error, fieldErrors: prepared.fieldErrors };

  let contactId = input.contactId && isUuid(input.contactId) ? input.contactId : null;
  if (!contactId) contactId = await upsertAgentContact(supabase, association.id, prepared.parsed);

  const pValues: Record<string, unknown> = {
    ...prepared.columns,
    included_sections: prepared.sections,
    endorsements: lists.endorsements,
    exclusions: lists.exclusions,
    premium_breakdown: lists.premiumBreakdown,
    notes: cleanText(input.notes, 4000),
    quoted_on: quotedOn,
    valid_until: input.validUntil || null,
    contact_id: contactId,
    quote_request_id: input.quoteRequestId && isUuid(input.quoteRequestId) ? input.quoteRequestId : null,
  };

  const o = input.options ?? {};
  const pOptions: Record<string, unknown> = {};
  if (isUuid(o.documentId)) pOptions.document_id = o.documentId;
  if (isUuid(o.readId) && Number.isInteger(o.readIndex) && (o.readIndex as number) >= 0) {
    pOptions.read_id = o.readId;
    pOptions.read_index = o.readIndex;
  }
  if (!quoteId && isUuid(input.clientToken)) pOptions.client_token = input.clientToken;

  const { data, error } = await supabase.rpc("save_insurance_quote", {
    p_association_id: association.id,
    p_quote_id: quoteId,
    p_values: pValues,
    p_sources: prepared.sources,
    p_options: pOptions,
  });
  if (error) return friendlyDbError(error, "Walkup couldn't save this quote. Try again.");
  revalidateInsurance();
  return { ok: true, quoteId: data as string };
}

export async function declineQuote(quoteId: string, reason: string | null): Promise<{ ok: true } | { error: string }> {
  const ctx = await actionContext("Only a board member can decline a quote.");
  if ("error" in ctx) return ctx;
  if (!isUuid(quoteId)) return { error: "That quote was not found." };
  const { data, error } = await ctx.supabase
    .from("insurance_quotes")
    .update({ declined_at: new Date().toISOString(), declined_reason: cleanText(reason, 500), updated_at: new Date().toISOString() })
    .eq("id", quoteId)
    .select("id");
  if (error) return friendlyDbError(error, "Walkup couldn't decline this quote. Try again.");
  if (!data || data.length === 0) return { error: "That quote was not found." };
  revalidateInsurance();
  return { ok: true };
}

export async function undeclineQuote(quoteId: string): Promise<{ ok: true } | { error: string }> {
  const ctx = await actionContext("Only a board member can change a quote.");
  if ("error" in ctx) return ctx;
  if (!isUuid(quoteId)) return { error: "That quote was not found." };
  const { data, error } = await ctx.supabase
    .from("insurance_quotes")
    .update({ declined_at: null, declined_reason: null, updated_at: new Date().toISOString() })
    .eq("id", quoteId)
    .select("id");
  if (error) return friendlyDbError(error, "Walkup couldn't change this quote. Try again.");
  if (!data || data.length === 0) return { error: "That quote was not found." };
  revalidateInsurance();
  return { ok: true };
}

export async function deleteQuote(quoteId: string): Promise<{ ok: true } | { error: string }> {
  const ctx = await actionContext(false);
  if ("error" in ctx) return ctx;
  if (!isUuid(quoteId)) return { error: "That quote was not found." };
  const { error } = await ctx.supabase.rpc("delete_insurance_quote", { p_quote_id: quoteId });
  if (error) return friendlyDbError(error, "Walkup couldn't delete this quote. Try again.");
  revalidateInsurance();
  return { ok: true };
}
