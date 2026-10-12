"use client";

import { useState, useTransition } from "react";
import { dateWords, NOTHING_SENT } from "@/lib/tax/copy";
import { markSentToAccountant } from "../../form-actions";

export interface SendPanelProps {
  formId: string;
  canEdit: boolean;
  locked: boolean;
  /** Step 1: the files to attach, in the order the draft names them. */
  downloads: { label: string; href: string; filename: string }[];
  /** The draft as the page rendered it (lib/tax/accountant-email); the snapshot stores exactly this. */
  draft: { subject: string; body: string; href: string; attachments: string[] };
  accountant: { firstName: string | null; email: string | null } | null;
  /** The last time this form went to the accountant, from tax_forms. */
  sent: { at: string; toFirstName: string | null; subject: string | null; attachments: string[] } | null;
}

const primary = "inline-flex min-h-[44px] items-center rounded-md bg-ink px-4 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50";
const secondary = "inline-flex min-h-[44px] items-center rounded-md border border-line-strong bg-paper px-4 text-[13px] font-medium text-ink hover:bg-fill disabled:opacity-50";

/** "Sent to Jane on April 2, 2026." — the day in the stored timestamp, read the way the rest of Walkup reads one. */
const sentWords = (at: string, firstName: string | null) => `Sent to ${firstName || "your accountant"} on ${dateWords(at.slice(0, 10))}.`;

/**
 * Three steps, because Walkup has no email service and a mailto: draft can't
 * carry attachments: download the files, open the draft in your own mail
 * app, then tell Walkup you sent it. Nothing here sends anything. The draft
 * is built by the page from the same context the form shows, so what the
 * accountant reads is what the board sees.
 */
export function SendPanel({ formId, canEdit, locked, downloads, draft, accountant, sent }: SendPanelProps) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // The record on file, then whatever "Mark as sent" just recorded.
  const [justSent, setJustSent] = useState<{ at: string; toFirstName: string | null } | null>(null);
  const latest = justSent ?? (sent ? { at: sent.at, toFirstName: sent.toFirstName } : null);

  const markSent = () =>
    start(async () => {
      setError(null);
      const r = await markSentToAccountant(formId, { subject: draft.subject, body: draft.body, attachments: draft.attachments });
      if ("error" in r && typeof r.error === "string") setError(r.error);
      else if ("sentAt" in r && typeof r.sentAt === "string") setJustSent({ at: r.sentAt, toFirstName: accountant?.firstName ?? null });
    });

  return (
    <section id="send" className="rounded-xl border border-line bg-paper">
      <header className="border-b border-line px-5 py-4">
        <h2 className="eyebrow text-mute">Send to your accountant</h2>
        <p className="mt-1.5 text-[13px] text-mute">
          Three steps: download the files, open the draft, then tell Walkup you sent it. Walkup never emails anyone for you.
        </p>
      </header>
      <div className="space-y-4 px-5 py-4 text-[13px]">
        {latest ? (
          <p className="text-good-text">
            {sentWords(latest.at, latest.toFirstName)}
            {!justSent && sent?.subject ? <span className="text-mute"> &ldquo;{sent.subject}&rdquo;</span> : null}
            {!justSent && sent && sent.attachments.length > 0 ? (
              <span className="text-mute"> Named as attached: {sent.attachments.join(", ")}.</span>
            ) : null}
          </p>
        ) : null}

        {accountant?.email ? (
          <p className="text-mute">
            Addressed to {accountant.firstName ?? "your accountant"} at {accountant.email}.
          </p>
        ) : (
          <p className="text-warning-text">
            <a href="/tax#accountant" className="underline underline-offset-2">Add your accountant on the Taxes tab</a> so the draft is addressed
            to them. The draft still opens — with no recipient.
          </p>
        )}

        <ol className="space-y-4">
          <li>
            <p className="font-medium text-ink">1. Download the files to attach</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {downloads.map((d) => (
                <a key={d.href} href={d.href} className={secondary} title={d.filename}>
                  {d.label}
                </a>
              ))}
            </div>
          </li>
          <li>
            <p className="font-medium text-ink">2. Open the email draft</p>
            <p className="mt-0.5 text-mute">Subject: {draft.subject}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <a href={draft.href} className={primary}>
                Open the email draft
              </a>
              <details className="text-[12px] text-mute">
                <summary className="cursor-pointer underline underline-offset-2">Read the draft first</summary>
                <pre className="mt-2 max-w-prose whitespace-pre-wrap rounded-lg border border-line bg-fill p-3 font-sans text-[12px] leading-relaxed text-ink">{draft.body}</pre>
              </details>
            </div>
          </li>
          <li>
            <p className="font-medium text-ink">3. Tell Walkup it went</p>
            {canEdit && !locked ? (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button type="button" disabled={pending} onClick={markSent} className={secondary}>
                  {pending ? "Recording…" : latest ? "Mark as sent again" : "Mark as sent"}
                </button>
                <span className="text-[12px] text-mute">Records the date and what the draft said, for the board and the next board.</span>
              </div>
            ) : (
              <p className="mt-0.5 text-mute">{locked ? "This form is filed." : "A board member marks it sent."}</p>
            )}
            {error ? <p className="mt-1 text-[12px] text-bad-text">{error}</p> : null}
          </li>
        </ol>

        <p className="text-[11px] text-mute">{NOTHING_SENT}</p>
      </div>
    </section>
  );
}
