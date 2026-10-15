import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Answer, Restricted } from "@/components/ui";
import { MoneyAnswerCard } from "@/components/owner/money-answer";
import { StatementDownload } from "@/components/owner/statement-download";
import { btnPrimary } from "@/components/repairs/styles";
import { buildingTodayIso } from "@/lib/dates";
import { isUuid } from "@/lib/repairs/server";
import { loadSummary } from "@/lib/owner/load";
import { ViewerUnavailable } from "@/components/owner/viewer-unavailable";
import { getViewer } from "@/lib/owner/viewer";
import { parsePeriodParams, presetPeriods, type StatementLine } from "@/lib/owner/statement";
import { StatementTable } from "./statement-table";

export const dynamic = "force-dynamic";

type SP = { from?: string; to?: string; preset?: string };

/**
 * A unit's statement with a period picker (owner-portal-spec 6.2). The gate is
 * unit_statement_summary(): it returns a row only for the unit's owner or a
 * financial reader, so a neighbour's id looks the same as one that does not exist.
 */
export default async function OwnerStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ unitId: string }>;
  searchParams: Promise<SP>;
}) {
  const { unitId } = await params;
  const sp = await searchParams;
  const viewer = await getViewer();
  if (!viewer) return <ViewerUnavailable />;
  if (!isUuid(unitId)) return <Restricted what="this unit's statement" />;

  const supabase = await createClient();
  const today = buildingTodayIso();
  const sum = await loadSummary(supabase, unitId, today);
  if (!sum.ok) {
    // No row means not this person's unit (or no such unit): both read as "not available" without saying which.
    if (sum.reason === "none") return <Restricted what="this unit's statement" />;
    return (
      <div className="mx-auto w-full max-w-[900px] space-y-6">
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Statement</h1>
        <Answer status="neutral" headline="We couldn't load this statement" detail="Reload the page." />
      </div>
    );
  }

  const period = parsePeriodParams(sp, today);
  const presets = presetPeriods(today);
  const { data, error } = await supabase.rpc("unit_statement", { p_unit_id: unitId, p_from: period.from, p_to: period.to });
  const label = sum.summary.unit_label;
  const previewing = !viewer.ownedUnitIds.includes(unitId);

  return (
    <div className="mx-auto w-full max-w-[900px] space-y-6">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">{label} statement</h1>
        <p className="mt-1 text-mute">What was charged, what was paid, and what is left.</p>
        {previewing ? <p className="mt-1 text-[13px] text-mute">You&rsquo;re previewing {label} as the board.</p> : null}
      </div>

      <MoneyAnswerCard summary={sum.summary} hasEverBeenCharged={sum.hasHistory} todayIso={today} actions="none" />

      <section aria-label="Choose a period" className="rounded-xl border border-line bg-paper px-5 py-4">
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => {
            const active = p.from === period.from && p.to === period.to;
            return (
              <Link
                key={p.key}
                href={`/owner/statement/${unitId}?preset=${p.key}`}
                aria-current={active ? "true" : undefined}
                className={`inline-flex min-h-[44px] items-center rounded-full border px-4 text-[13px] font-medium ${
                  active ? "border-ink bg-ink text-paper" : "border-line-strong bg-paper text-ink hover:bg-fill"
                }`}
              >
                {p.label}
              </Link>
            );
          })}
        </div>
        <form method="get" className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div>
            <label htmlFor="st-from" className="block text-[13px] font-medium text-ink">
              From
            </label>
            <input
              id="st-from"
              name="from"
              type="date"
              defaultValue={period.from ?? ""}
              className="mt-1 block min-h-[44px] w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[16px] text-ink sm:text-[14px]"
            />
          </div>
          <div>
            <label htmlFor="st-to" className="block text-[13px] font-medium text-ink">
              To
            </label>
            <input
              id="st-to"
              name="to"
              type="date"
              defaultValue={period.to ?? ""}
              className="mt-1 block min-h-[44px] w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[16px] text-ink sm:text-[14px]"
            />
          </div>
          <button type="submit" className={btnPrimary}>
            Show
          </button>
        </form>
        <p className="mt-3 text-[12px] text-mute">Showing {period.label}.</p>
      </section>

      {error ? (
        <Answer status="neutral" headline="We couldn't load this statement" detail="Reload the page." />
      ) : (
        <StatementTable
          lines={(data ?? []) as unknown as StatementLine[]}
          fromIso={period.from}
          toIso={period.to}
          todayIso={today}
          periodLabel={period.label}
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <StatementDownload unitId={unitId} from={period.from} to={period.to} />
      </div>
      <p className="text-[12px] text-mute">
        Payments are listed when the board records them or the deposit lands. If a payment you made is missing, tell the board on the{" "}
        <Link href="/owner/pay#report" className="underline underline-offset-2">
          How to pay
        </Link>{" "}
        page.
      </p>
    </div>
  );
}
