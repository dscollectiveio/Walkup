import Link from "next/link";
import { Answer, Card, Restricted } from "@/components/ui";
import { Pill } from "@/components/repairs/pills";
import { telHref } from "@/components/repairs/emergency-banner";
import { btnLink, btnPrimary, btnSecondary, inputClass, labelClass, linkClass } from "@/components/repairs/styles";
import { AddVendorButton } from "@/app/contractors/vendor-form";
import { DraftList, type DraftRow } from "@/app/contractors/emails-card";
import { WriteToContractor } from "@/app/contractors/write-dialog";
import { complianceFor, usedRecently, type ComplianceItem } from "@/lib/contractors/compliance";
import {
  CONTRACTOR_SORTS,
  DRAFT_KIND_LABEL,
  directoryHref,
  hasDirectoryFilters,
  matchesQuery,
  orderDrafts,
  paperworkSummary,
  SORT_LABEL,
  sortDirectory,
  type DirectoryParams,
  type DirectoryRow,
} from "@/lib/contractors/directory";
import { TRADES, tradeBySlug, tradeLabel } from "@/lib/contractors/trades";
import { monthYear } from "@/lib/repairs/format";
import type { RepairsViewer } from "@/lib/repairs/page-data";
import type { Supabase } from "@/lib/repairs/server";
import { mailtoLink } from "@/lib/email/mailto";
import { safeHttpUrl } from "@/lib/security/safe-url";

export const CONTRACTORS_HREF = "/repairs?view=contractors";

type Row = DirectoryRow & {
  phone: string | null;
  email: string | null;
  website: string | null;
  archived: boolean;
  emergency: boolean;
  compliance: ComplianceItem[];
  inUse: boolean;
};

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * The contractor directory (repairs-spec §10.1): who you call, their
 * paperwork and how they've done, with search, filters and sort as GET
 * parameters, plus the emails waiting to be sent. Financial readers only;
 * the accountant reads, the board writes.
 */
export async function ContractorsView({ supabase, viewer, params }: { supabase: Supabase; viewer: RepairsViewer; params: DirectoryParams }) {
  if (!viewer.canReadFinancials) return <Restricted what="contractors" />;
  const today = viewer.todayIso;
  const isBoard = viewer.isBoard;

  let vendorQuery = supabase
    .from("vendors")
    .select(
      "id, name, status, contact_name, trades, phone, email, website_url, google_rating, google_review_count, insured_until, license_expires_on, license_number, w9_on_file, is_1099_exempt, emergency_service, archived_at, last_used_on",
    )
    .order("name")
    .limit(1000);
  if (!params.archived) vendorQuery = vendorQuery.is("archived_at", null);

  const [vendorsRes, reviewsRes, ticketsRes, expensesRes, upkeepRes, tasksRes, draftsRes, openTicketsRes] = await Promise.all([
    vendorQuery,
    isBoard ? supabase.from("contractor_reviews").select("vendor_id, rating") : Promise.resolve({ data: [] as { vendor_id: string; rating: number }[] }),
    supabase.from("tickets").select("assigned_vendor_id, opened_on, status").not("assigned_vendor_id", "is", null),
    supabase.from("expenses").select("vendor_id, paid_on").not("vendor_id", "is", null),
    supabase.from("upkeep_log").select("vendor_id, done_on").not("vendor_id", "is", null),
    supabase.from("upkeep_tasks").select("vendor_id").eq("is_active", true).not("vendor_id", "is", null),
    isBoard
      ? supabase
          .from("contractor_messages")
          .select("id, kind, subject, body, to_email, created_at, vendors(name), tickets(reference)")
          .eq("status", "draft")
          .order("created_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [] }),
    isBoard
      ? supabase.from("tickets").select("id, reference, title").not("status", "in", '("resolved","closed")').order("reference", { ascending: false }).limit(100)
      : Promise.resolve({ data: [] }),
  ]);
  if (!vendorsRes.data) return <Restricted what="contractors" />;

  // Usage: last used, and "in use" (an open problem, a usual upkeep job, or used in the last year).
  const last = new Map<string, string>();
  const openWork = new Set<string>();
  const bump = (id: string | null, date: string | null) => {
    if (!id || !date) return;
    const d = date.slice(0, 10);
    if (!last.has(id) || d > last.get(id)!) last.set(id, d);
  };
  for (const t of ticketsRes.data ?? []) {
    bump(t.assigned_vendor_id as string, t.opened_on as string);
    if (t.status !== "resolved" && t.status !== "closed") openWork.add(t.assigned_vendor_id as string);
  }
  for (const e of expensesRes.data ?? []) bump(e.vendor_id as string, e.paid_on as string);
  for (const u of upkeepRes.data ?? []) bump(u.vendor_id as string, u.done_on as string);
  for (const t of tasksRes.data ?? []) openWork.add(t.vendor_id as string);
  const reviews = new Map<string, { sum: number; n: number }>();
  for (const r of reviewsRes.data ?? []) {
    const cur = reviews.get(r.vendor_id as string) ?? { sum: 0, n: 0 };
    cur.sum += Number(r.rating);
    cur.n += 1;
    reviews.set(r.vendor_id as string, cur);
  }

  const all: Row[] = vendorsRes.data.map((v) => {
    const id = v.id as string;
    const trades = (v.trades as string[] | null) ?? [];
    const lastUsed = [last.get(id), (v.last_used_on as string | null) ?? undefined].filter(Boolean).sort().pop() ?? null;
    const inUse = openWork.has(id) || usedRecently(lastUsed, today);
    const r = reviews.get(id);
    const { items } = complianceFor(
      {
        insured_until: (v.insured_until as string | null) ?? null,
        license_number: (v.license_number as string | null) ?? null,
        license_expires_on: (v.license_expires_on as string | null) ?? null,
        w9_on_file: v.w9_on_file === true,
        is_1099_exempt: v.is_1099_exempt === true,
        status: v.status as string,
        archived_at: (v.archived_at as string | null) ?? null,
        inUse,
        tradeNeedsLicense: trades.some((s) => tradeBySlug(s)?.licenseTypical),
      },
      today,
    );
    return {
      id,
      name: v.name as string,
      status: v.status as Row["status"],
      contactName: str(v.contact_name),
      trades,
      lastUsed,
      boardAverage: r && r.n ? r.sum / r.n : null,
      boardCount: r?.n ?? 0,
      googleRating: v.google_rating === null || v.google_rating === undefined ? null : Number(v.google_rating),
      googleCount: (v.google_review_count as number | null) ?? null,
      phone: str(v.phone),
      email: str(v.email),
      website: str(v.website_url),
      archived: Boolean(v.archived_at),
      emergency: v.emergency_service === true,
      compliance: items,
      inUse,
    };
  });

  const live = all.filter((r) => !r.archived);
  const paperwork = paperworkSummary(
    live
      .filter((r) => r.inUse && r.compliance.length > 0)
      .sort((a, b) => Number(b.compliance[0].tone === "bad") - Number(a.compliance[0].tone === "bad") || a.name.localeCompare(b.name))
      .map((r) => ({ id: r.id, name: r.name, text: r.compliance[0].text, tone: r.compliance[0].tone === "bad" ? "bad" : "warning" })),
  );

  const shown = sortDirectory(
    all
      .filter((r) => (params.archived ? true : !r.archived))
      .filter((r) => params.trades.length === 0 || r.trades.some((t) => params.trades.includes(t)))
      .filter((r) => !params.status || r.status === params.status)
      .filter((r) => matchesQuery(r, params.q)),
    params.sort,
  );
  const archivedCount = all.filter((r) => r.archived).length;

  const tradesInUse = new Set(all.flatMap((r) => r.trades));
  const mainTrades = TRADES.filter((t) => tradesInUse.has(t.slug) || params.trades.includes(t.slug));
  const moreTrades = TRADES.filter((t) => !mainTrades.includes(t));
  const filtered = hasDirectoryFilters(params);

  const drafts: DraftRow[] = orderDrafts(
    (draftsRes.data ?? []).map((d) => {
      const vendor = one(d.vendors as { name: string } | { name: string }[] | null);
      const ticket = one(d.tickets as { reference: number } | { reference: number }[] | null);
      return {
        id: d.id as string,
        kind: (d.kind as string) ?? "general",
        createdAt: d.created_at as string,
        label: `${DRAFT_KIND_LABEL[(d.kind as string) ?? "general"] ?? "Email"} to ${vendor?.name ?? "a contractor"}${ticket ? ` about #${ticket.reference}` : ""}`,
        to: d.to_email ? [d.to_email as string] : [],
        subject: (d.subject as string) ?? "",
        body: (d.body as string) ?? "",
      };
    }),
  );
  const writeContractors = live.filter((r) => r.status !== "do_not_use").map((r) => ({ id: r.id, name: r.name, email: r.email }));
  const openTickets = (openTicketsRes.data ?? []).map((t) => ({ id: t.id as string, reference: t.reference as number, title: t.title as string }));

  if (all.length === 0 && !params.archived) {
    return (
      <Card navy title="Your contractors">
        <div className="space-y-3 py-2">
          <p className="text-[13px] text-mute">No contractors saved yet. Add the ones you already use, or find someone for a job.</p>
          {isBoard ? (
            <div className="flex flex-wrap gap-2">
              <AddVendorButton />
              <Link href="/repairs/find" className={btnSecondary}>
                Find a contractor
              </Link>
              {viewer.isAdmin ? (
                <Link href="/building/import/new?kind=contractors" className={btnSecondary}>
                  Import contractors
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {paperwork ? (
        <Answer status={paperwork.status} headline={paperwork.headline}>
          <ul className="space-y-1 text-[13px]">
            {paperwork.shown.map((p) => (
              <li key={p.id}>
                <Link href={`/contractors/${p.id}`} className={linkClass}>
                  {p.name}
                </Link>
                : {p.text}
              </li>
            ))}
            {paperwork.more > 0 ? <li>and {paperwork.more} more</li> : null}
          </ul>
        </Answer>
      ) : null}

      {isBoard ? (
        <div className="flex flex-wrap gap-2 max-sm:[&>*]:flex-1">
          <AddVendorButton />
          <Link href="/repairs/find" className={btnSecondary}>
            Find a contractor
          </Link>
        </div>
      ) : null}

      <form method="get" action="/repairs" className="space-y-3">
        <input type="hidden" name="view" value="contractors" />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="contractor-search" className={labelClass}>
              Search contractors
            </label>
            <input id="contractor-search" name="q" type="search" defaultValue={params.q} placeholder="Name, contact or kind of work" className={inputClass} />
          </div>
          <button type="submit" className={btnSecondary}>
            Search
          </button>
        </div>
        <details className="rounded-lg border border-line px-4" open={filtered || params.sort !== "status"}>
          <summary className="flex min-h-[44px] cursor-pointer items-center text-[13px] font-medium text-ink">Filters and sort</summary>
          <div className="space-y-4 pb-4 pt-2">
            <fieldset>
              <legend className={labelClass}>Kind of work</legend>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {mainTrades.map((t) => (
                  <TradeChip key={t.slug} slug={t.slug} label={t.label} checked={params.trades.includes(t.slug)} />
                ))}
              </div>
              {moreTrades.length > 0 ? (
                <details className="mt-2">
                  <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-[13px] text-mute">More…</summary>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {moreTrades.map((t) => (
                      <TradeChip key={t.slug} slug={t.slug} label={t.label} checked={params.trades.includes(t.slug)} />
                    ))}
                  </div>
                </details>
              ) : null}
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="contractor-status" className={labelClass}>
                  Status
                </label>
                <select id="contractor-status" name="status" defaultValue={params.status ?? ""} className={inputClass}>
                  <option value="">Any</option>
                  <option value="preferred">Preferred</option>
                  <option value="okay">Okay</option>
                  <option value="do_not_use">Do not use</option>
                </select>
              </div>
              <div>
                <label htmlFor="contractor-sort" className={labelClass}>
                  Sort
                </label>
                <select id="contractor-sort" name="sort" defaultValue={params.sort} className={inputClass}>
                  {CONTRACTOR_SORTS.map((s) => (
                    <option key={s} value={s}>
                      {SORT_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex min-h-[44px] cursor-pointer items-center gap-2 self-end text-[13px] text-ink">
                <input type="checkbox" name="archived" value="1" defaultChecked={params.archived} className="h-5 w-5" />
                Show archived{archivedCount > 0 && !params.archived ? ` (${archivedCount})` : ""}
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className={btnPrimary}>
                Apply
              </button>
              {filtered || params.sort !== "status" ? (
                <Link href={CONTRACTORS_HREF} className={btnSecondary}>
                  Clear
                </Link>
              ) : null}
            </div>
          </div>
        </details>
      </form>

      <Card navy title={params.archived ? "Your contractors, including archived" : "Your contractors"} hint="Who you call, their paperwork, and how they've done.">
        {shown.length === 0 ? (
          <p className="text-[13px] text-mute">
            No contractors match.{" "}
            <Link href={directoryHref({ ...params, q: "", trades: [], status: null, archived: false })} className={linkClass}>
              Clear the search or filters.
            </Link>
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((r) => (
              <ContractorRow key={r.id} r={r} isBoard={isBoard} />
            ))}
          </ul>
        )}
      </Card>

      {isBoard ? (
        <section id="emails" className="scroll-mt-4">
          <Card navy title="Emails waiting to be sent" hint="Drafts Walkup wrote for you. Open each in your email app, send it, then mark it sent.">
            {drafts.length > 0 ? <DraftList drafts={drafts} /> : <p className="text-[13px] text-mute">Nothing waiting.</p>}
            <div className="mt-4">
              <WriteToContractor contractors={writeContractors} tickets={openTickets} />
            </div>
          </Card>
        </section>
      ) : null}
    </div>
  );
}

function TradeChip({ slug, label, checked }: { slug: string; label: string; checked: boolean }) {
  return (
    <label className="inline-flex min-h-[40px] cursor-pointer items-center rounded-full border border-line-strong px-3 text-[12px] text-ink has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-paper has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brass">
      <input type="checkbox" name="trade" value={slug} defaultChecked={checked} className="sr-only" />
      {label}
    </label>
  );
}

const STATUS_PILL: Record<Row["status"], { label: string; tone: "good" | "outline" | "bad" }> = {
  preferred: { label: "Preferred", tone: "good" },
  okay: { label: "Okay", tone: "outline" },
  do_not_use: { label: "Do not use", tone: "bad" },
};

function ContractorRow({ r, isBoard }: { r: Row; isBoard: boolean }) {
  const s = STATUS_PILL[r.status];
  const worst = r.compliance[0];
  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/contractors/${r.id}`} className="text-[15px] font-medium text-ink underline-offset-2 hover:underline">
            {r.name}
          </Link>
          <Pill tone={s.tone}>{s.label}</Pill>
          {r.archived ? <Pill tone="outline">Archived</Pill> : null}
          {r.emergency ? <Pill tone="info">Your board says: takes emergency calls</Pill> : null}
        </div>
        {r.trades.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {r.trades.map((t) => (
              <span key={t} className="rounded-full bg-fill px-2 py-0.5 text-[11px] text-mute">
                {tradeLabel(t)}
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-4">
          {r.phone ? (
            <a href={telHref(r.phone)} className={btnLink}>
              {r.phone}
            </a>
          ) : null}
          {r.email ? (
            <a href={mailtoLink(r.email)} className={`${btnLink} break-all`}>
              {r.email}
            </a>
          ) : null}
          {r.website ? (
            <a href={safeHttpUrl(r.website) ?? undefined} target="_blank" rel="noopener noreferrer" className={btnLink}>
              Website
            </a>
          ) : null}
          {!r.phone && !r.email && !r.website ? <span className="text-[13px] text-mute">No phone, email or website</span> : null}
        </div>
      </div>
      <div className="shrink-0 space-y-1 text-[12px] text-mute sm:text-right">
        {isBoard && r.boardCount > 0 && r.boardAverage !== null ? (
          <div>
            Your board {r.boardAverage.toFixed(1)} ({r.boardCount})
          </div>
        ) : null}
        {r.googleRating !== null ? (
          <div>
            Google {r.googleRating.toFixed(1)}
            {r.googleCount !== null ? ` (${r.googleCount.toLocaleString("en-US")})` : ""}
          </div>
        ) : null}
        <div className="text-mute-soft">{r.lastUsed ? `Last used ${monthYear(r.lastUsed)}` : "Not used yet"}</div>
        {worst ? <Pill tone={worst.tone === "bad" ? "bad" : "warning"}>{worst.text}</Pill> : null}
      </div>
    </li>
  );
}
