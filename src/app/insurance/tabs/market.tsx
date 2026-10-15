import Link from "next/link";
import { aiRunStatus, type AiRunState } from "@/lib/ai/jobs";
import { remainingLine } from "@/lib/ai/kinds";
import { aiUsageToday } from "@/lib/ai/usage";
import { FoundOnWeb } from "@/components/ai/found-on-web";
import { Card, Empty } from "@/components/ui";
import { longDate } from "@/lib/dates";
import { coverageShort } from "@/lib/insurance/coverage";
import type { runCoverageCheck } from "@/lib/insurance/coverage-check";
import { formatMoney, formatPhone, telHref } from "@/lib/insurance/format";
import { MARKET_COPY } from "@/lib/insurance/market";
import { stateNameFor, type VerifiedAgency, type VerifiedInsurer } from "@/lib/insurance/market-verify";
import { perUnitCost, premiumTotals } from "@/lib/insurance/premium";
import { addressMissingCopy, adminNames, type InsuranceContext, type PolicyWithStatus, type Supabase } from "@/lib/insurance/queries";
import { LOOKUPS } from "@/lib/insurance/statute";
import { Disclaimer } from "../components/page-header";
import { btnPrimary, linkClass, warningBlock } from "../components/styles";
import { YEAR_SELECT, YearByYear, type YearRow } from "../components/year-by-year";
import { CONTACT_KIND_LABEL, contactSourceBadge, hostOf } from "../quote-helpers";
import { loadContacts, requestCoverages, type ContactRow } from "../quotes-data";
import { AddContactButton, FoundButtons, MarketSearch, PartnerButtons } from "./market-parts";
import { mailtoLink } from "@/lib/email/mailto";
import { safeHttpUrl } from "@/lib/security/safe-url";

/**
 * The Marketplace (insurance-spec §9.6, brief decisions 1 and 3 to 5):
 * agencies and insurers found for this building, each with the pages it was
 * found on, never ranked and never endorsed; the board's saved contacts; and
 * what insurance costs now, with no invented prices.
 */

type Check = ReturnType<typeof runCoverageCheck>;

interface ResearchRow {
  kind: "agencies" | "insurers";
  items: unknown[];
  sources: { url: string; title: string | null }[];
  fetched_at: string | null;
  ai_state: AiRunState;
  ai_started_at: string | null;
  ai_error: string | null;
}

const chipClass = "rounded-full bg-fill px-2.5 py-0.5 text-[11px] text-ink";
const small = "inline-flex min-h-[44px] items-center justify-center rounded-md border border-line-strong bg-paper px-3 text-[12px] font-medium text-ink hover:bg-fill";
const DAY_MS = 86_400_000;

/** A search finished within the last 24 hours ("Searched today" instead of "Search again"). */
function withinADay(iso: string | null): boolean {
  return iso !== null && Date.now() - Date.parse(iso) < DAY_MS;
}

function failureCopy(code: string | null): string {
  if (code === "quota") return "Walkup has searched as much as it can for your building today. Try again tomorrow.";
  if (code === "not_configured") return MARKET_COPY.notConfigured;
  return "The search didn't finish. Try again in a minute.";
}

function SourceLinks({ urls }: { urls: string[] }) {
  const shown = urls.slice(0, 3);
  if (shown.length === 0) return null;
  return (
    <p className="text-[12px] text-mute">
      Sources:{" "}
      {shown.map((u, i) => (
        <span key={u}>
          {i > 0 ? ", " : ""}
          <a href={u} target="_blank" rel="noopener noreferrer nofollow" className="text-ink underline underline-offset-2">
            {i + 1}. {hostOf(u)}
          </a>
        </span>
      ))}
    </p>
  );
}

function About({ text, source }: { text: string | null; source: string | null }) {
  if (!text) return null;
  return (
    <figure className="text-[13px]">
      <blockquote className="text-ink">&ldquo;{text}&rdquo;</blockquote>
      {source ? <figcaption className="mt-0.5 text-[12px] text-mute">From {hostOf(source)}</figcaption> : null}
    </figure>
  );
}

function NameLink({ name, website: rawWebsite }: { name: string; website: string | null }) {
  const website = safeHttpUrl(rawWebsite);
  return website ? (
    <a href={website} target="_blank" rel="noopener noreferrer" className="font-medium text-ink underline underline-offset-2">
      {name}
    </a>
  ) : (
    <span className="font-medium text-ink">{name}</span>
  );
}

/** "Find an agent" page among an insurer's sources, else its website. */
function findAgentHref(i: VerifiedInsurer): string | null {
  const page = i.sourceUrls.find((u) => /agent/i.test(u));
  return page ?? i.website;
}

export async function MarketTab({
  supabase,
  ctx,
  policies,
  check,
  aiOn,
}: {
  supabase: Supabase;
  ctx: InsuranceContext;
  policies: PolicyWithStatus[];
  check: Check;
  aiOn: boolean;
}) {
  const assoc = ctx.association;
  const contacts = await loadContacts(supabase, assoc.id);

  if (!ctx.isBoard) {
    return (
      <div className="space-y-6">
        <Card title="Marketplace">
          <p className="text-[13px] text-ink">{MARKET_COPY.boardOnly}</p>
        </Card>
        <ContactsCard contacts={contacts} todayIso={ctx.todayIso} canEdit={false} />
      </div>
    );
  }

  const stateCode = (assoc.state_code ?? "").toUpperCase();
  const stateName = stateCode ? stateNameFor(stateCode) : "your state";
  const city = assoc.city?.trim() || null;
  const illinois = stateCode === "IL";
  const addressMissing = !city || !stateCode;

  const [research, partners, history, usage, admins] = await Promise.all([
    supabase
      .from("insurance_market_research")
      .select("kind, items, sources, fetched_at, ai_state, ai_started_at, ai_error")
      .eq("association_id", assoc.id),
    stateCode
      ? supabase.from("insurance_partners").select("id, name, contact_email, phone, states_served").eq("active", true).contains("states_served", [stateCode])
      : Promise.resolve({ data: [] }),
    supabase.from("insurance_year_over_year").select(YEAR_SELECT).eq("association_id", assoc.id).eq("coverage", "property").order("effective_from", { ascending: false }),
    aiOn ? aiUsageToday(supabase, assoc.id) : Promise.resolve(null),
    addressMissing ? adminNames(supabase, assoc.id) : Promise.resolve(""),
  ]);
  const rows = (research.data ?? []) as unknown as ResearchRow[];
  const byKind = (k: ResearchRow["kind"]) => rows.find((r) => r.kind === k) ?? null;
  const left = usage ? usage.insurance_market.limit - usage.insurance_market.used : null;
  const remaining = left === null ? null : remainingLine("insurance_market", left);
  const savedByKey = new Map(contacts.filter((c) => c.found_key).map((c) => [c.found_key as string, c.id]));
  const savedByPartner = new Map(contacts.filter((c) => c.partner_id).map((c) => [c.partner_id as string, c.id]));

  const wanted = requestCoverages(policies, check);
  const active = policies.filter((p) => p.status === "active");
  const total = active.length ? premiumTotals(active) : null;
  const perUnit = total ? perUnitCost(total, ctx.unitCount) : null;
  const historyRows = (history.data ?? []) as unknown as YearRow[];
  const partnerRows = (partners.data ?? []) as { id: string; name: string; contact_email: string; phone: string | null }[];

  const searchCard = (kind: "agencies" | "insurers") => {
    const row = byKind(kind);
    const status = row ? aiRunStatus(row.ai_state, row.ai_started_at) : "idle";
    const running = status === "running";
    const fetchedAt = row?.fetched_at ?? null;
    const items = (row?.items ?? []) as (VerifiedAgency | VerifiedInsurer)[];
    const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
    const searchedToday = withinADay(fetchedAt);
    const noun = kind === "agencies" ? (items.length === 1 ? "agency" : "agencies") : items.length === 1 ? "insurer" : "insurers";
    const title = kind === "agencies" ? `Agencies near ${city ?? "your building"}` : `Insurers that write condo associations in ${stateName}`;

    let state: React.ReactNode = null;
    if (addressMissing) {
      state = <p className="text-[13px] text-ink">{addressMissingCopy(ctx.isAdmin, admins)}</p>;
    } else if (!aiOn) {
      state = <p className="text-[13px] text-ink">{MARKET_COPY.notConfigured}</p>;
    } else {
      state = (
        <div className="space-y-3">
          {!fetchedAt && !running ? (
            <p className="text-[13px] text-ink">
              {kind === "agencies"
                ? `Walkup can search the web for independent agencies near ${city} that insure condo associations.`
                : `Walkup can search the web for insurers that write condo associations in ${stateName}.`}{" "}
              It sends only your city, ZIP, unit count, stories, year built, construction type and the coverage you carry.
            </p>
          ) : null}
          {status === "failed" ? <p className={warningBlock}>{failureCopy(row?.ai_error ?? null)}</p> : null}
          {status === "stalled" ? <p className={warningBlock}>The search didn&rsquo;t finish. Try again.</p> : null}
          {fetchedAt && !running ? (
            <p className="text-[13px] text-ink">
              Found {items.length} {noun} on {longDate(fetchedAt)}.
            </p>
          ) : null}
          <MarketSearch
            kind={kind}
            label={kind === "agencies" ? "Search for agencies" : "Search for insurers"}
            againLabel="Search again"
            hasResults={fetchedAt !== null}
            running={running}
            startedAt={row?.ai_started_at ?? null}
            searchedToday={searchedToday && status !== "failed" && status !== "stalled"}
            remaining={remaining}
            disabled={left !== null && left <= 0}
          />
          {running ? (
            <div className="grid gap-3" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-lg bg-fill motion-reduce:animate-none" />
              ))}
            </div>
          ) : null}
        </div>
      );
    }

    const list =
      fetchedAt && !addressMissing ? (
        sorted.length === 0 ? (
          <p className="text-[13px] text-mute">
            {kind === "agencies"
              ? `Walkup didn't find agencies it could verify near ${city}. Try again later, or add an agency you know.`
              : `Walkup didn't find insurers it could verify in ${stateName}. Try again later, or add one you know.`}
          </p>
        ) : (
          <div className={`space-y-3 ${running ? "opacity-60" : ""}`}>
            {kind === "agencies" ? (
              <ul className="divide-y divide-line">
                {(sorted as VerifiedAgency[]).map((a) => (
                  <AgencyCard key={a.key} a={a} fetchedAt={fetchedAt} illinois={illinois} saved={savedByKey.get(a.key) ?? null} />
                ))}
              </ul>
            ) : (
              <InsurerList items={sorted as VerifiedInsurer[]} fetchedAt={fetchedAt} stateName={stateName} savedByKey={savedByKey} />
            )}
            <FoundOnWeb sources={row?.sources ?? []} fetchedAt={fetchedAt} scope="list" />
          </div>
        )
      ) : null;

    return (
      <Card title={title}>
        <div className="space-y-4">
          {state}
          {list}
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <p className="text-[13px] text-mute">
        Agencies and insurers found for your building, with links to where Walkup found them. Walkup isn&rsquo;t an insurance broker and doesn&rsquo;t rank companies.
      </p>

      <Card title="What you'd ask for">
        <div className="space-y-3">
          {wanted.length === 0 ? (
            <p className="text-[13px] text-mute">No policies are recorded yet. You can still ask for quotes and choose the coverage.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {wanted.map((w) => (
                <span key={w.coverage} className={chipClass}>
                  {coverageShort(w.coverage)}
                  {w.fromCheck ? " · from Coverage check" : ""}
                </span>
              ))}
            </div>
          )}
          <Link href="/insurance?view=quotes&new=1" className={btnPrimary}>
            Ask for quotes
          </Link>
        </div>
      </Card>

      <ContactsCard contacts={contacts} todayIso={ctx.todayIso} canEdit />

      {searchCard("agencies")}
      {searchCard("insurers")}

      {partnerRows.length > 0 ? (
        <Card title="Listed with Walkup" hint={`Brokers who asked to be listed for associations in ${stateName}. Listing isn't an endorsement.`}>
          <ul className="divide-y divide-line">
            {partnerRows.map((p) => {
              const tel = p.phone ? telHref(p.phone) : null;
              return (
                <li key={p.id} className="space-y-2 py-3 text-[13px]">
                  <div className="font-medium text-ink">{p.name}</div>
                  <div className="flex flex-wrap gap-x-3 text-mute">
                    {p.phone ? (tel ? <a href={tel} className="underline underline-offset-2">{formatPhone(p.phone)}</a> : <span>{p.phone}</span>) : null}
                    <a href={mailtoLink(p.contact_email)} className="underline underline-offset-2">
                      {p.contact_email}
                    </a>
                  </div>
                  <PartnerButtons partnerId={p.id} name={p.name} savedContactId={savedByPartner.get(p.id) ?? null} />
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <Card title="What insurance costs you">
        <div className="space-y-3 text-[13px]">
          {total ? (
            <p className="text-ink">
              You pay <span className="figures">{formatMoney(total)}</span> a year
              {perUnit ? (
                <>
                  , about <span className="figures">{formatMoney(perUnit.perMonth, { cents: true })}</span> per unit per month
                </>
              ) : null}
              .
            </p>
          ) : (
            <p className="text-mute">No policies in force are recorded, so Walkup can&rsquo;t show what you pay.</p>
          )}
          {historyRows.length > 0 ? <YearByYear rows={historyRows} todayIso={ctx.todayIso} showCoverage={false} /> : null}
          <p className="text-mute">
            Walkup never shows prices it wasn&rsquo;t given. To see whether you could pay less, ask for quotes. Ask each agency how much notice it needs.
          </p>
          <Link href="/insurance?view=quotes&new=1" className={btnPrimary}>
            Ask for quotes
          </Link>
        </div>
      </Card>

      <Disclaimer />
    </div>
  );
}

function ContactsCard({ contacts, todayIso, canEdit }: { contacts: ContactRow[]; todayIso: string; canEdit: boolean }) {
  return (
    <Card title="Your contacts">
      <div className="space-y-3">
        {contacts.length === 0 ? (
          <Empty>No contacts yet. Save one from the results below, or add your agent.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {contacts.map((c) => (
              <li key={c.id} className="space-y-2 py-3 text-[13px]">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/insurance/contacts/${c.id}`} className="font-medium text-ink underline-offset-2 hover:underline">
                    {c.name}
                  </Link>
                  {c.is_current_agent ? <span className="rounded-full bg-ink px-2 py-0.5 text-[11px] text-paper">Your agent</span> : null}
                  <span className="text-[11px] text-mute">{contactSourceBadge(c.source, c.found_at, todayIso)}</span>
                </div>
                <div className="text-mute">
                  {[CONTACT_KIND_LABEL[c.kind] ?? "Contact", [c.city, c.state_code].filter(Boolean).join(", ") || null].filter(Boolean).join(" · ")}
                </div>
                {c.lines.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {c.lines.map((l) => (
                      <span key={l} className={chipClass}>
                        {coverageShort(l)}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {canEdit && c.email ? (
                    <>
                      <Link href={`/insurance?view=quotes&new=1&contact=${c.id}`} className={small}>
                        Ask for a quote
                      </Link>
                      <Link href={`/insurance/emails/new?kind=other&contact=${c.id}`} className={small}>
                        Write
                      </Link>
                    </>
                  ) : null}
                  <Link href={`/insurance/contacts/${c.id}`} className={small} aria-label={`Open ${c.name}`}>
                    Open
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
        {canEdit ? <AddContactButton /> : null}
      </div>
    </Card>
  );
}

function AgencyCard({ a, fetchedAt, illinois, saved }: { a: VerifiedAgency; fetchedAt: string; illinois: boolean; saved: string | null }) {
  const tel = a.phone ? telHref(a.phone) : null;
  const where = [a.city, a.state].filter(Boolean).join(", ");
  const chips = [
    a.worksWithAssociations ? "Condo or community associations" : null,
    a.independent ? "Independent agency" : null,
    ...a.lines.map(coverageShort),
  ].filter((x): x is string => x !== null);
  return (
    <li className="space-y-2 py-4 text-[13px]">
      <div>
        <NameLink name={a.name} website={a.website} />
        {where ? <span className="text-mute"> · {where}</span> : null}
      </div>
      {chips.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] text-mute">Their pages mention:</span>
          {chips.map((c) => (
            <span key={c} className={chipClass}>
              {c}
            </span>
          ))}
        </div>
      ) : null}
      <About text={a.about} source={a.aboutSource} />
      {a.phone || a.email ? (
        <div className="flex flex-wrap gap-x-3">
          {a.phone ? (tel ? <a href={tel} className="figures text-ink underline underline-offset-2">{a.phone}</a> : <span>{a.phone}</span>) : null}
          {a.email ? (
            <a href={mailtoLink(a.email)} className="text-ink underline underline-offset-2">
              {a.email}
            </a>
          ) : null}
        </div>
      ) : (
        <p className="text-mute">Contact details: see their website</p>
      )}
      <SourceLinks urls={a.sourceUrls} />
      {illinois ? (
        <a href={LOOKUPS.IL_DOI_AGENT_LOOKUP.url} target="_blank" rel="noopener noreferrer" className={`${linkClass} text-[12px]`}>
          {LOOKUPS.IL_DOI_AGENT_LOOKUP.label}
        </a>
      ) : null}
      <FoundButtons kind="agencies" fetchedAt={fetchedAt} itemKey={a.key} name={a.name} savedContactId={saved} askForQuote />
    </li>
  );
}

function InsurerList({
  items,
  fetchedAt,
  stateName,
  savedByKey,
}: {
  items: VerifiedInsurer[];
  fetchedAt: string;
  stateName: string;
  savedByKey: Map<string, string>;
}) {
  const writes = items.filter((i) => i.writesAssociations);
  const others = items.filter((i) => !i.writesAssociations);
  const card = (i: VerifiedInsurer) => {
    const chips = [
      i.writesAssociations ? "Condo or community associations" : null,
      i.writesInState ? stateName : null,
      ...i.lines.map(coverageShort),
    ].filter((x): x is string => x !== null);
    const agentHref = findAgentHref(i);
    return (
      <li key={i.key} className="space-y-2 py-4 text-[13px]">
        <NameLink name={i.name} website={i.website} />
        {chips.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] text-mute">Their pages mention:</span>
            {chips.map((c) => (
              <span key={c} className={chipClass}>
                {c}
              </span>
            ))}
          </div>
        ) : null}
        {i.verified.rating && i.amBestRating && i.amBestSourceUrl ? (
          <p className="text-ink">
            AM Best rating: {i.amBestRating}, per{" "}
            <a href={safeHttpUrl(i.amBestSourceUrl) ?? undefined} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2">
              {hostOf(i.amBestSourceUrl)}
            </a>
          </p>
        ) : null}
        <About text={i.about} source={i.aboutSource} />
        <SourceLinks urls={i.sourceUrls} />
        <a href={LOOKUPS.NAIC_CIS.url} target="_blank" rel="noopener noreferrer" className={`${linkClass} text-[12px]`}>
          {LOOKUPS.NAIC_CIS.label}
        </a>
        <FoundButtons
          kind="insurers"
          fetchedAt={fetchedAt}
          itemKey={i.key}
          name={i.name}
          savedContactId={savedByKey.get(i.key) ?? null}
          askForQuote={false}
          extra={
            agentHref ? (
              <a href={agentHref} target="_blank" rel="noopener noreferrer" className={small}>
                Find an agent for this insurer
              </a>
            ) : null
          }
        />
      </li>
    );
  };
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-line">{writes.map(card)}</ul>
      {others.length ? (
        <details>
          <summary className="flex min-h-[44px] cursor-pointer items-center text-[13px] font-medium text-ink">
            Pages Walkup read don&rsquo;t mention associations ({others.length})
          </summary>
          <ul className="divide-y divide-line">{others.map(card)}</ul>
        </details>
      ) : null}
      <p className="text-[12px] text-mute">Insurers usually sell through agents. Ask an agency above whether it can quote with an insurer you&rsquo;re interested in.</p>
    </div>
  );
}
