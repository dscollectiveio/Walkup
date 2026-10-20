import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Restricted } from "@/components/ui";
import type { PillTone } from "@/components/repairs/pills";
import { linkClass } from "@/components/repairs/styles";
import { aiConfigured, placesConfigured } from "@/lib/ai/client";
import { aiUsageToday } from "@/lib/ai/usage";
import { loadWebSearch, NEEDS_CITY } from "@/lib/contractors/found";
import { findHref, parseMiles, parseMinRating, parseMinReviews, parseOpenNow, WANT_LABEL, type FindParams } from "@/lib/contractors/find-params";
import { rankSaved, type RankContext, type Why } from "@/lib/contractors/ranking";
import { loadSavedCandidates, resolveJob } from "@/lib/contractors/recommend";
import { monthYear, moneyText } from "@/lib/repairs/format";
import { loadViewer } from "@/lib/repairs/page-data";
import type { Supabase } from "@/lib/repairs/server";
import { loadTicketPhotos } from "@/lib/repairs/ticket-photos";
import type { QuoteCandidate } from "@/app/maintenance/[ticketId]/types";
import { AskBar } from "./ask-bar";
import { FindProvider, type FindTicket } from "./find-context";
import { SavedTable } from "./saved-table";
import { FindResults } from "./find-results";
import { SearchSettings } from "./search-settings";
import { CollapsibleCard } from "@/components/collapsible-card";
import { AddVendorButton } from "@/app/contractors/vendor-form";

export const dynamic = "force-dynamic";
// The web search runs in after() from this page's action (repairs-spec §2.5).
export const maxDuration = 300;

const WHY_TONE: Record<Why["tone"], PillTone> = { good: "good", neutral: "neutral", warning: "warning", bad: "bad" };

/**
 * Recommended contractors for a job (repairs-spec §9.1): the board's own
 * contractors first, then Google and the web, each result with the reasons
 * it ranks where it does. Board only.
 */
export default async function FindPage({ searchParams }: { searchParams: Promise<FindParams> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const viewer = await loadViewer(supabase);
  if (!viewer || !viewer.isBoard) return <Restricted what="contractor search" />;

  const job = await resolveJob(supabase, sp);
  if (!job) return <Restricted what={sp.ticket ? "this problem" : "this upkeep job"} />;

  const miles = parseMiles(sp.miles);
  const minRating = parseMinRating(sp.rating);
  const minReviews = parseMinReviews(sp.reviews);
  const openNow = parseOpenNow(sp.open);
  const source = job.source;
  const ticketId = source.kind === "ticket" ? source.id : null;
  const taskId = source.kind === "task" ? source.id : null;
  const back =
    source.kind === "ticket"
      ? { href: `/maintenance/${source.id}`, label: `Problem #${source.reference}` }
      : source.kind === "task"
        ? { href: `/repairs/upkeep/${source.id}`, label: source.name }
        : { href: "/repairs?view=contractors", label: "Contractors" };
  const subject =
    source.kind === "ticket" ? source.title : source.kind === "task" ? source.name : job.trade?.slug === "other" && job.phrase ? job.phrase : job.trade?.label ?? "a job";

  const header = (
    <div>
      {source.kind === "ticket" || source.kind === "task" ? (
        <Link href={back.href} className="inline-flex min-h-[44px] items-center text-[13px] text-mute hover:underline">
          ← {back.label}
        </Link>
      ) : null}
      <h1 className="text-[20px] font-bold tracking-tight text-ink">
        {!job.trade && source.kind !== "ticket" && source.kind !== "task" ? "Find a contractor" : `Contractors for ${subject}`}
      </h1>
    </div>
  );

  if (!job.trade) {
    return (
      <div className="space-y-6">
        {header}
        <Card navy title="Search settings" hint="Choose the kind of work, what matters and how far to look.">
          <SearchSettings ticketId={ticketId} taskId={taskId} current={null} wants={job.wants} miles={miles} minRating={minRating} minReviews={minReviews} openNow={openNow} submitLabel="Search" />
        </Card>
      </div>
    );
  }

  const trade = job.trade;
  const related = trade.related;
  const [{ data: assoc }, saved, web, usage] = await Promise.all([
    supabase.from("associations").select("street_address, city, state_code, postal_code").eq("id", viewer.associationId).limit(1),
    loadSavedCandidates(supabase, trade, related, viewer.todayIso),
    loadWebSearch(supabase, { trade: trade.slug, phrase: job.phrase, wants: job.wants }),
    aiConfigured() ? aiUsageToday(supabase, viewer.associationId) : Promise.resolve(null),
  ]);
  const city = (assoc?.[0]?.city as string | null)?.trim() || null;
  // The building's own address is where every search starts: units share it, so a unit's problem searches from here too.
  const baseAddress =
    [assoc?.[0]?.street_address, assoc?.[0]?.city, assoc?.[0]?.state_code].map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean).join(", ") || null;
  const ctx: RankContext = { trade: trade.slug, relatedTrades: related, urgent: job.urgent, wants: job.wants, todayIso: viewer.todayIso };
  const ranked = rankSaved(saved, ctx);
  const ticket = source.kind === "ticket" ? await loadFindTicket(supabase, source.id, source.reference, trade.slug, ranked) : null;
  const searchWords = job.phrase || trade.googleQuery || trade.label.toLowerCase();
  const webUsage = usage ? { used: usage.contractor_search.used, limit: usage.contractor_search.limit } : null;

  // The search on the page, as a history entry (the link that runs it again).
  const searchNow = {
    href: findHref({ ticket: ticketId, task: taskId, trade: trade.slug, phrase: job.phrase, wants: job.wants, miles, minRating, minReviews, open: openNow }),
    job: ticketId ?? taskId ?? "",
    tradeLabel: trade.label,
    phrase: trade.slug === "other" ? job.phrase : "",
    miles,
    minRating,
    minReviews,
    emergency: openNow,
  };

  return (
    <FindProvider trade={trade.slug} ticket={ticket}>
      <div className="space-y-6">
        <div className="space-y-3">
          {header}
          <CollapsibleCard
            title="Search settings"
            defaultOpen={false}
            labels={{ close: "Close", open: "Edit search" }}
            collapsedSummary={
              <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-mute">Kind of work</dt>
                  <dd className="text-ink">{trade.slug === "other" && job.phrase ? `Described: "${job.phrase}"` : trade.label}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-mute">Where</dt>
                  <dd className="text-ink">
                    Within {miles} miles of {baseAddress ?? city ?? "the building"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-mute">What matters</dt>
                  <dd className="text-ink">{job.wants.length > 0 ? job.wants.map((w) => WANT_LABEL[w]).join(", ") : "Nothing in particular"}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-mute">Narrowed by</dt>
                  <dd className="text-ink">
                    {[
                      minRating ? `${minRating} stars or more` : null,
                      minReviews ? `${minReviews}+ reviews` : null,
                      openNow ? "Emergency Services" : null,
                    ]
                      .filter(Boolean)
                      .join(", ") || "Nothing"}
                  </dd>
                </div>
              </dl>
            }
          >
            <SearchSettings ticketId={ticketId} taskId={taskId} current={trade.slug} phrase={job.phrase} wants={job.wants} miles={miles} minRating={minRating} minReviews={minReviews} openNow={openNow} submitLabel="Update Search" searchNow={searchNow} />
          </CollapsibleCard>
        </div>

        <div className="space-y-1 text-[13px]">
          <p className="text-ink">
            Searching for &ldquo;{searchWords}&rdquo; near {baseAddress ?? city ?? "your building"}, within {miles} miles.
          </p>
          {job.suggestedPhrase ? (
            <p className="text-mute">
              From the report: &ldquo;{job.suggestedPhrase}&rdquo;.{" "}
              <Link
                href={findHref({ ticket: ticketId, task: taskId, trade: trade.slug, phrase: job.suggestedPhrase, wants: sp.want === undefined ? null : job.wants, miles, minRating, minReviews, open: openNow })}
                className={linkClass}
              >
                Use it
              </Link>
            </p>
          ) : null}
          <p className="text-[11px] text-mute">
            Only these words and your building&rsquo;s location are sent to Google and the web search, never names or unit numbers.
          </p>
        </div>

        <CollapsibleCard title="Your contractors who do this" action={<AddVendorButton variant="header" initialTrade={trade.slug} />}>
          {ranked.length === 0 ? (
            <p className="text-[13px] text-mute">None of your saved contractors do {trade.label.toLowerCase()} yet.</p>
          ) : (
            <SavedTable
              forTicket={ticket !== null}
              assign={source.kind === "ticket" && source.open ? { ticketId: source.id, reference: source.reference, assignedVendorId: source.assignedVendorId } : null}
              rows={ranked.map((c) => ({
                vendorId: c.vendorId,
                name: c.name,
                status: c.status,
                why: c.why.map((w) => ({ key: w.key, text: w.text, tone: WHY_TONE[w.tone] })),
                phone: c.phone,
                email: c.email,
                website: c.website,
                ratesText: ratesLine(c.rates),
                rating: c.boardRating ?? c.googleRating,
                jobs: c.jobs,
                boardReviews: c.boardReviews.count > 0 && c.boardReviews.average !== null ? { average: c.boardReviews.average, count: c.boardReviews.count } : null,
                googleReviews: c.googleRating !== null ? { rating: c.googleRating, count: c.googleReviewCount ?? 0 } : null,
              }))}
            />
          )}
        </CollapsibleCard>

        <CollapsibleCard title="Found nearby">
          <FindResults
            trade={trade.slug}
            tradeLabel={trade.label}
            phrase={job.phrase}
            wants={job.wants}
            relatedTrades={related}
            urgent={job.urgent}
            todayIso={viewer.todayIso}
            city={city}
            miles={miles}
            minRating={minRating}
            minReviews={minReviews}
            openNow={openNow}
            googleOn={placesConfigured()}
            webOn={aiConfigured()}
            web={web}
            webRetry={!(web.source.state === "error" && web.source.message === NEEDS_CITY)}
            webUsage={webUsage}
          />
        </CollapsibleCard>

        <AskBar />
      </div>
    </FindProvider>
  );
}

function ratesLine(r: { hourly: string | null; tripFee: string | null; afterHours: string | null; asOf: string | null }): string | null {
  const parts = [
    r.hourly ? `${moneyText(r.hourly)}/hr` : null,
    r.tripFee ? `trip fee ${moneyText(r.tripFee)}` : null,
    r.afterHours ? `after hours ${moneyText(r.afterHours)}` : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return `Rates you were quoted: ${parts.join(", ")}${r.asOf ? ` (as of ${monthYear(r.asOf)})` : ""}`;
}

/** What the "Get quotes" dialog needs when the search is for a problem (repairs-spec §8.2). */
async function loadFindTicket(
  supabase: Supabase,
  ticketId: string,
  reference: number,
  trade: string,
  ranked: ReturnType<typeof rankSaved>,
): Promise<FindTicket> {
  const [{ data: vendors }, { data: bids }, photos, auth] = await Promise.all([
    supabase.from("vendors").select("id, name, email, phone, trades").is("archived_at", null).neq("status", "do_not_use").order("name"),
    supabase.from("ticket_bids").select("vendor_id, status").eq("ticket_id", ticketId).in("status", ["requested", "received", "accepted"]),
    loadTicketPhotos(supabase, ticketId, { seesNames: true }),
    supabase.auth.getUser(),
  ]);
  const why = new Map(ranked.map((c) => [c.vendorId, c.why.filter((w) => w.key !== "trade").slice(0, 2)]));
  const order = [...why.keys()];
  const candidates: QuoteCandidate[] = (vendors ?? [])
    .map((v) => ({
      vendorId: v.id as string,
      name: v.name as string,
      email: (v.email as string | null)?.trim() || null,
      phone: (v.phone as string | null)?.trim() || null,
      tradeMatch: ((v.trades as string[] | null) ?? []).includes(trade),
      why: why.get(v.id as string) ?? [],
    }))
    .sort((a, b) => {
      const ia = order.indexOf(a.vendorId);
      const ib = order.indexOf(b.vendorId);
      return (ia === -1 ? 1e6 : ia) - (ib === -1 ? 1e6 : ib) || a.name.localeCompare(b.name);
    });
  return {
    id: ticketId,
    reference,
    trade,
    candidates,
    alreadyAsked: (bids ?? []).map((b) => b.vendor_id as string),
    photos: photos.map((p) => ({ documentId: p.documentId })),
    senderEmail: auth?.data?.user?.email ?? null,
  };
}
