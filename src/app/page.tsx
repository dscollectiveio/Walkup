import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Answer, Card, Empty, Jargon, Stat, UnitLink, money, moneyRounded } from "@/components/ui";

export const dynamic = "force-dynamic";

interface Reminder {
  name: string;
  kind: string;
  due: Date;
  // Compliance dates the app computes but nobody has verified against this
  // year's instructions. Stale legal information is worse than absent legal
  // information, so these say so instead of reading as authoritative.
  unverified?: boolean;
}

interface SetupTask {
  name: string;
  detail: string;
  href: string;
  done: boolean;
}

function formatDue(due: Date, today: Date): string {
  const days = Math.max(0, Math.ceil((due.getTime() - today.getTime()) / 86400000));
  const sameYear = due.getFullYear() === today.getFullYear();
  const date = due.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  // Dates and day counts, never adjectives.
  return `Due ${date} — ${days} day${days === 1 ? "" : "s"}`;
}

/** Next occurrence of a month/day on or after today. */
function nextOccurrence(month: number, day: number, today: Date): Date {
  const thisYear = new Date(today.getFullYear(), month - 1, day);
  return thisYear >= today ? thisYear : new Date(today.getFullYear() + 1, month - 1, day);
}

export default async function OverviewPage() {
  const supabase = await createClient();

  const [
    { data: associations },
    { data: fiscalYears },
    { data: funds },
    { data: units },
    { data: totals },
    { data: owners },
    { data: bankConnections },
    { data: policies },
    { data: vendors },
    { data: declarationDocs },
    { data: bills },
    { data: upcomingCharges },
  ] = await Promise.all([
    supabase
      .from("associations")
      .select("id, display_name, state_code, fiscal_year_end_month, incorporated_on"),
    supabase.from("fiscal_years").select("label").order("starts_on", { ascending: false }).limit(1),
    supabase
      .from("fund_cash_balances")
      .select("fund_id, name, kind, cash_balance, visible_lines")
      .order("name"),
    supabase
      .from("unit_balances")
      .select("unit_id, label, balance_owed, visible_charges")
      .order("sort_order"),
    supabase
      .from("association_totals")
      .select("visible_tb_rows, total_debits, total_credits, total_owed, units_behind"),
    supabase.from("unit_owners").select("unit_id, persons(full_name)"),
    supabase.from("bank_connections").select("id, status"),
    supabase.from("insurance_policies").select("coverage, effective_to"),
    supabase.from("vendors").select("id, w9_on_file, is_1099_exempt"),
    supabase.from("document_links").select("id").eq("relation", "declaration").limit(1),
    supabase
      .from("upcoming_bills")
      .select("name, next_due_on, autopay_arranged, days_until_due"),
    supabase
      .from("charge_balances")
      .select("due_on")
      .in("status", ["open", "partial"])
      .gt("due_on", new Date().toISOString().slice(0, 10))
      .order("due_on")
      .limit(50),
  ]);

  const association = associations?.[0];
  if (!association) {
    return <Empty>No association is visible to you.</Empty>;
  }

  const fyLabel = fiscalYears?.[0]?.label ?? String(new Date().getFullYear());
  const t = totals?.[0];
  const booksVisible = (t?.visible_tb_rows ?? 0) > 0;
  const booksBalance = booksVisible && Number(t!.total_debits) === Number(t!.total_credits);
  const owed = Number(t?.total_owed ?? 0);
  const behind = Number(t?.units_behind ?? 0);
  const visibleFunds = (funds ?? []).filter((f) => f.visible_lines > 0);
  const totalCash = visibleFunds.reduce((s, f) => s + Number(f.cash_balance), 0);

  const ownerName = new Map<string, string>();
  for (const o of owners ?? []) {
    const p = o.persons as unknown as { full_name: string } | null;
    if (p) ownerName.set(o.unit_id, p.full_name);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // ==========================================================================
  // Coming up — deadlines assembled from the association's own records, plus
  // the federal filing dates. Board/accountant only: RLS already returns
  // nothing from the board-scoped tables for an owner, and half-empty
  // reminders would be worse than none.
  // ==========================================================================
  const reminders: Reminder[] = [];

  if (booksVisible) {
    const horizon = new Date(today.getTime() + 120 * 86400000);

    for (const b of bills ?? []) {
      if (b.autopay_arranged || !b.next_due_on) continue;
      const due = new Date(`${b.next_due_on}T00:00:00`);
      if (due >= today && due <= horizon) {
        reminders.push({ name: b.name, kind: "Bill to pay by hand", due });
      }
    }

    const nextRenewal = (policies ?? [])
      .map((p) => ({ coverage: p.coverage, due: new Date(`${p.effective_to}T00:00:00`) }))
      .filter((p) => p.due >= today && p.due <= horizon)
      .sort((a, b) => a.due.getTime() - b.due.getTime())[0];
    if (nextRenewal) {
      reminders.push({
        name: "Insurance renewal",
        kind: String(nextRenewal.coverage).replace(/_/g, " "),
        due: nextRenewal.due,
      });
    }

    const nextCharges = (upcomingCharges ?? []).filter((c) => c.due_on);
    if (nextCharges.length > 0) {
      const firstDue = nextCharges[0].due_on as string;
      const count = nextCharges.filter((c) => c.due_on === firstDue).length;
      reminders.push({
        name: `Assessments due from ${count} unit${count === 1 ? "" : "s"}`,
        kind: "Owner fees",
        due: new Date(`${firstDue}T00:00:00`),
      });
    }

    // Federal filing dates, computed rather than read from tax_parameters —
    // that table holds numerics, and "the 15th day of the 4th month after the
    // fiscal year ends" is a rule, not a number. Labeled unverified for the
    // same reason every other tax figure in this app is provisional.
    const fyEndMonth = association.fiscal_year_end_month ?? 12;
    const due1120hMonth = ((fyEndMonth + 3) % 12) + 1; // 4th month after FYE
    reminders.push({
      name: "Form 1120-H",
      kind: "Federal tax return",
      due: nextOccurrence(due1120hMonth, 15, today),
      unverified: true,
    });
    reminders.push({
      name: "1099-NEC to contractors",
      kind: "Federal filing",
      due: nextOccurrence(1, 31, today),
      unverified: true,
    });

    // The one state rule on record. Only shown when the state matches and the
    // incorporation date exists — implying coverage of other states would be
    // worse than staying quiet.
    if (association.state_code === "IL" && association.incorporated_on) {
      const inc = new Date(`${association.incorporated_on}T00:00:00`);
      reminders.push({
        name: "Illinois annual report",
        kind: "Filed on the incorporation anniversary",
        due: nextOccurrence(inc.getMonth() + 1, inc.getDate(), today),
        unverified: true,
      });
    }

    reminders.sort((a, b) => a.due.getTime() - b.due.getTime());
  }

  // ==========================================================================
  // Finish setting up — what the record still needs, checked against the
  // data rather than tracked as state anywhere. Each row disappears by being
  // done, not by being dismissed.
  // ==========================================================================
  const missingW9s = (vendors ?? []).filter((v) => !v.w9_on_file && !v.is_1099_exempt).length;
  const hasActivePolicy = (policies ?? []).some(
    (p) => new Date(`${p.effective_to}T00:00:00`) >= today,
  );

  const setupTasks: SetupTask[] = booksVisible
    ? [
        {
          name: "Connect the bank account",
          detail: "See transactions without typing them in by hand.",
          href: "/bank-feed",
          done: (bankConnections ?? []).some((c) => c.status === "active"),
        },
        {
          name: "Record your insurance",
          detail: "So renewals show up here before they arrive as invoices.",
          href: "/insurance",
          done: hasActivePolicy,
        },
        {
          name: "Collect contractor W-9s",
          detail:
            missingW9s > 0
              ? `${missingW9s} contractor${missingW9s === 1 ? "" : "s"} still need${missingW9s === 1 ? "s" : ""} one before January's 1099s.`
              : "Everyone who needs one has one on file.",
          href: "/contractors",
          done: missingW9s === 0,
        },
        {
          name: "Upload the declaration",
          detail: "The document the next board will ask for first.",
          href: "/documents",
          done: (declarationDocs ?? []).length > 0,
        },
      ]
    : [];

  const tasksDone = setupTasks.filter((task) => task.done).length;
  const showSetup = setupTasks.length > 0 && tasksDone < setupTasks.length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">
          {association.display_name}
        </h1>
        <p className="mt-1 text-mute">
          {association.state_code} · financial year {fyLabel}
        </p>
      </div>

      {/* The headline answer, before any figures. A board member should be able
          to tell in one glance whether anything needs them tonight. */}
      {behind > 0 ? (
        <Answer
          status="attention"
          headline={`${behind} of ${units?.length ?? 0} units is behind on payments`}
          detail={`${moneyRounded(owed)} is owed to the association. Everything else looks in order.`}
        >
          <Link
            href="/delinquency"
            className="inline-block rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid"
          >
            See who owes
          </Link>
        </Answer>
      ) : (
        <Answer
          status="good"
          headline="Everything looks in order"
          detail="All units are up to date on their payments, and your records add up."
        />
      )}

      {reminders.length > 0 ? (
        <Card
          title="Coming up"
          hint="Deadlines from your own records, plus the filings every association has."
        >
          <ul className="divide-y divide-line">
            {reminders.slice(0, 6).map((r) => {
              const days = Math.ceil((r.due.getTime() - today.getTime()) / 86400000);
              return (
                <li
                  key={`${r.name}-${r.due.toISOString()}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5"
                >
                  <span className="min-w-0">
                    <span className="text-[13px] font-medium text-ink">{r.name}</span>
                    <span className="ml-2 text-[11px] text-mute">{r.kind}</span>
                    {r.unverified ? (
                      <span className="ml-2 text-[11px] text-mute-soft">
                        not yet checked against this year&rsquo;s instructions
                      </span>
                    ) : null}
                  </span>
                  <span
                    className={`tabular shrink-0 text-[13px] ${
                      days <= 14 ? "font-medium text-warning-text" : "text-mute"
                    }`}
                  >
                    {formatDue(r.due, today)}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {showSetup ? (
        <Card
          title="Finish setting up"
          hint={`${tasksDone} of ${setupTasks.length} done. Each of these disappears once the record has it.`}
        >
          <ul className="divide-y divide-line">
            {setupTasks.map((task) => (
              <li key={task.name}>
                <Link
                  href={task.href}
                  className="flex items-center justify-between gap-4 py-3 transition-colors hover:bg-fill"
                >
                  <span className="min-w-0">
                    <span
                      className={`block text-[13px] font-medium ${task.done ? "text-mute" : "text-ink"}`}
                    >
                      {task.name}
                    </span>
                    <span className="mt-0.5 block text-[12px] text-mute">{task.detail}</span>
                  </span>
                  {task.done ? (
                    <span className="shrink-0 text-[12px] font-medium text-good-text">Done</span>
                  ) : (
                    <ChevronRight
                      size={15}
                      strokeWidth={1.75}
                      className="shrink-0 text-mute-soft"
                      aria-hidden="true"
                    />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Money in the bank" value={money(totalCash)} note="across all accounts" />
        {visibleFunds.map((f) => (
          <Stat
            key={f.fund_id}
            label={
              f.kind === "reserve"
                ? "Reserve savings"
                : f.kind === "operating"
                  ? "Day-to-day account"
                  : f.name
            }
            value={money(f.cash_balance)}
            note={f.kind === "reserve" ? "set aside for big repairs" : "bills and running costs"}
          />
        ))}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card title="Units" hint="Click a unit to see its payment history.">
          {!units || units.length === 0 ? (
            <Empty>No units are visible to you.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {units.map((u) => (
                <li key={u.unit_id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <UnitLink id={u.unit_id} label={u.label} />
                    {ownerName.get(u.unit_id) ? (
                      <span className="ml-2 text-[13px] text-mute">
                        {ownerName.get(u.unit_id)}
                      </span>
                    ) : null}
                  </div>
                  {u.visible_charges === 0 ? (
                    <span className="shrink-0 text-[13px] text-mute-soft">not shown to you</span>
                  ) : Number(u.balance_owed) > 0 ? (
                    <span className="figures shrink-0 text-[13px] font-medium text-bad-text">
                      owes {money(u.balance_owed)}
                    </span>
                  ) : (
                    <span className="shrink-0 text-[13px] text-good-text">up to date</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {booksVisible ? (
          <Card
            title="Are the books right?"
            hint="Every transaction is recorded twice, once on each side. If the two sides ever disagree, something has gone wrong."
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span
                className={`rounded-full border px-3 py-1 text-[13px] font-medium ${
                  booksBalance
                    ? "border-good-line bg-good-tint text-good-text"
                    : "border-bad-line bg-bad-tint text-bad-text"
                }`}
              >
                {booksBalance ? "Yes — the two sides match" : "No — something is wrong"}
              </span>
              <span className="tabular text-[13px] text-mute">
                <Jargon term="trial balance">{money(t!.total_debits)} on each side</Jargon>
              </span>
            </div>
            <p className="mt-3">
              <Link
                href="/ledger"
                className="text-[13px] text-mute underline-offset-2 hover:underline"
              >
                See every transaction
              </Link>
            </p>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
