"use client";

import { useEffect, useRef } from "react";

/**
 * A <details> that starts open on wide screens and closed on phones
 * (§9.4 item 4). Server-rendered closed, opened after mount, so the phone
 * layout never flashes open.
 */
export function DesktopOpenDetails({ summary, children }: { summary: React.ReactNode; children: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (ref.current && window.matchMedia("(min-width: 640px)").matches) ref.current.open = true;
  }, []);
  return (
    <details ref={ref} className="rounded-xl border border-line bg-paper px-5 py-3">
      <summary className="min-h-[44px] cursor-pointer py-2 text-[13px] font-bold text-ink">{summary}</summary>
      <div className="pb-3">{children}</div>
    </details>
  );
}
