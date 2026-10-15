"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
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
 * one collapsed row per draft that opens into the foundation's DraftEmail
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
            <button
              type="button"
              aria-expanded={open}
              aria-controls={`draft-${d.id}`}
              onClick={() => setOpenId(open ? null : d.id)}
              className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left text-[14px] text-ink"
            >
              <span className="min-w-0">{d.label}</span>
              <ChevronDown size={16} aria-hidden="true" className={`shrink-0 text-mute transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
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
