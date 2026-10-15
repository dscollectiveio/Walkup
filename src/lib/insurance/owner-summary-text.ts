// The owner summary's fixed wording (insurance-spec §6.9): what the master
// policy leaves to owners by coverage form, the coverage form in plain words,
// and the certificate line. Split from owner-summary.ts so the owner view and
// the editor's preview (client components) can use it without node:crypto.
// Pure.

import type { OwnerSummaryContent } from "./owner-summary";

export type CoverageForm = "bare_walls" | "single_entity" | "all_in" | "unknown";

/** "What the master policy leaves to you", by coverage form. */
export const LEFT_TO_OWNERS: Record<CoverageForm, string[]> = {
  bare_walls: [
    "Under a bare-walls policy the association usually insures the building's structure and the unfinished walls, floors and ceilings. Cabinets, fixtures, appliances, floor and wall coverings and your belongings are usually the owner's to insure.",
    "Your declaration and the Illinois Condominium Property Act (Sec. 12) decide the details. Ask the board or your own agent to confirm.",
  ],
  single_entity: [
    "Under a single-entity policy the association usually insures the building and the fixtures originally installed in units. Floor, wall and ceiling coverings, upgrades made after the developer's work, appliances and your belongings are usually the owner's to insure.",
    "Your declaration and the Illinois Condominium Property Act (Sec. 12) decide the details. Ask the board or your own agent to confirm.",
  ],
  all_in: [
    "Under an all-in policy the association usually insures the building and the improvements inside units. Your belongings are usually the owner's to insure.",
    "Ask the board what the policy leaves out, and ask your own agent to confirm.",
  ],
  unknown: [
    "Your belongings are usually the owner's to insure.",
    "The board is confirming exactly what the master policy covers inside units. Until then, tell your agent this isn't confirmed yet.",
  ],
};

export const NO_AGENT_CERTIFICATE_INSTRUCTIONS = "Use the button below to ask the board for proof of insurance.";

/** "Need proof … Ask Pat Lee at Acme Agency for a certificate of insurance: pat@acme.com or (312) 555-0100." */
export function certificateInstructions(contact: OwnerSummaryContent["certificate_contact"]): string {
  if (!contact) return NO_AGENT_CERTIFICATE_INSTRUCTIONS;
  const who = contact.agency && contact.agency !== contact.name ? `${contact.name} at ${contact.agency}` : contact.name;
  const reach = [contact.email, contact.phone].filter(Boolean).join(" or ");
  return `Need proof of the building's insurance for your mortgage lender? Ask ${who} for a certificate of insurance${reach ? `: ${reach}` : ""}.`;
}

/** The coverage form in plain words for the owner view's "The master policy" card. */
export const COVERAGE_FORM_OWNER_WORDS: Record<CoverageForm, string> = {
  single_entity: "The board recorded this as a single-entity policy. That usually means the association insures the building and the fixtures originally installed in units. Check the declaration.",
  bare_walls: "The board recorded this as a bare-walls policy. That usually means the association insures the building's structure and the unfinished walls, and owners insure what is inside. Check the declaration.",
  all_in: "The board recorded this as an all-in policy. That usually means the association also insures improvements inside units. Check the declaration.",
  unknown: "The board is confirming exactly what's covered inside units.",
};
