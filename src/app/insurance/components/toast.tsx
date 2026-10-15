"use client";

import { useEffect, useState } from "react";

/**
 * A short confirmation at the bottom of the screen (§9: the bank-feed toast's
 * look, local to insurance). role="status" so screen readers hear it once.
 * Each new `message` (or a new `stamp` for the same words) shows again.
 */
export function Toast({ message, stamp, ms = 5000 }: { message: string | null; stamp?: number; ms?: number }) {
  const [shown, setShown] = useState<{ message: string; stamp?: number } | null>(message ? { message, stamp } : null);
  const [prev, setPrev] = useState<{ message: string | null; stamp?: number }>({ message, stamp });
  if (prev.message !== message || prev.stamp !== stamp) {
    setPrev({ message, stamp });
    setShown(message ? { message, stamp } : null);
  }

  useEffect(() => {
    if (!shown) return;
    const t = window.setTimeout(() => setShown(null), ms);
    return () => window.clearTimeout(t);
  }, [shown, ms]);

  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      {shown ? (
        <span className="pointer-events-auto max-w-[92vw] rounded-lg bg-ink px-4 py-2.5 text-[13px] text-paper shadow-lg">
          {shown.message}
        </span>
      ) : null}
    </div>
  );
}
