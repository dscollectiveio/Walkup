import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Restricted } from "@/components/ui";
import { BoardOnly, viewerIsOwnerOnly } from "@/components/board-only";
import { getViewer } from "@/lib/owner/viewer";
import { ManagerBuildingView } from "./manager-view";
import { AttorneySharesPanel } from "./attorney-shares-panel";
import { APP_ROLES, ROLE_LABEL, isTimedRole, type AppRole } from "@/lib/access/outside-roles";
import type { AssociationProfile } from "./association-profile-form";
import { AssociationSummary } from "./association-summary";
import { UnitsCard, AddOtherPerson } from "./add-bar";
import { DetailsPanel } from "./details-panel";
import type { Resident } from "./unit-card";
import type { UnitRecord } from "./unit-fields";
import { PersonRow } from "./person-row";
import { loadAllContactDetails } from "@/lib/people/contact-details";
import { OwnershipAmendmentForm } from "./ownership-amendment-form";
import { AmendmentHistory, type AmendmentHistoryEntry } from "./amendment-history";
import { OwnerRecordsHistory, type OwnershipRecord } from "./owner-records";
import { GenerateInviteForm } from "./generate-invite-form";
import { InviteRow, type InviteRecord } from "./invite-row";
import { AccessReviewCard, type AccessReviewRecord } from "./access-review-card";
import { OwnerFinancesCard } from "./owner-finances-card";
import Link from "next/link";
import { aiConfigured } from "@/lib/ai/client";
import { inForce } from "@/lib/insurance/status";
import { todayIso as localTodayIso } from "@/lib/dates";
import { btnPrimary } from "@/components/repairs/styles";

export const dynamic = "force-dynamic";

export default async function BuildingPage({ searchParams }: { searchParams: Promise<{ unit?: string }> }) {
  const { unit: unitParam } = await searchParams;
  const supabase = await createClient();

  const { data: associations } = await supabase
    .from("associations")
    .select(
      "id, legal_name, display_name, state_code, county, city, street_address, postal_code, year_built, construction_type, stories, roof_replaced_year, incorporated_on, fiscal_year_end_month, capitalization_threshold, capitalization_threshold_source, board_contact_name, board_contact_email, board_contact_phone, accountant_person_id, accountant_firm, il_sos_file_number, information_returns_filing",
    );
  const association = associations?.[0];
  if (!association) return <Restricted what="building settings" />;

  const { data: taxIdRows } = await supabase.from("association_tax_ids").select("ein").eq("association_id", association.id).limit(1);
  const ein = (taxIdRows?.[0]?.ein as string | null | undefined) ?? null;

  const { data: isBoardRes } = await supabase.rpc("has_role_in", {
    assoc: association.id,
    roles: ["board_admin", "board_member"],
  });
  const isBoard = isBoardRes === true;
  if (!isBoard) {
    // A property manager (0080) reads the units, owners and contact details, read only.
    const viewer = await getViewer();
    if (viewer?.roles.includes("property_manager")) {
      return <ManagerBuildingView supabase={supabase} associationId={association.id} />;
    }
    // An owner (not the board or the accountant) gets the page that says so
    // and points at the owner's building page (owner-portal-spec 2.4).
    if (await viewerIsOwnerOnly()) {
      return (
        <BoardOnly
          what="Building & Owners"
          why="It is where the board manages units, owners and who can sign in."
          alternative={{ label: "See your building", href: "/owner/building" }}
        />
      );
    }
    return (
      <div className="space-y-6">
        <Restricted what="building settings" />
        <Card navy title="About the building">
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

  // Whether owners can see the Finances page (0079). Only an admin sees the switch, so only an admin asks.
  // A failed read shows the switch as off, which is also what a database without 0079 means.
  let ownerFinancesOn = false;
  if (isBoardAdmin) {
    const { data: ownerFinancesRes } = await supabase.rpc("owner_finances_enabled", { p_association_id: association.id });
    ownerFinancesOn = ownerFinancesRes === true;
  }

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
        "id, label, unit_type, floor, notes, sort_order, square_footage, bedroom_count, full_bathrooms, half_bathrooms",
      )
      .order("sort_order")
      .order("label"),
    supabase
      .from("persons")
      .select("id, full_name, email, auth_user_id")
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
      .select("replacement_cost_estimate::text, replacement_cost_as_of, replacement_cost_source, flood_zone, has_boiler, has_elevator, has_sprinklers, manager_handles_funds, management_company")
      .limit(1),
    supabase
      .from("insurance_policies")
      .select("id, coverage, carrier_name, policy_number, building_limit::text, valuation, annual_premium::text, effective_from, effective_to, renewal_reminder_days, archived_at, replaced_by_policy_id, replaced_at")
      .is("archived_at", null),
  ]);

  // Owners whose time in a unit has ended, so the whole ownership history can be shown (and, for a
  // board admin, a mistaken record deleted). The current ones are in unitOwnerRows already.
  const { data: pastOwnerRows } = await supabase
    .from("unit_owners")
    .select("id, unit_id, effective_from, effective_to, persons(full_name)")
    .lt("effective_to", todayIso)
    .order("effective_from", { ascending: false });
  const historyByUnit = new Map<string, OwnershipRecord[]>();
  for (const row of [...(unitOwnerRows ?? []), ...(pastOwnerRows ?? [])]) {
    const p = row.persons as unknown as { full_name: string } | null;
    const list = historyByUnit.get(row.unit_id) ?? [];
    list.push({
      rowId: row.id,
      name: p?.full_name ?? "Former member",
      from: row.effective_from,
      to: row.effective_to && row.effective_to >= todayIso ? null : row.effective_to,
    });
    historyByUnit.set(row.unit_id, list);
  }
  for (const list of historyByUnit.values()) list.sort((a, b) => (a.from < b.from ? 1 : a.from > b.from ? -1 : 0));

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
    ein,
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
  // People whose access ends by itself (the accountant and the outside roles): the day, and which role it is.
  const accessEnds = new Map<string, { on: string; label: string }>();
  for (const g of roleGrantRows ?? []) {
    if (g.revoked_at) continue;
    if (g.expires_on && g.expires_on < todayIso) continue;
    if (isTimedRole(g.role) && g.expires_on) {
      const earlier = accessEnds.get(g.person_id);
      if (!earlier || g.expires_on > earlier.on) accessEnds.set(g.person_id, { on: g.expires_on, label: ROLE_LABEL[g.role as AppRole] });
    }
    const list = rolesByPerson.get(g.person_id) ?? [];
    list.push(g.role);
    rolesByPerson.set(g.person_id, list);
  }

  // Phone and mailing address are in their own table (0082); this page is the board's, which reads them all.
  const contactByPerson = await loadAllContactDetails(supabase);
  const personRecords = (persons ?? []).map((p) => ({
    ...p,
    phone: contactByPerson.get(p.id)?.phone ?? null,
    mailing_address: contactByPerson.get(p.id)?.mailing_address ?? null,
  }));

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

  const ownersByUnit = new Map<string, { rowId: string; personId: string; personName: string; effectiveFrom: string }[]>();
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

  // The account owner: the signed-in person, with their highest HOA title.
  const TITLES: [string, string][] = APP_ROLES.map((r) => [r, ROLE_LABEL[r]]);
  const { data: authData } = await supabase.auth.getUser();
  const me = (persons ?? []).find((p) => p.auth_user_id && p.auth_user_id === authData.user?.id);
  const myRoles = me ? (rolesByPerson.get(me.id) ?? []) : [];
  const accountOwner = me
    ? { name: me.full_name, title: TITLES.find(([r]) => myRoles.includes(r))?.[1] ?? "Member" }
    : null;
  const accountantPerson = (persons ?? []).find((p) => p.id === association.accountant_person_id);
  const taxSummary = {
    accountantName: accountantPerson?.full_name ?? null,
    accountantFirm: (association.accountant_firm as string | null) ?? null,
    accountantEmail: accountantPerson?.email ?? null,
    filingMethod:
      association.information_returns_filing === "paper" || association.information_returns_filing === "electronic"
        ? (association.information_returns_filing as "paper" | "electronic")
        : null,
    sosFileNumber: (association.il_sos_file_number as string | null) ?? null,
  };
  const factRow = factRows?.[0] as Record<string, unknown> | undefined;
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
  const masterRow = master ? (policyRows ?? []).find((p) => p.id === master.id) : undefined;

  const invites: InviteRecord[] = (inviteRows ?? []).map((i) => ({
    id: i.id,
    token: i.token,
    role: i.role,
    email: i.email,
    expiresAt: i.expires_at,
    redeemedAt: i.redeemed_at,
  }));

  const pendingInvites = invites.filter((i) => !i.redeemedAt && i.expiresAt.slice(0, 10) >= todayIso).length;
  const personById = new Map(personRecords.map((p) => [p.id, p]));
  // "Others on file" is board members, accountants and anyone else who is not in a unit. Owners belong
  // to their units, so anyone in a unit, or whose only role is Owner, is not listed here.
  const isOwnerOnly = (personId: string) => {
    const roles = rolesByPerson.get(personId) ?? [];
    return roles.length > 0 && roles.every((r) => r === "owner");
  };
  const otherPeople = personRecords.filter((p) => !currentOwnerIds.has(p.id) && !isOwnerOnly(p.id));
  const renderPerson = (p: (typeof personRecords)[number], key: string) => (
    <PersonRow
      key={key}
      person={p}
      roles={rolesByPerson.get(p.id) ?? []}
      canEdit={isBoard}
      canEditRoles={isBoardAdmin}
      accessEnds={accessEnds.get(p.id) ?? null}
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
      canDeleteFormer={
        isBoardAdmin &&
        p.full_name === "Former member" &&
        !p.email &&
        (rolesByPerson.get(p.id) ?? []).length === 0 &&
        !currentOwnerIds.has(p.id)
      }
    />
  );

  const rosterUnits = unitList.map((u) => {
    const residents: Resident[] = (ownersByUnit.get(u.id) ?? []).flatMap((o) => {
                  const p = personById.get(o.personId);
                  if (!p) return [];
                  const roles = rolesByPerson.get(p.id) ?? [];
                  return [
                    {
                      personId: p.id,
                      ownerRowId: o.rowId,
                      fullName: p.full_name,
                      email: p.email,
                      phone: p.phone,
                      mailingAddress: p.mailing_address,
                      roles,
                      invite:
                        isBoard && !p.auth_user_id
                          ? { associationName: association.display_name, boardContactName: association.board_contact_name ?? null }
                          : null,
                    },
                  ];
                });
    return { unit: u, residents, share: currentPercentages[u.id] ?? null };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[20px] font-bold tracking-tight text-ink">Building</h1>
          <p className="mt-1 text-mute">
            The association&rsquo;s own profile, the units and the people in them, and who has
            access to the books.
          </p>
        </div>
        {isBoard ? (
          <Link
            href="/documents"
            className={`${btnPrimary} w-full shrink-0 sm:w-auto`}
          >
            Add Documents
          </Link>
        ) : null}
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

        <AssociationSummary
          profile={profile}
          facts={{
            replacement_cost_estimate: (factRow?.replacement_cost_estimate as string | null) ?? null,
            replacement_cost_as_of: (factRow?.replacement_cost_as_of as string | null) ?? null,
            replacement_cost_source: (factRow?.replacement_cost_source as string | null) ?? null,
            flood_zone: (factRow?.flood_zone as string | null) ?? null,
            has_boiler: (factRow?.has_boiler as boolean | null) ?? null,
            has_elevator: (factRow?.has_elevator as boolean | null) ?? null,
            has_sprinklers: (factRow?.has_sprinklers as boolean | null) ?? null,
            manager_handles_funds: (factRow?.manager_handles_funds as boolean | null) ?? null,
            management_company: (factRow?.management_company as string | null) ?? null,
          }}
          master={
            master
              ? {
                  id: master.id,
                  carrier: master.carrier_name,
                  policyNumber: masterRow?.policy_number ?? null,
                  starts: master.effective_from,
                  renews: master.effective_to,
                  buildingLimit: masterRow?.building_limit ?? null,
                  valuation: masterRow?.valuation ?? null,
                  annualPremium: masterRow?.annual_premium ?? null,
                }
              : null
          }
          aiOn={aiConfigured()}
          unitCount={unitList.length}
          owner={accountOwner}
          tax={taxSummary}
          canEditProfile={isBoardAdmin}
          canEditFacts={isBoard}
        />

      <UnitsCard
        initialOpenId={unitList.some((u) => u.id === unitParam) ? (unitParam ?? null) : null}
        canAdd={isBoard}
        people={personOptions}
        canEditRoles={isBoardAdmin}
        canDelete={isBoardAdmin}
        roster={rosterUnits}
      >
        <div className="space-y-5">
          {unitList.length === 0 ? (
            <Empty>
              {isBoardAdmin ? (
                <>
                  No units yet. Add them one at a time, or{" "}
                  <Link href="/building/import" className="underline underline-offset-2">
                    import a spreadsheet
                  </Link>
                  .
                </>
              ) : (
                "No units yet. Add them one at a time."
              )}
            </Empty>
          ) : null}

          {otherPeople.length > 0 || isBoard ? (
            <div className="space-y-2 border-t border-line pt-5">
              <div>
                <h3 className="text-[13px] font-bold text-ink">Others on file</h3>
                <p className="mt-0.5 text-[12px] text-mute">Board members, accountants and anyone else who is not in a unit.</p>
              </div>
              <ul className="divide-y divide-line">{otherPeople.map((p) => renderPerson(p, p.id))}</ul>
              {isBoard ? <AddOtherPerson canEditRoles={isBoardAdmin} /> : null}
            </div>
          ) : null}

          <div className="space-y-3 border-t border-line pt-5">
            {unitList.length > 0 ? (
              <DetailsPanel
                title="Ownership shares and history"
                summary="The percentage each unit owns, and every change, behind the 1120-H."
                badge={amendments.length > 0 ? `${amendments.length} on record` : null}
              >
                {isBoard ? (
                  <OwnershipAmendmentForm
                    units={unitList.map((u) => ({ id: u.id, label: u.label }))}
                    currentPercentages={currentPercentages}
                  />
                ) : null}
                <div>
                  <h4 className="text-[12px] font-medium text-mute">History</h4>
                  <div className="mt-2">
                    <AmendmentHistory amendments={amendments} canDelete={isBoardAdmin} />
                    <OwnerRecordsHistory
                      units={unitList.map((u) => ({ id: u.id, label: u.label, records: historyByUnit.get(u.id) ?? [] }))}
                      canDelete={isBoardAdmin}
                    />
                  </div>
                </div>
              </DetailsPanel>
            ) : null}

            {isBoard ? (
              <DetailsPanel
                title="Sign-in invites"
                summary="Send a link; the person sets their own password and joins at the role you pick."
                badge={pendingInvites > 0 ? `${pendingInvites} waiting` : null}
              >
                <GenerateInviteForm canGiveAnyRole={isBoardAdmin} people={(persons ?? []).filter((p) => !p.auth_user_id).map((p) => ({ id: p.id, full_name: p.full_name }))} />
                {invites.length === 0 ? (
                  <Empty>No invites yet.</Empty>
                ) : (
                  <ul className="divide-y divide-line">
                    {invites.map((i) => (
                      <InviteRow key={i.id} invite={i} canRevokeInvites={isBoardAdmin} />
                    ))}
                  </ul>
                )}
              </DetailsPanel>
            ) : null}
          </div>
        </div>
      </UnitsCard>

      {isBoardAdmin ? (
        <Card navy
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

      {isBoardAdmin ? (
        <Card
          navy
          title="Share with an attorney"
          hint="An attorney opens only the legal notices, contracts and correspondence you share, and sees owner contact details and dues for the units you share."
        >
          <AttorneySharesPanel supabase={supabase} todayIso={todayIso} />
        </Card>
      ) : null}

      {isBoardAdmin ? (
        <Card navy title="Finances page for owners" hint="Off until you turn it on.">
          <OwnerFinancesCard enabled={ownerFinancesOn} />
        </Card>
      ) : null}

    </div>
  );
}
