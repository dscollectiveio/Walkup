import { queryAs } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { Card, Empty, UnitLink, money } from "@/components/ui";

export const dynamic = "force-dynamic";

interface Row {
  unit_id: string;
  label: string;
  current: string;
  d30: string;
  d60: string;
  d90: string;
  total: string;
}

export default async function DelinquencyPage() {
  const userId = await getCurrentUserId();

  // Aging buckets. Computed from charge_balances, which derives amounts from
  // payment_allocations rather than a cached status column that could drift.
  const rows = await queryAs<Row>(
    userId,
    `select u.id as unit_id, u.label,
            coalesce(sum(cb.balance) filter (where cb.days_overdue = 0), 0)::text  as current,
            coalesce(sum(cb.balance) filter (where cb.days_overdue between 1 and 30), 0)::text as d30,
            coalesce(sum(cb.balance) filter (where cb.days_overdue between 31 and 60), 0)::text as d60,
            coalesce(sum(cb.balance) filter (where cb.days_overdue > 60), 0)::text as d90,
            coalesce(sum(cb.balance), 0)::text as total
       from units u
       join charge_balances cb on cb.unit_id = u.id
      where cb.status not in ('paid','waived','written_off')
      group by u.id, u.label
      having coalesce(sum(cb.balance), 0) > 0
      order by 7 desc`,
  );

  const total = rows.reduce((sum, r) => sum + Number(r.total), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Delinquency</h1>
        <p className="mt-1 text-sm text-stone-500">
          Aged by days past the due date. Owners see only their own unit.
        </p>
      </div>

      <Card
        title="Aging"
        hint="Uncollected assessments are exempt function income you have not received — they lower the 60% ratio on the cash basis."
      >
        {rows.length === 0 ? (
          <Empty>Nothing outstanding is visible to you.</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
                <th className="pb-2 font-medium">Unit</th>
                <th className="pb-2 text-right font-medium">Current</th>
                <th className="pb-2 text-right font-medium">1–30</th>
                <th className="pb-2 text-right font-medium">31–60</th>
                <th className="pb-2 text-right font-medium">60+</th>
                <th className="pb-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r) => (
                <tr key={r.unit_id}>
                  <td className="py-2.5">
                    <UnitLink id={r.unit_id} label={r.label} />
                  </td>
                  <td className="tabular py-2.5 text-right text-stone-600">
                    {money(r.current)}
                  </td>
                  <td className="tabular py-2.5 text-right">{money(r.d30)}</td>
                  <td className="tabular py-2.5 text-right text-amber-700">
                    {money(r.d60)}
                  </td>
                  <td className="tabular py-2.5 text-right font-medium text-red-700">
                    {money(r.d90)}
                  </td>
                  <td className="tabular py-2.5 text-right font-semibold">
                    {money(r.total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-stone-200">
                <td className="pt-2.5 text-xs uppercase tracking-wide text-stone-500">
                  Total
                </td>
                <td colSpan={4} />
                <td className="tabular pt-2.5 text-right font-semibold">
                  {money(total)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </Card>
    </div>
  );
}
