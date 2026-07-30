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
      className="flex flex-wrap items-end gap-3 rounded-xl border border-stone-200 bg-white p-5"
    >
      <div>
        <label htmlFor="file" className="block text-sm font-medium">
          Add a document
        </label>
        <input
          id="file"
          name="file"
          type="file"
          required
          className="mt-1 block text-sm file:mr-3 file:rounded file:border-0 file:bg-stone-900 file:px-3 file:py-1.5 file:text-sm file:text-white hover:file:bg-stone-700"
        />
      </div>
      <div>
        <label htmlFor="relation" className="block text-sm font-medium">
          What is it?
        </label>
        <select
          id="relation"
          name="relation"
          defaultValue="general"
          className="mt-1 rounded border border-stone-300 bg-white px-3 py-2 text-sm"
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
        className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
      >
        {pending ? "Uploading…" : "Upload"}
      </button>
      {state?.error ? (
        <p className="w-full text-sm text-red-800">{state.error}</p>
      ) : null}
      <p className="w-full text-xs text-stone-500">
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
        className="font-medium underline-offset-2 hover:underline disabled:opacity-50"
      >
        {pending ? "Opening…" : filename}
      </button>
      {error ? <span className="ml-2 text-xs text-red-700">{error}</span> : null}
    </>
  );
}
