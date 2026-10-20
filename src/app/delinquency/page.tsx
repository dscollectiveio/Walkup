import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Answer, Card } from "@/components/ui";
import { BoardOnly } from "@/components/board-only";
import { getViewer } from "@/lib/owner/viewer";
import { buildingTodayIso } from "@/lib/dates";
import { loadCollections } from "@/lib/collections/data";
import { sendConfig } from "@/lib/email-outbox/config";
import { OFF_STRIP, emailStatus, type SettingsRow } from "@/lib/email-outbox/status";
import { statusWords } from "@/lib/email-outbox/reasons";
import { KIND_LABEL, type EmailKind } from "@/lib/email-outbox/facts";
import { fromCents } from "@/lib/tax/form1120h";
import { formatMoney } from "@/lib/email-outbox/format";
import { PaymentForm } from "./payment-form";
import { CollectionsTable, type CollectionRow, type HistoryItem } from "./collections-table";

export const dynamic = "force-dynamic";

const HISTORY_PER_UNIT = 20;

export default async function CollectionsPage({ searchParams }: { searchParams: Promise<{ select?: string }> }) {
  const viewer = await getViewer();
  if (viewer && !viewer.isStaff) {
    return (
      <BoardOnly
        what="Collections"
        why="It lists every unit's balance, which is private to the board."
        alternative={{ label: "See your own balance", href: "/owner" }}
      />
    );
  }

  const supabase = await createClient();
  const today = buildingTodayIso();
  const isBoard = viewer?.isBoard === true;
  const associationId = viewer?.associationId;
  const data = associationId ? await loadCollections(supabase, associationId, today, { board: isBoard }) : null;

  const heading = (
    <div>
      <h1 className="text-[20px] font-bold tracking-tight text-ink">Collections</h1>
      <p className="mt-1 text-mute">Who is behind, for how long, and what has been sent.</p>
    </div>
  );

  if (!viewer || !data) {
    return (
      <div className="space-y-6">
        {heading}
        <Answer status="bad" headline="We couldn't load balances" detail="Reload the page. If it keeps happening, write to support." />
      </div>
    );
  }

  const { units, totals } = data;
  const sp = await searchParams;

  // Email status strip and history: board only (the outbox and settings are board-readable).
  let strip: { label: "Off" | "On" | "Suspended"; text: string | null } | null = null;
  const history: Record<string, HistoryItem[]> = {};
  if (isBoard) {
    const { data: settings } = await supabase
      .from("email_settings")
      .select("sending_enabled, enabled_at, daily_cap, suspended_at, suspended_reason")
      .maybeSingle();
    const status = emailStatus(sendConfig().ok, (settings as SettingsRow | null) ?? null);
    strip = status === "on" ? { label: "On", text: null } : status === "suspended" ? { label: "Suspended", text: null } : { label: "Off", text: OFF_STRIP };

    const ids = units.map((u) => u.unitId);
    if (ids.length) {
      const { data: rows } = await supabase
        .from("email_outbox")
        .select("unit_ids, kind, status, skip_reason, last_error, provider_message_id, sent_at, created_at")
        .overlaps("unit_ids", ids)
        .order("created_at", { ascending: false })
        .limit(400);
      for (const r of rows ?? []) {
        const item: HistoryItem = {
          date: ((r.sent_at ?? r.created_at) as string).slice(0, 10),
          kind: KIND_LABEL[r.kind as EmailKind] ?? String(r.kind),
          status: statusWords(r.status as string, {
            manual: String(r.provider_message_id ?? "").startsWith("manual:"),
            reason: r.skip_reason as string | null,
            error: r.last_error ? String(r.last_error).slice(0, 80) : null,
          }),
        };
        for (const unitId of r.unit_ids as string[]) {
          if (!history[unitId]) history[unitId] = [];
          if (history[unitId].length < HISTORY_PER_UNIT) history[unitId].push(item);
        }
      }
    }
  }

  const rows: CollectionRow[] = units.map((u) => {
    const waiting = u.suggestion.action === "wait";
    const call = u.suggestion.action === "call";
    return {
      unitId: u.unitId,
      label: u.label,
      ownerNames: u.ownerNames,
      chips: [!u.hasEmail ? "no email" : null, u.bounced ? "bounced" : null, u.optedOut ? "opted out" : null].filter((c): c is string => c !== null),
      aging: u.aging,
      owedCents: u.owedCents,
      overdueCents: u.overdueCents,
      daysOverdue: u.daysOverdue,
      lastReminderOn: u.lastReminderOn,
      lastResult: u.lastResult,
      suggestion: u.suggestion,
      selectable: !waiting && !call && u.suggestion.action !== "none",
      disabledReason: waiting || call ? u.suggestion.why : null,
      feeChargeId: u.openLateFeeChargeId,
      history: history[u.unitId] ?? [],
    };
  });

  const answer =
    units.length === 0 ? (
      <Answer status="good" headline="Nobody is behind" detail="Every unit is up to date." />
    ) : (
      <Answer
        status="attention"
        headline={`${formatMoney(fromCents(totals.owedCents))} is outstanding across ${units.length} unit${units.length === 1 ? "" : "s"}`}
        detail={`${formatMoney(fromCents(totals.overdueCents))} of it is past due.`}
      />
    );

  return (
    <div className="space-y-6">
      {heading}
      {answer}
      {units.length > 0 ? (
        <p className="-mt-3 text-[13px] text-mute">
          Unpaid dues are money earned but not received. They also lower the income your tax eligibility depends on; see the{" "}
          <Link href="/tax" className="underline underline-offset-2 hover:text-ink">
            Taxes
          </Link>{" "}
          page.
        </p>
      ) : null}

      {strip ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-paper px-4 py-3 text-[13px]">
          <span className="font-medium text-ink">Email from Walkup: {strip.label}</span>
          {strip.text ? <span className="text-mute">{strip.text}</span> : null}
          <Link href="/dues/email" className="ml-auto text-ink underline underline-offset-2">
            Set up
          </Link>
        </div>
      ) : null}

      {units.length > 0 ? (
        <>
          {isBoard ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start">
              <PaymentForm units={units.map((u) => ({ id: u.unitId, label: u.label, owed: u.owedCents / 100 }))} />
              <Link
                href="/dues/statements"
                className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-line-strong bg-paper px-4 py-2 text-[13px] font-medium text-ink hover:bg-fill"
              >
                Statements
              </Link>
            </div>
          ) : (
            <p className="text-[13px] text-mute">Preparing email is for the board.</p>
          )}

          <Card
            navy
            title="Overdue by unit"
            hint="Older balances are in the right-hand columns."
          >
            <p className="mb-4 text-[12px] text-mute">
              A late fee is only ever charged by the board, from the Dues page. A notice just tells the owner about a fee that is
              already posted. Check your declaration and bylaws before sending.
            </p>
            <CollectionsTable rows={rows} canPrepare={isBoard} preselect={sp.select ?? null} today={today} />
          </Card>
        </>
      ) : null}
    </div>
  );
}
