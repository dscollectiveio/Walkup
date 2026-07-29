import { queryAs } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { Card, Empty, Stat, UnitLink, money } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const userId = await getCurrentUserId();

  const [associations, funds, arrears, units, balance] = await Promise.all([
    queryAs<{ id: string; display_name: string; state_code: string; fiscal_year_end_month: number }>(
      userId,
      `select id, display_name, state_code, fiscal_year_end_month from associations`,
    ),
    queryAs<{ name: string; net: string }>(
      userId,
      `select f.name, coalesce(sum(l.debit - l.credit), 0)::text as net
         from funds f
         left join journal_lines l on l.fund_id = f.id
         left join journal_entries e on e.id = l.journal_entry_id and e.is_posted
         left join accounts a on a.id = l.account_id and a.is_cash_account
        where a.is_cash_account
        group by f.name order by f.name`,
    ),
    queryAs<{ owed: string; units: number }>(
      userId,
      `select coalesce(sum(balance), 0)::text as owed,
              count(distinct unit_id)::int as units
         from charge_balances where status not in ('paid','waived','written_off')`,
    ),
    // visible_charges distinguishes "this unit owes nothing" from "row-level
    // security is hiding this unit's charges from you". Without it an owner
    // sees a confident $0.00 next to a neighbour who is $1,000 behind, which
    // is worse than showing nothing at all.
    queryAs<{ id: string; label: string; owed: string; visible_charges: number }>(
      userId,
      `select u.id, u.label,
              count(cb.id)::int as visible_charges,
              coalesce(sum(cb.balance) filter (
                where cb.status not in ('paid','waived','written_off')), 0)::text as owed
         from units u
         left join charge_balances cb on cb.unit_id = u.id
        group by u.id, u.label order by u.sort_order`,
    ),
    queryAs<{ rows: number; debits: string; credits: string }>(
      userId,
      `select count(*)::int as rows,
              coalesce(sum(total_debit),0)::text debits,
              coalesce(sum(total_credit),0)::text credits from trial_balance`,
    ),
  ]);

  const association = associations[0];
  const ledgerVisible = (balance[0]?.rows ?? 0) > 0;
  const ties = ledgerVisible && balance[0].debits === balance[0].credits;

  if (!association) {
    return (
      <Empty>No association is visible to you. Row-level security is doing its job.</Empty>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {association.display_name}
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          {association.state_code} · fiscal year ends month{" "}
          {association.fiscal_year_end_month} · 2026
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {funds.map((f) => (
          <Stat key={f.name} label={`${f.name} cash`} value={money(f.net)} />
        ))}
        <Stat
          label="Owed to the association"
          value={money(arrears[0]?.owed ?? "0")}
          tone={Number(arrears[0]?.owed ?? 0) > 0 ? "bad" : "good"}
          note={
            Number(arrears[0]?.units ?? 0) > 0
              ? `${arrears[0].units} unit${arrears[0].units === 1 ? "" : "s"} behind`
              : "all current"
          }
        />
      </div>

      <Card
        title="Trial balance"
        hint="Every posted entry, both sides. If these differ, something is wrong at the database level."
      >
        {ledgerVisible ? (
          <div className="flex items-center gap-8">
            <div>
              <div className="text-xs uppercase tracking-wide text-stone-500">Debits</div>
              <div className="tabular text-lg font-medium">{money(balance[0].debits)}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-stone-500">Credits</div>
              <div className="tabular text-lg font-medium">{money(balance[0].credits)}</div>
            </div>
            <div
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                ties ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
              }`}
            >
              {ties ? "Balanced" : "OUT OF BALANCE"}
            </div>
          </div>
        ) : (
          <Empty>
            The general ledger is not visible to you. Owners see their own unit
            statement rather than the ledger.
          </Empty>
        )}
      </Card>

      <Card title="Units" hint="Owners see only their own.">
        {units.length === 0 ? (
          <Empty>No units are visible to you.</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
                <th className="pb-2 font-medium">Unit</th>
                <th className="pb-2 text-right font-medium">Balance owed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {units.map((u) => (
                <tr key={u.id}>
                  <td className="py-2.5">
                    <UnitLink id={u.id} label={u.label} />
                  </td>
                  {u.visible_charges === 0 ? (
                    <td className="py-2.5 text-right text-xs text-stone-400">
                      not visible to you
                    </td>
                  ) : (
                    <td
                      className={`tabular py-2.5 text-right ${
                        Number(u.owed) > 0
                          ? "font-medium text-red-700"
                          : "text-stone-600"
                      }`}
                    >
                      {money(u.owed)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
