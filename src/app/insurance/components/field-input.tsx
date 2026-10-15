"use client";

import type { Candidate, ResolvedField } from "@/lib/insurance/declarations";
import { parseFieldValue } from "@/lib/insurance/declarations";
import type { FieldDef } from "@/lib/insurance/fields";
import { formatMoney, formatPercent, longDate } from "@/lib/insurance/format";
import { Provenance, type ProvenanceInfo } from "./provenance";
import { helpClass, inputClass, labelClass } from "./styles";

/**
 * One field of the review form (§9.3.4): label, the right input for its kind,
 * provenance, "Is this right?" candidates for a value Walkup wasn't sure of,
 * help, and the field's error. Values travel as the strings a person would
 * type; the server parses them (save-input.ts).
 */

/** A stored DB string ("2400000.00", "0.0200", "true") as what the input shows. */
export function toInput(def: FieldDef, value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  switch (def.kind) {
    case "money":
      return (formatMoney(value) ?? value).replace(/^\$/, "");
    case "percent":
      return (formatPercent(value) ?? value).replace(/%$/, "");
    default:
      return value;
  }
}

/** What the input holds, as the raw string the server parses (percent inputs get their "%" back). */
export function fromInput(def: FieldDef, raw: string): string {
  const t = raw.trim();
  if (t === "") return "";
  if (def.kind === "percent" && /^\d+(\.\d+)?$/.test(t)) return `${t}%`;
  return t;
}

/** The value a candidate fills, as the input shows it, or null when it can't be used as written. */
export function candidateValue(def: FieldDef, c: Candidate, suggested: string | null | undefined, only: boolean): string | null {
  const parsed = parseFieldValue(def, c.value);
  if (parsed !== null) return toInput(def, parsed);
  if (only && suggested) return toInput(def, suggested);
  return null;
}

function shownSuggestion(def: FieldDef, input: string): string {
  if (def.kind === "money") return `$${input}`;
  if (def.kind === "percent") return `${input}%`;
  if (def.kind === "date") return longDate(input);
  if (def.kind === "boolean") return input === "true" ? "Yes" : "No";
  if (def.kind === "enum") return def.options?.find((o) => o.value === input)?.label ?? input;
  return input;
}

export function FieldInput({
  def,
  value,
  onChange,
  onUse,
  review,
  provenance,
  documentId,
  documentName,
  error,
  willClear,
  note,
  idPrefix = "f",
}: {
  def: FieldDef;
  value: string;
  onChange: (v: string) => void;
  /** "Use this": fill the candidate's value; the server rebuilds its page and snippet. */
  onUse: (candidateIndex: number, value: string) => void;
  review: ResolvedField | null;
  provenance: ProvenanceInfo | null;
  documentId: string | null;
  documentName: string | null;
  error?: string;
  willClear?: boolean;
  note?: React.ReactNode;
  idPrefix?: string;
}) {
  const id = `${idPrefix}-${def.key}`;
  const helpId = `${id}-help`;
  const errId = `${id}-err`;
  const required = def.required === "both" || def.required === "policy";
  const describedBy = [def.help ? helpId : null, error ? errId : null].filter(Boolean).join(" ") || undefined;
  const common = {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
  } as const;

  let control: React.ReactNode;
  if (def.kind === "boolean") {
    control = (
      <select {...common} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        <option value="">Not stated</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  } else if (def.kind === "enum") {
    const hasUnknown = def.options?.some((o) => o.value === "unknown");
    control = (
      <select {...common} value={value === "" && hasUnknown ? "unknown" : value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        {hasUnknown ? null : <option value="">Not stated</option>}
        {(def.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.value === "unknown" ? "Not stated" : o.label}
          </option>
        ))}
      </select>
    );
  } else if (def.kind === "date") {
    control = <input {...common} type="date" value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} />;
  } else if (def.kind === "money" || def.kind === "percent") {
    const money = def.kind === "money";
    control = (
      <div className="relative mt-1">
        {money ? (
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[13px] text-mute">
            $
          </span>
        ) : null}
        <input
          {...common}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass.replace("mt-1 ", "")} figures ${money ? "pl-7" : "pr-8"}`}
        />
        {money ? null : (
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] text-mute">
            %
          </span>
        )}
      </div>
    );
  } else {
    control = (
      <input
        {...common}
        type={def.key === "agent_email" ? "email" : def.key.endsWith("phone") ? "tel" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    );
  }

  const needsLook = review && review.status === "review" && value.trim() === "" && review.candidates.length > 0;

  return (
    <div id={`${id}-wrap`} className="min-w-0 scroll-mt-24">
      <label htmlFor={id} className={labelClass}>
        {def.label}
        {required ? (
          <span className="text-bad-text" aria-hidden="true">
            {" "}*
          </span>
        ) : null}
        {required ? <span className="sr-only"> (needed to save)</span> : null}
      </label>
      {control}
      {willClear ? <p className="mt-1 text-[11px] text-warning-text">Will be cleared when you save</p> : null}
      {needsLook ? (
        <div className="mt-2 space-y-2 border-l-[3px] border-warning bg-warning-tint px-3 py-2 text-[12px] text-warning-text">
          <p>Is this right? {review.reason}</p>
          <ul className="space-y-2">
            {review.candidates.map((c, i) => {
              const v = candidateValue(def, c, review.suggested, review.candidates.length === 1);
              const short = v !== null && parseFieldValue(def, c.value) === null;
              return (
                <li key={`${c.value}-${i}`} className="space-y-1">
                  <div className="text-ink">
                    <span className="figures font-medium">{c.value}</span>
                    {c.page ? (
                      <span className="text-mute">
                        {" "}Page {c.page}: &ldquo;{c.snippet}&rdquo;
                      </span>
                    ) : null}
                  </div>
                  {v !== null ? (
                    <button
                      type="button"
                      onClick={() => onUse(i, v)}
                      className="inline-flex min-h-[44px] w-full items-center justify-center rounded-md border border-warning-line bg-paper px-3 text-[12px] font-medium text-ink hover:bg-fill sm:w-auto"
                    >
                      {short ? `Use ${shownSuggestion(def, v)}` : "Use this"}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <p>Or type the right value, or leave it blank.</p>
        </div>
      ) : null}
      {!needsLook ? <Provenance info={provenance} documentId={documentId} documentName={documentName} /> : null}
      {note}
      {def.help ? (
        <p id={helpId} className={helpClass}>
          {def.help}
        </p>
      ) : null}
      {error ? (
        <p id={errId} className="mt-1 text-[12px] text-bad-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** One column on phones, two from sm (§9.3.4). */
export function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}
