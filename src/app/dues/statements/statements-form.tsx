"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { prepareStatements } from "@/app/dues/email-actions";
import { formatBalanceWords, formatMoney } from "@/lib/email-outbox/format";

export interface StatementRow {
  unitId: string;
  label: string;
  owners: string[];
  hasEmail: boolean;
  opening: string;
  charges: string;
  payments: string;
  closing: string;
  active: boolean;
}

const btn =
  "inline-flex min-h-[44px] items-center justify-center rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50";
const btnGhost =
  "inline-flex min-h-[44px] items-center justify-center rounded-md border border-line-strong bg-paper px-4 py-2 text-[13px] font-medium text-ink hover:bg-fill disabled:opacity-50";

export function StatementsForm({
  rows,
  from,
  to,
  canPrepare,
  annual,
}: {
  rows: StatementRow[];
  from: string;
  to: string;
  canPrepare: boolean;
  annual: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const everyone = useMemo(() => rows.filter((r) => r.hasEmail && r.active), [rows]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const prepare = (unitIds: string[]) => {
    setError(null);
    start(async () => {
      const res = await prepareStatements({ unitIds, from, to });
      if ("error" in res) setError(res.error);
      else router.push(`/dues/send/${res.batchId}`);
    });
  };
  const pdf = (unitId: string) => `/statements/${unitId}/pdf?from=${from}&to=${to}`;

  return (
    <div>
      {canPrepare ? (
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <button type="button" className={btn} disabled={pending || everyone.length === 0} onClick={() => prepare(everyone.map((r) => r.unitId))}>
            {pending ? "Preparing..." : `${annual ? "Send annual statements to all owners" : "Send statements to all owners"} (${everyone.length})`}
          </button>
          <button type="button" className={btnGhost} disabled={pending || selected.size === 0} onClick={() => prepare([...selected])}>
            Send to selected ({selected.size})
          </button>
        </div>
      ) : (
        <p className="mb-4 text-[13px] text-mute">Preparing email is for the board.</p>
      )}
      {error ? (
        <p role="alert" className="mb-3 rounded-lg border border-bad-line bg-bad-tint px-3.5 py-2.5 text-[13px] text-bad-text">
          {error}
        </p>
      ) : null}

      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[40rem] text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-mute">
              {canPrepare ? <th className="w-8 pb-2" aria-label="Select" /> : null}
              <th className="pb-2 font-medium">Unit and owner</th>
              <th className="pb-2 text-right font-medium">Balance at the start</th>
              <th className="pb-2 text-right font-medium">Charged</th>
              <th className="pb-2 text-right font-medium">Paid</th>
              <th className="pb-2 text-right font-medium">Balance at the end</th>
              <th className="pb-2 pl-4 font-medium">PDF</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.unitId}>
                {canPrepare ? (
                  <td className="py-3 pr-2">
                    <input type="checkbox" className="h-4 w-4" aria-label={`Select ${r.label}`} checked={selected.has(r.unitId)} onChange={() => toggle(r.unitId)} />
                  </td>
                ) : null}
                <td className="py-3">
                  <div className="font-medium text-ink">{r.label}</div>
                  <div className="text-[11px] text-mute">
                    {r.owners.join(", ") || "No owner"}
                    {!r.hasEmail ? " (no email)" : ""}
                  </div>
                </td>
                <td className="figures py-3 text-right">{formatBalanceWords(r.opening)}</td>
                <td className="figures py-3 text-right">{formatMoney(r.charges)}</td>
                <td className="figures py-3 text-right">{formatMoney(r.payments)}</td>
                <td className="figures py-3 text-right text-ink">{formatBalanceWords(r.closing)}</td>
                <td className="py-3 pl-4">
                  <a href={pdf(r.unitId)} className="text-ink underline underline-offset-2">
                    PDF
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 sm:hidden">
        {rows.map((r) => (
          <li key={r.unitId} className="rounded-xl border border-line p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Link href={`/units/${r.unitId}`} className="font-medium text-ink">
                  {r.label}
                </Link>
                <div className="text-[11px] text-mute">
                  {r.owners.join(", ") || "No owner"}
                  {!r.hasEmail ? " (no email)" : ""}
                </div>
              </div>
              <div className="figures text-right text-[15px] font-semibold text-ink">{formatBalanceWords(r.closing)}</div>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
              <dt className="text-mute">Balance at the start</dt>
              <dd className="figures text-right">{formatBalanceWords(r.opening)}</dd>
              <dt className="text-mute">Charged</dt>
              <dd className="figures text-right">{formatMoney(r.charges)}</dd>
              <dt className="text-mute">Paid</dt>
              <dd className="figures text-right">{formatMoney(r.payments)}</dd>
            </dl>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <a href={pdf(r.unitId)} className="inline-flex min-h-[44px] items-center text-[13px] text-ink underline underline-offset-2">
                Download PDF
              </a>
              {canPrepare ? (
                <label className="flex min-h-[44px] items-center gap-2 text-[13px] text-ink">
                  <input type="checkbox" className="h-5 w-5" checked={selected.has(r.unitId)} onChange={() => toggle(r.unitId)} />
                  Include
                </label>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
