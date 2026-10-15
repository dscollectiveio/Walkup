"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { shortDate } from "@/lib/dates";
import { coverageShort } from "@/lib/insurance/coverage";
import { setFollowUp, setQuoteRequestStatus } from "../request-actions";
import { ImportUploader } from "../components/insurance-uploader";
import { Sheet, SheetFooter } from "../components/sheet";
import { Chip } from "../components/status-chip";
import { btnGhost, btnPrimary, errorBlock, inputClass, labelClass } from "../components/styles";
import type { RequestRow } from "../quotes-data";
import { canFollowUp, followUpOpensOn, requestChip } from "../quote-helpers";
import { openMessage } from "./message-list";

/**
 * Quote requests grouped by contact (§9.7 item 2, §9.11), with what the board
 * can do next for each status. Accountants see the rows without buttons.
 */

const small = "inline-flex min-h-[44px] items-center justify-center rounded-md border border-line-strong bg-paper px-3 text-[12px] font-medium text-ink hover:bg-fill disabled:opacity-50";

export function RequestRows({
  requests,
  canEdit,
  aiOn,
  todayIso,
  grouped = true,
}: {
  requests: RequestRow[];
  canEdit: boolean;
  aiOn: boolean;
  todayIso: string;
  /** False on a contact's own page, where every row is that contact. */
  grouped?: boolean;
}) {
  const groups = new Map<string, RequestRow[]>();
  for (const r of requests) {
    const k = r.contact_id ?? r.partner_id ?? r.id;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return (
    <div className="space-y-4">
      {[...groups.values()].map((rows) => (
        <div key={rows[0].id}>
          {grouped ? (
            <h3 className="text-[13px] font-medium text-ink">
              {rows[0].contact_id ? (
                <Link href={`/insurance/contacts/${rows[0].contact_id}`} className="underline-offset-2 hover:underline">
                  {rows[0].contactName}
                </Link>
              ) : (
                rows[0].contactName
              )}
            </h3>
          ) : null}
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <RequestRowItem key={r.id} r={r} canEdit={canEdit} aiOn={aiOn} todayIso={todayIso} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function RequestRowItem({ r, canEdit, aiOn, todayIso }: { r: RequestRow; canEdit: boolean; aiOn: boolean; todayIso: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dialog, setDialog] = useState<"decline" | "follow" | null>(null);
  const chip = requestChip(r.status, r.sent_at, todayIso);
  const first = r.coverages[0] ?? null;
  const enterHref = `/insurance/quotes/new?request=${r.id}${r.contact_id ? `&contact=${r.contact_id}` : ""}${first ? `&coverage=${first}` : ""}`;

  const act = (fn: () => Promise<{ ok: true } | { error: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if ("error" in res) setError(res.error);
      else router.refresh();
    });

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {r.coverages.map((c) => (
          <span key={c} className="rounded-full bg-fill px-2.5 py-0.5 text-[11px] text-ink">
            {coverageShort(c)}
          </span>
        ))}
        <Chip tone={chip.tone}>{chip.text}</Chip>
        {r.follow_up_on && (r.status === "sent" || r.status === "draft") ? (
          <span className="text-[12px] text-mute">Follow up {shortDate(r.follow_up_on, todayIso)}</span>
        ) : null}
        {r.status === "declined" && r.declined_reason ? <span className="text-[12px] text-mute">&ldquo;{r.declined_reason}&rdquo;</span> : null}
      </div>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          {r.status === "draft" && r.draftMessageId ? (
            <button type="button" className={small} onClick={() => openMessage(r.draftMessageId as string)}>
              Open draft
            </button>
          ) : null}
          {r.status === "sent" ? (
            <>
              <button type="button" className={small} aria-expanded={uploading} onClick={() => setUploading((u) => !u)}>
                Upload the quote
              </button>
              <Link href={enterHref} className={small}>
                Enter the quote
              </Link>
              {canFollowUp(r.sent_at, todayIso) ? (
                <Link href={`/insurance/emails/new?kind=quote_follow_up&request=${r.id}${r.contact_id ? `&contact=${r.contact_id}` : ""}`} className={small}>
                  Write a follow-up
                </Link>
              ) : r.sent_at ? (
                <button type="button" className={small} disabled>
                  Follow-up available {shortDate(followUpOpensOn(r.sent_at), todayIso)}
                </button>
              ) : null}
              <button type="button" className={small} onClick={() => setDialog("decline")}>
                Mark declined
              </button>
              <button type="button" className={small} onClick={() => setDialog("follow")}>
                Set a follow-up date
              </button>
            </>
          ) : null}
          {r.status === "quote_received" ? (
            <>
              {r.quoteId ? (
                <Link href={`/insurance/quotes/${r.quoteId}`} className={small}>
                  See the quote
                </Link>
              ) : null}
              <Link href={enterHref} className={small}>
                Add another quote
              </Link>
            </>
          ) : null}
          {r.status === "declined" || r.status === "expired" ? (
            <button type="button" className={small} disabled={pending} onClick={() => act(() => setQuoteRequestStatus(r.id, "sent"))}>
              {pending ? "Saving…" : "Reopen"}
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? <p className={errorBlock}>{error}</p> : null}
      {uploading ? (
        <div className="rounded-lg border border-line px-4 py-3">
          <ImportUploader
            aiOn={aiOn}
            mode="quote"
            quoteRequestId={r.id}
            manualHref={`/insurance/quotes/new?document={id}&request=${r.id}${r.contact_id ? `&contact=${r.contact_id}` : ""}`}
            label="Choose the quote"
          />
        </div>
      ) : null}
      {dialog === "decline" ? <DeclineRequest requestId={r.id} onClose={() => setDialog(null)} /> : null}
      {dialog === "follow" ? <FollowUpDate requestId={r.id} current={r.follow_up_on} onClose={() => setDialog(null)} /> : null}
    </li>
  );
}

function DeclineRequest({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const router = useRouter();
  const p = useId();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  return (
    <Sheet open onClose={onClose} label="Mark the request declined">
      <div className="flex h-full flex-col">
        <div className="flex-1 space-y-3 px-5 py-5">
          <h2 className="text-[16px] font-bold tracking-tight text-ink">Mark this request declined</h2>
          <p className="text-[13px] text-mute">For when the agency says it won&rsquo;t quote. You can reopen it later.</p>
          <div>
            <label htmlFor={`${p}-reason`} className={labelClass}>
              Reason <span className="font-normal text-mute-soft">optional</span>
            </label>
            <textarea id={`${p}-reason`} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} />
          </div>
        </div>
        <SheetFooter error={error}>
          <button type="button" className={btnGhost} onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button
            type="button"
            className={btnPrimary}
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await setQuoteRequestStatus(requestId, "declined", { declinedReason: reason.trim() || undefined });
                if ("error" in r) setError(r.error);
                else {
                  router.refresh();
                  onClose();
                }
              })
            }
          >
            {pending ? "Saving…" : "Mark declined"}
          </button>
        </SheetFooter>
      </div>
    </Sheet>
  );
}

function FollowUpDate({ requestId, current, onClose }: { requestId: string; current: string | null; onClose: () => void }) {
  const router = useRouter();
  const p = useId();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [on, setOn] = useState(current ?? "");
  const save = (value: string | null) =>
    start(async () => {
      setError(null);
      const r = await setFollowUp(requestId, value);
      if ("error" in r) setError(r.error);
      else {
        router.refresh();
        onClose();
      }
    });
  return (
    <Sheet open onClose={onClose} label="Set a follow-up date">
      <div className="flex h-full flex-col">
        <div className="flex-1 space-y-3 px-5 py-5">
          <h2 className="text-[16px] font-bold tracking-tight text-ink">Set a follow-up date</h2>
          <p className="text-[13px] text-mute">A reminder for the board. Walkup doesn&rsquo;t write to the agency.</p>
          <div>
            <label htmlFor={`${p}-on`} className={labelClass}>
              Follow up on
            </label>
            <input id={`${p}-on`} type="date" value={on} onChange={(e) => setOn(e.target.value)} className={inputClass} />
          </div>
        </div>
        <SheetFooter error={error}>
          {current ? (
            <button type="button" className={btnGhost} onClick={() => save(null)} disabled={pending}>
              Clear the date
            </button>
          ) : null}
          <button type="button" className={btnGhost} onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={pending || !on} onClick={() => save(on)}>
            {pending ? "Saving…" : "Save"}
          </button>
        </SheetFooter>
      </div>
    </Sheet>
  );
}
