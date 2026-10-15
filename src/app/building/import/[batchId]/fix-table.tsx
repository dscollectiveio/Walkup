"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FIELDS, type ImportKind } from "@/lib/import/kinds";
import { ERROR_FIELD_TO_MAPPED, errorHeading } from "@/lib/import/messages";
import { setRowDecision, skipProblemRows, fixImportRow } from "../actions";
import { BTN_PRIMARY, BTN_SECONDARY, ErrorNote, INPUT, Pill } from "../ui";

export interface FixRow {
  id: string;
  rowNumber: number;
  status: string;
  decision: "import" | "skip";
  mapped: Record<string, string>;
  raw: Record<string, string> | null;
  errors: { field: string; code: string; message: string }[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function FixTable({
  batchId,
  kind,
  rows,
  unitLabels,
  problemCount,
  tab,
}: {
  batchId: string;
  kind: ImportKind;
  rows: FixRow[];
  unitLabels: string[];
  problemCount: number;
  tab: string;
}) {
  const router = useRouter();
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-4">
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {tab === "fix" && problemCount > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          {confirmSkip ? (
            <>
              <span className="text-[13px] text-ink">This leaves {problemCount} {problemCount === 1 ? "row" : "rows"} out. Skip them?</span>
              <button
                type="button"
                disabled={pending}
                className={BTN_PRIMARY}
                onClick={() =>
                  start(async () => {
                    const r = await skipProblemRows(batchId);
                    if ("error" in r) setError(r.error);
                    else {
                      setConfirmSkip(false);
                      router.refresh();
                    }
                  })
                }
              >
                {pending ? "Skipping..." : "Yes, skip them"}
              </button>
              <button type="button" className={BTN_SECONDARY} onClick={() => setConfirmSkip(false)}>
                Keep them
              </button>
            </>
          ) : (
            <button type="button" className={BTN_SECONDARY} onClick={() => setConfirmSkip(true)}>
              Skip all {problemCount} {problemCount === 1 ? "row" : "rows"} with problems
            </button>
          )}
          <a href={`/building/import/${batchId}/errors.csv`} className={BTN_SECONDARY} download>
            Download the problem rows
          </a>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-mute">Nothing in this list.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <FixRowCard key={r.id} row={r} kind={kind} unitLabels={unitLabels} batchId={batchId} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FixRowCard({ row, kind, unitLabels, batchId }: { row: FixRow; kind: ImportKind; unitLabels: string[]; batchId: string }) {
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fields = FIELDS[kind];
  const summary = fields.map((f) => row.mapped[f.key]).filter(Boolean).join(" · ");
  const hasParse = new Set(row.errors.filter((e) => e.code.startsWith("parse_")).map((e) => e.field));

  const call = (fn: () => Promise<{ ok: true } | { error: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if ("error" in r) setError(r.error);
      else {
        setEdits({});
        router.refresh();
      }
    });

  const tone = row.decision === "skip" ? "neutral" : row.status === "error" ? "bad" : row.status === "duplicate" ? "info" : "good";
  const statusWords = row.decision === "skip" ? "Skipped" : row.status === "error" ? "Needs a fix" : row.status === "duplicate" ? "Already imported" : "Ready";

  return (
    <li className="rounded-xl border border-line bg-paper p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink">
            Row {row.rowNumber} <Pill tone={tone}>{statusWords}</Pill>
          </p>
          <p className="mt-1 break-words text-[12px] text-mute">{summary || "No values"}</p>
        </div>
        <div className="flex gap-2">
          {row.decision === "skip" ? (
            <button type="button" disabled={pending} className={`${BTN_SECONDARY} !min-h-[36px] !px-3`} onClick={() => call(() => setRowDecision(row.id, "import"))}>
              Include again
            </button>
          ) : (
            <button type="button" disabled={pending} className={`${BTN_SECONDARY} !min-h-[36px] !px-3`} onClick={() => call(() => setRowDecision(row.id, "skip"))}>
              Skip this row
            </button>
          )}
        </div>
      </div>

      {row.status === "error" && row.decision !== "skip" ? (
        <div className="mt-3 space-y-3">
          {row.errors
            .filter((e) => !(hasParse.has(e.field) && !e.code.startsWith("parse_")))
            .map((e, i) => {
              const key = ERROR_FIELD_TO_MAPPED[e.field] ?? e.field;
              const inOptions = e.code === "category_unmapped" || e.code === "category_missing" || e.code === "fund_unmapped" || e.code === "fund_unknown";
              const value = edits[key] ?? row.mapped[key] ?? "";
              const typed = row.raw?.[key];
              return (
                <div key={`${e.code}-${i}`} className="space-y-1">
                  <p className="text-[13px] text-bad-text">
                    <strong className="font-semibold">{errorHeading(e.code)}:</strong> {e.message}
                  </p>
                  {typed ? <p className="text-[12px] text-mute">Your file says: {typed}</p> : null}
                  {e.code === "already_in_books" || e.code === "already_in_bank_feed" ? (
                    <button
                      type="button"
                      disabled={pending}
                      className={`${BTN_SECONDARY} !min-h-[36px] !px-3`}
                      onClick={() => call(() => fixImportRow(row.id, { confirmed_separate: "true" }))}
                    >
                      This is a separate transaction
                    </button>
                  ) : null}
                  {inOptions ? (
                    <p className="text-[12px] text-mute">
                      Match it in{" "}
                      <Link href={`/building/import/${batchId}`} className="font-medium text-ink underline underline-offset-2">
                        the books step
                      </Link>
                      , or fix the text here.
                    </p>
                  ) : null}
                  {key === "unit_label" && kind === "transactions" ? (
                    <select aria-label="Unit" value={value} onChange={(ev) => setEdits((s) => ({ ...s, [key]: ev.target.value }))} className={INPUT}>
                      <option value="">No unit</option>
                      {unitLabels.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  ) : key === "unit_label" && kind === "opening_units" ? (
                    <select aria-label="Unit" value={value} onChange={(ev) => setEdits((s) => ({ ...s, [key]: ev.target.value }))} className={INPUT}>
                      <option value="">Choose a unit</option>
                      {unitLabels.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  ) : key === "date" || key === "effective_from" ? (
                    <input
                      type="date"
                      aria-label="Date"
                      value={ISO_DATE.test(value) ? value : ""}
                      onChange={(ev) => setEdits((s) => ({ ...s, [key]: ev.target.value }))}
                      className={INPUT}
                    />
                  ) : (
                    <input
                      aria-label={errorHeading(e.code)}
                      value={value}
                      maxLength={300}
                      onChange={(ev) => setEdits((s) => ({ ...s, [key]: ev.target.value }))}
                      className={INPUT}
                    />
                  )}
                </div>
              );
            })}
          <button
            type="button"
            disabled={pending || Object.keys(edits).length === 0}
            className={BTN_PRIMARY}
            onClick={() => call(() => fixImportRow(row.id, edits))}
          >
            {pending ? "Saving..." : "Save fix"}
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="mt-2">
          <ErrorNote>{error}</ErrorNote>
        </div>
      ) : null}
    </li>
  );
}
