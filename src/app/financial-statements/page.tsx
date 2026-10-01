import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Answer, Card, Empty, Restricted, money } from "@/components/ui";
import { shortDate, todayIso } from "@/lib/dates";
import { statementHref, type PeriodBounds, type PeriodGrain } from "./periods";
import { loadStatement, type AccountLine, type LineEntry } from "./data";
import { headlineFor, periodOptions, varianceWords } from "./summary";
import { PeriodPicker } from "./period-picker";

export const dynamic = "force-dynamic";

const toolBtn =
  "inline-flex h-9 items-center rounded-md border border-line-strong bg-paper px-3 text-[13px] font-medium text-ink transition-colors hover:bg-fill";
const navBtn =
  "inline-flex h-9 w-9 items-center justify-center rounded-md border border-line-strong bg-paper text-ink transition-colors hover:bg-fill";

function buildEmailDraft(
  associationName: string,
  bounds: PeriodBounds,
  incomeRows: AccountLine[],
  expenseRows: AccountLine[],
  totalIncome: number,
  totalExpenses: number,
): string {
  const subject = `${associationName} — Financial statement — ${bounds.label}`;
  const lines: string[] = [
    associationName,
    `Financial statement — ${bounds.label}`,
    "",
    "A PDF of this statement is attached — download it from the Financial Statements page and attach it here before sending.",
    "",
    "Income",
  ];
  for (const r of incomeRows) lines.push(`  ${r.code}  ${r.account_name}: ${money(r.amount)}`);
  lines.push(`  Total income: ${money(totalIncome)}`, "", "Expenses");
  for (const r of expenseRows) lines.push(`  ${r.code}  ${r.account_name}: ${money(r.amount)}`);
  lines.push(`  Total expenses: ${money(totalExpenses)}`, "", `Net income: ${money(totalIncome - totalExpenses)}`);
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n"))}`;
}

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
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 hover:bg-fill/40 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          size={14}
          strokeWidth={1.75}
          aria-hidden="true"
          className="shrink-0 text-mute-soft transition-transform group-open:rotate-90"
        />
        <span className="min-w-0 flex-1">
          <span className="text-ink">{row.account_name}</span>
          <span className="figures ml-2 text-[11px] text-mute-soft">{row.code}</span>
        </span>
        <span className="hidden w-36 items-center gap-2 sm:flex">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-fill">
            <span
              className={`block h-full rounded-full ${tone === "income" ? "bg-moss" : "bg-brass"}`}
              style={{ width: `${share}%` }}
            />
          </span>
          <span className="figures w-9 text-right text-[11px] text-mute">{Math.round(share)}%</span>
        </span>
        {budget !== null && budget !== undefined ? (
          <span className="hidden w-32 text-right sm:block">
            <span className="figures block text-[12px] text-mute">{money(budget)}</span>
            {variance ? (
              <span className={`block text-[11px] ${TONE_TEXT[variance.tone]}`}>{variance.words}</span>
            ) : null}
          </span>
        ) : null}
        <span className="figures w-28 text-right text-ink">{money(row.amount)}</span>
      </summary>
      <ul className="divide-y divide-line/60 bg-fill/30 pl-10 pr-3 text-[12px]">
        {entries.length === 0 ? (
          <li className="py-2 text-mute-soft">No entries found.</li>
        ) : (
          entries.map((e, i) => (
            <li key={`${e.entry_id}-${i}`} className="flex items-baseline gap-3 py-1.5">
              <span className="figures w-16 shrink-0 text-mute">{shortDate(e.entry_date, today)}</span>
              <span className="min-w-0 flex-1 truncate text-ink">
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
              <span className="figures shrink-0 text-ink">{money(e.amount)}</span>
            </li>
          ))
        )}
      </ul>
    </details>
  );
}

function SectionBand({ label, action }: { label: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between bg-fill/60 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.07em] text-section-label">
      <span>{label}</span>
      {action}
    </div>
  );
}

function TotalRow({ label, amount, strong = false }: { label: string; amount: number; strong?: boolean }) {
  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 ${strong ? "border-t-2 border-ink" : ""}`}>
      <span className={`flex-1 pl-[26px] ${strong ? "text-[14px] font-bold" : "font-semibold"} text-ink`}>{label}</span>
      <span className={`figures w-28 text-right ${strong ? "text-[14px] font-bold" : "font-semibold"} text-ink`}>
        {money(amount)}
      </span>
    </div>
  );
}

export default async function FinancialStatementsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; period?: string; offset?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const period: PeriodGrain =
    sp.period === "quarterly" ? "quarterly" : sp.period === "annual" ? "annual" : "monthly";
  const offset = Math.max(0, Math.trunc(Number(sp.offset ?? 0)) || 0);
  // Old links used view=expenses for "largest first"; sort=size is the same thing.
  const sort: "account" | "size" = sp.sort === "size" || sp.view === "expenses" ? "size" : "account";

  const supabase = await createClient();
  const statement = await loadStatement(supabase, sort === "size" ? "expenses" : "total", period, offset);
  if ("restricted" in statement) return <Restricted what="financial statements" />;

  const {
    association,
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
    position,
    budgetByAccount,
    budgetNote,
    entriesByAccount,
    postedThrough,
  } = statement;
  const rows = [...incomeRows, ...expenseRows];
  const today = todayIso();
  const extra = { sort: sort === "size" ? "size" : undefined };
  const here = (p: PeriodGrain, o: number) => statementHref("/financial-statements", "total", p, o, extra);

  const headline = bounds
    ? headlineFor({
        label: bounds.label,
        totalIncome,
        totalExpenses,
        hasActivity: rows.length > 0,
        prior: prior ? { label: prior.label, netIncome: prior.netIncome, hasActivity: prior.hasActivity } : null,
      })
    : null;

  const emailHref = bounds
    ? buildEmailDraft(association.display_name, bounds, incomeRows, expenseRows, totalIncome, totalExpenses)
    : null;
  const excelHref = statementHref("/financial-statements/export", "total", period, offset);
  const pdfHref = statementHref("/financial-statements/export/pdf", "total", period, offset);
  const yearEndHref = `/financial-statements/export?period=annual&offset=${period === "annual" ? offset : 0}&pack=year-end`;

  const delta = (now: number, before: number | undefined) =>
    before === undefined || !prior?.hasActivity ? null : now - before;
  const deltaWords = (d: number | null) =>
    d === null ? null : Math.abs(d) < 1 ? "same as" : `${d > 0 ? "+" : "−"}${money(Math.abs(d))} vs`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Financial Statements</h1>
        <p className="mt-1 text-mute">
          Built from bank transactions that have been posted to the books — the same numbers as your tax filing
          and budget pages.
        </p>
      </div>

      {unpostedCount > 0 ? (
        <p className="border-l-[3px] border-warning bg-warning-tint px-3 py-2 text-[13px] text-warning-text">
          {unpostedCount} bank transaction{unpostedCount === 1 ? "" : "s"} in this period{" "}
          {unpostedCount === 1 ? "hasn't" : "haven't"} been posted to the books yet — the figures below leave{" "}
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
          <PeriodPicker
            options={periodOptions(fiscalYears)}
            current={{ period, offset }}
            currentLabel={bounds?.label ?? null}
            sort={sort}
          />
          <Link
            href={here(period, Math.max(0, offset - 1))}
            aria-label="Later period"
            aria-disabled={!canGoNewer}
            className={`${navBtn} ${canGoNewer ? "" : "pointer-events-none opacity-40"}`}
          >
            →
          </Link>
        </div>
        {rows.length > 0 ? (
          <div className="flex items-center gap-2">
            <a href={pdfHref} className="inline-flex h-9 items-center rounded-md bg-ink px-4 text-[13px] font-medium text-paper hover:bg-ink-mid">
              Download PDF
            </a>
            <details className="relative">
              <summary
                aria-label="More ways to share"
                className={`${toolBtn} cursor-pointer list-none px-2.5 [&::-webkit-details-marker]:hidden`}
              >
                ···
              </summary>
              <div className="absolute right-0 z-10 mt-1 w-64 rounded-lg border border-line bg-paper p-1 text-[13px] shadow-lg">
                <a href={excelHref} className="block rounded-md px-3 py-2 text-ink hover:bg-fill">
                  Export to Excel
                </a>
                {emailHref ? (
                  <a
                    href={emailHref}
                    className="block rounded-md px-3 py-2 text-ink hover:bg-fill"
                    title="A mailto: link can't carry an attachment — download the PDF, then attach it yourself."
                  >
                    Draft an email
                  </a>
                ) : null}
                <div className="my-1 border-t border-line" />
                <a href={yearEndHref} className="block rounded-md px-3 py-2 hover:bg-fill">
                  <span className="block text-ink">Year-end package for your accountant</span>
                  <span className="block text-[11px] text-mute">Excel: statement, trial balance, general ledger</span>
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
            ? `Posted to the books · current through ${shortDate(postedThrough, today)}`
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
              className="mt-3 inline-block rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid"
            >
              Categorize and post bank transactions →
            </Link>
          </div>
        ) : (
          <div className="space-y-5">
            {headline ? (
              <Answer status={headline.status} headline={headline.headline} detail={headline.detail} />
            ) : null}

            {/* Totals, with the only comparison: against the previous period. */}
            <dl className="grid divide-y divide-line overflow-hidden rounded-lg border border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              {(
                [
                  { label: "Money in", value: totalIncome, d: delta(totalIncome, prior?.totalIncome), tone: "neutral" },
                  { label: "Money out", value: totalExpenses, d: delta(totalExpenses, prior?.totalExpenses), tone: "neutral" },
                  { label: "Left over", value: netIncome, d: delta(netIncome, prior?.netIncome), tone: netIncome < 0 ? "bad" : "good" },
                ] as const
              ).map((cell) => (
                <div key={cell.label} className={`px-5 py-4 ${cell.tone === "bad" ? "bg-bad-tint" : cell.tone === "good" ? "bg-good-tint" : ""}`}>
                  <dt className={`text-[12px] ${cell.tone === "neutral" ? "text-mute" : TONE_TEXT[cell.tone]}`}>{cell.label}</dt>
                  <dd className={`figures mt-1 text-[22px] ${cell.tone === "neutral" ? "text-ink" : TONE_TEXT[cell.tone]}`}>
                    {money(cell.value)}
                  </dd>
                  {cell.d !== null && prior ? (
                    <dd className={`mt-0.5 text-[11px] ${cell.tone === "neutral" ? "text-mute-soft" : TONE_TEXT[cell.tone]} opacity-80`}>
                      {deltaWords(cell.d)} {prior.label}
                    </dd>
                  ) : null}
                </div>
              ))}
            </dl>

            {/* Where the money sits */}
            {position ? (
              <section>
                <h3 className="text-[11px] font-medium uppercase tracking-[0.07em] text-section-label">Where the money sits</h3>
                <dl className="mt-2 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
                  <div className="bg-paper px-4 py-3">
                    <dt className="text-[12px] text-mute">Operating cash</dt>
                    <dd className="figures mt-0.5 text-[17px] text-ink">{money(position.operatingCash)}</dd>
                    <dd className="text-[11px] text-mute-soft">day-to-day account</dd>
                  </div>
                  <div className="bg-paper px-4 py-3">
                    <dt className="text-[12px] text-mute">Reserve</dt>
                    <dd className="figures mt-0.5 text-[17px] text-ink">{money(position.reserveCash)}</dd>
                    <dd className={`text-[11px] ${position.reserveChange > 0 ? "text-good-text" : position.reserveChange < 0 ? "text-bad-text" : "text-mute-soft"}`}>
                      {Math.abs(position.reserveChange) < 1
                        ? "no change this period"
                        : `${position.reserveChange > 0 ? "↑" : "↓"} ${money(Math.abs(position.reserveChange))} this period`}
                    </dd>
                  </div>
                  <div className="bg-paper px-4 py-3">
                    <dt className="text-[12px] text-mute">Owed to us</dt>
                    <dd className="figures mt-0.5 text-[17px] text-ink">{money(position.duesOwed)}</dd>
                    <dd className="text-[11px]">
                      {position.unitsBehind > 0 ? (
                        <Link href="/delinquency" className="text-warning-text underline-offset-2 hover:underline">
                          {position.unitsBehind} unit{position.unitsBehind === 1 ? "" : "s"} behind on dues →
                        </Link>
                      ) : (
                        <span className="text-mute-soft">unpaid dues</span>
                      )}
                    </dd>
                  </div>
                  <div className="bg-paper px-4 py-3">
                    <dt className="text-[12px] text-mute">Owed by us</dt>
                    <dd className="figures mt-0.5 text-[17px] text-ink">{money(position.billsOwed)}</dd>
                    <dd className="text-[11px] text-mute-soft">unpaid bills</dd>
                  </div>
                </dl>
              </section>
            ) : null}

            {/* The statement */}
            <section>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[11px] font-medium uppercase tracking-[0.07em] text-section-label">
                  What came in and went out
                </h3>
                <span className="text-[11px] text-mute-soft">
                  Click a line to see the entries behind it
                  {budgetByAccount ? ` · Budget column is ${budgetNote?.toLowerCase()}` : ""}
                </span>
              </div>
              <div className="mt-2 overflow-hidden rounded-lg border border-line text-[13px]">
                {budgetByAccount ? (
                  <div className="hidden items-center gap-3 border-b border-line px-3 py-1.5 text-[11px] text-mute sm:flex">
                    <span className="w-[14px]" />
                    <span className="flex-1" />
                    <span className="w-36 text-right">Share</span>
                    <span className="w-32 text-right">Budget</span>
                    <span className="w-28 text-right">Actual</span>
                  </div>
                ) : null}

                <SectionBand label="Income" />
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
                <TotalRow label="Total income" amount={totalIncome} />

                <SectionBand
                  label="Expenses"
                  action={
                    <Link
                      href={statementHref("/financial-statements", "total", period, offset, {
                        sort: sort === "size" ? undefined : "size",
                      })}
                      className="normal-case tracking-normal text-mute underline-offset-2 hover:text-ink hover:underline"
                    >
                      {sort === "size" ? "Sort by account" : "Sort by size"}
                    </Link>
                  }
                />
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
                <TotalRow label="Total expenses" amount={totalExpenses} />
                <TotalRow label={netIncome < 0 ? "Left over (short)" : "Left over"} amount={netIncome} strong />
              </div>
            </section>
          </div>
        )}
      </Card>
    </div>
  );
}
