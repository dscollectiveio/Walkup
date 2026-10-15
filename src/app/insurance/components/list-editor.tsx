"use client";

import { inputClass, labelClass } from "./styles";

/**
 * Rows of endorsements, exclusions or premium lines (§9.3.4 items 5 and 6).
 * Each row edits its own fields; a page number stays with a row that came
 * from the file, so its "page n" link survives the edit.
 */

export interface ListColumn<R> {
  key: keyof R & string;
  label: string;
  /** Narrow columns (form number, amount). */
  narrow?: boolean;
  inputMode?: "decimal" | "text";
}

export function ListEditor<R extends Record<string, unknown>>({
  id,
  rows,
  columns,
  onChange,
  blank,
  addLabel,
  rowLabel,
  renderPage,
}: {
  id: string;
  rows: R[];
  columns: ListColumn<R>[];
  onChange: (rows: R[]) => void;
  blank: () => R;
  addLabel: string;
  /** "Endorsement 2": names each row's remove button. */
  rowLabel: (i: number) => string;
  /** The row's page link when it came from the file. */
  renderPage?: (page: number) => React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      {rows.length === 0 ? <p className="text-[13px] text-mute">None listed.</p> : null}
      {rows.map((row, i) => (
        <div key={i} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[repeat(var(--cols),minmax(0,1fr))_auto] sm:items-end" style={{ ["--cols" as string]: columns.length }}>
          {columns.map((c) => (
            <div key={c.key} className={c.narrow ? "" : "sm:col-span-1"}>
              <label htmlFor={`${id}-${i}-${c.key}`} className={labelClass}>
                {c.label}
              </label>
              <input
                id={`${id}-${i}-${c.key}`}
                value={String(row[c.key] ?? "")}
                inputMode={c.inputMode}
                onChange={(e) => onChange(rows.map((r, j) => (j === i ? { ...r, [c.key]: e.target.value } : r)))}
                className={inputClass}
              />
            </div>
          ))}
          <div className="flex items-center gap-3">
            {typeof row.page === "number" ? (
              <span className="text-[11px] text-mute">{renderPage ? renderPage(row.page) : `Page ${row.page}`}</span>
            ) : null}
            <button
              type="button"
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
              aria-label={`Remove ${rowLabel(i)}`}
              className="min-h-[44px] rounded-md px-3 text-[12px] text-mute hover:bg-fill hover:text-ink"
            >
              Remove
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...rows, blank()])}
        className="inline-flex min-h-[44px] items-center rounded-md border border-dashed border-line-strong px-4 text-[13px] text-ink hover:bg-fill"
      >
        {addLabel}
      </button>
    </div>
  );
}
