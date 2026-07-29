import { createClient } from "@/lib/supabase/server";
import { Card, Empty, UnitLink, money } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DelinquencyPage() {
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("delinquency_aging")
    .select("unit_id, label, current_due, days_1_30, days_31_60, days_60_plus, total_owed")
    .order("total_owed", { ascending: false });

  const total = (rows ?? []).reduce((sum, r) => sum + Number(r.total_owed), 0);

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
        {!rows || rows.length === 0 ? (
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
                    {money(r.current_due)}
                  </td>
                  <td className="tabular py-2.5 text-right">{money(r.days_1_30)}</td>
                  <td className="tabular py-2.5 text-right text-amber-700">
                    {money(r.days_31_60)}
                  </td>
                  <td className="tabular py-2.5 text-right font-medium text-red-700">
                    {money(r.days_60_plus)}
                  </td>
                  <td className="tabular py-2.5 text-right font-semibold">
                    {money(r.total_owed)}
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
