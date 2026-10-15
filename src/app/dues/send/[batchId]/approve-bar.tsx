"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { approveBatch, cancelBatch } from "@/app/dues/email-actions";

const btnPrimary =
  "inline-flex min-h-[48px] items-center justify-center rounded-lg bg-ink px-5 py-2 text-[14px] font-semibold text-paper hover:bg-ink-mid disabled:opacity-50";
const btnGhost =
  "inline-flex min-h-[48px] items-center justify-center rounded-lg border border-line-strong bg-paper px-4 py-2 text-[14px] font-medium text-ink hover:bg-fill disabled:opacity-50";

/**
 * The approval. Only a board admin sees the Send button; a board member is
 * told to ask one. Cancel is open to the board. Sticky on a phone.
 */
export function ApproveBar({
  batchId,
  ready,
  isAdmin,
  blockedReason,
}: {
  batchId: string;
  ready: number;
  isAdmin: boolean;
  /** Why Send is unavailable right now, or null. */
  blockedReason: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const send = () => {
    setError(null);
    start(async () => {
      const res = await approveBatch(batchId);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  };
  const cancel = () => {
    setError(null);
    start(async () => {
      const res = await cancelBatch(batchId);
      if ("error" in res) setError(res.error);
      else router.push("/delinquency");
    });
  };

  return (
    <div className="sticky bottom-0 -mx-4 border-t border-line bg-paper px-4 py-3 sm:static sm:mx-0 sm:rounded-xl sm:border sm:px-5">
      {error ? (
        <p role="alert" className="mb-2 text-[13px] text-bad-text">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {isAdmin ? (
          <button type="button" className={btnPrimary} disabled={pending || ready === 0 || blockedReason !== null} onClick={send}>
            {pending ? "Sending..." : `Send these ${ready} email${ready === 1 ? "" : "s"} from Walkup`}
          </button>
        ) : (
          <p className="text-[13px] text-mute">Ask a board admin to approve this batch.</p>
        )}
        <button type="button" className={btnGhost} disabled={pending} onClick={cancel}>
          Cancel
        </button>
      </div>
      {isAdmin && blockedReason ? <p className="mt-2 text-[12px] text-mute">{blockedReason}</p> : null}
    </div>
  );
}
