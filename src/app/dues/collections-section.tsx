import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Answer } from "@/components/ui";
import { buildingTodayIso } from "@/lib/dates";
import type { CollectionsData } from "@/lib/collections/data";
import { OFF_STRIP, emailStatus, type SettingsRow } from "@/lib/email-outbox/status";
import { sendConfig } from "@/lib/email-outbox/config";
import { statusWords } from "@/lib/email-outbox/reasons";
import { KIND_LABEL, type EmailKind } from "@/lib/email-outbox/facts";
import { CollectionsTable, type CollectionRow, type HistoryItem } from "@/app/delinquency/collections-table";

const HISTORY_PER_UNIT = 20;

/**
 * Collections, inside the HOA Dues units card: who is behind, for how long,
 * and what has been sent, with the reminder tools for the board. Used to be
 * its own page; /delinquency now sends people here.
 */
export async function CollectionsSection({
  supabase,
  isBoard,
  data,
}: {
  supabase: SupabaseClient;
  isBoard: boolean;
  /** Loaded by the page with the grace period, so the stats above and this table use the same two buckets. */
  data: CollectionsData | null;
}) {
  const today = buildingTodayIso();
  const heading = (
    <div>
      <h3 className="text-[15px] font-bold tracking-tight text-ink">Collections</h3>
      <p className="mt-0.5 text-[12px] text-mute">Who is behind, for how long, and what has been sent.</p>
    </div>
  );
  if (!data) {
    return (
      <div id="collections" className="mt-6 scroll-mt-20 space-y-3 border-t border-line pt-5">
        {heading}
        <Answer status="bad" headline="We couldn't load balances" detail="Reload the page. If it keeps happening, write to support." />
      </div>
    );
  }
  const { units } = data;

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

  return (
    <div id="collections" className="mt-6 scroll-mt-20 space-y-4 border-t border-line pt-5">
      {heading}
      {strip ? (
        <p className="text-[12px] text-mute">
          {strip.label === "On"
            ? "Reminders are sent from Walkup after you approve them. "
            : strip.label === "Suspended"
              ? "Sending from Walkup is suspended. Reminders open in your email app. "
              : "Reminders open in your email app. "}
          <Link href="/dues/email" className="inline-flex min-h-[44px] items-center text-ink underline underline-offset-2 sm:min-h-0">
            {strip.label === "On" ? "Email settings" : "Send from Walkup instead"}
          </Link>
        </p>
      ) : null}

      {units.length === 0 ? <p className="text-[13px] text-mute">Nobody is past due.</p> : null}

      {units.length > 0 ? (
        <>
          <p className="text-[12px] text-mute">Late fees are added only by the board. Check your bylaws first.</p>
          <CollectionsTable rows={rows} canPrepare={isBoard} today={today} />
        </>
      ) : null}
    </div>
  );
}
