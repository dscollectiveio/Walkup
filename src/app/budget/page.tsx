import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Restricted, money } from "@/components/ui";
import { BudgetRow } from "./budget-row";

export const dynamic = "force-dynamic";

/**
 * "This month" tracks spend against a run-rate target (annual budget / 12),
 * not an independently-set monthly amount — budget_lines stores one number
 * per account per fiscal year, and that's the number a board actually sets.
 * See docs on migration 0028.
 */
function monthlyTone(pct: number): "good" | "warning" | "bad" {
  if (pct >= 100) return "bad";
  if (pct >= 90) return "warning";
  return "good";
}

export default async function BudgetPage() {
  const supabase = await createClient();

  const { data: associations } = await supabase
    .from("associations")
    .select("id, display_name");
  const association = associations?.[0];
  if (!association) return <Restricted what="the budget" />;

  const { data: isMemberRes } = await supabase.rpc("is_member", {
    assoc: association.id,
  });
  if (isMemberRes !== true) return <Restricted what="the budget" />;

  const [{ data: isBoardRes }, { data: canReadFinancialsRes }] = await Promise.all([
    supabase.rpc("is_board", { assoc: association.id }),
    supabase.rpc("can_read_financials", { assoc: association.id }),
  ]);
  const canEdit = isBoardRes === true;
  // Board + accountant, matching the RLS on `expenses` (and therefore on
  // monthly_expense_actuals and budget_vs_actual's `actual`/`variance`,
  // which both read from expense/ledger detail owners can't see).
  const canSeeActuals = canReadFinancialsRes === true;

  const { data: fiscalYears } = await supabase
    .from("fiscal_years")
    .select("id, label, starts_on, ends_on")
    .order("starts_on", { ascending: false })
    .limit(1);
  const fiscalYear = fiscalYears?.[0];

  const { data: funds } = await supabase
    .from("funds")
    .select("id, name")
    .eq("kind", "operating")
    .limit(1);
  const operatingFund = funds?.[0];

  if (!fiscalYear || !operatingFund) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-ink">Budget</h1>
        </div>
        <Card title="Budget">
          <Empty>
            {!fiscalYear
              ? "No fiscal year is set up yet."
              : "No operating fund is set up yet."}
          </Empty>
        </Card>
      </div>
    );
  }

  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, code, name")
    .eq("type", "expense")
    .eq("is_active", true)
    .order("code");

  const [{ data: annualRows }, { data: monthlyRows }] = await Promise.all([
    supabase
      .from("budget_vs_actual")
      .select("account_id, budgeted, actual, variance")
      .eq("association_id", association.id)
      .eq("fiscal_year_id", fiscalYear.id)
      .eq("fund_id", operatingFund.id),
    supabase
      .from("monthly_expense_actuals")
      .select("account_id, month, total")
      .eq("association_id", association.id)
      .eq("fund_id", operatingFund.id),
  ]);

  const currentMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  const annualByAccount = new Map(
    (annualRows ?? []).map((r) => [
      r.account_id,
      { budgeted: Number(r.budgeted), actual: Number(r.actual), variance: Number(r.variance) },
    ]),
  );
  const thisMonthByAccount = new Map(
    (monthlyRows ?? [])
      .filter((r) => r.month.slice(0, 7) === currentMonth)
      .map((r) => [r.account_id, Number(r.total)]),
  );

  const accountList = accounts ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">Budget</h1>
        <p className="mt-1 text-mute">
          {fiscalYear.label} — spending against the operating budget the
          board approved, tracked by month and for the year.
        </p>
      </div>

      <Card
        title="This month"
        hint="Each category's spend so far this month against 1/12 of its annual budget."
      >
        {!canSeeActuals ? (
          <Empty>Spend detail is visible to board members and the accountant.</Empty>
        ) : accountList.length === 0 ? (
          <Empty>No expense accounts on file.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {accountList.map((a) => {
              const annual = annualByAccount.get(a.id);
              const monthlyTarget = annual?.budgeted ? annual.budgeted / 12 : null;
              const spent = thisMonthByAccount.get(a.id) ?? 0;
              const pct = monthlyTarget ? Math.min(200, (spent / monthlyTarget) * 100) : null;
              const tone = pct !== null ? monthlyTone(pct) : "neutral";
              const fillClass =
                tone === "bad" ? "bg-bad" : tone === "warning" ? "bg-warning" : "bg-moss";

              return (
                <li key={a.id} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[13px] font-medium text-ink">{a.name}</span>
                    {monthlyTarget !== null ? (
                      <span className="figures text-[12px] text-mute">
                        {money(spent)} of {money(monthlyTarget)} this month
                      </span>
                    ) : (
                      <span className="text-[11px] text-mute-soft">no budget set</span>
                    )}
                  </div>
                  {monthlyTarget !== null ? (
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-fill">
                      <div
                        className={`h-full rounded-full ${fillClass}`}
                        style={{ width: `${Math.min(100, pct ?? 0)}%` }}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card
        title="Annual budget"
        hint={
          canEdit
            ? "Set each category's budget for the year; actual and variance update from posted expenses."
            : "What the board has budgeted for the year, and how spending compares so far."
        }
      >
        {accountList.length === 0 ? (
          <Empty>No expense accounts on file.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-mute">
                  <th className="pb-2 font-medium">Code</th>
                  <th className="pb-2 font-medium">Account</th>
                  <th className="pb-2 text-right font-medium">Annual budget</th>
                  <th className="pb-2 text-right font-medium">YTD actual</th>
                  <th className="pb-2 text-right font-medium">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {accountList.map((a) => {
                  const annual = annualByAccount.get(a.id);
                  return (
                    <BudgetRow
                      key={a.id}
                      associationId={association.id}
                      fiscalYearId={fiscalYear.id}
                      fundId={operatingFund.id}
                      accountId={a.id}
                      code={a.code}
                      name={a.name}
                      budgeted={annual?.budgeted ?? null}
                      actual={annual?.actual ?? 0}
                      variance={annual ? annual.variance : null}
                      canEdit={canEdit}
                      canSeeActuals={canSeeActuals}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
