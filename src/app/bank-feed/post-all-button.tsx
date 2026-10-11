"use client";

import { useState, useTransition } from "react";
import { postAllReady } from "./actions";
import { PREVIEW_ABOVE, PostPreview, type PreviewRow } from "./post-preview";

/**
 * Posts every categorized, settled row. More than a handful gets a look
 * first: how many, how much in and out, and anything unusual among them.
 */
export function PostAllButton({ readyCount, preview }: { readyCount: number; preview: PreviewRow[] }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (readyCount === 0) return null;

  const post = () =>
    start(async () => {
      setConfirming(false);
      setMessage(null);
      const result = await postAllReady();
      if (result.error) setMessage(result.error);
      else if (result.errors && result.errors.length > 0) {
        setMessage(`Posted ${result.posted}. ${result.errors.length} couldn't be posted: ${result.errors.join(" · ")}`);
      }
    });

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => (readyCount > PREVIEW_ABOVE ? setConfirming(true) : post())}
        title="Posts every row you saved for later to the books"
        className="whitespace-nowrap rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
      >
        {pending ? "Posting…" : `Post ${readyCount} saved`}
      </button>
      {message ? <p className="mt-2 text-[12px] text-bad-text">{message}</p> : null}
      {confirming ? <PostPreview rows={preview} busy={pending} onPost={post} onCancel={() => setConfirming(false)} /> : null}
    </div>
  );
}
