"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/repairs/sheet";
import { btnDanger, btnPrimary, btnSecondary, errorClass, inputClass, labelClass } from "@/components/repairs/styles";
import { archiveContractor, deleteContractor, restoreContractor } from "../vendor-actions";

/**
 * Archive, restore and delete (repairs-spec §10.4, §10.5). Archiving hides a
 * contractor from lists, pickers and recommendations but keeps every
 * payment, problem and 1099; deleting is for a mistake with no history, and
 * only a board admin can do it.
 */
export function ArchiveDialog(props: { vendorId: string; name: string; openProblems: number; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const fid = useId();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const n = props.openProblems;
  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title={`Archive ${props.name}?`}
      footer={
        <>
          <button
            type="button"
            disabled={pending}
            className={btnPrimary}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await archiveContractor(props.vendorId, reason.trim() || null);
                if ("error" in r) setError(r.error);
                else {
                  props.onClose();
                  router.refresh();
                }
              })
            }
          >
            {pending ? "Archiving…" : "Archive"}
          </button>
          <button type="button" onClick={props.onClose} className={btnSecondary}>
            Cancel
          </button>
          {error ? <p className={errorClass}>{error}</p> : null}
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[14px] text-ink">They&rsquo;ll be hidden from lists and pickers. Their history, payments and 1099s stay.</p>
        {n > 0 ? (
          <p className="border-l-[3px] border-warning bg-warning-tint px-3 py-2 text-[13px] text-warning-text">
            They&rsquo;re on {n} open {n === 1 ? "problem" : "problems"}. Those stay assigned.
          </p>
        ) : null}
        <div>
          <label htmlFor={`${fid}-why`} className={labelClass}>
            Why? (optional)
          </label>
          <input id={`${fid}-why`} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} className={inputClass} />
        </div>
      </div>
    </Sheet>
  );
}

export function DeleteDialog(props: { vendorId: string; name: string; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title={`Delete ${props.name} for good?`}
      footer={
        <>
          <button
            type="button"
            disabled={pending}
            className={btnDanger}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await deleteContractor(props.vendorId);
                if ("error" in r) setError(r.error);
                else router.push("/repairs?view=contractors");
              })
            }
          >
            {pending ? "Deleting…" : "Delete"}
          </button>
          <button type="button" onClick={props.onClose} className={btnSecondary}>
            Cancel
          </button>
        </>
      }
    >
      <p className="text-[14px] text-ink">This can&rsquo;t be undone.</p>
      {error ? <p className={`mt-3 ${errorClass}`}>{error}</p> : null}
    </Sheet>
  );
}

/** The archived banner's "Restore". */
export function RestoreButton({ vendorId }: { vendorId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        className={btnSecondary}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await restoreContractor(vendorId);
            if ("error" in r) setError(r.error);
            else router.refresh();
          })
        }
      >
        {pending ? "Restoring…" : "Restore"}
      </button>
      {error ? <span className={errorClass}>{error}</span> : null}
    </span>
  );
}
