import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui";
import { btnSecondary } from "@/components/repairs/styles";
import { telHref } from "@/components/repairs/emergency-banner";
import { ContactLine } from "@/components/owner/contact-line";
import { loadEmergencyInfo } from "@/lib/repairs/page-data";
import { loadOwnedUnits } from "@/lib/owner/load";
import { ViewerUnavailable } from "@/components/owner/viewer-unavailable";
import { getViewer } from "@/lib/owner/viewer";

export const dynamic = "force-dynamic";

/** Your building: who to contact, who is on the board, what to do in an emergency (owner-portal-spec 6.7). */
export default async function OwnerBuildingPage() {
  const viewer = await getViewer();
  if (!viewer) return <ViewerUnavailable />;
  const supabase = await createClient();

  const [assocRes, rosterRes, emergency, units] = await Promise.all([
    supabase.from("associations").select("display_name, street_address, city, state_code, postal_code").eq("id", viewer.associationId).limit(1),
    supabase.rpc("board_roster", { p_association_id: viewer.associationId }),
    loadEmergencyInfo(supabase, viewer.associationId),
    loadOwnedUnits(supabase, viewer),
  ]);
  const a = assocRes.data?.[0] as
    | { display_name: string; street_address: string | null; city: string | null; state_code: string | null; postal_code: string | null }
    | undefined;
  const cityLine = [a?.city, [a?.state_code, a?.postal_code].filter(Boolean).join(" ")].filter((s) => s && s.trim()).join(", ");
  const roster = rosterRes.error ? [] : ((rosterRes.data ?? []) as { full_name: string; role: string; title: string | null }[]);

  const b = emergency.building;
  const facts: { label: string; text: string; tel: string | null }[] = [];
  if (b) {
    const phoneRow = (label: string, name: string | null, phone: string | null) => {
      const text = [name, phone].filter(Boolean).join(" ");
      if (text) facts.push({ label, text, tel: phone ? telHref(phone) : null });
    };
    if (b.water_shutoff_location) facts.push({ label: "Main water shut-off", text: b.water_shutoff_location, tel: null });
    phoneRow("Gas company emergency line", b.gas_utility_name, b.gas_emergency_phone);
    if (b.electric_panel_location) facts.push({ label: "Electric panel", text: b.electric_panel_location, tel: null });
    phoneRow("Elevator company", b.elevator_company_name, b.elevator_company_phone);
  }
  const nothingEntered = facts.length === 0 && emergency.contacts.length === 0;

  return (
    <div className="mx-auto w-full max-w-[760px] space-y-6">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Your building</h1>
        <p className="mt-1 text-mute">Who to contact, and what to do in an emergency.</p>
      </div>

      <Card navy title="The association">
        <p className="text-[15px] font-medium text-ink">{a?.display_name ?? viewer.associationName}</p>
        {a?.street_address ? <p className="text-[14px] text-ink">{a.street_address}</p> : null}
        {cityLine ? <p className="text-[14px] text-ink">{cityLine}</p> : null}
        {units.length > 0 ? (
          <p className="mt-2 text-[13px] text-mute">Your {units.length === 1 ? "unit" : "units"}: {units.map((u) => u.label).join(", ")}</p>
        ) : null}
      </Card>

      <Card navy title="Who to contact">
        <ContactLine contact={viewer.boardContact} canEdit={viewer.isBoardAdmin} />
        {roster.length > 0 ? (
          <div className="mt-4 border-t border-line pt-3">
            <h3 className="text-[12px] font-medium text-mute">Board members</h3>
            <ul className="mt-1 divide-y divide-line">
              {roster.map((m, i) => (
                <li key={`${m.full_name}-${i}`} className="flex items-baseline justify-between gap-3 py-2 text-[14px]">
                  <span className="text-ink">{m.full_name}</span>
                  <span className="text-[12px] text-mute">{m.title ?? (m.role === "board_admin" ? "Board admin" : "Board member")}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      <Card navy title="In an emergency">
        <p className="text-[15px] font-bold text-bad-text">Call 911 first if anyone is in danger.</p>
        {nothingEntered ? (
          <p className="mt-2 text-[14px] text-mute">Your board hasn&rsquo;t added this building&rsquo;s emergency information yet.</p>
        ) : (
          <>
            {facts.length > 0 ? (
              <dl className="mt-2 divide-y divide-line">
                {facts.map((f) => (
                  <div key={f.label} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:justify-between sm:gap-4">
                    <dt className="text-[13px] text-mute">{f.label}</dt>
                    <dd className="text-[14px] text-ink sm:text-right">
                      {f.tel ? (
                        <a href={f.tel} className="underline underline-offset-2">
                          {f.text}
                        </a>
                      ) : (
                        <span className="whitespace-pre-wrap break-words">{f.text}</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {emergency.contacts.length > 0 ? (
              <ul className="mt-3 divide-y divide-line border-t border-line">
                {emergency.contacts.map((c, i) => (
                  <li key={`${c.name}-${i}`} className="flex items-center justify-between gap-3 py-2 text-[14px]">
                    <span className="text-ink">
                      {c.name}
                      {c.label ? <span className="text-mute">, {c.label}</span> : null}
                    </span>
                    <a href={telHref(c.phone)} className="inline-flex min-h-[44px] items-center underline underline-offset-2">
                      {c.phone}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
        <p className="mt-3">
          <Link href="/repairs/emergency-info" className={btnSecondary}>
            Everything to do in an emergency
          </Link>
        </p>
      </Card>

      <Card navy title="Documents">
        <Link href="/documents" className="flex min-h-[44px] items-center text-[14px] text-ink underline underline-offset-2">
          Governing documents, minutes and statements the board shared
        </Link>
      </Card>

      <Card navy title="Insurance">
        <Link href="/insurance" className="flex min-h-[44px] items-center text-[14px] text-ink underline underline-offset-2">
          What the master policy means for you
        </Link>
      </Card>
    </div>
  );
}
