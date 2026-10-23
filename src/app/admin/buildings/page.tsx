import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Restricted } from "@/components/ui";
import { billingEnabled, billingEnforced, planByKey } from "@/lib/billing/config";
import { computeEntitlement, factsFromRow } from "@/lib/billing/entitlement-rules";
import { billingCopy, billingDate } from "@/lib/billing/copy";
import { buildingTodayIso } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Buildings" };

const ROLE_LABEL: Record<string, string> = {
  board_admin: "Board admin",
  board_member: "Board member",
  accountant: "Accountant",
  property_manager: "Property manager",
  attorney: "Attorney",
  observer: "Observer",
};

interface Person {
  name: string;
  email: string | null;
  roles: string[];
  last_sign_in_at: string | null;
}

interface BuildingRow {
  association_id: string;
  display_name: string;
  city: string | null;
  state_code: string | null;
  created_at: string;
  deleted: boolean;
  unit_count: number;
  owner_count: number;
  people: Person[];
}

const NEW_DAYS = 7;

/**
 * Platform admin only: every building that has signed up, when, how big it is, its plan, and who is involved (the
 * people with a role beyond owner, and when they last signed in). People, roles, counts and dates only: no
 * association's financial data is read here.
 */
export default async function AdminBuildingsPage() {
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (isAdmin !== true) return <Restricted what="platform settings" />;

  const [{ data, error }, { data: billingData }] = await Promise.all([
    supabase.rpc("platform_buildings_overview"),
    supabase.rpc("billing_admin_overview"),
  ]);
  const rows = (data ?? []) as BuildingRow[];
  const billingById = new Map(((billingData ?? []) as Record<string, unknown>[]).map((b) => [b.association_id as string, b]));
  const enforced = billingEnforced();
  const now = Date.parse(`${buildingTodayIso()}T23:59:59Z`);
  const live = rows.filter((r) => !r.deleted);
  const fresh = live.filter((r) => now - Date.parse(r.created_at) < NEW_DAYS * 86_400_000).length;
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Buildings</h1>
        <p className="mt-1 text-mute">
          Every building that has signed up, newest first, and who is involved in each.{" "}
          {billingEnabled() ? "" : "Billing is off, so every building shows as free. "}
          <Link href="/admin/billing" className="text-ink underline underline-offset-2">
            Plans, comps and notices
          </Link>
          .
        </p>
      </div>

      <section aria-label="Totals" className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-line bg-paper px-5 py-4">
          <p className="text-[12px] font-medium uppercase tracking-wide text-mute">Buildings</p>
          <p className="figures mt-1 text-[24px] font-bold text-ink">{live.length}</p>
        </div>
        <div className="rounded-xl border border-line bg-paper px-5 py-4">
          <p className="text-[12px] font-medium uppercase tracking-wide text-mute">New in the last {NEW_DAYS} days</p>
          <p className="figures mt-1 text-[24px] font-bold text-ink">{fresh}</p>
        </div>
        <div className="rounded-xl border border-line bg-paper px-5 py-4">
          <p className="text-[12px] font-medium uppercase tracking-wide text-mute">Units across all buildings</p>
          <p className="figures mt-1 text-[24px] font-bold text-ink">{live.reduce((n, r) => n + r.unit_count, 0)}</p>
        </div>
      </section>

      {error ? (
        <p className="text-[13px] text-bad-text">Couldn&rsquo;t load buildings: {error.message}</p>
      ) : rows.length === 0 ? (
        <Card navy title="Buildings">
          <Empty>No buildings yet.</Empty>
        </Card>
      ) : (
        <ul className="space-y-4">
          {rows.map((r) => {
            const billing = billingById.get(r.association_id) ?? null;
            const facts = factsFromRow(billing);
            const copy = facts ? billingCopy(facts, computeEntitlement(facts, { enabled: true, enforced })) : null;
            const plan = planByKey(typeof billing?.plan_key === "string" ? billing.plan_key : null);
            const isNew = !r.deleted && now - Date.parse(r.created_at) < NEW_DAYS * 86_400_000;
            return (
              <li key={r.association_id} className={`overflow-hidden rounded-xl border border-line bg-paper ${r.deleted ? "opacity-70" : ""}`}>
                <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 band bg-ink px-5 py-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h2 className="min-w-0 break-words text-[15px] font-semibold text-paper">{r.display_name}</h2>
                    {isNew ? <span className="rounded-full bg-brass px-2 py-0.5 text-[11px] font-semibold text-on-brass">New</span> : null}
                    {r.deleted ? <span className="rounded-full border border-paper/40 px-2 py-0.5 text-[11px] text-ondark-mute">Deleted</span> : null}
                  </div>
                  <span className="text-[12px] text-ondark-mute">Signed up {day(r.created_at)}</span>
                </header>
                <div className="space-y-3 px-5 py-4">
                  <dl className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <dt className="text-[11px] font-medium uppercase tracking-wide text-mute">Where</dt>
                      <dd className="text-ink">{[r.city, r.state_code].filter(Boolean).join(", ") || "Not set"}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-medium uppercase tracking-wide text-mute">Units and owners</dt>
                      <dd className="text-ink">
                        {r.unit_count} {r.unit_count === 1 ? "unit" : "units"}, {r.owner_count} {r.owner_count === 1 ? "owner" : "owners"} with access
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-medium uppercase tracking-wide text-mute">Plan</dt>
                      <dd className="text-ink">
                        {copy ? copy.label : "No billing record"}
                        {plan ? `, ${plan.name}` : ""}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-medium uppercase tracking-wide text-mute">Trial or comp</dt>
                      <dd className="text-ink">
                        {facts?.compActive
                          ? `Free${facts.compExpiresOn ? ` until ${billingDate(facts.compExpiresOn)}` : ""}`
                          : facts?.trialEndsAt
                            ? `Trial ends ${billingDate(facts.trialEndsAt)}`
                            : "None"}
                      </dd>
                    </div>
                  </dl>

                  <div>
                    <h3 className="text-[12px] font-bold text-ink">Who is involved</h3>
                    {r.people.length === 0 ? (
                      <p className="text-[13px] text-mute">Nobody has a role here yet.</p>
                    ) : (
                      <div className="mt-1 overflow-x-auto">
                        <table className="w-full min-w-[520px] text-[13px]">
                          <thead>
                            <tr className="border-b border-line text-left text-[11px] font-medium uppercase tracking-wide text-mute">
                              <th scope="col" className="py-1.5 pr-3 font-medium">Name</th>
                              <th scope="col" className="py-1.5 pr-3 font-medium">Email</th>
                              <th scope="col" className="py-1.5 pr-3 font-medium">Role</th>
                              <th scope="col" className="py-1.5 font-medium">Last signed in</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.people.map((p) => (
                              <tr key={`${p.name}-${p.email ?? ""}`} className="border-b border-line last:border-0">
                                <td className="py-1.5 pr-3 font-medium text-ink">{p.name}</td>
                                <td className="py-1.5 pr-3 break-all text-ink">{p.email ?? <span className="text-mute">No email</span>}</td>
                                <td className="py-1.5 pr-3 text-ink">{(p.roles ?? []).map((role) => ROLE_LABEL[role] ?? role).join(", ")}</td>
                                <td className="py-1.5 text-mute">{p.last_sign_in_at ? day(p.last_sign_in_at) : "Never"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
