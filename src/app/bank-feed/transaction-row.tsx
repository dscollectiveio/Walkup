"use client";

import { useState, useTransition } from "react";
import {
  categorizeBankTransaction,
  postBankTransaction,
  unpostBankTransaction,
  type PostingKind,
} from "./actions";
import { money } from "@/components/ui";

export interface TransactionRecord {
  id: string;
  posted_on: string;
  description: string;
  amount: string | number;
  pending: boolean;
  raw_category: string | null;
  posting_kind: PostingKind | null;
  account_id: string | null;
  matched_unit_id: string | null;
  vendor_id: string | null;
  journal_entry_id: string | null;
  excluded_at: string | null;
  removed_at: string | null;
}

export interface Option {
  id: string;
  label: string;
}

export interface Pickers {
  expenseAccounts: Option[];
  incomeAccounts: Option[];
  cashAccounts: Option[];
  units: Option[];
  vendors: Option[];
}

const KIND_LABEL: Record<PostingKind, string> = {
  expense: "Expense",
  income: "Other income",
  dues: "Dues",
  transfer: "Transfer",
  excluded: "Not for the books",
};

function describeTarget(t: TransactionRecord, pickers: Pickers): string | null {
  if (!t.posting_kind) return null;
  const find = (list: Option[], id: string | null) => list.find((o) => o.id === id)?.label ?? null;
  switch (t.posting_kind) {
    case "expense":
      return find(pickers.expenseAccounts, t.account_id);
    case "income":
      return find(pickers.incomeAccounts, t.account_id);
    case "transfer":
      return find(pickers.cashAccounts, t.account_id);
    case "dues":
      return find(pickers.units, t.matched_unit_id);
    default:
      return null;
  }
}

function StatusPill({ t }: { t: TransactionRecord }) {
  if (t.removed_at && t.journal_entry_id) {
    return <Pill tone="bad">Retracted by bank — review</Pill>;
  }
  if (t.removed_at) return <Pill tone="mute">Retracted by bank</Pill>;
  if (t.journal_entry_id) return <Pill tone="good">Posted</Pill>;
  if (t.excluded_at) return <Pill tone="mute">Excluded</Pill>;
  if (t.pending) return <Pill tone="mute">Pending</Pill>;
  if (t.posting_kind) return <Pill tone="info">Ready to post</Pill>;
  return <Pill tone="warning">Needs category</Pill>;
}

function Pill({ tone, children }: { tone: "good" | "bad" | "info" | "warning" | "mute"; children: React.ReactNode }) {
  const cls =
    tone === "good"
      ? "bg-good-tint text-good-text"
      : tone === "bad"
        ? "bg-bad-tint text-bad-text"
        : tone === "info"
          ? "bg-info-tint text-info-text"
          : tone === "warning"
            ? "bg-warning-tint text-warning-text"
            : "bg-fill text-mute";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] ${cls}`}>{children}</span>;
}

function CategorizeForm({
  t,
  pickers,
  onDone,
}: {
  t: TransactionRecord;
  pickers: Pickers;
  onDone: () => void;
}) {
  const moneyIn = Number(t.amount) > 0;
  const kinds: PostingKind[] = moneyIn
    ? ["dues", "income", "transfer", "excluded"]
    : ["expense", "transfer", "excluded"];

  const [kind, setKind] = useState<PostingKind>(t.posting_kind ?? kinds[0]);
  const [accountId, setAccountId] = useState(t.account_id ?? "");
  const [unitId, setUnitId] = useState(t.matched_unit_id ?? "");
  const [vendorId, setVendorId] = useState(t.vendor_id ?? "");
  const [saveRule, setSaveRule] = useState(false);
  const [autoPostRule, setAutoPostRule] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const accountOptions =
    kind === "expense"
      ? pickers.expenseAccounts
      : kind === "income"
        ? pickers.incomeAccounts
        : kind === "transfer"
          ? pickers.cashAccounts
          : [];

  const submit = (postNow: boolean) =>
    start(async () => {
      setError(null);
      const result = await categorizeBankTransaction({
        transactionId: t.id,
        kind,
        accountId: accountId || null,
        unitId: unitId || null,
        vendorId: vendorId || null,
        saveRule,
        autoPostRule: saveRule && autoPostRule,
        postNow,
      });
      if (result.error) setError(result.error);
      else onDone();
    });

  const selectClass =
    "mt-1 rounded-lg border border-line-strong bg-paper px-2 py-1 text-[12px] text-ink";

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-line-strong bg-fill p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11px] text-mute">This is</label>
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as PostingKind);
              setAccountId("");
            }}
            className={selectClass}
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>

        {kind === "dues" ? (
          <div>
            <label className="block text-[11px] text-mute">Unit</label>
            <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className={selectClass}>
              <option value="">Choose…</option>
              {pickers.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {accountOptions.length > 0 || kind === "transfer" ? (
          <div>
            <label className="block text-[11px] text-mute">
              {kind === "transfer" ? "To / from account" : "Account"}
            </label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={selectClass}>
              <option value="">Choose…</option>
              {accountOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {kind === "expense" && pickers.vendors.length > 0 ? (
          <div>
            <label className="block text-[11px] text-mute">
              Vendor <span className="text-mute-soft">(optional, for 1099s)</span>
            </label>
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={selectClass}>
              <option value="">No vendor</option>
              {pickers.vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={saveRule} onChange={(e) => setSaveRule(e.target.checked)} />
          Remember this for “{t.description.trim()}”
        </label>
        {saveRule ? (
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={autoPostRule}
              onChange={(e) => setAutoPostRule(e.target.checked)}
            />
            and post matches automatically on sync
          </label>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending || t.pending}
          onClick={() => submit(true)}
          title={t.pending ? "Pending transactions can't be posted until the bank settles them" : undefined}
          className="rounded-md bg-ink px-2.5 py-1 text-[11px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
        >
          {pending ? "Saving…" : kind === "excluded" ? "Save & exclude" : "Save & post"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => submit(false)}
          className="rounded-md border border-line-strong px-2.5 py-1 text-[11px] text-ink hover:bg-fill disabled:opacity-50"
        >
          Save for later
        </button>
        <button type="button" onClick={onDone} className="text-[11px] text-mute underline-offset-2 hover:underline">
          Cancel
        </button>
        {error ? <span className="w-full text-[11px] text-bad-text">{error}</span> : null}
      </div>
    </div>
  );
}

export function TransactionRow({
  transaction: t,
  pickers,
  canEdit,
}: {
  transaction: TransactionRecord;
  pickers: Pickers;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const amount = Number(t.amount);
  const target = describeTarget(t, pickers);

  const run = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      setError(null);
      const result = await fn();
      if (result.error) setError(result.error);
    });

  const canPost = canEdit && !t.journal_entry_id && !t.pending && !t.removed_at && !!t.posting_kind && !t.excluded_at;

  return (
    <tr className={t.removed_at && !t.journal_entry_id ? "opacity-60" : ""}>
      <td className="figures py-2 align-top text-ink">{t.posted_on}</td>
      <td className="py-2 align-top text-ink">
        <div className="flex flex-wrap items-center gap-2">
          <span>{t.description}</span>
          <StatusPill t={t} />
          {t.posting_kind ? (
            <span className="text-[11px] text-mute">
              {KIND_LABEL[t.posting_kind]}
              {target ? ` · ${target}` : ""}
            </span>
          ) : t.raw_category ? (
            <span className="text-[11px] text-mute-soft">bank says: {t.raw_category}</span>
          ) : null}
        </div>

        {canEdit && !editing ? (
          <div className="mt-1 flex flex-wrap gap-3 text-[11px]">
            {!t.journal_entry_id && !t.removed_at ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-mute underline-offset-2 hover:underline"
              >
                {t.posting_kind ? "Edit" : "Categorize"}
              </button>
            ) : null}
            {canPost ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => postBankTransaction(t.id))}
                className="font-medium text-ink underline-offset-2 hover:underline disabled:opacity-50"
              >
                {busy ? "Posting…" : "Post"}
              </button>
            ) : null}
            {t.journal_entry_id ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => unpostBankTransaction(t.id))}
                className="text-mute underline-offset-2 hover:underline disabled:opacity-50"
              >
                {busy ? "Undoing…" : "Undo posting"}
              </button>
            ) : null}
          </div>
        ) : null}

        {editing ? <CategorizeForm t={t} pickers={pickers} onDone={() => setEditing(false)} /> : null}
        {error ? <p className="mt-1 text-[11px] text-bad-text">{error}</p> : null}
      </td>
      <td className="figures py-2 text-right align-top text-ink">
        {amount < 0 ? "−" : ""}
        {money(Math.abs(amount))}
      </td>
    </tr>
  );
}
