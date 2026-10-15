"use client";

import { useEffect, useState } from "react";
import { Empty } from "@/components/ui";
import { MessageSheet, type SheetMessage } from "../components/message-sheet";
import { MESSAGE_KIND_LABEL, messageStatusText } from "../quote-helpers";

/**
 * The Emails card's list (§9.7 item 4): filter pills, one row per email,
 * and the message sheet. `openId` (from ?open=) opens one on arrival, e.g.
 * the first draft after "Prepare emails".
 */

type Filter = "all" | "drafts" | "sent";

/** "Open draft" on a request row opens the email here (the two lists are separate cards). */
export const OPEN_MESSAGE_EVENT = "walkup:insurance-open-message";

export function openMessage(id: string) {
  window.dispatchEvent(new CustomEvent<string>(OPEN_MESSAGE_EVENT, { detail: id }));
}

export interface ListMessage extends SheetMessage {
  created_at: string;
}

export function MessageList({
  messages,
  canEdit,
  todayIso,
  openId,
}: {
  messages: ListMessage[];
  canEdit: boolean;
  todayIso: string;
  openId: string | null;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(openId);
  const [seenOpenId, setSeenOpenId] = useState(openId);
  // A new ?open= (a link on the same page, like "Open draft") opens that email.
  if (seenOpenId !== openId) {
    setSeenOpenId(openId);
    setOpen(openId);
  }

  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (typeof id === "string") setOpen(id);
    };
    window.addEventListener(OPEN_MESSAGE_EVENT, on);
    return () => window.removeEventListener(OPEN_MESSAGE_EVENT, on);
  }, []);

  const shown = messages.filter((m) => (filter === "drafts" ? m.status === "draft" : filter === "sent" ? m.status === "sent" : true));
  const current = messages.find((m) => m.id === open) ?? null;
  const pill = (f: Filter, label: string) => (
    <button
      type="button"
      aria-pressed={filter === f}
      onClick={() => setFilter(f)}
      className={`inline-flex min-h-[44px] items-center rounded-full px-4 text-[13px] font-medium ${filter === f ? "bg-ink text-paper" : "text-mute hover:text-ink"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-full border border-line bg-paper p-0.5" role="group" aria-label="Show emails">
        {pill("all", "All")}
        {pill("drafts", "Drafts")}
        {pill("sent", "Sent")}
      </div>
      {shown.length === 0 ? (
        <Empty>{messages.length === 0 ? "No emails yet." : filter === "drafts" ? "No drafts." : "Nothing sent yet."}</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => setOpen(m.id)}
                className="flex min-h-[56px] w-full items-start justify-between gap-3 py-3 text-left hover:bg-fill/60 sm:px-1"
              >
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-ink">
                    {MESSAGE_KIND_LABEL[m.kind] ?? "Email"}
                    {m.contactName ? <span className="font-normal text-mute"> · {m.contactName}</span> : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] text-mute">{m.subject || "No subject yet"}</span>
                </span>
                <span className={`shrink-0 text-[12px] ${m.status === "draft" ? "font-medium text-ink" : "text-mute"}`}>
                  {messageStatusText(m.status, m.sent_at, todayIso)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <MessageSheet message={current} canEdit={canEdit} onClose={() => setOpen(null)} />
    </div>
  );
}
