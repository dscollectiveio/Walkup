"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AiStatusNote } from "@/components/ai/ai-status-note";
import { sampleDates } from "@/lib/import/columns";
import { FIELDS, KIND_LABEL, missingRequired, missingRequiredSentence, type ImportKind } from "@/lib/import/kinds";
import type { AiPreview } from "@/lib/import/ai-mapping";
import type { AiErrorCode } from "@/lib/ai/errors";
import type { AiSuggestion } from "@/lib/import/ai-verify";
import type { DateHint } from "@/lib/import/normalize";
import { removeUnfinishedUpload, startImport, suggestColumnMapping, type SuggestResult } from "../actions";
import { BTN_PRIMARY, BTN_SECONDARY, ErrorNote, HELP, INPUT, InfoNote, Pill } from "../ui";

export interface MappingColumn {
  index: number;
  header: string;
  sensitive: boolean;
  samples: string[];
}

export interface MappingStepProps {
  kind: ImportKind;
  documentId: string;
  filename: string;
  rowCount: number;
  columns: MappingColumn[];
  detected: { field: string; index: number; score: number; reason: "exact" | "contains" | "values" }[];
  initialMapping: Record<string, number | null>;
  keepCopyDefault: boolean;
  aiAvailable: boolean;
  warnings: string[];
}

const DATE_FORMATS: { value: DateHint; label: string }[] = [
  { value: "mdy", label: "Month/day/year (3/14/2026)" },
  { value: "dmy", label: "Day/month/year (14/3/2026)" },
  { value: "ymd", label: "Year-month-day (2026-03-14)" },
];

export function MappingStep(props: MappingStepProps) {
  const { kind, documentId, filename, rowCount, columns, detected } = props;
  const router = useRouter();
  const fields = FIELDS[kind];
  const [mapping, setMapping] = useState<Record<string, number | null>>(props.initialMapping);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [dateHint, setDateHint] = useState<DateHint>("mdy");
  const [keepCopy, setKeepCopy] = useState(props.keepCopyDefault);
  const [error, setError] = useState<{ message: string; earlier?: { batchId: string; on: string | null } } | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [ai, setAi] = useState<SuggestResult | null>(null);
  const [aiDismissed, setAiDismissed] = useState(false);
  const [aiBusy, startAi] = useTransition();
  const [pending, start] = useTransition();

  const detectedBy = useMemo(() => new Map(detected.map((d) => [d.field, d])), [detected]);
  const usable = columns.filter((c) => !c.sensitive);
  const missing = missingRequired(kind, mapping);
  const mappedIndexes = new Set(Object.values(mapping).filter((v): v is number => v !== null));
  const notImported = columns.filter((c) => !mappedIndexes.has(c.index));
  const hasDate = fields.some((f) => f.kind === "date" && mapping[f.key] !== null && mapping[f.key] !== undefined);
  const dateField = fields.find((f) => f.kind === "date" && mapping[f.key] !== null && mapping[f.key] !== undefined);
  const previewDates = dateField
    ? sampleDates(columns[mapping[dateField.key] as number]?.samples ?? [], dateHint === "ymd" ? "mdy" : dateHint)
    : [];

  const choose = (field: string, value: string) => {
    const index = value === "" ? null : Number(value);
    setMapping((m) => {
      const next = { ...m, [field]: index };
      if (index !== null) for (const k of Object.keys(next)) if (k !== field && next[k] === index) next[k] = null;
      return next;
    });
    setTouched((t) => new Set(t).add(field));
  };

  const sample = (field: string) => {
    const idx = mapping[field];
    if (idx === null || idx === undefined) return [];
    return columns[idx]?.samples ?? [];
  };

  const askAi = () =>
    startAi(async () => {
      setAiDismissed(false);
      setAi(await suggestColumnMapping({ kind, documentId }));
    });

  const applySuggestions = (suggestion: AiSuggestion[]) => {
    setMapping((m) => {
      const next = { ...m };
      for (const s of suggestion) {
        if (touched.has(s.field)) continue;
        const current = next[s.field];
        const det = detectedBy.get(s.field);
        // Only an empty slot or a weak guess; never over a name match or a manual choice.
        if (current !== null && current !== undefined && det && det.score >= 0.8) continue;
        next[s.field] = s.index;
        for (const k of Object.keys(next)) if (k !== s.field && next[k] === s.index) next[k] = null;
      }
      return next;
    });
    setAiDismissed(true);
  };

  const cancel = () =>
    start(async () => {
      await removeUnfinishedUpload(documentId);
      router.push("/building/import");
    });

  const submit = () =>
    start(async () => {
      setError(null);
      const r = await startImport({ kind, documentId, mapping, dateHint, keepCopy });
      if ("error" in r) {
        setError({ message: r.error, earlier: r.alreadyImported });
        return;
      }
      setNotes(r.notes);
      router.push(`/building/import/${r.batchId}`);
    });

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-[16px] font-bold text-ink">Match your columns</h2>
        <p className="text-[13px] text-mute">
          Walkup found {rowCount.toLocaleString("en-US")} {rowCount === 1 ? "row" : "rows"} in {filename}. Check that each Walkup field matches the right column.
        </p>
        {props.warnings.length > 0 ? <p className="text-[12px] text-mute">{props.warnings.join(" ")}</p> : null}
      </div>

      {ai && !ai.ok ? (
        <AiStatusNote
          failure={{ code: ai.code as AiErrorCode, reason: ai.reason, counted: ai.counted }}
          onRetry={askAi}
          byHandHref="#column-table"
          byHandLabel="Match by hand"
        />
      ) : null}
      {ai && ai.ok && !aiDismissed ? (
        <AiBanner
          suggestion={ai.suggestion}
          sent={ai.sent}
          kind={kind}
          onUse={() => applySuggestions(ai.suggestion)}
          onDismiss={() => setAiDismissed(true)}
        />
      ) : null}

      <div id="column-table" className="divide-y divide-line rounded-xl border border-line bg-paper">
        {fields.map((f) => {
          const det = detectedBy.get(f.key);
          const value = mapping[f.key];
          const required = f.required !== false;
          return (
            <div key={f.key} className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)] md:items-center">
              <div className="min-w-0">
                <label htmlFor={`map-${f.key}`} className="text-[13px] font-medium text-ink">
                  {f.label}{" "}
                  {required ? <Pill tone="info">{f.required === true ? "Required" : "One of these is required"}</Pill> : null}
                </label>
                {f.help ? <p className={HELP}>{f.help}</p> : null}
              </div>
              <div>
                <select
                  id={`map-${f.key}`}
                  value={value === null || value === undefined ? "" : String(value)}
                  onChange={(e) => choose(f.key, e.target.value)}
                  className={INPUT}
                >
                  <option value="">Not in my file</option>
                  {usable.map((c) => (
                    <option key={c.index} value={c.index}>
                      {c.header}
                      {c.samples[0] ? `  (${c.samples[0].slice(0, 24)})` : ""}
                    </option>
                  ))}
                </select>
                {value !== null && value !== undefined && det && det.index === value && !touched.has(f.key) ? (
                  <div className="mt-1">
                    <Pill tone={det.reason === "values" ? "warning" : "good"}>{det.reason === "values" ? "Guess" : "Matched by name"}</Pill>
                  </div>
                ) : null}
              </div>
              <p className="min-w-0 break-words text-[12px] text-mute">
                {sample(f.key).length ? sample(f.key).join(" · ") : <span className="text-mute-soft">No column chosen</span>}
              </p>
            </div>
          );
        })}
      </div>

      {hasDate ? (
        <div className="rounded-xl border border-line bg-paper px-4 py-3">
          <div className="grid gap-3 md:grid-cols-2 md:items-end">
            <div>
              <label htmlFor="date-format" className={`${HELP} !mt-0 text-ink`}>
                Dates look like
              </label>
              <select id="date-format" value={dateHint} onChange={(e) => setDateHint(e.target.value as DateHint)} className={INPUT}>
                {DATE_FORMATS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[12px] text-mute" aria-live="polite">
              {previewDates.length
                ? `Read as: ${previewDates.map((d) => d ?? "not a date").join(", ")}`
                : "No dates to show yet."}
            </p>
          </div>
        </div>
      ) : null}

      {kind === "units_owners" && mapping.ownership_percent !== null && mapping.ownership_percent !== undefined ? (
        <InfoNote>Ownership must cover every unit and add up to 100.</InfoNote>
      ) : null}

      <div className="space-y-2 rounded-xl border border-line bg-paper px-4 py-3">
        <p className="text-[13px] font-medium text-ink">Not imported:</p>
        {notImported.length ? (
          <ul className="flex flex-wrap gap-2">
            {notImported.map((c) => (
              <li key={c.index}>
                <Pill tone={c.sensitive ? "warning" : "neutral"}>{c.header}</Pill>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-mute">Every column is matched.</p>
        )}
        <p className="text-[12px] text-mute">These columns are left out and never stored.</p>
        {columns
          .filter((c) => c.sensitive)
          .map((c) => (
            <p key={c.index} className="text-[12px] text-warning-text">
              {c.header}: left out on purpose (looks like a tax ID or account number).
            </p>
          ))}
      </div>

      <label className="flex items-start gap-3 text-[13px] text-ink">
        <input type="checkbox" checked={keepCopy} onChange={(e) => setKeepCopy(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" />
        <span>
          Keep a copy of this file in Documents (board only)
          <span className={`${HELP} block`}>The copy would include columns Walkup doesn&rsquo;t import. Without it, the file is removed once your rows are loaded.</span>
        </span>
      </label>

      {error ? (
        <div className="space-y-2">
          <ErrorNote>{error.message}</ErrorNote>
          {error.earlier ? (
            <p className="text-[13px] text-ink">
              {error.earlier.on ? `You imported this file on ${new Date(error.earlier.on).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}. ` : null}
              <Link href={`/building/import/${error.earlier.batchId}?step=done`} className="font-medium underline underline-offset-2">
                See that import
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}
      {notes.length ? <InfoNote>{notes.join(" ")}</InfoNote> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={submit} disabled={pending || missing.length > 0} className={BTN_PRIMARY}>
          {pending ? "Loading your rows..." : "Continue"}
        </button>
        {missing.length > 0 ? <span className="text-[12px] text-mute">{missingRequiredSentence(missing)}</span> : null}
        {props.aiAvailable ? (
          <button type="button" onClick={askAi} disabled={aiBusy || pending} className={BTN_SECONDARY}>
            {aiBusy ? "Asking..." : "Suggest with AI"}
          </button>
        ) : (
          <span className="text-[12px] text-mute">AI help isn&rsquo;t available on this account. Match by hand.</span>
        )}
        <button type="button" onClick={cancel} disabled={pending} className={BTN_SECONDARY}>
          Cancel
        </button>
      </div>
      <p className="text-[12px] text-mute">{KIND_LABEL[kind]}</p>
    </div>
  );
}

function AiBanner({
  suggestion,
  sent,
  kind,
  onUse,
  onDismiss,
}: {
  suggestion: AiSuggestion[];
  sent: AiPreview;
  kind: ImportKind;
  onUse: () => void;
  onDismiss: () => void;
}) {
  const labels = new Map(FIELDS[kind].map((f) => [f.key, f.label]));
  return (
    <div className="space-y-3 border-l-[3px] border-info bg-info-tint px-4 py-3 text-[13px] text-info-text">
      <p>
        <strong className="font-bold">Suggested by AI.</strong> Check each one.
      </p>
      {suggestion.length ? (
        <ul className="list-disc pl-5">
          {suggestion.map((s) => (
            <li key={s.field}>
              {labels.get(s.field) ?? s.field}: {s.header} ({s.confidence})
            </li>
          ))}
        </ul>
      ) : (
        <p>It had nothing to add to what was already matched.</p>
      )}
      <div className="flex flex-wrap gap-2">
        {suggestion.length ? (
          <button type="button" onClick={onUse} className={BTN_PRIMARY}>
            Use these suggestions
          </button>
        ) : null}
        <button type="button" onClick={onDismiss} className={BTN_SECONDARY}>
          Dismiss
        </button>
      </div>
      <details className="text-[12px]">
        <summary className="cursor-pointer font-medium">What was sent</summary>
        <p className="mt-2">Only the column names and a mask of a few cells (letters shown as x, digits as 9). No values.</p>
        <p className="mt-2 font-medium">Column names</p>
        <ul className="list-disc pl-5">
          {sent.headers.map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ul>
        <p className="mt-2 font-medium">Masks</p>
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded bg-paper p-2 text-ink">
          {sent.masks.map((row) => row.join(" | ")).join("\n")}
        </pre>
      </details>
    </div>
  );
}
