import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Restricted } from "@/components/ui";
import { AssociationProfileForm, type AssociationProfile } from "./association-profile-form";
import { AddUnitForm } from "./add-unit-form";
import { UnitRow, type UnitRecord } from "./unit-row";
import { AddPersonForm } from "./add-person-form";
import { PersonRow, type PersonRecord } from "./person-row";
import { OwnershipRow, type CurrentOwner } from "./ownership-row";
import { OwnershipAmendmentForm } from "./ownership-amendment-form";
import { AmendmentHistory, type AmendmentHistoryEntry } from "./amendment-history";
import { GrantRoleForm } from "./grant-role-form";
import { RoleGrantRow, type RoleGrantRecord } from "./role-grant-row";

export const dynamic = "force-dynamic";

export default async function BuildingPage() {
  const supabase = await createClient();

  const { data: associations } = await supabase
    .from("associations")
    .select(
      "id, legal_name, display_name, state_code, county, city, ein, incorporated_on, fiscal_year_end_month, capitalization_threshold, capitalization_threshold_source",
    );
  const association = associations?.[0];
  if (!association) return <Restricted what="building settings" />;

  const { data: isBoardRes } = await supabase.rpc("has_role_in", {
    assoc: association.id,
    roles: ["board_admin", "board_member"],
  });
  const isBoard = isBoardRes === true;
  if (!isBoard) return <Restricted what="building settings" />;

  const { data: isBoardAdminRes } = await supabase.rpc("has_role_in", {
    assoc: association.id,
    roles: ["board_admin"],
  });
  const isBoardAdmin = isBoardAdminRes === true;

  const todayIso = new Date().toISOString().slice(0, 10);

  const [
    { data: units },
    { data: persons },
    { data: roleGrantRows },
    { data: unitOwnerRows },
    { data: amendmentRows },
  ] = await Promise.all([
    supabase
      .from("units")
      .select(
        "id, label, sort_order, square_footage, bedroom_count, full_bathrooms, half_bathrooms",
      )
      .order("sort_order"),
    supabase
      .from("persons")
      .select("id, full_name, email, phone, mailing_address")
      .order("full_name"),
    supabase
      .from("role_grants")
      .select("id, person_id, role, granted_on, expires_on, revoked_at, persons(full_name)")
      .order("granted_on", { ascending: false }),
    supabase
      .from("unit_owners")
      .select("id, unit_id, person_id, effective_from, effective_to, persons(full_name)")
      .or(`effective_to.is.null,effective_to.gte.${todayIso}`)
      .order("effective_from"),
    supabase
      .from("ownership_amendments")
      .select(
        "id, effective_from, reason, ownership_amendment_lines(unit_id, percentage, units(label))",
      )
      .order("effective_from", { ascending: false }),
  ]);

  const profile: AssociationProfile = {
    legal_name: association.legal_name,
    display_name: association.display_name,
    state_code: association.state_code,
    county: association.county,
    city: association.city,
    ein: association.ein,
    incorporated_on: association.incorporated_on,
    fiscal_year_end_month: association.fiscal_year_end_month,
    capitalization_threshold: Number(association.capitalization_threshold),
    capitalization_threshold_source: association.capitalization_threshold_source,
  };

  const unitList: UnitRecord[] = units ?? [];
  const personOptions = (persons ?? []).map((p) => ({ id: p.id, full_name: p.full_name }));

  const rolesByPerson = new Map<string, string[]>();
  for (const g of roleGrantRows ?? []) {
    if (g.revoked_at) continue;
    if (g.expires_on && g.expires_on < todayIso) continue;
    const list = rolesByPerson.get(g.person_id) ?? [];
    list.push(g.role);
    rolesByPerson.set(g.person_id, list);
  }

  const personRecords: PersonRecord[] = persons ?? [];

  const ownersByUnit = new Map<string, CurrentOwner[]>();
  for (const row of unitOwnerRows ?? []) {
    const person = row.persons as unknown as { full_name: string } | null;
    const list = ownersByUnit.get(row.unit_id) ?? [];
    list.push({
      rowId: row.id,
      personId: row.person_id,
      personName: person?.full_name ?? "Unknown",
      effectiveFrom: row.effective_from,
    });
    ownersByUnit.set(row.unit_id, list);
  }

  const currentPercentages: Record<string, number> = {};
  const latestLines = amendmentRows?.[0]?.ownership_amendment_lines as unknown as
    | { unit_id: string; percentage: number }[]
    | undefined;
  for (const l of latestLines ?? []) currentPercentages[l.unit_id] = Number(l.percentage);

  const amendments: AmendmentHistoryEntry[] = (amendmentRows ?? []).map((a) => {
    const lines = a.ownership_amendment_lines as unknown as
      | { unit_id: string; percentage: number; units: { label: string } | null }[]
      | undefined;
    return {
      id: a.id,
      effectiveFrom: a.effective_from,
      reason: a.reason,
      lines: (lines ?? []).map((l) => ({
        unitLabel: l.units?.label ?? "Unit",
        percentage: Number(l.percentage),
      })),
    };
  });

  const roleGrants: RoleGrantRecord[] = (roleGrantRows ?? []).map((g) => {
    const person = g.persons as unknown as { full_name: string } | null;
    return {
      id: g.id,
      personName: person?.full_name ?? "Unknown",
      role: g.role,
      grantedOn: g.granted_on,
      expiresOn: g.expires_on,
      revokedAt: g.revoked_at,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">Building</h1>
        <p className="mt-1 text-mute">
          The association&rsquo;s own profile, the unit roster, who lives where, and who has
          access to the books.
        </p>
      </div>

      <Card
        title="Association profile"
        hint="Legal name, filing details, and the capitalization threshold used for the 1120-H."
      >
        <div className="space-y-1 text-[13px]">
          <p className="font-medium text-ink">{profile.display_name}</p>
          <p className="text-mute">{profile.legal_name}</p>
          <p className="text-mute">
            {[profile.city, profile.county, profile.state_code].filter(Boolean).join(", ")}
          </p>
          {profile.ein ? <p className="text-mute">EIN {profile.ein}</p> : null}
        </div>
        {isBoardAdmin ? (
          <div className="mt-4">
            <AssociationProfileForm profile={profile} />
          </div>
        ) : null}
      </Card>

      <Card title="Units" hint="The roster of units and their specs.">
        <div className="space-y-4">
          <AddUnitForm />
          {unitList.length === 0 ? (
            <Empty>No units on file.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {unitList.map((u) => (
                <UnitRow key={u.id} unit={u} canEdit={isBoard} canDelete={isBoardAdmin} />
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card
        title="People"
        hint="Owners, board members, and anyone else on file — with the roles each one holds."
      >
        <div className="space-y-4">
          <AddPersonForm />
          {personRecords.length === 0 ? (
            <Empty>No one on file yet.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {personRecords.map((p) => (
                <PersonRow
                  key={p.id}
                  person={p}
                  roles={rolesByPerson.get(p.id) ?? []}
                  canEdit={isBoard}
                />
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card
        title="Ownership"
        hint="Who owns each unit today, and the percentage history behind the 1120-H."
      >
        <div className="space-y-4">
          {unitList.length === 0 ? (
            <Empty>Add units before recording ownership.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {unitList.map((u) => (
                <OwnershipRow
                  key={u.id}
                  unitId={u.id}
                  unitLabel={u.label}
                  owners={ownersByUnit.get(u.id) ?? []}
                  persons={personOptions}
                  canEdit={isBoard}
                />
              ))}
            </ul>
          )}
          {unitList.length > 0 ? (
            <OwnershipAmendmentForm
              units={unitList.map((u) => ({ id: u.id, label: u.label }))}
              currentPercentages={currentPercentages}
            />
          ) : null}
          <div className="border-t border-line pt-3">
            <h3 className="text-[12px] font-medium text-mute">Amendment history</h3>
            <div className="mt-2">
              <AmendmentHistory amendments={amendments} />
            </div>
          </div>
        </div>
      </Card>

      {isBoardAdmin ? (
        <Card
          title="Role grants"
          hint="Who has access to the books, and what they can do with it."
        >
          <div className="space-y-4">
            <GrantRoleForm persons={personOptions} />
            {roleGrants.length === 0 ? (
              <Empty>No roles granted yet.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {roleGrants.map((g) => (
                  <RoleGrantRow key={g.id} grant={g} />
                ))}
              </ul>
            )}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
