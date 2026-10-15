"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { autoMatchAccounts, isMappableAccount, type AccountLite } from "@/lib/import/options";
import type { ImportKind } from "@/lib/import/kinds";
import { taxEffect } from "@/lib/import/tax-effect";
import { yearOf } from "@/lib/import/preview";
import { createImportCategory, ensureFiscalYear, saveImportOptions, splitSharesEqually } from "../actions";
import { BTN_PRIMARY, BTN_SECONDARY, ErrorNote, HELP, INPUT, LABEL, Pill } from "../ui";

export interface PanelAccount extends AccountLite {
  is_exempt_function_income: boolean | null;
  is_exempt_expenditure: boolean | null;
}

export interface Distinct {
  key: string;
  sample: string;
  count: number;
}
export interface CategoryRow extends Distinct {
  totalIn: string;
  totalOut: string;
}

export interface OptionsPanelProps {
  batchId: string;
  kind: ImportKind;
  options: Record<string, unknown>;
  accounts: PanelAccount[];
  funds: { id: string; name: string; kind: string }[];
  vendors: { id: string; name: string }[];
  categories: CategoryRow[];
  fundValues: Distinct[];
  payeeValues: Distinct[];
  fiscalYears: { label: string; starts_on: string; ends_on: string; status: string }[];
  hasDues: boolean;
  hasPercent: boolean;
  hasUnitColumn: boolean;
}

const GROUPS: { type: PanelAccount["type"]; label: string }[] = [
  { type: "income", label: "Income" },
  { type: "expense", label: "Expenses" },
  { type: "asset", label: "Assets" },
  { type: "liability", label: "Liabilities" },
  { type: "equity", label: "Equity" },
];

const money = (text: string) => Number(text).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function OptionsPanel(props: OptionsPanelProps) {
  const { batchId, kind } = props;
  const router = useRouter();
  const [options, setOptions] = useState<Record<string, unknown>>(props.options);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const save = (patch: Record<string, unknown>, local?: (o: Record<string, unknown>) => Record<string, unknown>) =>
    start(async () => {
      setError(null);
      const r = await saveImportOptions(batchId, patch);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      setOptions((o) => (local ? local(o) : { ...o, ...patch }));
      setSaved(true);
      router.refresh();
    });

  const get = <T,>(key: string): T | undefined => options[key] as T | undefined;

  return (
    <div className="space-y-6">
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {kind === "transactions" ? <TransactionOptions {...props} options={options} save={save} get={get} pending={pending} setError={setError} /> : null}
      {kind === "opening_accounts" || kind === "opening_units" ? (
        <OpeningOptions {...props} options={options} save={save} get={get} pending={pending} setError={setError} />
      ) : null}
      {kind === "units_owners" ? <UnitsOptions {...props} options={options} save={save} get={get} pending={pending} setError={setError} /> : null}
      {kind === "contractors" ? (
        <p className="text-[13px] text-mute">
          There is nothing to choose for contractors. A contractor who is already there, or named twice in the file, is left alone and shown as
          &ldquo;Already there&rdquo;.
        </p>
      ) : null}
      <p className="h-4 text-[12px] text-mute" aria-live="polite">
        {pending ? "Saving..." : saved ? "Saved." : ""}
      </p>
    </div>
  );
}

interface SubProps extends OptionsPanelProps {
  save: (patch: Record<string, unknown>, local?: (o: Record<string, unknown>) => Record<string, unknown>) => void;
  get: <T,>(key: string) => T | undefined;
  pending: boolean;
  setError: (m: string | null) => void;
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

function TransactionOptions(p: SubProps) {
  const { accounts, funds, categories, options, save, get, pending } = p;
  const cashAccounts = accounts.filter((a) => a.is_cash_account && a.is_active);
  const accountMap = (get<Record<string, string>>("account_map") ?? {}) as Record<string, string>;
  const fundMap = (get<Record<string, string>>("fund_map") ?? {}) as Record<string, string>;
  const payeeMap = (get<Record<string, string>>("payee_map") ?? {}) as Record<string, string>;
  const mappable = accounts.filter(isMappableAccount);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const auto = autoMatchAccounts(categories.map((c) => c.sample), accounts);
  const [creatingFor, setCreatingFor] = useState<string | null>(null);

  const mapCategory = (key: string, accountId: string) => {
    if (accountId === "__new__") {
      setCreatingFor(key);
      return;
    }
    // A changed match has to be checked again.
    save(
      { account_map: { [key]: accountId || null }, mapping_confirmed: false },
      (o) => ({ ...o, account_map: { ...((o.account_map as Record<string, string>) ?? {}), ...(accountId ? { [key]: accountId } : {}) }, mapping_confirmed: false }),
    );
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-[14px] font-bold text-ink">Bank or cash account</h3>
        <div className="max-w-md">
          <select
            id="cash-account"
            aria-label="Bank or cash account"
            value={String(get<string>("cash_account_id") ?? "")}
            onChange={(e) => save({ cash_account_id: e.target.value || null }, (o) => ({ ...o, cash_account_id: e.target.value || undefined }))}
            className={INPUT}
          >
            <option value="">Choose an account</option>
            {cashAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} {a.name}
              </option>
            ))}
          </select>
          <p className={HELP}>The account these transactions went through. If some went through your reserve account, import them as a separate file.</p>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-[14px] font-bold text-ink">Fund</h3>
        <div className="max-w-md">
          <select
            aria-label="Fund"
            value={String(get<string>("default_fund_id") ?? "")}
            onChange={(e) => save({ default_fund_id: e.target.value || null }, (o) => ({ ...o, default_fund_id: e.target.value || undefined }))}
            className={INPUT}
          >
            <option value="">Choose a fund</option>
            {funds.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <p className={HELP}>Used for rows with no fund value. A fund named in your file has to be matched below.</p>
        </div>
        {p.fundValues.length > 0 ? (
          <div className="divide-y divide-line rounded-xl border border-line bg-paper">
            {p.fundValues.map((v) => (
              <div key={v.key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span className="text-[13px] text-ink">
                  {v.sample} <span className="text-mute">({v.count})</span>
                </span>
                <select
                  aria-label={`Fund for ${v.sample}`}
                  value={fundMap[v.key] ?? ""}
                  onChange={(e) =>
                    save({ fund_map: { [v.key]: e.target.value || null } }, (o) => ({
                      ...o,
                      fund_map: { ...((o.fund_map as Record<string, string>) ?? {}), ...(e.target.value ? { [v.key]: e.target.value } : {}) },
                    }))
                  }
                  className={`${INPUT} !w-56`}
                >
                  <option value="">Choose a fund</option>
                  {funds.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-[14px] font-bold text-ink">Categories</h3>
          <p className={HELP}>
            Match each category in your file to one of your accounts. Walkup does not guess what counts toward your tax-exempt activity.
          </p>
        </div>
        {categories.length === 0 ? (
          <p className="text-[13px] text-mute">No categories found in the rows that are left.</p>
        ) : (
          <div className="divide-y divide-line rounded-xl border border-line bg-paper">
            {categories.map((c) => {
              const mappedId = accountMap[c.key] ?? "";
              const account = byId.get(mappedId);
              return (
                <div key={c.key} className="space-y-2 px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[13px] font-medium text-ink">
                      {c.sample} <span className="font-normal text-mute">({c.count} {c.count === 1 ? "row" : "rows"})</span>
                    </p>
                    <p className="figures text-[12px] text-mute">
                      In {money(c.totalIn)} · Out {money(c.totalOut)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label={`Account for ${c.sample}`}
                      value={mappedId}
                      onChange={(e) => mapCategory(c.key, e.target.value)}
                      className={`${INPUT} !w-full sm:!w-80`}
                    >
                      <option value="">Choose an account</option>
                      {GROUPS.map((g) => {
                        const list = mappable.filter((a) => a.type === g.type);
                        if (list.length === 0) return null;
                        return (
                          <optgroup key={g.type} label={g.label}>
                            {list.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.code} {a.name}
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                      <option value="__new__">Create a new category...</option>
                    </select>
                    {account ? <Pill tone="info">{taxEffect(account)}</Pill> : null}
                    {account && auto[c.key] === account.id ? <Pill tone="good">Matched by name</Pill> : null}
                  </div>
                  {creatingFor === c.key ? (
                    <NewCategory
                      initialName={c.sample}
                      onCancel={() => setCreatingFor(null)}
                      onCreated={(accountId) => {
                        setCreatingFor(null);
                        mapCategory(c.key, accountId);
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        <label className="flex items-start gap-3 text-[13px] text-ink">
          <input
            type="checkbox"
            checked={options.mapping_confirmed === true}
            onChange={(e) => save({ mapping_confirmed: e.target.checked }, (o) => ({ ...o, mapping_confirmed: e.target.checked }))}
            disabled={pending}
            className="mt-0.5 h-5 w-5 shrink-0"
          />
          <span>I&rsquo;ve checked that each category is matched to the right account.</span>
        </label>
      </section>

      {p.payeeValues.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h3 className="text-[14px] font-bold text-ink">Payees</h3>
            <p className={HELP}>
              Linking a payee to a contractor adds the payment to that contractor&rsquo;s 1099 total for the year. Link only contractors you paid for services.{" "}
              <Link href="/building/import/new?kind=contractors" className="font-medium text-ink underline underline-offset-2">
                Import contractors first
              </Link>
            </p>
          </div>
          <div className="divide-y divide-line rounded-xl border border-line bg-paper">
            {p.payeeValues.map((v) => (
              <div key={v.key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span className="text-[13px] text-ink">
                  {v.sample} <span className="text-mute">({v.count})</span>
                </span>
                <select
                  aria-label={`Contractor for ${v.sample}`}
                  value={payeeMap[v.key] ?? ""}
                  onChange={(e) =>
                    save({ payee_map: { [v.key]: e.target.value || null } }, (o) => ({
                      ...o,
                      payee_map: { ...((o.payee_map as Record<string, string>) ?? {}), ...(e.target.value ? { [v.key]: e.target.value } : {}) },
                    }))
                  }
                  className={`${INPUT} !w-64`}
                >
                  <option value="">Don&rsquo;t link</option>
                  {p.vendors.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {p.hasUnitColumn ? (
        <p className="text-[12px] text-mute">Every unit in your file must match one of your units. A unit that does not match shows up as a row to fix.</p>
      ) : null}
    </div>
  );
}

function NewCategory({ initialName, onCancel, onCreated }: { initialName: string; onCancel: () => void; onCreated: (accountId: string) => void }) {
  const router = useRouter();
  const [name, setName] = useState(initialName.slice(0, 80));
  const [type, setType] = useState<"income" | "expense" | null>(null);
  const [exempt, setExempt] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ready = name.trim() !== "" && type !== null && exempt !== null;

  return (
    <fieldset className="space-y-3 rounded-lg border border-line-strong bg-fill px-4 py-3">
      <legend className="px-1 text-[12px] font-medium text-ink">New category</legend>
      <div>
        <label htmlFor="new-cat-name" className={LABEL}>
          Name
        </label>
        <input id="new-cat-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className={`${INPUT} mt-1`} />
      </div>
      <fieldset>
        <legend className={LABEL}>Is this money in or money out?</legend>
        <div className="mt-1 flex gap-4 text-[13px]">
          {(["income", "expense"] as const).map((t) => (
            <label key={t} className="flex items-center gap-2">
              <input type="radio" name="new-cat-type" checked={type === t} onChange={() => setType(t)} />
              {t === "income" ? "Income" : "Expense"}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className={LABEL}>Does this count toward your association&rsquo;s tax-exempt activity?</legend>
        <div className="mt-1 flex gap-4 text-[13px]">
          <label className="flex items-center gap-2">
            <input type="radio" name="new-cat-exempt" checked={exempt === true} onChange={() => setExempt(true)} />
            Yes
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="new-cat-exempt" checked={exempt === false} onChange={() => setExempt(false)} />
            No
          </label>
        </div>
        <p className={HELP}>
          For example, assessments from owners and spending to maintain the building count. Laundry or parking income does not. If you&rsquo;re not sure, ask your
          accountant; you can change this later on the Budget page.
        </p>
      </fieldset>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!ready || pending}
          className={BTN_PRIMARY}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await createImportCategory({ name, type: type as "income" | "expense", isExempt: exempt });
              if ("error" in r) {
                setError(r.error);
                return;
              }
              router.refresh();
              onCreated(r.accountId);
            })
          }
        >
          {pending ? "Creating..." : "Create"}
        </button>
        <button type="button" onClick={onCancel} className={BTN_SECONDARY}>
          Cancel
        </button>
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Opening balances
// ---------------------------------------------------------------------------

function OpeningOptions(p: SubProps) {
  const { kind, accounts, funds, fiscalYears, get, save } = p;
  const router = useRouter();
  const asOf = get<string>("as_of") ?? "";
  const [yearError, setYearError] = useState<string | null>(null);
  const [pendingYear, startYear] = useTransition();
  const year = yearOf(asOf);
  const fy = asOf ? fiscalYears.find((f) => f.starts_on <= asOf && f.ends_on >= asOf) : undefined;
  const incomeAccounts = accounts.filter((a) => a.type === "income" && a.is_active);
  const arAccounts = accounts.filter((a) => (a.code === "1200" || a.code === "1250") && a.is_active);
  const incomeId = get<string>("income_account_id") ?? "";
  const income = incomeAccounts.find((a) => a.id === incomeId);

  return (
    <div className="space-y-6">
      <section className="max-w-md space-y-2">
        <label htmlFor="as-of" className={LABEL}>
          As of
        </label>
        <input
          id="as-of"
          type="date"
          value={asOf}
          onChange={(e) => save({ as_of: e.target.value || null }, (o) => ({ ...o, as_of: e.target.value || undefined }))}
          className={INPUT}
        />
        <p className={HELP}>The last day before your Walkup books begin. Everything in this file is as of the end of that day.</p>
        {asOf ? (
          fy ? (
            <p className="text-[13px] text-ink">
              Fiscal year {fy.label}
              {fy.status !== "open" ? <span className="text-bad-text"> ({fy.label} is closed, so nothing can be added to it.)</span> : null}
            </p>
          ) : year ? (
            <div className="space-y-2">
              <p className="text-[13px] text-warning-text">No fiscal year covers {asOf}. Add {year} to import it.</p>
              <button
                type="button"
                disabled={pendingYear}
                className={BTN_SECONDARY}
                onClick={() =>
                  startYear(async () => {
                    setYearError(null);
                    const r = await ensureFiscalYear(year);
                    if ("error" in r) setYearError(r.error);
                    else {
                      save({});
                      router.refresh();
                    }
                  })
                }
              >
                {pendingYear ? "Adding..." : `Add ${year}`}
              </button>
              {yearError ? <ErrorNote>{yearError}</ErrorNote> : null}
            </div>
          ) : null
        ) : null}
      </section>

      {kind === "opening_units" ? (
        <section className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="income-account" className={LABEL}>
              Income account
            </label>
            <select
              id="income-account"
              value={incomeId}
              onChange={(e) => save({ income_account_id: e.target.value || null }, (o) => ({ ...o, income_account_id: e.target.value || undefined }))}
              className={`${INPUT} mt-1`}
            >
              <option value="">Choose an account</option>
              {incomeAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} {a.name} ({taxEffect(a)})
                </option>
              ))}
            </select>
            <p className={HELP}>
              The income account these dues were counted under, usually Regular Assessments. When the owner pays, the tax return uses this account to count the payment.
            </p>
            {income ? <div className="mt-1"><Pill tone="info">{taxEffect(income)}</Pill></div> : null}
          </div>
          <div>
            <label htmlFor="ar-account" className={LABEL}>
              Receivable account
            </label>
            <select
              id="ar-account"
              value={get<string>("ar_account_id") ?? ""}
              onChange={(e) => save({ ar_account_id: e.target.value || null }, (o) => ({ ...o, ar_account_id: e.target.value || undefined }))}
              className={`${INPUT} mt-1`}
            >
              <option value="">Choose an account</option>
              {arAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="fund" className={LABEL}>
              Fund
            </label>
            <select
              id="fund"
              value={get<string>("fund_id") ?? ""}
              onChange={(e) => save({ fund_id: e.target.value || null }, (o) => ({ ...o, fund_id: e.target.value || undefined }))}
              className={`${INPUT} mt-1`}
            >
              <option value="">Choose a fund</option>
              {funds.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        </section>
      ) : (
        <p className="max-w-2xl text-[12px] text-mute">Accounts and funds in the file are matched to yours by exact code or name. One that does not match shows up as a row to fix.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Units and owners
// ---------------------------------------------------------------------------

function UnitsOptions(p: SubProps) {
  const { batchId, get, save, hasDues, hasPercent } = p;
  const router = useRouter();
  const [splitError, setSplitError] = useState<string | null>(null);
  const [splitting, startSplit] = useTransition();
  const replace = get<boolean>("replace_owners") === true;
  const skip = get<boolean>("skip_percentages") === true;

  return (
    <div className="space-y-6">
      <section className="max-w-md">
        <label htmlFor="effective-from" className={LABEL}>
          Owners took ownership on
        </label>
        <input
          id="effective-from"
          type="date"
          value={get<string>("effective_from") ?? ""}
          onChange={(e) => save({ effective_from: e.target.value || null }, (o) => ({ ...o, effective_from: e.target.value || undefined }))}
          className={`${INPUT} mt-1`}
        />
        <p className={HELP}>Use the earliest date you are sure of. It is when each owner&rsquo;s record starts.</p>
      </section>

      <fieldset className="max-w-xl space-y-2">
        <legend className={LABEL}>If a unit already has a different owner</legend>
        <label className="flex items-start gap-3 text-[13px] text-ink">
          <input type="radio" name="replace" checked={!replace} onChange={() => save({ replace_owners: false }, (o) => ({ ...o, replace_owners: false }))} className="mt-1" />
          <span>Stop and show me</span>
        </label>
        <label className="flex items-start gap-3 text-[13px] text-ink">
          <input type="radio" name="replace" checked={replace} onChange={() => save({ replace_owners: true }, (o) => ({ ...o, replace_owners: true }))} className="mt-1" />
          <span>
            Replace the current owner
            <span className={`${HELP} block`}>The old owner&rsquo;s record ends the day before the date above. Their history stays.</span>
          </span>
        </label>
      </fieldset>

      {hasDues ? (
        <section className="grid max-w-xl gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="freq" className={LABEL}>
              How often is that amount paid?
            </label>
            <select
              id="freq"
              value={get<string>("dues_frequency") ?? "monthly"}
              onChange={(e) => save({ dues_frequency: e.target.value }, (o) => ({ ...o, dues_frequency: e.target.value }))}
              className={`${INPUT} mt-1`}
            >
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annual">Once a year</option>
            </select>
          </div>
          <div>
            <label htmlFor="dues-start" className={LABEL}>
              Starting
            </label>
            <input
              id="dues-start"
              type="date"
              value={get<string>("dues_starts_on") ?? ""}
              onChange={(e) => save({ dues_starts_on: e.target.value || null }, (o) => ({ ...o, dues_starts_on: e.target.value || undefined }))}
              className={`${INPUT} mt-1`}
            />
            <p className={HELP}>Leave empty to start on the first of next month. Nothing is charged by importing.</p>
          </div>
        </section>
      ) : null}

      {hasPercent ? (
        <section className="max-w-xl space-y-3">
          <h3 className="text-[14px] font-bold text-ink">Ownership percentages</h3>
          <p className={HELP}>Every unit gets a share and they add up to 100, or none is recorded.</p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={splitting || skip}
              className={BTN_SECONDARY}
              onClick={() =>
                startSplit(async () => {
                  setSplitError(null);
                  const r = await splitSharesEqually(batchId);
                  if ("error" in r) setSplitError(r.error);
                  else router.refresh();
                })
              }
            >
              {splitting ? "Splitting..." : "Split equally"}
            </button>
            <label className="flex items-center gap-2 text-[13px] text-ink">
              <input type="checkbox" checked={skip} onChange={(e) => save({ skip_percentages: e.target.checked }, (o) => ({ ...o, skip_percentages: e.target.checked }))} className="h-5 w-5" />
              Leave percentages out for now
            </label>
          </div>
          {splitError ? <ErrorNote>{splitError}</ErrorNote> : null}
        </section>
      ) : null}

      <section className="max-w-xl">
        <label htmlFor="reason" className={LABEL}>
          Reason for the ownership record
        </label>
        <input
          id="reason"
          defaultValue={get<string>("amendment_reason") ?? "Imported from a spreadsheet"}
          maxLength={200}
          onBlur={(e) => save({ amendment_reason: e.target.value }, (o) => ({ ...o, amendment_reason: e.target.value }))}
          className={`${INPUT} mt-1`}
        />
      </section>
    </div>
  );
}
