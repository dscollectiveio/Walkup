import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Restricted } from "@/components/ui";
import { Pill, type PillTone } from "@/components/repairs/pills";
import { telHref } from "@/components/repairs/emergency-banner";
import { btnLink, btnPrimary, btnSecondary, inputClass, labelClass, linkClass } from "@/components/repairs/styles";
import { aiConfigured, placesConfigured } from "@/lib/ai/client";
import { aiUsageToday } from "@/lib/ai/usage";
import { loadWebSearch, NEEDS_CITY } from "@/lib/contractors/found";
import { findHref, type FindParams } from "@/lib/contractors/find-params";
import { rankSaved, type RankContext, type Why } from "@/lib/contractors/ranking";
import { loadSavedCandidates, resolveJob, type JobContext } from "@/lib/contractors/recommend";
import { SEARCHABLE_TRADES } from "@/lib/contractors/trades";
import { monthYear, moneyText } from "@/lib/repairs/format";
import { loadViewer } from "@/lib/repairs/page-data";
import type { Supabase } from "@/lib/repairs/server";
import { loadTicketPhotos } from "@/lib/repairs/ticket-photos";
import type { QuoteCandidate } from "@/app/maintenance/[ticketId]/types";
import { AskBar } from "./ask-bar";
import { AssignButton } from "./assign-button";
import { FindProvider, SavedSelect, type FindTicket } from "./find-context";
import { FindResults } from "./find-results";
import { WantsBar } from "./wants-bar";
import { mailtoLink } from "@/lib/email/mailto";

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

  const source = job.source;
  const ticketId = source.kind === "ticket" ? source.id : null;
  const taskId = source.kind === "task" ? source.id : null;
  const back =
    source.kind === "ticket"
      ? { href: `/maintenance/${source.id}`, label: `Problem #${source.reference}` }
      : source.kind === "task"
        ? { href: `/repairs/upkeep/${source.id}`, label: source.name }
        : { href: "/repairs?view=contractors", label: "Contractors" };
  const subject = source.kind === "ticket" ? source.title : source.kind === "task" ? source.name : job.trade?.label ?? "a job";

  const header = (
    <div>
      <Link href={back.href} className="inline-flex min-h-[44px] items-center text-[13px] text-mute hover:underline">
        ← {back.label}
      </Link>
      <h1 className="text-[20px] font-bold tracking-tight text-ink">Contractors for {subject}</h1>
    </div>
  );

  if (!job.trade) {
    return (
      <div className="space-y-6">
        {header}
        <Card title="What kind of work is it?">
          <TradePicker ticketId={ticketId} taskId={taskId} current={null} submitLabel="Show contractors" />
        </Card>
      </div>
    );
  }

  const trade = job.trade;
  const related = trade.related;
  const [{ data: assoc }, saved, web, usage] = await Promise.all([
    supabase.from("associations").select("city, postal_code").eq("id", viewer.associationId).limit(1),
    loadSavedCandidates(supabase, trade, related, viewer.todayIso),
    loadWebSearch(supabase, { trade: trade.slug, phrase: job.phrase, wants: job.wants }),
    aiConfigured() ? aiUsageToday(supabase, viewer.associationId) : Promise.resolve(null),
  ]);
  const city = (assoc?.[0]?.city as string | null)?.trim() || null;
  const ctx: RankContext = { trade: trade.slug, relatedTrades: related, urgent: job.urgent, wants: job.wants, todayIso: viewer.todayIso };
  const ranked = rankSaved(saved, ctx);
  const ticket = source.kind === "ticket" ? await loadFindTicket(supabase, source.id, source.reference, trade.slug, ranked) : null;
  const searchWords = job.phrase || trade.googleQuery || trade.label.toLowerCase();
  const webUsage = usage ? { used: usage.contractor_search.used, limit: usage.contractor_search.limit } : null;

  return (
    <FindProvider trade={trade.slug} ticket={ticket}>
      <div className="space-y-6">
        <div className="space-y-3">
          {header}
          <details className="group">
            <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center gap-2 text-[13px] text-mute">
              {trade.label}
              <span className="font-medium text-ink underline underline-offset-2">Change</span>
            </summary>
            <div className="mt-2 max-w-md">
              <TradePicker ticketId={ticketId} taskId={taskId} current={trade.slug} wants={job.wants} submitLabel="Change" />
            </div>
          </details>
        </div>

        <WantsBar ticket={ticketId} task={taskId} trade={trade.slug} phrase={job.phrase} wants={job.wants} />

        <div className="space-y-1 text-[13px]">
          <p className="text-ink">
            Searching for &ldquo;{searchWords}&rdquo; near {city ?? "your building"}.
          </p>
          {job.suggestedPhrase ? (
            <p className="text-mute">
              From the report: &ldquo;{job.suggestedPhrase}&rdquo;.{" "}
              <Link
                href={findHref({ ticket: ticketId, task: taskId, trade: trade.slug, phrase: job.suggestedPhrase, wants: sp.want === undefined ? null : job.wants })}
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

        <Card title="Your contractors who do this">
          {ranked.length === 0 ? (
            <p className="text-[13px] text-mute">None of your saved contractors do {trade.label.toLowerCase()} yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {ranked.map((c) => (
                <li key={c.vendorId} className="flex gap-2 py-4">
                  {ticket ? <SavedSelect vendorId={c.vendorId} name={c.name} /> : null}
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/contractors/${c.vendorId}`} className="text-[15px] font-medium text-ink underline-offset-2 hover:underline">
                        {c.name}
                      </Link>
                      <Pill tone={c.status === "preferred" ? "good" : "outline"}>{c.status === "preferred" ? "Preferred" : "Okay"}</Pill>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {c.why.map((w) => (
                        <Pill key={w.key} tone={WHY_TONE[w.tone]}>
                          {w.text}
                        </Pill>
                      ))}
                    </div>
                    {ratesLine(c.rates) ? <p className="text-[13px] text-mute">{ratesLine(c.rates)}</p> : null}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      {c.phone ? (
                        <a href={telHref(c.phone)} className={btnLink}>
                          Call {c.phone}
                        </a>
                      ) : null}
                      {c.email ? (
                        <a href={mailtoLink(c.email)} className={btnLink}>
                          Email
                        </a>
                      ) : null}
                      {source.kind === "ticket" && source.open ? (
                        <AssignButton
                          ticketId={source.id}
                          reference={source.reference}
                          vendorId={c.vendorId}
                          assigned={source.assignedVendorId === c.vendorId}
                        />
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Found nearby">
          <FindResults
            trade={trade.slug}
            tradeLabel={trade.label}
            phrase={job.phrase}
            wants={job.wants}
            relatedTrades={related}
            urgent={job.urgent}
            todayIso={viewer.todayIso}
            city={city}
            googleOn={placesConfigured()}
            webOn={aiConfigured()}
            web={web}
            webRetry={!(web.source.state === "error" && web.source.message === NEEDS_CITY)}
            webUsage={webUsage}
          />
        </Card>

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

/** The trade select: a GET form that keeps the problem or upkeep job (and the wants) and drops the old phrase. */
function TradePicker(props: { ticketId: string | null; taskId: string | null; current: string | null; wants?: JobContext["wants"]; submitLabel: string }) {
  return (
    <form method="get" action="/repairs/find" className="flex flex-col gap-3 sm:flex-row sm:items-end">
      {props.ticketId ? <input type="hidden" name="ticket" value={props.ticketId} /> : null}
      {props.taskId ? <input type="hidden" name="task" value={props.taskId} /> : null}
      {(props.wants ?? []).map((w) => (
        <input key={w} type="hidden" name="want" value={w} />
      ))}
      <div className="flex-1">
        <label htmlFor="find-trade" className={labelClass}>
          Kind of work
        </label>
        <select id="find-trade" name="trade" defaultValue={props.current ?? ""} required className={inputClass}>
          <option value="" disabled>
            Choose…
          </option>
          {SEARCHABLE_TRADES.map((t) => (
            <option key={t.slug} value={t.slug}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className={props.current ? btnSecondary : btnPrimary}>
        {props.submitLabel}
      </button>
    </form>
  );
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
