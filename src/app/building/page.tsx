import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Restricted } from "@/components/ui";
import { BoardOnly, viewerIsOwnerOnly } from "@/components/board-only";
import { AssociationProfileForm, type AssociationProfile } from "./association-profile-form";
import { AddUnitForm } from "./add-unit-form";
import { UnitRow, type UnitRecord } from "./unit-row";
import { AddPersonForm } from "./add-person-form";
import { PersonRow } from "./person-row";
import { OwnershipRow, type CurrentOwner } from "./ownership-row";
import { OwnershipAmendmentForm } from "./ownership-amendment-form";
import { AmendmentHistory, type AmendmentHistoryEntry } from "./amendment-history";
import { GenerateInviteForm } from "./generate-invite-form";
import { InviteRow, type InviteRecord } from "./invite-row";
import { AccessReviewCard, type AccessReviewRecord } from "./access-review-card";
import Link from "next/link";
import { formatMoney, longDate } from "@/lib/insurance/format";
import { inForce } from "@/lib/insurance/status";
import { todayIso as localTodayIso } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function BuildingPage() {
  const supabase = await createClient();

  const { data: associations } = await supabase
    .from("associations")
    .select(
      "id, legal_name, display_name, state_code, county, city, street_address, postal_code, year_built, construction_type, stories, roof_replaced_year, ein, incorporated_on, fiscal_year_end_month, capitalization_threshold, capitalization_threshold_source, board_contact_name, board_contact_email, board_contact_phone",
    );
  const association = associations?.[0];
  if (!association) return <Restricted what="building settings" />;

  const { data: isBoardRes } = await supabase.rpc("has_role_in", {
    assoc: association.id,
    roles: ["board_admin", "board_member"],
  });
  const isBoard = isBoardRes === true;
  if (!isBoard) {
    // An owner (not the board or the accountant) gets the page that says so
    // and points at the owner's building page (owner-portal-spec 2.4).
    if (await viewerIsOwnerOnly()) {
      return (
        <BoardOnly
          what="Building Info"
          why="It is where the board manages units, owners and who can sign in."
          alternative={{ label: "See your building", href: "/owner/building" }}
        />
      );
    }
    return (
      <div className="space-y-6">
        <Restricted what="building settings" />
        <Card title="About the building">
          <ul className="space-y-1 text-[13px]">
            <li>
              <Link href="/insurance" className="inline-flex min-h-[40px] items-center text-ink underline underline-offset-2">
                What the building&rsquo;s insurance covers
              </Link>
            </li>
            <li>
              <Link href="/repairs/emergency-info" className="inline-flex min-h-[40px] items-center text-ink underline underline-offset-2">
                Emergency information
              </Link>
            </li>
          </ul>
        </Card>
      </div>
    );
  }

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
    { data: inviteRows },
    { data: reviewRows },
    { data: factRows },
    { data: policyRows },
  ] = await Promise.all([
    supabase
      .from("units")
      .select(
        "id, label, sort_order, square_footage, bedroom_count, full_bathrooms, half_bathrooms",
      )
      .order("sort_order"),
    supabase
      .from("persons")
      .select("id, full_name, email, phone, mailing_address, auth_user_id")
      .order("full_name"),
    supabase
      .from("role_grants")
      .select("person_id, role, expires_on, revoked_at")
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
    supabase
      .from("invites")
      .select("id, token, role, email, expires_at, redeemed_at")
      .order("created_at", { ascending: false }),
    // RLS returns nothing to a non-admin; the card only renders for admins.
    supabase
      .from("access_reviews")
      .select("id, reviewed_at, reviewed_by, notes, active_grants, revoked_count")
      .order("reviewed_at", { ascending: false })
      .limit(5),
    // The facts the insurance coverage check reads (insurance-spec §12 I-6).
    supabase
      .from("insurance_building_facts")
      .select("replacement_cost_estimate::text, replacement_cost_as_of, flood_zone, has_boiler, has_elevator, manager_handles_funds")
      .limit(1),
    supabase
      .from("insurance_policies")
      .select("id, coverage, carrier_name, effective_from, effective_to, renewal_reminder_days, archived_at, replaced_by_policy_id, replaced_at")
      .is("archived_at", null),
  ]);

  const profile: AssociationProfile = {
    legal_name: association.legal_name,
    display_name: association.display_name,
    state_code: association.state_code,
    county: association.county,
    city: association.city,
    street_address: association.street_address,
    postal_code: association.postal_code,
    year_built: association.year_built,
    construction_type: association.construction_type,
    stories: association.stories,
    roof_replaced_year: association.roof_replaced_year,
    ein: association.ein,
    incorporated_on: association.incorporated_on,
    fiscal_year_end_month: association.fiscal_year_end_month,
    capitalization_threshold: Number(association.capitalization_threshold),
    capitalization_threshold_source: association.capitalization_threshold_source,
    board_contact_name: association.board_contact_name,
    board_contact_email: association.board_contact_email,
    board_contact_phone: association.board_contact_phone,
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

  const personRecords = persons ?? [];

  const currentOwnerIds = new Set((unitOwnerRows ?? []).map((r) => r.person_id));
  const nameByAuthUser = new Map(
    (persons ?? [])
      .filter((p) => p.auth_user_id)
      .map((p) => [p.auth_user_id as string, p.full_name]),
  );
  const accessReviews: AccessReviewRecord[] = (reviewRows ?? []).map((r) => ({
    id: r.id,
    reviewedAt: r.reviewed_at,
    reviewerName: r.reviewed_by ? (nameByAuthUser.get(r.reviewed_by) ?? null) : null,
    notes: r.notes,
    grantCount: Array.isArray(r.active_grants) ? r.active_grants.length : 0,
    revokedCount: r.revoked_count,
  }));
  const daysSinceReview = accessReviews[0]
    ? Math.floor((Date.parse(`${todayIso}T00:00:00Z`) - Date.parse(accessReviews[0].reviewedAt)) / 86400000)
    : null;
  const activeGrantCount = [...rolesByPerson.values()].reduce((n, roles) => n + roles.length, 0);

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

  const insuranceFacts = buildingInsuranceFacts(factRows?.[0] ?? null);
  const master = inForce(
    (policyRows ?? []).map((p) => ({
      id: p.id as string,
      coverage: p.coverage as string,
      carrier_name: p.carrier_name as string,
      effective_from: p.effective_from as string,
      effective_to: p.effective_to as string,
      renewal_reminder_days: (p.renewal_reminder_days as number | null) ?? 60,
      archived_at: (p.archived_at as string | null) ?? null,
      replaced_by_policy_id: (p.replaced_by_policy_id as string | null) ?? null,
      replaced_at: (p.replaced_at as string | null) ?? null,
    })),
    localTodayIso(),
  )
    .filter((p) => p.coverage === "property")
    .sort((a, b) => a.effective_to.localeCompare(b.effective_to))[0];

  const invites: InviteRecord[] = (inviteRows ?? []).map((i) => ({
    id: i.id,
    token: i.token,
    role: i.role,
    email: i.email,
    expiresAt: i.expires_at,
    redeemedAt: i.redeemed_at,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Building</h1>
        <p className="mt-1 text-mute">
          The association&rsquo;s own profile, the unit roster, who lives where, and who has
          access to the books.
        </p>
      </div>

      {isBoardAdmin ? (
        <p className="text-[13px] text-mute">
          <Link href="/building/import" className="font-medium text-ink underline underline-offset-2">
            Import from a spreadsheet
          </Link>
          {" "}
          Bring in units, owners, transactions and opening balances.
        </p>
      ) : null}

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
          <p className="text-mute">
            Owners write to:{" "}
            {profile.board_contact_name || profile.board_contact_email
              ? [profile.board_contact_name, profile.board_contact_email].filter(Boolean).join(", ")
              : "not set yet"}
          </p>
        </div>
        {isBoardAdmin ? (
          <div className="mt-4">
            <AssociationProfileForm profile={profile} />
          </div>
        ) : null}
      </Card>

      <Card title="Insurance facts" hint="What the insurance coverage check knows about the building.">
        <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
          {insuranceFacts.map((f) => (
            <div key={f.label}>
              <dt className="text-[12px] text-mute">{f.label}</dt>
              <dd className={f.value ? "text-ink" : "text-mute-soft"}>{f.value ?? "Not answered yet"}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-[13px] text-ink">
          <Link href="/insurance" className="underline underline-offset-2">
            {master
              ? `Master policy: ${master.carrier_name}, renews ${longDate(master.effective_to)}`
              : "No master policy recorded yet"}
          </Link>
        </p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
          <Link href="/insurance/facts" className="inline-flex min-h-[40px] items-center font-medium text-ink underline underline-offset-2">
            Edit on Insurance
          </Link>
          <Link href="/repairs/emergency-info" className="inline-flex min-h-[40px] items-center text-ink underline underline-offset-2">
            Emergency information
          </Link>
        </div>
      </Card>

      <Card title="Units" hint="The roster of units and their specs.">
        <div className="space-y-4">
          <AddUnitForm />
          {unitList.length === 0 ? (
            <Empty>
              No units yet. Add them one at a time, or{" "}
              <Link href="/building/import" className="underline underline-offset-2">
                import a spreadsheet
              </Link>
              .
            </Empty>
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
        hint="Owners, board members, and anyone else on file — with who has access to the books and what they can do with it."
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
                  canEditRoles={isBoardAdmin}
                  invite={
                    isBoard && !p.auth_user_id && ((rolesByPerson.get(p.id) ?? []).includes("owner") || currentOwnerIds.has(p.id))
                      ? { associationName: association.display_name, boardContactName: association.board_contact_name ?? null }
                      : null
                  }
                  canRedact={
                    isBoardAdmin &&
                    (rolesByPerson.get(p.id) ?? []).length === 0 &&
                    !currentOwnerIds.has(p.id) &&
                    !(p.full_name === "Former member" && !p.email)
                  }
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
                  canDelete={isBoardAdmin}
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
          title="Access review"
          hint="Every 90 days, confirm everyone who can see the books still should."
        >
          <AccessReviewCard
            reviews={accessReviews}
            activeGrantCount={activeGrantCount}
            daysSince={daysSinceReview === null ? null : Math.max(0, daysSinceReview)}
          />
        </Card>
      ) : null}

      {isBoard ? (
        <Card
          title="Invites"
          hint="Send a link instead of granting a role by hand — the person sets their own password and joins at the role you pick."
        >
          <div className="space-y-4">
            <GenerateInviteForm people={(persons ?? []).filter((p) => !p.auth_user_id).map((p) => ({ id: p.id, full_name: p.full_name }))} />
            {invites.length === 0 ? (
              <Empty>No invites yet.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {invites.map((i) => (
                  <InviteRow key={i.id} invite={i} />
                ))}
              </ul>
            )}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * Four facts from insurance_building_facts for the Building Info card
 * (insurance-spec §12 I-6); null value = not answered yet.
 */
function buildingInsuranceFacts(
  row: {
    replacement_cost_estimate: string | null;
    replacement_cost_as_of: string | null;
    flood_zone: string | null;
    has_boiler: boolean | null;
    has_elevator: boolean | null;
    manager_handles_funds: boolean | null;
  } | null,
): { label: string; value: string | null }[] {
  const cost = formatMoney(row?.replacement_cost_estimate ?? null);
  const equipment =
    row?.has_boiler === true && row?.has_elevator === true
      ? "A boiler and an elevator"
      : row?.has_boiler === true
        ? "A boiler"
        : row?.has_elevator === true
          ? "An elevator"
          : row?.has_boiler === false && row?.has_elevator === false
            ? "Neither"
            : null;
  return [
    {
      label: "Replacement cost estimate",
      value: cost ? (row?.replacement_cost_as_of ? `${cost} as of ${longDate(row.replacement_cost_as_of)}` : cost) : null,
    },
    {
      label: "Flood zone",
      value: !row?.flood_zone ? null : row.flood_zone === "unknown" ? "Not sure" : `Zone ${row.flood_zone}`,
    },
    { label: "Boiler or elevator", value: equipment },
    {
      label: "Who handles the association's money",
      value:
        row?.manager_handles_funds === true
          ? "A management company"
          : row?.manager_handles_funds === false
            ? "The board"
            : null,
    },
  ];
}
