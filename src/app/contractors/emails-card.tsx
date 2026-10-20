"use client";

import { useState } from "react";
import { ContractorDraft } from "@/components/repairs/contractor-draft";

export interface DraftRow {
  id: string;
  label: string;
  to: string[];
  subject: string;
  body: string;
}

/**
 * "Emails waiting to be sent" (repairs-spec §10.1 item 4, §10.2 item 8):
 * one row per draft with an Edit button that opens the foundation's DraftEmail
 * (edit, open in your email app, copy, mark as sent) with "Discard".
 */
export function DraftList({ drafts }: { drafts: DraftRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <ul className="divide-y divide-line">
      {drafts.map((d) => {
        const open = openId === d.id;
        return (
          <li key={d.id} className="py-1">
            <div className="flex min-h-[44px] items-center justify-between gap-3">
              <span className="min-w-0 text-[14px] text-ink">{d.label}</span>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`draft-${d.id}`}
                onClick={() => setOpenId(open ? null : d.id)}
                className="inline-flex min-h-[34px] shrink-0 items-center justify-center rounded-md bg-ink px-4 text-[12px] font-medium text-paper hover:bg-ink-mid focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass"
              >
                {open ? "Close" : "Edit"}
              </button>
            </div>
            {open ? (
              <div id={`draft-${d.id}`} className="pb-4">
                <ContractorDraft messageId={d.id} to={d.to} subject={d.subject} body={d.body} title={d.label} discardable />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
