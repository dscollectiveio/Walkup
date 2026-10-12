"use client";

import { useState, useTransition } from "react";
import { confirmField, editField, leaveFieldBlank, resolveProposed } from "../../form-actions";

export type FieldKind = "money" | "text" | "date" | "checkbox";
export type FieldSource = "setting" | "ledger" | "contractors" | "manual" | "calculated";

export interface FieldView {
  id: string;
  label: string;
  pdfFieldName: string;
  citation: string | null;
  value: string | null;
  source: FieldSource;
  /** How the line is shown and edited, from the template's map entry; text when the entry says nothing. */
  kind: FieldKind;
  /** A money line where "Enter 0" is a sensible answer, so the page offers it as a button. */
  zeroOk: boolean;
  /** Plain words under the label — which amounts belong on this line. */
  hint: string | null;
  confidence: "high" | "review" | "blank";
  sourceLine: string;
  sourceHref: string | null;
  proposedValue: string | null;
  confirmed: boolean;
  leaveBlank: boolean;
}

/** What the field actions answer: an error, or saved — sometimes with a warning that the calculated lines couldn't refresh. */
type ActionResult = { error?: string; warning?: string };

const btn = "min-h-[36px] rounded-md border border-line-strong bg-paper px-3 text-[12px] font-medium text-ink hover:bg-fill disabled:opacity-50";

/** Mirrors fillForm's reading of a checkbox value (lib/tax/pdf), so the page and the PDF agree on what "checked" means. */
const TRUTHY = new Set(["true", "yes", "x", "1", "on"]);
const isChecked = (value: string | null) => value !== null && TRUTHY.has(value.trim().toLowerCase());

/** "$1,234.56" for a money line that holds a number; anything else exactly as typed. */
function moneyWords(value: string): string {
  const s = value.replace(/[$,\s]/g, "");
  const n = Number(s);
  if (s === "" || !Number.isFinite(n)) return value;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

/**
 * One line of the form. A person confirms, enters, or leaves blank; a
 * calculated line is derived from the others and offers no buttons at all —
 * it changes when they do. A checkbox answers "check" or "leave unchecked"
 * (the same leave-blank the money lines use).
 */
export function FieldRow({ field, canEdit, locked }: { field: FieldView; canEdit: boolean; locked: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(field.value ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      setError(null);
      setNote(null);
      const r = await fn();
      if (r.error) setError(r.error);
      else {
        setEditing(false);
        if (r.warning) setNote(r.warning);
      }
    });

  const calculated = field.source === "calculated";
  const checkbox = field.kind === "checkbox";
  const blank = field.value === null || field.value === "";
  const needsDecision = !calculated && (field.proposedValue !== null || (field.confidence === "review" && !field.confirmed));
  const needsEntry = !calculated && blank && !field.leaveBlank;
  const editable = canEdit && !locked && !calculated;
  const tint = needsDecision ? "bg-warning-tint" : needsEntry ? "bg-fill" : "";
  const words = (v: string) => (field.kind === "money" ? moneyWords(v) : v);

  let shown: React.ReactNode;
  if (checkbox) {
    shown = isChecked(field.value) ? "Checked" : <span className="text-[12px] text-mute">{field.leaveBlank ? "Left unchecked" : "Not answered"}</span>;
  } else if (!blank) {
    shown = words(field.value as string);
  } else {
    shown = (
      <span className="text-[12px] text-mute">
        {field.leaveBlank ? "Left blank" : calculated ? "Blank until the lines it adds up are answered" : "Blank"}
      </span>
    );
  }

  return (
    <li className={`-mx-3 rounded-lg px-3 py-3 ${tint}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-ink">{field.label}</div>
          {field.hint ? <p className="mt-0.5 text-[12px] text-mute">{field.hint}</p> : null}
          <div className="mt-0.5 text-[11px] text-mute-soft">
            {field.citation ? `${field.citation} · ` : ""}
            <span className="font-mono">{field.pdfFieldName}</span>
          </div>
          <div className="mt-1 text-[12px] text-mute">
            {field.sourceHref ? (
              <a href={field.sourceHref} className="underline underline-offset-2">{field.sourceLine}</a>
            ) : (
              field.sourceLine
            )}
          </div>
        </div>
        <div className="text-right">
          {editing ? (
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor={`v-${field.id}`}>{field.label}</label>
              <input
                id={`v-${field.id}`}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                inputMode={field.kind === "money" ? "decimal" : undefined}
                placeholder={field.kind === "money" ? "0.00" : field.kind === "date" ? "MM/DD/YYYY" : undefined}
                className="figures min-h-[36px] w-40 rounded-lg border border-line-strong bg-paper px-2 text-[13px] text-ink"
              />
              <button type="button" disabled={pending} onClick={() => run(() => editField(field.id, value))} className={btn}>
                Save
              </button>
            </div>
          ) : (
            <div className="figures text-[15px] text-ink">{shown}</div>
          )}
          {calculated ? (
            <div className="text-[11px] text-mute">Calculated</div>
          ) : field.confirmed && !editing ? (
            <div className="text-[11px] text-good-text">Confirmed</div>
          ) : null}
        </div>
      </div>

      {field.proposedValue !== null ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-warning-text">
          Your records now say {words(field.proposedValue)}, you entered {blank ? "nothing" : words(field.value as string)}.
          {editable ? (
            <>
              <button type="button" disabled={pending} onClick={() => run(() => resolveProposed(field.id, "records"))} className={btn}>
                Use the records
              </button>
              <button type="button" disabled={pending} onClick={() => run(() => resolveProposed(field.id, "mine"))} className={btn}>
                Keep mine
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {needsEntry && !editing ? (
        <p className="mt-2 text-[12px] text-mute">
          {checkbox
            ? "Check this box or leave it unchecked."
            : field.zeroOk
              ? "We couldn’t find this in your records. Enter it, enter 0, or leave it blank."
              : "We couldn’t find this in your records. Enter it or leave it blank."}
        </p>
      ) : null}

      {editable && !editing ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {checkbox ? (
            <>
              {!isChecked(field.value) ? (
                <button type="button" disabled={pending} onClick={() => run(() => editField(field.id, "Yes"))} className={btn}>
                  Check this box
                </button>
              ) : null}
              {!field.leaveBlank ? (
                <button type="button" disabled={pending} onClick={() => run(() => leaveFieldBlank(field.id))} className={btn}>
                  Leave unchecked
                </button>
              ) : null}
            </>
          ) : (
            <>
              {!blank && !field.confirmed && field.proposedValue === null ? (
                <button type="button" disabled={pending} onClick={() => run(() => confirmField(field.id))} className={btn}>
                  Confirm
                </button>
              ) : null}
              <button type="button" onClick={() => setEditing(true)} className={btn}>
                {blank ? "Enter" : "Edit"}
              </button>
              {needsEntry && field.zeroOk ? (
                <button type="button" disabled={pending} onClick={() => run(() => editField(field.id, "0.00"))} className={btn}>
                  Enter 0
                </button>
              ) : null}
              {needsEntry ? (
                <button type="button" disabled={pending} onClick={() => run(() => leaveFieldBlank(field.id))} className={btn}>
                  Leave blank
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      {error ? <p className="mt-1 text-[12px] text-bad-text">{error}</p> : null}
      {note ? <p className="mt-1 text-[12px] text-warning-text">{note}</p> : null}
    </li>
  );
}
