"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { btnSecondary } from "@/components/repairs/styles";
import { markOwnerDocumentsSeen } from "./notice-actions";
import { NEW_FROM_OWNERS_COPY, noticeLine } from "@/lib/owner/unit-documents";

export interface OwnerDocumentNotice {
  noticeId: string;
  documentId: string;
  title: string;
  kind: string | null;
  unitLabel: string;
  uploadedByName: string | null;
  dateText: string;
}

/** The board's in-app list of what owners added for their units. Nothing is emailed. */
export function NewFromOwners({ notices }: { notices: OwnerDocumentNotice[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (notices.length === 0) return null;

  return (
    <section aria-label={NEW_FROM_OWNERS_COPY.title} className="rounded-xl border border-line bg-paper">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3">
        <div className="min-w-0">
          <h2 className="eyebrow text-mute">
            {NEW_FROM_OWNERS_COPY.title} <span className="font-normal">({notices.length})</span>
          </h2>
          <p className="mt-1 text-[13px] text-mute">{NEW_FROM_OWNERS_COPY.hint}</p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const r = await markOwnerDocumentsSeen();
              if ("error" in r) setError(r.error);
            })
          }
          className={btnSecondary}
        >
          {NEW_FROM_OWNERS_COPY.markSeen}
        </button>
      </header>
      <ul className="divide-y divide-line px-5">
        {notices.map((n) => (
          <li key={n.noticeId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5">
            <div className="min-w-0">
              <Link href={`/documents/${n.documentId}`} className="break-words text-[14px] text-ink underline-offset-2 hover:underline">
                {n.title}
              </Link>
              <p className="text-[12px] text-mute">
                {noticeLine({ unitLabel: n.unitLabel, uploadedByName: n.uploadedByName, kind: n.kind, title: n.title })}
              </p>
            </div>
            <span className="shrink-0 text-[12px] text-mute">{n.dateText}</span>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="px-5 pb-3 text-[13px] text-bad-text">
          {error}
        </p>
      ) : null}
    </section>
  );
}
