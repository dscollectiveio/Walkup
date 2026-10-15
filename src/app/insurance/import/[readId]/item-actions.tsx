"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { retryInsuranceRead, skipReadItem, unskipReadItem } from "../../import-actions";
import { btnGhost, btnPrimary, errorBlock, inputClass, labelClass } from "../../components/styles";

/** The buttons on one found policy in a package (§9.3.3). */
export function ItemActions({
  readId,
  index,
  state,
  savedHref,
  reviewHref,
  updateOptions,
  isQuote,
}: {
  readId: string;
  index: number;
  state: "open" | "saved" | "skipped";
  savedHref: string | null;
  reviewHref: string;
  updateOptions: { id: string; label: string }[];
  isQuote: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [update, setUpdate] = useState("");

  const run = (fn: () => Promise<{ ok: true } | { error: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if ("error" in r) setError(r.error);
      else router.refresh();
    });

  if (state === "saved") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[13px] font-medium text-good-text">Saved</span>
        {savedHref ? (
          <Link href={savedHref} className={btnGhost}>
            {isQuote ? "Open quote" : "Open policy"}
          </Link>
        ) : null}
      </div>
    );
  }
  if (state === "skipped") {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[13px] text-mute">Skipped</span>
          <button type="button" className={btnGhost} disabled={pending} onClick={() => run(() => unskipReadItem(readId, index))}>
            {pending ? "Working…" : "Undo"}
          </button>
        </div>
        {error ? <p className={errorBlock}>{error}</p> : null}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Link href={reviewHref} className={btnPrimary}>
          Review and save
        </Link>
        <button type="button" className={btnGhost} disabled={pending} onClick={() => run(() => skipReadItem(readId, index))}>
          {pending ? "Working…" : "Skip"}
        </button>
      </div>
      {!isQuote && updateOptions.length > 0 ? (
        <details className="text-[13px]">
          <summary className="min-h-[44px] cursor-pointer py-2 text-ink underline underline-offset-2">Update an existing policy instead</summary>
          <div className="flex flex-wrap items-end gap-2 pb-2">
            <div className="min-w-[14rem] flex-1">
              <label htmlFor={`update-${index}`} className={labelClass}>
                Which policy
              </label>
              <select id={`update-${index}`} value={update} onChange={(e) => setUpdate(e.target.value)} className={inputClass}>
                <option value="">Choose…</option>
                {updateOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className={btnGhost}
              disabled={!update}
              onClick={() => router.push(`/insurance/import/${readId}/${index}?update=${update}`)}
            >
              Review the changes
            </button>
          </div>
        </details>
      ) : null}
      {error ? <p className={errorBlock}>{error}</p> : null}
    </div>
  );
}

/** "Try reading the file again" for an item whose details failed (§9.3.3). */
export function RereadButton({ readId }: { readId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className={btnGhost}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await retryInsuranceRead(readId);
            if ("error" in r) setError(r.error);
            else router.refresh();
          })
        }
      >
        {pending ? "Starting…" : "Try reading the file again"}
      </button>
      {error ? <p className={`${errorBlock} w-full`}>{error}</p> : null}
    </>
  );
}
