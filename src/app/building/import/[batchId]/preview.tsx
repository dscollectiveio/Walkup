import { Answer, Card, Stat, money } from "@/components/ui";
import type { ImportKind } from "@/lib/import/kinds";
import { normalizeKey } from "@/lib/import/normalize";
import { entryPreview, payeeLinkCounts } from "@/lib/import/preview";
import { taxEffect, taxEffectFromSummary } from "@/lib/import/tax-effect";
import type { ImportSummary } from "@/lib/import/types";
import type { PanelAccount } from "./options-panel";
import { Pill, longDate } from "../ui";

type Mapped = Record<string, string>;
interface PRow { row_number: number; mapped: Mapped; status: string }

const num = (n: number) => n.toLocaleString("en-US");
const amt = (text: string | null | undefined) => (text ? money(text) : money("0"));

export function Preview({
  kind, summary, options, sample, rows, accounts, funds, vendors, fyLabel, notes,
}: {
  kind: ImportKind;
  summary: ImportSummary;
  options: Record<string, unknown>;
  sample: PRow[];
  rows: PRow[];
  accounts: PanelAccount[];
  funds: { id: string; name: string }[];
  vendors: { id: string; name: string }[];
  fyLabel: string | null;
  notes: string[];
}) {
  const c = summary.counts;
  const batchProblems = summary.batch_errors;
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const ok = rows.filter((r) => r.status === "ok");

  return (
    <div className="space-y-5">
      <Answer
        status={batchProblems.length > 0 || c.ok === 0 ? "attention" : "good"}
        headline={c.ok === 0 ? "Nothing is ready to import yet" : `Ready to import ${num(c.ok)} ${c.ok === 1 ? "row" : "rows"}`}
        detail="Nothing is saved until you press Import. You can undo it afterwards."
      >
        <p className="text-[13px] text-ink">
          {num(c.ok)} ready · {num(c.errors)} need a fix · {num(c.duplicates)} already imported · {num(c.skipped)} skipped
        </p>
      </Answer>

      {batchProblems.map((e) => (
        <Answer key={e.code} status="bad" headline={e.message} />
      ))}
      {notes.length > 0 ? <p className="border-l-[3px] border-info bg-info-tint px-3 py-2 text-[13px] text-info-text">{notes.join(" ")}</p> : null}

      {kind === "transactions" ? <TransactionsPreview summary={summary} options={options} sample={sample} byId={byId} rows={ok} vendors={vendors} /> : null}
      {kind === "opening_accounts" ? <OpeningAccountsPreview summary={summary} rows={ok} fyLabel={fyLabel} asOf={String(options.as_of ?? "")} /> : null}
      {kind === "opening_units" ? <OpeningUnitsPreview summary={summary} rows={ok} fyLabel={fyLabel} options={options} byId={byId} /> : null}
      {kind === "units_owners" ? <UnitsPreview summary={summary} rows={rows} options={options} funds={funds} /> : null}
      {kind === "contractors" ? <ContractorsPreview rows={rows} /> : null}
    </div>
  );
}

function TransactionsPreview({
  summary, options, sample, byId, rows, vendors,
}: {
  summary: ImportSummary;
  options: Record<string, unknown>;
  sample: PRow[];
  byId: Map<string, PanelAccount>;
  rows: PRow[];
  vendors: { id: string; name: string }[];
}) {
  const accountsForPreview = new Map([...byId.entries()].map(([id, a]) => [id, { id, code: a.code, name: a.name }]));
  const vendorNames = new Map(vendors.map((v) => [v.id, v.name]));
  const links = payeeLinkCounts(rows, options, vendorNames);
  const entries = sample.map((r) => ({ row: r, e: entryPreview(r.mapped, options, accountsForPreview) })).filter((x) => x.e);
  const by = Object.values(summary.by_account);
  const unitDeposits = rows.some((r) => r.mapped.unit_label && /^\d/.test(r.mapped.amount ?? ""));
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Money in" value={amt(summary.money_in)} />
        <Stat label="Money out" value={amt(summary.money_out)} />
        <Stat label="Entries" value={num(summary.counts.ok)} note="Each one balanced: debits equal credits" />
      </div>
      <Card title="By account">
        {by.length === 0 ? (
          <p className="text-[13px] text-mute">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {by.map((a) => (
              <li key={a.account} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                <span className="text-ink">
                  {a.account} <span className="text-mute">({a.count})</span>
                </span>
                <span className="flex items-center gap-2">
                  <Pill tone="info">{taxEffectFromSummary(a.type, a.exempt)}</Pill>
                  <span className="figures text-ink">{amt(a.total)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={`The first ${entries.length} entries`}>
        <ul className="divide-y divide-line">
          {entries.map(({ row, e }) =>
            e ? (
              <li key={row.row_number} className="py-3 text-[13px]">
                <p className="font-medium text-ink">
                  {longDate(e.date)} · {e.description}
                </p>
                <p className="figures text-mute">Debit {e.debit.label} {amt(e.debit.amount)}</p>
                <p className="figures text-mute">Credit {e.credit.label} {amt(e.credit.amount)}</p>
              </li>
            ) : null,
          )}
        </ul>
      </Card>
      {unitDeposits ? (
        <p className="border-l-[3px] border-info bg-info-tint px-3 py-2 text-[13px] text-info-text">
          Rows with a unit and income are recorded as money received. They don&rsquo;t change what the unit owes now.
        </p>
      ) : null}
      {links.map((l) => (
        <p key={l.name} className="text-[13px] text-ink">
          {l.count} {l.count === 1 ? "payment" : "payments"} will count toward {l.name}&rsquo;s 1099 total.
        </p>
      ))}
      <p className="border-l-[3px] border-warning bg-warning-tint px-3 py-2 text-[13px] text-warning-text">
        Check Taxes: the income and spending you import now count toward the 60% and 90% tests for the years they fall in.
      </p>
    </div>
  );
}

function OpeningAccountsPreview({ summary, rows, fyLabel, asOf }: { summary: ImportSummary; rows: PRow[]; fyLabel: string | null; asOf: string }) {
  const debits = rows.filter((r) => r.mapped.debit);
  const credits = rows.filter((r) => r.mapped.credit);
  const balanced = summary.debits === summary.credits && summary.debits !== null;
  const group = (list: PRow[], key: "debit" | "credit") => (
    <ul className="divide-y divide-line">
      {list.map((r) => (
        <li key={r.row_number} className="flex justify-between gap-3 py-2 text-[13px]">
          <span className="text-ink">
            {r.mapped.account_key} <span className="text-mute">({r.mapped.fund_key})</span>
          </span>
          <span className="figures">{amt(r.mapped[key])}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Debits">
          {group(debits, "debit")}
          <p className="figures mt-2 border-t border-line pt-2 text-[13px] font-medium">{amt(summary.debits)}</p>
        </Card>
        <Card title="Credits">
          {group(credits, "credit")}
          <p className="figures mt-2 border-t border-line pt-2 text-[13px] font-medium">{amt(summary.credits)}</p>
        </Card>
      </div>
      <p className="text-[13px] text-ink">
        {balanced ? <Pill tone="good">Balanced</Pill> : <Pill tone="bad">Not balanced</Pill>}{" "}
        This becomes one entry dated {longDate(asOf)}{fyLabel ? ` in fiscal year ${fyLabel}` : ""}.
      </p>
    </div>
  );
}

function OpeningUnitsPreview({
  summary, rows, fyLabel, options, byId,
}: {
  summary: ImportSummary;
  rows: PRow[];
  fyLabel: string | null;
  options: Record<string, unknown>;
  byId: Map<string, PanelAccount>;
}) {
  const income = byId.get(String(options.income_account_id ?? ""));
  return (
    <div className="space-y-4">
      <Card title="What each unit owed">
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.row_number} className="flex justify-between gap-3 py-2 text-[13px]">
              <span className="text-ink">{r.mapped.unit_label}</span>
              <span className="figures">{amt(r.mapped.amount)}</span>
            </li>
          ))}
        </ul>
        <p className="figures mt-2 border-t border-line pt-2 text-[13px] font-medium">Total {amt(summary.unit_total)}</p>
      </Card>
      <p className="text-[13px] text-ink">
        {num(summary.counts.ok)} {summary.counts.ok === 1 ? "charge" : "charges"} will be created on {longDate(String(options.as_of ?? ""))}
        {fyLabel ? ` (fiscal year ${fyLabel})` : ""}, each shown on the unit&rsquo;s statement as &ldquo;Balance carried forward&rdquo;. When an owner pays, the payment is applied to it.
      </p>
      {income ? (
        <p className="text-[13px] text-ink">
          Counted under {income.code} {income.name} <Pill tone="info">{taxEffect(income)}</Pill>
        </p>
      ) : null}
    </div>
  );
}

function UnitsPreview({ summary, rows, options, funds }: { summary: ImportSummary; rows: PRow[]; options: Record<string, unknown>; funds: { id: string; name: string }[] }) {
  void funds;
  const shares = new Map<string, string>();
  for (const r of rows) {
    if ((r.status === "ok" || r.status === "duplicate") && r.mapped.ownership_percent && r.mapped.unit_label) {
      const k = normalizeKey(r.mapped.unit_label);
      if (!shares.has(k)) shares.set(k, r.mapped.ownership_percent);
    }
  }
  const skipped = options.skip_percentages === true;
  const noEmail = rows.filter((r) => r.status === "ok" && r.mapped.owner_name && !r.mapped.email).length;
  const leftOut = rows.filter((r) => r.status === "skipped" || r.status === "error");
  const total = summary.percent_total;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="New units" value={num(summary.new_units)} />
        <Stat label="Existing units" value={num(summary.existing_units)} />
        <Stat label="New people" value={num(summary.new_people)} />
        <Stat label="Owners assigned" value={num(summary.owners_assigned)} />
        <Stat label="Dues plans" value={num(summary.dues_plans)} />
      </div>
      {summary.dues_plans_skipped_no_fund > 0 ? (
        <p className="border-l-[3px] border-warning bg-warning-tint px-3 py-2 text-[13px] text-warning-text">
          Dues plans need an operating fund, and there isn&rsquo;t one yet, so {num(summary.dues_plans_skipped_no_fund)} will be skipped.
        </p>
      ) : null}
      {noEmail > 0 ? (
        <p className="text-[13px] text-mute">
          New people (no email to match on): {num(noEmail)}. A row with no email always makes a new person, so two neighbours with the same name stay separate.
        </p>
      ) : null}
      {shares.size > 0 && !skipped ? (
        <Card title="Ownership percentages">
          <ul className="divide-y divide-line">
            {[...shares.entries()].map(([unit, pct]) => (
              <li key={unit} className="flex justify-between gap-3 py-2 text-[13px]">
                <span className="text-ink">{rows.find((r) => normalizeKey(r.mapped.unit_label ?? "") === unit)?.mapped.unit_label}</span>
                <span className="figures">{pct}%</span>
              </li>
            ))}
          </ul>
          <p className="figures mt-2 border-t border-line pt-2 text-[13px] font-medium">
            Total {total ?? ""}%{" "}
            {summary.batch_errors.some((e) => e.code.startsWith("percent")) ? <Pill tone="bad">Needs attention</Pill> : <Pill tone="good">Adds up to 100%</Pill>}
          </p>
        </Card>
      ) : skipped ? (
        <p className="text-[13px] text-mute">Ownership percentages are being left out.</p>
      ) : null}
      {leftOut.length > 0 ? (
        <Card title="Left out">
          <ul className="space-y-1 text-[13px] text-mute">
            {leftOut.slice(0, 20).map((r) => (
              <li key={r.row_number}>
                Row {r.row_number}: {r.mapped.unit_label ?? "no unit"} {r.mapped.owner_name ? `· ${r.mapped.owner_name}` : ""}
              </li>
            ))}
            {leftOut.length > 20 ? <li>and {leftOut.length - 20} more</li> : null}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function ContractorsPreview({ rows }: { rows: PRow[] }) {
  const fresh = rows.filter((r) => r.status === "ok");
  const there = rows.filter((r) => r.status === "duplicate");
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title={`New contractors (${fresh.length})`}>
        {fresh.length === 0 ? (
          <p className="text-[13px] text-mute">None.</p>
        ) : (
          <ul className="space-y-1 text-[13px] text-ink">
            {fresh.slice(0, 50).map((r) => (
              <li key={r.row_number}>
                {r.mapped.name} {r.mapped.trade ? <span className="text-mute">· {r.mapped.trade}</span> : null}
              </li>
            ))}
            {fresh.length > 50 ? <li className="text-mute">and {fresh.length - 50} more</li> : null}
          </ul>
        )}
      </Card>
      <Card title={`Already there (${there.length})`}>
        {there.length === 0 ? (
          <p className="text-[13px] text-mute">None.</p>
        ) : (
          <ul className="space-y-1 text-[13px] text-ink">
            {there.slice(0, 50).map((r) => (
              <li key={r.row_number}>{r.mapped.name}</li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
