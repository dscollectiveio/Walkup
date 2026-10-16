import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Answer, Card } from "@/components/ui";
import { BoardOnly } from "@/components/board-only";
import { getViewer } from "@/lib/owner/viewer";
import { buildingTodayIso, longDate } from "@/lib/dates";
import { SUPPORT_EMAIL } from "@/lib/site-config";
import { notConfiguredCopy, sendConfig } from "@/lib/email-outbox/config";
import { displayNameFor } from "@/lib/email-outbox/sanitize";
import { dailyLimit, emailStatus, isWarmingUp, optoutWords, type SettingsRow } from "@/lib/email-outbox/status";
import { statusWords } from "@/lib/email-outbox/reasons";
import { EMAIL_KINDS, KIND_LABEL, type EmailKind } from "@/lib/email-outbox/facts";
import { BlockedList, DailyLimit, RulesCard, SendingSwitch, type RuleView } from "./settings-client";

export const dynamic = "force-dynamic";

const PAGE = 50;
const STATUSES = ["draft", "queued", "sending", "sent", "delivered", "bounced", "complained", "failed", "skipped", "cancelled"];
const COUNTED = ["sending", "sent", "delivered", "bounced", "complained"];

const DEFAULT_RULES: Record<RuleView["kind"], Omit<RuleView, "kind">> = {
  dues_upcoming: { id: null, days: 3, minAmount: "1.00", repeatEveryDays: 7, maxReminders: 1, enabled: false, paused: false, lastRunOn: null },
  dues_overdue: { id: null, days: 7, minAmount: "1.00", repeatEveryDays: 7, maxReminders: 3, enabled: false, paused: false, lastRunOn: null },
};

export default async function EmailPage({ searchParams }: { searchParams: Promise<{ kind?: string; status?: string; unit?: string; page?: string }> }) {
  const viewer = await getViewer();
  if (!viewer || !viewer.isStaff) {
    return (
      <BoardOnly
        what="Email from Walkup"
        why="It is where the board sets up and approves reminders, statements and notices."
        alternative={{ label: "Choose which emails you get", href: "/account?tab=notifications" }}
      />
    );
  }
  const heading = (
    <div>
      <h1 className="text-[20px] font-bold tracking-tight text-ink">Email from Walkup</h1>
      <p className="mt-1 text-mute">Reminders, statements and notices, sent only after a board admin approves them.</p>
    </div>
  );
  if (!viewer.isBoard) {
    return (
      <div className="space-y-6">
        {heading}
        <Answer status="neutral" headline="Email settings are for the board" detail="Ask a board member if you need to see what has been sent." />
      </div>
    );
  }

  const sp = await searchParams;
  const supabase = await createClient();
  const today = buildingTodayIso();
  const page = Math.max(1, Math.trunc(Number(sp.page ?? 1)) || 1);
  const kindFilter = EMAIL_KINDS.includes(sp.kind as EmailKind) ? (sp.kind as EmailKind) : null;
  const statusFilter = STATUSES.includes(sp.status ?? "") ? sp.status! : null;
  const unitFilter = /^[0-9a-f-]{36}$/i.test(sp.unit ?? "") ? sp.unit! : null;

  let logQuery = supabase
    .from("email_outbox")
    .select("id, created_at, sent_at, to_email, to_name, kind, subject, status, skip_reason, last_error, provider_message_id, batch_id, unit_ids", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (kindFilter) logQuery = logQuery.eq("kind", kindFilter);
  if (statusFilter) logQuery = logQuery.eq("status", statusFilter);
  if (unitFilter) logQuery = logQuery.contains("unit_ids", [unitFilter]);

  const [settingsRes, rulesRes, blockedRes, optoutsRes, logRes, assocRes, unitsRes, ownersRes, recentRes] = await Promise.all([
    supabase.from("email_settings").select("sending_enabled, enabled_at, daily_cap, suspended_at, suspended_reason").maybeSingle(),
    supabase.from("reminder_rules").select("id, kind, days, min_amount, repeat_every_days, max_reminders, enabled, paused_at, last_run_on"),
    supabase.from("email_suppressions").select("email, reason, created_at").order("created_at", { ascending: false }),
    supabase.rpc("email_optouts", { p_association_id: viewer.associationId }),
    logQuery,
    supabase.from("associations").select("display_name, board_contact_email").limit(1),
    supabase.from("units").select("id, label, sort_order").order("sort_order"),
    supabase.from("unit_owners").select("person_id, unit_id, effective_to").or(`effective_to.is.null,effective_to.gte.${today}`),
    supabase
      .from("email_outbox")
      .select("claimed_at")
      .in("status", COUNTED)
      .gte("claimed_at", new Date(new Date().getTime() - 36 * 3600_000).toISOString()),
  ]);

  const settings = (settingsRes.data as SettingsRow | null) ?? null;
  const config = sendConfig();
  const status = emailStatus(config.ok, settings);
  const associationName = (assocRes.data?.[0]?.display_name as string) || "your association";
  const replyTo = (assocRes.data?.[0]?.board_contact_email as string | null) ?? "";
  const unitLabel = new Map((unitsRes.data ?? []).map((u) => [u.id as string, u.label as string]));
  const nowMs = new Date().getTime();
  const used = (recentRes.data ?? []).filter((r) => r.claimed_at && buildingTodayIso(new Date(r.claimed_at as string)) === today).length;
  const limit = settings ? dailyLimit(settings, nowMs) : 60;

  const rules: RuleView[] = (["dues_upcoming", "dues_overdue"] as const).map((kind) => {
    const r = (rulesRes.data ?? []).find((x) => x.kind === kind);
    if (!r) return { kind, ...DEFAULT_RULES[kind] };
    return {
      kind,
      id: r.id as string,
      days: r.days as number,
      minAmount: Number(r.min_amount).toFixed(2),
      repeatEveryDays: r.repeat_every_days as number,
      maxReminders: r.max_reminders as number,
      enabled: r.enabled as boolean,
      paused: Boolean(r.paused_at),
      lastRunOn: (r.last_run_on as string | null) ?? null,
    };
  });

  // Opt-outs: unit labels and what they turned off, never an address.
  const unitsByPerson = new Map<string, string[]>();
  for (const o of ownersRes.data ?? []) {
    const label = unitLabel.get(o.unit_id as string);
    if (label) unitsByPerson.set(o.person_id as string, [...(unitsByPerson.get(o.person_id as string) ?? []), label]);
  }
  const optouts = ((optoutsRes.data ?? []) as { person_id: string; dues_reminders: boolean; statements: boolean; announcements: boolean; unsubscribed_all: boolean }[]).flatMap((o) =>
    (unitsByPerson.get(o.person_id) ?? ["A former owner"]).map((label) => `${label} (${optoutWords(o)})`),
  );
  const optoutPeople = ((optoutsRes.data ?? []) as unknown[]).length;

  // Log: who started each batch.
  const rows = logRes.data ?? [];
  const batchIds = [...new Set(rows.map((r) => r.batch_id as string))];
  const { data: batches } = batchIds.length ? await supabase.from("email_batches").select("id, source, created_by").in("id", batchIds) : { data: [] };
  const creatorIds = [...new Set((batches ?? []).map((b) => b.created_by as string | null).filter((x): x is string => Boolean(x)))];
  const { data: creators } = creatorIds.length ? await supabase.from("persons").select("auth_user_id, full_name").in("auth_user_id", creatorIds) : { data: [] };
  const creatorName = new Map((creators ?? []).map((p) => [p.auth_user_id as string, p.full_name as string]));
  const sourceOf = new Map(
    (batches ?? []).map((b) => [b.id as string, b.source === "rule" ? "Rule" : `Batch by ${creatorName.get(b.created_by as string) ?? "a board member"}`]),
  );
  const total = logRes.count ?? rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const qs = (over: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const cur: Record<string, string | null> = { kind: kindFilter, status: statusFilter, unit: unitFilter, page: String(page), ...over };
    for (const [k, v] of Object.entries(cur)) if (v) p.set(k, v);
    const s = p.toString();
    return `/dues/email${s ? `?${s}` : ""}#log`;
  };

  return (
    <div className="space-y-6">
      {heading}

      <Card title="Status">
        {status === "suspended" ? (
          <Answer status="bad" headline="Sending is paused by Walkup" detail={`${settings?.suspended_reason || "Contact support."} Write to ${SUPPORT_EMAIL}.`} />
        ) : status === "not_set_up" && !config.ok ? (
          <Answer status="neutral" headline="Emails are drafts for now" detail={notConfiguredCopy(config.reason)} />
        ) : status === "off" ? (
          <Answer
            status="neutral"
            headline="Sending is off"
            detail="Reminders and statements open in your own email app. Turn sending on to send them from Walkup after you approve them."
          >
            <SendingSwitch enabled={false} canAdmin={viewer.isBoardAdmin} hasReplyTo={Boolean(replyTo)} />
          </Answer>
        ) : (
          <Answer
            status="good"
            headline="Sending is on"
            detail={`Walkup sends as "${displayNameFor(associationName)}" and replies go to ${replyTo}. ${
              settings && isWarmingUp(settings, nowMs) ? "For the first week, up to 20 emails a day. " : ""
            }Today: ${used} of ${limit} sent.`}
          >
            <SendingSwitch enabled canAdmin={viewer.isBoardAdmin} hasReplyTo />
          </Answer>
        )}
        <p className="mt-3 text-[13px] text-mute">
          Everything Walkup sends is built from a template and your books, plus a short note you may add. Walkup never emails a bank account number.
          <span className="ml-1">
            <Link href="/delinquency" className="text-ink underline underline-offset-2">
              Open Collections
            </Link>
          </span>
        </p>
      </Card>

      {status === "on" && viewer.isBoardAdmin && settings ? (
        <Card title="Daily limit">
          <DailyLimit cap={settings.daily_cap} />
        </Card>
      ) : null}

      <Card title="Reminder rules" hint="Rules send dues reminders on their own once a day, only after a board admin turns them on.">
        <RulesCard rules={rules} sendingOn={status === "on"} canAdmin={viewer.isBoardAdmin} canBoard />
      </Card>

      <Card title="Blocked addresses">
        {(blockedRes.data ?? []).length === 0 ? (
          <p className="text-[13px] text-mute">No address is blocked. An address is blocked when it bounces or someone reports an email as spam.</p>
        ) : (
          <BlockedList
            canAdmin={viewer.isBoardAdmin}
            items={(blockedRes.data ?? []).map((b) => ({ email: b.email as string, reason: b.reason as string, date: longDate(b.created_at as string) }))}
          />
        )}
      </Card>

      <Card title="Opt-outs">
        {optoutPeople === 0 ? (
          <p className="text-[13px] text-mute">Nobody has opted out of email.</p>
        ) : (
          <p className="text-[13px] text-ink">
            {optoutPeople} owner{optoutPeople === 1 ? " has" : "s have"} opted out of some email: {optouts.join(", ")}
          </p>
        )}
      </Card>

      <section id="log">
        <Card title="Send log">
          <form method="get" action="/dues/email" className="mb-4 flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="log-kind" className="block text-[12px] font-medium text-ink">
                Kind
              </label>
              <select id="log-kind" name="kind" defaultValue={kindFilter ?? ""} className="mt-1 rounded-lg border border-line-strong bg-paper px-3 py-2 text-[16px] text-ink sm:text-[13px]">
                <option value="">All</option>
                {EMAIL_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="log-status" className="block text-[12px] font-medium text-ink">
                Status
              </label>
              <select id="log-status" name="status" defaultValue={statusFilter ?? ""} className="mt-1 rounded-lg border border-line-strong bg-paper px-3 py-2 text-[16px] text-ink sm:text-[13px]">
                <option value="">All</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {statusWords(s, {}).replace(/:.*/, "")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="log-unit" className="block text-[12px] font-medium text-ink">
                Unit
              </label>
              <select id="log-unit" name="unit" defaultValue={unitFilter ?? ""} className="mt-1 rounded-lg border border-line-strong bg-paper px-3 py-2 text-[16px] text-ink sm:text-[13px]">
                <option value="">All</option>
                {(unitsRes.data ?? []).map((u) => (
                  <option key={u.id as string} value={u.id as string}>
                    {u.label as string}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="inline-flex min-h-[44px] items-center rounded-md border border-line-strong bg-paper px-4 text-[13px] font-medium text-ink hover:bg-fill">
              Filter
            </button>
          </form>

          {rows.length === 0 ? (
            <p className="text-[13px] text-mute">Nothing has been sent yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((r) => {
                const manual = String(r.provider_message_id ?? "").startsWith("manual:");
                const when = ((r.sent_at ?? r.created_at) as string).replace("T", " ").slice(0, 16);
                return (
                  <li key={r.id as string} className="py-3 text-[13px]">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <span className="font-medium text-ink">{(r.to_name as string | null) ?? "Owner"}</span>
                      <span className="text-[12px] text-mute">{when}</span>
                    </div>
                    <div className="break-all text-[12px] text-mute">{r.to_email as string}</div>
                    <div className="mt-1 text-ink">
                      {KIND_LABEL[r.kind as EmailKind] ?? (r.kind as string)}
                      {r.subject ? <span className="text-mute">: {r.subject as string}</span> : null}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-mute">
                      <span>
                        {statusWords(r.status as string, {
                          manual,
                          reason: r.skip_reason as string | null,
                          error: r.last_error ? String(r.last_error).slice(0, 120) : null,
                        })}
                      </span>
                      <span>{sourceOf.get(r.batch_id as string) ?? "Batch"}</span>
                      {r.provider_message_id && !manual ? <span className="font-mono">{String(r.provider_message_id).slice(0, 12)}</span> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {pages > 1 ? (
            <div className="mt-4 flex items-center justify-between text-[13px]">
              {page > 1 ? (
                <Link href={qs({ page: String(page - 1) })} className="text-ink underline underline-offset-2">
                  Newer
                </Link>
              ) : (
                <span />
              )}
              <span className="text-mute">
                Page {page} of {pages}
              </span>
              {page < pages ? (
                <Link href={qs({ page: String(page + 1) })} className="text-ink underline underline-offset-2">
                  Older
                </Link>
              ) : (
                <span />
              )}
            </div>
          ) : null}
        </Card>
      </section>
    </div>
  );
}
