import { Empty } from "@/components/ui";
import { longDate } from "@/lib/dates";
import type { createClient } from "@/lib/supabase/server";
import { AttorneyShareControls } from "./attorney-share-controls";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Board admins: what each attorney may see (0080). An attorney reads the legal notices, contracts and
 * correspondence filed for a unit you share, plus those that belong to no unit if you share the whole
 * building, and for each shared unit the owners' contact details and where it stands on dues. Nothing is
 * shared until you add it here.
 */
export async function AttorneySharesPanel({ supabase, todayIso }: { supabase: Supabase; todayIso: string }) {
  const [grantsRes, sharesRes, unitsRes] = await Promise.all([
    supabase
      .from("role_grants")
      .select("person_id, expires_on, persons(id, full_name, email)")
      .eq("role", "attorney")
      .is("revoked_at", null)
      .gte("expires_on", todayIso),
    supabase.from("attorney_shares").select("id, person_id, unit_id"),
    supabase.from("units").select("id, label").order("sort_order").order("label"),
  ]);

  type Grant = { person_id: string; expires_on: string; persons: { id: string; full_name: string; email: string | null } | { id: string; full_name: string; email: string | null }[] | null };
  const attorneys = ((grantsRes.data ?? []) as unknown as Grant[]).flatMap((g) => {
    const p = Array.isArray(g.persons) ? g.persons[0] : g.persons;
    return p ? [{ id: p.id, name: p.full_name, email: p.email, ends: g.expires_on }] : [];
  });
  const units = (unitsRes.data ?? []) as { id: string; label: string }[];
  const label = new Map(units.map((u) => [u.id, u.label]));
  const shares = (sharesRes.data ?? []) as { id: string; person_id: string; unit_id: string | null }[];

  if (attorneys.length === 0) {
    return (
      <Empty>
        No attorney has access yet. Invite one under Sign-in invites (role Attorney, with their email), then share what they may see here.
      </Empty>
    );
  }

  return (
    <ul className="divide-y divide-line">
      {attorneys.map((a) => {
        const mine = shares.filter((s) => s.person_id === a.id);
        return (
          <li key={a.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
            <div>
              <p className="text-[14px] font-medium text-ink">{a.name}</p>
              <p className="text-[12px] text-mute">
                {[a.email, `access ends ${longDate(a.ends)}`].filter(Boolean).join(" · ")}
              </p>
            </div>
            <AttorneyShareControls
              personId={a.id}
              units={units}
              shares={mine.map((s) => ({ id: s.id, unitId: s.unit_id, label: s.unit_id ? (label.get(s.unit_id) ?? "A unit") : "Whole building" }))}
            />
          </li>
        );
      })}
    </ul>
  );
}
