"use client";

import { useState, useTransition } from "react";
import type { FormOutcome } from "@/lib/tax/determine";
import { confirmIncomeClassification, startForm } from "./form-actions";

const DETERMINATION: Record<string, { label: string; cls: string }> = {
  required: { label: "Required", cls: "border-info-line bg-info-tint text-info-text" },
  likely_required: { label: "Likely required", cls: "border-warning-line bg-warning-tint text-warning-text" },
  optional: { label: "Optional", cls: "border-line bg-fill text-mute" },
  not_required: { label: "Not required", cls: "border-line bg-fill text-mute" },
  ask_cpa: { label: "Ask your CPA", cls: "border-warning-line bg-warning-tint text-warning-text" },
};

const btn = "inline-flex min-h-[44px] items-center rounded-md px-4 text-[13px] font-medium disabled:opacity-50";

export function FormCard({
  outcome,
  title,
  plain,
  started,
  canWrite,
}: {
  outcome: FormOutcome;
  title: string;
  plain: string;
  started: { id: string; status: string; filedOn: string | null } | null;
  canWrite: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const d = DETERMINATION[outcome.determination] ?? DETERMINATION.ask_cpa;
  const showAction = outcome.determination !== "not_required";

  let action: React.ReactNode = null;
  if (started?.status === "filed") {
    action = (
      <a href={`/tax/forms/${started.id}`} className="text-[13px] text-good-text underline underline-offset-2">
        Filed on {started.filedOn}
      </a>
    );
  } else if (started?.status === "ready_to_sign") {
    action = (
      <a href={`/tax/forms/${started.id}`} className={`${btn} bg-ink text-paper hover:bg-ink-mid`}>
        Export to sign
      </a>
    );
  } else if (started) {
    action = (
      <a href={`/tax/forms/${started.id}`} className={`${btn} border border-line-strong bg-paper text-ink hover:bg-fill`}>
        Continue review
      </a>
    );
  } else if (canWrite && showAction) {
    action = (
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await startForm(outcome.formCode, outcome.taxYear, outcome.vendorId ?? null);
            if (r?.error) setError(r.error);
          })
        }
        className={`${btn} bg-ink text-paper hover:bg-ink-mid`}
      >
        {pending ? "Starting…" : "Start"}
      </button>
    );
  }

  return (
    <div className="flex flex-col justify-between gap-3 rounded-xl border border-line bg-paper px-4 py-4">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[14px] font-medium text-ink">{title}</span>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] ${d.cls}`}>{d.label}</span>
        </div>
        <p className="mt-0.5 text-[12px] text-mute">{plain}</p>
        <p className="mt-2 text-[12px] text-ink">{outcome.reason}</p>
        <p className="mt-1 text-[12px] text-mute">
          {outcome.dueOn ? `Due ${outcome.dueOn}${outcome.dueCitation ? ` (${outcome.dueCitation})` : ""}` : "Due date not on file yet"}
        </p>
        {outcome.warnings.map((w) => (
          <p key={w} className="mt-1 text-[12px] text-warning-text">{w}</p>
        ))}
      </div>
      {action}
      {error ? <p className="text-[12px] text-bad-text">{error}</p> : null}
    </div>
  );
}

/** Confirm once whether an income account is member income (exempt) or not. Walkup remembers. */
export function ClassifyIncomeRow({
  accountId,
  name,
  total,
  isExempt,
  confirmedAt,
  canWrite,
}: {
  accountId: string;
  name: string;
  total: string;
  isExempt: boolean;
  confirmedAt: string | null;
  canWrite: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const choose = (exempt: boolean) =>
    start(async () => {
      setError(null);
      const r = await confirmIncomeClassification(accountId, exempt);
      if (r.error) setError(r.error);
      else setChanging(false);
    });
  const choice = "min-h-[36px] rounded-md border px-3 text-[12px] font-medium disabled:opacity-50";

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div>
        <div className="text-[13px] font-medium text-ink">{name}</div>
        <div className="text-[12px] text-mute">
          {total} this year ·{" "}
          {confirmedAt ? (
            <span className="text-good-text">
              Confirmed as {isExempt ? "member income (exempt)" : "not member income (taxable)"}
            </span>
          ) : (
            <span className="text-warning-text">
              Suggested: {isExempt ? "member income (exempt)" : "not member income (taxable)"} — not yet confirmed
            </span>
          )}
        </div>
      </div>
      {canWrite && (!confirmedAt || changing) ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={pending} onClick={() => choose(true)} className={`${choice} border-line-strong bg-paper text-ink hover:bg-fill`}>
            Member income
          </button>
          <button type="button" disabled={pending} onClick={() => choose(false)} className={`${choice} border-line-strong bg-paper text-ink hover:bg-fill`}>
            Not member income
          </button>
        </div>
      ) : canWrite ? (
        <button type="button" onClick={() => setChanging(true)} className="text-[12px] text-mute underline underline-offset-2">
          Change
        </button>
      ) : null}
      {error ? <p className="w-full text-[12px] text-bad-text">{error}</p> : null}
      {!confirmedAt && canWrite ? (
        <p className="w-full text-[11px] text-mute">
          Member income is what owners pay as owners — dues, assessments, their late fees. Interest, rent from outsiders,
          and laundry or vending usually isn&rsquo;t. If unsure, ask your CPA.
        </p>
      ) : null}
    </li>
  );
}
