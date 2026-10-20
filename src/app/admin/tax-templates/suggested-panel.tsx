"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { applySuggestedTemplate } from "./actions";
import { primary, smallBtn } from "./styles";

/** One of Walkup's suggested templates, with the template it became if an admin already set it up. */
export interface SuggestionRow {
  key: string;
  label: string;
  taxYear: number;
  kind: "pdf" | "link_only";
  revision: string;
  sourceUrl: string;
  notes: string | null;
  authoredOn: string;
  installed: { id: string; active: boolean; verified: boolean; mapped: number } | null;
}

/**
 * One row per suggestion. "Set up" fetches the pinned PDF (or writes the
 * link-only rules), applies the map only if the file is the one it was
 * authored against, and lands on the detail page — inactive. The person
 * still opens the preview and clicks Verify and activate there.
 */
export function SuggestedPanel({ rows }: { rows: SuggestionRow[] }) {
  const [pending, start] = useTransition();
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setUp = (key: string) => {
    setRunning(key);
    setError(null);
    start(async () => {
      // The action redirects to the new template on success; only a refusal comes back.
      const r = await applySuggestedTemplate(key);
      if (r && "error" in r) setError(r.error);
      setRunning(null);
    });
  };
  const todo = rows.filter((r) => !r.installed);
  const done = rows.filter((r) => r.installed);

  return (
    <div className="space-y-4 text-[13px]">
      {todo.length === 0 ? (
        <p className="py-2 text-mute">Every suggestion is set up. Open each template below to check it and activate it.</p>
      ) : (
        <ul className="divide-y divide-line">
          {todo.map((r) => (
            <li key={r.key} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">
                  {r.label} · {r.taxYear}
                  <span className="ml-2 rounded-full border border-line bg-fill px-2 py-0.5 text-[11px] font-normal text-mute">
                    {r.kind === "pdf" ? "PDF + field map" : "Link only: rules, no PDF"}
                  </span>
                </p>
                <p className="mt-0.5 text-[12px] text-mute">
                  {r.revision} · authored {r.authoredOn} against{" "}
                  <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{r.sourceUrl}</a>
                </p>
                {r.notes ? <p className="mt-1 text-[12px] text-mute-soft">{r.notes}</p> : null}
              </div>
              <button type="button" disabled={pending} onClick={() => setUp(r.key)} className={primary}>
                {pending && running === r.key ? "Setting up…" : `Set up ${r.label} · ${r.taxYear}`}
              </button>
            </li>
          ))}
        </ul>
      )}
      {done.length > 0 ? (
        <div className="border-t border-line pt-3">
          <p className="text-[12px] text-mute">Already set up from a suggestion:</p>
          <ul className="mt-1 space-y-1 text-[12px]">
            {done.map((r) => {
              const t = r.installed!;
              const state = t.active ? "active" : t.verified ? "verified, inactive" : t.mapped > 0 || r.kind === "link_only" ? "not verified" : "map not applied, see its note";
              return (
                <li key={r.key} className="flex flex-wrap items-center gap-2">
                  <Link href={`/admin/tax-templates/${t.id}`} className="font-medium text-ink underline-offset-2 hover:underline">
                    {r.label} · {r.taxYear}
                  </Link>
                  <span className="text-mute">({state})</span>
                  {!t.active ? (
                    <button type="button" disabled={pending} onClick={() => setUp(r.key)} className={smallBtn}>
                      {pending && running === r.key ? "Running…" : "Run the suggestion again"}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {error ? <p className="text-[12px] text-bad-text">{error}</p> : null}
    </div>
  );
}
