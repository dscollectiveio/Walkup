"use client";

import { useActionState, useState, useTransition } from "react";
import { getDownloadUrl, uploadDocument } from "./actions";

const KINDS = [
  { value: "general", label: "Anything else" },
  { value: "insurance", label: "Insurance policy or certificate" },
  { value: "minutes", label: "Meeting minutes" },
  { value: "w9", label: "Contractor W-9" },
  { value: "invoice", label: "Invoice or receipt" },
  { value: "declaration", label: "Declaration or bylaws" },
  { value: "tax", label: "Tax return or correspondence" },
];

export function UploadForm() {
  const [state, action, pending] = useActionState(uploadDocument, null);

  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-paper p-5"
    >
      <div>
        <label htmlFor="file" className="block text-[12px] font-medium text-ink">
          Add a document
        </label>
        <input
          id="file"
          name="file"
          type="file"
          required
          className="mt-1 block text-[13px] text-ink file:mr-3 file:rounded-md file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-[13px] file:text-paper hover:file:bg-ink-mid"
        />
      </div>
      <div>
        <label htmlFor="relation" className="block text-[12px] font-medium text-ink">
          What is it?
        </label>
        <select
          id="relation"
          name="relation"
          defaultValue="general"
          className="mt-1 rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink"
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
      >
        {pending ? "Uploading…" : "Upload"}
      </button>
      {state?.error ? (
        <p className="w-full text-[13px] text-bad-text">{state.error}</p>
      ) : null}
      <p className="w-full text-[11px] text-mute">
        Up to 25 MB. PDFs, photos, Word and Excel files. Stored privately —
        links expire after a minute, so nothing stays publicly reachable.
      </p>
    </form>
  );
}

/** Fetches a fresh signed URL on click rather than embedding one in the page. */
export function DownloadLink({ id, filename }: { id: string; filename: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        onClick={() =>
          start(async () => {
            const result = await getDownloadUrl(id);
            if ("error" in result && result.error) return setError(result.error);
            if ("url" in result && result.url) window.open(result.url, "_blank");
          })
        }
        disabled={pending}
        className="font-medium text-ink underline-offset-2 hover:underline disabled:opacity-50"
      >
        {pending ? "Opening…" : filename}
      </button>
      {error ? <span className="ml-2 text-[11px] text-bad-text">{error}</span> : null}
    </>
  );
}
