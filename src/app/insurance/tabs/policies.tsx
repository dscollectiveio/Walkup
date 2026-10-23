import Link from "next/link";
import { Card, Empty } from "@/components/ui";
import { shortDate } from "@/lib/dates";
import { coverageShort } from "@/lib/insurance/coverage";
import { formatMoney } from "@/lib/insurance/format";
import type { InsuranceContext, PolicyWithStatus, Supabase } from "@/lib/insurance/queries";
import type { ClaimRow } from "../claims-panel";
import { ClaimStatusChip } from "../components/status-chip";
import { PolicyRow } from "../components/policy-row";
import { btnGhost, btnPrimary } from "../components/styles";
import { YEAR_SELECT, YearByYear, type YearRow } from "../components/year-by-year";

/**
 * The Policies tab (insurance-spec §9.2): every policy grouped by status,
 * every claim, and the year-by-year premium history.
 */
export async function PoliciesTab({
  supabase,
  ctx,
  policies,
  empty,
}: {
  supabase: Supabase;
  ctx: InsuranceContext;
  policies: PolicyWithStatus[];
  /** Shown when there are no policies at all (the overview dropdown only renders this with policies, so null there). */
  empty: React.ReactNode;
}) {
  if (policies.length === 0) return <>{empty}</>;
  const assoc = ctx.association.id;
  const today = ctx.todayIso;
  const [claimsRes, history] = await Promise.all([
    supabase
      .from("insurance_claims")
      .select("id, policy_id, date_of_loss, description, status, amount_paid::text")
      .eq("association_id", assoc)
      .order("date_of_loss", { ascending: false }),
    supabase
      .from("insurance_year_over_year")
      .select(YEAR_SELECT)
      .eq("association_id", assoc)
      .order("coverage")
      .order("effective_from", { ascending: false }),
  ]);
  const claims = (claimsRes.data ?? []) as unknown as {
    id: string; policy_id: string; date_of_loss: string; description: string; status: ClaimRow["status"]; amount_paid: string | null;
  }[];
  const byId = new Map(policies.map((p) => [p.id, p]));
  const inForce = policies.filter((p) => p.status === "active");
  const upcoming = policies.filter((p) => p.status === "upcoming");
  const ended = policies.filter((p) => p.status === "expired" || p.status === "replaced");
  const archived = policies.filter((p) => p.status === "archived");
  const list = (rows: PolicyWithStatus[]) => (
    <ul className="divide-y divide-line">
      {rows.map((p) => (
        <PolicyRow key={p.id} policy={p} todayIso={today} />
      ))}
    </ul>
  );

  return (
    <div className="space-y-6">
      {ctx.isBoard ? (
        <div className="flex flex-wrap gap-2">
          <Link href="/insurance/import" className={btnPrimary}>
            Import a policy
          </Link>
          <Link href="/insurance/policies/new" className={btnGhost}>
            Enter by hand
          </Link>
        </div>
      ) : null}

      <Card navy title="In force">{inForce.length ? list(inForce) : <Empty>No policy is in force today.</Empty>}</Card>
      {upcoming.length ? <Card navy title="Starting soon">{list(upcoming)}</Card> : null}
      {ended.length ? (
        <details className="rounded-xl border border-line bg-paper px-5 py-3">
          <summary className="min-h-[44px] cursor-pointer py-2 text-[13px] font-bold text-ink">Ended or replaced ({ended.length})</summary>
          {list(ended)}
        </details>
      ) : null}
      {ctx.isBoard && archived.length ? (
        <details className="rounded-xl border border-line bg-paper px-5 py-3">
          <summary className="min-h-[44px] cursor-pointer py-2 text-[13px] font-bold text-ink">Archived ({archived.length})</summary>
          {list(archived)}
        </details>
      ) : null}

      <Card navy title="Claims">
        <div className="space-y-3">
          {claims.length === 0 ? (
            <p className="text-[13px] text-mute">No claims recorded.</p>
          ) : (
            <>
              <ul className="divide-y divide-line sm:hidden">
                {claims.map((c) => {
                  const p = byId.get(c.policy_id);
                  return (
                    <li key={c.id} className="py-3 text-[13px]">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-ink">{c.description}</span>
                        <ClaimStatusChip status={c.status} />
                      </div>
                      <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                        <dt className="text-mute">Loss</dt>
                        <dd className="text-ink">{shortDate(c.date_of_loss, today)}</dd>
                        <dt className="text-mute">Policy</dt>
                        <dd>
                          {p ? (
                            <Link href={`/insurance/policies/${p.id}`} className="text-ink underline underline-offset-2">
                              {coverageShort(p.coverage)}
                            </Link>
                          ) : null}
                        </dd>
                        <dt className="text-mute">Paid</dt>
                        <dd className="figures text-ink">{c.amount_paid ? formatMoney(c.amount_paid) : "None yet"}</dd>
                      </dl>
                    </li>
                  );
                })}
              </ul>
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[36rem] text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-left text-mute">
                      <th scope="col" className="pb-2 font-medium">Date</th>
                      <th scope="col" className="pb-2 font-medium">What happened</th>
                      <th scope="col" className="pb-2 font-medium">Policy</th>
                      <th scope="col" className="pb-2 font-medium">Status</th>
                      <th scope="col" className="pb-2 text-right font-medium">Paid</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {claims.map((c) => {
                      const p = byId.get(c.policy_id);
                      return (
                        <tr key={c.id}>
                          <td className="py-3 text-ink">{shortDate(c.date_of_loss, today)}</td>
                          <th scope="row" className="py-3 pr-3 text-left font-normal text-ink">{c.description}</th>
                          <td className="py-3">
                            {p ? (
                              <Link href={`/insurance/policies/${p.id}`} className="text-ink underline-offset-2 hover:underline">
                                {coverageShort(p.coverage)}
                              </Link>
                            ) : null}
                          </td>
                          <td className="py-3"><ClaimStatusChip status={c.status} /></td>
                          <td className="figures py-3 text-right text-ink">{c.amount_paid ? formatMoney(c.amount_paid) : ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {ctx.isBoard ? (
            <Link href="/insurance/claims/new" className={btnGhost}>
              Add a claim
            </Link>
          ) : null}
        </div>
      </Card>

      <Card navy title="Year by year" hint="Each renewal, what it cost, and whether you looked at other quotes before it started.">
        {(history.data ?? []).length === 0 ? (
          <Empty>No policies recorded yet.</Empty>
        ) : (
          <YearByYear rows={(history.data ?? []) as unknown as YearRow[]} todayIso={today} />
        )}
      </Card>
    </div>
  );
}
