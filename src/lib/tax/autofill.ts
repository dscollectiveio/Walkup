// Auto-fill proposes; a person confirms. Given a verified template's field
// map and the association's records, produce a value, its source, and a
// confidence for every mapped field. Pure.
//
// A field is only ever filled through a verified map entry. Unmapped fields
// aren't here at all and print blank. A rule this module doesn't recognize
// yields a blank, never a guess.

export type FieldSource = "setting" | "ledger" | "contractors" | "manual" | "calculated";
export type Confidence = "high" | "review" | "blank";

export interface MapEntry {
  label: string;
  section?: string;
  source: FieldSource;
  rule: string;
  citation: string;
}

export type FieldMap = Record<string, MapEntry>;

/** The only settings a map may read. */
export const SETTING_KEYS = [
  "association.legal_name",
  "association.ein",
  "association.street_address",
  "association.city",
  "association.state_code",
  "association.postal_code",
  "association.city_state_zip",
  "association.incorporated_on",
  "fiscal_year.starts_on",
  "fiscal_year.ends_on",
] as const;

/** The only ledger aggregates a map may read — the 1120-H cash-basis figures (0022). */
export const LEDGER_KEYS = [
  "exempt_income",
  "nonexempt_income",
  "gross_income",
  "exempt_expenditures",
  "total_expenditures",
] as const;

/**
 * Contractor fields. There is deliberately no TIN key: Walkup stores only the
 * last four digits (DECISIONS #4), so a recipient TIN always prints blank and
 * is copied from the W-9 by hand.
 */
export const CONTRACTOR_KEYS = [
  "contractor.name",
  "contractor.address",
  "contractor.total_paid",
  "contractors.count",
  "contractors.total_paid",
] as const;

export interface AutofillInput {
  settings: Partial<Record<(typeof SETTING_KEYS)[number], string | null>>;
  ledger: Partial<Record<(typeof LEDGER_KEYS)[number], { cents: number; refs: string[] }>>;
  /** True when every income account with activity is confirmed and nothing is within 5 points of a threshold. */
  ledgerSettled: boolean;
  ledgerReviewReason: string | null;
  contractor: { name: string; address: string | null; totalCents: number; expenseIds: string[] } | null;
  contractors: { count: number; totalCents: number; expenseIds: string[] } | null;
  parameters: Record<string, number>;
}

export interface FilledField {
  pdfFieldName: string;
  label: string;
  section: string | null;
  citation: string;
  value: string | null;
  source: FieldSource;
  sourceRef: Record<string, unknown>;
  confidence: Confidence;
}

const money = (cents: number) => (cents / 100).toFixed(2);

function evalFormula(
  expr: string,
  resolve: (name: string) => { value: number | null; confidence: Confidence },
  params: Record<string, number>,
  depth = 0,
): { value: number | null; confidence: Confidence } {
  if (depth > 12) return { value: null, confidence: "blank" };
  const e = expr.trim();
  const call = e.match(/^(add|sub|mul|max0)\((.*)\)$/);
  if (call) {
    const args: string[] = [];
    let level = 0;
    let cur = "";
    for (const ch of call[2]) {
      if (ch === "(") level++;
      if (ch === ")") level--;
      if (ch === "," && level === 0) {
        args.push(cur);
        cur = "";
      } else cur += ch;
    }
    if (cur.trim()) args.push(cur);
    const vals = args.map((a) => evalFormula(a, resolve, params, depth + 1));
    if (vals.some((v) => v.value === null)) return { value: null, confidence: "blank" };
    const nums = vals.map((v) => v.value!);
    const confidence: Confidence = vals.some((v) => v.confidence === "review") ? "review" : "high";
    const op = call[1];
    const value =
      op === "add" ? nums.reduce((s, n) => s + n, 0)
      : op === "sub" && nums.length === 2 ? nums[0] - nums[1]
      : op === "mul" ? nums.reduce((s, n) => s * n, 1)
      : op === "max0" && nums.length === 1 ? Math.max(0, nums[0])
      : null;
    return value === null ? { value: null, confidence: "blank" } : { value: Math.round(value * 100) / 100, confidence };
  }
  if (e.startsWith("param:")) {
    const v = params[e.slice(6)];
    return v === undefined ? { value: null, confidence: "blank" } : { value: v, confidence: "high" };
  }
  if (/^-?\d+(\.\d+)?$/.test(e)) return { value: Number(e), confidence: "high" };
  return resolve(e);
}

export function autofill(map: FieldMap, input: AutofillInput): FilledField[] {
  const cache = new Map<string, FilledField>();
  const visiting = new Set<string>();

  const fill = (name: string): FilledField => {
    if (cache.has(name)) return cache.get(name)!;
    const entry = map[name];
    const base = {
      pdfFieldName: name,
      label: entry?.label ?? name,
      section: entry?.section ?? null,
      citation: entry?.citation ?? "",
      source: (entry?.source ?? "manual") as FieldSource,
    };
    const blank: FilledField = { ...base, value: null, sourceRef: {}, confidence: "blank" };
    // A map entry with no citation is not a verified mapping.
    if (!entry || !entry.citation?.trim() || visiting.has(name)) return blank;
    visiting.add(name);

    let result: FilledField = blank;
    switch (entry.source) {
      case "setting": {
        const v = (SETTING_KEYS as readonly string[]).includes(entry.rule)
          ? input.settings[entry.rule as (typeof SETTING_KEYS)[number]]
          : undefined;
        result = v
          ? { ...base, value: v, sourceRef: { setting: entry.rule }, confidence: "high" }
          : { ...blank, sourceRef: { setting: entry.rule } };
        break;
      }
      case "ledger": {
        const agg = (LEDGER_KEYS as readonly string[]).includes(entry.rule)
          ? input.ledger[entry.rule as (typeof LEDGER_KEYS)[number]]
          : undefined;
        result = agg
          ? {
              ...base,
              value: money(agg.cents),
              sourceRef: { aggregate: entry.rule, journal_line_ids: agg.refs, count: agg.refs.length },
              confidence: input.ledgerSettled ? "high" : "review",
            }
          : blank;
        break;
      }
      case "contractors": {
        const c = input.contractor;
        const all = input.contractors;
        const byRule: Record<string, FilledField | null> = {
          "contractor.name": c ? { ...base, value: c.name, sourceRef: { contractor: c.name }, confidence: "high" } : null,
          "contractor.address": c?.address ? { ...base, value: c.address, sourceRef: { contractor: c.name }, confidence: "high" } : null,
          "contractor.total_paid": c
            ? { ...base, value: money(c.totalCents), sourceRef: { expense_ids: c.expenseIds }, confidence: "high" }
            : null,
          "contractors.count": all ? { ...base, value: String(all.count), sourceRef: { expense_ids: all.expenseIds }, confidence: "high" } : null,
          "contractors.total_paid": all
            ? { ...base, value: money(all.totalCents), sourceRef: { expense_ids: all.expenseIds }, confidence: "high" }
            : null,
        };
        result = byRule[entry.rule] ?? blank;
        break;
      }
      case "calculated": {
        const r = evalFormula(
          entry.rule,
          (other) => {
            const f = fill(other);
            const n = f.value === null ? null : Number(f.value);
            return { value: n !== null && Number.isFinite(n) ? n : null, confidence: f.confidence };
          },
          input.parameters,
        );
        result =
          r.value === null
            ? { ...blank, sourceRef: { formula: entry.rule } }
            : { ...base, value: r.value.toFixed(2), sourceRef: { formula: entry.rule }, confidence: r.confidence };
        break;
      }
      default:
        result = blank;
    }
    visiting.delete(name);
    cache.set(name, result);
    return result;
  };

  return Object.keys(map).map(fill);
}

export interface ExistingField {
  value: string | null;
  userEdited: boolean;
  confirmedAt: string | null;
  leaveBlank: boolean;
}

/**
 * Re-running auto-fill never overwrites what a person confirmed or typed.
 * A differing value from the records is kept aside as proposed_value.
 */
export function mergeWithExisting(fresh: FilledField, existing: ExistingField | undefined) {
  if (!existing) return { value: fresh.value, proposedValue: null, keepConfirmation: false };
  const settled = existing.userEdited || existing.confirmedAt !== null || existing.leaveBlank;
  if (!settled) return { value: fresh.value, proposedValue: null, keepConfirmation: false };
  if ((fresh.value ?? "") === (existing.value ?? "")) {
    return { value: existing.value, proposedValue: null, keepConfirmation: true };
  }
  return { value: existing.value, proposedValue: fresh.value, keepConfirmation: true };
}

/** A form is ready to sign when every filled field is confirmed and every blank one is dealt with. */
export function isReadyToSign(
  fields: { value: string | null; confidence: Confidence; confirmedAt: string | null; leaveBlank: boolean; proposedValue: string | null }[],
): boolean {
  if (fields.length === 0) return false;
  return fields.every((f) =>
    f.proposedValue !== null ? false : f.value !== null && f.value !== "" ? f.confirmedAt !== null : f.leaveBlank,
  );
}
