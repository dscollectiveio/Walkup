import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty } from "@/components/ui";
import { btnSecondary } from "@/components/repairs/styles";
import { ViewerUnavailable } from "@/components/owner/viewer-unavailable";
import { getViewer } from "@/lib/owner/viewer";
import { shortDate, todayIso } from "@/lib/dates";
import {
  OWNER_FINANCES_COPY as COPY,
  budgetWords,
  dollars,
  lineBarPercent,
  lineWords,
  netWords,
  parseOwnerFinances,
  spendingPace,
  type FinanceBudget,
  type FinancePeriod,
} from "@/lib/owner/finances";

export const dynamic = "force-dynamic";

function PeriodCard({ title, period, emptyText, today }: { title: string; period: FinancePeriod | null; emptyText: string; today: string }) {
  if (!period) {
    return (
      <Card navy title={title}>
        <Empty>{emptyText}</Empty>
      </Card>
    );
  }
  const range = `${shortDate(period.startsOn, today)} to ${shortDate(period.endsOn, today)}`;
  return (
    <Card navy title={`${title} (${period.label})`} hint={range}>
      {period.hasActivity ? (
        <div className="space-y-3">
          <dl className="grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-[12px] text-mute">{COPY.income}</dt>
              <dd className="figures text-[20px] font-semibold text-ink">{dollars(period.income)}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-mute">{COPY.expenses}</dt>
              <dd className="figures text-[20px] font-semibold text-ink">{dollars(period.expenses)}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-mute">{COPY.net}</dt>
              <dd className="figures text-[20px] font-semibold text-ink">{dollars(period.net)}</dd>
            </div>
          </dl>
          <p className="text-[14px] text-ink">{netWords(period)}</p>
        </div>
      ) : (
        <Empty>{COPY.noActivity}</Empty>
      )}
    </Card>
  );
}

function BudgetCard({ budget }: { budget: FinanceBudget | null }) {
  if (!budget) {
    return (
      <Card navy title={COPY.budgetTitle}>
        <Empty>{COPY.noBudget}</Empty>
      </Card>
    );
  }
  const words = budgetWords(budget);
  const pace = spendingPace(budget);
  const tone =
    pace.status === "over"
      ? "border-bad bg-bad-tint text-bad-text"
      : pace.status === "watch"
        ? "border-warning bg-warning-tint text-warning-text"
        : "border-line bg-fill text-ink";
  const expenses = budget.lines.filter((l) => l.type === "expense");
  return (
    <Card navy title={`${COPY.budgetTitle} (${budget.fiscalYear})`}>
      <div className="space-y-3">
        <p className={`border-l-[3px] px-3 py-2 text-[14px] ${tone}`}>{words.spending}</p>
        {words.income ? <p className="text-[14px] text-ink">{words.income}</p> : null}
        {expenses.length > 0 ? (
          <ul className="divide-y divide-line border-t border-line">
            {expenses.map((l) => (
              <li key={l.name} className="py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-[14px] text-ink">{l.name}</span>
                  <span className="figures text-[13px] text-mute">{lineWords(l)}</span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-fill" aria-hidden="true">
                  <div className="h-full rounded-full bg-slate" style={{ width: `${lineBarPercent(l)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * The association's money in simple form, for owners (migration 0079). Visible only while a board admin has
 * switched it on; the figures come from owner_finances_summary(), which returns totals and nothing else.
 */
export default async function OwnerFinancesPage() {
  const viewer = await getViewer();
  if (!viewer) return <ViewerUnavailable />;
  const supabase = await createClient();
  const today = todayIso();

  const header = (
    <div>
      <h1 className="text-[20px] font-bold tracking-tight text-ink">{COPY.title}</h1>
      <p className="mt-1 text-mute">{COPY.intro}</p>
    </div>
  );

  const { data: enabled } = await supabase.rpc("owner_finances_enabled", { p_association_id: viewer.associationId });
  if (enabled !== true) {
    return (
      <div className="mx-auto w-full max-w-[760px] space-y-6">
        {header}
        <Card navy title={COPY.title}>
          <p className="text-[14px] text-ink">{COPY.notAvailable}</p>
          <p className="mt-4">
            <Link href={viewer.ownedUnitIds.length > 0 ? "/owner" : "/"} className={btnSecondary}>
              Go back
            </Link>
          </p>
        </Card>
      </div>
    );
  }

  const { data, error } = await supabase.rpc("owner_finances_summary", { p_association_id: viewer.associationId });
  const summary = error ? null : parseOwnerFinances(data);
  if (error) console.error("[owner] owner_finances_summary", error.code ?? "-");
  if (!summary) {
    return (
      <div className="mx-auto w-full max-w-[760px] space-y-6">
        {header}
        <Card navy title={COPY.title}>
          <p className="text-[14px] text-ink">{COPY.couldNotLoad}</p>
        </Card>
      </div>
    );
  }

  const nothingAtAll =
    !summary.yearToDate?.hasActivity && !summary.lastYear?.hasActivity && !summary.cash?.hasData && !summary.budget;
  if (nothingAtAll) {
    return (
      <div className="mx-auto w-full max-w-[760px] space-y-6">
        {header}
        <Card navy title={COPY.title}>
          <Empty>{COPY.noData}</Empty>
        </Card>
      </div>
    );
  }

  const cash = summary.cash;
  return (
    <div className="mx-auto w-full max-w-[760px] space-y-6">
      {header}

      <Card navy title={COPY.cashTitle} hint={cash?.hasData ? `As of ${shortDate(cash.asOf, today)}` : undefined}>
        {cash?.hasData ? (
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-[12px] text-mute">{COPY.operatingLabel}</dt>
              <dd className="figures text-[20px] font-semibold text-ink">{dollars(cash.operating)}</dd>
            </div>
            {cash.hasReserveFund ? (
              <div>
                <dt className="text-[12px] text-mute">{COPY.reserveLabel}</dt>
                <dd className="figures text-[20px] font-semibold text-ink">{dollars(cash.reserve)}</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <Empty>{COPY.noCash}</Empty>
        )}
      </Card>

      <PeriodCard title={COPY.yearToDateTitle} period={summary.yearToDate} emptyText={COPY.noActivity} today={today} />
      <PeriodCard title={COPY.lastYearTitle} period={summary.lastYear} emptyText={COPY.noLastYear} today={today} />
      <BudgetCard budget={summary.budget} />

      <p className="text-[12px] text-mute">
        {COPY.footnote}
        {summary.postedThrough ? ` The books are posted through ${shortDate(summary.postedThrough, today)}.` : ""}
      </p>
    </div>
  );
}
