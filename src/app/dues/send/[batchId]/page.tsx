import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Answer, Card } from "@/components/ui";
import { BoardOnly } from "@/components/board-only";
import { getViewer } from "@/lib/owner/viewer";
import { buildingTodayIso } from "@/lib/dates";
import { LEGAL_ADDRESS, LEGAL_ENTITY, SITE_URL, legalAddressIsSet } from "@/lib/site-config";
import { DEFAULT_FROM_ADDRESS, notConfiguredCopy, sendConfig } from "@/lib/email-outbox/config";
import { displayNameFor } from "@/lib/email-outbox/sanitize";
import { isUuid } from "@/lib/email-outbox/actions-core";
import { emailStatus, type SettingsRow } from "@/lib/email-outbox/status";
import { skipReasonWords } from "@/lib/email-outbox/reasons";
import { leftOutSentence, resultSentence, reviewHeading, REVIEW_SUBLINE, summarizeBatch } from "@/lib/email-outbox/review";
import type { EmailKind } from "@/lib/email-outbox/facts";
import { render, type RenderContext } from "@/lib/email-outbox/templates";
import { ApproveBar } from "./approve-bar";
import { ManualDrafts, type ManualDraft } from "./manual-drafts";
import { ProgressCard } from "./progress-card";
import { ReviewList, type DraftView } from "./review-list";

export const dynamic = "force-dynamic";
// The Send click runs the sender in the background of this route; give it room (a couple of emails a second).
export const maxDuration = 300;

type Row = {
  id: string;
  person_id: string;
  kind: EmailKind;
  to_email: string;
  to_name: string | null;
  unit_ids: string[];
  facts: unknown;
  board_note: string | null;
  template_key: string;
  template_version: number;
  status: string;
  skip_reason: string | null;
  last_error: string | null;
  provider_message_id: string | null;
  created_at: string;
};

const FOOTER_SPLIT = "\n\n--\n";

function Message({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="space-y-6">
      <Answer status="neutral" headline={title} detail={detail} />
      <Link href="/delinquency" className="text-[13px] text-ink underline underline-offset-2">
        Back to Collections
      </Link>
    </div>
  );
}

export default async function ReviewPage({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const viewer = await getViewer();
  if (!viewer || !viewer.isBoard) {
    return (
      <BoardOnly
        what="Reviewing emails"
        why="It is where the board checks each email before it goes out."
        alternative={{ label: "See your own balance", href: "/owner" }}
      />
    );
  }
  if (!isUuid(batchId)) return <Message title="This batch isn't available" detail="It may have been removed, or the link is wrong." />;

  const supabase = await createClient();
  const { data: batch } = await supabase
    .from("email_batches")
    .select("id, kind, status, source, period_start, period_end, approved_at, created_at")
    .eq("id", batchId)
    .maybeSingle();
  if (!batch) return <Message title="This batch isn't available" detail="It may have been removed, or the link is wrong." />;

  const [{ data: rowData, error: rowError }, { data: assoc }, { data: settings }] = await Promise.all([
    supabase
      .from("email_outbox")
      .select("id, person_id, kind, to_email, to_name, unit_ids, facts, board_note, template_key, template_version, status, skip_reason, last_error, provider_message_id, created_at")
      .eq("batch_id", batchId)
      .order("to_email"),
    supabase.from("associations").select("display_name, board_contact_name, board_contact_email").limit(1),
    supabase.from("email_settings").select("sending_enabled, enabled_at, daily_cap, suspended_at, suspended_reason").maybeSingle(),
  ]);
  if (rowError) {
    return <Message title="We couldn't load these emails" detail="Reload the page. If it keeps happening, write to support." />;
  }
  const rows = (rowData ?? []) as unknown as Row[];
  const a = assoc?.[0];
  const associationName = (a?.display_name as string) || "your association";
  const replyName = (a?.board_contact_name as string | null)?.trim() || "The board";
  const replyEmail = (a?.board_contact_email as string | null) ?? "";
  const kind = batch.kind as EmailKind;

  const config = sendConfig();
  const status = emailStatus(config.ok, (settings as SettingsRow | null) ?? null);
  const summary = summarizeBatch(rows);
  const isDraftBatch = batch.status === "draft";
  const today = buildingTodayIso();

  // Who has a login, and the announcement text, for the preview.
  const personIds = [...new Set(rows.map((r) => r.person_id))];
  const { data: people } = personIds.length ? await supabase.from("persons").select("id, auth_user_id").in("id", personIds) : { data: [] };
  const hasLogin = new Map((people ?? []).map((p) => [p.id as string, Boolean(p.auth_user_id)]));
  let announcement: { title: string; body: string; hasAttachment: boolean } | undefined;
  if (kind === "announcement") {
    const first = rows.find((r) => r.facts && typeof r.facts === "object" && "announcement_id" in (r.facts as object));
    const id = (first?.facts as { announcement_id?: string } | undefined)?.announcement_id;
    if (id) {
      const { data } = await supabase.from("announcements").select("title, body, attachment_document_id").eq("id", id).maybeSingle();
      if (data) announcement = { title: data.title as string, body: data.body as string, hasAttachment: Boolean(data.attachment_document_id) };
    }
  }

  const ctxFor = (r: Row): RenderContext => ({
    associationName,
    replyToName: replyName,
    replyToEmail: replyEmail,
    recipientFirstName: (r.to_name ?? "").trim().split(/\s+/)[0] || "there",
    hasLogin: hasLogin.get(r.person_id) === true,
    siteUrl: SITE_URL,
    unsubscribeUrl: `${SITE_URL}/unsubscribe/your-personal-link`,
    legalEntity: LEGAL_ENTITY,
    legalAddress: legalAddressIsSet ? LEGAL_ADDRESS : "Walkup's mailing address",
    boardNote: r.board_note,
    todayIso: today,
  });
  const renderRow = (r: Row) => {
    try {
      return render(r.kind, r.template_key, r.template_version, r.facts, ctxFor(r), announcement ? { announcement } : undefined);
    } catch {
      return null;
    }
  };

  const unitLabelsById = new Map<string, string>();
  const { data: unitRows } = await supabase.from("units").select("id, label");
  for (const u of unitRows ?? []) unitLabelsById.set(u.id as string, u.label as string);

  const draftRows = rows.filter((r) => r.status === "draft");
  const drafts: DraftView[] = draftRows.map((r) => {
    const rendered = renderRow(r);
    return {
      id: r.id,
      name: r.to_name ?? r.to_email,
      email: r.to_email,
      units: r.unit_ids.map((id) => unitLabelsById.get(id) ?? "A unit").join(", "),
      subject: rendered?.subject ?? "",
      preview: rendered?.text ?? "",
      note: r.board_note ?? "",
      previewError: rendered === null,
    };
  });
  const leftOut = rows.filter((r) => r.status === "skipped" || (r.status === "cancelled" && r.skip_reason === "left_out"));

  // Without Walkup sending: drafts for the board's own mail app.
  const canSendFromWalkup = config.ok && status === "on";
  const blockedReason = !config.ok
    ? notConfiguredCopy(config.reason)
    : status === "suspended"
      ? `Sending is paused by Walkup. ${(settings?.suspended_reason as string | null) ?? "Contact support."}`
      : status !== "on"
        ? "Turn on sending on the Email page first."
        : null;
  const manualDrafts: ManualDraft[] = [...draftRows, ...rows.filter((r) => r.status === "sent" && String(r.provider_message_id ?? "").startsWith("manual:"))].map((r) => {
    const rendered = renderRow(r);
    const body = (rendered?.text ?? "").split(FOOTER_SPLIT)[0];
    return {
      id: r.id,
      email: r.to_email,
      name: `${r.to_name ?? r.to_email}${r.unit_ids.length ? ` (${r.unit_ids.map((id) => unitLabelsById.get(id) ?? "unit").join(", ")})` : ""}`,
      subject: rendered?.subject ?? "",
      body,
      sent: r.status === "sent",
      pdfs: (rendered?.attachments ?? []).map((att) => ({
        label: `Download ${att.filename}`,
        href: `/statements/${att.unitId}/pdf?from=${att.from}&to=${att.to}`,
      })),
    };
  });

  const approvedLongAgo = batch.approved_at ? new Date().getTime() - Date.parse(batch.approved_at as string) > 2 * 60_000 : false;
  const failures = rows
    .filter((r) => r.status === "failed")
    .map((r) => ({ name: r.to_name ?? r.to_email, error: r.last_error ?? "Not sent" }));

  const fromAddress = config.ok ? config.from : DEFAULT_FROM_ADDRESS;
  const lateFeeChargeId =
    kind === "late_fee_notice" ? ((rows.find((r) => r.facts && typeof r.facts === "object")?.facts as { fee_charge_id?: string } | undefined)?.fee_charge_id ?? null) : null;
  const sentence = leftOutSentence(summary);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">{reviewHeading(kind)}</h1>
        <p className="mt-1 text-mute">{REVIEW_SUBLINE}</p>
      </div>

      {batch.status === "cancelled" ? (
        <Answer status="neutral" headline="This batch was cancelled" detail="Nothing was sent. Prepare it again from Collections if you still need to." />
      ) : isDraftBatch ? (
        summary.ready > 0 ? (
          <Answer status="neutral" headline={`${summary.ready} email${summary.ready === 1 ? "" : "s"} ready`} detail={sentence ?? undefined} />
        ) : (
          <Answer
            status="neutral"
            headline="Nobody to email"
            detail="Everyone in this list was left out. See why below, or write to them yourself."
          />
        )
      ) : (
        <ProgressCard
          batchId={batchId}
          waiting={summary.waiting}
          done={summary.done}
          total={summary.total}
          result={resultSentence(summary)}
          canResume={viewer.isBoardAdmin && config.ok && approvedLongAgo}
          failures={failures}
        />
      )}

      {kind === "late_fee_notice" && lateFeeChargeId ? (
        <p className="text-[13px] text-mute">
          Prefer to post it? <a href={`/statements/late-fee/${lateFeeChargeId}/pdf`} className="text-ink underline underline-offset-2">Download as a letter</a> to print and mail by hand.
        </p>
      ) : null}

      {isDraftBatch && canSendFromWalkup ? (
        <p className="text-[13px] text-mute">
          From: {displayNameFor(associationName)} &lt;{fromAddress}&gt;. Replies go to {replyName} &lt;{replyEmail}&gt;.
        </p>
      ) : null}

      {isDraftBatch && summary.ready > 0 ? (
        canSendFromWalkup ? (
          <>
            <ReviewList drafts={drafts} editable />
            <ApproveBar batchId={batchId} ready={summary.ready} isAdmin={viewer.isBoardAdmin} blockedReason={blockedReason} />
          </>
        ) : (
          <>
            <Card
              navy
              title="Send these from your own email"
              hint={blockedReason ?? undefined}
            >
              <p className="text-[13px] text-mute">
                Each draft opens in your own email app. After you send it, press Mark as sent so the history stays right.
              </p>
            </Card>
            <ManualDrafts drafts={manualDrafts} />
            <div>
              <Link href="/delinquency" className="text-[13px] text-ink underline underline-offset-2">
                Back to Collections
              </Link>
            </div>
          </>
        )
      ) : null}

      {!isDraftBatch && manualDrafts.length > 0 ? <ManualDrafts drafts={manualDrafts} /> : null}

      {leftOut.length > 0 ? (
        <Card navy title="Left out">
          <ul className="divide-y divide-line text-[13px]">
            {leftOut.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2">
                <span className="text-ink">
                  {r.to_name ?? "Owner"}
                  {r.unit_ids.length ? <span className="text-mute"> ({r.unit_ids.map((id) => unitLabelsById.get(id) ?? "unit").join(", ")})</span> : null}
                </span>
                <span className="text-mute">{skipReasonWords(r.skip_reason)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
