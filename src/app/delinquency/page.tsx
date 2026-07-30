import { createClient } from "@/lib/supabase/server";
import { Answer, Card, Jargon, UnitLink, money } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DelinquencyPage() {
  const supabase = await createClient();

  const [{ data: rows }, { data: owners }] = await Promise.all([
    supabase
      .from("delinquency_aging")
      .select("unit_id, label, current_due, days_1_30, days_31_60, days_60_plus, total_owed")
      .order("total_owed", { ascending: false }),
    supabase.from("unit_owners").select("unit_id, persons(full_name)"),
  ]);

  const ownerName = new Map<string, string>();
  for (const o of owners ?? []) {
    const p = o.persons as unknown as { full_name: string } | null;
    if (p) ownerName.set(o.unit_id, p.full_name);
  }

  const total = (rows ?? []).reduce((s, r) => s + Number(r.total_owed), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Who owes money</h1>
        <p className="mt-1 text-stone-500">
          Unpaid fees, grouped by how overdue they are.
        </p>
      </div>

      {!rows || rows.length === 0 ? (
        <Answer
          status="good"
          headline="Nobody is behind"
          detail="Every unit that you can see is up to date on their fees."
        />
      ) : (
        <>
          <Answer
            status="attention"
            headline={`${money(total)} is outstanding`}
            detail="Unpaid fees are money you have earned but not received. As well as the cash-flow problem, they lower the income figure your tax eligibility depends on — see the Tax filing page."
          />

          <Card
            title="Overdue by unit"
            hint="The longer a balance sits in the right-hand columns, the harder it usually is to recover."
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-left text-stone-500">
                    <th className="pb-2 font-medium">Unit</th>
                    <th className="pb-2 text-right font-medium">Not yet due</th>
                    <th className="pb-2 text-right font-medium">Up to a month</th>
                    <th className="pb-2 text-right font-medium">1–2 months</th>
                    <th className="pb-2 text-right font-medium">Over 2 months</th>
                    <th className="pb-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {rows.map((r) => (
                    <tr key={r.unit_id}>
                      <td className="py-3">
                        <UnitLink id={r.unit_id} label={r.label} />
                        {ownerName.get(r.unit_id) ? (
                          <div className="text-xs text-stone-500">
                            {ownerName.get(r.unit_id)}
                          </div>
                        ) : null}
                      </td>
                      <td className="tabular py-3 text-right text-stone-500">
                        {money(r.current_due)}
                      </td>
                      <td className="tabular py-3 text-right">{money(r.days_1_30)}</td>
                      <td className="tabular py-3 text-right text-amber-700">
                        {money(r.days_31_60)}
                      </td>
                      <td className="tabular py-3 text-right font-medium text-red-700">
                        {money(r.days_60_plus)}
                      </td>
                      <td className="tabular py-3 text-right font-semibold">
                        {money(r.total_owed)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-stone-200">
                    <td className="pt-3 text-stone-500">Total</td>
                    <td colSpan={4} />
                    <td className="tabular pt-3 text-right font-semibold">{money(total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-4 text-xs text-stone-400">
              <Jargon term="delinquency aging">
                Grouping unpaid amounts by age
              </Jargon>{" "}
              is what an accountant will ask for at year end.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
