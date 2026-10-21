import { taxFlag, vendorColumns, vendorSource } from "@/lib/contractors/vendor-source";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Restricted } from "@/components/ui";
import { BoardOnly, viewerIsOwnerOnly } from "@/components/board-only";
import { Pill } from "@/components/repairs/pills";
import { telHref } from "@/components/repairs/emergency-banner";
import { REVIEW_TAG_LABEL } from "@/components/repairs/quick-review";
import { btnLink, linkClass } from "@/components/repairs/styles";
import { listLinkedDocuments } from "@/lib/documents/access";
import { EntityDocuments } from "@/app/documents/entity-documents";
import { aiConfigured } from "@/lib/ai/client";
import { complianceFor, usedRecently } from "@/lib/contractors/compliance";
import { DRAFT_KIND_LABEL } from "@/lib/contractors/directory";
import { loadContractorHistory, type HistoryItem } from "@/lib/contractors/history";
import { tradeBySlug, tradeLabel } from "@/lib/contractors/trades";
import { ADDITIONAL_INSUREDS } from "@/lib/repairs/drafts";
import { actLinkText, CITATIONS } from "@/lib/insurance/statute";
import { googleKey, googleMapsUrl, isStale } from "@/lib/google/places";
import { humanDate, monthYear, moneyText } from "@/lib/repairs/format";
import { loadViewer } from "@/lib/repairs/page-data";
import { isUuid } from "@/lib/repairs/server";
import { DraftList } from "../emails-card";
import { EditVendorButton, type VendorRecord } from "../vendor-form";
import type { ReviewTag } from "../vendor-actions";
import { WriteToContractor } from "../write-dialog";
import { RestoreButton } from "./archive-dialog";
import { CertificateReader } from "./certificate-reader";
import { GoogleRefresh } from "./google-refresh";
import { NotesLog, type NoteView } from "./notes-log";
import { ProfileActions, type OpenTicketOption } from "./profile-actions";
import { RatesCard } from "./rates-card";
import { ReviewsCard, type ReviewView } from "./reviews-card";
import { mailtoLink } from "@/lib/email/mailto";

export const dynamic = "force-dynamic";
// Hosts EntityDocuments (registerUpload reads in after()) and certificate reading (repairs-spec §2.5).
export const maxDuration = 300;

const STATUS_PILL: Record<string, { label: string; tone: "good" | "outline" | "bad" }> = {
  preferred: { label: "Preferred", tone: "good" },
  okay: { label: "Okay", tone: "outline" },
  do_not_use: { label: "Do not use", tone: "bad" },
};

const ENTITY_LABEL: Record<string, string> = {
  individual: "Individual",
  sole_prop: "Sole proprietor",
  llc: "LLC",
  partnership: "Partnership",
  s_corp: "S corporation",
  c_corp: "C corporation",
  other: "Other",
};

const JOB_TAG_LABEL: Record<string, string> = {
  condo_work: "Works on condo or multi-unit buildings",
  small_jobs: "Takes small jobs",
  free_estimates: "Gives free estimates",
};

const OPEN = new Set(["open", "in_progress", "waiting_on_contractor"]);
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/**
 * A contractor's profile (repairs-spec §10.2): how to reach them, their
 * paperwork, rates, ratings, everything they've done for the building,
 * reviews, notes and emails. Financial readers see it; the board edits.
 */
export default async function ContractorPage({ params }: { params: Promise<{ vendorId: string }> }) {
  const { vendorId } = await params;
  if (!isUuid(vendorId)) return <Restricted what="this contractor" />;
  const supabase = await createClient();
  const viewer = await loadViewer(supabase);
  // The board, the accountant and a property manager read a contractor's profile (0080); only the first two read the books.
  if (!viewer || !viewer.staffView) {
    if (await viewerIsOwnerOnly()) {
      return (
        <BoardOnly
          what="Contractor details"
          why="It holds a contractor's paperwork, rates and what the association has paid them."
          alternative={{ label: "See repairs", href: "/repairs" }}
        />
      );
    }
    return <Restricted what="this contractor" />;
  }

  // A property manager reads the contractor through vendors_manager, which has no tax identity (0081).
  const fin = viewer.canReadFinancials;
  const { data: rows } = await supabase
    .from(vendorSource(fin))
    .select(
      vendorColumns(
        "id, association_id, name, trades, contact_name, phone, email, website_url, address, status, do_not_use_reason, board_rating, entity_type, license_number, license_expires_on, insured_until, w9_on_file, w9_received_on, tin_last4, is_1099_exempt, notes, source, source_urls, google_place_id, google_rating, google_review_count, google_fetched_at, google_business_status, archived_at, archived_reason, emergency_service, job_tags, rate_hourly::text, rate_trip_fee::text, rate_after_hours::text, rates_as_of, payment_methods, other_contact_name, other_contact_role, other_contact_phone, other_contact_email",
        fin,
      ),
    )
    .eq("id", vendorId)
    .limit(1);
  const v = (rows as unknown as Record<string, unknown>[] | null)?.[0];
  if (!v) return <Restricted what="this contractor" />;

  const canEdit = viewer.isBoard;
  const today = viewer.todayIso;
  const [historyRes, reviewsRes, notesRes, personsRes, documents, ticketsRes, bidsRes, messagesRes, assocRes, auth] = await Promise.all([
    loadContractorHistory(supabase, vendorId).catch((e: unknown) => {
      console.error("[repairs] contractor history", e instanceof Error ? e.message : "unknown");
      return null;
    }),
    supabase
      .from("contractor_reviews")
      .select("id, rating, tags, body, created_at, created_by, edited_at, tickets(id, reference, title), upkeep_log(done_on, task_id, upkeep_tasks(name))")
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: false }),
    supabase.from("contractor_notes").select("id, body, created_at, edited_at, created_by, author_person_id").eq("vendor_id", vendorId).order("created_at", { ascending: false }),
    supabase.from("persons").select("id, full_name, auth_user_id"),
    listLinkedDocuments(supabase, "vendors", vendorId),
    supabase.from("tickets").select("id, reference, title, status, assigned_vendor_id").not("status", "in", '("resolved","closed")').order("reference", { ascending: false }).limit(100),
    supabase.from("ticket_bids").select("ticket_id, status").eq("vendor_id", vendorId).in("status", ["requested", "received", "accepted"]),
    canEdit
      ? supabase
          .from("contractor_messages")
          .select("id, kind, status, subject, body, to_email, sent_at, created_at, tickets(reference)")
          .eq("vendor_id", vendorId)
          .in("status", ["draft", "sent"])
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase.from("associations").select("state_code").limit(1),
    canEdit ? supabase.auth.getUser() : Promise.resolve(null),
  ]);

  const me = auth?.data?.user?.id ?? null;
  const persons = personsRes.data ?? [];
  const nameByUser = new Map(persons.map((p) => [p.auth_user_id as string, (p.full_name as string) || "A board member"]));
  const nameByPerson = new Map(persons.map((p) => [p.id as string, (p.full_name as string) || "A board member"]));

  const archived = Boolean(v.archived_at);
  const usable = !archived && v.status !== "do_not_use";
  const trades = (v.trades as string[] | null) ?? [];
  const status = STATUS_PILL[v.status as string] ?? STATUS_PILL.okay;

  // Usage, for "in use" (missing paperwork only matters for someone the board uses).
  const openTickets = ticketsRes.data ?? [];
  const openAssigned = openTickets.filter((t) => t.assigned_vendor_id === vendorId).length;
  const usualForTask = (historyRes?.upkeepTasks.length ?? 0) > 0;
  const inUse = openAssigned > 0 || usualForTask || usedRecently(historyRes?.totals.lastUsed ?? null, today);
  const { items: compliance } = complianceFor(
    {
      insured_until: (v.insured_until as string | null) ?? null,
      license_number: (v.license_number as string | null) ?? null,
      license_expires_on: (v.license_expires_on as string | null) ?? null,
      // Not shown to a property manager, so never read as "missing".
      w9_on_file: taxFlag(v.w9_on_file, fin),
      is_1099_exempt: taxFlag(v.is_1099_exempt, fin),
      status: v.status as string,
      archived_at: (v.archived_at as string | null) ?? null,
      inUse,
      tradeNeedsLicense: trades.some((s) => tradeBySlug(s)?.licenseTypical),
    },
    today,
  );
  const needsCoi = compliance.some((c) => c.action === "request_coi");
  const needsW9 = compliance.some((c) => c.action === "request_w9");
  const needsEdit = compliance.some((c) => c.action === "edit");

  const messages = messagesRes.data ?? [];
  const lastSent = (kinds: string[]) =>
    messages
      .filter((m) => m.status === "sent" && kinds.includes(m.kind as string) && m.sent_at)
      .map((m) => (m.sent_at as string).slice(0, 10))
      .sort()
      .pop() ?? null;
  const coiAsked = lastSent(["coi_request", "paperwork_request"]);
  const w9Asked = lastSent(["w9_request", "paperwork_request"]);

  const stateCode = (assocRes.data?.[0]?.state_code as string | null) ?? null;
  const licenseLinks = trades
    .map((t) => ({ trade: t, url: stateCode ? tradeBySlug(t)?.licenseLookupUrl?.[stateCode] : undefined }))
    .filter((l): l is { trade: string; url: string } => Boolean(l.url));

  const googleStale = Boolean(v.google_place_id && googleKey() && isStale(v.google_fetched_at as string | null, new Date()));

  const record: VendorRecord = {
    id: v.id as string,
    name: v.name as string,
    trades,
    contact_name: v.contact_name as string | null,
    phone: v.phone as string | null,
    email: v.email as string | null,
    website_url: v.website_url as string | null,
    address: v.address as string | null,
    status: v.status as string,
    do_not_use_reason: v.do_not_use_reason as string | null,
    board_rating: v.board_rating as number | null,
    entity_type: (v.entity_type as string | null) ?? null,
    license_number: v.license_number as string | null,
    license_expires_on: v.license_expires_on as string | null,
    insured_until: v.insured_until as string | null,
    w9_on_file: v.w9_on_file === true,
    w9_received_on: (v.w9_received_on as string | null) ?? null,
    tin_last4: (v.tin_last4 as string | null) ?? null,
    is_1099_exempt: v.is_1099_exempt === true,
    notes: v.notes as string | null,
    emergency_service: v.emergency_service === true,
    job_tags: (v.job_tags as string[] | null) ?? [],
    other_contact_name: v.other_contact_name as string | null,
    other_contact_role: v.other_contact_role as string | null,
    other_contact_phone: v.other_contact_phone as string | null,
    other_contact_email: v.other_contact_email as string | null,
    payment_methods: v.payment_methods as string | null,
  };

  const askedTickets = new Set((bidsRes.data ?? []).map((b) => b.ticket_id as string));
  const ticketOptions: OpenTicketOption[] = openTickets
    .filter((t) => OPEN.has(t.status as string))
    .map((t) => ({
      id: t.id as string,
      reference: t.reference as number,
      title: t.title as string,
      hasContractor: Boolean(t.assigned_vendor_id),
      asked: askedTickets.has(t.id as string),
    }));

  const reviews: ReviewView[] = (reviewsRes.data ?? []).map((r) => {
    const t = one(r.tickets as { id: string; reference: number; title: string } | { id: string; reference: number; title: string }[] | null);
    type LogRef = { done_on: string; task_id: string; upkeep_tasks: { name: string } | { name: string }[] | null };
    const u = one(r.upkeep_log as unknown as LogRef | LogRef[] | null);
    return {
      id: r.id as string,
      rating: r.rating as number,
      tags: ((r.tags as string[] | null) ?? []) as ReviewTag[],
      body: str(r.body),
      author: me && r.created_by === me ? "You" : (nameByUser.get(r.created_by as string) ?? "A board member"),
      createdAt: r.created_at as string,
      edited: Boolean(r.edited_at),
      mine: Boolean(me && r.created_by === me),
      ticket: t ? { id: t.id, reference: t.reference, title: t.title } : null,
      upkeep: u ? { taskId: u.task_id, taskName: one(u.upkeep_tasks)?.name ?? "Upkeep", doneOn: u.done_on } : null,
    };
  });
  const reviewCount = reviews.length;
  const reviewAvg = reviewCount > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / reviewCount : null;
  const tagCounts = new Map<ReviewTag, number>();
  for (const r of reviews) for (const t of r.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);

  const notes: NoteView[] = (notesRes.data ?? []).map((n) => ({
    id: n.id as string,
    body: n.body as string,
    author:
      me && n.created_by === me
        ? "You"
        : (n.author_person_id && nameByPerson.get(n.author_person_id as string)) || nameByUser.get(n.created_by as string) || "A board member",
    createdAt: n.created_at as string,
    edited: Boolean(n.edited_at),
    mine: Boolean(me && n.created_by === me),
  }));

  const drafts = messages
    .filter((m) => m.status === "draft")
    .map((m) => {
      const ticket = one(m.tickets as { reference: number } | { reference: number }[] | null);
      return {
        id: m.id as string,
        label: `${DRAFT_KIND_LABEL[m.kind as string] ?? "Email"}${ticket ? ` about #${ticket.reference}` : ""}`,
        to: m.to_email ? [m.to_email as string] : [],
        subject: (m.subject as string) ?? "",
        body: (m.body as string) ?? "",
      };
    });
  const sent = messages.filter((m) => m.status === "sent");

  const ticketChoices = (historyRes?.items ?? [])
    .filter((i): i is Extract<HistoryItem, { kind: "ticket" }> => i.kind === "ticket")
    .map((i) => ({ id: i.ticketId, label: `#${i.reference} ${i.title}` }));
  const pdfs = documents.filter((d) => d.mime_type === "application/pdf").map((d) => ({ id: d.id, filename: d.filename }));
  const sourceUrls = ((v.source_urls as string[] | null) ?? []).filter(Boolean);
  const jobTags = (v.job_tags as string[] | null) ?? [];
  const otherContact = str(v.other_contact_name);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link href="/repairs?view=contractors" className="inline-flex min-h-[44px] items-center text-[13px] text-mute hover:underline">
          ← All contractors
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[20px] font-bold tracking-tight text-ink">{v.name as string}</h1>
          <Pill tone={status.tone}>{status.label}</Pill>
          {v.emergency_service ? <Pill tone="info">Your board says: takes emergency calls</Pill> : null}
        </div>
        {archived ? (
          <div className="flex flex-wrap items-center gap-3 border-l-[3px] border-line-strong bg-fill px-3 py-2 text-[13px] text-ink">
            <span>
              Archived {humanDate((v.archived_at as string).slice(0, 10), today)}
              {str(v.archived_reason) ? `: ${str(v.archived_reason)}` : ""}.
            </span>
            {canEdit ? <RestoreButton vendorId={vendorId} /> : null}
          </div>
        ) : null}
        {trades.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {trades.map((t) => (
              <span key={t} className="rounded-full bg-fill px-2 py-0.5 text-[11px] text-mute">
                {tradeLabel(t)}
              </span>
            ))}
          </div>
        ) : null}
        {v.status === "do_not_use" && v.do_not_use_reason ? (
          <p className="border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">
            The board decided not to use them: {v.do_not_use_reason as string}
          </p>
        ) : null}
        {str(v.contact_name) || str(v.address) ? (
          <p className="text-[13px] text-mute">{[str(v.contact_name), str(v.address)].filter(Boolean).join(" · ")}</p>
        ) : null}
        {otherContact ? (
          <p className="flex flex-wrap items-center gap-x-3 text-[13px] text-mute">
            <span>
              Also: {otherContact}
              {str(v.other_contact_role) ? ` (${str(v.other_contact_role)})` : ""}
            </span>
            {str(v.other_contact_phone) ? (
              <a href={telHref(v.other_contact_phone as string)} className={btnLink}>
                {v.other_contact_phone as string}
              </a>
            ) : null}
            {str(v.other_contact_email) ? (
              <a href={mailtoLink(v.other_contact_email as string)} className={btnLink}>
                {v.other_contact_email as string}
              </a>
            ) : null}
          </p>
        ) : null}
        <ProfileActions
          vendor={{
            id: vendorId,
            name: v.name as string,
            phone: str(v.phone),
            email: str(v.email),
            website: str(v.website_url),
            archived,
            usable,
          }}
          record={record}
          canEdit={canEdit}
          isAdmin={viewer.isAdmin}
          openTickets={ticketOptions}
          openProblems={openAssigned}
          senderEmail={auth?.data?.user?.email ?? null}
        />
      </div>

      <Card navy title="Paperwork">
        <div className="space-y-4">
          {compliance.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {compliance.map((c) => (
                <li key={c.key}>
                  <Pill tone={c.tone === "bad" ? "bad" : "warning"}>{c.text}</Pill>
                </li>
              ))}
            </ul>
          ) : usable ? (
            <Pill tone="good">Paperwork is in order</Pill>
          ) : null}
          {canEdit && usable && (needsCoi || needsW9 || needsEdit) ? (
            <div className="flex flex-wrap gap-2">
              {needsCoi && needsW9 ? (
                <WriteToContractor contractors={[{ id: vendorId, name: v.name as string, email: str(v.email) }]} tickets={[]} vendorId={vendorId} preset={{ kind: "paperwork_request" }} label="Ask for both" />
              ) : needsCoi ? (
                <WriteToContractor contractors={[{ id: vendorId, name: v.name as string, email: str(v.email) }]} tickets={[]} vendorId={vendorId} preset={{ kind: "coi_request" }} label="Ask for a certificate" />
              ) : needsW9 ? (
                <WriteToContractor contractors={[{ id: vendorId, name: v.name as string, email: str(v.email) }]} tickets={[]} vendorId={vendorId} preset={{ kind: "w9_request" }} label="Ask for a W-9" />
              ) : null}
              {needsEdit ? <EditVendorButton vendor={record} label="Update" /> : null}
            </div>
          ) : null}
          {coiAsked || w9Asked ? (
            <p className="text-[12px] text-mute">
              {[coiAsked ? `Certificate requested ${humanDate(coiAsked, today)}` : null, w9Asked ? `W-9 requested ${humanDate(w9Asked, today)}` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
            <div>
              <dt className="text-[11px] text-mute">License</dt>
              <dd className="text-ink">
                {str(v.license_number) ?? "Not recorded"}
                {v.license_expires_on ? <span className="text-mute"> · expires {humanDate(v.license_expires_on as string, today)}</span> : null}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-mute">Insurance certificate</dt>
              <dd className="text-ink">{v.insured_until ? `Runs until ${humanDate(v.insured_until as string, today)}` : "Not on file"}</dd>
            </div>
            {fin ? (
              <>
            <div>
              <dt className="text-[11px] text-mute">W-9</dt>
              <dd className="text-ink">
                {v.w9_on_file
                  ? `On file${v.w9_received_on ? ` since ${humanDate(v.w9_received_on as string, today)}` : ""}${v.tin_last4 ? ` · tax ID ending ${v.tin_last4 as string}` : ""}`
                  : v.is_1099_exempt
                    ? "Not needed: 1099-exempt"
                    : "Not on file"}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-mute">Business type</dt>
              <dd className="text-ink">{v.entity_type ? (ENTITY_LABEL[v.entity_type as string] ?? (v.entity_type as string)) : "Not recorded"}</dd>
            </div>
              </>
            ) : null}
            {licenseLinks.length > 0 ? (
              <div>
                <dt className="text-[11px] text-mute">Check license</dt>
                <dd className="flex flex-wrap gap-3">
                  {licenseLinks.map((l) => (
                    <a key={l.trade} href={l.url} target="_blank" rel="noopener noreferrer" className={linkClass}>
                      {tradeLabel(l.trade)}
                    </a>
                  ))}
                </dd>
              </div>
            ) : null}
          </dl>
          {stateCode === "IL" ? <CertificateRule /> : null}
          <div className="border-t border-line pt-4">
            <EntityDocuments targetTable="vendors" targetId={vendorId} documents={documents} canWrite={canEdit} />
          </div>
          {canEdit && aiConfigured() && pdfs.length > 0 ? <CertificateReader vendorId={vendorId} documents={pdfs} todayIso={today} /> : null}
        </div>
      </Card>

      <Card navy title="Rates and terms">
        <RatesCard
          vendorId={vendorId}
          hourly={(v.rate_hourly as string | null) ?? null}
          tripFee={(v.rate_trip_fee as string | null) ?? null}
          afterHours={(v.rate_after_hours as string | null) ?? null}
          asOf={(v.rates_as_of as string | null) ?? null}
          paymentMethods={str(v.payment_methods)}
          canEdit={canEdit}
        />
      </Card>

      <Card navy title="Ratings">
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-2 text-[13px]">
            <h3 className="font-medium text-ink">Your board</h3>
            {reviewAvg === null && v.board_rating === null ? (
              <p className="text-mute">{viewer.isBoard ? "Not reviewed yet." : "The board's reviews are visible to board members."}</p>
            ) : null}
            {reviewAvg !== null ? (
              <p>
                <span className="figures text-[22px] text-ink">{reviewAvg.toFixed(1)}</span>
                <span className="text-mute">
                  {" "}
                  of 5 from {reviewCount} {reviewCount === 1 ? "review" : "reviews"}
                </span>
              </p>
            ) : null}
            {tagCounts.size > 0 ? (
              <div className="flex flex-wrap gap-1">
                {[...tagCounts.entries()].map(([t, n]) => (
                  <Pill key={t} tone="neutral">
                    {REVIEW_TAG_LABEL[t]} ({n})
                  </Pill>
                ))}
              </div>
            ) : null}
            {v.board_rating !== null ? <p className="text-mute">Board rating {v.board_rating as number} of 5</p> : null}
          </div>
          <div className="space-y-2 text-[13px]">
            <h3 className="font-medium text-ink">{v.google_place_id ? "Google" : v.source === "web" ? "Found on the web" : "Google"}</h3>
            {v.google_place_id ? (
              <>
                {v.google_rating !== null ? (
                  <p>
                    <span className="figures text-[22px] text-ink">{Number(v.google_rating).toFixed(1)}</span>
                    <span className="text-mute">
                      {" "}
                      of 5{v.google_review_count !== null ? ` from ${(v.google_review_count as number).toLocaleString("en-US")} reviews` : ""}
                    </span>
                  </p>
                ) : (
                  <p className="text-mute">No Google rating yet.</p>
                )}
                {v.google_business_status === "CLOSED_PERMANENTLY" ? (
                  <p className="border-l-[3px] border-warning bg-warning-tint px-3 py-2 text-warning-text">Google lists this business as permanently closed.</p>
                ) : null}
                <a href={googleMapsUrl(v.google_place_id as string)} target="_blank" rel="noopener noreferrer" className={btnLink}>
                  See on Google
                </a>
                {v.google_fetched_at ? (
                  <p className="text-[12px] text-mute">
                    Updated {humanDate((v.google_fetched_at as string).slice(0, 10), today)}
                    {googleStale && canEdit ? <GoogleRefresh vendorId={vendorId} /> : null}
                  </p>
                ) : null}
              </>
            ) : v.source === "web" ? null : (
              <p className="text-mute">Added by hand, so there&rsquo;s no Google listing linked.</p>
            )}
            {v.source === "web" ? (
              <div className="space-y-2">
                {sourceUrls.length > 0 ? (
                  <ul className="space-y-1">
                    {sourceUrls.map((u) => (
                      <li key={u}>
                        <a href={u} target="_blank" rel="noopener noreferrer nofollow" className={linkClass}>
                          {hostOf(u)}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {jobTags.length > 0 || v.emergency_service ? (
                  <div>
                    <p className="text-[12px] text-mute">From their website</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {v.emergency_service ? <Pill tone="neutral">Advertises emergency service</Pill> : null}
                      {jobTags.map((t) => (
                        <Pill key={t} tone="neutral">
                          {JOB_TAG_LABEL[t] ?? t}
                        </Pill>
                      ))}
                    </div>
                  </div>
                ) : null}
                <p className="text-[12px] text-mute">Walkup didn&rsquo;t check this business and doesn&rsquo;t endorse it. Confirm details with them.</p>
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      <Card navy title="Work with you">
        {historyRes ? <History h={historyRes} todayIso={today} /> : <p className="text-[13px] text-bad-text">Walkup couldn&rsquo;t load their history. Reload the page to try again.</p>}
      </Card>

      {viewer.isBoard ? (
        <Card navy title="Reviews from the board">
          <ReviewsCard vendorId={vendorId} reviews={reviews} canEdit={canEdit} isAdmin={viewer.isAdmin} tickets={ticketChoices} todayIso={today} />
        </Card>
      ) : null}

      {viewer.isBoard ? (
        <Card navy title="Notes" hint="Internal to the board.">
          <NotesLog vendorId={vendorId} summary={str(v.notes)} notes={notes} canEdit={canEdit} isAdmin={viewer.isAdmin} todayIso={today} />
        </Card>
      ) : null}

      {canEdit ? (
        <Card navy title="Emails">
          <div className="space-y-4">
            {drafts.length > 0 ? <DraftList drafts={drafts} /> : <p className="text-[13px] text-mute">No drafts waiting.</p>}
            {sent.length > 0 ? (
              <div>
                <h3 className="text-[13px] font-medium text-ink">Sent</h3>
                <ul className="mt-1 space-y-1 text-[13px] text-mute">
                  {sent.map((m) => (
                    <li key={m.id as string}>
                      {DRAFT_KIND_LABEL[m.kind as string] ?? "Email"} · sent {m.sent_at ? humanDate((m.sent_at as string).slice(0, 10), today) : "earlier"}
                      {str(m.subject) ? `: ${m.subject as string}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function History({ h, todayIso }: { h: NonNullable<Awaited<ReturnType<typeof loadContractorHistory>>>; todayIso: string }) {
  const t = h.totals;
  const jobs = `${t.jobs} ${t.jobs === 1 ? "job" : "jobs"}`;
  const span = t.firstUsed && t.lastUsed ? ` · first ${monthYear(t.firstUsed)}, last ${monthYear(t.lastUsed)}` : "";
  const items = h.items;
  const row = (i: HistoryItem, k: number) => (
    <li key={`${i.kind}-${k}`} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
      <span className="min-w-0 text-ink">{historyText(i)}</span>
      <span className="shrink-0 text-[12px] text-mute">{humanDate(i.date.slice(0, 10), todayIso)}</span>
    </li>
  );
  return (
    <div className="space-y-4 text-[13px]">
      <p className="text-ink">
        Paid {moneyText(t.paidThisYear) || "$0"} this year, {moneyText(t.paidAllTime) || "$0"} in all · {jobs}
        {span}
      </p>
      {h.upkeepTasks.length > 0 ? (
        <div>
          <h3 className="text-[12px] font-medium text-mute">Usual contractor for</h3>
          <ul className="mt-1 flex flex-wrap gap-x-4">
            {h.upkeepTasks.map((u) => (
              <li key={u.id}>
                <Link href={`/repairs/upkeep/${u.id}`} className={btnLink}>
                  {u.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {h.recurringBills.length > 0 ? (
        <div>
          <h3 className="text-[12px] font-medium text-mute">Regular bills</h3>
          <ul className="mt-1 space-y-0.5">
            {h.recurringBills.map((b) => (
              <li key={b.id} className="text-ink">
                {b.name}
                {b.next_due_on ? <span className="text-mute"> · next {humanDate(b.next_due_on, todayIso)}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {items.length === 0 ? (
        <p className="text-mute">No problems, upkeep, payments or emails with them yet.</p>
      ) : (
        <>
          <ol className="divide-y divide-line">{items.slice(0, 20).map(row)}</ol>
          {items.length > 20 ? (
            <details>
              <summary className="inline-flex min-h-[44px] cursor-pointer items-center font-medium text-ink">Show all ({items.length})</summary>
              <ol className="divide-y divide-line">{items.slice(20).map((i, k) => row(i, k + 20))}</ol>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}

const TICKET_STATUS: Record<string, string> = {
  open: "open",
  in_progress: "being worked on",
  waiting_on_contractor: "waiting on them",
  resolved: "fixed",
  closed: "closed",
};
const BID_STATUS: Record<string, string> = {
  requested: "asked",
  received: "received",
  accepted: "accepted",
  declined: "not chosen",
  withdrawn: "withdrawn",
};

function historyText(i: HistoryItem): React.ReactNode {
  switch (i.kind) {
    case "ticket":
      return (
        <>
          <Link href={`/maintenance/${i.ticketId}`} className={linkClass}>
            Problem #{i.reference} {i.title}
          </Link>
          <span className="text-mute">
            {" "}
            · {TICKET_STATUS[i.status] ?? i.status}
            {i.cost ? ` · ${moneyText(i.cost)}` : ""}
          </span>
        </>
      );
    case "bid":
      return (
        <>
          Quote for{" "}
          <Link href={`/maintenance/${i.ticketId}`} className={linkClass}>
            #{i.reference}
          </Link>
          <span className="text-mute">
            {i.amount ? ` · ${moneyText(i.amount)}` : ""} · {BID_STATUS[i.status] ?? i.status}
          </span>
        </>
      );
    case "upkeep":
      return (
        <>
          <Link href={`/repairs/upkeep/${i.taskId}`} className={linkClass}>
            {i.taskName}
          </Link>
          <span className="text-mute">
            {i.cost ? ` · ${moneyText(i.cost)}` : ""}
            {i.note ? ` · ${i.note}` : ""}
          </span>
        </>
      );
    case "payment":
      return (
        <>
          Paid {moneyText(i.amount)}
          <span className="text-mute">
            {i.account ? ` · ${i.account}` : ""}
            {i.memo ? ` · ${i.memo}` : ""}
          </span>
        </>
      );
    case "message":
      return (
        <>
          {DRAFT_KIND_LABEL[i.messageKind] ?? "Email"}
          <span className="text-mute">
            {" "}
            · {i.subject} · {i.status === "sent" ? "sent" : "draft"}
          </span>
        </>
      );
  }
}

/**
 * Insurance-spec §12 R-3: what a contractor's certificate should name, and
 * the Illinois rule behind it (765 ILCS 605/12(i)), quoted from the verified
 * citation. Illinois associations only, like every statute line in Walkup.
 */
function CertificateRule() {
  const c = CITATIONS.ICPA_12_I_COI;
  return (
    <p className="text-[12px] text-mute">
      Ask for a certificate naming {ADDITIONAL_INSUREDS} as additional insured parties. Illinois requires this for contracts over $10,000 a
      year (765 ILCS 605/12(i)): contractors &ldquo;{c.quote}&rdquo;.{" "}
      <a href={c.url} target="_blank" rel="noopener noreferrer" className={linkClass}>
        {actLinkText(c)}
      </a>
    </p>
  );
}
