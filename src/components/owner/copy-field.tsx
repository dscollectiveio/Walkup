"use client";

import { useEffect, useRef, useState } from "react";
import { btnSecondary } from "@/components/repairs/styles";

/**
 * One payment detail with a Copy button (owner-portal-spec 4.6). The status
 * line announces "Copied." through role="status"; if the browser refuses the
 * clipboard the value becomes select-all so it can be copied by hand.
 */
export function CopyField({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="text-[11px] text-mute">{label}</div>
        <div className={`${mono ? "figures" : ""} break-words text-[15px] text-ink ${state === "failed" ? "select-all" : ""}`}>{value}</div>
        <span role="status" className="block min-h-[16px] text-[12px] text-good-text">
          {state === "copied" ? "Copied." : ""}
          {state === "failed" ? <span className="text-bad-text">Couldn&rsquo;t copy. Select the text and copy it.</span> : null}
        </span>
      </div>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className={`${btnSecondary} shrink-0`}
      >
        Copy
      </button>
    </div>
  );
}
