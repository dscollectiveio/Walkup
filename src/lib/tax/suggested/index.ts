// Walkup's own field maps for the official forms, authored by hand against the
// pinned PDFs on 2026-10-11 — so a board gets a filled 1120-H and 1099-NEC on
// day one instead of waiting for someone to map every box. Still gated the
// same way as any template (DECISIONS #32, #33): a platform admin installs one
// with a click (applySuggestedTemplate), opens the labeled preview, and
// verifies and activates it as a person. Nothing here is active on its own,
// and tax_form_templates still ships with zero rows.
//
// A map is applied only when the fetched PDF's sha256 and title equal what it
// was authored against; a republished form gets a fresh look, never a map
// carried over by name. tests/unit/tax-suggested.test.ts proves every mapped
// name against tests/fixtures/tax/*-fields.json, which
// scripts/enumerate-pdf-fields.mjs produced from the same PDFs.

import type { FieldMap } from "../autofill";
import type { FormCode } from "../determine";
import { IL_1120_2025 } from "./il_1120_2025";
import { IL_SOS_ANNUAL_REPORT } from "./il_sos_annual_report";
import { IRS_1096_2026 } from "./irs_1096_2026";
import { IRS_1099_NEC_2026 } from "./irs_1099_nec_2026";
import { IRS_1120_2025 } from "./irs_1120_2025";
import { IRS_1120H_2025 } from "./irs_1120h_2025";

export interface SuggestedTemplate {
  /** Stable id, stored on the installed template as `suggested_from`: "irs_1120h_2025". */
  key: string;
  formCode: FormCode;
  taxYear: number;
  kind: "pdf" | "link_only";
  /** pdf: the pinned official PDF; link_only: the official page the rule comes from. */
  sourceUrl: string;
  instructionsUrl: string | null;
  /** pdf only; the fetched PDF's title must equal this or the map is not applied. */
  expectedTitle: string | null;
  /** pdf only; the fetched PDF's sha256 must equal this or the map is not applied. */
  authoredAgainstSha256: string | null;
  /** "2025" / "Rev. December 2026" */
  revision: string;
  /** Full AcroForm names, e.g. "topmostSubform[0].Page1[0].f1_13[0]". {} for link_only. */
  fieldMap: FieldMap;
  /** 1-based pages kept in PDF exports; null = all. */
  includePages: number[] | null;
  /** At export, every filled value whose name contains `from` is also written to the twin name with `to`. */
  mirror: { from: string; to: string }[];
  dueRule: string | null;
  dueRuleCitation: string | null;
  filingInstructions: string | null;
  filingCitation: string | null;
  notes: string | null;
  /** ISO date the map was checked against the labeled render. */
  authoredOn: string;
}

/** In the order the admin page offers them. */
export const SUGGESTED: SuggestedTemplate[] = [IRS_1120H_2025, IRS_1120_2025, IRS_1099_NEC_2026, IL_1120_2025, IL_SOS_ANNUAL_REPORT, IRS_1096_2026];

export function suggestedByKey(key: string): SuggestedTemplate | null {
  return SUGGESTED.find((s) => s.key === key) ?? null;
}
