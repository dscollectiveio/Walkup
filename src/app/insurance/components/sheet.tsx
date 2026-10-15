"use client";

import { useEffect, useRef } from "react";
import { dialogClass } from "./styles";

/**
 * A native <dialog> driven by `open` (§11.6, §11.7): centred on desktop, a
 * full-screen sheet on phones, focus back to the opener on close. Escape and
 * the children's own Cancel both end in `onClose`.
 */
export function Sheet({
  open,
  onClose,
  label,
  wide = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      onClose={onClose}
      className={`${dialogClass} ${wide ? "sm:w-[min(48rem,calc(100vw-2rem))]" : ""}`}
    >
      {open ? children : null}
    </dialog>
  );
}

/** The fixed bottom of a sheet: error above the buttons, safe-area padding (§11.4, §11.6). */
export function SheetFooter({ error, children }: { error?: string | null; children: React.ReactNode }) {
  return (
    <div className="space-y-2 border-t border-line bg-paper px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      {error ? <p className="border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">{error}</p> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{children}</div>
    </div>
  );
}
