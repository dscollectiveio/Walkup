"use client";

import { useActionState, useState } from "react";
import { uploadDocuments } from "./actions";
import type { DocumentCategory } from "@/lib/documents/access";

export function UploadForm({ categories }: { categories: DocumentCategory[] }) {
  const [state, action, pending] = useActionState(uploadDocuments, null);
  const [count, setCount] = useState(0);

  const results = state && "results" in state ? state.results : null;

  return (
    <form action={action} className="rounded-xl border border-line bg-paper p-5">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="files" className="block text-[12px] font-medium text-ink">
            Add documents
          </label>
          <input
            id="files"
            name="files"
            type="file"
            multiple
            required
            onChange={(e) => setCount(e.target.files?.length ?? 0)}
            className="mt-1 block text-[13px] text-ink file:mr-3 file:rounded-md file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-[13px] file:text-paper hover:file:bg-ink-mid"
          />
        </div>
        <div>
          <label htmlFor="category_id" className="block text-[12px] font-medium text-ink">
            File them as
          </label>
          <select
            id="category_id"
            name="category_id"
            defaultValue=""
            className="mt-1 rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink"
          >
            <option value="">Decide later</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
        >
          {pending
            ? count > 1
              ? `Uploading ${count} files…`
              : "Uploading…"
            : count > 1
              ? `Upload ${count} files`
              : "Upload"}
        </button>
      </div>

      {state && "error" in state && state.error ? (
        <p className="mt-3 border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">
          {state.error}
        </p>
      ) : null}

      {/* Every file gets its own verdict. One rejection in a batch of five
          should not read as five failures. */}
      {results?.length ? (
        <ul className="mt-3 space-y-1.5">
          {results.map((r, i) => (
            <li key={`${r.filename}-${i}`} className="text-[12px]">
              {r.status === "added" ? (
                <span className="text-good-text">
                  <span className="font-medium text-ink">{r.filename}</span> — stored
                </span>
              ) : r.status === "duplicate" ? (
                <span className="text-mute">
                  <span className="font-medium text-ink">{r.filename}</span> is already in the
                  hub, so nothing was added.
                </span>
              ) : (
                <span className="text-bad-text">
                  <span className="font-medium text-ink">{r.filename}</span> {r.reason}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-3 text-[11px] text-mute">
        Up to 25 MB each. PDFs, photos, Word, Excel and text files. Stored privately — download
        links expire after a minute, so nothing stays publicly reachable.
      </p>
    </form>
  );
}
