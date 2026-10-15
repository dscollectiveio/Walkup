"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { btnDanger, btnGhost, btnPrimary, dialogClass, errorBlock } from "./styles";

/**
 * A yes/no question in a native <dialog> (focus returns to the opener when it
 * closes). The confirm runs `onConfirm`; an `{ error }` result stays in the
 * dialog above the buttons.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  pendingLabel = "Working…",
  danger = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  pendingLabel?: string;
  danger?: boolean;
  onConfirm: () => Promise<{ ok: true } | { error: string } | void>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      onClose={() => {
        setError(null);
        onClose();
      }}
      className={`${dialogClass} sm:w-[min(28rem,calc(100vw-2rem))]`}
    >
      <div className="flex h-full flex-col">
        <div className="flex-1 px-5 py-5">
          <h2 id="confirm-title" className="text-[16px] font-bold tracking-tight text-ink">
            {title}
          </h2>
          {body ? <p className="mt-2 text-[13px] leading-relaxed text-mute">{body}</p> : null}
        </div>
        <div className="space-y-2 border-t border-line px-5 py-4">
          {error ? <p className={errorBlock}>{error}</p> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => ref.current?.close()} className={btnGhost} disabled={pending}>
              Cancel
            </button>
            <button
              type="button"
              disabled={pending}
              className={danger ? btnDanger : btnPrimary}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const r = await onConfirm();
                  if (r && "error" in r) setError(r.error);
                  else ref.current?.close();
                })
              }
            >
              {pending ? pendingLabel : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
