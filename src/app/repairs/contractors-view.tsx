import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, Restricted } from "@/components/ui";
import { ContractorFilters } from "./contractor-filters";
import { DismissibleOnceAnswer } from "./dismissible-answer";
import { Pill } from "@/components/repairs/pills";
import { telHref } from "@/components/repairs/emergency-banner";
import { btnLink, btnPrimary, btnSecondary, linkClass } from "@/components/repairs/styles";
import { AddVendorButton } from "@/app/contractors/vendor-form";
import { DraftList, type DraftRow } from "@/app/contractors/emails-card";
import { WriteToContractor } from "@/app/contractors/write-dialog";
import { complianceFor, usedRecently, type ComplianceItem } from "@/lib/contractors/compliance";
import {
  DRAFT_KIND_LABEL,
  directoryHref,
  hasDirectoryFilters,
  matchesQuery,
  orderDrafts,
  paperworkSummary,
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
  insuredUntil: string | null;
  licenseNumber: string | null;
  licenseExpiresOn: string | null;
  w9OnFile: boolean;
  exempt1099: boolean;
  openProblems: number;
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
  // The board and the accountant, and a property manager who reads the list (0080). The write controls below stay with the board.
  if (!viewer.staffView) return <Restricted what="contractors" />;
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
  const openCount = new Map<string, number>();
  const bump = (id: string | null, date: string | null) => {
    if (!id || !date) return;
    const d = date.slice(0, 10);
    if (!last.has(id) || d > last.get(id)!) last.set(id, d);
  };
  for (const t of ticketsRes.data ?? []) {
    bump(t.assigned_vendor_id as string, t.opened_on as string);
    if (t.status !== "resolved" && t.status !== "closed") {
      openWork.add(t.assigned_vendor_id as string);
      openCount.set(t.assigned_vendor_id as string, (openCount.get(t.assigned_vendor_id as string) ?? 0) + 1);
    }
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
      insuredUntil: (v.insured_until as string | null) ?? null,
      licenseNumber: str(v.license_number),
      licenseExpiresOn: (v.license_expires_on as string | null) ?? null,
      w9OnFile: v.w9_on_file === true,
      exempt1099: v.is_1099_exempt === true,
      openProblems: openCount.get(id) ?? 0,
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
  // Counted on its own: the list above leaves archived contractors out unless "Show archived" is on.
  const { count: archivedTotal } = await supabase.from("vendors").select("id", { count: "exact", head: true }).not("archived_at", "is", null);
  const archivedCount = archivedTotal ?? 0;

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
          {archivedCount > 0 ? (
            <p className="text-[13px] text-mute">
              You have {archivedCount} archived {archivedCount === 1 ? "contractor" : "contractors"}.{" "}
              <Link href={directoryHref({ ...params, archived: true })} className={linkClass}>
                Show archived
              </Link>
            </p>
          ) : null}
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
        <DismissibleOnceAnswer status={paperwork.status} headline={paperwork.headline}>
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
        </DismissibleOnceAnswer>
      ) : null}

      {isBoard ? (
        <div className="flex flex-wrap justify-end gap-2">
          <AddVendorButton variant="solid" />
          <Link href="/repairs/find" className={btnPrimary}>
            Find a contractor
          </Link>
        </div>
      ) : null}

      <section aria-labelledby="contractors-card-title" className="rounded-xl border border-line bg-paper">
        {/* On desktop everything down to the column headers stays put while the rows scroll under it. */}
        <div className="z-20 rounded-t-xl bg-paper xl:sticky xl:top-[56px]">
          <header className="rounded-t-[11px] band bg-ink px-5 py-3">
            <h2 id="contractors-card-title" className="eyebrow text-paper">
              {params.archived ? "Your contractors, including archived" : "Your contractors"}
            </h2>
            <p className="mt-0.5 text-[12px] text-ondark-mute">Who you call, their paperwork, and how they&rsquo;ve done.</p>
          </header>

          {/* Search and filters, set apart from the list by a hard line. */}
          <div className="border-b-2 border-line-strong bg-fill/40">
            <ContractorFilters
              key={directoryHref(params)}
              params={params}
              mainTrades={mainTrades}
              moreTrades={moreTrades}
              archivedCount={archivedCount}
              clearHref={filtered || params.sort !== "status" ? CONTRACTORS_HREF : null}
            />
          </div>

          {shown.length > 0 ? (
            <div className="hidden px-5 pt-3 xl:block">
              <div className="relative isolate">
                <ColumnLines />
                <div aria-hidden="true" className={`${COLUMNS} border-b border-line pb-2 text-[11px] font-bold uppercase tracking-wide text-ink xl:pl-9`}>
                  <span className="text-center">Contractor</span>
                  <span className="text-center">Contact</span>
                  <span className="text-center">Rating</span>
                  <span className="text-center">Last used</span>
                  <span className="text-center">Paperwork</span>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="px-5 pb-3 pt-1">
          {shown.length === 0 ? (
            <p className="py-2 text-[13px] text-mute">
              No contractors match.{" "}
              <Link href={directoryHref({ ...params, q: "", trades: [], status: null, archived: false })} className={linkClass}>
                Clear the search or filters.
              </Link>
            </p>
          ) : (
            <div className="relative isolate">
              <ColumnLines />
              {/* Every other contractor gets a faint blue band, edge to edge. */}
              <ul className="divide-y divide-line [&>li:nth-child(even)]:bg-ink/[0.045]">
                {shown.map((r) => (
                  <ContractorRow key={r.id} r={r} isBoard={isBoard} todayIso={today} />
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

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

const STATUS_PILL: Record<Row["status"], { label: string; tone: "good" | "outline" | "bad" }> = {
  preferred: { label: "Preferred", tone: "good" },
  okay: { label: "Okay", tone: "outline" },
  do_not_use: { label: "Do not use", tone: "bad" },
};

/** The contractors table's fixed columns, desktop only. Below that each row stacks into one block. */
const COLUMNS = "xl:grid xl:grid-cols-[minmax(0,1fr)_13rem_9rem_7rem_11rem] xl:items-center xl:gap-x-3";

/**
 * Thin vertical rules between the columns, drawn once down the table at each
 * column's fixed right-hand offset (the running width of the columns to its
 * right plus half a 0.75rem gap). Desktop only.
 */
function ColumnLines() {
  const lines = ["xl:right-[11.375rem]", "xl:right-[19.125rem]", "xl:right-[28.875rem]", "xl:right-[42.625rem]"];
  return (
    <>
      {lines.map((c) => (
        <span key={c} aria-hidden="true" className={`pointer-events-none absolute inset-y-0 -z-10 hidden w-px bg-line xl:block ${c}`} />
      ))}
    </>
  );
}

function ContractorRow({ r, isBoard, todayIso }: { r: Row; isBoard: boolean; todayIso: string }) {
  const s = STATUS_PILL[r.status];
  const worst = r.compliance[0];
  const lapsed = (d: string | null) => d !== null && d < todayIso;
  const label = "text-[11px] font-medium uppercase tracking-wide text-mute";
  return (
    <li className="-mx-5 px-5">
      <details className="group py-3">
        <summary className="flex cursor-pointer list-none items-start gap-3 [&::-webkit-details-marker]:hidden">
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line-strong bg-paper text-ink group-hover:bg-fill"
          >
            <ChevronRight size={15} strokeWidth={2.2} className="transition-transform group-open:rotate-90" />
          </span>
          <span className="sr-only">Show or hide more about {r.name}</span>
          <div className={`flex min-w-0 flex-1 flex-col gap-2 ${COLUMNS}`}>
            {/* Contractor */}
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/contractors/${r.id}`} className="text-[15px] font-medium text-ink underline-offset-2 hover:underline">
                  {r.name}
                </Link>
                <Pill tone={s.tone}>{s.label}</Pill>
                {r.archived ? <Pill tone="outline">Archived</Pill> : null}
                {r.emergency ? <Pill tone="info">Takes emergency calls</Pill> : null}
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
            </div>

            {/* Contact */}
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 xl:flex-col xl:items-center xl:gap-x-0">
              {r.phone ? (
                <a href={telHref(r.phone)} className={`${btnLink} !min-h-[24px] text-[12px]`}>
                  {r.phone}
                </a>
              ) : null}
              {r.email ? (
                <a href={mailtoLink(r.email)} title={r.email} className={`${btnLink} !min-h-[24px] max-w-full text-[12px] xl:truncate`}>
                  {r.email}
                </a>
              ) : null}
              {r.website ? (
                <a href={safeHttpUrl(r.website) ?? undefined} target="_blank" rel="noopener noreferrer" className={`${btnLink} !min-h-[24px] text-[12px]`}>
                  Website
                </a>
              ) : null}
              {!r.phone && !r.email && !r.website ? <span className="text-[13px] text-mute">No phone, email or website</span> : null}
            </div>

            {/* Rating */}
            <div className="space-y-0.5 text-[12px] text-mute xl:text-center">
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
              {!(isBoard && r.boardCount > 0 && r.boardAverage !== null) && r.googleRating === null ? <div className="text-mute-soft">No ratings</div> : null}
            </div>

            {/* Last used */}
            <div className="text-[12px] text-mute xl:text-center">{r.lastUsed ? monthYear(r.lastUsed) : "Not used yet"}</div>

            {/* Paperwork */}
            <div className="xl:flex xl:justify-center">
              {worst ? <Pill tone={worst.tone === "bad" ? "bad" : "warning"}>{worst.text}</Pill> : <span className="text-[12px] text-good-text">In order</span>}
            </div>
          </div>
        </summary>

        {/* The short version of everything about them. The full profile has the rest. */}
        <div className="ml-9 mt-3 rounded-lg border border-line bg-paper p-4">
          <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className={label}>Contact person</dt>
              <dd className="text-ink">{r.contactName ?? "Not recorded"}</dd>
            </div>
            <div>
              <dt className={label}>Insurance</dt>
              <dd className={lapsed(r.insuredUntil) ? "font-medium text-bad-text" : "text-ink"}>
                {r.insuredUntil ? `${lapsed(r.insuredUntil) ? "Expired" : "Through"} ${monthYear(r.insuredUntil)}` : "None on file"}
              </dd>
            </div>
            <div>
              <dt className={label}>License</dt>
              <dd className={lapsed(r.licenseExpiresOn) ? "font-medium text-bad-text" : "text-ink"}>
                {r.licenseNumber ? `${r.licenseNumber}${r.licenseExpiresOn ? `, ${lapsed(r.licenseExpiresOn) ? "expired" : "through"} ${monthYear(r.licenseExpiresOn)}` : ""}` : "None on file"}
              </dd>
            </div>
            <div>
              <dt className={label}>W-9</dt>
              <dd className={r.w9OnFile || r.exempt1099 ? "text-good-text" : "text-ink"}>
                {r.w9OnFile ? "On file" : r.exempt1099 ? "Not needed (exempt)" : "Not collected yet"}
              </dd>
            </div>
            <div>
              <dt className={label}>Open problems</dt>
              <dd className="text-ink">{r.openProblems === 0 ? "None" : r.openProblems}</dd>
            </div>
            <div>
              <dt className={label}>Last used</dt>
              <dd className="text-ink">{r.lastUsed ? monthYear(r.lastUsed) : "Not used yet"}</dd>
            </div>
            <div>
              <dt className={label}>Emergency calls</dt>
              <dd className="text-ink">{r.emergency ? "Your board says yes" : "Not noted"}</dd>
            </div>
          </dl>
          <div className="mt-3 border-t border-line pt-3">
            <Link href={`/contractors/${r.id}`} className="text-[13px] font-medium text-ink underline underline-offset-2">
              Open {isBoard ? "the full profile" : "their profile"}
            </Link>
          </div>
        </div>
      </details>
    </li>
  );
}
