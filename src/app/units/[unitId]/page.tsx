import { queryAs } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { Card, Restricted, money } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function UnitStatementPage({
  params,
}: {
  params: Promise<{ unitId: string }>;
}) {
  const { unitId } = await params;
  const userId = await getCurrentUserId();

  const [units, charges, payments] = await Promise.all([
    // Gated on unit_owners, NOT on units.
    //
    // units is readable by every member of the association by design — an
    // owner knows the building has three units, and hiding that is pointless.
    // But that makes it useless as an access check: gating this page on
    // `select from units` rendered a real statement shell, titled "Unit 2",
    // showing a confident $0.00 balance, to an owner who has no business
    // seeing it at all.
    //
    // unit_owners carries the correct policy: board and accountant see every
    // row, an owner sees only their own units. An empty result here means
    // "not yours" and is indistinguishable from "does not exist", which is
    // what we want — leaking "this unit exists but is not yours" is still a
    // leak.
    queryAs<{ id: string; label: string }>(
      userId,
      `select u.id, u.label
         from units u
        where u.id = $1
          and exists (select 1 from unit_owners uo where uo.unit_id = u.id)`,
      [unitId],
    ),
    queryAs<{
      id: string;
      charge_type: string;
      due_on: string;
      amount: string;
      amount_applied: string;
      balance: string;
      status: string;
      days_overdue: number;
    }>(
      userId,
      `select id, charge_type, due_on::text, amount::text, amount_applied::text,
              balance::text, status, days_overdue
         from charge_balances where unit_id = $1 order by due_on`,
      [unitId],
    ),
    queryAs<{ received_on: string; amount: string; method: string | null }>(
      userId,
      `select received_on::text, amount::text, method
         from payments where unit_id = $1 order by received_on`,
      [unitId],
    ),
  ]);

  // Either the unit does not exist or RLS is hiding it. From outside the
  // database those are indistinguishable, which is the correct behaviour —
  // leaking "this unit exists but is not yours" is still a leak.
  if (units.length === 0) {
    return <Restricted what="this unit's ledger" />;
  }

  const owed = charges.reduce((s, c) => s + Number(c.balance), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {units[0].label} — owner statement
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Balance owed:{" "}
          <span className={owed > 0 ? "font-medium text-red-700" : "text-emerald-700"}>
            {money(owed)}
          </span>
        </p>
      </div>

      <Card title="Charges">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="pb-2 font-medium">Due</th>
              <th className="pb-2 font-medium">Type</th>
              <th className="pb-2 text-right font-medium">Charged</th>
              <th className="pb-2 text-right font-medium">Paid</th>
              <th className="pb-2 text-right font-medium">Balance</th>
              <th className="pb-2 text-right font-medium">Age</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {charges.map((c) => (
              <tr key={c.id}>
                <td className="tabular py-2">{c.due_on}</td>
                <td className="py-2 text-stone-600">{c.charge_type.replace("_", " ")}</td>
                <td className="tabular py-2 text-right">{money(c.amount)}</td>
                <td className="tabular py-2 text-right text-stone-600">
                  {money(c.amount_applied)}
                </td>
                <td
                  className={`tabular py-2 text-right ${
                    Number(c.balance) > 0 ? "font-medium text-red-700" : "text-stone-400"
                  }`}
                >
                  {money(c.balance)}
                </td>
                <td className="tabular py-2 text-right text-xs text-stone-500">
                  {Number(c.balance) > 0 && c.days_overdue > 0
                    ? `${c.days_overdue}d`
                    : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Payments received">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-stone-100">
            {payments.map((p, i) => (
              <tr key={`${p.received_on}-${i}`}>
                <td className="tabular py-2">{p.received_on}</td>
                <td className="py-2 text-stone-500">{p.method ?? ""}</td>
                <td className="tabular py-2 text-right">{money(p.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
