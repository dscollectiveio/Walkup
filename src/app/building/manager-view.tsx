import Link from "next/link";
import { Card, Empty, money } from "@/components/ui";
import { Pill, type PillTone } from "@/components/repairs/pills";
import { buildingTodayIso, shortDate } from "@/lib/dates";
import { mailtoLink } from "@/lib/email/mailto";
import { STANDING_LABEL, sortByStanding, standingOf, type StandingFigures, type StandingState } from "@/lib/access/standing-words";
import type { createClient } from "@/lib/supabase/server";
import { loadAllContactDetails } from "@/lib/people/contact-details";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const STATE_TONE: Record<StandingState, PillTone> = { behind: "bad", owes: "warning", current: "good", ahead: "info" };

interface Person {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  mailing_address: string | null;
}

/**
 * Building & Owners for a property manager (0080): the units, who owns them, how to reach them, the unit's
 * own property manager contact, and where each unit stands on dues. Read only, by construction: the
 * manager's database access to these tables is SELECT, and nothing on this page is a form. The board
 * changes units, people and roles.
 */
export async function ManagerBuildingView({ supabase, associationId }: { supabase: Supabase; associationId: string }) {
  const today = buildingTodayIso();
  const [unitsRes, ownersRes, peopleRes, contacts, managersRes, standingRes] = await Promise.all([
    supabase.from("units").select("id, label, sort_order").order("sort_order").order("label"),
    supabase.from("unit_owners").select("unit_id, person_id, effective_to"),
    supabase.from("persons").select("id, full_name, email"),
    // Phone and mailing address are in their own table (0082); a property manager may read it.
    loadAllContactDetails(supabase),
    supabase.from("unit_property_managers").select("unit_id, person_id, company, main_contact"),
    supabase.rpc("manager_unit_standing", { p_association_id: associationId }),
  ]);

  const units = (unitsRes.data ?? []) as { id: string; label: string }[];
  const people = new Map(
    ((peopleRes.data ?? []) as Pick<Person, "id" | "full_name" | "email">[]).map((p) => [
      p.id,
      { ...p, phone: contacts.get(p.id)?.phone ?? null, mailing_address: contacts.get(p.id)?.mailing_address ?? null } as Person,
    ]),
  );
  const owners = new Map<string, Person[]>();
  for (const o of (ownersRes.data ?? []) as { unit_id: string; person_id: string; effective_to: string | null }[]) {
    if (o.effective_to && o.effective_to < today) continue;
    const p = people.get(o.person_id);
    if (!p) continue;
    owners.set(o.unit_id, [...(owners.get(o.unit_id) ?? []), p]);
  }
  const managers = new Map(
    ((managersRes.data ?? []) as { unit_id: string; person_id: string; company: string | null; main_contact: string }[]).map((m) => [m.unit_id, m]),
  );
  const standingRows = (standingRes.error ? [] : ((standingRes.data ?? []) as (StandingFigures & { unit_id: string; unit_label: string })[]));
  const standing = new Map(standingRows.map((r) => [r.unit_id, r]));
  const behind = standingRows.filter((r) => standingOf(r).state === "behind");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Building &amp; Owners</h1>
        <p className="mt-1 text-mute">
          Units, owners and how to reach them. This page is read only: ask the board to change a unit, an owner or a role.
        </p>
      </div>

      {standingRes.error ? (
        <p className="border-l-[3px] border-warning bg-warning-tint px-3 py-2 text-[13px] text-warning-text">
          Dues standing couldn&rsquo;t be loaded. Reload the page.
        </p>
      ) : behind.length > 0 ? (
        <Card navy title="Behind on dues" hint="Oldest first. Summary only: payments and charges stay with the board and the accountant.">
          <ul className="divide-y divide-line">
            {sortByStanding(behind).map((r) => (
              <li key={r.unit_id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 text-[14px]">
                <span className="font-medium text-ink">{r.unit_label}</span>
                <span className="figures text-mute">
                  {money(r.overdue)} overdue{r.oldest_overdue_on ? `, since ${shortDate(r.oldest_overdue_on, today)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card navy title={`Units and owners (${units.length})`}>
        {units.length === 0 ? (
          <Empty>No units have been added yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {units.map((u) => {
              const s = standing.get(u.id);
              const st = s ? standingOf(s) : null;
              const mgr = managers.get(u.id);
              const mgrPerson = mgr ? people.get(mgr.person_id) : null;
              const here = owners.get(u.id) ?? [];
              return (
                <li key={u.id} className="py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-[15px] font-semibold text-ink">{u.label}</h3>
                    {s && st ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <Pill tone={STATE_TONE[st.state]}>{STANDING_LABEL[st.state]}</Pill>
                        {st.state === "behind" ? <span className="figures text-[12px] text-mute">{money(s.overdue)} overdue</span> : null}
                      </span>
                    ) : null}
                  </div>
                  {here.length === 0 ? (
                    <p className="mt-1 text-[13px] text-mute">No current owner on file.</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {here.map((p) => (
                        <li key={p.id} className="text-[13px]">
                          <span className="font-medium text-ink">{p.full_name}</span>
                          <ContactDetails p={p} />
                        </li>
                      ))}
                    </ul>
                  )}
                  {mgrPerson ? (
                    <p className="mt-2 text-[13px] text-mute">
                      Unit&rsquo;s own property manager: <span className="text-ink">{mgrPerson.full_name}</span>
                      {mgr?.company ? `, ${mgr.company}` : ""}
                      <ContactDetails p={mgrPerson} />
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <p className="text-[13px]">
        <Link href="/repairs" className="underline underline-offset-2">
          Back to Repairs &amp; Upkeep
        </Link>
      </p>
    </div>
  );
}

function ContactDetails({ p }: { p: Person }) {
  const phone = p.phone?.trim() || null;
  const email = p.email?.trim() || null;
  const address = p.mailing_address?.trim() || null;
  if (!phone && !email && !address) return <span className="block text-mute">No contact details on file.</span>;
  return (
    <span className="block text-mute">
      {email ? (
        <a href={mailtoLink(email)} className="mr-3 inline-flex min-h-[32px] items-center text-ink underline underline-offset-2">
          {email}
        </a>
      ) : null}
      {phone ? (
        <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="mr-3 inline-flex min-h-[32px] items-center text-ink underline underline-offset-2">
          {phone}
        </a>
      ) : null}
      {address ? <span className="block text-[12px]">{address}</span> : null}
    </span>
  );
}
