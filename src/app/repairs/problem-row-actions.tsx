"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setContractorW9, setProblemWorkStatus } from "./problem-actions";
import { WORK_STATUSES, beforeContractorSelected, numberedWorkStatus, type WorkStatus } from "@/lib/repairs/work-status";

const link =
  "inline-flex min-h-[34px] items-center whitespace-nowrap text-[13px] font-medium text-ink underline underline-offset-2 hover:text-ink-mid";

/**
 * The links on a line, when they apply: Get quotes (any status before a
 * contractor is selected) and Contact contractor (their email, else their
 * phone, once one is assigned). The problem's title is the link to open it.
 */
export function ProblemRowLinks({
  id,
  reference,
  title,
  status,
  canWrite,
  open,
  contractorEmail,
  contractorPhone,
}: {
  id: string;
  reference: number;
  title: string;
  status: WorkStatus;
  canWrite: boolean;
  open: boolean;
  contractorEmail: string | null;
  contractorPhone: string | null;
}) {
  const quotes = canWrite && open && beforeContractorSelected(status);
  const phone = contractorPhone?.replace(/[^\d+]/g, "") ?? "";
  const contact = open
    ? contractorEmail
      ? `mailto:${contractorEmail}?subject=${encodeURIComponent(`Problem #${reference}: ${title}`)}`
      : phone
        ? `tel:${phone}`
        : null
    : null;
  if (!quotes && !contact) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
      {quotes ? (
        <Link href={`/maintenance/${id}?open=quotes`} className={link}>
          Get quotes
        </Link>
      ) : null}
      {contact ? (
        <a href={contact} className={link}>
          Contact contractor
        </a>
      ) : null}
    </div>
  );
}

/**
 * The dropdown that sets the board's own tracker status on a line (Not Started
 * ... Completed - Paid). It does not change the problem's lifecycle; finishing
 * and closing a problem is still done from its page.
 */
export function ProblemStatusSelect({ id, reference, value }: { id: string; reference: number; value: WorkStatus }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function change(next: WorkStatus) {
    if (next === value) return;
    start(async () => {
      setError(null);
      const r = await setProblemWorkStatus(id, next);
      if ("error" in r) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <div>
      <label className="sr-only" htmlFor={`status-${id}`}>
        Status of problem #{reference}
      </label>
      <select
        id={`status-${id}`}
        value={value}
        disabled={pending}
        onChange={(e) => change(e.target.value as WorkStatus)}
        className="min-h-[34px] w-full rounded-md border border-line-strong bg-paper px-2.5 text-[12px] font-medium text-ink hover:bg-fill disabled:opacity-60"
      >
        {WORK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {numberedWorkStatus(s)}
          </option>
        ))}
      </select>
      {error ? (
        <p role="alert" className="mt-1 text-[12px] text-bad-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The "W-9 collected" box on a line: ticked when the problem's contractor has a
 * W-9 on file (the thing the 1099-NEC needs). It is the contractor's flag, so
 * every problem with the same contractor shows the same tick. Board members can
 * change it; the accountant sees it. No contractor yet, nothing to tick.
 */
export function ProblemW9Check({
  vendorId,
  collected,
  contractorName,
  canEdit,
}: {
  vendorId: string | null;
  collected: boolean | null;
  contractorName: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const checked = optimistic ?? collected === true;

  if (!vendorId) {
    return <span className="text-[12px] text-mute-soft">No contractor</span>;
  }
  return (
    <label className={`inline-flex min-h-[34px] items-center gap-2 text-[12px] ${canEdit ? "cursor-pointer" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={!canEdit || pending}
        onChange={(e) => {
          const next = e.target.checked;
          setOptimistic(next);
          setError(null);
          start(async () => {
            const r = await setContractorW9(vendorId, next);
            if ("error" in r) {
              setOptimistic(null);
              setError(r.error);
            } else {
              router.refresh();
              setOptimistic(null);
            }
          });
        }}
        aria-label={`W-9 collected for ${contractorName ?? "this contractor"}`}
        className="h-4 w-4 accent-[var(--color-ink)]"
      />
      <span className={checked ? "font-medium text-good-text" : "text-mute"}>{checked ? "Collected" : "Not yet"}</span>
      {error ? (
        <span role="alert" className="text-[11px] text-bad-text">
          {error}
        </span>
      ) : null}
    </label>
  );
}
