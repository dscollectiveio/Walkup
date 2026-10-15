"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import { ContractorDraft } from "@/components/repairs/contractor-draft";
import { Pill } from "@/components/repairs/pills";
import { humanDate } from "@/lib/repairs/format";
import type { MessageView } from "./types";

/** Emails to contractors about this problem (repairs-spec §5.3 card 11). Drafts open in DraftEmail. */

export const MESSAGE_KIND_LABEL: Record<string, string> = {
  general: "Email",
  job: "Go-ahead",
  quote_request: "Quote request",
  w9_request: "W-9 request",
  coi_request: "Certificate request",
  paperwork_request: "Paperwork request",
};

export function MessagesCard({ messages, todayIso, canWrite }: { messages: MessageView[]; todayIso: string; canWrite: boolean }) {
  return (
    <Card title="Emails to contractors">
      {messages.length === 0 ? (
        <p className="text-[13px] text-mute">No emails for this problem yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {messages.map((m) => (
            <MessageRow key={m.id} m={m} todayIso={todayIso} canWrite={canWrite} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function MessageRow({ m, todayIso, canWrite }: { m: MessageView; todayIso: string; canWrite: boolean }) {
  const [open, setOpen] = useState(false);
  const draft = m.status === "draft" || m.status === "approved";
  const status =
    m.status === "sent" ? `Sent ${m.sentAt ? humanDate(m.sentAt.slice(0, 10), todayIso) : ""}`.trim() : m.status === "cancelled" ? "Discarded" : "Draft";
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-[14px] text-ink">
          <span className="font-medium">{MESSAGE_KIND_LABEL[m.kind] ?? "Email"}</span> to {m.vendorName}
          {m.toEmail ? <span className="text-mute"> ({m.toEmail})</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <Pill tone={draft ? "warning" : m.status === "sent" ? "good" : "outline"}>{status}</Pill>
          {draft && canWrite ? (
            <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="min-h-[44px] text-[13px] underline underline-offset-2">
              {open ? "Hide" : "Open"}
            </button>
          ) : null}
        </div>
      </div>
      {open && draft ? (
        <div className="mt-3">
          <ContractorDraft
            messageId={m.id}
            to={m.toEmail ? [m.toEmail] : []}
            subject={m.subject}
            body={m.body}
            title={`${MESSAGE_KIND_LABEL[m.kind] ?? "Email"} to ${m.vendorName}`}
            discardable
          />
        </div>
      ) : null}
    </li>
  );
}
