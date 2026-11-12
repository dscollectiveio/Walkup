"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { money } from "@/components/ui";
import { shortDate } from "@/lib/dates";
import type { LineEntry } from "./data";
import type { MergedRow } from "./summary";

export interface MultiTableProps {
  labels: string[];
  income: MergedRow[];
  expenses: MergedRow[];
  totalIncome: number[];
  totalExpenses: number[];
  net: number[];
  /** Entries behind each line, one map per period (same order as labels), keyed by account id. */
  entries: Record<string, LineEntry[]>[];
  today: string;
  /** Compare view: Period 1 | Period 2 | Difference instead of a Total. */
  compare?: boolean;
  /** A period with nothing posted: its column is left blank, never zeros. */
  blank?: boolean[];
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
// Months sit close together on the right at a fixed, narrow width; the first column takes the slack.
const NUM = "w-[6.75rem] whitespace-nowrap border-l border-line/60 px-3 text-right figures last:pr-5";

/** A difference: signed, so the direction is obvious. */
const signed = (n: number) => (n < 0 ? `−${money(-n)}` : n > 0 ? `+${money(n)}` : money(0));
const TOTAL_TINT = "bg-[var(--w-total-col)]";
const EDGE = "first:pl-5 last:pr-5";

/** The bottom line in words: "Excess" when positive, "Deficit" (no minus sign) when negative. */
function bottomLine(n: number) {
  return n < 0
    ? { label: "Deficit", text: money(-n), tone: "text-bad-text" }
    : { label: "Excess", text: money(n), tone: "text-good-text" };
}

/**
 * The side-by-side statement: a column per period and a Total, edge to edge in
 * its card. Click a figure to see the entries behind that month and line; click
 * a line's Total to see every month's entries together.
 */
export function MultiStatementTable({
  labels,
  income,
  expenses,
  totalIncome,
  totalExpenses,
  net,
  entries,
  today,
  compare = false,
  blank = [],
}: MultiTableProps) {
  // "accountId:periodIndex", or "accountId:all" for the Total column.
  const [open, setOpen] = useState<string | null>(null);
  // Sections folded shut; their total row stays.
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const showLast = compare || labels.length > 1;
  const cols = labels.length + 1 + (showLast ? 1 : 0);
  const isBlank = (i: number) => blank[i] === true;
  const cannotDiff = blank.some(Boolean);
  /** The last column's figure for a row of per-period amounts. Null when it has no honest value. */
  const lastOf = (amounts: number[]): number | null =>
    compare ? (cannotDiff ? null : amounts[0] - amounts[1]) : sum(amounts);
  const netAll = sum(net);
  // The bottom line is worded by the first column when comparing, by the overall figure otherwise.
  const total = bottomLine(compare ? (net[0] ?? 0) : netAll);

  /** The entries behind a line, each tagged with the period column it belongs in. */
  function entriesFor(accountId: string, which: string): { e: LineEntry; col: number }[] {
    const all = entries.flatMap((m, col) => (m[accountId] ?? []).map((e) => ({ e, col })));
    const picked = which === "all" ? all : all.filter((x) => x.col === Number(which));
    return picked.sort((x, y) => y.e.entry_date.localeCompare(x.e.entry_date));
  }

  function figure(accountId: string, which: string, amount: number, className: string) {
    const key = `${accountId}:${which}`;
    const isOpen = open === key;
    return (
      <button
        type="button"
        aria-expanded={isOpen}
        disabled={amount === 0}
        onClick={() => setOpen(isOpen ? null : key)}
        className={`figures rounded px-1 py-0.5 ${amount === 0 ? "text-mute-soft" : "text-ink hover:bg-ink/10"} ${isOpen ? "bg-ink/10" : ""} ${className}`}
        title={amount === 0 ? undefined : "Show the entries behind this figure"}
      >
        {amount === 0 ? "—" : money(amount)}
      </button>
    );
  }

  const lineRows = (rows: MergedRow[]) =>
    rows.map((r) => {
      const openMonth = open?.startsWith(`${r.account_id}:`) ? open.slice(r.account_id.length + 1) : null;
      const list = openMonth !== null ? entriesFor(r.account_id, openMonth) : [];
      return (
        <Fragment key={r.account_id}>
          <tr className="border-b border-line/70">
            <td className={`p-0 ${EDGE}`}>
              <button
                type="button"
                aria-expanded={open === `${r.account_id}:all`}
                onClick={() => setOpen(open === `${r.account_id}:all` ? null : `${r.account_id}:all`)}
                className="flex w-full items-center gap-3 py-2.5 pr-3 text-left text-ink hover:bg-fill/40"
              >
                <ChevronRight
                  size={14}
                  strokeWidth={1.6}
                  aria-hidden="true"
                  className={`shrink-0 text-mute-soft transition-transform ${open === `${r.account_id}:all` ? "rotate-90" : ""}`}
                />
                {r.account_name}
              </button>
            </td>
            {r.amounts.map((a, i) => (
              <td key={i} className={`${NUM} py-2.5`}>
                {isBlank(i) ? null : figure(r.account_id, String(i), a, "font-normal")}
              </td>
            ))}
            {showLast ? (
              <td className={`${NUM} ${TOTAL_TINT} py-2.5 ${EDGE}`}>
                {compare ? (
                  <span className="figures px-1 font-medium text-ink">
                    {lastOf(r.amounts) === null ? null : signed(lastOf(r.amounts) as number)}
                  </span>
                ) : (
                  figure(r.account_id, "all", r.total, "font-medium")
                )}
              </td>
            ) : null}
          </tr>
          {openMonth !== null && list.length === 0 ? (
            <tr className="border-b border-line/70 bg-fill/30">
              <td colSpan={cols} className={`px-3 py-2 text-[12px] text-mute-soft ${EDGE} first:pl-[3.25rem]`}>
                No entries found.
              </td>
            </tr>
          ) : null}
          {list.map(({ e, col }, n) => (
            <tr key={`${e.entry_id}-${n}`} className="border-b border-line/60 bg-fill/30 text-[12px]">
              <td className={`px-3 py-1.5 ${EDGE} first:pl-[3.25rem]`}>
                <span className="flex items-baseline gap-3">
                  <span className="figures w-14 shrink-0 text-mute">{shortDate(e.entry_date, today)}</span>
                  <span className="min-w-0 flex-1 break-words text-ink">
                    {e.bank_description ? (
                      <Link
                        href={`/bank-feed?status=posted&q=${encodeURIComponent(e.bank_description)}`}
                        className="underline-offset-2 hover:underline"
                        title="Open this transaction on the bank feed"
                      >
                        {e.memo}
                      </Link>
                    ) : (
                      e.memo
                    )}
                  </span>
                </span>
              </td>
              {labels.map((_, i) => (
                <td key={i} className={`${NUM} py-1.5 ${i === col ? "text-ink" : "text-mute-soft"}`}>
                  {money(i === col ? e.amount : 0)}
                </td>
              ))}
              {showLast ? (
                <td className={`${NUM} ${TOTAL_TINT} py-1.5 text-ink ${EDGE}`}>{compare ? null : money(e.amount)}</td>
              ) : null}
            </tr>
          ))}
        </Fragment>
      );
    });

  const section = (
    label: string,
    rows: MergedRow[],
    totals: number[],
    totalLabel: string,
    action?: React.ReactNode,
  ) => (
    <>
      <tr>
        <td
          colSpan={cols}
          className="border-b border-line bg-paper px-3 py-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-section-label first:pl-5 last:pr-5"
        >
          <span className="flex items-center justify-between">
            <button
              type="button"
              aria-expanded={!folded[label]}
              onClick={() => setFolded((f) => ({ ...f, [label]: !f[label] }))}
              className="-my-3 inline-flex items-center gap-3 py-3 uppercase tracking-[0.07em]"
            >
              <ChevronRight
                size={14}
                strokeWidth={1.6}
                aria-hidden="true"
                className={`shrink-0 transition-transform ${folded[label] ? "" : "rotate-90"}`}
              />
              {label}
            </button>
            {action}
          </span>
        </td>
      </tr>
      {folded[label] ? null : lineRows(rows)}
      <tr className="border-t-2 border-line-strong bg-fill/50">
        <td className={`px-3 py-2.5 font-medium text-ink ${EDGE} first:pl-[46px]`}>{totalLabel}</td>
        {totals.map((t, i) => (
          <td key={i} className={`${NUM} py-2.5 font-medium text-ink`}>
            {isBlank(i) ? null : money(t)}
          </td>
        ))}
        {showLast ? (
          <td className={`${NUM} bg-fill py-2.5 font-medium text-ink ${EDGE}`}>
            {lastOf(totals) === null ? null : compare ? signed(lastOf(totals) as number) : money(lastOf(totals) as number)}
          </td>
        ) : null}
      </tr>
    </>
  );

  const th = "h-10 whitespace-nowrap px-3 text-[12px] font-medium text-ink bg-[var(--w-head-strong)] shadow-[inset_0_-1px_0_0_var(--w-head-line)]";

  return (
    <div className="-mx-5 -my-4 overflow-x-auto rounded-b-[7px]">
      <table className="w-full min-w-[26rem] text-[13px]">
        <thead>
          <tr>
            <th className={`${th} text-left first:pl-5`}>Category</th>
            {labels.map((l) => (
              <th key={l} className={`${th} w-[6.75rem] border-l border-line/60 text-right ${showLast ? "" : "pr-5"}`}>
                {l}
              </th>
            ))}
            {showLast ? (
              <th className={`${th} w-[6.75rem] border-l border-line/60 pr-5 text-right`}>{compare ? "Difference" : "Total"}</th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {section("Income", income, totalIncome, "Total income")}
          {section(
            "Expenses",
            expenses,
            totalExpenses,
            "Total expenses",
          )}
          <tr className="border-t-2 border-ink">
            <td className={`px-3 py-3 text-[14px] font-bold text-ink ${EDGE} first:pl-[46px]`}>{total.label}</td>
            {net.map((n, i) => {
              if (isBlank(i)) return <td key={i} className={`${NUM} py-3`} />;
              const b = bottomLine(n);
              return (
                <td key={i} className={`${NUM} py-3 text-[14px] font-bold ${b.tone}`}>
                  {b.text}
                </td>
              );
            })}
            {showLast ? (
              <td className={`${NUM} ${TOTAL_TINT} py-3 text-[14px] font-bold ${compare ? "text-ink" : total.tone} ${EDGE}`}>
                {compare ? (lastOf(net) === null ? null : signed(lastOf(net) as number)) : total.text}
              </td>
            ) : null}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
