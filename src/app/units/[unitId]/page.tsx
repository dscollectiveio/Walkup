import { createClient } from "@/lib/supabase/server";
import { Card, MoneyOrDash, Restricted, money } from "@/components/ui";
import { listLinkedDocuments } from "@/lib/documents/access";
import { EntityDocuments } from "@/app/documents/entity-documents";

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
    .select("unit_id, units(id, label, association_id)")
    .eq("unit_id", unitId)
    .limit(1);

  const unit = ownership?.[0]?.units as
    | { id: string; label: string; association_id: string }
    | undefined;
  if (!unit) {
    return <Restricted what="this unit's ledger" />;
  }

  const [{ data: charges }, { data: payments }, documents, { data: isBoard }] =
    await Promise.all([
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
      listLinkedDocuments(supabase, "units", unitId),
      // Attaching a document to a unit is a board_admin write on document_links
      // (0002's is_board insert policy) — gate the control on the same test,
      // not on whether the caller can merely see this page.
      supabase.rpc("has_role_in", {
        assoc: unit.association_id,
        roles: ["board_admin", "board_member"],
      }),
    ]);

  const owed = (charges ?? []).reduce((s, c) => s + Number(c.balance), 0);
  const canWrite = isBoard === true;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">
          {unit.label}
        </h1>
        <p className="mt-1 text-mute">
          Currently owed:{" "}
          <span className={`figures ${owed > 0 ? "font-medium text-bad-text" : "text-good-text"}`}>
            {money(owed)}
          </span>
        </p>
      </div>

      <Card title="Fees charged" hint="What this unit has been billed, and how much of it has been paid.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-mute">
                <th className="pb-2 font-medium">Due date</th>
                <th className="pb-2 font-medium">Type</th>
                <th className="pb-2 text-right font-medium">Billed</th>
                <th className="pb-2 text-right font-medium">Paid</th>
                <th className="pb-2 text-right font-medium">Still owed</th>
                <th className="pb-2 text-right font-medium">Overdue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(charges ?? []).map((c) => (
                <tr key={c.id}>
                  <td className="figures py-2 text-ink">{c.due_on}</td>
                  <td className="py-2 text-mute">
                    {String(c.charge_type).replace("_", " ")}
                  </td>
                  <td className="figures py-2 text-right text-ink">{money(c.amount)}</td>
                  <td className="figures py-2 text-right">
                    <MoneyOrDash value={c.amount_applied} className="text-mute" />
                  </td>
                  <td className="figures py-2 text-right">
                    <MoneyOrDash
                      value={c.balance}
                      className={Number(c.balance) > 0 ? "font-medium text-bad-text" : "text-ink"}
                    />
                  </td>
                  <td className="figures py-2 text-right text-[11px] text-mute">
                    {Number(c.balance) > 0 && c.days_overdue > 0 ? `${c.days_overdue}d` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Payments received">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[24rem] text-[13px]">
            <tbody className="divide-y divide-line">
              {(payments ?? []).map((p) => (
                <tr key={p.id}>
                  <td className="figures py-2 text-ink">{p.received_on}</td>
                  <td className="py-2 text-mute">{p.method ?? ""}</td>
                  <td className="figures py-2 text-right text-ink">{money(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Documents" hint="Anything filed against this unit specifically.">
        <EntityDocuments
          targetTable="units"
          targetId={unit.id}
          documents={documents}
          canWrite={canWrite}
        />
      </Card>
    </div>
  );
}
