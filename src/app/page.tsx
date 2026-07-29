import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Stat, UnitLink, money } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const supabase = await createClient();

  // No association_id filter anywhere below. RLS scopes every one of these to
  // the associations this user actually belongs to — a forgotten WHERE clause
  // cannot leak another building's books.
  const [{ data: associations }, { data: funds }, { data: units }, { data: totals }] =
    await Promise.all([
      supabase
        .from("associations")
        .select("id, display_name, state_code, fiscal_year_end_month"),
      supabase
        .from("fund_cash_balances")
        .select("fund_id, name, cash_balance, visible_lines")
        .order("name"),
      supabase
        .from("unit_balances")
        .select("unit_id, label, balance_owed, visible_charges")
        .order("sort_order"),
      supabase
        .from("association_totals")
        .select("visible_tb_rows, total_debits, total_credits, total_owed, units_behind"),
    ]);

  const association = associations?.[0];
  if (!association) {
    return (
      <Empty>
        No association is visible to you. Row-level security is doing its job.
      </Empty>
    );
  }

  const t = totals?.[0];
  const ledgerVisible = (t?.visible_tb_rows ?? 0) > 0;
  const ties = ledgerVisible && Number(t!.total_debits) === Number(t!.total_credits);
  const visibleFunds = (funds ?? []).filter((f) => f.visible_lines > 0);

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
        {visibleFunds.map((f) => (
          <Stat key={f.fund_id} label={`${f.name} cash`} value={money(f.cash_balance)} />
        ))}
        <Stat
          label="Owed to the association"
          value={money(t?.total_owed ?? 0)}
          tone={Number(t?.total_owed ?? 0) > 0 ? "bad" : "good"}
          note={
            Number(t?.units_behind ?? 0) > 0
              ? `${t!.units_behind} unit${t!.units_behind === 1 ? "" : "s"} behind`
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
              <div className="tabular text-lg font-medium">{money(t!.total_debits)}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-stone-500">Credits</div>
              <div className="tabular text-lg font-medium">{money(t!.total_credits)}</div>
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
        {!units || units.length === 0 ? (
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
                <tr key={u.unit_id}>
                  <td className="py-2.5">
                    <UnitLink id={u.unit_id} label={u.label} />
                  </td>
                  {/* A SUM over zero visible rows is 0. Showing that as $0.00
                      next to a neighbour who is behind would be a lie —
                      DECISIONS #17. */}
                  {u.visible_charges === 0 ? (
                    <td className="py-2.5 text-right text-xs text-stone-400">
                      not visible to you
                    </td>
                  ) : (
                    <td
                      className={`tabular py-2.5 text-right ${
                        Number(u.balance_owed) > 0
                          ? "font-medium text-red-700"
                          : "text-stone-600"
                      }`}
                    >
                      {money(u.balance_owed)}
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
