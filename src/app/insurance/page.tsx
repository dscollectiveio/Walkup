import { createClient } from "@/lib/supabase/server";
import { Answer, Card, Empty, Restricted, money } from "@/components/ui";

export const dynamic = "force-dynamic";

const COVERAGE: Record<string, string> = {
  property: "Building & property",
  general_liability: "Public liability",
  umbrella: "Umbrella (extra cover on top)",
  directors_officers: "Board members' liability",
  flood: "Flood",
  workers_comp: "Workers' compensation",
  other: "Other",
};

export default async function InsurancePage() {
  const supabase = await createClient();

  const [{ data: history }, { data: quotes }] = await Promise.all([
    supabase
      .from("insurance_year_over_year")
      .select(
        "policy_id, coverage, carrier_name, effective_from, effective_to, annual_premium, previous_premium, previous_carrier, change_amount, change_percent, quotes_obtained",
      )
      .order("coverage")
      .order("effective_from", { ascending: false }),
    supabase
      .from("insurance_quotes")
      .select(
        "id, coverage, carrier_name, quoted_on, covers_from, annual_premium, deductible, coverage_limit, was_selected, declined_reason",
      )
      .order("quoted_on", { ascending: false }),
  ]);

  if (!history) return <Restricted what="insurance records" />;

  const today = new Date();
  const current = history.filter(
    (h) => new Date(h.effective_to) >= today && new Date(h.effective_from) <= today,
  );
  const totalPremium = current.reduce((s, h) => s + Number(h.annual_premium), 0);

  // The renewal that matters is the soonest one.
  const nextRenewal = current
    .map((h) => h.effective_to)
    .sort()
    .at(0);
  const daysToRenewal = nextRenewal
    ? Math.round((new Date(nextRenewal).getTime() - today.getTime()) / 86400000)
    : null;

  const biggestRise = history
    .filter((h) => h.change_percent !== null)
    .sort((a, b) => Number(b.change_percent) - Number(a.change_percent))
    .at(0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Insurance</h1>
        <p className="mt-1 text-stone-500">
          What you&rsquo;re paying, what you paid before, and what else was
          offered.
        </p>
      </div>

      {daysToRenewal !== null && daysToRenewal <= 120 ? (
        <Answer
          status={daysToRenewal <= 45 ? "bad" : "attention"}
          headline={`Renewal in ${daysToRenewal} days — ${nextRenewal}`}
          detail="Start collecting alternative quotes about three months out. Carriers price renewals on the assumption you won't shop around, and this is the one negotiation a small association reliably wins."
        />
      ) : (
        <Answer
          status="good"
          headline="No renewal coming up soon"
          detail={
            nextRenewal ? `Next renewal is ${nextRenewal}.` : "No active policies recorded."
          }
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="What you pay now" hint="All active policies combined.">
          <div className="tabular text-2xl font-semibold">{money(totalPremium)}</div>
          <p className="mt-1 text-sm text-stone-500">per year</p>
        </Card>
        {biggestRise && Number(biggestRise.change_percent) > 0 ? (
          <Card title="Biggest increase you've had" hint="Worth remembering at renewal.">
            <div className="tabular text-2xl font-semibold text-amber-700">
              +{Number(biggestRise.change_percent).toFixed(1)}%
            </div>
            <p className="mt-1 text-sm text-stone-500">
              {COVERAGE[biggestRise.coverage] ?? biggestRise.coverage}, year
              starting {biggestRise.effective_from}
              {biggestRise.quotes_obtained === 0
                ? " — with no alternative quotes on file"
                : ` — after getting ${biggestRise.quotes_obtained} other quote${biggestRise.quotes_obtained === 1 ? "" : "s"}`}
            </p>
          </Card>
        ) : null}
      </div>

      <Card
        title="Year by year"
        hint="Each renewal, what it cost, and whether you looked at alternatives before signing."
      >
        {history.length === 0 ? (
          <Empty>No policies recorded yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-stone-500">
                  <th className="pb-2 font-medium">Cover</th>
                  <th className="pb-2 font-medium">Year from</th>
                  <th className="pb-2 font-medium">Insurer</th>
                  <th className="pb-2 text-right font-medium">Premium</th>
                  <th className="pb-2 text-right font-medium">Change</th>
                  <th className="pb-2 text-right font-medium">Quotes got</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {history.map((h) => (
                  <tr key={h.policy_id}>
                    <td className="py-3">{COVERAGE[h.coverage] ?? h.coverage}</td>
                    <td className="tabular py-3">{h.effective_from}</td>
                    <td className="py-3">
                      {h.carrier_name}
                      {h.previous_carrier && h.previous_carrier !== h.carrier_name ? (
                        <span className="ml-2 text-xs text-stone-400">
                          switched from {h.previous_carrier}
                        </span>
                      ) : null}
                    </td>
                    <td className="tabular py-3 text-right">{money(h.annual_premium)}</td>
                    <td className="tabular py-3 text-right">
                      {h.change_percent === null ? (
                        <span className="text-stone-400">first year</span>
                      ) : (
                        <span
                          className={
                            Number(h.change_percent) > 0
                              ? "text-amber-700"
                              : "text-emerald-700"
                          }
                        >
                          {Number(h.change_percent) > 0 ? "+" : ""}
                          {Number(h.change_percent).toFixed(1)}%
                          <span className="ml-1 text-xs text-stone-400">
                            ({Number(h.change_amount) > 0 ? "+" : ""}
                            {money(h.change_amount)})
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      {h.quotes_obtained === 0 ? (
                        <span className="text-xs text-amber-700">none</span>
                      ) : (
                        <span className="tabular text-stone-600">{h.quotes_obtained}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Quotes you've collected"
        hint="What each insurer offered, and why you said no. Useful the next time one of them calls."
      >
        {(quotes ?? []).length === 0 ? (
          <Empty>No quotes recorded.</Empty>
        ) : (
          <ul className="divide-y divide-stone-100">
            {(quotes ?? []).map((q) => (
              <li key={q.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{q.carrier_name}</span>
                    {q.was_selected ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                        chosen
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-sm text-stone-500">
                    {COVERAGE[q.coverage] ?? q.coverage} · quoted {q.quoted_on}
                    {q.deductible ? ` · ${money(q.deductible)} excess` : ""}
                    {q.coverage_limit ? ` · ${money(q.coverage_limit)} cover` : ""}
                  </div>
                  {q.declined_reason ? (
                    <div className="mt-1 text-xs text-stone-400">{q.declined_reason}</div>
                  ) : null}
                </div>
                <div className="tabular shrink-0 font-medium">
                  {money(q.annual_premium)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-xs leading-relaxed text-stone-500">
        Walkup records what insurers have offered so you can compare them. It is
        not an insurance broker and does not give insurance advice — choosing
        cover is a decision for the board, with a licensed broker if you want
        one.
      </p>
    </div>
  );
}
