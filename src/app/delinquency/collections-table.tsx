"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { shortDate } from "@/lib/dates";
import { fromCents } from "@/lib/tax/form1120h";
import { formatMoney } from "@/lib/email-outbox/format";
import { stageFor, STAGE_WORDS, type LastResult, type Suggestion } from "@/lib/collections/suggest";
import { prepareLateFeeNotice, prepareReminders } from "@/app/dues/email-actions";
import { unitHref } from "@/lib/building/unit-href";

export interface HistoryItem {
  date: string;
  kind: string;
  status: string;
}

export interface CollectionRow {
  unitId: string;
  label: string;
  ownerNames: string[];
  chips: string[];
  aging: { current: number; d1_30: number; d31_60: number; d60plus: number };
  owedCents: number;
  overdueCents: number;
  daysOverdue: number;
  lastReminderOn: string | null;
  lastResult: LastResult;
  suggestion: Suggestion;
  selectable: boolean;
  disabledReason: string | null;
  feeChargeId: string | null;
  history: HistoryItem[];
}

const cents = (c: number) => (c === 0 ? "" : formatMoney(fromCents(c)));
const RESULT_WORDS: Record<NonNullable<LastResult>, string> = {
  delivered: "by email",
  sent: "by email",
  bounced: "by email, bounced",
  complained: "by email, reported as spam",
  by_hand: "by hand",
};

function lastReminder(r: CollectionRow, today: string): string {
  if (!r.lastReminderOn) return "Never";
  return `${shortDate(r.lastReminderOn, today)} ${r.lastResult ? RESULT_WORDS[r.lastResult] : ""}`.trim();
}

const chip = "rounded-full bg-warning-tint px-2 py-0.5 text-[11px] font-medium text-warning-text";
const btn =
  "inline-flex min-h-[44px] items-center justify-center rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50 sm:min-h-0";
const btnGhost =
  "inline-flex min-h-[44px] items-center justify-center rounded-md border border-line-strong bg-paper px-3 py-2 text-[12px] font-medium text-ink hover:bg-fill disabled:opacity-50 sm:min-h-0";

function Unit({ r }: { r: CollectionRow }) {
  return (
    <div>
      <Link href={unitHref(r.unitId)} className="font-medium text-ink underline-offset-2 hover:underline">
        {r.label}
      </Link>
      {r.ownerNames.length ? <div className="text-[11px] text-mute">{r.ownerNames.join(", ")}</div> : null}
      {r.chips.length ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {r.chips.map((c) => (
            <span key={c} className={chip}>
              {c}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function History({ items }: { items: HistoryItem[] }) {
  if (items.length === 0) return null;
  return (
    <details className="mt-2 text-[12px]">
      <summary className="cursor-pointer text-mute hover:text-ink">History</summary>
      <ul className="mt-2 space-y-1">
        {items.map((h, i) => (
          <li key={i} className="flex flex-wrap gap-x-2 text-mute">
            <span className="text-ink">{h.date}</span>
            <span>{h.kind}</span>
            <span>{h.status}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function CollectionsTable({
  rows,
  canPrepare,
  preselect,
  today,
}: {
  rows: CollectionRow[];
  canPrepare: boolean;
  preselect: string | null;
  today: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => {
    const row = preselect ? rows.find((r) => r.unitId === preselect) : null;
    return new Set(row?.selectable ? [row.unitId] : []);
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const selectable = useMemo(() => rows.filter((r) => r.selectable), [rows]);

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
      const res = await prepareReminders({ unitIds });
      if ("error" in res) setError(res.error);
      else router.push(`/dues/send/${res.batchId}`);
    });
  };
  const prepareFee = (feeChargeId: string) => {
    setError(null);
    start(async () => {
      const res = await prepareLateFeeNotice({ feeChargeId });
      if ("error" in res) setError(res.error);
      else router.push(`/dues/send/${res.batchId}`);
    });
  };

  const nextStep = (r: CollectionRow) => (
    <div className="text-[12px]">
      <p className="text-mute">{r.suggestion.why}</p>
      {canPrepare && r.suggestion.action === "remind" ? (
        <button type="button" className="mt-1 font-medium text-ink underline underline-offset-2" disabled={pending} onClick={() => prepare([r.unitId])}>
          Prepare a reminder
        </button>
      ) : null}
      {canPrepare && r.suggestion.action === "late_fee_notice" && r.feeChargeId ? (
        <button type="button" className="mt-1 font-medium text-ink underline underline-offset-2" disabled={pending} onClick={() => prepareFee(r.feeChargeId!)}>
          Prepare a late fee notice
        </button>
      ) : null}
    </div>
  );

  return (
    <div>
      {canPrepare ? (
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <button type="button" className={btn} disabled={pending || selected.size === 0} onClick={() => prepare([...selected])}>
            {pending ? "Preparing..." : `Prepare reminders for selected (${selected.size})`}
          </button>
          {selectable.length > 0 ? (
            <button type="button" className={btnGhost} onClick={() => setSelected(new Set(selectable.map((r) => r.unitId)))}>
              Select everyone who can be reminded
            </button>
          ) : null}
          {selected.size > 0 ? (
            <button type="button" className={btnGhost} onClick={() => setSelected(new Set())}>
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mb-3 rounded-lg border border-bad-line bg-bad-tint px-3.5 py-2.5 text-[13px] text-bad-text">
          {error}
        </p>
      ) : null}

      {/* Desktop: one table */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[56rem] text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-mute">
              {canPrepare ? <th className="w-8 pb-2" aria-label="Select" /> : null}
              <th className="pb-2 font-medium">Unit and owner</th>
              <th className="pb-2 text-right font-medium">Not yet due</th>
              <th className="pb-2 text-right font-medium">Up to a month</th>
              <th className="pb-2 text-right font-medium">1 to 2 months</th>
              <th className="pb-2 text-right font-medium">Over 2 months</th>
              <th className="pb-2 text-right font-medium">Total</th>
              <th className="pb-2 pl-4 font-medium">Last reminder</th>
              <th className="pb-2 pl-4 font-medium">Next step</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line align-top">
            {rows.map((r) => (
              <tr key={r.unitId}>
                {canPrepare ? (
                  <td className="py-3 pr-2">
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.label}`}
                      className="h-4 w-4"
                      checked={selected.has(r.unitId)}
                      disabled={!r.selectable}
                      title={r.disabledReason ?? undefined}
                      onChange={() => toggle(r.unitId)}
                    />
                  </td>
                ) : null}
                <td className="py-3">
                  <Unit r={r} />
                  <History items={r.history} />
                </td>
                <td className="figures py-3 text-right text-mute">{cents(r.aging.current)}</td>
                <td className="figures py-3 text-right text-ink">{cents(r.aging.d1_30)}</td>
                <td className="figures py-3 text-right text-bad-text">{cents(r.aging.d31_60)}</td>
                <td className="figures py-3 text-right text-bad-text">{cents(r.aging.d60plus)}</td>
                <td className="figures py-3 text-right text-ink">{formatMoney(fromCents(r.owedCents))}</td>
                <td className="py-3 pl-4 text-[12px] text-mute">{lastReminder(r, today)}</td>
                <td className="max-w-[16rem] py-3 pl-4">{nextStep(r)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line">
              <td colSpan={canPrepare ? 6 : 5} className="pt-3 text-mute">
                Total
              </td>
              <td className="figures pt-3 text-right text-ink">{formatMoney(fromCents(rows.reduce((s, r) => s + r.owedCents, 0)))}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Phone: one card per unit */}
      <ul className="space-y-3 sm:hidden">
        {rows.map((r) => {
          const stage = stageFor(r.daysOverdue);
          return (
            <li key={r.unitId} className="rounded-xl border border-line p-4">
              <div className="flex items-start justify-between gap-3">
                <Unit r={r} />
                <div className="text-right">
                  <div className="figures text-[15px] font-semibold text-ink">{formatMoney(fromCents(r.owedCents))}</div>
                  {stage !== "current" ? (
                    <span className="mt-1 inline-block rounded-full bg-fill px-2 py-0.5 text-[11px] font-medium text-ink">{STAGE_WORDS[stage]}</span>
                  ) : null}
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                <dt className="text-mute">Not yet due</dt>
                <dd className="figures text-right">{cents(r.aging.current) || "None"}</dd>
                <dt className="text-mute">Up to a month</dt>
                <dd className="figures text-right">{cents(r.aging.d1_30) || "None"}</dd>
                <dt className="text-mute">1 to 2 months</dt>
                <dd className="figures text-right text-bad-text">{cents(r.aging.d31_60) || "None"}</dd>
                <dt className="text-mute">Over 2 months</dt>
                <dd className="figures text-right text-bad-text">{cents(r.aging.d60plus) || "None"}</dd>
                <dt className="text-mute">Last reminder</dt>
                <dd className="text-right">{lastReminder(r, today)}</dd>
              </dl>
              <div className="mt-3">{nextStep(r)}</div>
              {canPrepare ? (
                <label className="mt-3 flex min-h-[44px] items-center gap-2 text-[13px] text-ink" title={r.disabledReason ?? undefined}>
                  <input type="checkbox" className="h-5 w-5" checked={selected.has(r.unitId)} disabled={!r.selectable} onChange={() => toggle(r.unitId)} />
                  Include in the reminders
                </label>
              ) : null}
              <History items={r.history} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
