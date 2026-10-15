"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { btnPrimary, btnSecondary, errorClass } from "@/components/repairs/styles";
import { askBarState } from "@/lib/contractors/find-params";
import { saveCandidates } from "./actions";
import { useFind } from "./find-context";

/**
 * The bar that appears at the bottom of the find page once something is
 * ticked (repairs-spec §9.1 item 6). For a problem: save the ticked found
 * results (saved contractors pass through), then open "Get quotes" with
 * exactly those contractors ticked. Without a problem: save them.
 */
export function AskBar() {
  const router = useRouter();
  const { trade, ticket, saved, found, askFor, clear } = useFind();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<{ name: string; reason: string }[]>([]);
  const [done, setDone] = useState<string | null>(null);

  const n = (ticket ? saved.size : 0) + found.size;
  const state = askBarState(n, ticket !== null);

  function go() {
    setError(null);
    setSkipped([]);
    setDone(null);
    start(async () => {
      let vendorIds: string[] = [];
      if (found.size > 0) {
        const r = await saveCandidates([...found.keys()], trade);
        if ("error" in r) {
          setError(r.error);
          return;
        }
        vendorIds = r.vendorIds;
        setSkipped(r.skipped.map((s) => ({ name: s.name, reason: s.reason })));
      }
      if (ticket) {
        const ids = [...saved, ...vendorIds];
        if (ids.length > 0) askFor(ids);
        else setError("None of those could be saved, so there's no one to ask yet.");
      } else {
        setDone(vendorIds.length === 1 ? "Saved 1 contractor." : `Saved ${vendorIds.length} contractors.`);
        clear();
        router.refresh();
      }
    });
  }

  if (n === 0 && !done && skipped.length === 0) return null;

  return (
    <div className="sticky bottom-0 z-10 -mx-4 border-t border-line bg-paper px-4 py-3 sm:mx-0 sm:rounded-xl sm:border">
      {n > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[14px] font-medium text-ink" aria-live="polite">
            {n} selected
          </p>
          <div className="flex flex-1 flex-wrap justify-end gap-2 max-sm:[&>*]:flex-1">
            <button type="button" onClick={clear} disabled={pending} className={btnSecondary}>
              Clear
            </button>
            <button type="button" onClick={go} disabled={state.disabled || pending} className={btnPrimary}>
              {pending ? (ticket ? "Getting ready…" : "Saving…") : state.label}
            </button>
          </div>
        </div>
      ) : null}
      {state.note && n > 0 ? <p className={`mt-2 ${errorClass}`}>{state.note}</p> : null}
      {error ? <p className={`mt-2 ${errorClass}`}>{error}</p> : null}
      {done ? (
        <p role="status" className="text-[13px] text-good-text">
          {done}
        </p>
      ) : null}
      {skipped.length > 0 ? (
        <ul className="mt-2 space-y-1 text-[13px] text-mute">
          {skipped.map((s) => (
            <li key={s.name + s.reason}>
              Not saved: {s.name}. {s.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
