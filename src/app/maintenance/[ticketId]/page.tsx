import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Restricted } from "@/components/ui";
import { EntityDocuments } from "@/app/documents/entity-documents";
import { contractorsForTrade, EmergencyBanner } from "@/components/repairs/emergency-banner";
import { Pill, StagePill, StatusPill } from "@/components/repairs/pills";
import { EMERGENCY_RULES, type EmergencyKind } from "@/lib/repairs/emergency";
import { humanDate, whereLabel } from "@/lib/repairs/format";
import { isDone } from "@/lib/repairs/labels";
import { loadViewer, type RepairsViewer } from "@/lib/repairs/page-data";
import { possibleEmergency } from "@/lib/repairs/today";
import type { CloseOutProps } from "./close-out-dialog";
import { EditDetailsButton } from "./details-card";
import { DuplicateForm } from "./duplicate-form";
import { NotAnEmergency } from "./emergency-actions";
import { InsurancePrompt } from "./insurance-prompt";
import { loadTicketPage, tradeWords, type TicketPageData } from "./load";
import { MessagesCard } from "./messages-card";
import { MoneyCard } from "./money-card";
import { MoreAbout } from "./more-about";
import { NextStepCard } from "./next-step-card";
import { ConfirmBlock, MeTooButton, VisitFeedback } from "./owner-actions";
import { PhotosCard } from "./photos-card";
import { PlanCard } from "./plan-card";
import { QuotesCard } from "./quotes-card";
import { ReportedNotice } from "./reported-notice";
import { TicketDialogs } from "./ticket-dialogs";
import { Timeline } from "./timeline";
import { TriageCard, type TicketDetailsNow } from "./triage-card";

export const dynamic = "force-dynamic";
// Retriage, reading a quote and photo uploads run from this page.
export const maxDuration = 300;

const TITLE_ID = "ticket-title";
const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] || null;

/**
 * One problem (repairs-spec §5.3 board and accountant, §14.2 owners). The
 * URL stays /maintenance/[ticketId] because insurance claims and older
 * pages link here.
 */
export default async function TicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ ticketId: string }>;
  searchParams: Promise<{ reported?: string; failed?: string; open?: string }>;
}) {
  const [{ ticketId }, sp] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const viewer = await loadViewer(supabase);
  if (!viewer || !viewer.isMember || !/^[0-9a-f-]{36}$/i.test(ticketId)) return <Restricted what="this problem" />;
  const data = await loadTicketPage(supabase, ticketId, viewer);
  if (!data) return <Restricted what="this problem" />;

  const reported = sp.reported === "1";
  const failed = Math.max(0, Math.min(20, Number(sp.failed) || 0));
  const done = data.ticket.status === "resolved" || data.ticket.status === "closed";
  // "Mark fixed" only makes sense on a problem that is still open.
  const open = sp.open === "quotes" || (sp.open === "fix" && !done) || sp.open === "go-ahead" ? sp.open : null;

  if (!viewer.staffView) return <OwnerView data={data} viewer={viewer} reported={reported} failed={failed} />;

  const [{ data: units }, auth] = await Promise.all([
    viewer.canManage ? supabase.from("units").select("id, label").order("sort_order") : Promise.resolve({ data: [] as { id: string; label: string }[] }),
    viewer.canManage ? supabase.auth.getUser() : Promise.resolve(null),
  ]);
  return (
    <BoardView
      data={data}
      viewer={viewer}
      reported={reported}
      failed={failed}
      open={viewer.canManage ? open : null}
      units={(units ?? []).map((u) => ({ id: u.id as string, label: u.label as string }))}
      senderEmail={auth?.data?.user?.email ?? null}
    />
  );
}

function Header(props: { data: TicketPageData; viewer: RepairsViewer; meta: string; pills: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div>
      <Link href="/repairs?view=problems" className="inline-flex min-h-[44px] items-center text-[13px] text-mute hover:underline">
        ← All problems
      </Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 id={TITLE_ID} tabIndex={-1} className="text-[20px] font-bold tracking-tight text-ink outline-none">
            {props.data.ticket.title}
          </h1>
          <p className="mt-1 text-[13px] text-mute">{props.meta}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">{props.pills}</div>
        </div>
        {props.actions ? <div className="shrink-0">{props.actions}</div> : null}
      </div>
    </div>
  );
}

function Reported(props: { data: TicketPageData; failed: number }) {
  const t = props.data.ticket;
  return (
    <ReportedNotice
      reference={t.reference}
      failed={props.failed}
      urgent={t.priority === "urgent" || t.emergencyKind !== null}
      contacts={props.data.emergency?.contacts ?? []}
      titleId={TITLE_ID}
    />
  );
}

function WhatWasReported({ data }: { data: TicketPageData }) {
  const t = data.ticket;
  return (
    <Card navy title="What was reported">
      <div className="space-y-3 text-[14px]">
        {t.description ? <p className="whitespace-pre-wrap leading-relaxed text-ink">{t.description}</p> : <p className="text-mute">No details were given.</p>}
        {t.locationDetail ? (
          <p className="text-ink">
            <span className="text-mute">Where exactly: </span>
            {t.locationDetail}
          </p>
        ) : null}
        {t.accessNotes ? (
          <div>
            <p className="text-ink">
              <span className="text-mute">Access and timing: </span>
              {t.accessNotes}
            </p>
            <p className="mt-1 text-[12px] text-mute">Anyone who can see this problem can read this.</p>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function WhatWasDone({ data, todayIso }: { data: TicketPageData; todayIso: string }) {
  const t = data.ticket;
  if (!isDone(t.status) || !t.resolutionNote) return null;
  return (
    <Card navy title="What was done">
      <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{t.resolutionNote}</p>
      {t.resolvedAt ? (
        <p className="mt-2 text-[12px] text-mute">
          {t.status === "closed" ? "Closed" : "Fixed"} {humanDate(t.resolvedAt.slice(0, 10), todayIso)}
        </p>
      ) : null}
    </Card>
  );
}

function DuplicateLine({ data }: { data: TicketPageData }) {
  const d = data.ticket.duplicateOf;
  if (!d) return null;
  return (
    <p className="border-l-[3px] border-line-strong bg-fill px-4 py-3 text-[14px] text-ink">
      Closed as a duplicate of{" "}
      {d.id ? (
        <Link href={`/maintenance/${d.id}`} className="underline underline-offset-2">
          #{d.reference}
        </Link>
      ) : d.reference ? (
        `#${d.reference}`
      ) : (
        "another problem"
      )}
      .
    </p>
  );
}

function BoardView(props: {
  data: TicketPageData;
  viewer: RepairsViewer;
  reported: boolean;
  failed: number;
  open: string | null;
  units: { id: string; label: string }[];
  senderEmail: string | null;
}) {
  const { data, viewer } = props;
  const t = data.ticket;
  const b = data.board;
  const today = viewer.todayIso;
  const canWrite = viewer.canManage;
  const done = isDone(t.status);
  const where = whereLabel(t.unitLabel, t.locationDetail);
  const people = data.meTooCount > 0 ? ` · ${data.meTooCount + 1} people reported this` : "";
  const reporter = data.reporterName ? `Reported by ${data.reporterName}` : "Reported";
  const meta = `#${t.reference} · ${where} · ${tradeWords(t.trade)} · ${reporter} ${humanDate(t.openedOn, today)}${people}`;
  const accepted = data.bids.find((x) => x.status === "accepted") ?? null;
  const suggestion = b && !done
    ? (possibleEmergency({
        emergency_kind: t.emergencyKind,
        triage_emergency: b.triage?.state === "done" ? (b.triage.emergency ?? null) : null,
        triage_at: b.triage?.at ?? null,
        emergency_suggestion_dismissed_at: b.emergencySuggestionDismissedAt,
      }) as EmergencyKind | null)
    : null;
  const reporterFirst = firstName(data.reporterName);
  const confirmer = t.reportedBy && t.reportedBy !== viewer.personId && !data.reporterIsBoard ? (reporterFirst ?? "The reporter") : null;
  const details: TicketDetailsNow = {
    title: t.title,
    description: t.description,
    where: t.unitId ?? "shared",
    location_detail: t.locationDetail,
    access_notes: t.accessNotes,
    priority: t.priority,
    trade: t.trade,
    emergency_kind: t.emergencyKind,
  };
  const contractor = data.assignedVendor
    ? { id: data.assignedVendor.id, name: data.assignedVendor.name, phone: data.assignedVendor.phone, email: data.assignedVendor.email }
    : null;
  const live = data.bids.filter((x) => x.status !== "withdrawn");
  const closeOut: Omit<CloseOutProps, "open" | "onClose" | "ticketId"> = {
    todayIso: today,
    defaultCost: accepted?.amount ?? b?.estimatedCost ?? null,
    upkeepTaskName: t.upkeepTaskName,
    confirmerFirstName: confirmer,
  };
  const emergencyTrade = t.emergencyKind ? (EMERGENCY_RULES.find((r) => r.kind === t.emergencyKind)?.trade ?? null) : null;

  const pills = (
    <>
      <StagePill stage={data.stage} />
      {t.emergencyKind ? <Pill tone="bad">Emergency</Pill> : t.priority === "urgent" ? <Pill tone="bad">Urgent</Pill> : null}
      {b?.dueOn ? <Pill tone={b.dueOn < today && !done ? "warning" : "outline"}>Due {humanDate(b.dueOn, today)}</Pill> : null}
    </>
  );

  return (
    <TicketDialogs
      ticketId={t.id}
      trade={t.trade}
      candidates={data.quoteCandidates}
      bids={data.bids}
      photos={data.photos.map((p) => ({ documentId: p.documentId }))}
      senderEmail={props.senderEmail}
      everyone={data.vendors.filter((v) => !v.archived && v.status !== "do_not_use").map((v) => ({ id: v.id, name: v.name }))}
      aiConfigured={data.aiConfigured}
      closeOut={closeOut}
      initialOpen={props.open}
    >
      <div className="space-y-6">
        <Header
          data={data}
          viewer={viewer}
          meta={meta}
          pills={pills}
          actions={canWrite ? <EditDetailsButton ticketId={t.id} details={details} units={props.units} reporterFirstName={data.reporterIsBoard ? null : reporterFirst} /> : null}
        />
        {props.reported ? <Reported data={data} failed={props.failed} /> : null}
        <DuplicateLine data={data} />

        {t.emergencyKind && !done ? (
          <EmergencyBanner
            kind={t.emergencyKind}
            building={data.emergency?.building ?? null}
            boardContractors={canWrite && emergencyTrade ? contractorsForTrade(data.emergencyContractors, emergencyTrade) : undefined}
          >
            {canWrite ? <NotAnEmergency ticketId={t.id} /> : null}
          </EmergencyBanner>
        ) : null}

        <NextStepCard
          ticketId={t.id}
          stage={data.stage}
          canWrite={canWrite}
          todayIso={today}
          isUnitTicket={t.unitId !== null}
          resolvedAt={t.resolvedAt}
          scheduledFor={t.scheduledFor}
          scheduledWindow={t.scheduledWindow}
          quotes={{ received: data.bidCounts.received, asked: live.length }}
          contractor={contractor}
          reporterFirstName={reporterFirst}
          possibleEmergency={suggestion}
          closeKeep={{ actualCost: b?.actualCost ?? null, expenseId: b?.expenseId ?? null }}
        />

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-6">
            <WhatWasReported data={data} />
            <WhatWasDone data={data} todayIso={today} />
          </div>
          <PhotosCard ticketId={t.id} photos={data.photos} canAdd={canWrite && !done} sharedTicket={t.unitId === null} />
        </div>

        <PlanCard
          ticketId={t.id}
          canWrite={canWrite}
          todayIso={today}
          plan={{
            assignedVendorId: t.assignedVendorId,
            assigneePersonId: b?.assigneePersonId ?? null,
            scheduledFor: t.scheduledFor,
            scheduledWindow: t.scheduledWindow,
            dueOn: b?.dueOn ?? null,
            estimatedCost: b?.estimatedCost ?? null,
          }}
          vendors={data.vendors}
          people={data.boardPeople}
          notice={{ title: t.title, where, isUnitTicket: t.unitId !== null, basics: data.draftBasics }}
        />

        {data.bids.length > 0 ? <QuotesCard ticketId={t.id} bids={data.bids} vendors={data.vendors} canWrite={canWrite} todayIso={today} /> : null}

        <Timeline
          ticketId={t.id}
          entries={data.timeline}
          todayIso={today}
          title="Timeline"
          canNote={canWrite}
          isBoard={canWrite}
          isAdmin={viewer.isAdmin}
          contractor={contractor ? { id: contractor.id, name: contractor.name } : null}
        />

        <MoreAbout>
          <MoneyCard
            ticketId={t.id}
            status={t.status}
            canWrite={canWrite}
            todayIso={today}
            estimatedCost={b?.estimatedCost ?? null}
            actualCost={b?.actualCost ?? null}
            expenseId={b?.expenseId ?? null}
            expense={b?.expense ?? null}
            capitalizationThreshold={data.capitalizationThreshold}
          />
          <InsurancePrompt
            ticketId={t.id}
            todayIso={today}
            canWrite={canWrite}
            trade={t.trade}
            emergencyKind={t.emergencyKind}
            estimatedCost={b?.estimatedCost ?? null}
            actualCost={b?.actualCost ?? null}
            claims={data.claims}
            policy={data.policy}
          />
          <MessagesCard messages={data.messages} todayIso={today} canWrite={canWrite} />
          <div id="documents" className="scroll-mt-20">
            <Card navy title="Documents" hint="Quotes and other files for this problem. Photos are in their own card.">
              <EntityDocuments targetTable="tickets" targetId={t.id} documents={data.documents} canWrite={canWrite} />
            </Card>
          </div>
          {canWrite ? (
            <TriageCard
              ticketId={t.id}
              triage={b?.triage ?? null}
              unreadable={b?.triageUnreadable ?? false}
              justReported={data.justReported}
              aiConfigured={data.aiConfigured}
              details={details}
            />
          ) : null}
          {canWrite && !t.duplicateOf ? <DuplicateForm ticketId={t.id} /> : null}
        </MoreAbout>
      </div>
    </TicketDialogs>
  );
}

function OwnerView(props: { data: TicketPageData; viewer: RepairsViewer; reported: boolean; failed: number }) {
  const { data, viewer } = props;
  const t = data.ticket;
  const today = viewer.todayIso;
  const done = isDone(t.status);
  const iReported = Boolean(viewer.personId && t.reportedBy === viewer.personId);
  const meta = `#${t.reference} · ${whereLabel(t.unitLabel, t.locationDetail)} · reported ${humanDate(t.openedOn, today)}`;
  const name = data.contractorName;
  const visit = t.scheduledFor ? `Visit planned for ${humanDate(t.scheduledFor, today)}${t.scheduledWindow ? `, ${t.scheduledWindow}` : ""}.` : null;
  let handling: string;
  if (name && (t.status === "in_progress" || t.status === "waiting_on_contractor" || t.scheduledFor)) {
    handling = `${name} is handling this.${visit ? ` ${visit}` : ""}`;
  } else if (name && t.status === "open") {
    handling = `The board chose ${name} for this.`;
  } else {
    handling = done ? "" : "The board hasn't picked a contractor yet.";
  }
  if (!handling && visit) handling = visit;

  return (
    <div className="space-y-6">
      <Header
        data={data}
        viewer={viewer}
        meta={meta}
        pills={
          <>
            <StatusPill status={t.status} />
            {t.priority === "urgent" ? <Pill tone="bad">Urgent</Pill> : null}
          </>
        }
        actions={
          t.unitId === null && !iReported && !done && viewer.canReport ? <MeTooButton ticketId={t.id} already={data.iSaidMeToo} /> : null
        }
      />
      {props.reported ? <Reported data={data} failed={props.failed} /> : null}
      <DuplicateLine data={data} />
      {t.emergencyKind && !done ? (
        <EmergencyBanner kind={t.emergencyKind} building={data.emergency?.building ?? null} contacts={data.emergency?.contacts ?? []} />
      ) : null}
      <WhatWasReported data={data} />
      <PhotosCard ticketId={t.id} photos={data.photos} canAdd={viewer.canReport && !done} sharedTicket={t.unitId === null} />
      {handling ? (
        <Card navy title="Who's handling it">
          <p className="text-[14px] text-ink">{handling}</p>
        </Card>
      ) : null}
      <WhatWasDone data={data} todayIso={today} />
      {iReported && t.status === "resolved" && t.resolvedAt ? <ConfirmBlock ticketId={t.id} resolvedAt={t.resolvedAt} todayIso={today} /> : null}
      {iReported && done && !data.feedbackSent && (t.assignedVendorId || t.scheduledFor) ? <VisitFeedback ticketId={t.id} /> : null}
      <Timeline
        ticketId={t.id}
        entries={data.timeline}
        todayIso={today}
        title="Updates"
        canNote={viewer.canReport}
        isBoard={false}
        isAdmin={false}
        contractor={null}
      />
      <p className="text-[13px]">
        <Link href="/repairs/emergency-info" className="underline underline-offset-2">
          What to do in an emergency
        </Link>
      </p>
    </div>
  );
}
