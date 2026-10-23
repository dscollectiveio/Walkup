"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { btnSecondary } from "@/components/repairs/styles";
import { archivePolicy, deletePolicy } from "../../policy-actions";
import { ConfirmDialog } from "../../components/confirm-dialog";

/**
 * The policy's "More" menu (§9.4 item 1, §11.7): a <details> whose summary
 * is a visible button; real links and buttons in Tab order; Escape closes it
 * and returns focus to the summary. A popover on desktop, a sheet on phones.
 * Archive and Delete are rendered only for board admins.
 */
export function MoreMenu({ policyId, isAdmin, archived }: { policyId: string; isAdmin: boolean; archived: boolean }) {
  const router = useRouter();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const [confirm, setConfirm] = useState<"archive" | "delete" | null>(null);

  const close = () => {
    if (detailsRef.current) detailsRef.current.open = false;
    summaryRef.current?.focus();
  };
  const item =
    "flex min-h-[44px] w-full items-center px-4 text-left text-[13px] text-ink hover:bg-fill focus-visible:bg-fill";

  return (
    <>
      <details
        ref={detailsRef}
        className="relative"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
      >
        <summary
          ref={summaryRef}
          aria-label="More actions for this policy"
          className={`${btnSecondary} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
        >
          More
        </summary>
        <div className="fixed inset-x-0 bottom-0 z-40 rounded-t-xl border border-line bg-paper py-2 pb-[env(safe-area-inset-bottom)] shadow-xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:mt-2 sm:w-64 sm:rounded-xl">
          <Link href={`/insurance/policies/${policyId}/edit`} className={item}>
            Edit
          </Link>
          <Link href={`/insurance/policies/${policyId}/renew`} className={item}>
            Renew
          </Link>
          <Link href={`/insurance/policies/${policyId}/renew`} className={item}>
            Upload the renewal declarations
          </Link>
          <Link href={`/insurance/emails/new?kind=coverage_question&policy=${policyId}&question=own`} className={item}>
            Ask your agent about this policy
          </Link>
          {isAdmin ? (
            <>
              <button type="button" className={item} onClick={() => setConfirm("archive")}>
                {archived ? "Restore" : "Archive"}
              </button>
              <button type="button" className={`${item} text-bad-text`} onClick={() => setConfirm("delete")}>
                Delete
              </button>
            </>
          ) : null}
          <button type="button" className={`${item} text-mute sm:hidden`} onClick={close}>
            Close
          </button>
        </div>
      </details>

      <ConfirmDialog
        open={confirm === "archive"}
        title={archived ? "Restore this policy?" : "Archive this policy?"}
        body={archived ? "It comes back in reminders and the coverage check." : "It disappears from reminders and the coverage check. You can restore it."}
        confirmLabel={archived ? "Restore" : "Archive"}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          const r = await archivePolicy(policyId, !archived);
          if ("error" in r) return r;
          router.refresh();
          return r;
        }}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        title="Delete this policy permanently?"
        body="Its details and where they came from are removed. Documents stay in Documents."
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        danger
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          const r = await deletePolicy(policyId);
          if ("error" in r) return r;
          router.push("/insurance?open=policies#policies");
          return r;
        }}
      />
    </>
  );
}
