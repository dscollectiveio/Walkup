"use client";

import { useState, useTransition } from "react";
import { dateWords } from "@/lib/tax/copy";
import { verifyParameter } from "./actions";
import { btn, primary, smallBtn } from "./styles";

/** A tax_parameters row, already put into words by the server page (rules.ts). */
export interface ParameterRow {
  id: string;
  key: string;
  label: string;
  valueWords: string;
  effectiveWords: string;
  verifiedOn: string | null;
  sourceUrl: string | null;
  notes: string | null;
}

/**
 * Every rate and threshold Walkup computes with, each with its period, its
 * source and whether a person has checked it. "Mark checked today" is that
 * check — the one write to tax_parameters, through verify_tax_parameter().
 * Values are never edited here: a changed rule is a new row in a migration
 * (CLAUDE.md invariant 8), with its own source.
 */
export function ParametersPanel({ rows }: { rows: ParameterRow[] }) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const mark = (id: string) =>
    start(async () => {
      const r = await verifyParameter(id);
      setMsg("error" in r && r.error ? r.error : null);
      setConfirming(null);
    });

  return (
    <div className="text-[13px]">
      {rows.length === 0 ? <p className="py-2 text-mute">No rules on file.</p> : null}
      <ul className="divide-y divide-line">
        {rows.map((p) => (
          <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink">
                {p.label}: <span className="figures">{p.valueWords}</span>
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-mute">
                <span>{p.effectiveWords}</span>
                <span>·</span>
                {p.verifiedOn ? (
                  <span className="text-good-text">checked {dateWords(p.verifiedOn, "short")}</span>
                ) : (
                  <span className="font-medium text-warning-text">not yet checked</span>
                )}
                {p.sourceUrl ? (
                  <>
                    <span>·</span>
                    <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                      source ↗
                    </a>
                  </>
                ) : null}
                <span className="font-mono text-[11px] text-mute-soft">{p.key}</span>
              </p>
              {p.notes ? <p className="mt-1 text-[11px] text-mute-soft">{p.notes}</p> : null}
            </div>
            {confirming === p.id ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] text-ink">I read the source today and this figure is current for that period.</span>
                <button type="button" disabled={pending} onClick={() => mark(p.id)} className={primary}>
                  Mark checked today
                </button>
                <button type="button" onClick={() => setConfirming(null)} className={btn}>Cancel</button>
              </span>
            ) : (
              <button type="button" disabled={pending} onClick={() => setConfirming(p.id)} className={smallBtn}>
                Mark checked today…
              </button>
            )}
          </li>
        ))}
      </ul>
      {msg ? <p className="mt-2 text-[12px] text-bad-text">{msg}</p> : null}
    </div>
  );
}
