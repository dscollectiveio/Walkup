import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Answer, Card, Empty, money } from "@/components/ui";
import { AddBillForm } from "@/app/budget/add-bill-form";
import { shortDate, todayIso } from "@/lib/dates";
import { cadenceWords, daysUntil, statusFor, type UpkeepStatus } from "@/lib/upkeep/schedule";
import { AddTaskForm, TaskActions, TemplatePicker, type TaskForForm } from "./upkeep-forms";

const STATUS_TONE: Record<UpkeepStatus, string> = {
  overdue: "bg-bad-tint text-bad-text",
  due_soon: "bg-warning-tint text-warning-text",
  scheduled: "bg-fill text-mute",
};

const FREQUENCY_WORDS: Record<string, string> = {
  monthly: "monthly",
  quarterly: "quarterly",
  semiannual: "twice a year",
  annual: "yearly",
};

/**
 * Upkeep: the recurring care the building needs on a calendar, and the
 * service contracts and bills that go with it. Nothing here is a problem
 * report; that's the Problems view.
 */
export async function UpkeepView({ isBoard }: { isBoard: boolean }) {
  const supabase = await createClient();
  const today = todayIso();

  const [{ data: tasks }, { data: vendors }, { data: bills }, { data: accounts }, { data: recentLog }] = await Promise.all([
    supabase
      .from("upkeep_tasks")
      .select("id, name, description, interval_months, due_month, last_done_on, next_due_on, vendor_id, estimated_cost, vendors(name)")
      .eq("is_active", true)
      .order("next_due_on"),
    supabase.from("vendors").select("id, name").neq("status", "do_not_use").order("name"),
    supabase
      .from("recurring_bills")
      .select("id, name, frequency, typical_amount, due_day, next_due_on, autopay_arranged, autopay_note, notes, vendors(name), accounts(name)")
      .eq("is_active", true)
      .order("next_due_on", { ascending: true, nullsFirst: false }),
    supabase.from("accounts").select("id, name").eq("type", "expense").eq("is_active", true).order("code"),
    supabase
      .from("upkeep_log")
      .select("id, task_id, done_on, cost, note, vendors(name), upkeep_tasks(name)")
      .order("done_on", { ascending: false })
      .limit(8),
  ]);

  const list = (tasks ?? []).map((t) => ({
    ...t,
    status: statusFor(t.next_due_on, today),
    vendorName: (t.vendors as unknown as { name: string } | null)?.name ?? null,
  }));
  const overdue = list.filter((t) => t.status === "overdue");
  const soon = list.filter((t) => t.status === "due_soon");
  const later = list.filter((t) => t.status === "scheduled");
  const vendorOptions = (vendors ?? []).map((v) => ({ id: v.id, name: v.name }));

  const taskRow = (t: (typeof list)[number]) => {
    const forForm: TaskForForm = {
      id: t.id,
      name: t.name,
      description: t.description,
      interval_months: t.interval_months,
      due_month: t.due_month,
      next_due_on: t.next_due_on,
      vendor_id: t.vendor_id,
      estimated_cost: t.estimated_cost === null ? null : Number(t.estimated_cost),
    };
    const days = daysUntil(t.next_due_on, today);
    const when =
      t.status === "overdue"
        ? `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`
        : days === 0
          ? "due today"
          : `due ${shortDate(t.next_due_on, today)}`;
    return (
      <li key={t.id} className="py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-ink">{t.name}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS_TONE[t.status]}`}>{when}</span>
            </div>
            <div className="mt-1 text-[12px] text-mute">
              {cadenceWords(t.interval_months, t.due_month)}
              {t.vendorName ? ` · ${t.vendorName}` : ""}
              {t.estimated_cost !== null ? ` · about ${money(Number(t.estimated_cost)).replace(/\.00$/, "")}` : ""}
              {t.last_done_on ? ` · last done ${shortDate(t.last_done_on, today)}` : " · not done yet"}
            </div>
            {t.description ? <div className="mt-0.5 text-[12px] text-mute-soft">{t.description}</div> : null}
          </div>
          {isBoard ? <TaskActions task={forForm} vendors={vendorOptions} /> : null}
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-6">
      {list.length === 0 ? null : overdue.length > 0 ? (
        <Answer
          status="attention"
          headline={`${overdue.length} job${overdue.length === 1 ? " is" : "s are"} overdue`}
          detail={overdue.map((t) => t.name).join(" · ")}
        />
      ) : soon.length > 0 ? (
        <Answer
          status="neutral"
          headline={`${soon.length} job${soon.length === 1 ? "" : "s"} coming up in the next two months`}
          detail={soon.map((t) => `${t.name} (${shortDate(t.next_due_on, today)})`).join(" · ")}
        />
      ) : (
        <Answer status="good" headline="Nothing due for a couple of months" detail="The schedule is up to date." />
      )}

      <Card
        navy
        title="Upkeep schedule"
        hint="Recurring care on a calendar — what, how often, who usually does it. Mark a job done and the next date rolls forward."
        action={isBoard && list.length > 0 ? <AddTaskForm vendors={vendorOptions} /> : undefined}
      >
        {list.length === 0 ? (
          <div className="space-y-4 py-2">
            <p className="text-[13px] text-mute">
              Nothing on the calendar yet. Most buildings have the same dozen jobs each year — start from that list, or add your own.
            </p>
            {isBoard ? (
              <div className="flex flex-wrap gap-2">
                <TemplatePicker existingNames={[]} />
                <AddTaskForm vendors={vendorOptions} />
              </div>
            ) : (
              <Empty>The board hasn&rsquo;t set up the upkeep schedule yet.</Empty>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {overdue.length > 0 ? (
              <section>
                <h3 className="text-[11px] font-medium uppercase tracking-[0.07em] text-bad-text">Overdue</h3>
                <ul className="divide-y divide-line">{overdue.map(taskRow)}</ul>
              </section>
            ) : null}
            {soon.length > 0 ? (
              <section>
                <h3 className="text-[11px] font-medium uppercase tracking-[0.07em] text-section-label">Next two months</h3>
                <ul className="divide-y divide-line">{soon.map(taskRow)}</ul>
              </section>
            ) : null}
            {later.length > 0 ? (
              <section>
                <h3 className="text-[11px] font-medium uppercase tracking-[0.07em] text-section-label">Later</h3>
                <ul className="divide-y divide-line">{later.map(taskRow)}</ul>
              </section>
            ) : null}
            {isBoard ? (
              <div className="border-t border-line pt-4">
                <TemplatePicker existingNames={list.map((t) => t.name)} />
              </div>
            ) : null}
          </div>
        )}
      </Card>

      {(recentLog ?? []).length > 0 ? (
        <Card navy title="Recently done" hint="What got done, when, and what it cost.">
          <ul className="divide-y divide-line text-[13px]">
            {(recentLog ?? []).map((l) => {
              const task = l.upkeep_tasks as unknown as { name: string } | null;
              const vendor = l.vendors as unknown as { name: string } | null;
              return (
                <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="text-ink">{task?.name ?? "Task"}</span>
                    <span className="ml-2 text-[12px] text-mute">
                      {shortDate(l.done_on, today)}
                      {vendor ? ` · ${vendor.name}` : ""}
                      {l.note ? ` · ${l.note}` : ""}
                    </span>
                  </span>
                  <span className="figures text-ink">{l.cost !== null ? money(Number(l.cost)) : ""}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <Card
        navy
        title="Service contracts and bills"
        hint="Recurring bills the building pays — who, how often, and whether autopay is already set up at the provider. Walkup never pays anything itself."
      >
        {(bills ?? []).length === 0 ? (
          <p className="text-[13px] text-mute">
            No recurring bills recorded yet — a utility, the insurance premium, a cleaning contract. They show up on the Dashboard under
            &ldquo;Coming up&rdquo; once they&rsquo;re here.
          </p>
        ) : (
          <ul className="divide-y divide-line text-[13px]">
            {(bills ?? []).map((b) => {
              const vendor = b.vendors as unknown as { name: string } | null;
              const account = b.accounts as unknown as { name: string } | null;
              return (
                <li key={b.id} className="flex flex-wrap items-baseline justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{b.name}</span>
                    <span className="ml-2 text-[12px] text-mute">
                      {FREQUENCY_WORDS[b.frequency] ?? b.frequency}
                      {vendor ? ` · ${vendor.name}` : ""}
                      {account ? ` · ${account.name}` : ""}
                      {b.autopay_arranged ? " · on autopay" : ""}
                    </span>
                    {b.notes || b.autopay_note ? (
                      <span className="block text-[11px] text-mute-soft">{[b.notes, b.autopay_note].filter(Boolean).join(" · ")}</span>
                    ) : null}
                  </span>
                  <span className="text-right">
                    <span className="figures block text-ink">
                      {b.typical_amount !== null ? `about ${money(Number(b.typical_amount)).replace(/\.00$/, "")}` : "amount varies"}
                    </span>
                    {b.next_due_on ? <span className="block text-[11px] text-mute">next {shortDate(b.next_due_on, today)}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {isBoard ? (
          <div className="mt-4">
            <AddBillForm
              categories={(accounts ?? []).map((a) => ({ id: a.id, name: a.name }))}
              contractors={vendorOptions}
            />
          </div>
        ) : null}
        <p className="mt-3 text-[11px] text-mute-soft">
          The insurance premium is added here automatically when a policy is recorded on{" "}
          <Link href="/insurance" className="underline-offset-2 hover:underline">
            Insurance
          </Link>
          .
        </p>
      </Card>
    </div>
  );
}
