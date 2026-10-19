import Link from "next/link";
import { Answer, Card } from "@/components/ui";
import { fetchAllRows } from "@/lib/import/batch-data";
import { distinctValues, type Options } from "@/lib/import/options";
import { categoryTotals } from "@/lib/import/preview";
import { KIND_LABEL, KIND_THINGS, isImportKind, type ImportKind } from "@/lib/import/kinds";
import { importViewer } from "@/lib/import/server";
import type { ImportSummary } from "@/lib/import/types";
import { BoardOnly, BTN_PRIMARY, BTN_SECONDARY, ErrorNote, PageHeader, longDate } from "../ui";
import { CommitBar } from "./commit-bar";
import { DoneActions } from "./done-actions";
import { FixTable, type FixRow } from "./fix-table";
import { OptionsPanel, type PanelAccount } from "./options-panel";
import { Preview } from "./preview";
import { Steps, type StepKey } from "./steps";
import { InviteList } from "./invite-list";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE_SIZE = 50;
type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

interface Batch {
  id: string;
  kind: ImportKind;
  status: "uploaded" | "validated" | "committed" | "undone" | "cancelled";
  filename: string;
  row_count: number;
  mapping: Record<string, unknown>;
  options: Options;
  summary: ImportSummary & { batch_errors: ImportSummary["batch_errors"] };
  digest: string | null;
  committed_at: string | null;
  undone_at: string | null;
}

export default async function ImportBatchPage({ params, searchParams }: { params: Promise<{ batchId: string }>; searchParams: Promise<Search> }) {
  const { batchId } = await params;
  const sp = await searchParams;
  const { supabase, associationId, role } = await importViewer();
  if (!associationId || role !== "board_admin") {
    return <BoardOnly what="Importing" why="Only a board admin can bring in spreadsheets." />;
  }

  const read = async () => {
    const { data } = await supabase
      .from("import_batches")
      .select("id, kind, status, filename, row_count, mapping, options, summary, digest, committed_at, undone_at")
      .eq("id", batchId)
      .limit(1);
    return (data?.[0] as Batch | undefined) ?? null;
  };
  let batch = /^[0-9a-f-]{36}$/i.test(batchId) ? await read() : null;
  if (!batch || !isImportKind(batch.kind)) {
    return (
      <div className="space-y-4">
        <PageHeader title="Import from a spreadsheet" />
        <ErrorNote>We couldn&rsquo;t find that import.</ErrorNote>
        <Link href="/building/import" className={BTN_SECONDARY}>
          Back to Import
        </Link>
      </div>
    );
  }
  const kind = batch.kind;

  // ---- finished imports ----
  const wanted = (one(sp.step) ?? "options") as StepKey;
  if (batch.status === "committed" || batch.status === "undone") {
    return <DonePage batch={batch} supabase={supabase} associationId={associationId} />;
  }
  if (batch.status === "cancelled") {
    return (
      <div className="space-y-4">
        <PageHeader title={KIND_LABEL[kind]} />
        <Answer status="neutral" headline="This import is finished." detail="It was cancelled, and nothing was imported." />
        <Link href="/building/import" className={BTN_PRIMARY}>
          Back to Import
        </Link>
      </div>
    );
  }

  // ---- open imports: make sure the summary is fresh ----
  if (batch.status === "uploaded") {
    await supabase.rpc("import_validate", { p_batch_id: batchId });
    batch = (await read()) ?? batch;
  }
  const step: StepKey = wanted === "fix" || wanted === "preview" ? wanted : "options";
  const summary = batch.summary;
  const counts = summary.counts ?? { rows: batch.row_count, ok: 0, errors: 0, duplicates: 0, skipped: 0 };
  const batchErrors = summary.batch_errors ?? [];
  const notes = Array.isArray(batch.mapping?._notes) ? (batch.mapping._notes as string[]) : [];

  const [{ data: accountRows }, { data: fundRows }, { data: fyRows }] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, code, name, type, is_cash_account, is_active, is_exempt_function_income, is_exempt_expenditure")
      .eq("association_id", associationId)
      .order("code"),
    supabase.from("funds").select("id, name, kind").eq("association_id", associationId).order("name"),
    supabase.from("fiscal_years").select("label, starts_on, ends_on, status").eq("association_id", associationId).order("starts_on"),
  ]);
  const accounts = (accountRows ?? []) as PanelAccount[];
  const funds = (fundRows ?? []) as { id: string; name: string; kind: string }[];
  const fiscalYears = (fyRows ?? []) as { label: string; starts_on: string; ends_on: string; status: string }[];

  return (
    <div className="space-y-6">
      <PageHeader title={KIND_LABEL[kind]} sub={`${batch.filename} · ${batch.row_count.toLocaleString("en-US")} ${batch.row_count === 1 ? "row" : "rows"}`} />
      <Steps batchId={batchId} current={step} canJump />
      <SummaryStrip counts={counts} />
      {batchErrors.length > 0 ? (
        <div className="space-y-2">
          {batchErrors.map((e) => (
            <Answer key={`${e.code}-${e.field}`} status="bad" headline={e.message} />
          ))}
        </div>
      ) : null}

      {step === "options" ? (
        <OptionsStep
          batch={batch}
          supabase={supabase}
          accounts={accounts}
          funds={funds}
          fiscalYears={fiscalYears}
          associationId={associationId}
        />
      ) : null}

      {step === "fix" ? <FixStep batch={batch} supabase={supabase} sp={sp} counts={counts} /> : null}

      {step === "preview" ? (
        <PreviewStep batch={batch} supabase={supabase} accounts={accounts} funds={funds} fiscalYears={fiscalYears} associationId={associationId} notes={notes} />
      ) : null}

      {step === "options" ? (
        <div className="flex flex-wrap gap-3">
          <Link href={`/building/import/${batchId}?step=fix`} className={BTN_PRIMARY}>
            Continue
          </Link>
          <Link href="/building/import" className={BTN_SECONDARY}>
            Save and finish later
          </Link>
        </div>
      ) : null}
      {step === "fix" ? (
        <div className="flex flex-wrap gap-3">
          <Link href={`/building/import/${batchId}?step=preview`} className={BTN_PRIMARY}>
            {counts.errors === 0 ? "Go to the preview" : "Preview what is ready"}
          </Link>
          <Link href={`/building/import/${batchId}?step=options`} className={BTN_SECONDARY}>
            Back
          </Link>
        </div>
      ) : null}
      {step === "preview" ? (
        <CommitBar batchId={batchId} digest={batch.digest ?? ""} okCount={counts.ok} hasBatchErrors={batchErrors.length > 0} things="rows" />
      ) : null}
    </div>
  );
}

function SummaryStrip({ counts }: { counts: ImportSummary["counts"] }) {
  const n = (v: number) => v.toLocaleString("en-US");
  return (
    <p className="rounded-xl border border-line bg-paper px-4 py-3 text-[13px] text-ink" aria-live="polite">
      {n(counts.ok)} ready · {n(counts.errors)} need a fix · {n(counts.duplicates)} already imported · {n(counts.skipped)} skipped
    </p>
  );
}

type SB = Awaited<ReturnType<typeof importViewer>>["supabase"];

async function OptionsStep({
  batch, supabase, accounts, funds, fiscalYears, associationId,
}: {
  batch: Batch;
  supabase: SB;
  accounts: PanelAccount[];
  funds: { id: string; name: string; kind: string }[];
  fiscalYears: { label: string; starts_on: string; ends_on: string; status: string }[];
  associationId: string;
}) {
  const kind = batch.kind;
  const rows =
    kind === "transactions"
      ? await fetchAllRows<{ mapped: Record<string, string> }>(supabase, batch.id, "mapped", (q) => q.neq("decision", "skip"))
      : [];
  const { data: vendors } =
    kind === "transactions"
      ? await supabase.from("vendors").select("id, name").eq("association_id", associationId).is("archived_at", null).order("name")
      : { data: [] };
  const mapping = batch.mapping ?? {};
  const mapped = (key: string) => mapping[key] !== null && mapping[key] !== undefined;
  return (
    <Card title="Your books" hint="Tell Walkup where this goes. Every answer is checked again before anything is saved.">
      <OptionsPanel
        batchId={batch.id}
        kind={kind}
        options={batch.options ?? {}}
        accounts={accounts}
        funds={funds}
        vendors={(vendors ?? []) as { id: string; name: string }[]}
        categories={categoryTotals(rows, "category_key")}
        fundValues={distinctValues(rows, "fund_key")}
        payeeValues={distinctValues(rows, "payee")}
        fiscalYears={fiscalYears}
        hasDues={mapped("dues_amount")}
        hasPercent={mapped("ownership_percent")}
        hasUnitColumn={mapped("unit_label") && kind === "transactions"}
      />
    </Card>
  );
}

const TABS: { key: string; label: string; countKey: keyof ImportSummary["counts"] }[] = [
  { key: "fix", label: "Needs a fix", countKey: "errors" },
  { key: "ready", label: "Ready", countKey: "ok" },
  { key: "already", label: "Already imported", countKey: "duplicates" },
  { key: "skipped", label: "Skipped", countKey: "skipped" },
];

async function FixStep({ batch, supabase, sp, counts }: { batch: Batch; supabase: SB; sp: Search; counts: ImportSummary["counts"] }) {
  const tab = TABS.some((t) => t.key === one(sp.tab)) ? (one(sp.tab) as string) : "fix";
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const from = (page - 1) * PAGE_SIZE;
  let q = supabase
    .from("import_rows")
    .select("id, row_number, status, decision, mapped, raw, errors")
    .eq("batch_id", batch.id)
    .order("row_number")
    .range(from, from + PAGE_SIZE - 1);
  q = tab === "fix" ? q.eq("status", "error") : tab === "ready" ? q.eq("status", "ok") : tab === "already" ? q.eq("status", "duplicate") : q.eq("status", "skipped");
  const { data } = await q;
  const rows: FixRow[] = ((data ?? []) as { id: string; row_number: number; status: string; decision: "import" | "skip"; mapped: Record<string, string>; raw: Record<string, string> | null; errors: FixRow["errors"] }[]).map(
    (r) => ({ id: r.id, rowNumber: r.row_number, status: r.status, decision: r.decision, mapped: r.mapped ?? {}, raw: r.raw, errors: r.errors ?? [] }),
  );
  const { data: units } = await supabase.from("units").select("label").order("sort_order");
  const total = counts[TABS.find((t) => t.key === tab)?.countKey ?? "errors"];

  return (
    <div className="space-y-4">
      {counts.errors === 0 && counts.ok > 0 ? (
        <Answer status="good" headline="No problems." detail="Go to the preview." />
      ) : null}
      <nav aria-label="Rows" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/building/import/${batch.id}?step=fix&tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={`inline-flex min-h-[36px] items-center rounded-full px-3 text-[12px] font-medium ${tab === t.key ? "bg-ink text-paper" : "border border-line text-ink hover:bg-fill"}`}
          >
            {t.label} ({counts[t.countKey].toLocaleString("en-US")})
          </Link>
        ))}
      </nav>
      <FixTable
        batchId={batch.id}
        kind={batch.kind}
        rows={rows}
        unitLabels={((units ?? []) as { label: string }[]).map((u) => u.label)}
        problemCount={counts.errors}
        tab={tab}
      />
      {total > PAGE_SIZE ? (
        <div className="flex items-center justify-between text-[13px]">
          {page > 1 ? (
            <Link href={`/building/import/${batch.id}?step=fix&tab=${tab}&page=${page - 1}`} className={BTN_SECONDARY}>
              Earlier rows
            </Link>
          ) : (
            <span />
          )}
          <span className="text-mute">
            {from + 1} to {Math.min(from + PAGE_SIZE, total)} of {total.toLocaleString("en-US")}
          </span>
          {from + PAGE_SIZE < total ? (
            <Link href={`/building/import/${batch.id}?step=fix&tab=${tab}&page=${page + 1}`} className={BTN_SECONDARY}>
              Later rows
            </Link>
          ) : (
            <span />
          )}
        </div>
      ) : null}
    </div>
  );
}

async function PreviewStep({
  batch, supabase, accounts, funds, fiscalYears, associationId, notes,
}: {
  batch: Batch;
  supabase: SB;
  accounts: PanelAccount[];
  funds: { id: string; name: string; kind: string }[];
  fiscalYears: { label: string; starts_on: string; ends_on: string; status: string }[];
  associationId: string;
  notes: string[];
}) {
  const kind = batch.kind;
  const rows = await fetchAllRows<{ row_number: number; mapped: Record<string, string>; status: string }>(supabase, batch.id, "row_number, mapped, status");
  const sample = rows.filter((r) => r.status === "ok").slice(0, 20);
  const { data: vendors } = await supabase.from("vendors").select("id, name").eq("association_id", associationId);
  const asOf = String(batch.options?.as_of ?? "");
  const fy = asOf ? fiscalYears.find((f) => f.starts_on <= asOf && f.ends_on >= asOf) : undefined;
  return (
    <Preview
      kind={kind}
      summary={batch.summary}
      options={batch.options ?? {}}
      sample={sample}
      rows={rows}
      accounts={accounts}
      funds={funds}
      vendors={(vendors ?? []) as { id: string; name: string }[]}
      fyLabel={fy?.label ?? null}
      notes={notes}
    />
  );
}

const DONE_LINKS: Record<ImportKind, { href: string; label: string }[]> = {
  units_owners: [
    { href: "/building", label: "Review Building & Owners" },
    { href: "/building/import/new?kind=transactions", label: "Import transactions" },
  ],
  contractors: [{ href: "/contractors", label: "See contractors" }],
  opening_accounts: [
    { href: "/ledger", label: "See the trial balance" },
    { href: "/building/import/new?kind=opening_units", label: "Import what each unit owed" },
    { href: "/building/import/new?kind=transactions", label: "Import transactions" },
  ],
  opening_units: [
    { href: "/ledger", label: "See the trial balance" },
    { href: "/building/import/new?kind=transactions", label: "Import transactions" },
  ],
  transactions: [
    { href: "/financial-statements", label: "See Financial Statements" },
    { href: "/tax", label: "Check the Taxes page" },
  ],
};

async function DonePage({ batch, supabase, associationId }: { batch: Batch; supabase: SB; associationId: string }) {
  const kind = batch.kind;
  const undone = batch.status === "undone";
  const created = (batch.summary as { created?: number }).created ?? 0;
  const things = KIND_THINGS[kind];

  if (undone) {
    return (
      <div className="space-y-4">
        <PageHeader title={KIND_LABEL[kind]} sub={`${batch.filename} · undone ${longDate(batch.undone_at)}`} />
        <Answer status="neutral" headline="This import was undone." detail="Nothing from it is counted any more. The entries and their reversals stay in the ledger history." />
        <Link href="/building/import" className={BTN_PRIMARY}>
          Back to Import
        </Link>
      </div>
    );
  }

  // Units and owners: people who now exist with an email and no login can be invited.
  let invitees: { id: string; full_name: string; email: string | null }[] = [];
  let associationName = "your association";
  let boardContactName: string | null = null;
  if (kind === "units_owners") {
    const { data: made } = await supabase.from("import_rows").select("created_person_id").eq("batch_id", batch.id).not("created_person_id", "is", null).limit(1000);
    const ids = ((made ?? []) as { created_person_id: string }[]).map((r) => r.created_person_id);
    if (ids.length) {
      const { data: people } = await supabase.from("persons").select("id, full_name, email, auth_user_id").in("id", ids);
      invitees = ((people ?? []) as { id: string; full_name: string; email: string | null; auth_user_id: string | null }[]).filter((p) => p.email && !p.auth_user_id);
    }
    const { data: assoc } = await supabase.from("associations").select("display_name, board_contact_name").eq("id", associationId).limit(1);
    const a = assoc?.[0] as { display_name?: string; board_contact_name?: string | null } | undefined;
    associationName = a?.display_name ?? associationName;
    boardContactName = a?.board_contact_name ?? null;
  }

  const sentence: Record<ImportKind, string> = {
    units_owners: "Units, owners and dues plans are on Building & Owners. No one was charged and no logins were made.",
    contractors: "They are in your contractors list. Contractors that were already there were left alone.",
    opening_accounts: "One balanced entry now starts your books.",
    opening_units: "Each unit's carried-forward balance shows on its statement.",
    transactions: "Each row became one balanced entry, and spending is in your budget actuals.",
  };

  return (
    <div className="space-y-5">
      <PageHeader title={KIND_LABEL[kind]} sub={`${batch.filename} · imported ${longDate(batch.committed_at)}`} />
      <Answer status="good" headline={`Imported ${created.toLocaleString("en-US")} ${things}`} detail={sentence[kind]} />
      {kind === "transactions" ? (
        <p className="border-l-[3px] border-warning bg-warning-tint px-4 py-3 text-[13px] text-warning-text">
          Check Taxes: the income and spending you just imported now count toward the 60% and 90% tests for the years they fall in.
        </p>
      ) : null}
      {kind === "units_owners" && invitees.length > 0 ? (
        <Card title={`Invite ${invitees.length} ${invitees.length === 1 ? "owner" : "owners"} to sign in`} hint="They were added without a login. An invite lets the owner sign in as this person. Walkup sends nothing.">
          <InviteList people={invitees} associationName={associationName} boardContactName={boardContactName} />
        </Card>
      ) : null}
      <DoneActions batchId={batch.id} canUndo links={DONE_LINKS[kind]} />
    </div>
  );
}
