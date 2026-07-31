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
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">Insurance</h1>
        <p className="mt-1 text-mute">
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
          <div className="figures text-[26px] text-ink">{money(totalPremium)}</div>
          <p className="mt-1 text-[13px] text-mute">per year</p>
        </Card>
        {biggestRise && Number(biggestRise.change_percent) > 0 ? (
          <Card title="Biggest increase you've had" hint="Worth remembering at renewal.">
            <div className="figures text-[26px] text-warning-text">
              +{Number(biggestRise.change_percent).toFixed(1)}%
            </div>
            <p className="mt-1 text-[13px] text-mute">
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
            <table className="w-full min-w-[40rem] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-mute">
                  <th className="pb-2 font-medium">Cover</th>
                  <th className="pb-2 font-medium">Year from</th>
                  <th className="pb-2 font-medium">Insurer</th>
                  <th className="pb-2 text-right font-medium">Premium</th>
                  <th className="pb-2 text-right font-medium">Change</th>
                  <th className="pb-2 text-right font-medium">Quotes got</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {history.map((h) => (
                  <tr key={h.policy_id}>
                    <td className="py-3 text-ink">{COVERAGE[h.coverage] ?? h.coverage}</td>
                    <td className="figures py-3 text-ink">{h.effective_from}</td>
                    <td className="py-3 text-ink">
                      {h.carrier_name}
                      {h.previous_carrier && h.previous_carrier !== h.carrier_name ? (
                        <span className="ml-2 text-[11px] text-mute-soft">
                          switched from {h.previous_carrier}
                        </span>
                      ) : null}
                    </td>
                    <td className="figures py-3 text-right text-ink">{money(h.annual_premium)}</td>
                    <td className="figures py-3 text-right">
                      {h.change_percent === null ? (
                        <span className="text-mute-soft">first year</span>
                      ) : (
                        <span
                          className={
                            Number(h.change_percent) > 0
                              ? "text-warning-text"
                              : "text-good-text"
                          }
                        >
                          {Number(h.change_percent) > 0 ? "+" : ""}
                          {Number(h.change_percent).toFixed(1)}%
                          <span className="ml-1 text-[11px] text-mute-soft">
                            ({Number(h.change_amount) > 0 ? "+" : ""}
                            {money(h.change_amount)})
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      {h.quotes_obtained === 0 ? (
                        <span className="text-[11px] text-warning-text">none</span>
                      ) : (
                        <span className="figures text-mute">{h.quotes_obtained}</span>
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
          <ul className="divide-y divide-line">
            {(quotes ?? []).map((q) => (
              <li key={q.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">{q.carrier_name}</span>
                    {q.was_selected ? (
                      <span className="rounded-full border border-good-line bg-good-tint px-2 py-0.5 text-[11px] text-good-text">
                        chosen
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-[13px] text-mute">
                    {COVERAGE[q.coverage] ?? q.coverage} · quoted {q.quoted_on}
                    {q.deductible ? ` · ${money(q.deductible)} excess` : ""}
                    {q.coverage_limit ? ` · ${money(q.coverage_limit)} cover` : ""}
                  </div>
                  {q.declined_reason ? (
                    <div className="mt-1 text-[11px] text-mute-soft">{q.declined_reason}</div>
                  ) : null}
                </div>
                <div className="figures shrink-0 text-ink">
                  {money(q.annual_premium)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-[11px] leading-relaxed text-mute">
        Walkup records what insurers have offered so you can compare them. It is
        not an insurance broker and does not give insurance advice — choosing
        cover is a decision for the board, with a licensed broker if you want
        one.
      </p>
    </div>
  );
}
