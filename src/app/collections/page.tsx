import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BoardOnly } from "@/components/board-only";
import { Card, Empty, money } from "@/components/ui";
import { Pill, type PillTone } from "@/components/repairs/pills";
import { ViewerUnavailable } from "@/components/owner/viewer-unavailable";
import { buildingTodayIso, shortDate } from "@/lib/dates";
import { mailtoLink } from "@/lib/email/mailto";
import { getViewer } from "@/lib/owner/viewer";
import { STANDING_LABEL, sortByStanding, standingOf, type StandingFigures, type StandingState } from "@/lib/access/standing-words";

export const dynamic = "force-dynamic";

const STATE_TONE: Record<StandingState, PillTone> = { behind: "bad", owes: "warning", current: "good", ahead: "info" };

type UnitRow = StandingFigures & {
  unit_id: string;
  unit_label: string;
  last_payment_on: string | null;
  last_payment_amount: string | null;
};
type OwnerRow = {
  unit_id: string;
  unit_label: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  mailing_address: string | null;
  owner_since: string | null;
};

/**
 * Collections for an attorney (0080): the units a board admin shared with them, where each stands on dues,
 * and how to reach its owners. Read only, and only through two narrow database readers that answer for the
 * calling attorney's own shares; anyone else gets no rows. The board's own view of the same thing is HOA Dues.
 */
export default async function CollectionsPage() {
  const viewer = await getViewer();
  if (!viewer) return <ViewerUnavailable />;
  if (!viewer.roles.includes("attorney")) {
    return (
      <BoardOnly
        what="Collections"
        why="It shows an attorney the units the board has shared with them. The board's own view is HOA Dues."
        alternative={viewer.isStaff ? { label: "Open HOA Dues", href: "/dues" } : { label: "Go to your home page", href: viewer.homePath }}
      />
    );
  }

  const supabase = await createClient();
  const today = buildingTodayIso();
  const [unitsRes, ownersRes, sharesRes] = await Promise.all([
    supabase.rpc("attorney_shared_units", { p_association_id: viewer.associationId }),
    supabase.rpc("attorney_shared_owners", { p_association_id: viewer.associationId }),
    supabase.from("attorney_shares").select("id, unit_id"),
  ]);

  const failed = Boolean(unitsRes.error || ownersRes.error);
  if (failed) console.error("[collections] shared units", unitsRes.error?.code ?? ownersRes.error?.code ?? "-");
  const rows = sortByStanding((unitsRes.data ?? []) as UnitRow[]);
  const owners = (ownersRes.data ?? []) as OwnerRow[];
  const ownersByUnit = new Map<string, OwnerRow[]>();
  for (const o of owners) ownersByUnit.set(o.unit_id, [...(ownersByUnit.get(o.unit_id) ?? []), o]);
  const wholeBuilding = ((sharesRes.data ?? []) as { unit_id: string | null }[]).some((s) => s.unit_id === null);

  return (
    <div className="mx-auto w-full max-w-[900px] space-y-6">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Collections</h1>
        <p className="mt-1 text-mute">
          The units a board admin has shared with you: where each stands on dues, and how to reach the owner. Read only.
          {wholeBuilding ? " You also have the building-wide documents under Documents." : ""}
        </p>
      </div>

      {failed ? (
        <p className="border-l-[3px] border-warning bg-warning-tint px-3 py-2 text-[13px] text-warning-text">
          This couldn&rsquo;t be loaded. Reload the page.
        </p>
      ) : rows.length === 0 ? (
        <Card navy title="Nothing shared yet">
          <Empty>
            No unit has been shared with you yet. A board admin shares a unit from Building &amp; Owners. Documents the board shares with you are under{" "}
            <Link href="/documents" className="underline underline-offset-2">
              Documents
            </Link>
            .
          </Empty>
        </Card>
      ) : (
        <ul className="space-y-4">
          {rows.map((r) => {
            const st = standingOf(r);
            const here = ownersByUnit.get(r.unit_id) ?? [];
            return (
              <li key={r.unit_id}>
                <Card
                  navy
                  title={r.unit_label}
                  action={<Pill tone={STATE_TONE[st.state]}>{STANDING_LABEL[st.state]}</Pill>}
                >
                  <dl className="grid gap-3 sm:grid-cols-4">
                    <div>
                      <dt className="text-[12px] text-mute">Owed</dt>
                      <dd className="figures text-[16px] font-semibold text-ink">{money(r.owed)}</dd>
                    </div>
                    <div>
                      <dt className="text-[12px] text-mute">Overdue</dt>
                      <dd className="figures text-[16px] font-semibold text-ink">{money(r.overdue)}</dd>
                    </div>
                    <div>
                      <dt className="text-[12px] text-mute">Oldest overdue</dt>
                      <dd className="text-[14px] text-ink">{r.oldest_overdue_on ? shortDate(r.oldest_overdue_on, today) : "None"}</dd>
                    </div>
                    <div>
                      <dt className="text-[12px] text-mute">Last payment</dt>
                      <dd className="text-[14px] text-ink">
                        {r.last_payment_on ? `${money(r.last_payment_amount)} on ${shortDate(r.last_payment_on, today)}` : "None on record"}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-4 border-t border-line pt-3">
                    <h3 className="text-[12px] font-medium text-mute">{here.length === 1 ? "Owner" : "Owners"}</h3>
                    {here.length === 0 ? (
                      <p className="mt-1 text-[13px] text-mute">No current owner on file.</p>
                    ) : (
                      <ul className="mt-1 space-y-2">
                        {here.map((o, i) => (
                          <li key={`${o.full_name}-${i}`} className="text-[13px]">
                            <span className="font-medium text-ink">{o.full_name}</span>
                            {o.owner_since ? <span className="text-mute"> · since {shortDate(o.owner_since, today)}</span> : null}
                            <span className="block text-mute">
                              {o.email ? (
                                <a href={mailtoLink(o.email)} className="mr-3 inline-flex min-h-[32px] items-center text-ink underline underline-offset-2">
                                  {o.email}
                                </a>
                              ) : null}
                              {o.phone ? (
                                <a href={`tel:${o.phone.replace(/[^\d+]/g, "")}`} className="mr-3 inline-flex min-h-[32px] items-center text-ink underline underline-offset-2">
                                  {o.phone}
                                </a>
                              ) : null}
                              {!o.email && !o.phone && !o.mailing_address ? "No contact details on file." : null}
                            </span>
                            {o.mailing_address ? <span className="block text-[12px] text-mute">{o.mailing_address}</span> : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
