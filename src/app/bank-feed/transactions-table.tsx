"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { categorizeBankTransactionsBulk } from "./actions";
import { TransactionRow, type Pickers, type TransactionRecord } from "./transaction-row";
import type { PostingKind } from "./actions";

export interface SuggestedTransaction extends TransactionRecord {
  /** Server-computed guess (src/lib/plaid/suggest.ts) — never written anywhere until a human confirms it here. */
  suggestion: { kind: PostingKind; accountId: string | null; label: string } | null;
}

const KIND_LABEL: Record<PostingKind, string> = {
  expense: "Expense",
  income: "Other income",
  dues: "Dues",
  transfer: "Transfer",
  excluded: "Not for the books",
};

function selectable(t: TransactionRecord): boolean {
  return !t.journal_entry_id && !t.removed_at;
}

function BulkForm({
  transactionIds,
  pickers,
  initial,
  onDone,
  onCancel,
}: {
  transactionIds: string[];
  pickers: Pickers;
  initial: { kind: PostingKind; accountId: string | null } | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<PostingKind>(initial?.kind ?? "expense");
  const [accountId, setAccountId] = useState(initial?.accountId ?? "");
  const [unitId, setUnitId] = useState("");
  const [vendorId, setVendorId] = useState("");
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
      const result = await categorizeBankTransactionsBulk({
        transactionIds,
        kind,
        accountId: accountId || null,
        unitId: unitId || null,
        vendorId: vendorId || null,
        postNow,
      });
      if (result.error) setError(result.error);
      else onDone();
    });

  const selectClass = "mt-1 rounded-lg border border-line-strong bg-paper px-2 py-1 text-[12px] text-ink";

  return (
    <div className="mb-4 space-y-2 rounded-lg border border-brass bg-warning-tint p-3">
      <div className="text-[12px] font-medium text-ink">
        {transactionIds.length} transaction{transactionIds.length === 1 ? "" : "s"} selected
      </div>
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
            {(["expense", "income", "dues", "transfer", "excluded"] as PostingKind[]).map((k) => (
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
              Vendor <span className="text-mute-soft">(optional)</span>
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
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => submit(true)}
          className="rounded-md bg-ink px-2.5 py-1 text-[11px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save & post all"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => submit(false)}
          className="rounded-md border border-line-strong px-2.5 py-1 text-[11px] text-ink hover:bg-fill disabled:opacity-50"
        >
          Save all for later
        </button>
        <button type="button" onClick={onCancel} className="text-[11px] text-mute underline-offset-2 hover:underline">
          Cancel
        </button>
        {error ? <span className="w-full text-[11px] text-bad-text">{error}</span> : null}
      </div>
    </div>
  );
}

export type Sort = "date_desc" | "date_asc" | "name_asc" | "name_desc" | "amount_desc" | "amount_asc";

function SortableHeader({
  href,
  active,
  ascending,
  children,
  align,
}: {
  href: string;
  active: boolean;
  ascending: boolean;
  children: React.ReactNode;
  align?: "right";
}) {
  return (
    <th className={`pb-2 font-medium ${align === "right" ? "text-right" : ""}`}>
      <Link href={href} className={`hover:text-ink ${active ? "text-ink" : ""}`}>
        {children}
        {active ? <span className="ml-0.5">{ascending ? "▲" : "▼"}</span> : null}
      </Link>
    </th>
  );
}

export function TransactionsTable({
  transactions,
  pickers,
  canEdit,
  sort,
  dateHref,
  nameHref,
  amountHref,
}: {
  transactions: SuggestedTransaction[];
  pickers: Pickers;
  canEdit: boolean;
  sort: Sort;
  dateHref: string;
  nameHref: string;
  amountHref: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [prefill, setPrefill] = useState<{ kind: PostingKind; accountId: string | null; label: string } | null>(
    null,
  );
  const [pending, start] = useTransition();
  const [bulkError, setBulkError] = useState<string | null>(null);

  const suggestionGroups = useMemo(() => {
    const groups = new Map<string, { label: string; kind: PostingKind; accountId: string | null; ids: string[] }>();
    for (const t of transactions) {
      if (t.posting_kind || !selectable(t) || !t.suggestion) continue;
      const key = `${t.suggestion.kind}:${t.suggestion.accountId ?? ""}`;
      const g = groups.get(key) ?? {
        label: t.suggestion.label,
        kind: t.suggestion.kind,
        accountId: t.suggestion.accountId,
        ids: [],
      };
      g.ids.push(t.id);
      groups.set(key, g);
    }
    return [...groups.values()].filter((g) => g.ids.length >= 2).sort((a, b) => b.ids.length - a.ids.length);
  }, [transactions]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setPrefill(null);
  }

  function selectGroup(group: { ids: string[]; kind: PostingKind; accountId: string | null; label: string }) {
    setSelected(new Set(group.ids));
    setPrefill({ kind: group.kind, accountId: group.accountId, label: group.label });
  }

  const runBulk = (postNow: boolean) =>
    start(async () => {
      setBulkError(null);
      const kind = prefill?.kind ?? "expense";
      const result = await categorizeBankTransactionsBulk({
        transactionIds: [...selected],
        kind,
        accountId: prefill?.accountId ?? null,
        unitId: null,
        vendorId: null,
        postNow,
      });
      if (result.error) setBulkError(result.error);
      else {
        setSelected(new Set());
        setPrefill(null);
      }
    });

  return (
    <div>
      {canEdit && suggestionGroups.length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {suggestionGroups.map((g) => (
            <button
              key={`${g.kind}:${g.accountId}`}
              type="button"
              onClick={() => selectGroup(g)}
              className="rounded-full border border-line-strong bg-fill px-3 py-1.5 text-[12px] text-ink hover:bg-line"
            >
              {g.ids.length} suggested as <span className="font-medium">{g.label}</span> — Select all
            </button>
          ))}
        </div>
      ) : null}

      {canEdit && selected.size > 0 ? (
        prefill ? (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-brass bg-warning-tint p-3">
            <span className="text-[12px] text-ink">
              Post {selected.size} transaction{selected.size === 1 ? "" : "s"} as{" "}
              <span className="font-medium">{prefill.label}</span>?
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() => runBulk(true)}
              className="rounded-md bg-ink px-2.5 py-1 text-[11px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save & post all"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => runBulk(false)}
              className="rounded-md border border-line-strong px-2.5 py-1 text-[11px] text-ink hover:bg-fill disabled:opacity-50"
            >
              Save all for later
            </button>
            <button
              type="button"
              onClick={() => {
                setSelected(new Set());
                setPrefill(null);
              }}
              className="text-[11px] text-mute underline-offset-2 hover:underline"
            >
              Cancel
            </button>
            {bulkError ? <span className="w-full text-[11px] text-bad-text">{bulkError}</span> : null}
          </div>
        ) : (
          <BulkForm
            transactionIds={[...selected]}
            pickers={pickers}
            initial={null}
            onCancel={() => setSelected(new Set())}
            onDone={() => setSelected(new Set())}
          />
        )
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-mute">
              {canEdit ? <th className="w-8 pb-2" /> : null}
              <SortableHeader href={dateHref} active={sort === "date_asc" || sort === "date_desc"} ascending={sort === "date_asc"}>
                Date
              </SortableHeader>
              <SortableHeader href={nameHref} active={sort === "name_asc" || sort === "name_desc"} ascending={sort === "name_asc"}>
                Description
              </SortableHeader>
              <SortableHeader
                href={amountHref}
                active={sort === "amount_asc" || sort === "amount_desc"}
                ascending={sort === "amount_asc"}
                align="right"
              >
                Amount
              </SortableHeader>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {transactions.map((t) => (
              <TransactionRow
                key={t.id}
                transaction={t}
                pickers={pickers}
                canEdit={canEdit}
                leadingCell={
                  canEdit ? (
                    selectable(t) ? (
                      <input
                        type="checkbox"
                        checked={selected.has(t.id)}
                        onChange={() => toggle(t.id)}
                        aria-label={`Select ${t.description}`}
                      />
                    ) : null
                  ) : undefined
                }
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
