"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { btnDanger, btnPrimary, btnSecondary, errorClass, labelClass, textareaClass } from "@/components/repairs/styles";
import { humanDate } from "@/lib/repairs/format";
import { addContractorNote, deleteContractorNote, editContractorNote, updateVendorNotes } from "../vendor-actions";

export interface NoteView {
  id: string;
  body: string;
  author: string;
  createdAt: string;
  edited: boolean;
  mine: boolean;
}

/**
 * Notes (repairs-spec §10.2 item 7): the one-paragraph summary for the next
 * board, and a dated log with who wrote each line. Authors edit their own;
 * only a board admin deletes. Board only (RLS).
 */
export function NotesLog(props: { vendorId: string; summary: string | null; notes: NoteView[]; canEdit: boolean; isAdmin: boolean; todayIso: string }) {
  const router = useRouter();
  const fid = useId();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-6">
      <Summary vendorId={props.vendorId} summary={props.summary} canEdit={props.canEdit} />

      <div className="space-y-3">
        <h3 className="text-[13px] font-medium text-ink">Notes log</h3>
        {props.notes.length === 0 ? (
          <p className="text-[13px] text-mute">No notes yet.</p>
        ) : (
          <ol className="space-y-3">
            {props.notes.map((n) => (
              <NoteItem key={n.id} n={n} canEditThis={props.canEdit && n.mine} canDelete={props.isAdmin} todayIso={props.todayIso} />
            ))}
          </ol>
        )}
        {props.canEdit ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                setError(null);
                const r = await addContractorNote(props.vendorId, draft);
                if ("error" in r) setError(r.error);
                else {
                  setDraft("");
                  router.refresh();
                }
              });
            }}
          >
            <label htmlFor={`${fid}-add`} className={labelClass}>
              Add a note
            </label>
            <textarea
              id={`${fid}-add`}
              rows={2}
              value={draft}
              maxLength={4000}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Called Tuesday, quoted $400 by phone for the gutters."
              className={textareaClass}
            />
            <button type="submit" disabled={pending || !draft.trim()} className={btnSecondary}>
              {pending ? "Saving…" : "Add note"}
            </button>
            {error ? <p className={errorClass}>{error}</p> : null}
          </form>
        ) : null}
      </div>
    </div>
  );
}

function Summary({ vendorId, summary, canEdit }: { vendorId: string; summary: string | null; canEdit: boolean }) {
  const router = useRouter();
  const fid = useId();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(summary ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  if (editing) {
    return (
      <div className="space-y-2">
        <label htmlFor={`${fid}-summary`} className={labelClass}>
          Summary for the next board
        </label>
        <textarea id={`${fid}-summary`} rows={4} value={value} onChange={(e) => setValue(e.target.value)} className={textareaClass} />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            className={btnPrimary}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await updateVendorNotes(vendorId, value);
                if ("error" in r) setError(r.error);
                else {
                  setEditing(false);
                  setSaved(true);
                  router.refresh();
                }
              })
            }
          >
            {pending ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => setEditing(false)} className={btnSecondary}>
            Cancel
          </button>
        </div>
        {error ? <p className={errorClass}>{error}</p> : null}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <h3 className="text-[13px] font-medium text-ink">Summary for the next board</h3>
      {summary ? <p className="whitespace-pre-wrap text-[13px] text-ink">{summary}</p> : <p className="text-[13px] text-mute">No summary yet.</p>}
      {saved ? (
        <p role="status" className="text-[13px] text-good-text">
          Saved.
        </p>
      ) : null}
      {canEdit ? (
        <button
          type="button"
          onClick={() => {
            setValue(summary ?? "");
            setSaved(false);
            setEditing(true);
          }}
          className={btnSecondary}
        >
          {summary ? "Edit summary" : "Write a summary"}
        </button>
      ) : null}
    </div>
  );
}

function NoteItem(props: { n: NoteView; canEditThis: boolean; canDelete: boolean; todayIso: string }) {
  const router = useRouter();
  const fid = useId();
  const { n } = props;
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [value, setValue] = useState(n.body);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <li className="border-l-2 border-line pl-3 text-[13px]">
      {editing ? (
        <div className="space-y-2">
          <label htmlFor={`${fid}-edit`} className="sr-only">
            Edit note
          </label>
          <textarea id={`${fid}-edit`} rows={2} value={value} maxLength={4000} onChange={(e) => setValue(e.target.value)} className={textareaClass} />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              className={btnPrimary}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const r = await editContractorNote(n.id, value);
                  if ("error" in r) setError(r.error);
                  else {
                    setEditing(false);
                    router.refresh();
                  }
                })
              }
            >
              {pending ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className={btnSecondary}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-ink">{n.body}</p>
      )}
      <p className="mt-1 text-[12px] text-mute">
        {n.author} · {humanDate(n.createdAt.slice(0, 10), props.todayIso)}
        {n.edited ? " · edited" : ""}
      </p>
      {!editing && (props.canEditThis || props.canDelete) ? (
        <div className="flex flex-wrap gap-3">
          {props.canEditThis ? (
            <button
              type="button"
              onClick={() => {
                setValue(n.body);
                setEditing(true);
              }}
              className="inline-flex min-h-[44px] items-center text-[13px] text-ink underline underline-offset-2"
            >
              Edit
            </button>
          ) : null}
          {props.canDelete && !confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="inline-flex min-h-[44px] items-center text-[13px] text-bad-text underline underline-offset-2"
            >
              Delete
            </button>
          ) : null}
        </div>
      ) : null}
      {confirming ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-bad-text">Delete this note? This can&rsquo;t be undone.</span>
          <button
            type="button"
            disabled={pending}
            className={btnDanger}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await deleteContractorNote(n.id);
                if ("error" in r) setError(r.error);
                else router.refresh();
              })
            }
          >
            {pending ? "Deleting…" : "Delete"}
          </button>
          <button type="button" onClick={() => setConfirming(false)} className={btnSecondary}>
            Keep it
          </button>
        </div>
      ) : null}
      {error ? <p className={errorClass}>{error}</p> : null}
    </li>
  );
}
