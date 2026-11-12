import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Download, MoreHorizontal } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Restricted, money } from "@/components/ui";
import { BoardOnly, viewerIsOwnerOnly } from "@/components/board-only";
import { shortDate, todayIso } from "@/lib/dates";
import { statementHref, type PeriodGrain } from "./periods";
import { loadStatement, type AccountLine, type LineEntry } from "./data";
import { headlineFor, parseSelection, varianceWords } from "./summary";
import {
  activePick,
  booksStartIdx,
  clampRange,
  idxOfIso,
  parseKey,
  pickerStateFor,
  resolveView,
} from "./range";
import { MultiPeriodView } from "./multi-view";
import { DownloadMenu, ReportActions } from "./report-actions";
import { buildReport } from "./report";
import { PeriodPicker } from "./period-picker";
import { btnPrimary } from "@/components/repairs/styles";

export const dynamic = "force-dynamic";

const toolBtn =
  "inline-flex h-11 items-center rounded-md border border-line-strong bg-paper px-3 text-[13px] font-medium text-ink transition-colors hover:bg-fill sm:h-9";
const navBtn =
  "inline-flex h-11 w-11 items-center justify-center rounded-md border border-line-strong bg-paper text-ink transition-colors hover:bg-fill sm:h-9 sm:w-9";

const TONE_TEXT = { good: "text-good-text", bad: "text-bad-text", neutral: "text-mute" } as const;

/** One account row: click to see the entries behind the number. */
function LineRow({
  row,
  share,
  budget,
  entries,
  today,
  tone,
}: {
  row: AccountLine;
  share: number;
  budget: number | null | undefined;
  entries: LineEntry[];
  today: string;
  tone: "income" | "expense";
}) {
  const variance = budget !== null && budget !== undefined ? varianceWords(row.amount, budget, row.account_type) : null;
  return (
    <details className="group border-b border-line/70 last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-2.5 hover:bg-fill/40 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          size={14}
          strokeWidth={1.6}
          aria-hidden="true"
          className="shrink-0 text-mute-soft transition-transform group-open:rotate-90"
        />
        <span className="min-w-0 flex-1">
          <span className="text-ink">{row.account_name}</span>
          {variance ? (
            <span className={`block text-[12px] sm:hidden ${TONE_TEXT[variance.tone]}`}>{variance.words}</span>
          ) : null}
        </span>
        <span className="-my-2.5 hidden w-36 items-center gap-2 self-stretch border-l border-line/60 pl-3 sm:flex">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-fill">
            <span
              className={`block h-full rounded-full ${tone === "income" ? "bg-moss" : "bg-brass"}`}
              style={{ width: `${share}%` }}
            />
          </span>
          <span className="figures w-9 text-right text-[11px] text-mute">{Math.round(share)}%</span>
        </span>
        {budget !== null && budget !== undefined ? (
          <span className="-my-2.5 hidden w-32 flex-col justify-center self-stretch border-l border-line/60 px-3 text-right sm:flex">
            <span className="figures block text-[12px] text-mute">{money(budget)}</span>
            {variance ? (
              <span className={`block text-[11px] ${TONE_TEXT[variance.tone]}`}>{variance.words}</span>
            ) : null}
          </span>
        ) : null}
        <span className="figures -my-2.5 -mr-5 flex w-32 items-center justify-end self-stretch whitespace-nowrap border-l border-line/60 bg-[var(--w-total-col)] pl-3 pr-5 font-medium text-ink">{money(row.amount)}</span>
      </summary>
      <ul className="divide-y divide-line/60 bg-fill/30 pl-[3.25rem] pr-5 text-[12px]">
        {entries.length === 0 ? (
          <li className="py-2 text-mute-soft">No entries found.</li>
        ) : (
          entries.map((e, i) => (
            <li key={`${e.entry_id}-${i}`} className="flex items-baseline gap-3 py-2.5 sm:py-1.5">
              <span className="figures w-16 shrink-0 text-mute">{shortDate(e.entry_date, today)}</span>
              <span className="min-w-0 flex-1 break-words text-ink sm:truncate">
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
              <span className="figures shrink-0 whitespace-nowrap text-ink">{money(e.amount)}</span>
            </li>
          ))
        )}
      </ul>
    </details>
  );
}

function SectionBand({ label, action, collapsible = false }: { label: string; action?: React.ReactNode; collapsible?: boolean }) {
  const cls =
    "flex items-center justify-between border-b border-line bg-paper px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-section-label";
  if (!collapsible) {
    return (
      <div className={cls}>
        <span>{label}</span>
        {action}
      </div>
    );
  }
  return (
    <summary className={`${cls} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
      <span className="inline-flex items-center gap-3">
        <ChevronRight size={14} strokeWidth={1.6} aria-hidden="true" className="shrink-0 transition-transform group-open/sec:rotate-90" />
        {label}
      </span>
      {action}
    </summary>
  );
}

function TotalRow({
  label,
  amount,
  strong = false,
  bad = false,
  rails = false,
  budget,
  type,
}: {
  label: string;
  amount: number;
  strong?: boolean;
  bad?: boolean;
  /** The Share and Budget columns are showing: keep their dividing lines running through this row. */
  rails?: boolean;
  /** This total's budget, with how far the actual is over or under it. */
  budget?: number | null;
  type?: "income" | "expense";
}) {
  const variance = budget !== null && budget !== undefined && type ? varianceWords(amount, budget, type) : null;
  return (
    <div className={`flex items-center gap-3 px-5 py-2.5 ${strong ? "border-t-2 border-ink py-3" : "border-t-2 border-line-strong bg-fill/50"}`}>
      <span className={`flex-1 pl-[26px] ${strong ? "text-[14px] font-bold" : "font-medium"} text-ink`}>{label}</span>
      {rails ? (
        <>
          <span aria-hidden="true" className={`${strong ? "-my-3" : "-my-2.5"} hidden w-36 self-stretch border-l border-line/60 sm:block`} />
          <span className={`${strong ? "-my-3" : "-my-2.5"} hidden w-32 flex-col justify-center self-stretch border-l border-line/60 px-3 text-right sm:flex`}>
            {budget !== null && budget !== undefined ? (
              <>
                <span className="figures block text-[12px] font-normal text-mute">{money(budget)}</span>
                {variance ? <span className={`block text-[11px] font-normal ${TONE_TEXT[variance.tone]}`}>{variance.words}</span> : null}
              </>
            ) : null}
          </span>
        </>
      ) : null}
      <span
        className={`figures ${strong ? "-my-3" : "-my-2.5"} -mr-5 flex w-32 items-center justify-end self-stretch border-l border-line/60 pl-3 ${strong ? "bg-[var(--w-total-col)]" : "bg-fill"} pr-5 ${strong ? `text-[14px] font-bold ${bad ? "text-bad-text" : "text-good-text"}` : "font-medium text-ink"}`}
      >
        {money(amount)}
      </span>
    </div>
  );
}

export default async function FinancialStatementsPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    period?: string;
    offset?: string;
    periods?: string;
    from?: string;
    to?: string;
    cols?: string;
    cmp?: string;
    from2?: string;
    to2?: string;
    pick?: string;
  }>;
}) {
  const sp = await searchParams;
  const period: PeriodGrain =
    sp.period === "quarterly" ? "quarterly" : sp.period === "annual" ? "annual" : "monthly";
  const offset = Math.max(0, Math.trunc(Number(sp.offset ?? 0)) || 0);

  const supabase = await createClient();
  const statement = await loadStatement(supabase, "total", period, offset);
  if ("restricted" in statement) {
    if (await viewerIsOwnerOnly()) {
      return (
        <BoardOnly
          what="Financial statements"
          why="Profit and loss reports are shared with owners as documents when the board decides to."
          alternative={{ label: "See documents shared with you", href: "/documents" }}
        />
      );
    }
    return <Restricted what="financial statements" />;
  }

  // A date range, a comparison, or several periods: side-by-side columns. One month is just the ordinary view.
  const todayStr = todayIso();
  const nowIdx = idxOfIso(todayStr);
  const view = resolveView(sp, statement.fiscalYears, todayStr);
  const from = parseKey(sp.from);
  if (view) {
    const first =
      view.kind === "compare" ? view.p1 : view.kind === "combined" ? view.range : (view.range ?? { from: nowIdx, to: nowIdx });
    const state = pickerStateFor(view, first, activePick(sp.pick, first, todayStr, statement.fiscalYears));
    return <MultiPeriodView view={view} fiscalYears={statement.fiscalYears} state={state} />;
  }
  if (sp.from && from !== null) {
    // A "range" of one month: the ordinary single-month view.
    const only = clampRange(from, parseKey(sp.to) ?? from, booksStartIdx(statement.fiscalYears) ?? nowIdx - 11, nowIdx);
    redirect(statementHref("/financial-statements", "total", "monthly", nowIdx - only.from, { pick: sp.pick }));
  }
  if (sp.periods) {
    const selection = parseSelection(sp.periods, statement.fiscalYears, todayStr);
    if (selection) {
      redirect(statementHref("/financial-statements", "total", selection.grain, selection.items[0].offset));
    }
  }

  const {
    bounds,
    fiscalYears,
    incomeRows,
    expenseRows,
    totalIncome,
    totalExpenses,
    netIncome,
    unpostedCount,
    canGoNewer,
    canGoOlder,
    prior,
    budgetByAccount,
    budgetNote,
    budgetTotals,
    entriesByAccount,
    postedThrough,
  } = statement;
  const rows = [...incomeRows, ...expenseRows];
  const today = todayIso();
  const shownRange = bounds ? { from: idxOfIso(bounds.start), to: idxOfIso(bounds.end) } : { from: nowIdx, to: nowIdx };
  const pickerState = pickerStateFor(null, shownRange, activePick(sp.pick, shownRange, today, fiscalYears));
  const here = (p: PeriodGrain, o: number) => statementHref("/financial-statements", "total", p, o);

  const headline = bounds
    ? headlineFor({
        label: bounds.label,
        totalIncome,
        totalExpenses,
        hasActivity: rows.length > 0,
        prior: prior ? { label: prior.label, netIncome: prior.netIncome, hasActivity: prior.hasActivity } : null,
      })
    : null;

  const report = buildReport([statement]);
  const excelHref = statementHref("/financial-statements/export", "total", period, offset);
  const pdfHref = statementHref("/financial-statements/export/pdf", "total", period, offset);
  const yearEndHref = `/financial-statements/export?period=annual&offset=${period === "annual" ? offset : 0}&pack=year-end`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Financial Statements</h1>
        <p className="mt-1 text-mute">
          Built from bank transactions that have been posted to the books: the same numbers as your tax filing
          and budget pages.
        </p>
      </div>

      {unpostedCount > 0 ? (
        <p className="border-l-[3px] border-warning bg-warning-tint px-3 py-2 text-[13px] text-warning-text">
          {unpostedCount} bank transaction{unpostedCount === 1 ? "" : "s"} in this period{" "}
          {unpostedCount === 1 ? "hasn't" : "haven't"} been posted to the books yet: the figures below leave{" "}
          {unpostedCount === 1 ? "it" : "them"} out.{" "}
          <Link href="/bank-feed?status=needs" className="underline underline-offset-2">
            Categorize on the bank feed →
          </Link>
        </p>
      ) : null}

      {/* One line of controls: period on the left, sharing on the right. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <Link
            href={here(period, offset + 1)}
            aria-label="Earlier period"
            aria-disabled={!canGoOlder}
            className={`${navBtn} ${canGoOlder ? "" : "pointer-events-none opacity-40"}`}
          >
            ←
          </Link>
          <PeriodPicker state={pickerState} fiscalYears={fiscalYears} today={today} />
          <Link
            href={here(period, Math.max(0, offset - 1))}
            aria-label="Later period"
            aria-disabled={!canGoNewer}
            className={`${navBtn} ${canGoNewer ? "" : "pointer-events-none opacity-40"}`}
          >
            →
          </Link>
        </div>
        {rows.length === 0 && bounds ? (
          // Nothing posted in this period: no PDF or email to share, but the Excel file is still on offer.
          <DownloadMenu excelHref={excelHref} />
        ) : null}
        {rows.length > 0 && report ? (
          <div className="relative flex flex-wrap items-center gap-2">
            <ReportActions report={report} pdfHref={pdfHref} excelHref={excelHref} />
            <details className="sm:relative">
              <summary
                aria-label="More ways to share"
                className={`${toolBtn} cursor-pointer list-none px-2.5 [&::-webkit-details-marker]:hidden`}
              >
                <MoreHorizontal size={18} strokeWidth={2.4} aria-hidden="true" />
              </summary>
              <div className="absolute inset-x-0 z-10 mt-1 min-w-[16rem] rounded-lg border border-line bg-paper p-1 text-[13px] shadow-lg sm:inset-x-auto sm:right-0 sm:w-64">
                <a href={yearEndHref} download className="flex min-h-[44px] items-center gap-2.5 rounded-md px-3 py-2 hover:bg-fill">
                  <Download size={16} strokeWidth={1.8} aria-hidden="true" className="shrink-0 text-ink-mid" />
                  <span>
                    <span className="block text-ink">Year-end package for your accountant</span>
                    <span className="block text-[12px] text-mute sm:text-[11px]">Excel: statement, trial balance, general ledger</span>
                  </span>
                </a>
              </div>
            </details>
          </div>
        ) : null}
      </div>

      <Card
        navy
        title={bounds ? bounds.label : "No period available"}
        hint={
          postedThrough
            ? `Posted to the books · current through ${shortDate(postedThrough, today)}${budgetByAccount ? ` · Budget is ${budgetNote?.toLowerCase()}` : ""}`
            : "Posted to the books"
        }
      >
        {!bounds ? (
          <Empty>No fiscal year is set up yet.</Empty>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-[13px] text-mute">{headline?.headline}</p>
            <Link
              href="/bank-feed"
              className={`mt-3 ${btnPrimary}`}
            >
              Categorize and post bank transactions →
            </Link>
          </div>
        ) : (
          <div className="-mx-5 -my-4 overflow-hidden rounded-b-[7px] text-[13px]">
            <div className="flex h-10 items-center gap-3 bg-[var(--w-head-strong)] px-5 text-[12px] font-medium text-ink shadow-[inset_0_-1px_0_0_var(--w-head-line)]">
              <span className="w-[14px]" />
              <span className="flex-1">Category <span className="font-normal text-mute">· click a line to see its entries</span></span>
              {budgetByAccount ? (
                <>
                  <span className="hidden w-36 items-center self-stretch border-l border-line/60 pl-3 sm:flex">Share</span>
                  <span className="hidden w-32 items-center justify-end self-stretch border-l border-line/60 px-3 sm:flex">Budget</span>
                </>
              ) : null}
              <span className="flex w-32 items-center justify-end self-stretch border-l border-line/60 pl-3">Actual</span>
            </div>
            <div>
                <details open className="group/sec">
                <SectionBand label="Income" collapsible />
                {incomeRows.map((r) => (
                  <LineRow
                    key={r.account_id}
                    row={r}
                    share={totalIncome > 0 ? (r.amount / totalIncome) * 100 : 0}
                    budget={budgetByAccount ? (budgetByAccount[r.account_id] ?? null) : undefined}
                    entries={entriesByAccount[r.account_id] ?? []}
                    today={today}
                    tone="income"
                  />
                ))}
                </details>
                <TotalRow label="Total income" amount={totalIncome} rails={Boolean(budgetByAccount)} budget={budgetTotals?.income} type="income" />

                <details open className="group/sec">
                <SectionBand collapsible label="Expenses" />
                {expenseRows.map((r) => (
                  <LineRow
                    key={r.account_id}
                    row={r}
                    share={totalExpenses > 0 ? (r.amount / totalExpenses) * 100 : 0}
                    budget={budgetByAccount ? (budgetByAccount[r.account_id] ?? null) : undefined}
                    entries={entriesByAccount[r.account_id] ?? []}
                    today={today}
                    tone="expense"
                  />
                ))}
                </details>
                <TotalRow label="Total expenses" amount={totalExpenses} rails={Boolean(budgetByAccount)} budget={budgetTotals?.expense} type="expense" />
                <TotalRow label={netIncome < 0 ? "Deficit" : "Excess"} amount={netIncome < 0 ? -netIncome : netIncome} strong bad={netIncome < 0} rails={Boolean(budgetByAccount)} />
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
