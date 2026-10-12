// Auto-fill proposes; a person confirms. Given a verified template's field
// map and the association's records, produce a value, its source, and a
// confidence for every mapped field. Pure.
//
// A field is only ever filled through a verified map entry. Unmapped fields
// aren't here at all and print blank. A rule this module doesn't recognize
// yields a blank, never a guess.
//
// Lines a person types (`manual`) are never proposed here — they live on the
// form's own rows — but they do feed the calculated lines: line 8 of the
// 1120-H is the sum of lines 1–7, which the board enters. Those entries come
// in through `entered`; a line the person chose to leave blank counts as
// zero, because that is what a blank money line means on a tax form.

export type FieldSource = "setting" | "ledger" | "contractors" | "manual" | "calculated";
export type Confidence = "high" | "review" | "blank";
export type FieldKind = "money" | "text" | "date" | "checkbox";

export interface MapEntry {
  label: string;
  section?: string;
  source: FieldSource;
  rule: string;
  citation: string;
  /** How the form page shows and edits the line; text when absent. */
  kind?: FieldKind;
  /** Always worth a second look: confidence is capped at "review" even when the records are settled. */
  review?: boolean;
  /** A money line where "Enter 0" is a sensible answer; the form page offers it as a button. */
  zeroOk?: boolean;
  /** Plain words under the label — which amounts belong on this line. */
  hint?: string;
  /**
   * Checkbox lines that, once ticked, make this calculation not Walkup's to
   * make (a timeshare association pays a different rate than the one on
   * file). The line stays blank — and everything computed from it with it —
   * until a person enters it.
   */
  blankIf?: string[];
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
  // The same date as MM/DD/YYYY — how the IRS forms want it written.
  "association.incorporated_on_us",
  "fiscal_year.starts_on",
  "fiscal_year.ends_on",
  // MM/DD for the "tax year beginning … and ending …" header, and the last
  // two digits of the ending year. All three are null for a calendar fiscal
  // year, which leaves those boxes blank (derivedSettings below).
  "fiscal_year.starts_on_mmdd_noncalendar",
  "fiscal_year.ends_on_mmdd_noncalendar",
  "fiscal_year.ends_on_yy_noncalendar",
  // The year the form reports — the calendar year of payment for a 1099.
  "form.tax_year",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

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
  settings: Partial<Record<SettingKey, string | null>>;
  ledger: Partial<Record<(typeof LEDGER_KEYS)[number], { cents: number; refs: string[] }>>;
  /** True when every income account with activity is confirmed and nothing is within 5 points of a threshold. */
  ledgerSettled: boolean;
  ledgerReviewReason: string | null;
  contractor: { name: string; address: string | null; totalCents: number; expenseIds: string[] } | null;
  contractors: { count: number; totalCents: number; expenseIds: string[] } | null;
  /** Already resolved as of the form's own year by the caller, keyed by tax_parameters.key. */
  parameters: Record<string, number>;
  /**
   * What the person has entered on `manual` lines so far, by PDF field name,
   * so the calculated lines can add them up. `leaveBlank` counts as 0; a line
   * with neither a value nor that choice leaves every calculation that uses it
   * blank. Optional only so older callers still compile — without it, no
   * calculated line that reads a manual one ever fills.
   */
  entered?: Record<string, { value: string | null; leaveBlank: boolean }>;
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

/** "1,200.00", "$1200" and "1200" all read as 1200; anything else (including "") is not a number. */
function parseAmount(text: string): number | null {
  const s = text.replace(/[$,\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const usDate = (iso: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : null);
const mmdd = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}`;

/**
 * The settings that are spelled from other facts, in the shape the forms
 * want them. Kept beside the keys so the one rule — a calendar fiscal year
 * leaves the "tax year beginning … ending …" header blank — lives in one
 * tested place rather than in each caller.
 */
export function derivedSettings(input: {
  incorporatedOn: string | null;
  fiscalYear: { startsOn: string; endsOn: string };
  taxYear: number;
}): Record<
  | "association.incorporated_on_us"
  | "fiscal_year.starts_on_mmdd_noncalendar"
  | "fiscal_year.ends_on_mmdd_noncalendar"
  | "fiscal_year.ends_on_yy_noncalendar"
  | "form.tax_year",
  string | null
> {
  const { startsOn, endsOn } = input.fiscalYear;
  const calendar = startsOn.slice(5) === "01-01" && endsOn.slice(5) === "12-31" && startsOn.slice(0, 4) === endsOn.slice(0, 4);
  return {
    "association.incorporated_on_us": usDate(input.incorporatedOn),
    "fiscal_year.starts_on_mmdd_noncalendar": calendar ? null : mmdd(startsOn),
    "fiscal_year.ends_on_mmdd_noncalendar": calendar ? null : mmdd(endsOn),
    "fiscal_year.ends_on_yy_noncalendar": calendar ? null : endsOn.slice(2, 4),
    "form.tax_year": String(input.taxYear),
  };
}

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
  const cap = (entry: MapEntry, c: Confidence): Confidence => (entry.review && c === "high" ? "review" : c);

  /** A manual line as an operand: what the person typed, 0 when they chose to leave it blank, otherwise undecided. */
  const enteredOperand = (name: string, entry: MapEntry): { value: number | null; confidence: Confidence } => {
    const e = input.entered?.[name];
    const typed = e?.value == null ? null : parseAmount(e.value);
    if (typed !== null) return { value: typed, confidence: cap(entry, "high") };
    if (e?.leaveBlank) return { value: 0, confidence: cap(entry, "high") };
    return { value: null, confidence: "blank" };
  };

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
          ? input.settings[entry.rule as SettingKey]
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
        const blocked = (entry.blankIf ?? []).find((n) => {
          const v = input.entered?.[n]?.value?.trim().toLowerCase();
          return v !== undefined && ["true", "yes", "x", "1", "on"].includes(v);
        });
        if (blocked) {
          result = { ...blank, sourceRef: { formula: entry.rule, blockedBy: blocked } };
          break;
        }
        // A derived figure: high confidence when every operand is, review
        // when any operand is, blank the moment one operand is undecided.
        const r = evalFormula(
          entry.rule,
          (other) => {
            const o = map[other];
            if (o?.source === "manual" && o.citation?.trim()) return enteredOperand(other, o);
            const f = fill(other);
            return { value: f.value === null ? null : parseAmount(f.value), confidence: f.confidence };
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
        // Manual lines are the person's to type; nothing is proposed for them.
        result = blank;
    }
    result = { ...result, confidence: cap(entry, result.confidence) };
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
  /** The records' value the person already chose to ignore ("Keep mine"); not proposed again while the records still say it. */
  dismissedValue?: string | null;
}

/**
 * Re-running auto-fill never overwrites what a person confirmed or typed.
 * A differing value from the records is kept aside as proposed_value.
 * The one exception is a calculated line: it is derived from the others, so
 * it always follows them, and its confirmation survives only while the
 * figure is unchanged.
 */
export function mergeWithExisting(fresh: FilledField, existing: ExistingField | undefined) {
  if (!existing) return { value: fresh.value, proposedValue: null, keepConfirmation: false };
  const same = (fresh.value ?? "") === (existing.value ?? "");
  if (fresh.source === "calculated") return { value: fresh.value, proposedValue: null, keepConfirmation: same };
  const settled = existing.userEdited || existing.confirmedAt !== null || existing.leaveBlank;
  if (!settled) return { value: fresh.value, proposedValue: null, keepConfirmation: false };
  if (same) return { value: existing.value, proposedValue: null, keepConfirmation: true };
  if (existing.dismissedValue != null && existing.dismissedValue === fresh.value) {
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
