"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addComment, deleteComment, editComment } from "@/app/maintenance/actions";
import { Card } from "@/components/ui";
import { Pill } from "@/components/repairs/pills";
import { QuickReview } from "@/components/repairs/quick-review";
import { btnDanger, btnPrimary, btnSecondary, choiceRow, errorClass, labelClass, textareaClass } from "@/components/repairs/styles";
import { humanDate } from "@/lib/repairs/format";
import type { TimelineEntry } from "./types";

/**
 * The timeline (repairs-spec §5.3 card 8, §14.2 "Updates"): what happened
 * and the notes, merged by time, oldest first so it reads like a
 * conversation. Events come from triggers; owners see roles, not names.
 */

export const PREFILL_NOTE_EVENT = "walkup:prefill-note";

const TIME = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });

/** "Thu, Oct 22 3:05 PM" in the building's zone. */
export function whenText(iso: string, todayIso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${humanDate(DAY.format(d), todayIso)} ${TIME.format(d)}`;
}

export function Timeline(props: {
  ticketId: string;
  entries: TimelineEntry[];
  todayIso: string;
  title: string;
  /** May add notes (board and owners; not the accountant). */
  canNote: boolean;
  isBoard: boolean;
  isAdmin: boolean;
  /** The ticket's contractor, for "Turn into a review". */
  contractor: { id: string; name: string } | null;
}) {
  return (
    <Card navy title={props.title}>
      <div className="space-y-5">
        {props.entries.length === 0 ? (
          <p className="text-[13px] text-mute">Nothing yet.</p>
        ) : (
          <ol className="space-y-3">
            {props.entries.map((e) =>
              e.type === "event" ? (
                <li key={`e-${e.id}`} className="text-[13px] text-mute">
                  <span className="text-ink">{e.sentence}</span> <span className="whitespace-nowrap text-[11px]">{whenText(e.at, props.todayIso)}</span>
                </li>
              ) : (
                <Note key={`n-${e.id}`} note={e} {...props} />
              ),
            )}
          </ol>
        )}
        {props.canNote ? <NoteForm ticketId={props.ticketId} isBoard={props.isBoard} /> : null}
      </div>
    </Card>
  );
}

function Note({
  note,
  todayIso,
  isBoard,
  isAdmin,
  contractor,
  ticketId,
}: {
  note: Extract<TimelineEntry, { type: "note" }>;
  todayIso: string;
  isBoard: boolean;
  isAdmin: boolean;
  contractor: { id: string; name: string } | null;
  ticketId: string;
}) {
  const router = useRouter();
  const editId = useId();
  const [mode, setMode] = useState<"view" | "edit" | "delete" | "review">("view");
  const [body, setBody] = useState(note.body);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const act = (fn: () => Promise<{ ok: true } | { error: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if ("error" in r) setError(r.error);
      else {
        setMode("view");
        router.refresh();
      }
    });

  const kindLabel = note.kind === "me_too" ? "Seeing this too" : note.kind === "visit_feedback" ? "How the visit went" : null;

  return (
    <li className={`border-l-2 pl-3 ${note.internal ? "border-warning" : "border-line-strong"}`}>
      {mode === "edit" ? (
        <div className="space-y-2">
          <label htmlFor={editId} className="sr-only">
            Edit note
          </label>
          <textarea id={editId} rows={3} value={body} onChange={(e) => setBody(e.target.value)} className={textareaClass} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} disabled={pending} onClick={() => act(() => editComment(note.id, body))}>
              {pending ? "Saving…" : "Save"}
            </button>
            <button type="button" className={btnSecondary} onClick={() => setMode("view")}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{note.body}</p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-mute">
        <span>
          {note.author} · {whenText(note.at, todayIso)}
        </span>
        {note.internal ? <Pill tone="warning">Internal</Pill> : null}
        {kindLabel ? <Pill tone="outline">{kindLabel}</Pill> : null}
        {note.edited ? <span>edited</span> : null}
        {mode === "view" && note.mine ? (
          <button type="button" onClick={() => setMode("edit")} className="min-h-[44px] underline underline-offset-2 hover:text-ink">
            Edit
          </button>
        ) : null}
        {mode === "view" && isAdmin ? (
          <button type="button" onClick={() => setMode("delete")} className="min-h-[44px] underline underline-offset-2 hover:text-ink">
            Delete
          </button>
        ) : null}
        {mode === "view" && isBoard && note.kind === "visit_feedback" && contractor ? (
          <button type="button" onClick={() => setMode("review")} className="min-h-[44px] underline underline-offset-2 hover:text-ink">
            Turn into a review
          </button>
        ) : null}
      </div>
      {mode === "delete" ? (
        <div className="mt-2 space-y-2 rounded-md border border-line p-3">
          <p className="text-[13px] text-ink">Delete this note? This can&rsquo;t be undone.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnDanger} disabled={pending} onClick={() => act(() => deleteComment(note.id))}>
              {pending ? "Deleting…" : "Delete"}
            </button>
            <button type="button" className={btnSecondary} onClick={() => setMode("view")}>
              Keep it
            </button>
          </div>
        </div>
      ) : null}
      {mode === "review" && contractor ? (
        <div className="mt-2 rounded-md border border-line p-3">
          <QuickReview
            vendorId={contractor.id}
            vendorName={contractor.name}
            ticketId={ticketId}
            initialBody={note.body}
            skipLabel="Cancel"
            onDone={(saved) => {
              setMode("view");
              if (saved) router.refresh();
            }}
          />
        </div>
      ) : null}
      {error ? <p className={`mt-1 ${errorClass}`}>{error}</p> : null}
    </li>
  );
}

export function NoteForm({ ticketId, isBoard }: { ticketId: string; isBoard: boolean }) {
  const router = useRouter();
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // "Ask the reporter" on the triage card fills this in (non-internal).
  useEffect(() => {
    const onPrefill = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      if (typeof text !== "string") return;
      setBody(text);
      setInternal(false);
      ref.current?.scrollIntoView({ block: "center" });
      ref.current?.focus();
    };
    window.addEventListener(PREFILL_NOTE_EVENT, onPrefill);
    return () => window.removeEventListener(PREFILL_NOTE_EVENT, onPrefill);
  }, []);

  return (
    <form
      className="space-y-3 border-t border-line pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await addComment(ticketId, body, isBoard && internal);
          if ("error" in r) setError(r.error);
          else {
            setBody("");
            setInternal(false);
            router.refresh();
          }
        });
      }}
    >
      <div>
        <label htmlFor={id} className={labelClass}>
          Add a note
        </label>
        <textarea
          id={id}
          ref={ref}
          rows={3}
          maxLength={4000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Called the plumber, coming Thursday."
          className={textareaClass}
        />
        {!isBoard ? <p className="mt-1 text-[12px] text-mute">Anyone who can see this problem can read this.</p> : null}
      </div>
      {isBoard ? (
        <label className={choiceRow}>
          <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="h-5 w-5" />
          Internal: only the board sees this
        </label>
      ) : null}
      <button type="submit" disabled={pending || !body.trim()} className={btnPrimary}>
        {pending ? "Saving…" : "Add note"}
      </button>
      {error ? <p className={errorClass}>{error}</p> : null}
    </form>
  );
}
