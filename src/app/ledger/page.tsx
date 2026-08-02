import { createClient } from "@/lib/supabase/server";
import { Card, MoneyOrDash, Restricted, money } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function LedgerPage() {
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("trial_balance_by_fund")
    .select("fund_name, code, name, type, total_debit, total_credit")
    .order("fund_name")
    .order("code");

  // Owners have no SELECT policy on journal_lines, so this is empty for them
  // rather than partially populated.
  if (!rows || rows.length === 0) {
    return <Restricted what="the general ledger" />;
  }

  // Summed in cents, and compared in cents.
  //
  // PostgREST returns NUMERIC as a JSON number, so these arrive as floats
  // (DECISIONS #20). Adding thirteen of them per side gave
  // 60232.18000000000029 against 60232.18000000000757 — identical to the
  // penny, unequal as doubles. The page printed both totals as $60,232.18 and
  // then declared the books broken.
  //
  // On a page whose entire job is to tell a board member whether their records
  // are sound, a false alarm is close to the worst possible bug.
  const toCentsLoose = (v: string | number) => Math.round(Number(v) * 100);
  const debitCents = rows.reduce((s, r) => s + toCentsLoose(r.total_debit), 0);
  const creditCents = rows.reduce((s, r) => s + toCentsLoose(r.total_credit), 0);
  const debits = debitCents / 100;
  const credits = creditCents / 100;
  const balanced = debitCents === creditCents;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">All transactions</h1>
        <p className="mt-1 text-mute">
          Every account, with its totals for the year. Your accountant will
          want this; you probably only need it if a number elsewhere looks
          wrong.
        </p>
      </div>

      <Card
        title="Accounts"
        hint="Money is separated into a day-to-day account and reserve savings, so you can always tell how much is set aside for big repairs."
      >
        {/* Widest table in the app — scrolls inside the card rather than
            wrapping rows, per the layout spec. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-mute">
                <th className="pb-2 font-medium">Account for</th>
                <th className="pb-2 font-medium">No.</th>
                <th className="pb-2 font-medium">Account</th>
                <th className="pb-2 font-medium">Type</th>
                <th className="pb-2 text-right font-medium">Debit</th>
                <th className="pb-2 text-right font-medium">Credit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={`${r.fund_name}-${r.code}`}>
                  <td className="py-2 text-mute">{r.fund_name}</td>
                  <td className="figures py-2 font-mono text-[11px] text-ink">{r.code}</td>
                  <td className="py-2 text-ink">{r.name}</td>
                  <td className="py-2 text-[11px] text-mute">{r.type}</td>
                  <td className="figures py-2 text-right">
                    <MoneyOrDash value={r.total_debit} />
                  </td>
                  <td className="figures py-2 text-right">
                    <MoneyOrDash value={r.total_credit} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line-strong">
                <td colSpan={4} className="pt-2.5 text-[11px] font-medium uppercase tracking-wide text-ink">
                  Total
                </td>
                <td className="figures pt-2.5 text-right text-ink">{money(debits)}</td>
                <td className="figures pt-2.5 text-right text-ink">{money(credits)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-4 text-[11px] text-mute">
          {balanced
            ? "The two sides match, which is what you want. Walkup will not let you save a transaction where they do not."
            : "The two sides do not match. This should be impossible — please report it."}
        </p>
      </Card>
    </div>
  );
}
