"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AiWritten } from "@/components/ai/ai-written";
import { DraftEmail } from "@/components/email/draft-email";
import { cancelMessage, markMessageSent, updateMessage } from "../message-actions";
import { MESSAGE_KIND_LABEL, draftedByLine } from "../quote-helpers";
import { Sheet } from "./sheet";
import { btnGhost, errorBlock, infoBlock } from "./styles";

/**
 * One insurance email (§9.7 item 4): the shared DraftEmail, editable while it
 * is a draft. Walkup never sends it: the board opens it in its own mail app
 * and marks it sent. Sent and cancelled emails open read-only (the database
 * refuses edits to them anyway).
 */

export interface SheetMessage {
  id: string;
  kind: string;
  contactName: string | null;
  to_email: string | null;
  subject: string;
  body: string;
  status: string;
  drafted_by: string;
  sent_at: string | null;
}

type Final = { to: string[]; subject: string; body: string };

export function MessageBody({
  message,
  canEdit,
  notice,
  onDone,
}: {
  message: SheetMessage;
  canEdit: boolean;
  /** "Written from Walkup's template." and the like, after composing. */
  notice?: string | null;
  /** After the draft is cancelled. */
  onDone?: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const draft = message.status === "draft";
  const editable = canEdit && draft;

  async function save(final: Final): Promise<{ ok: true } | { error: string }> {
    const to = final.to[0]?.trim();
    if (!to) return { error: "Add the email address to send it to." };
    return updateMessage(message.id, { subject: final.subject, body: final.body, toEmail: to });
  }

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-mute">
        {MESSAGE_KIND_LABEL[message.kind] ?? "Email"}
        {message.contactName ? ` to ${message.contactName}` : ""} · {draftedByLine(message.drafted_by)}
      </p>
      {notice ? <p className={infoBlock}>{notice}</p> : null}
      {message.drafted_by === "model" && draft ? <AiWritten variant="draft" /> : null}
      <DraftEmail
        to={message.to_email ? [message.to_email] : []}
        subject={message.subject}
        body={message.body}
        editable={editable}
        sentAt={message.sent_at}
        onSave={editable ? save : undefined}
        onMarkSent={
          editable
            ? async (final) => {
                const saved = await save(final);
                if ("error" in saved) return saved;
                const r = await markMessageSent(message.id);
                if ("ok" in r) router.refresh();
                return r;
              }
            : undefined
        }
      />
      {message.status === "cancelled" ? <p className="text-[13px] text-mute">This draft was cancelled.</p> : null}
      {editable ? (
        <div className="space-y-2">
          {error ? <p className={errorBlock}>{error}</p> : null}
          <button
            type="button"
            className={btnGhost}
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await cancelMessage(message.id);
                if ("error" in r) setError(r.error);
                else {
                  router.refresh();
                  onDone?.();
                }
              })
            }
          >
            {pending ? "Cancelling…" : "Cancel this draft"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** The message in a sheet (full screen on phones), with a close button. */
export function MessageSheet({
  message,
  canEdit,
  onClose,
}: {
  message: SheetMessage | null;
  canEdit: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={message !== null} onClose={onClose} label={message ? `${MESSAGE_KIND_LABEL[message.kind] ?? "Email"}: ${message.subject || "no subject"}` : "Email"} wide>
      {message ? (
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
            <h2 className="min-w-0 truncate text-[15px] font-bold tracking-tight text-ink">{message.subject || "No subject yet"}</h2>
            <button type="button" className={btnGhost} onClick={onClose}>
              Close
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <MessageBody message={message} canEdit={canEdit} onDone={onClose} />
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}
