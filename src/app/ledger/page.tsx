import { createClient } from "@/lib/supabase/server";
import { Card, Restricted, money } from "@/components/ui";

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

  const debits = rows.reduce((s, r) => s + Number(r.total_debit), 0);
  const credits = rows.reduce((s, r) => s + Number(r.total_credit), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Trial balance</h1>
        <p className="mt-1 text-sm text-stone-500">
          Posted entries only, separated by fund. Operating and reserve are
          independently reportable.
        </p>
      </div>

      <Card title="Accounts">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="pb-2 font-medium">Fund</th>
              <th className="pb-2 font-medium">Code</th>
              <th className="pb-2 font-medium">Account</th>
              <th className="pb-2 font-medium">Type</th>
              <th className="pb-2 text-right font-medium">Debit</th>
              <th className="pb-2 text-right font-medium">Credit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((r) => (
              <tr key={`${r.fund_name}-${r.code}`}>
                <td className="py-2 text-stone-500">{r.fund_name}</td>
                <td className="tabular py-2 font-mono text-xs">{r.code}</td>
                <td className="py-2">{r.name}</td>
                <td className="py-2 text-xs text-stone-500">{r.type}</td>
                <td className="tabular py-2 text-right">
                  {Number(r.total_debit) ? money(r.total_debit) : ""}
                </td>
                <td className="tabular py-2 text-right">
                  {Number(r.total_credit) ? money(r.total_credit) : ""}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-stone-300 font-semibold">
              <td colSpan={4} className="pt-2.5 text-xs uppercase tracking-wide">
                Total
              </td>
              <td className="tabular pt-2.5 text-right">{money(debits)}</td>
              <td className="tabular pt-2.5 text-right">{money(credits)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="mt-4 text-xs text-stone-500">
          {debits === credits
            ? "Debits equal credits, as the deferred balance constraint guarantees."
            : "OUT OF BALANCE — this should be impossible; the balance trigger has been bypassed."}
        </p>
      </Card>
    </div>
  );
}
