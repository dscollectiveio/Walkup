"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { leaveOut, saveDraftNote } from "@/app/dues/email-actions";
import { NOTE_MAX } from "@/lib/email-outbox/actions-core";

export interface DraftView {
  id: string;
  name: string;
  email: string;
  units: string;
  subject: string;
  preview: string;
  note: string;
  previewError: boolean;
}

const btnGhost =
  "inline-flex min-h-[44px] items-center justify-center rounded-md border border-line-strong bg-paper px-3 py-2 text-[13px] font-medium text-ink hover:bg-fill disabled:opacity-50 sm:min-h-0";

function Draft({ d, editable }: { d: DraftView; editable: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState(d.note);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      const res = await saveDraftNote(d.id, note);
      if ("error" in res) setMsg({ text: res.error, bad: true });
      else {
        setMsg({ text: "Saved." });
        router.refresh();
      }
    });
  const remove = () =>
    start(async () => {
      const res = await leaveOut(d.id);
      if ("error" in res) setMsg({ text: res.error, bad: true });
      else router.refresh();
    });

  const noteId = `note-${d.id}`;
  return (
    <li className="rounded-xl border border-line bg-paper p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <div className="font-medium text-ink">{d.name}</div>
          <div className="break-all text-[12px] text-mute">{d.email}</div>
        </div>
        <div className="text-[12px] text-mute">{d.units}</div>
      </div>
      <p className="mt-2 text-[13px] text-ink">
        <span className="text-mute">Subject: </span>
        {d.subject}
      </p>
      <details className="mt-2" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer text-[13px] text-mute hover:text-ink">Preview</summary>
        {d.previewError ? (
          <p className="mt-2 text-[13px] text-bad-text">This email can&apos;t be previewed. Leave this person out and write to them yourself.</p>
        ) : (
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-fill p-3 font-mono text-[12px] leading-relaxed text-ink">{d.preview}</pre>
        )}
      </details>
      {editable ? (
        <div className="mt-3 space-y-2">
          <label htmlFor={noteId} className="block text-[12px] font-medium text-ink">
            Add a note
          </label>
          <textarea
            id={noteId}
            value={note}
            maxLength={NOTE_MAX}
            rows={2}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[16px] text-ink sm:text-[14px]"
            aria-describedby={`${noteId}-help`}
          />
          <p id={`${noteId}-help`} className="text-[12px] text-mute">
            Shown in the email. No links or email addresses. {note.length} of {NOTE_MAX}.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={btnGhost} disabled={pending || note === d.note} onClick={save}>
              Save note
            </button>
            <button type="button" className={btnGhost} disabled={pending} onClick={remove}>
              Leave out
            </button>
            <span aria-live="polite" className={`text-[12px] ${msg?.bad ? "text-bad-text" : "text-good-text"}`}>
              {msg?.text}
            </span>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function ReviewList({ drafts, editable }: { drafts: DraftView[]; editable: boolean }) {
  return (
    <ul className="space-y-3">
      {drafts.map((d) => (
        <Draft key={d.id} d={d} editable={editable} />
      ))}
    </ul>
  );
}
