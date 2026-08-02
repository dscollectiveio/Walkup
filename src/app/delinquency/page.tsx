import { createClient } from "@/lib/supabase/server";
import { Answer, Card, Jargon, MoneyOrDash, UnitLink, money } from "@/components/ui";
import { PaymentForm } from "./payment-form";
import { ReminderLetterButton } from "./reminder-letter-button";

export const dynamic = "force-dynamic";

export default async function DelinquencyPage() {
  const supabase = await createClient();

  const [{ data: rows }, { data: owners }] = await Promise.all([
    supabase
      .from("delinquency_aging")
      .select("unit_id, label, current_due, days_1_30, days_31_60, days_60_plus, total_owed")
      .order("total_owed", { ascending: false }),
    supabase.from("unit_owners").select("unit_id, persons(full_name, email)"),
  ]);

  const ownerName = new Map<string, string>();
  const ownerEmail = new Map<string, string | null>();
  for (const o of owners ?? []) {
    const p = o.persons as unknown as { full_name: string; email: string | null } | null;
    if (p) {
      ownerName.set(o.unit_id, p.full_name);
      ownerEmail.set(o.unit_id, p.email);
    }
  }

  const total = (rows ?? []).reduce((s, r) => s + Number(r.total_owed), 0);

  const overdueUnits = (rows ?? []).map((r) => ({
    id: r.unit_id,
    label: r.label,
    owed: Number(r.total_owed),
    ownerName: ownerName.get(r.unit_id) ?? null,
    ownerEmail: ownerEmail.get(r.unit_id) ?? null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">Who owes money</h1>
        <p className="mt-1 text-mute">
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

          <div className="flex flex-wrap items-start gap-2">
            <PaymentForm units={overdueUnits} />
            <ReminderLetterButton units={overdueUnits} />
          </div>

          <Card
            title="Overdue by unit"
            hint="The longer a balance sits in the right-hand columns, the harder it usually is to recover."
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-mute">
                    <th className="pb-2 font-medium">Unit</th>
                    <th className="pb-2 text-right font-medium">Not yet due</th>
                    <th className="pb-2 text-right font-medium">Up to a month</th>
                    <th className="pb-2 text-right font-medium">1–2 months</th>
                    <th className="pb-2 text-right font-medium">Over 2 months</th>
                    <th className="pb-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr key={r.unit_id}>
                      <td className="py-3">
                        <UnitLink id={r.unit_id} label={r.label} />
                        {ownerName.get(r.unit_id) ? (
                          <div className="text-[11px] text-mute">
                            {ownerName.get(r.unit_id)}
                          </div>
                        ) : null}
                      </td>
                      <td className="figures py-3 text-right">
                        <MoneyOrDash value={r.current_due} className="text-mute" />
                      </td>
                      <td className="figures py-3 text-right">
                        <MoneyOrDash value={r.days_1_30} className="text-ink" />
                      </td>
                      <td className="figures py-3 text-right">
                        <MoneyOrDash value={r.days_31_60} className="text-bad-text" />
                      </td>
                      <td className="figures py-3 text-right">
                        <MoneyOrDash value={r.days_60_plus} className="text-bad-text" />
                      </td>
                      <td className="figures py-3 text-right text-ink">
                        {money(r.total_owed)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line">
                    <td className="pt-3 text-mute">Total</td>
                    <td colSpan={4} />
                    <td className="figures pt-3 text-right text-ink">{money(total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-4 text-[11px] text-mute-soft">
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
