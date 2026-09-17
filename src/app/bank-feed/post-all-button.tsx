"use client";

import { useState, useTransition } from "react";
import { postAllReady } from "./actions";

export function PostAllButton({ readyCount }: { readyCount: number }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  if (readyCount === 0) return null;

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMessage(null);
            const result = await postAllReady();
            if (result.error) setMessage(result.error);
            else if (result.errors && result.errors.length > 0) {
              setMessage(
                `Posted ${result.posted}. ${result.errors.length} couldn't be posted: ${result.errors.join(" · ")}`,
              );
            }
          })
        }
        className="rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
      >
        {pending ? "Posting…" : `Post ${readyCount} ready to the books`}
      </button>
      {message ? <p className="mt-2 text-[12px] text-bad-text">{message}</p> : null}
    </div>
  );
}
