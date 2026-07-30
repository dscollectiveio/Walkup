import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Answer, Card, Empty, Jargon, Stat, UnitLink, money, moneyRounded } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const supabase = await createClient();

  const [{ data: associations }, { data: funds }, { data: units }, { data: totals }, { data: owners }] =
    await Promise.all([
      supabase.from("associations").select("id, display_name, state_code, fiscal_year_end_month"),
      supabase
        .from("fund_cash_balances")
        .select("fund_id, name, kind, cash_balance, visible_lines")
        .order("name"),
      supabase
        .from("unit_balances")
        .select("unit_id, label, balance_owed, visible_charges")
        .order("sort_order"),
      supabase
        .from("association_totals")
        .select("visible_tb_rows, total_debits, total_credits, total_owed, units_behind"),
      supabase.from("unit_owners").select("unit_id, persons(full_name)"),
    ]);

  const association = associations?.[0];
  if (!association) {
    return <Empty>No association is visible to you.</Empty>;
  }

  const t = totals?.[0];
  const booksVisible = (t?.visible_tb_rows ?? 0) > 0;
  const booksBalance = booksVisible && Number(t!.total_debits) === Number(t!.total_credits);
  const owed = Number(t?.total_owed ?? 0);
  const behind = Number(t?.units_behind ?? 0);
  const visibleFunds = (funds ?? []).filter((f) => f.visible_lines > 0);
  const totalCash = visibleFunds.reduce((s, f) => s + Number(f.cash_balance), 0);

  const ownerName = new Map<string, string>();
  for (const o of owners ?? []) {
    const p = o.persons as unknown as { full_name: string } | null;
    if (p) ownerName.set(o.unit_id, p.full_name);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {association.display_name}
        </h1>
        <p className="mt-1 text-stone-500">
          {association.state_code} · financial year 2026
        </p>
      </div>

      {/* The headline answer, before any figures. A board member should be able
          to tell in one glance whether anything needs them tonight. */}
      {behind > 0 ? (
        <Answer
          status="attention"
          headline={`${behind} of ${units?.length ?? 0} units is behind on payments`}
          detail={`${moneyRounded(owed)} is owed to the association. Everything else looks in order.`}
        >
          <Link
            href="/delinquency"
            className="inline-block rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
          >
            See who owes
          </Link>
        </Answer>
      ) : (
        <Answer
          status="good"
          headline="Everything looks in order"
          detail="All units are up to date on their payments, and your records add up."
        />
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Money in the bank"
          value={money(totalCash)}
          note="across all accounts"
        />
        {visibleFunds.map((f) => (
          <Stat
            key={f.fund_id}
            label={
              f.kind === "reserve"
                ? "Reserve savings"
                : f.kind === "operating"
                  ? "Day-to-day account"
                  : f.name
            }
            value={money(f.cash_balance)}
            note={
              f.kind === "reserve"
                ? "set aside for big repairs"
                : "bills and running costs"
            }
          />
        ))}
      </div>

      <Card
        title="Units"
        hint="Click a unit to see its payment history."
      >
        {!units || units.length === 0 ? (
          <Empty>No units are visible to you.</Empty>
        ) : (
          <ul className="divide-y divide-stone-100">
            {units.map((u) => (
              <li key={u.unit_id} className="flex items-center justify-between py-3">
                <div>
                  <UnitLink id={u.unit_id} label={u.label} />
                  {ownerName.get(u.unit_id) ? (
                    <span className="ml-2 text-sm text-stone-500">
                      {ownerName.get(u.unit_id)}
                    </span>
                  ) : null}
                </div>
                {u.visible_charges === 0 ? (
                  <span className="text-sm text-stone-400">not shown to you</span>
                ) : Number(u.balance_owed) > 0 ? (
                  <span className="tabular text-sm font-medium text-red-700">
                    owes {money(u.balance_owed)}
                  </span>
                ) : (
                  <span className="text-sm text-emerald-700">up to date</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {booksVisible ? (
        <Card
          title="Are the books right?"
          hint="Every transaction is recorded twice, once on each side. If the two sides ever disagree, something has gone wrong."
        >
          <div className="flex flex-wrap items-center gap-4">
            <span
              className={`rounded-full px-3 py-1 text-sm font-medium ${
                booksBalance
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-red-100 text-red-800"
              }`}
            >
              {booksBalance ? "Yes — the two sides match" : "No — something is wrong"}
            </span>
            <span className="tabular text-sm text-stone-500">
              <Jargon term="trial balance">
                {money(t!.total_debits)} on each side
              </Jargon>
            </span>
            <Link
              href="/ledger"
              className="ml-auto text-sm text-stone-500 underline-offset-2 hover:underline"
            >
              See every transaction
            </Link>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
