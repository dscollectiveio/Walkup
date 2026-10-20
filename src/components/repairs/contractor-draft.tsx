"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DraftEmail } from "@/components/email/draft-email";
import { discardDraft, markMessageSent, updateDraft } from "@/app/contractors/actions";
import { errorClass } from "./styles";

/**
 * One stored email to a contractor, in the foundation's DraftEmail (brief
 * decision 8): edit, open in the board member's own mail app, mark as sent
 * with the text actually sent. DraftEmail asks "Did you send it?" when the
 * page becomes visible again after opening the mail app.
 */
export function ContractorDraft(props: {
  messageId: string;
  to: string[];
  subject: string;
  body: string;
  title?: string;
  note?: string;
  sentAt?: string | null;
  attachments?: { documentId: string; filename: string }[];
  /** Offer "Discard this draft" (drafts only). */
  discardable?: boolean;
  onSent?: () => void;
}) {
  const router = useRouter();
  const [discarded, setDiscarded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (discarded) return <p className="text-[13px] text-mute">Draft discarded.</p>;

  return (
    <div className="space-y-2">
      <DraftEmail
        to={props.to}
        subject={props.subject}
        body={props.body}
        title={props.title}
        note={props.note}
        sentAt={props.sentAt ?? null}
        attachments={props.attachments}
        onSave={async (d) => {
          const r = await updateDraft(props.messageId, { to: d.to, subject: d.subject, body: d.body });
          return "error" in r ? r : { ok: true as const };
        }}
        onMarkSent={async (final) => {
          const r = await markMessageSent(props.messageId, { to: final.to, subject: final.subject, body: final.body });
          if ("error" in r) return r;
          props.onSent?.();
          router.refresh();
          return { ok: true as const };
        }}
      />
      {props.discardable && !props.sentAt ? (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await discardDraft(props.messageId);
              if ("error" in r) setError(r.error);
              else {
                setDiscarded(true);
                router.refresh();
              }
            })
          }
          className="min-h-[44px] text-[13px] text-bad-text underline underline-offset-2 hover:brightness-75"
        >
          {pending ? "Discarding…" : "Discard this draft"}
        </button>
      ) : null}
      {error ? <p className={errorClass}>{error}</p> : null}
    </div>
  );
}
