"use client";

import { useActionState, useState } from "react";
import { discardDraft, draftMessage, updateDraft } from "./actions";

interface Draft {
  id: string;
  subject: string;
  body: string;
  status: string;
  to_email: string | null;
  vendor_name: string;
  ticket: { reference: number; title: string } | null;
}

/**
 * Drafts, not sending.
 *
 * "Open in your email app" builds a mailto: link rather than sending from a
 * server. That is a deliberate choice for this product: the message leaves
 * from the board's own mailbox, so the contractor's reply goes back to a human
 * who can act on it, and the association keeps its correspondence where it
 * already lives. It also means Walkup never needs to be trusted with sending
 * on the association's behalf.
 */
export function DraftPanel({
  vendors,
  tickets,
  drafts,
}: {
  vendors: { id: string; name: string; email: string | null }[];
  tickets: { id: string; reference: number; title: string }[];
  drafts: Draft[];
}) {
  const [newState, newAction, newPending] = useActionState(draftMessage, null);
  const live = drafts.filter((d) => d.status !== "cancelled" && d.status !== "sent");

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-line bg-paper">
        <header className="border-b border-line px-5 py-4">
          <h2 className="font-semibold tracking-tight text-ink">Write to a contractor</h2>
          <p className="mt-1 text-[13px] text-mute">
            Walkup writes the first draft. You read it, change anything you
            want, then send it from your own email.
          </p>
        </header>
        <form action={newAction} className="flex flex-wrap items-end gap-3 px-5 py-4">
          <div>
            <label htmlFor="vendor_id" className="block text-[12px] font-medium text-ink">
              Contractor
            </label>
            <select
              id="vendor_id"
              name="vendor_id"
              required
              className="mt-1 rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink"
            >
              <option value="">Choose…</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ticket_id" className="block text-[12px] font-medium text-ink">
              About which problem?
            </label>
            <select
              id="ticket_id"
              name="ticket_id"
              className="mt-1 rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink"
            >
              <option value="">Nothing specific</option>
              {tickets.map((t) => (
                <option key={t.id} value={t.id}>
                  #{t.reference} {t.title}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={newPending}
            className="rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
          >
            {newPending ? "Writing…" : "Write a draft"}
          </button>
          {newState?.error ? (
            <p className="w-full text-[13px] text-bad-text">{newState.error}</p>
          ) : null}
        </form>
      </section>

      {live.length > 0 ? (
        <section className="rounded-xl border border-line bg-paper">
          <header className="border-b border-line px-5 py-4">
            <h2 className="font-semibold tracking-tight text-ink">
              Waiting to be sent ({live.length})
            </h2>
            <p className="mt-1 text-[13px] text-mute">
              Nothing here has been sent. Walkup never emails anyone on your
              behalf.
            </p>
          </header>
          <ul className="divide-y divide-line">
            {live.map((d) => (
              <DraftRow key={d.id} draft={d} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function DraftRow({ draft }: { draft: Draft }) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [, saveAction, savePending] = useActionState(updateDraft, null);
  const [, discardAction] = useActionState(discardDraft, null);

  const mailto = `mailto:${encodeURIComponent(draft.to_email ?? "")}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            onClick={() => setOpen(!open)}
            className="text-left font-medium text-ink underline-offset-2 hover:underline"
          >
            {subject}
          </button>
          <div className="mt-1 text-[13px] text-mute">
            To {draft.vendor_name}
            {draft.to_email ? ` · ${draft.to_email}` : " · no email on file"}
            {draft.ticket ? ` · about #${draft.ticket.reference}` : ""}
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-warning-line bg-warning-tint px-2.5 py-0.5 text-[11px] text-warning-text">
          not sent
        </span>
      </div>

      {open ? (
        <div className="mt-4 space-y-3">
          <form action={saveAction} className="space-y-3">
            <input type="hidden" name="id" value={draft.id} />
            <input
              name="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
            />
            <textarea
              name="body"
              rows={12}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full rounded-lg border border-line-strong px-3 py-2 font-mono text-[11px] leading-relaxed text-ink"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={savePending}
                className="rounded-md border border-line-strong px-4 py-2 text-[13px] text-ink hover:bg-fill disabled:opacity-50"
              >
                {savePending ? "Saving…" : "Save changes"}
              </button>
              <a
                href={mailto}
                className="rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid"
              >
                Open in your email app
              </a>
            </div>
          </form>

          <form action={discardAction}>
            <input type="hidden" name="id" value={draft.id} />
            <button
              type="submit"
              className="text-[13px] text-mute underline-offset-2 hover:underline"
            >
              Discard this draft
            </button>
          </form>
        </div>
      ) : null}
    </li>
  );
}
