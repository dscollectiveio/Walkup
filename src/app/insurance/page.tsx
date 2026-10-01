import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { Answer, Card, Empty, Restricted, money } from "@/components/ui";
import {
  COVERAGE_FORM_HELP,
  COVERAGE_FORMS,
  FIELD_DEFS,
  POLICY_TYPES,
  policyWarnings,
} from "@/lib/insurance/declarations";
import type { QuoteRequestPayload } from "./actions";
import { UploadDeclarations } from "./upload-declarations";
import { ClaimsPanel, type ClaimRow } from "./claims-panel";
import { TrackPremium } from "./track-premium";
import { QuoteRequestForm } from "./quote-request-form";
import { RequestRow } from "./request-row";

export const dynamic = "force-dynamic";

const typeLabel = (v: string) => POLICY_TYPES.find((p) => p.value === v)?.label.replace(/ \(.*\)$/, "") ?? v;
const shortType = (v: string) => (v === "property" ? "Master policy" : v === "directors_officers" ? "D&O" : typeLabel(v));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const dollars = (v: unknown) => (num(v) === null ? null : money(num(v)!).replace(/\.00$/, ""));

type Policy = Record<string, unknown> & {
  id: string;
  coverage: string;
  carrier_name: string;
  effective_from: string;
  effective_to: string;
  annual_premium: number;
  replaced_at: string | null;
};

function mailtoFor(partner: { name: string; contact_email: string }, payload: QuoteRequestPayload): string {
  const p = payload;
  const line = (label: string, v: unknown) => (v === null || v === undefined || v === "" ? null : `${label}: ${v}`);
  const body = [
    `Hello ${partner.name},`,
    "",
    `We'd like a quote for our condominium association's insurance. Details below.`,
    "",
    "THE ASSOCIATION",
    line("Legal name", p.association.legal_name),
    line("Address", p.association.address),
    line("Units", p.association.units),
    line("Year built", p.association.year_built),
    line("Construction", p.association.construction_type),
    line("Stories", p.association.stories),
    line("Roof last replaced", p.association.roof_replaced_year),
    "",
    "CURRENT POLICY",
    line("Insurer", p.current.carrier),
    line("Annual premium", p.current.premium),
    line("Renews on", p.current.expires_on),
    "",
    "COVERAGE WANTED",
    line("Building", p.wanted.building_limit),
    line("Liability", p.wanted.liability),
    line("Directors & officers", p.wanted.do_limit),
    line("Umbrella", p.wanted.umbrella_limit),
    line("Flood", p.wanted.flood === null ? null : p.wanted.flood ? "Yes" : "No"),
    "",
    "CLAIMS IN THE LAST 5 YEARS",
    p.claims_last_5_years,
    "",
    p.anything_else ? `ANYTHING ELSE\n${p.anything_else}\n` : null,
    `Please reply to ${p.contact.name} at ${p.contact.email}${p.contact.phone ? ` or ${p.contact.phone}` : ""}.`,
    "",
    "Thank you.",
  ]
    .filter((l) => l !== null)
    .join("\n");
  return `mailto:${encodeURIComponent(partner.contact_email)}?subject=${encodeURIComponent(
    `Insurance quote request — ${p.association.legal_name}`,
  )}&body=${encodeURIComponent(body)}`;
}

export default async function InsurancePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; policy?: string }>;
}) {
  const sp = await searchParams;
  const view = sp.view === "quotes" ? "quotes" : "policy";
  const supabase = await createClient();
  const user = await getUser();

  const { data: associations } = await supabase
    .from("associations")
    .select("id, legal_name, display_name, state_code, street_address, city, postal_code, year_built, construction_type, stories, roof_replaced_year")
    .limit(1);
  const association = associations?.[0];
  if (!association) return <Restricted what="insurance records" />;

  const [{ data: history }, { data: policyRows }, { data: isBoardRes }] = await Promise.all([
    supabase
      .from("insurance_year_over_year")
      .select("policy_id, coverage, carrier_name, effective_from, annual_premium, change_amount, change_percent, previous_carrier, quotes_obtained")
      .order("coverage")
      .order("effective_from", { ascending: false }),
    supabase.from("insurance_policies").select("*").order("effective_from", { ascending: false }),
    supabase.rpc("is_board", { assoc: association.id }),
  ]);
  if (!history || !policyRows) return <Restricted what="insurance records" />;
  const canEdit = isBoardRes === true;

  const today = new Date(new Date().toDateString());
  const todayIso = today.toISOString().slice(0, 10);
  const policies = policyRows as Policy[];
  const current = policies.filter((p) => !p.replaced_at && p.effective_to >= todayIso);
  const selected =
    policies.find((p) => p.id === sp.policy) ?? current.find((p) => p.coverage === "property") ?? current[0] ?? null;

  const tabs = (
    <nav aria-label="Insurance" className="inline-flex rounded-full border border-line bg-paper p-0.5">
      {[
        { key: "policy", label: "Your policy", href: "/insurance" },
        { key: "quotes", label: "Get quotes", href: "/insurance?view=quotes" },
      ].map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={view === t.key ? "page" : undefined}
          className={`inline-flex min-h-[40px] items-center rounded-full px-4 text-[13px] font-medium ${
            view === t.key ? "bg-ink text-paper" : "text-mute hover:text-ink"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );

  const disclaimer = (
    <p className="text-[11px] leading-relaxed text-mute">
      Walkup records your policies and what brokers offer so you can see them side by side. It is not an insurance broker
      and doesn&rsquo;t give insurance advice — choosing cover is a decision for the board, with a licensed broker if you
      want one.
    </p>
  );

  // ==========================================================================
  // GET QUOTES
  // ==========================================================================
  if (view === "quotes") {
    const [{ data: partners }, { data: requests }, { data: quotes }, { data: claims }, { count: unitCount }, { data: me }] =
      await Promise.all([
        supabase.from("insurance_partners").select("id, name, contact_email, states_served").eq("active", true).order("name"),
        supabase
          .from("insurance_quote_requests")
          .select("id, partner_id, status, sent_at, payload_json, created_at")
          .order("created_at", { ascending: false }),
        supabase.from("insurance_quotes").select("*").not("quote_request_id", "is", null).order("quoted_on", { ascending: false }),
        supabase.from("insurance_claims").select("date_of_loss, description, amount_paid, status").order("date_of_loss", { ascending: false }),
        supabase.from("units").select("id", { count: "exact", head: true }),
        user ? supabase.from("persons").select("full_name, phone, email").eq("auth_user_id", user.id).limit(1) : Promise.resolve({ data: [] }),
      ]);
    const partnerList = partners ?? [];
    const inState = partnerList.filter((pt) => (pt.states_served ?? []).includes(association.state_code));
    const partnerById = new Map(partnerList.map((pt) => [pt.id, pt]));
    const quoteRequests = requests ?? [];
    const received = (quotes ?? []) as Record<string, unknown>[];
    const quotedRequestIds = new Set(received.map((q) => q.quote_request_id as string));

    const master = selected ?? current[0] ?? null;
    const fiveYearsAgo = `${today.getFullYear() - 5}${todayIso.slice(4)}`;
    const recentClaims = (claims ?? []).filter((c) => c.date_of_loss >= fiveYearsAgo);
    const person = (me ?? [])[0] as { full_name: string; phone: string | null; email: string | null } | undefined;

    const compareWith = master ? received.filter((q) => q.coverage === master.coverage) : received;
    const rows = FIELD_DEFS.filter((d) => ["limits", "deductibles"].includes(d.group) || d.key === "annual_premium");

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-[20px] font-bold tracking-tight text-ink">Insurance</h1>
          <p className="mt-1 text-mute">Ask brokers for quotes, keep track of replies, and see them next to what you have.</p>
        </div>
        {tabs}

        {inState.length === 0 ? (
          <Card title="Get quotes">
            <p className="text-[13px] text-ink">Quote requests aren&rsquo;t available in your state yet.</p>
          </Card>
        ) : canEdit ? (
          <Card title="Request quotes" hint="Prepared from your saved policy and building details. Everything is editable.">
            <QuoteRequestForm
              partners={inState.map((pt) => ({ id: pt.id, name: pt.name }))}
              prefill={{
                policyId: master?.id ?? null,
                legalName: association.legal_name,
                address: [association.street_address, association.city, association.state_code, association.postal_code]
                  .filter(Boolean)
                  .join(", "),
                units: unitCount ?? 0,
                yearBuilt: association.year_built,
                constructionType: association.construction_type,
                stories: association.stories,
                roofReplacedYear: association.roof_replaced_year,
                currentCarrier: master?.carrier_name ?? null,
                currentPremium: master ? Number(master.annual_premium) : null,
                currentExpiresOn: master?.effective_to ?? null,
                buildingLimit: num(master?.building_limit),
                liability: num(master?.liability_per_occurrence),
                doLimit: num(policies.find((p) => p.coverage === "directors_officers" && current.includes(p))?.do_limit ?? master?.do_limit),
                umbrellaLimit: num(master?.umbrella_limit),
                flood: (master?.flood_covered as boolean | null) ?? null,
                claims:
                  recentClaims.length === 0
                    ? "None."
                    : recentClaims
                        .map((c) => `${c.date_of_loss}: ${c.description}${c.amount_paid !== null ? ` (paid ${money(Number(c.amount_paid))})` : ""} — ${c.status}`)
                        .join("\n"),
                contactName: person?.full_name ?? "",
                contactPhone: person?.phone ?? null,
                contactEmail: person?.email ?? user?.email ?? "",
              }}
            />
          </Card>
        ) : null}

        {quoteRequests.length > 0 ? (
          <Card title="Your requests">
            <ul className="divide-y divide-line">
              {quoteRequests.map((r) => {
                const pt = partnerById.get(r.partner_id);
                return (
                  <RequestRow
                    key={r.id}
                    canEdit={canEdit}
                    request={{
                      id: r.id,
                      partnerName: pt?.name ?? "A broker",
                      status: r.status,
                      sentAt: r.sent_at,
                      mailto: pt ? mailtoFor(pt, r.payload_json as QuoteRequestPayload) : "#",
                      hasQuote: quotedRequestIds.has(r.id),
                    }}
                  />
                );
              })}
            </ul>
          </Card>
        ) : null}

        <Card
          title="Side by side"
          hint={master ? `Your current ${shortType(master.coverage).toLowerCase()} next to each quote received for the same cover.` : undefined}
        >
          {compareWith.length === 0 ? (
            <Empty>No quotes received yet. When one arrives, upload it from “Your requests” and it appears here.</Empty>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-mute">
                      <th className="pb-2 pr-3 font-medium" />
                      <th className="pb-2 pr-3 font-medium">
                        {master ? `Current · ${master.carrier_name}` : "Current"}
                      </th>
                      {compareWith.map((q) => (
                        <th key={q.id as string} className="pb-2 pr-3 font-medium">
                          {q.carrier_name as string}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map((def) => {
                      const cur = master ? master[def.column] : null;
                      const fmt = (v: unknown) =>
                        v === null || v === undefined
                          ? null
                          : def.kind === "money"
                            ? dollars(v)
                            : def.kind === "boolean"
                              ? v ? "Yes" : "No"
                              : def.key === "coverage_form"
                                ? v === "unknown" ? null : COVERAGE_FORMS.find((f) => f.value === v)?.label ?? String(v)
                                : String(v);
                      return (
                        <tr key={def.key}>
                          <th scope="row" className="py-2 pr-3 text-left font-normal text-mute">{def.label}</th>
                          <td className="figures py-2 pr-3 text-ink">{fmt(cur) ?? <span className="text-mute-soft">Not stated</span>}</td>
                          {compareWith.map((q) => {
                            const v = q[def.column];
                            const shown = fmt(v);
                            let note: string | null = null;
                            if (def.key === "annual_premium" && num(cur) && num(v) !== null) {
                              const pct = Math.round(((num(v)! - num(cur)!) / num(cur)!) * 100);
                              note = pct === 0 ? "same as now" : `${pct > 0 ? "+" : ""}${pct}% vs now`;
                            } else if (def.group === "limits" && def.kind === "money" && num(cur) !== null && num(v) !== null && num(v)! < num(cur)!) {
                              note = "Lower than your current coverage";
                            }
                            return (
                              <td key={q.id as string} className="figures py-2 pr-3 align-top text-ink">
                                {shown ?? <span className="text-mute-soft">Not stated</span>}
                                {note ? (
                                  <div className={`text-[11px] ${note.startsWith("Lower") || note.startsWith("+") ? "text-warning-text" : "text-mute"}`}>
                                    {note}
                                  </div>
                                ) : null}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                    {canEdit ? (
                      <tr>
                        <td />
                        <td />
                        {compareWith.map((q) => (
                          <td key={q.id as string} className="py-3 pr-3">
                            {q.was_selected ? (
                              <span className="text-[12px] text-good-text">Chosen</span>
                            ) : (
                              <Link
                                href={`/insurance/review/manual?mode=policy&quote=${q.id as string}`}
                                className="inline-flex min-h-[36px] items-center rounded-md border border-line-strong bg-paper px-3 text-[12px] font-medium text-ink hover:bg-fill"
                              >
                                Choose this quote
                              </Link>
                            )}
                          </td>
                        ))}
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[12px] text-mute">
                Walkup shows the numbers side by side. Talk to the broker about anything that&rsquo;s unclear before you switch.
              </p>
            </>
          )}
        </Card>
        {disclaimer}
      </div>
    );
  }

  // ==========================================================================
  // YOUR POLICY
  // ==========================================================================
  const [{ data: claimRows }, { data: tickets }, { data: accounts }, { data: sources }] = await Promise.all([
    selected
      ? supabase
          .from("insurance_claims")
          .select("id, date_of_loss, claim_number, description, amount_claimed, amount_paid, status, tickets(id, reference, title)")
          .eq("policy_id", selected.id)
          .order("date_of_loss", { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase.from("tickets").select("id, reference, title").order("opened_on", { ascending: false }).limit(50),
    supabase.from("accounts").select("id, name").eq("type", "expense").eq("is_active", true).order("code"),
    selected
      ? supabase.from("insurance_policy_field_sources").select("field_name, source, page_number").eq("policy_id", selected.id)
      : Promise.resolve({ data: [] }),
  ]);

  const nextRenewal = current.map((p) => p.effective_to).sort()[0];
  const daysToRenewal = nextRenewal
    ? Math.round((new Date(`${nextRenewal}T00:00:00`).getTime() - today.getTime()) / 86400000)
    : null;
  const pageOf = new Map((sources ?? []).map((s) => [s.field_name, s.source === "extracted" ? s.page_number : null]));
  const fromPage = (key: string) => (pageOf.get(key) ? `page ${pageOf.get(key)}` : null);

  const warnings = selected
    ? policyWarnings({
        values: Object.fromEntries(
          FIELD_DEFS.map((d) => {
            const v = selected[d.column];
            return [d.key, v === null || v === undefined ? null : String(v)];
          }),
        ),
        legalName: association.legal_name,
        renewalReminderDays: Number(selected.renewal_reminder_days ?? 60),
        today,
        deductiblesPage: Number(pageOf.get("property_deductible")) || null,
      }).filter((w) => w.key !== "coverage_form" || selected.coverage === "property")
    : [];

  const summary: { label: string; value: string; key: string }[] = [];
  if (selected) {
    const s = selected;
    if (s.building_limit !== null) summary.push({ key: "building_limit", label: "Building", value: dollars(s.building_limit)! });
    if (s.liability_per_occurrence !== null || s.liability_aggregate !== null) {
      summary.push({
        key: "liability_per_occurrence",
        label: "Liability",
        value: [s.liability_per_occurrence !== null ? `${dollars(s.liability_per_occurrence)} per incident` : null, s.liability_aggregate !== null ? `${dollars(s.liability_aggregate)} total` : null]
          .filter(Boolean)
          .join(", "),
      });
    }
    if (s.property_deductible !== null || s.water_damage_deductible !== null) {
      summary.push({
        key: "property_deductible",
        label: "Deductible",
        value: [s.property_deductible !== null ? dollars(s.property_deductible) : null, s.water_damage_deductible !== null ? `(${dollars(s.water_damage_deductible)} for water damage)` : null]
          .filter(Boolean)
          .join(" "),
      });
    }
    if (s.do_limit !== null) summary.push({ key: "do_limit", label: "Board members' liability", value: dollars(s.do_limit)! });
    if (s.umbrella_limit !== null) summary.push({ key: "umbrella_limit", label: "Umbrella", value: dollars(s.umbrella_limit)! });
    if (s.coverage_form !== "unknown") {
      summary.push({ key: "coverage_form", label: "Coverage form", value: COVERAGE_FORMS.find((f) => f.value === s.coverage_form)?.label ?? String(s.coverage_form) });
    }
    if (s.wind_hail_deductible !== null) summary.push({ key: "wind_hail_deductible", label: "Wind / hail deductible", value: dollars(s.wind_hail_deductible)! });
    if (s.water_backup_limit !== null) summary.push({ key: "water_backup_limit", label: "Water / sewer backup", value: dollars(s.water_backup_limit)! });
    if (s.flood_covered !== null) summary.push({ key: "flood_covered", label: "Flood", value: s.flood_covered ? "Covered" : "Not covered" });
  }

  const insuranceAccount = (accounts ?? []).find((a) => /insurance/i.test(a.name));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Insurance</h1>
        <p className="mt-1 text-mute">What you&rsquo;re covered for, what it costs, and when it renews.</p>
      </div>
      {tabs}

      {policies.length === 0 ? (
        <Card title="Your policy">
          <div className="max-w-xl space-y-4">
            <p className="text-[13px] text-ink">
              Upload your policy&rsquo;s declarations page and Walkup will fill in the details for you.
            </p>
            <p className="text-[12px] text-mute">
              <span className="font-medium text-ink">Which page?</span> The declarations page is usually the first 1 to 3
              pages and lists your coverage limits and deductibles.
            </p>
            {canEdit ? (
              <>
                <UploadDeclarations />
                <Link href="/insurance/review/manual?mode=policy" className="text-[12px] text-mute underline underline-offset-2">
                  Or enter the details by hand
                </Link>
              </>
            ) : (
              <p className="text-[13px] text-mute">A board member can add it.</p>
            )}
          </div>
        </Card>
      ) : (
        <>
          {daysToRenewal !== null && daysToRenewal <= 120 ? (
            <Answer
              status={daysToRenewal <= 45 ? "bad" : "attention"}
              headline={`Renewal in ${daysToRenewal} days — ${nextRenewal}`}
              detail="Start collecting alternative quotes about three months out. Carriers price renewals on the assumption you won't shop around."
            />
          ) : null}

          {current.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {current.map((p) => (
                <Link
                  key={p.id}
                  href={`/insurance?policy=${p.id}`}
                  aria-current={selected?.id === p.id ? "page" : undefined}
                  className={`inline-flex min-h-[36px] items-center rounded-full border px-3.5 text-[12px] font-medium ${
                    selected?.id === p.id ? "border-ink bg-ink text-paper" : "border-line-strong text-ink hover:bg-fill"
                  }`}
                >
                  {shortType(p.coverage)}
                </Link>
              ))}
              {canEdit ? (
                <details className="relative">
                  <summary className="inline-flex min-h-[36px] cursor-pointer items-center rounded-full border border-dashed border-line-strong px-3.5 text-[12px] text-mute hover:text-ink">
                    Add another policy
                  </summary>
                  <div className="absolute z-10 mt-2 w-[min(28rem,90vw)] rounded-xl border border-line bg-paper p-4 shadow-lg">
                    <UploadDeclarations />
                    <Link href="/insurance/review/manual?mode=policy" className="mt-2 inline-block text-[12px] text-mute underline underline-offset-2">
                      Or enter the details by hand
                    </Link>
                  </div>
                </details>
              ) : null}
            </div>
          ) : null}

          {selected ? (
            <>
              <section className="rounded-xl border border-line bg-paper px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-[17px] font-bold tracking-tight text-ink">{selected.carrier_name}</h2>
                    <p className="mt-0.5 text-[13px] text-mute">
                      {typeLabel(selected.coverage)}
                      {selected.policy_number ? ` · policy ${selected.policy_number as string}` : ""}
                      {` · ${money(Number(selected.annual_premium))} a year`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {selected.replaced_at ? (
                      <span className="rounded-full border border-line bg-fill px-2.5 py-0.5 text-[11px] text-mute">Replaced</span>
                    ) : selected.effective_to < todayIso ? (
                      <span className="rounded-full border border-bad-line bg-bad-tint px-2.5 py-0.5 text-[11px] text-bad-text">Expired {selected.effective_to}</span>
                    ) : (
                      <span className="rounded-full border border-good-line bg-good-tint px-2.5 py-0.5 text-[11px] text-good-text">Active through {selected.effective_to}</span>
                    )}
                    {selected.source_document_id ? (
                      <Link href={`/documents/${selected.source_document_id as string}`} className="text-[12px] font-medium text-ink underline underline-offset-2">
                        See policy
                      </Link>
                    ) : null}
                  </div>
                </div>
                {warnings.length > 0 ? (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {warnings.map((w) => (
                      <li key={w.key} className="rounded-full border border-warning-line bg-warning-tint px-3 py-1 text-[12px] text-warning-text">
                        {w.text}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>

              {summary.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {summary.map((s) => (
                    <div key={s.label} className="rounded-xl border border-line bg-paper px-4 py-3">
                      <div className="text-[11px] text-mute">{s.label}</div>
                      <div className="figures mt-1 text-[15px] text-ink">{s.value}</div>
                      {s.key === "coverage_form" ? <div className="mt-1 text-[11px] text-mute">{COVERAGE_FORM_HELP}</div> : null}
                      {fromPage(s.key) ? <div className="mt-1 text-[11px] text-mute-soft">From your policy, {fromPage(s.key)}</div> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-mute">No limits or deductibles are recorded for this policy.</p>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <Card title="Your agent">
                  {selected.broker_name || selected.agency_name || selected.agent_phone || selected.broker_email ? (
                    <div className="space-y-2 text-[13px]">
                      <div className="text-ink">
                        {[selected.broker_name, selected.agency_name].filter(Boolean).join(" · ")}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {selected.agent_phone ? (
                          <a href={`tel:${String(selected.agent_phone).replace(/[^\d+]/g, "")}`} className="inline-flex min-h-[44px] items-center rounded-md bg-ink px-4 text-[13px] font-medium text-paper hover:bg-ink-mid">
                            Call {selected.agent_phone as string}
                          </a>
                        ) : null}
                        {selected.broker_email ? (
                          <a href={`mailto:${selected.broker_email as string}`} className="inline-flex min-h-[44px] items-center rounded-md border border-line-strong bg-paper px-4 text-[13px] font-medium text-ink hover:bg-fill">
                            Email
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <p className="text-[13px] text-mute">No agent recorded.</p>
                  )}
                </Card>
                <Card title="Premium" hint={`Renewal reminder ${selected.renewal_reminder_days as number} days before ${selected.effective_to}.`}>
                  <div className="figures text-[22px] text-ink">{money(Number(selected.annual_premium))}</div>
                  <p className="mb-3 text-[12px] text-mute">a year</p>
                  {canEdit ? (
                    <TrackPremium
                      policyId={selected.id}
                      categories={(accounts ?? []).map((a) => ({ id: a.id, name: a.name }))}
                      defaultCategoryId={insuranceAccount?.id ?? null}
                    />
                  ) : null}
                </Card>
              </div>

              <Card title="Claims" hint="Anything filed against this policy.">
                <ClaimsPanel
                  policyId={selected.id}
                  canEdit={canEdit}
                  claims={(claimRows ?? []).map((c) => ({
                    id: c.id,
                    date_of_loss: c.date_of_loss,
                    claim_number: c.claim_number,
                    description: c.description,
                    amount_claimed: num(c.amount_claimed),
                    amount_paid: num(c.amount_paid),
                    status: c.status,
                    ticket: (c.tickets as unknown as ClaimRow["ticket"]) ?? null,
                  }))}
                  tickets={(tickets ?? []).map((t) => ({ id: t.id, label: `#${t.reference} ${t.title}` }))}
                />
              </Card>
            </>
          ) : (
            <Card title="Your policy">
              <p className="mb-3 text-[13px] text-mute">No policy is active right now.</p>
              {canEdit ? <UploadDeclarations /> : null}
            </Card>
          )}

          <Card title="Year by year" hint="Each renewal, what it cost, and whether you looked at alternatives before signing.">
            {history.length === 0 ? (
              <Empty>No policies recorded yet.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-left text-mute">
                      <th className="pb-2 font-medium">Cover</th>
                      <th className="pb-2 font-medium">Year from</th>
                      <th className="pb-2 font-medium">Insurer</th>
                      <th className="pb-2 text-right font-medium">Premium</th>
                      <th className="pb-2 text-right font-medium">Change</th>
                      <th className="pb-2 text-right font-medium">Quotes got</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {history.map((h) => (
                      <tr key={h.policy_id}>
                        <td className="py-3 text-ink">
                          <Link href={`/insurance?policy=${h.policy_id}`} className="underline-offset-2 hover:underline">
                            {shortType(h.coverage)}
                          </Link>
                        </td>
                        <td className="figures py-3 text-ink">{h.effective_from}</td>
                        <td className="py-3 text-ink">
                          {h.carrier_name}
                          {h.previous_carrier && h.previous_carrier !== h.carrier_name ? (
                            <span className="ml-2 text-[11px] text-mute-soft">switched from {h.previous_carrier}</span>
                          ) : null}
                        </td>
                        <td className="figures py-3 text-right text-ink">{money(h.annual_premium)}</td>
                        <td className="figures py-3 text-right">
                          {h.change_percent === null ? (
                            <span className="text-mute-soft">first year</span>
                          ) : (
                            <span className={Number(h.change_percent) > 0 ? "text-warning-text" : "text-good-text"}>
                              {Number(h.change_percent) > 0 ? "+" : ""}
                              {Number(h.change_percent).toFixed(1)}%
                              <span className="ml-1 text-[11px] text-mute-soft">
                                ({Number(h.change_amount) > 0 ? "+" : ""}
                                {money(h.change_amount)})
                              </span>
                            </span>
                          )}
                        </td>
                        <td className="py-3 text-right">
                          {h.quotes_obtained === 0 ? (
                            <span className="text-[11px] text-warning-text">none</span>
                          ) : (
                            <span className="figures text-mute">{h.quotes_obtained}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
      {disclaimer}
    </div>
  );
}
