import Link from "next/link";
import { Card, Restricted } from "@/components/ui";
import { BillMetrics } from "./bill-metrics";
import { billTotals, monthIndex } from "@/lib/upkeep/bill-totals";
import { AddBill, BillsList, type BillRowView } from "@/app/bills/bill-form";
import { BILL_COLUMNS, BILL_LINES } from "@/app/bills/table";
import { BillFilters, type BillParams } from "./bill-filters";
import { DismissibleOnceAnswer } from "./dismissible-answer";
import { coverageShort } from "@/lib/insurance/coverage";
import { periodLabel } from "@/lib/insurance/format";
import { humanDate, moneyText } from "@/lib/repairs/format";
import type { RepairsViewer } from "@/lib/repairs/page-data";
import type { Supabase } from "@/lib/repairs/server";
import type { BillFrequency } from "@/lib/upkeep/bills";
import { billsAnswer, billShowFilter, FREQUENCY_WORDS, nextDueText, parseBillShow, type BillLike, type BillShow } from "@/lib/upkeep/bills-view";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * Bills (repairs-spec §13.2): the regular bills the building pays, who
 * pays which by hand, and a record of each payment. Walkup reminds; it
 * never pays. Financial readers see it; the board changes it.
 */
export async function BillsView({
  supabase,
  viewer,
  show: showRaw,
  q: qRaw,
  pay: payRaw,
  freq: freqRaw,
  sort: sortRaw,
}: {
  supabase: Supabase;
  viewer: RepairsViewer;
  show?: string;
  q?: string;
  pay?: string;
  freq?: string;
  sort?: string;
}) {
  if (!viewer.canReadFinancials) return <Restricted what="the bills list" />;
  const today = viewer.todayIso;
  const show = parseBillShow(showRaw);
  const params: BillParams = {
    show,
    q: (qRaw ?? "").trim().slice(0, 100),
    pay: payRaw === "hand" || payRaw === "autopay" ? payRaw : null,
    freq: freqRaw === "monthly" || freqRaw === "quarterly" || freqRaw === "semiannual" || freqRaw === "annual" ? freqRaw : null,
    sort: sortRaw === "name" || sortRaw === "amount" ? sortRaw : "next",
  };
  const filtered = Boolean(params.q || params.pay || params.freq || params.sort !== "next" || show !== "active");
  const isBoard = viewer.isBoard;

  const [{ data: bills, error }, { data: accounts }, { data: vendors }, { data: persons }] = await Promise.all([
    supabase
      .from("recurring_bills")
      .select(
        "id, name, account_id, vendor_id, frequency, typical_amount::text, due_day, next_due_on, autopay_arranged, autopay_note, notes, is_active, paused_at, paused_note, last_paid_on, insurance_policy_id, vendors(name), accounts(name), insurance_policies(id, coverage, carrier_name, effective_from, effective_to, replaced_by_policy_id)",
      )
      .order("next_due_on", { ascending: true, nullsFirst: false }),
    isBoard
      ? supabase.from("accounts").select("id, name").eq("type", "expense").eq("is_active", true).order("code")
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    isBoard
      ? supabase.from("vendors").select("id, name").is("archived_at", null).neq("status", "do_not_use").order("name")
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    supabase.from("persons").select("full_name, auth_user_id"),
  ]);
  if (error || !bills) return <Restricted what="the bills list" />;

  const all = bills.map((b) => ({
    ...b,
    frequency: b.frequency as BillFrequency,
    typical_amount: (b.typical_amount as string | null) ?? null,
    due_day: (b.due_day as number | null) ?? null,
    next_due_on: (b.next_due_on as string | null) ?? null,
    autopay_arranged: b.autopay_arranged === true,
    is_active: b.is_active === true,
    paused_at: (b.paused_at as string | null) ?? null,
  }));
  const like: BillLike[] = all;
  const needle = params.q.toLowerCase();
  const vendorNameOf = (b: (typeof all)[number]) => one(b.vendors as { name: string } | { name: string }[] | null)?.name ?? "";
  const accountNameOf = (b: (typeof all)[number]) => one(b.accounts as { name: string } | { name: string }[] | null)?.name ?? "";
  const amountOf = (b: (typeof all)[number]) => (b.typical_amount ? Number(b.typical_amount) : -1);
  const shown = all
    .filter((b) => billShowFilter(b, show))
    .filter((b) => (params.pay === "autopay" ? b.autopay_arranged : params.pay === "hand" ? !b.autopay_arranged : true))
    .filter((b) => !params.freq || b.frequency === params.freq)
    .filter((b) => !needle || `${b.name} ${vendorNameOf(b)} ${accountNameOf(b)}`.toLowerCase().includes(needle))
    .sort((a, b) =>
      params.sort === "name"
        ? (a.name as string).localeCompare(b.name as string)
        : params.sort === "amount"
          ? amountOf(b) - amountOf(a)
          : (a.next_due_on ?? "9999-12-31").localeCompare(b.next_due_on ?? "9999-12-31"),
    );

  const { data: payments } =
    shown.length > 0
      ? await supabase
          .from("recurring_bill_payments")
          .select("id, bill_id, paid_on, due_on, amount::text, note, created_by")
          .in(
            "bill_id",
            shown.map((b) => b.id as string),
          )
          .order("paid_on", { ascending: false })
          .limit(500)
      : { data: [] };
  const nameByUser = new Map((persons ?? []).map((p) => [p.auth_user_id as string, (p.full_name as string) || null]));

  // Insurance premiums (insurance-spec §12 R-2): the policy each bill pays for.
  // During a renewal overlap two bills cover the same coverage; their period
  // labels make them read as two terms, not a duplicate.
  type PolicyRef = { id: string; coverage: string; carrier_name: string; effective_from: string; effective_to: string; replaced_by_policy_id: string | null };
  const policyOf = (b: (typeof shown)[number]) => one(b.insurance_policies as unknown as PolicyRef | PolicyRef[] | null);
  const coverageCount = new Map<string, number>();
  for (const b of shown) {
    const pol = policyOf(b);
    if (pol) coverageCount.set(pol.coverage, (coverageCount.get(pol.coverage) ?? 0) + 1);
  }

  const rows: BillRowView[] = shown.map((b) => {
    const vendor = one(b.vendors as { name: string } | { name: string }[] | null);
    const account = one(b.accounts as { name: string } | { name: string }[] | null);
    const pol = policyOf(b);
    const overlap = pol ? (coverageCount.get(pol.coverage) ?? 0) > 1 : false;
    return {
      id: b.id as string,
      name: b.name as string,
      account_id: b.account_id as string,
      vendor_id: (b.vendor_id as string | null) ?? null,
      frequency: b.frequency,
      next_due_on: b.next_due_on,
      typical_amount: b.typical_amount,
      autopay_arranged: b.autopay_arranged,
      autopay_note: (b.autopay_note as string | null) ?? null,
      notes: [(b.notes as string | null) ?? null, b.paused_at && b.paused_note ? `Paused: ${b.paused_note as string}` : null].filter(Boolean).join(" · ") || null,
      rawNotes: (b.notes as string | null) ?? null,
      is_active: b.is_active,
      paused: b.paused_at !== null,
      line: [vendor?.name, account?.name].filter(Boolean).join(" · "),
      frequencyText: FREQUENCY_WORDS[b.frequency] ?? b.frequency,
      amountText: b.typical_amount ? `about ${moneyText(b.typical_amount)}` : "amount varies",
      nextText: b.is_active ? nextDueText(b, today) : null,
      lastPaidText: b.last_paid_on ? `last paid ${humanDate(b.last_paid_on as string, today)}` : null,
      policy: pol
        ? {
            href: `/insurance/policies/${pol.id}`,
            text: `Premium for ${coverageShort(pol.coverage)}${overlap ? ` ${periodLabel(pol.effective_from, pol.effective_to)}` : ""} with ${pol.carrier_name}`,
            retired: !b.is_active && pol.replaced_by_policy_id !== null,
          }
        : b.insurance_policy_id
          ? { href: `/insurance/policies/${b.insurance_policy_id as string}`, text: "Insurance premium", retired: false }
          : null,
      payments: (payments ?? [])
        .filter((p) => p.bill_id === b.id)
        .map((p) => ({
          id: p.id as string,
          paidOn: p.paid_on as string,
          dueOn: (p.due_on as string | null) ?? null,
          amount: (p.amount as string | null) ?? null,
          note: (p.note as string | null) ?? null,
          who: nameByUser.get(p.created_by as string) ?? null,
        })),
    };
  });

  const answer = billsAnswer(like, today);

  // What the active bills add up to this month and this year, from their own schedules.
  const [ty, tm] = today.split("-").map(Number);
  const activeForTotals = all
    .filter((b) => b.is_active && b.paused_at === null)
    .map((b) => ({
      frequency: b.frequency,
      next_due_on: b.next_due_on,
      typical_amount: b.typical_amount,
      category: accountNameOf(b) || "Uncategorized",
    }));
  const monthTotals = billTotals(activeForTotals, monthIndex(ty, tm), monthIndex(ty, tm));
  const yearTotals = billTotals(activeForTotals, monthIndex(ty, 1), monthIndex(ty, 12));
  const monthLabel = new Date(Date.UTC(ty, tm - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const categories = (accounts ?? []).map((a) => ({ id: a.id as string, name: a.name as string }));
  const contractors = (vendors ?? []).map((v) => ({ id: v.id as string, name: v.name as string }));
  const counts: Record<BillShow, number> = {
    active: all.filter((b) => billShowFilter(b, "active")).length,
    paused: all.filter((b) => billShowFilter(b, "paused")).length,
    archived: all.filter((b) => billShowFilter(b, "archived")).length,
  };

  return (
    <div className="space-y-6">
      {all.length > 0 ? <DismissibleOnceAnswer status={answer.status} headline={answer.headline} detail={answer.detail} /> : null}
      {all.length > 0 ? <BillMetrics month={monthTotals} year={yearTotals} monthLabel={monthLabel} /> : null}

      {/* A quiet rule between the totals above and the bills below. */}
      <hr className="border-line" />

      <section aria-labelledby="bills-card-title" className="rounded-xl border border-line bg-paper">
        {/* On desktop everything down to the column headers stays put while the rows scroll under it. */}
        <div className="z-20 rounded-t-xl bg-paper xl:sticky xl:top-[56px]">
          <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-t-[11px] band bg-ink px-5 py-3">
            <div className="min-w-0">
              <h2 id="bills-card-title" className="eyebrow text-paper">
                Regular bills
              </h2>
              <p className="mt-0.5 text-[12px] text-ondark-mute">
                What the building pays, how often, and whether autopay is set up at the provider. Walkup never pays anything.
              </p>
            </div>
            {isBoard ? <AddBill categories={categories} contractors={contractors} todayIso={today} variant="header" /> : null}
          </header>

          {/* Search and filters, set apart from the list by a hard line. */}
          {all.length > 0 ? (
            <div className="border-b-2 border-line-strong bg-fill/40">
              <BillFilters
                key={`${params.show}|${params.pay}|${params.freq}|${params.sort}|${params.q}`}
                params={params}
                clearHref={filtered ? "/repairs?view=bills" : null}
                counts={{ paused: counts.paused, archived: counts.archived }}
              />
            </div>
          ) : null}

          {rows.length > 0 ? (
            <div className="hidden px-5 pt-3 xl:block">
              <div className="relative isolate">
                {BILL_LINES.map((c) => (
                  <span key={c} aria-hidden="true" className={`pointer-events-none absolute inset-y-0 -z-10 hidden w-px bg-line xl:block ${c}`} />
                ))}
                <div aria-hidden="true" className={`${BILL_COLUMNS} border-b border-line pb-2 text-[11px] font-bold uppercase tracking-wide text-ink xl:pl-9`}>
                  <span className="text-center">Bill</span>
                  <span className="text-center">Amount</span>
                  <span className="text-center">Next due</span>
                  <span className="text-center">Last paid</span>
                  <span className="text-center">Status</span>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="px-5 pb-3 pt-1">
          {all.length === 0 ? (
            <p className="py-2 text-[13px] text-mute">
              No regular bills recorded yet: a utility, the insurance premium, a cleaning contract. Once they&rsquo;re here, Home reminds you before each one is due.
            </p>
          ) : rows.length === 0 ? (
            <p className="py-2 text-[13px] text-mute">
              {filtered ? "No bills match." : show === "paused" ? "No paused bills." : show === "archived" ? "No archived bills." : "No active bills."}{" "}
              {filtered ? (
                <Link href="/repairs?view=bills" className="text-ink underline underline-offset-2">
                  Clear the search or filters.
                </Link>
              ) : null}
            </p>
          ) : (
            <BillsList bills={rows} isBoard={isBoard} categories={categories} contractors={contractors} todayIso={today} />
          )}
        </div>
      </section>

      <Card navy title="What Walkup does and doesn't do here">
        <p className="text-[13px] leading-relaxed text-mute">
          Walkup keeps track of what&rsquo;s due and reminds you. It <strong className="text-ink">does not hold your bank details and never pays anything</strong>.
          Autopay is set up directly with the utility or your bank, and recorded here so the next board knows what&rsquo;s already arranged and
          doesn&rsquo;t double-pay.
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-mute">
          For a building this size that&rsquo;s the safer arrangement: no software holding the association&rsquo;s banking credentials, and no
          single point of failure if a volunteer&rsquo;s account is compromised.
        </p>
      </Card>
    </div>
  );
}
