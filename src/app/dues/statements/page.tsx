import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Answer, Card } from "@/components/ui";
import { BoardOnly } from "@/components/board-only";
import { getViewer } from "@/lib/owner/viewer";
import { buildingTodayIso } from "@/lib/dates";
import { isAnnual, parsePeriod, periodLabel, statementPeriods } from "@/lib/statements/period";
import { totalsOf } from "@/lib/statements/summary";
import type { StatementLine } from "@/lib/owner/statement";
import { StatementsForm, type StatementRow } from "./statements-form";

export const dynamic = "force-dynamic";

const MAX_UNITS = 40;

export default async function StatementsPage({ searchParams }: { searchParams: Promise<{ period?: string; from?: string; to?: string }> }) {
  const viewer = await getViewer();
  if (!viewer || !viewer.isStaff) {
    return (
      <BoardOnly
        what="Owner statements"
        why="It is where the board prepares a statement for every unit."
        alternative={{ label: "See your own statement", href: "/owner/statement" }}
      />
    );
  }

  const sp = await searchParams;
  const today = buildingTodayIso();
  const presets = statementPeriods(today);
  const custom = parsePeriod(sp.from, sp.to);
  const chosen = custom ?? presets.find((p) => p.key === sp.period) ?? presets[0];
  const from = chosen.from;
  const to = chosen.to;
  const activeKey = custom ? "custom" : (presets.find((p) => p.key === sp.period) ?? presets[0]).key;

  const supabase = await createClient();
  const [{ data: units }, { data: owners }] = await Promise.all([
    supabase.from("units").select("id, label, sort_order").order("sort_order").limit(MAX_UNITS),
    supabase.from("unit_owners").select("unit_id, effective_to, persons(full_name, email)").or(`effective_to.is.null,effective_to.gte.${today}`),
  ]);

  const unitList = units ?? [];
  const heading = (
    <div>
      <h1 className="text-[20px] font-bold tracking-tight text-ink">Owner statements</h1>
      <p className="mt-1 text-mute">A statement for each unit, as a PDF to download or an email from Walkup.</p>
    </div>
  );
  if (unitList.length === 0) {
    return (
      <div className="space-y-6">
        {heading}
        <Answer status="neutral" headline="Add units on Building & Owners first." detail="Statements are made for each unit once it exists." />
      </div>
    );
  }

  const lines = await Promise.all(
    unitList.map(async (u) => {
      const { data } = await supabase.rpc("unit_statement", { p_unit_id: u.id, p_from: from, p_to: to });
      return [u.id as string, (data ?? []) as unknown as StatementLine[]] as const;
    }),
  );
  const byUnit = new Map(lines);

  const rows: StatementRow[] = unitList.map((u) => {
    const own = (owners ?? []).filter((o) => o.unit_id === u.id).flatMap((o) => {
      const p = o.persons as unknown as { full_name: string; email: string | null } | null;
      return p ? [p] : [];
    });
    const unitLines = byUnit.get(u.id as string) ?? [];
    const t = totalsOf(unitLines);
    const active = unitLines.some((l) => l.kind !== "opening") || t.opening !== "0.00" || t.closing !== "0.00";
    return {
      unitId: u.id as string,
      label: u.label as string,
      owners: own.map((p) => p.full_name),
      hasEmail: own.some((p) => (p.email ?? "").trim() !== ""),
      opening: t.opening,
      charges: t.charges,
      payments: t.payments,
      closing: t.closing,
      active,
    };
  });

  const noEmail = rows.every((r) => !r.hasEmail);
  const href = (q: string) => `/dues/statements?${q}`;

  return (
    <div className="space-y-6">
      {heading}

      <nav aria-label="Statement period" className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <Link
            key={p.key}
            href={href(`period=${p.key}`)}
            aria-current={activeKey === p.key ? "page" : undefined}
            className={`inline-flex min-h-[44px] items-center rounded-full border px-4 text-[13px] font-medium ${
              activeKey === p.key ? "border-ink bg-ink text-paper" : "border-line-strong bg-paper text-ink hover:bg-fill"
            }`}
          >
            {p.label}
          </Link>
        ))}
      </nav>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="from" className="block text-[12px] font-medium text-ink">
            From
          </label>
          <input id="from" name="from" type="date" defaultValue={from} className="mt-1 rounded-lg border border-line-strong bg-paper px-3 py-2 text-[16px] text-ink sm:text-[14px]" />
        </div>
        <div>
          <label htmlFor="to" className="block text-[12px] font-medium text-ink">
            To
          </label>
          <input id="to" name="to" type="date" defaultValue={to} className="mt-1 rounded-lg border border-line-strong bg-paper px-3 py-2 text-[16px] text-ink sm:text-[14px]" />
        </div>
        <button type="submit" className="inline-flex min-h-[44px] items-center rounded-md border border-line-strong bg-paper px-4 text-[13px] font-medium text-ink hover:bg-fill">
          Use these dates
        </button>
        {sp.from && !custom ? <p className="w-full text-[12px] text-bad-text">Use a start date and an end date on or after it.</p> : null}
      </form>

      <Card title={`Statements for ${periodLabel(from, to)}`} hint={isAnnual(from, to) ? "This is a full calendar year, so the emails go out as annual statements." : undefined}>
        {noEmail ? <p className="mb-4 text-[13px] text-mute">No owner has an email address yet. You can still download each statement.</p> : null}
        <StatementsForm rows={rows} from={from} to={to} canPrepare={viewer.isBoard} annual={isAnnual(from, to)} />
      </Card>
    </div>
  );
}
