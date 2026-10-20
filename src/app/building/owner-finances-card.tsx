"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { setOwnerFinancesEnabled } from "./owner-finances-actions";
import { OWNER_FINANCES_COPY as COPY } from "@/lib/owner/finances";
import { btnPrimary, btnSecondary } from "@/components/repairs/styles";

/** The board admin's switch for the owner Finances page (off by default). */
export function OwnerFinancesCard({ enabled }: { enabled: boolean }) {
  const [on, setOn] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function change(next: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await setOwnerFinancesEnabled(next);
      if ("error" in result) setError(result.error);
      else setOn(next);
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-relaxed text-mute" aria-live="polite">
        {on ? COPY.toggleOn : COPY.toggleOff}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" disabled={pending} onClick={() => change(!on)} className={on ? btnSecondary : btnPrimary}>
          {on ? COPY.toggleDisable : COPY.toggleEnable}
        </button>
        {on ? (
          <Link href="/owner/finances" className={btnSecondary}>
            {COPY.togglePreview}
          </Link>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-[13px] text-bad-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
