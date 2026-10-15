"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";

/**
 * A native <dialog> shown with showModal(): focus trap, Escape to close and
 * focus returned to the opener come from the browser (repairs-spec §16).
 * Full-screen sheet on phones with the actions in a sticky bottom bar;
 * centred on wider screens. Controlled by `open`.
 */
export function Sheet(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Under the title, muted. */
  description?: string;
  /** The sticky action bar (primary button first). */
  footer?: React.ReactNode;
  /** 640px instead of 520px on desktop. */
  wide?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { open, onClose } = props;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={() => {
        if (open) onClose();
      }}
      className={`m-auto max-h-[calc(100dvh-3rem)] overflow-hidden rounded-xl border border-line bg-paper p-0 text-ink shadow-2xl backdrop:bg-ink/50 max-sm:fixed max-sm:inset-0 max-sm:h-[100dvh] max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:rounded-none max-sm:border-0 ${
        props.wide ? "w-[min(640px,calc(100vw-2rem))]" : "w-[min(520px,calc(100vw-2rem))]"
      }`}
    >
      {open ? (
        <div className="flex max-h-[calc(100dvh-3rem)] flex-col max-sm:h-[100dvh] max-sm:max-h-none">
          <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-[17px] font-bold tracking-tight text-ink">
                {props.title}
              </h2>
              {props.description ? <p className="mt-1 text-[13px] text-mute">{props.description}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-mute hover:bg-fill hover:text-ink"
            >
              <X size={18} strokeWidth={1.6} aria-hidden="true" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{props.children}</div>
          {props.footer ? <StickyActions>{props.footer}</StickyActions> : null}
        </div>
      ) : null}
    </dialog>
  );
}

/** The primary button always within reach on a phone (repairs-spec §16). */
export function StickyActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-line bg-paper p-3 max-sm:[&>*]:flex-1">
      {children}
    </div>
  );
}

/** "Still working. This can take up to a minute." after 20 seconds (foundation copy). Mount it only while the work runs. */
export function StillWorking() {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setLate(true), 20_000);
    return () => window.clearTimeout(t);
  }, []);
  return late ? <p className="text-[12px] text-mute">Still working. This can take up to a minute.</p> : null;
}
