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
      <section className="rounded-xl border border-stone-200 bg-white">
        <header className="border-b border-stone-100 px-5 py-4">
          <h2 className="font-semibold tracking-tight">Write to a contractor</h2>
          <p className="mt-1 text-sm text-stone-500">
            Walkup writes the first draft. You read it, change anything you
            want, then send it from your own email.
          </p>
        </header>
        <form action={newAction} className="flex flex-wrap items-end gap-3 px-5 py-4">
          <div>
            <label htmlFor="vendor_id" className="block text-sm font-medium">
              Contractor
            </label>
            <select
              id="vendor_id"
              name="vendor_id"
              required
              className="mt-1 rounded border border-stone-300 bg-white px-3 py-2 text-sm"
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
            <label htmlFor="ticket_id" className="block text-sm font-medium">
              About which problem?
            </label>
            <select
              id="ticket_id"
              name="ticket_id"
              className="mt-1 rounded border border-stone-300 bg-white px-3 py-2 text-sm"
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
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
          >
            {newPending ? "Writing…" : "Write a draft"}
          </button>
          {newState?.error ? (
            <p className="w-full text-sm text-red-800">{newState.error}</p>
          ) : null}
        </form>
      </section>

      {live.length > 0 ? (
        <section className="rounded-xl border border-stone-200 bg-white">
          <header className="border-b border-stone-100 px-5 py-4">
            <h2 className="font-semibold tracking-tight">
              Waiting to be sent ({live.length})
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              Nothing here has been sent. Walkup never emails anyone on your
              behalf.
            </p>
          </header>
          <ul className="divide-y divide-stone-100">
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
            className="text-left font-medium underline-offset-2 hover:underline"
          >
            {subject}
          </button>
          <div className="mt-1 text-sm text-stone-500">
            To {draft.vendor_name}
            {draft.to_email ? ` · ${draft.to_email}` : " · no email on file"}
            {draft.ticket ? ` · about #${draft.ticket.reference}` : ""}
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs text-amber-800">
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
              className="w-full rounded border border-stone-300 px-3 py-2 text-sm"
            />
            <textarea
              name="body"
              rows={12}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full rounded border border-stone-300 px-3 py-2 font-mono text-xs leading-relaxed"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={savePending}
                className="rounded-lg border border-stone-300 px-4 py-2 text-sm hover:bg-stone-50 disabled:opacity-50"
              >
                {savePending ? "Saving…" : "Save changes"}
              </button>
              <a
                href={mailto}
                className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
              >
                Open in your email app
              </a>
            </div>
          </form>

          <form action={discardAction}>
            <input type="hidden" name="id" value={draft.id} />
            <button
              type="submit"
              className="text-sm text-stone-500 underline-offset-2 hover:underline"
            >
              Discard this draft
            </button>
          </form>
        </div>
      ) : null}
    </li>
  );
}
