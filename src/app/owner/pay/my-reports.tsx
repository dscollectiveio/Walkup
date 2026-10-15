"use client";

import { useState, useTransition } from "react";
import { Pill } from "@/components/repairs/pills";
import { withdrawPaymentReport } from "../actions";

export interface MyReport {
  id: string;
  line: string;
  unitLabel: string | null;
  status: { label: string; tone: "warning" | "good" | "neutral"; note: string | null };
  pending: boolean;
}

/** The owner's own payment reports, with Withdraw (inline confirm) on the ones nobody has answered. */
export function MyReports({ reports }: { reports: MyReport[] }) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const [pending, start] = useTransition();

  if (reports.length === 0) return <p className="text-[13px] text-mute">You haven&rsquo;t reported a payment.</p>;

  function withdraw(id: string) {
    start(async () => {
      const r = await withdrawPaymentReport(id);
      if ("error" in r) setError({ id, message: r.error });
      else setError(null);
      setConfirming(null);
    });
  }

  return (
    <ul className="divide-y divide-line">
      {reports.map((r) => (
        <li key={r.id} className="py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[14px] text-ink">
              {r.line}
              {r.unitLabel ? <span className="text-mute"> · {r.unitLabel}</span> : null}
            </span>
            <Pill tone={r.status.tone}>{r.status.label}</Pill>
          </div>
          {r.status.note ? <p className="mt-1 text-[13px] text-mute">&ldquo;{r.status.note}&rdquo;</p> : null}
          {r.pending ? (
            confirming === r.id ? (
              <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="Confirm withdraw">
                <span className="text-[13px] text-ink">Withdraw this report?</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => withdraw(r.id)}
                  className="inline-flex min-h-[44px] items-center rounded-md border border-bad-line bg-paper px-4 text-[13px] font-medium text-bad-text hover:bg-bad-tint disabled:opacity-60"
                >
                  {pending ? "Withdrawing..." : "Yes, withdraw"}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setConfirming(null)}
                  className="inline-flex min-h-[44px] items-center rounded-md border border-line-strong bg-paper px-4 text-[13px] font-medium text-ink hover:bg-fill"
                >
                  Keep it
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setConfirming(r.id);
                }}
                className="mt-1 inline-flex min-h-[44px] items-center text-[13px] font-medium text-ink underline underline-offset-2"
              >
                Withdraw
              </button>
            )
          ) : null}
          {error?.id === r.id ? (
            <p role="alert" className="mt-1 text-[13px] text-bad-text">
              {error.message}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
