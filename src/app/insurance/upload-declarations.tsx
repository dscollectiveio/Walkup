"use client";

import { useActionState } from "react";
import { uploadDeclarations } from "./actions";

/** Upload a declarations page (or a quote) — it goes through the Document Hub, then to review. */
export function UploadDeclarations({
  mode = "policy",
  requestId,
  label,
}: {
  mode?: "policy" | "quote";
  requestId?: string;
  label?: string;
}) {
  const [state, action, pending] = useActionState(uploadDeclarations, null);
  const id = `decl-${mode}-${requestId ?? "new"}`;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="mode" value={mode} />
      {requestId ? <input type="hidden" name="request_id" value={requestId} /> : null}
      <label
        htmlFor={id}
        className="flex min-h-[88px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-line-strong bg-fill px-4 py-5 text-center text-[13px] text-ink hover:border-ink"
      >
        <span className="font-medium">{label ?? (mode === "quote" ? "Choose the quote PDF" : "Choose the declarations page")}</span>
        <span className="mt-1 text-[12px] text-mute">PDF works best. Up to 25 MB.</span>
        <input
          id={id}
          name="file"
          type="file"
          accept="application/pdf,image/*"
          required
          className="mt-3 max-w-full text-[12px]"
        />
      </label>
      {state?.error ? <p className="text-[12px] text-bad-text">{state.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="min-h-[44px] rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
      >
        {pending ? "Uploading…" : "Upload and read it"}
      </button>
    </form>
  );
}
