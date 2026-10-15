"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IMPORT_KINDS, KIND_LABEL, type ImportKind } from "@/lib/import/kinds";
import { cancelImport, removeUnfinishedUpload } from "./actions";
import { BTN_PRIMARY, BTN_SECONDARY, ErrorNote, INPUT, Pill, longDate } from "./ui";

export interface UnfinishedBatch {
  id: string;
  kind: ImportKind;
  filename: string;
  when: string;
}
export interface UnfinishedUpload {
  documentId: string;
  filename: string;
  when: string;
}

export function Unfinished({ batches, uploads }: { batches: UnfinishedBatch[]; uploads: UnfinishedUpload[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [kinds, setKinds] = useState<Record<string, ImportKind>>({});
  const [pending, start] = useTransition();

  const remove = (fn: () => Promise<{ ok: true } | { error: string }>) =>
    start(async () => {
      const r = await fn();
      if ("error" in r) setError(r.error);
      else {
        setError(null);
        router.refresh();
      }
    });

  return (
    <div className="space-y-3">
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <ul className="divide-y divide-line">
        {batches.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink">
                {KIND_LABEL[b.kind]} <Pill tone="warning">Not finished</Pill>
              </p>
              <p className="mt-0.5 break-words text-[12px] text-mute">
                {b.filename} · {longDate(b.when)}
              </p>
            </div>
            <div className="flex gap-2">
              <Link href={`/building/import/${b.id}`} className={`${BTN_PRIMARY} !min-h-[36px] !px-3`}>
                Continue
              </Link>
              <button type="button" disabled={pending} onClick={() => remove(() => cancelImport(b.id))} className={`${BTN_SECONDARY} !min-h-[36px] !px-3`}>
                Remove
              </button>
            </div>
          </li>
        ))}
        {uploads.map((u) => {
          const kind = kinds[u.documentId] ?? "units_owners";
          return (
            <li key={u.documentId} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink">
                  Uploaded, not matched yet <Pill tone="warning">Not finished</Pill>
                </p>
                <p className="mt-0.5 break-words text-[12px] text-mute">
                  {u.filename} · {longDate(u.when)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor={`kind-${u.documentId}`}>
                  What is in this file
                </label>
                <select
                  id={`kind-${u.documentId}`}
                  value={kind}
                  onChange={(e) => setKinds((k) => ({ ...k, [u.documentId]: e.target.value as ImportKind }))}
                  className={`${INPUT} !w-auto`}
                >
                  {IMPORT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
                <Link href={`/building/import/new?kind=${kind}&doc=${u.documentId}`} className={`${BTN_PRIMARY} !min-h-[36px] !px-3`}>
                  Continue
                </Link>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => remove(() => removeUnfinishedUpload(u.documentId))}
                  className={`${BTN_SECONDARY} !min-h-[36px] !px-3`}
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
