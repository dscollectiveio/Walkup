// "What the master policy means for you" (insurance-spec §6.9, brief
// decision 9). Deterministic, no model: these sentences describe what the
// master policy covers and leaves to owners and must be predictable. Nothing
// here tells an owner what to buy; it points them to their own agent. Pure
// (the source hash uses node:crypto).

import { createHash } from "node:crypto";
import { z } from "zod";
import type { BuildingFacts } from "./facts";
import { rowText, type PolicyRow } from "./fields";
import { formatMoney, formatPercent, formatPhone } from "./format";
import {
  COVERAGE_FORM_OWNER_WORDS, LEFT_TO_OWNERS, NO_AGENT_CERTIFICATE_INSTRUCTIONS, certificateInstructions, type CoverageForm,
} from "./owner-summary-text";
import type { PolicyStatus } from "./status";

export { COVERAGE_FORM_OWNER_WORDS, LEFT_TO_OWNERS, NO_AGENT_CERTIFICATE_INSTRUCTIONS, certificateInstructions };

export const ownerSummarySchema = z.object({
  version: z.literal(1),
  association_name: z.string(),
  master: z.object({ carrier: z.string(), period_from: z.string(), period_to: z.string(),
                     coverage_form: z.enum(["bare_walls", "single_entity", "all_in", "unknown"]) }).nullable(),
  deductibles: z.object({ all_perils: z.string().nullable(), water: z.string().nullable(),
                          wind_hail: z.string().nullable(), wind_hail_percent: z.string().nullable(),
                          per_unit: z.string().nullable() }),
  claims_line: z.object({ carrier: z.string(), phone: z.string() }).nullable(),  // from claims_phone
  left_to_owners: z.array(z.string().max(400)).max(12),
  tips: z.array(z.string().max(400)).max(8),
  liability_requirement: z.string().max(300).nullable(),
  certificate_contact: z.object({ name: z.string(), agency: z.string().nullable(),
                                  email: z.string().nullable(), phone: z.string().nullable() }).nullable(),
  certificate_instructions: z.string().max(500),
  board_note: z.string().max(1000).nullable(),
});
export type OwnerSummaryContent = z.infer<typeof ownerSummarySchema>;

/** The agent the certificate request goes to (an insurance_contacts row). */
export interface Contact {
  name: string;               // the contact's name: an agency, or a person
  person_name?: string | null;// the person at an agency
  kind?: string | null;
  email: string | null;
  phone: string | null;
}

const TIP_LOSS_ASSESSMENT =
  "Loss assessment: if the association charges owners for a loss, some condo policies pay your share, sometimes only with an added endorsement. Your agent can tell you what yours does.";
const TIP_LIABILITY = "Personal liability: covers you if someone is hurt in your unit or you damage a neighbor's unit.";
const TIP_LOSS_OF_USE = "Loss of use: pays to live elsewhere while your unit is repaired, if your policy includes it.";

function asForm(v: string | null): CoverageForm {
  return v === "bare_walls" || v === "single_entity" || v === "all_in" ? v : "unknown";
}

/** "2% of the building value (at least $10,000)", "$10,000", or null. */
function windHailWords(dollars: string | null, percent: string | null): string | null {
  const pct = formatPercent(percent);
  const min = formatMoney(dollars);
  if (pct) return `${pct} of the building value${min ? ` (at least ${min})` : ""}`;
  return min;
}

function deductibleTip(d: OwnerSummaryContent["deductibles"]): string {
  const main = formatMoney(d.all_perils);
  const water = formatMoney(d.water);
  const wind = windHailWords(d.wind_hail, d.wind_hail_percent);
  const perUnit = formatMoney(d.per_unit);
  const extras = [
    water ? `${water} for water damage` : null,
    wind ? `${wind} for wind or hail` : null,
    perUnit ? `${perUnit} per unit` : null,
  ].filter((x): x is string => x !== null);
  if (!main && extras.length === 0) return "Master deductible: the board is confirming the master policy's deductible.";
  const what = main
    ? `the master policy deductible is ${main}${extras.length ? ` (${extras.join(", ")})` : ""}`
    : `the master policy deductibles are ${extras.join(", ")}`;
  return `Master deductible: ${what}. Depending on your declaration and rules, the association may be able to charge an owner part or all of that amount. Ask the board, and ask your agent whether your policy's loss assessment or master deductible coverage would pay it.`;
}

export function buildOwnerSummaryDraft(input: {
  associationName: string;
  master: PolicyRow | null;
  facts: BuildingFacts | null;
  agent: Contact | null;
}): OwnerSummaryContent {
  const m = input.master;
  const form = asForm(m ? rowText(m, "coverage_form") : null);
  const deductibles = {
    all_perils: m ? rowText(m, "property_deductible") : null,
    water: m ? rowText(m, "water_damage_deductible") : null,
    wind_hail: m ? rowText(m, "wind_hail_deductible") : null,
    wind_hail_percent: m ? rowText(m, "wind_hail_deductible_percent") : null,
    per_unit: m ? rowText(m, "per_unit_deductible") : null,
  };
  const claimsPhone = m ? rowText(m, "claims_phone") : null;
  const agent = input.agent;
  const certificateContact = agent
    ? {
        name: agent.person_name?.trim() || agent.name,
        agency: agent.person_name?.trim() ? agent.name : null,
        email: agent.email?.trim() || null,
        phone: agent.phone ? formatPhone(agent.phone) : null,
      }
    : null;

  const f = input.facts;
  let liability: string | null = null;
  if (f?.owners_must_carry_ho6 === true) {
    const min = formatMoney(f.owners_ho6_min_liability);
    liability = `The board requires every owner to carry personal liability insurance${min ? ` of at least ${min}` : ""}.`;
  }

  return {
    version: 1,
    association_name: input.associationName,
    master: m ? { carrier: m.carrier_name, period_from: m.effective_from, period_to: m.effective_to, coverage_form: form } : null,
    deductibles,
    claims_line: m && claimsPhone ? { carrier: m.carrier_name, phone: formatPhone(claimsPhone) ?? claimsPhone } : null,
    left_to_owners: [...LEFT_TO_OWNERS[form]],
    tips: [deductibleTip(deductibles), TIP_LOSS_ASSESSMENT, TIP_LIABILITY, TIP_LOSS_OF_USE],
    liability_requirement: liability,
    certificate_contact: certificateContact,
    certificate_instructions: certificateInstructions(certificateContact),
    board_note: null,
  };
}

const HASH_KEYS = [
  "id", "carrier_name", "effective_from", "effective_to", "coverage_form", "property_deductible",
  "water_damage_deductible", "wind_hail_deductible", "wind_hail_deductible_percent", "per_unit_deductible", "claims_phone",
] as const;

/**
 * sha256 hex of the stable JSON of {id, carrier_name, effective_from,
 * effective_to, coverage_form, property_deductible, water_damage_deductible,
 * wind_hail_deductible, wind_hail_deductible_percent, per_unit_deductible,
 * claims_phone} (money and percents as their ::text strings). Stored as
 * source_hash at publish.
 */
export function ownerSummarySourceHash(master: PolicyRow): string {
  const stable = Object.fromEntries(HASH_KEYS.map((k) => [k, k === "id" ? master.id : rowText(master, k)]));
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export type OwnerSummaryStaleness =
  | { stale: false }
  | { stale: true; reason: "ended" | "replaced" | "edited" | "archived" | "deleted"; endedOn: string | null };

/**
 * Board side. Compares the published row with the source policy as it is now
 * (null when the policy was deleted) and its status (§6.4). Order: deleted,
 * archived, replaced, ended (the published period is over), edited (hash
 * differs), otherwise not stale.
 */
export function ownerSummaryStaleness(
  published: { source_policy_id: string | null; source_hash: string | null; content: OwnerSummaryContent },
  source: (PolicyRow & { status: PolicyStatus }) | null,
  todayIso: string,
): OwnerSummaryStaleness {
  if (published.source_policy_id && !source) return { stale: true, reason: "deleted", endedOn: null };
  if (source?.archived_at || source?.status === "archived") return { stale: true, reason: "archived", endedOn: null };
  if (source?.status === "replaced") return { stale: true, reason: "replaced", endedOn: source.effective_to };
  const periodTo = published.content.master?.period_to ?? null;
  if (periodTo && periodTo < todayIso) return { stale: true, reason: "ended", endedOn: periodTo };
  if (source && published.source_hash && ownerSummarySourceHash(source) !== published.source_hash) {
    return { stale: true, reason: "edited", endedOn: null };
  }
  return { stale: false };
}
