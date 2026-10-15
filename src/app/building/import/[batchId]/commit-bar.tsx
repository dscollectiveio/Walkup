"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelImport, commitImport } from "../actions";
import { BTN_PRIMARY, BTN_SECONDARY, ErrorNote, InfoNote } from "../ui";

export function CommitBar({
  batchId,
  digest,
  okCount,
  hasBatchErrors,
  things,
}: {
  batchId: string;
  digest: string;
  okCount: number;
  hasBatchErrors: boolean;
  things: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [earlier, setEarlier] = useState<{ batchId: string; on: string | null } | null>(null);
  const [pending, start] = useTransition();
  const [cancelling, startCancel] = useTransition();

  const commit = () =>
    start(async () => {
      setError(null);
      setStale(false);
      const r = await commitImport(batchId, digest);
      if ("error" in r) {
        if (r.hint === "preview_stale") {
          setStale(true);
          router.refresh();
          return;
        }
        setError(r.error);
        if (r.alreadyImported) setEarlier(r.alreadyImported);
        return;
      }
      router.push(`/building/import/${batchId}?step=done`);
    });

  const cancel = () =>
    startCancel(async () => {
      const r = await cancelImport(batchId);
      if ("error" in r) setError(r.error);
      else router.push("/building/import");
    });

  return (
    <div className="sticky bottom-0 -mx-4 border-t border-line bg-paper px-4 py-3 sm:static sm:mx-0 sm:rounded-xl sm:border sm:px-5">
      {stale ? (
        <div className="mb-3">
          <InfoNote>Something changed since the preview. We refreshed it. Check it and import again.</InfoNote>
        </div>
      ) : null}
      {error ? (
        <div className="mb-3 space-y-2">
          <ErrorNote>{error}</ErrorNote>
          {earlier ? (
            <p className="text-[13px]">
              <Link href={`/building/import/${earlier.batchId}?step=done`} className="font-medium underline underline-offset-2">
                See that import
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={commit} disabled={pending || hasBatchErrors || okCount === 0} className={BTN_PRIMARY}>
          {pending ? "Importing..." : `Import ${okCount.toLocaleString("en-US")} ${okCount === 1 ? things.replace(/s$/, "") : things}`}
        </button>
        <Link href={`/building/import/${batchId}?step=fix`} className={BTN_SECONDARY}>
          Back
        </Link>
        <button type="button" onClick={cancel} disabled={cancelling || pending} className={BTN_SECONDARY}>
          {cancelling ? "Cancelling..." : "Cancel import"}
        </button>
        {hasBatchErrors ? <span className="text-[12px] text-bad-text">Fix the problems at the top first.</span> : null}
      </div>
    </div>
  );
}
