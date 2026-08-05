"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import {
  purgeDocument,
  renameDocument,
  rerunExtraction,
  restoreDocument,
  setDocumentVisibility,
} from "../actions";
import type { DocumentRow } from "@/lib/documents/access";

export function RenameForm({ doc }: { doc: DocumentRow }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(renameDocument, null);

  const [prev, setPrev] = useState(state);
  if (state !== prev) {
    setPrev(state);
    if (state?.ok) setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[12px] text-mute underline-offset-2 hover:underline"
      >
        Rename
      </button>
    );
  }

  return (
    <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="document_id" value={doc.id} />
      <input
        name="title"
        defaultValue={doc.title}
        aria-label="Title"
        className="w-full max-w-[360px] rounded-lg border border-line-strong px-3 py-1.5 text-[13px] text-ink"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-[12px] text-mute underline-offset-2 hover:underline"
      >
        Cancel
      </button>
      <p className="w-full text-[11px] text-mute-soft">
        Leave it blank to go back to the original filename.
      </p>
      {state?.error ? <p className="w-full text-[11px] text-bad-text">{state.error}</p> : null}
    </form>
  );
}

export function VisibilityForm({
  doc,
  units,
}: {
  doc: DocumentRow;
  units: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(setDocumentVisibility, null);

  const [prev, setPrev] = useState(state);
  if (state !== prev) {
    setPrev(state);
    if (state?.ok) setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[12px] text-mute underline-offset-2 hover:underline"
      >
        Change who sees this
      </button>
    );
  }

  return (
    <form action={action} className="mt-3 space-y-3 rounded-lg border border-line bg-fill p-4">
      <input type="hidden" name="document_id" value={doc.id} />
      <div>
        <label htmlFor="visibility" className="block text-[12px] font-medium text-ink">
          Who can see it
        </label>
        <select
          id="visibility"
          name="visibility"
          defaultValue={doc.visibility}
          className="mt-1 w-full max-w-[320px] rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink"
        >
          <option value="board_only">The board and the accountant</option>
          <option value="all_owners">Every owner in the building</option>
        </select>
      </div>
      <div>
        <label htmlFor="restricted_to_unit_id" className="block text-[12px] font-medium text-ink">
          About one unit in particular
          <span className="ml-1 font-normal text-mute-soft">optional</span>
        </label>
        <select
          id="restricted_to_unit_id"
          name="restricted_to_unit_id"
          defaultValue={doc.restricted_to_unit_id ?? ""}
          className="mt-1 w-full max-w-[320px] rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink"
        >
          <option value="">No — it concerns the whole building</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-mute">
          Naming a unit narrows this to that unit&rsquo;s owner and the board — use it for
          arrears letters and anything else addressed to one household. It never widens access.
        </p>
      </div>
      {state?.error ? <p className="text-[12px] text-bad-text">{state.error}</p> : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-line-strong px-3 py-1.5 text-[12px] text-ink hover:bg-fill"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * Read the file again. Manual rather than automatic: retrying on a loop is how
 * a file that will never parse turns into a recurring bill.
 */
export function RerunButton({ id, label }: { id: string; label: string }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMessage(null);
            const r = await rerunExtraction(id);
            if (r.error) setMessage({ text: r.error, bad: true });
            else if (r.detail) setMessage({ text: r.detail, bad: false });
          })
        }
        className="rounded-md border border-line-strong px-3 py-1.5 text-[12px] text-ink hover:bg-fill disabled:opacity-50"
      >
        {pending ? "Reading…" : label}
      </button>
      {message ? (
        <p className={`mt-1 text-[11px] ${message.bad ? "text-bad-text" : "text-mute"}`}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

export function RestoreButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await restoreDocument(id);
            if (r.error) setError(r.error);
          })
        }
        className="rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
      >
        {pending ? "Restoring…" : "Restore"}
      </button>
      {error ? <p className="mt-1 text-[11px] text-bad-text">{error}</p> : null}
    </>
  );
}

/** Destroys the row and the file. board_admin only, enforced by policy. */
export function PurgeButton({ id }: { id: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-[12px] text-bad-text underline-offset-2 hover:underline"
      >
        Destroy permanently
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[12px] text-mute">
        Destroy this document and its file? This cannot be undone.
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await purgeDocument(id);
            if (r.error) return setError(r.error);
            router.push("/documents");
          })
        }
        className="rounded-md border border-bad-line bg-bad-tint px-3 py-1.5 text-[12px] font-medium text-bad-text hover:bg-bad-tint/80"
      >
        {pending ? "Destroying…" : "Destroy it"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-[12px] text-mute underline-offset-2 hover:underline"
      >
        Cancel
      </button>
      {error ? <p className="w-full text-[11px] text-bad-text">{error}</p> : null}
    </div>
  );
}
