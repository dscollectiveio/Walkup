// The props of ReviewForm v2 (insurance-spec §9.3.4), in a module without
// "use client" so the server pages that build them can import the types.

import type { CoverageType, SectionKey } from "@/lib/insurance/coverage";
import type { ResolvedField } from "@/lib/insurance/declarations";
import type { FieldMeta } from "@/lib/insurance/save-input";
import type { ProvenanceInfo } from "./provenance";

export type ReviewIntent = "import" | "manual" | "edit" | "from_quote" | "renew_copy";

/** List rows as the editor holds them (strings while typing; the form converts on save). */
export type EndorsementRow = { form_number: string; title: string; page: number | null };
export type ExclusionRow = { title: string; page: number | null };
export type PremiumLineRow = { label: string; amount: string; page: number | null };

export interface ReplaceableOption {
  id: string;
  label: string;
  coverage: string;
  endsOn: string;
  reminderDays: number;
  /** The premium bill's account, when that policy has an active bill. */
  billAccountId: string | null;
  hasBill: boolean;
}

export interface ReviewFormProps {
  mode: "policy" | "quote";
  intent: ReviewIntent;
  coverage: CoverageType;
  includedSections: SectionKey[];
  /** One per FIELD_DEFS key: what to pre-fill and what needs a look. */
  resolved: ResolvedField[];
  /** Where each prefilled value came from, for values the form fills in (keyed by field). */
  initialMeta: Record<string, FieldMeta>;
  /** Stored provenance of a saved row (edit): shown while a value is unchanged. */
  storedProvenance: Record<string, ProvenanceInfo>;
  lists: { endorsements: EndorsementRow[]; exclusions: ExclusionRow[]; premiumBreakdown: PremiumLineRow[] };
  documentId: string | null;
  readId: string | null;
  readIndex: number | null;
  documentFilename: string | null;
  /** ", pages 1 to 3" for the import header, or "". */
  pagesLabel: string;
  policyId: string | null;
  quoteId: string | null;
  expectedUpdatedAt: string | null;
  replaceable: ReplaceableOption[];
  /** For from_quote / renew_copy: the source policy. Null lets the form pick (45-day rule). */
  defaultReplacesId: string | null;
  acceptedQuoteId: string | null;
  quoteRequestId: string | null;
  contacts: { id: string; name: string }[];
  defaultContactId: string | null;
  premiumBill: { exists: boolean; accounts: { id: string; name: string }[]; insuranceAccountId: string | null };
  legalName: string | null;
  policyNumberRedacted: boolean;
  renewalReminderDays: number;
  notes: string | null;
  legacyValues: { key: string; label: string; value: string }[];
  quoteMode: boolean;
  quotedOn: string | null;
  validUntil: string | null;
  /** Header words: the carrier for edit and from_quote. */
  carrierName: string | null;
  todayIso: string;
  /** Import: the package list to return to while other items are still open. */
  returnTo: string | null;
  /**
   * Updating a saved policy from a new read (§10.7): fields where the read
   * differs from the stored value. `value` is the read's DB string.
   */
  readDiffs?: Record<string, { value: string; candidateIndex: number; saved: string | null }>;
}
