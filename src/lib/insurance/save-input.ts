// Turning the review form's raw strings into what save_insurance_policy /
// save_insurance_quote accept (insurance-spec §8.2, §8.2a, §8.3): parse every
// field of the policy's sections, collect plain-English field errors, check
// the required fields and the date order, and say per field where its value
// came from. Provenance details (page, snippet, confidence) are never sent:
// the RPC rebuilds them from the stored, already redacted read. Pure.

import { z } from "zod";
import { sectionsFor, type CoverageType, type SectionKey } from "./coverage";
import { parseFieldValue } from "./declarations";
import {
  EndorsementSchema, ExclusionSchema, FIELD_DEFS, PremiumLineSchema, fieldsFor,
  type Endorsement, type Exclusion, type FieldDef, type FieldMode, type PolicyRow, type PremiumLine,
} from "./fields";
import { premiumSchedule } from "./premium";
import { effectiveSections, legacyValuesOutside } from "./status";

export type MetaSource = "extracted" | "manual" | "quote" | "previous_policy" | "agent_confirmed" | "keep";

export interface FieldMeta {
  source: MetaSource;
  candidateIndex: number | null;          // extracted only
  confirmedOn?: string | null;            // agent_confirmed only
  attachmentDocumentId?: string | null;   // agent_confirmed only
}

/** One p_sources entry (see insurance_resolve_sources in 0052). */
export interface SourceEntry {
  field_name: string;
  source: MetaSource;
  candidate_index?: number;
  confirmed_on?: string;
  document_id?: string;
}

export type ColumnValue = string | boolean | null;

const HINTS: Partial<Record<FieldDef["kind"], string>> = {
  money: "Use digits, like 2400000 or $2,400,000.",
  percent: "Use a percent, like 2%.",
  date: "Use the date picker.",
};

/** `{label}: "{raw}" isn't a value Walkup can save. {hint}` */
export function fieldErrorText(def: FieldDef, raw: string): string {
  const hint = HINTS[def.kind];
  return `${def.label}: "${raw}" isn't a value Walkup can save.${hint ? ` ${hint}` : ""}`;
}

const REQUIRED: Record<FieldMode, string[]> = {
  policy: ["policy_type", "carrier_name", "effective_on", "expires_on", "annual_premium"],
  quote: ["policy_type", "carrier_name", "annual_premium"],
};

/** The empty value a column takes: "unknown" for the NOT NULL enum columns, else null. */
export function emptyColumnValue(def: FieldDef): ColumnValue {
  return def.kind === "enum" && def.options?.some((o) => o.value === "unknown") ? "unknown" : null;
}

/** A parsed DB string ("true", "2400000.00") as the value p_values carries. */
function columnValue(def: FieldDef, parsed: string | null): ColumnValue {
  if (parsed === null) return emptyColumnValue(def);
  if (def.kind === "boolean") return parsed === "true";
  return parsed;
}

export interface PrepareInput {
  mode: FieldMode;
  coverage: CoverageType;
  includedSections: readonly string[];
  values: Record<string, string | null | undefined>;
  meta: Record<string, FieldMeta | undefined>;
  /** The row being edited (policy edits only): drives section clearing and "From the old form". */
  existing?: PolicyRow | null;
  clearLegacy?: boolean;
  isEdit: boolean;
}

export type Prepared =
  | {
      ok: true;
      sections: SectionKey[];
      defs: FieldDef[];
      /** field key → parsed DB string, or null when blank */
      parsed: Record<string, string | null>;
      /** column → value for p_values */
      columns: Record<string, ColumnValue>;
      sources: SourceEntry[];
    }
  | { ok: false; error: string; fieldErrors: Record<string, string> };

const isIsoDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

function sourceFor(def: FieldDef, m: FieldMeta | undefined, mode: FieldMode, isEdit: boolean): SourceEntry {
  const fallback: MetaSource = isEdit ? "keep" : "manual";
  let source: MetaSource = m?.source ?? fallback;
  // A quote's values come from the quote itself or from the board (the RPC refuses the others).
  if (mode === "quote" && (source === "quote" || source === "agent_confirmed")) source = "manual";
  const entry: SourceEntry = { field_name: def.key, source };
  if (source === "extracted") {
    const i = m?.candidateIndex;
    if (typeof i === "number" && Number.isInteger(i) && i >= 0) entry.candidate_index = i;
    else entry.source = isEdit ? "keep" : "manual";
  } else if (source === "agent_confirmed") {
    if (isIsoDate(m?.confirmedOn)) entry.confirmed_on = m.confirmedOn;
    if (m?.attachmentDocumentId) entry.document_id = m.attachmentDocumentId;
  }
  return entry;
}

/**
 * Steps 1, 2, 3, 5 and 7 of §8.2 (and their §8.3 mirror): parse, require,
 * order the dates, map to columns, and build p_sources. For a policy edit, a
 * section switched off in this edit is cleared, and values the row holds
 * outside every shown section are cleared only when clearLegacy is set.
 */
export function prepareFieldValues(input: PrepareInput): Prepared {
  const sections = sectionsFor(input.coverage, input.includedSections);
  const defs = fieldsFor(input.coverage, sections, input.mode);
  const fieldErrors: Record<string, string> = {};
  const parsed: Record<string, string | null> = {};

  for (const def of defs) {
    if (def.key === "policy_type") {
      parsed[def.key] = input.coverage;
      continue;
    }
    const raw = String(input.values[def.key] ?? "").trim();
    if (raw === "") {
      parsed[def.key] = null;
      continue;
    }
    const v = parseFieldValue(def, raw);
    if (v === null) fieldErrors[def.key] = fieldErrorText(def, raw);
    parsed[def.key] = v;
  }

  for (const key of REQUIRED[input.mode]) {
    const def = defs.find((d) => d.key === key);
    if (def && parsed[key] === null && !fieldErrors[key]) fieldErrors[key] = `${def.label} is needed to save.`;
  }
  const from = parsed.effective_on;
  const to = parsed.expires_on;
  if (from && to && to <= from && !fieldErrors.expires_on) {
    fieldErrors.expires_on = "The end date has to be after the start date.";
  }

  const keys = Object.keys(fieldErrors);
  if (keys.length) {
    return { ok: false, error: fieldErrors[keys[0]], fieldErrors };
  }

  const columns: Record<string, ColumnValue> = {};
  for (const def of defs) columns[def.column] = columnValue(def, parsed[def.key]);

  if (input.mode === "policy" && input.isEdit && input.existing) {
    const shown = new Set(defs.map((d) => d.column));
    const before = fieldsFor(
      (input.existing.coverage as CoverageType) ?? input.coverage,
      effectiveSections(input.existing),
      "policy",
    );
    for (const def of before) {
      if (!shown.has(def.column) && def.column !== "coverage") columns[def.column] = emptyColumnValue(def);
    }
    if (input.clearLegacy) {
      for (const legacy of legacyValuesOutside(input.existing)) {
        const def = FIELD_DEFS.find((d) => d.key === legacy.key);
        if (def && !shown.has(def.column) && def.column !== "coverage") columns[def.column] = emptyColumnValue(def);
      }
    }
  }

  const sources = defs
    .filter((d) => parsed[d.key] !== null)
    .map((d) => sourceFor(d, input.meta[d.key], input.mode, input.isEdit));

  return { ok: true, sections, defs, parsed, columns, sources };
}

const ListsSchema = z.object({
  endorsements: z.array(EndorsementSchema).max(200),
  exclusions: z.array(ExclusionSchema).max(200),
  premiumBreakdown: z.array(PremiumLineSchema).max(100),
});

/** The three list editors' rows, checked before they reach jsonb columns. */
export function parseLists(input: {
  endorsements: Endorsement[] | null | undefined;
  exclusions: Exclusion[] | null | undefined;
  premiumBreakdown: PremiumLine[] | null | undefined;
}): { ok: true; endorsements: Endorsement[]; exclusions: Exclusion[]; premiumBreakdown: PremiumLine[] } | { ok: false; error: string } {
  const r = ListsSchema.safeParse({
    endorsements: input.endorsements ?? [],
    exclusions: input.exclusions ?? [],
    premiumBreakdown: input.premiumBreakdown ?? [],
  });
  if (!r.success) {
    const where = String(r.error.issues[0]?.path?.[0] ?? "");
    const what = where === "endorsements" ? "endorsements" : where === "exclusions" ? "exclusions" : "premium breakdown";
    return { ok: false, error: `Check the ${what}: each row needs a title${what === "premium breakdown" ? " and an amount" : ""}.` };
  }
  return { ok: true, ...r.data };
}

/**
 * p_options.premium_bill (§8.2 step 8): premiumSchedule() on the values being
 * saved. Null when the dates or premium are missing.
 */
export function premiumBillOption(
  parsed: Record<string, string | null>,
  accountId: string | null,
  todayIso: string,
): { account_id: string | null; frequency: string; typical_amount: string; next_due_on: string } | null {
  const premium = parsed.annual_premium;
  const from = parsed.effective_on;
  const to = parsed.expires_on;
  if (!premium || !from || !to) return null;
  const s = premiumSchedule(
    { annual_premium: premium, payment_schedule: parsed.payment_schedule ?? "unknown", effective_from: from, effective_to: to },
    todayIso,
  );
  return { account_id: accountId, frequency: s.frequency, typical_amount: s.perInstallment, next_due_on: s.nextDueOn };
}

/** The agent fields of a saved policy or quote, when any is filled (§8.2 step 6). */
export function agentFromValues(parsed: Record<string, string | null>): {
  kind: "agency" | "agent"; name: string; personName: string | null; email: string | null; phone: string | null;
} | null {
  const agency = parsed.agency_name?.trim() || null;
  const agent = parsed.agent_name?.trim() || null;
  const rawEmail = parsed.agent_email?.trim() || null;
  const phone = parsed.agent_phone?.trim() || null;
  if (!agency && !agent && !rawEmail && !phone) return null;
  const name = agency ?? agent;
  if (!name) return null; // an email or phone alone names nobody
  const email = rawEmail && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rawEmail) ? rawEmail : null;
  return { kind: agency ? "agency" : "agent", name, personName: agency ? agent : null, email, phone };
}
