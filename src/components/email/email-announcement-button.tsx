"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { prepareAnnouncementEmail } from "@/app/dues/email-actions";

/**
 * "Email this to owners" for a posted announcement (money spec 5.1). Prepares
 * the drafts and opens the review page; nothing is sent until a board admin
 * presses Send there. Board only: the action refuses anyone else.
 */
export function EmailAnnouncementButton({ announcementId }: { announcementId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const res = await prepareAnnouncementEmail({ announcementId });
            if ("error" in res) setError(res.error);
            else router.push(`/dues/send/${res.batchId}`);
          });
        }}
        className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-line-strong bg-paper px-3 text-[13px] font-medium text-ink hover:bg-fill disabled:opacity-60"
      >
        {pending ? "Preparing..." : "Email this to owners"}
      </button>
      {error ? (
        <span role="alert" className="text-[13px] text-bad-text">
          {error}
        </span>
      ) : null}
    </>
  );
}
