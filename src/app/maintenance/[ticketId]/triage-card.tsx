"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { retriageTicket, updateTicketDetails } from "@/app/maintenance/actions";
import { Card } from "@/components/ui";
import { StillWorking } from "@/components/repairs/sheet";
import { btnSecondary, errorClass } from "@/components/repairs/styles";
import { tradeLabel } from "@/lib/contractors/trades";
import { PRIORITY_LABEL, type TicketPriority } from "@/lib/repairs/labels";
import type { EmergencyKind } from "@/lib/repairs/emergency";
import type { StoredTriage } from "@/lib/repairs/validate";
import { PREFILL_NOTE_EVENT } from "./timeline";

/**
 * Walkup's suggestion (repairs-spec §7.5), board only: the AI's trade and
 * urgency for the report, with "Use this" when they differ from what the
 * problem has. The possible-emergency line lives on the next-step card; the
 * safety banner never comes from here.
 */

export interface TicketDetailsNow {
  title: string;
  description: string | null;
  where: string;
  location_detail: string | null;
  access_notes: string | null;
  priority: TicketPriority;
  trade: string | null;
  emergency_kind: EmergencyKind | null;
}

export function TriageCard(props: {
  ticketId: string;
  triage: StoredTriage | null;
  unreadable: boolean;
  /** No triage stored and the problem is under two minutes old. */
  justReported: boolean;
  aiConfigured: boolean;
  details: TicketDetailsNow;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [suggesting, setSuggesting] = useState(false);
  const t = props.triage;

  if (!props.aiConfigured && !t) return null;
  if (t?.state === "skipped" && t.reason === "not_configured") return null;

  const suggest = (label: string) => (
    <div className="space-y-1">
      <button
        type="button"
        className={btnSecondary}
        disabled={suggesting}
        onClick={() => {
          setSuggesting(true);
          setError(null);
          void retriageTicket(props.ticketId).then((r) => {
            setSuggesting(false);
            if ("error" in r) setError(r.error);
            else router.refresh();
          });
        }}
      >
        {suggesting ? "Suggesting…" : label}
      </button>
      {suggesting ? <StillWorking /> : null}
    </div>
  );

  const use = (change: Partial<TicketDetailsNow>) =>
    start(async () => {
      setError(null);
      const r = await updateTicketDetails(props.ticketId, {
        ...props.details,
        ...change,
        priorityReason: null,
        accessNotesWhenShared: null,
      });
      if ("error" in r) setError(r.error);
      else router.refresh();
    });

  let body: React.ReactNode;
  if (props.unreadable || t?.state === "failed") {
    body = (
      <>
        <p className="text-[14px] text-ink">We couldn&rsquo;t make a suggestion for this one.</p>
        {props.aiConfigured ? suggest("Try again") : null}
      </>
    );
  } else if (!t) {
    body = props.justReported ? (
      <p className="text-[14px] text-mute">Working out a suggestion…</p>
    ) : (
      <>
        <p className="text-[14px] text-mute">No suggestion was made for this one.</p>
        {suggest("Suggest now")}
      </>
    );
  } else if (t.state === "skipped" && t.reason === "quota") {
    body = <p className="text-[14px] text-ink">Suggestions are paused for today (daily limit reached). They&rsquo;ll be back tomorrow.</p>;
  } else if (t.state === "skipped" && t.reason === "reporter_limit") {
    body = (
      <>
        <p className="text-[14px] text-ink">No suggestion: this person reported several problems today.</p>
        {suggest("Suggest now")}
      </>
    );
  } else if (t.state === "done") {
    const trade = t.trade ?? null;
    const urgency = t.urgency ?? null;
    body = (
      <div className="space-y-3 text-[14px] text-ink">
        {trade ? (
          <div className="flex flex-wrap items-center gap-3">
            <p>
              Looks like {tradeLabel(trade)}
              {t.secondary_trade ? ` (and ${tradeLabel(t.secondary_trade)})` : ""}.
            </p>
            {trade !== props.details.trade ? (
              <button type="button" className={btnSecondary} disabled={pending} onClick={() => use({ trade })}>
                Use this
              </button>
            ) : null}
          </div>
        ) : null}
        {urgency ? (
          <div className="flex flex-wrap items-center gap-3">
            <p>Suggested urgency: {PRIORITY_LABEL[urgency]}</p>
            {urgency !== props.details.priority ? (
              <button type="button" className={btnSecondary} disabled={pending} onClick={() => use({ priority: urgency })}>
                Use this
              </button>
            ) : null}
          </div>
        ) : null}
        {t.summary ? <p className="text-[13px] text-mute">{t.summary}</p> : null}
        {t.questions && t.questions.length > 0 ? (
          <div>
            <ul className="list-disc space-y-1 pl-5 text-[13px]">
              {t.questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
            <button
              type="button"
              className={`mt-2 ${btnSecondary}`}
              onClick={() => window.dispatchEvent(new CustomEvent(PREFILL_NOTE_EVENT, { detail: t.questions!.join("\n") }))}
            >
              Ask the reporter
            </button>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <p className="text-[12px] text-mute">Suggested by AI from the report text. Check it.</p>
          {props.aiConfigured ? suggest("Suggest again") : null}
        </div>
      </div>
    );
  } else {
    body = (
      <>
        <p className="text-[14px] text-ink">We couldn&rsquo;t make a suggestion for this one.</p>
        {props.aiConfigured ? suggest("Try again") : null}
      </>
    );
  }

  return (
    <Card title="Walkup's suggestion">
      <div className="space-y-3">
        {body}
        {error ? <p className={errorClass}>{error}</p> : null}
      </div>
    </Card>
  );
}
