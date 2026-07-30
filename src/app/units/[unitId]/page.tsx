import { createClient } from "@/lib/supabase/server";
import { Card, Restricted, money } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function UnitStatementPage({
  params,
}: {
  params: Promise<{ unitId: string }>;
}) {
  const { unitId } = await params;
  const supabase = await createClient();

  // Gated on unit_owners, NOT on units.
  //
  // units is readable by every member of the association by design — an owner
  // knows the building has three units, and hiding that achieves nothing. That
  // makes it useless as an access check: gating on it rendered a real statement
  // shell, titled with the neighbour's unit and showing a confident $0.00, to
  // an owner with no business seeing it (DECISIONS #17).
  //
  // unit_owners carries the correct policy. An empty result means "not yours"
  // and is indistinguishable from "does not exist", which is the point.
  const { data: ownership } = await supabase
    .from("unit_owners")
    .select("unit_id, units(id, label)")
    .eq("unit_id", unitId)
    .limit(1);

  const unit = ownership?.[0]?.units as { id: string; label: string } | undefined;
  if (!unit) {
    return <Restricted what="this unit's ledger" />;
  }

  const [{ data: charges }, { data: payments }] = await Promise.all([
    supabase
      .from("charge_balances")
      .select("id, charge_type, due_on, amount, amount_applied, balance, status, days_overdue")
      .eq("unit_id", unitId)
      .order("due_on"),
    supabase
      .from("payments")
      .select("id, received_on, amount, method")
      .eq("unit_id", unitId)
      .order("received_on"),
  ]);

  const owed = (charges ?? []).reduce((s, c) => s + Number(c.balance), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {unit.label}
        </h1>
        <p className="mt-1 text-stone-500">
          Currently owed:{" "}
          <span className={owed > 0 ? "font-medium text-red-700" : "text-emerald-700"}>
            {money(owed)}
          </span>
        </p>
      </div>

      <Card title="Fees charged" hint="What this unit has been billed, and how much of it has been paid.">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="pb-2 font-medium">Due date</th>
              <th className="pb-2 font-medium">Type</th>
              <th className="pb-2 text-right font-medium">Billed</th>
              <th className="pb-2 text-right font-medium">Paid</th>
              <th className="pb-2 text-right font-medium">Still owed</th>
              <th className="pb-2 text-right font-medium">Overdue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {(charges ?? []).map((c) => (
              <tr key={c.id}>
                <td className="tabular py-2">{c.due_on}</td>
                <td className="py-2 text-stone-600">
                  {String(c.charge_type).replace("_", " ")}
                </td>
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
                  {Number(c.balance) > 0 && c.days_overdue > 0 ? `${c.days_overdue}d` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Payments received">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-stone-100">
            {(payments ?? []).map((p) => (
              <tr key={p.id}>
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
