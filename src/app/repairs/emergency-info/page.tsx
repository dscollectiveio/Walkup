import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Restricted } from "@/components/ui";
import { smsHref, telHref } from "@/components/repairs/emergency-banner";
import { EMERGENCY_GUIDANCE, EMERGENCY_KINDS, type BuildingEmergencyInfo } from "@/lib/repairs/emergency";
import { loadEmergencyInfo, loadViewer } from "@/lib/repairs/page-data";
import { EmergencyInfoForm, type ContactRow } from "./emergency-info-form";

export const dynamic = "force-dynamic";

/**
 * In an emergency (repairs-spec §14.3): the fixed safety steps first, then
 * the facts about this building the board wrote down, then who to call.
 * Members read; the board edits. Nothing here is filled in by Walkup.
 */

const ROWS: { label: string; text: (b: BuildingEmergencyInfo) => string | null; tel?: (b: BuildingEmergencyInfo) => string | null }[] = [
  { label: "Main water shut-off", text: (b) => b.water_shutoff_location },
  {
    label: "Gas company emergency line",
    text: (b) => [b.gas_utility_name, b.gas_emergency_phone].filter(Boolean).join(" ") || null,
    tel: (b) => b.gas_emergency_phone,
  },
  { label: "Electric panel", text: (b) => b.electric_panel_location },
  {
    label: "Power company emergency line",
    text: (b) => [b.electric_utility_name, b.electric_emergency_phone].filter(Boolean).join(" ") || null,
    tel: (b) => b.electric_emergency_phone,
  },
  {
    label: "Elevator company",
    text: (b) => [b.elevator_company_name, b.elevator_company_phone].filter(Boolean).join(" ") || null,
    tel: (b) => b.elevator_company_phone,
  },
  { label: "Other notes", text: (b) => b.other_notes },
];

export default async function EmergencyInfoPage() {
  const supabase = await createClient();
  const viewer = await loadViewer(supabase);
  if (!viewer || !viewer.isMember) return <Restricted what="the building's emergency information" />;
  const [info, contactsRes] = await Promise.all([
    loadEmergencyInfo(supabase, viewer.associationId),
    viewer.isBoard
      ? supabase.from("building_emergency_contacts").select("id, name, label, phone, show_to_owners, sort_order").order("sort_order").order("name")
      : Promise.resolve({ data: null }),
  ]);
  const b = info.building;
  const rows = ROWS.map((r) => ({ label: r.label, text: b ? r.text(b) : null, tel: b && r.tel ? r.tel(b) : null }));
  const shown = viewer.isBoard ? rows : rows.filter((r) => r.text);

  return (
    <div className="mx-auto w-full max-w-[760px] space-y-6">
      <div>
        <Link href="/repairs" className="inline-flex min-h-[44px] items-center text-[13px] text-mute hover:underline">
          ← Repairs &amp; Upkeep
        </Link>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">In an emergency</h1>
        <p className="mt-1 text-mute">What to do first, and the facts about this building the board has written down.</p>
      </div>

      <section className="rounded-xl border border-bad-line bg-paper">
        <header className="border-b border-line px-5 py-4">
          <h2 className="text-[16px] font-bold text-bad-text">Call 911 first if anyone is in danger</h2>
        </header>
        <ul className="divide-y divide-line">
          {EMERGENCY_KINDS.map((k) => {
            const g = EMERGENCY_GUIDANCE[k];
            return (
              <li key={k}>
                <details className="group px-5">
                  <summary className="flex min-h-[48px] cursor-pointer items-center justify-between gap-3 text-[14px] font-medium text-ink">
                    {g.headline}
                    <span aria-hidden="true" className="text-mute group-open:rotate-180">
                      ▾
                    </span>
                  </summary>
                  <ol className="list-decimal space-y-1 pb-4 pl-5 text-[13px] leading-relaxed text-ink">
                    {g.steps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                </details>
              </li>
            );
          })}
        </ul>
        <p className="px-5 pb-4 text-[11px] text-mute">General safety steps, the same for every building.</p>
      </section>

      <Card title="In this building">
        {shown.length === 0 ? (
          <p className="text-[14px] text-mute">Your board hasn&rsquo;t added this building&rsquo;s emergency information yet.</p>
        ) : (
          <dl className="divide-y divide-line">
            {shown.map((r) => (
              <div key={r.label} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:justify-between sm:gap-4">
                <dt className="text-[13px] text-mute">{r.label}</dt>
                <dd className="text-[14px] text-ink sm:text-right">
                  {r.text ? (
                    r.tel ? (
                      <a href={telHref(r.tel)} className="underline underline-offset-2">
                        {r.text}
                      </a>
                    ) : (
                      <span className="whitespace-pre-wrap">{r.text}</span>
                    )
                  ) : (
                    <span className="text-mute">
                      Not recorded{" "}
                      <a href="#edit-emergency-info" className="inline-flex min-h-[44px] items-center px-1 text-ink underline underline-offset-2">
                        Add
                      </a>
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Card>

      <Card title="Who to call on the board">
        {info.contacts.length === 0 ? (
          <p className="text-[14px] text-mute">No board contacts listed yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {info.contacts.map((c) => (
              <li key={`${c.name}-${c.phone}`} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-[14px] text-ink">
                  {c.name}
                  {c.label ? `, ${c.label}` : ""}: {c.phone}
                </span>
                <span className="flex gap-3 text-[13px]">
                  <a href={telHref(c.phone)} className="inline-flex min-h-[44px] items-center underline underline-offset-2">
                    Call
                  </a>
                  <a href={smsHref(c.phone)} className="inline-flex min-h-[44px] items-center underline underline-offset-2">
                    Text
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {viewer.isBoard ? (
        <EmergencyInfoForm
          building={b}
          contacts={((contactsRes.data ?? []) as ContactRow[]).map((c) => ({ ...c, label: c.label ?? null }))}
          canDelete={viewer.isAdmin}
        />
      ) : null}
    </div>
  );
}
