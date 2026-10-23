import Link from "next/link";
import { BoardOnly } from "@/components/board-only";
import { Card, Empty } from "@/components/ui";
import { buildingTodayIso } from "@/lib/dates";
import { getViewer } from "@/lib/owner/viewer";
import { createClient } from "@/lib/supabase/server";
import { navFor, type NavRole } from "@/components/sidebar/config";
import { ACCESS_TABLES, describeAccessEvent, type AuditRow } from "@/lib/access/activity";
import { PREVIEW_ROLES } from "@/lib/access/preview";
import { GenerateInviteForm } from "@/app/building/generate-invite-form";
import { InviteRow, type InviteRecord } from "@/app/building/invite-row";
import { OfficeLine } from "./change-board-form";
import { POSITION_OPTIONS } from "./positions";
import { ExtendAccessButton } from "./extend-button";
import { RolePreview } from "./role-preview";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  board_admin: "Board admin",
  board_member: "Board member",
  accountant: "Accountant",
  owner: "Owner",
  property_manager: "Property manager",
  attorney: "Attorney",
  observer: "Observer",
};
const OUTSIDE = new Set(["accountant", "property_manager", "attorney", "observer"]);

function daysUntil(iso: string, today: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export default async function AccessPage() {
  const viewer = await getViewer();
  if (!viewer || !viewer.isBoard) {
    return <BoardOnly what="People & Access" why="It is where the board manages who can see what." />;
  }
  const isAdmin = viewer.isBoardAdmin;
  const supabase = await createClient();
  const today = buildingTodayIso();

  const [{ data: persons }, { data: grants }, { data: positions }, { data: inviteRows }, { data: audit }] = await Promise.all([
    supabase.from("persons").select("id, full_name, email, auth_user_id").order("full_name"),
    supabase.from("role_grants").select("person_id, role, expires_on, revoked_at").is("revoked_at", null),
    supabase.from("board_positions").select("id, person_id, position, term_start, term_end").is("ended_at", null),
    supabase.from("invites").select("id, token, role, email, expires_at, redeemed_at").order("created_at", { ascending: false }).limit(30),
    isAdmin
      ? supabase
          .from("audit_log")
          .select("id, table_name, action, actor_user_id, before_data, after_data, occurred_at")
          .in("table_name", [...ACCESS_TABLES])
          .order("occurred_at", { ascending: false })
          .limit(80)
      : Promise.resolve({ data: [] as AuditRow[] }),
  ]);

  const people = (persons ?? []) as { id: string; full_name: string; email: string | null; auth_user_id: string | null }[];
  const nameById = new Map(people.map((p) => [p.id, p.full_name]));
  const nameByUser = new Map(people.filter((p) => p.auth_user_id).map((p) => [p.auth_user_id as string, p.full_name]));
  const activeGrants = (grants ?? []).filter((g) => !g.expires_on || (g.expires_on as string) >= today);

  // Officers.
  const posRows = (positions ?? []) as { id: string; person_id: string; position: string; term_start: string; term_end: string | null }[];
  const OFFICES = ["president", "vice_president", "secretary", "treasurer"];
  const officeLabel = (v: string) => POSITION_OPTIONS.find((p) => p.value === v)?.label ?? v;
  const directors = posRows.filter((p) => p.position === "director");

  // Everyone with a non-owner role.
  const rolesByPerson = new Map<string, { role: string; expiresOn: string | null }[]>();
  for (const g of activeGrants) {
    if (g.role === "owner") continue;
    const list = rolesByPerson.get(g.person_id as string) ?? [];
    list.push({ role: g.role as string, expiresOn: (g.expires_on as string | null) ?? null });
    rolesByPerson.set(g.person_id as string, list);
  }
  const withAccess = [...rolesByPerson.entries()]
    .map(([id, roles]) => ({ id, name: nameById.get(id) ?? "Someone", roles }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const boardPeople = people.filter((p) => (rolesByPerson.get(p.id) ?? []).some((r) => r.role === "board_admin" || r.role === "board_member"));

  // Invites.
  const invites: InviteRecord[] = (inviteRows ?? []).map((i) => ({
    id: i.id as string,
    token: i.token as string,
    role: i.role as string,
    email: (i.email as string | null) ?? null,
    expiresAt: i.expires_at as string,
    redeemedAt: (i.redeemed_at as string | null) ?? null,
  }));

  // Activity.
  const feed = ((audit ?? []) as AuditRow[])
    .map((row) => ({
      row,
      text: describeAccessEvent(row, {
        person: (id) => nameById.get(id) ?? "someone",
        actor: (id) => (id ? (nameByUser.get(id) ?? "A board member") : "Walkup"),
      }),
    }))
    .filter((x): x is { row: AuditRow; text: string } => x.text !== null)
    .slice(0, 80);

  // Preview.
  const flatten = (role: NavRole) => {
    const n = navFor(role);
    return [...n.ungrouped, ...n.groups.flatMap((g) => g.items), ...n.trailing].map((i) => i.href);
  };
  const tabsByRole: Record<string, string[]> = {}; // the routes in each role's sidebar
  for (const r of PREVIEW_ROLES) tabsByRole[r] = flatten(r as NavRole);

  const twoYears = new Date(`${today}T00:00:00Z`);
  twoYears.setUTCDate(twoYears.getUTCDate() + 730);
  const defaultTermEnd = twoYears.toISOString().slice(0, 10);
  const peopleOptions = boardPeopleOptions(people, boardPeople);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">People &amp; Access</h1>
        <p className="mt-1 text-mute">
          Who is on the board, who else can see the building&rsquo;s records, and how access is given and ended. Units, owners and roles are edited on{" "}
          <Link href="/building#units-and-people" className="text-ink underline underline-offset-2">
            Building &amp; Owners
          </Link>
          .
        </p>
      </div>

      <Card navy title="Board and officers">
        <ul className="divide-y divide-line">
          {OFFICES.map((office) => {
            const holder = posRows.find((p) => p.position === office);
            return (
              <OfficeLine
                key={office}
                position={office}
                label={officeLabel(office)}
                holder={holder ? { positionId: holder.id, personId: holder.person_id, name: nameById.get(holder.person_id) ?? "Someone", termEnd: holder.term_end } : null}
                people={peopleOptions}
                defaultTermEnd={defaultTermEnd}
                endsInDays={holder?.term_end ? daysUntil(holder.term_end, today) : null}
                canEdit={isAdmin}
              />
            );
          })}
          {directors.map((d) => (
            <OfficeLine
              key={d.id}
              position="director"
              label="Director"
              holder={{ positionId: d.id, personId: d.person_id, name: nameById.get(d.person_id) ?? "Someone", termEnd: d.term_end }}
              people={peopleOptions}
              defaultTermEnd={defaultTermEnd}
              endsInDays={d.term_end ? daysUntil(d.term_end, today) : null}
              canEdit={isAdmin}
            />
          ))}
          {isAdmin ? (
            <OfficeLine key="new-director" position="director" label="Director" holder={null} people={peopleOptions} defaultTermEnd={defaultTermEnd} endsInDays={null} canEdit addLabel="Add a director" />
          ) : null}
        </ul>
        <p className="mt-3 text-[12px] text-mute">
          The Treasurer also categorizes and posts bank transactions and adds budget categories. The Secretary also approves announcement emails. Everyone on the
          board stays a board admin or a board member; the position only adds those duties and shows on the building page owners see.
        </p>
      </Card>

      <Card navy title="Everyone with access beyond owners" hint="Board, accountant and outside helpers, and the invites that bring new people in. Roles are changed on Building & Owners.">
        {withAccess.length === 0 ? (
          <Empty>No one yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {withAccess.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-ink">{p.name}</p>
                  <p className="text-[12px] text-mute">{p.roles.map((r) => ROLE_LABEL[r.role] ?? r.role).join(", ")}</p>
                </div>
                <div className="flex items-center gap-4 text-[12px] text-mute">
                  {p.roles
                    .filter((r) => r.expiresOn)
                    .map((r) => {
                      const d = daysUntil(r.expiresOn as string, today);
                      return (
                        <span key={r.role} className={d <= 14 ? "font-medium text-warning-text" : ""}>
                          {ROLE_LABEL[r.role] ?? r.role} ends {r.expiresOn}
                        </span>
                      );
                    })}
                  {isAdmin && p.roles.some((r) => OUTSIDE.has(r.role)) ? <ExtendAccessButton personId={p.id} /> : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 space-y-3 border-t border-line pt-4">
          <div>
            <h3 className="text-[13px] font-bold text-ink">Invites</h3>
            <p className="text-[12px] text-mute">A link only works for the email it was made for (board and helper roles) and ends in 3 days; owner links last 7.</p>
          </div>
          <GenerateInviteForm canGiveAnyRole={isAdmin} people={people.filter((p) => !p.auth_user_id).map((p) => ({ id: p.id, full_name: p.full_name }))} />
          {invites.length === 0 ? (
            <p className="text-[13px] text-mute">No invites yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {invites.map((i) => (
                <InviteRow key={i.id} invite={i} canRevokeInvites={isAdmin} />
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card navy title="See what a role sees" hint="Which tabs each role gets, and what each can and can't do.">
        <RolePreview tabsByRole={tabsByRole} />
        <p className="mt-3 text-[12px] text-mute">A check means the role gets that page in its sidebar. Owners and observers get their own, smaller versions of some pages, and the board reaches the same information through its fuller ones.</p>
      </Card>

      {isAdmin ? (
        <>
          <Card navy title="Recent access activity" hint="Roles given and ended, invites, and changes of board.">
            {feed.length === 0 ? (
              <Empty>Nothing yet.</Empty>
            ) : (
              <ul className="max-h-64 divide-y divide-line overflow-y-auto pr-1" tabIndex={0} aria-label="Recent access activity, scrolls">
                {feed.map(({ row, text }) => (
                  <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2 text-[13px]">
                    <span className="text-ink">{text}</span>
                    <time dateTime={row.occurred_at} className="text-[12px] text-mute">
                      {new Date(row.occurred_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}

/** Anyone can be given a position; people already on the board come first. */
function boardPeopleOptions(all: { id: string; full_name: string }[], board: { id: string }[]) {
  const onBoard = new Set(board.map((b) => b.id));
  return [...all]
    .sort((a, b) => Number(onBoard.has(b.id)) - Number(onBoard.has(a.id)) || a.full_name.localeCompare(b.full_name))
    .map((p) => ({ id: p.id, name: `${p.full_name}${onBoard.has(p.id) ? "" : " (not on the board yet)"}` }));
}
