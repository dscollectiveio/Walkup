"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  applyCategorizations,
  categorizeBankTransactionsBulk,
  revertCategorizations,
  type CategorizationItem,
  type PostingKind,
  type PriorState,
} from "./actions";
import {
  TransactionRow,
  labelForCategorization,
  priorOf,
  type CategorizedEvent,
  type Pickers,
  type TransactionRecord,
} from "./transaction-row";
import { money } from "@/components/ui";
import { isMatchableDescription, normalizeDescription } from "@/lib/plaid/similar";

export interface SuggestedTransaction extends TransactionRecord {
  /** Server-computed recommendation (src/lib/plaid/recommend.ts) — never written anywhere until a human clicks it. */
  suggestion: {
    kind: PostingKind;
    accountId: string | null;
    unitId: string | null;
    label: string;
    reason: string;
    /** The kind is clear but the unit/account isn't: clicking opens the form pre-set instead of saving. */
    needsPick: boolean;
  } | null;
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

interface BulkApplied {
  ids: string[];
  item: Omit<CategorizationItem, "id">;
  postNow: boolean;
  prior: PriorState[];
}

function BulkForm({
  transactionIds,
  totalLabel,
  pickers,
  initial,
  snapshot,
  onApplied,
  onCancel,
}: {
  transactionIds: string[];
  totalLabel: string;
  pickers: Pickers;
  initial: { kind: PostingKind; accountId: string | null } | null;
  snapshot: (ids: string[]) => PriorState[];
  onApplied: (e: BulkApplied) => void;
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
      const prior = snapshot(transactionIds);
      const result = await categorizeBankTransactionsBulk({
        transactionIds,
        kind,
        accountId: accountId || null,
        unitId: unitId || null,
        vendorId: vendorId || null,
        postNow,
      });
      if (result.error) setError(result.error);
      else {
        onApplied({
          ids: transactionIds,
          item: { kind, accountId: accountId || null, unitId: unitId || null, vendorId: vendorId || null },
          postNow,
          prior,
        });
      }
    });

  const selectClass = "mt-1 rounded-lg border border-line-strong bg-paper px-2 py-1 text-[12px] text-ink";

  return (
    <div className="space-y-2 rounded-xl border border-brass bg-warning-tint p-3 shadow-lg">
      <div className="text-[12px] font-medium text-ink">
        {transactionIds.length} transaction{transactionIds.length === 1 ? "" : "s"} selected
        <span className="figures ml-2 font-normal text-mute">{totalLabel}</span>
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
          Clear
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

/** A recommendation can be saved in one click only when it already names its target. */
function oneClick(t: SuggestedTransaction): boolean {
  return !!t.suggestion && !t.suggestion.needsPick;
}

const UNDO_MS = 10000;

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
  const [groupError, setGroupError] = useState<string | null>(null);

  const [toast, setToast] = useState<{ message: string; prior: PriorState[] } | null>(null);
  const [undoing, startUndo] = useTransition();
  const [undoError, setUndoError] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const priorFor = (ids: string[]): PriorState[] => {
    const wanted = new Set(ids);
    return transactions.filter((t) => wanted.has(t.id)).map(priorOf);
  };

  function announce(message: string, prior: PriorState[]) {
    setUndoError(null);
    setToast({ message, prior });
  }

  function undo() {
    if (!toast) return;
    const { prior } = toast;
    startUndo(async () => {
      const result = await revertCategorizations(prior);
      if (result.error) setUndoError(result.error);
      else setToast(null);
    });
  }

  // Same payee, same direction, still un-categorized: "COMED 8841" and
  // "COMED 9120" are one decision, so each row knows its siblings.
  const similarByRow = useMemo(() => {
    const groups = new Map<string, TransactionRecord[]>();
    for (const t of transactions) {
      if (t.posting_kind || !selectable(t)) continue;
      const key = normalizeDescription(t.description);
      if (!isMatchableDescription(key)) continue;
      const k = `${Math.sign(Number(t.amount))}:${key}`;
      const g = groups.get(k) ?? [];
      g.push(t);
      groups.set(k, g);
    }
    const byRow = new Map<string, TransactionRecord[]>();
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      for (const t of g) byRow.set(t.id, g.filter((o) => o.id !== t.id));
    }
    return byRow;
  }, [transactions]);

  async function acceptSuggestion(t: SuggestedTransaction, postNow: boolean): Promise<{ error?: string }> {
    const s = t.suggestion;
    if (!s || s.needsPick) return { error: "This recommendation needs a choice first." };
    const item = { kind: s.kind, accountId: s.accountId, unitId: s.unitId, vendorId: null };
    const rows = [t, ...(similarByRow.get(t.id) ?? [])];
    const prior = rows.map(priorOf);
    const result = await applyCategorizations({ items: rows.map((r) => ({ id: r.id, ...item })), postNow });
    if (result.error) return { error: result.error };
    if (result.errors && result.errors.length > 0 && (result.applied?.length ?? 0) === 0) {
      return { error: result.errors[0] };
    }
    const n = result.applied?.length ?? 0;
    announce(
      `${n === 1 ? "Filed" : `${n} filed`} as ${s.label}${postNow ? " and posted" : ""}.`,
      prior,
    );
    return {};
  }

  function handleCategorized(e: CategorizedEvent) {
    const label = labelForCategorization(e.item, pickers);
    const n = e.ids.length;
    announce(`${n === 1 ? "Saved" : `${n} saved`} as ${label}${e.postNow ? " and posted" : ""}.`, e.prior);
  }

  function handleBulkApplied(e: BulkApplied) {
    const label = labelForCategorization(e.item, pickers);
    announce(
      `${e.ids.length} transaction${e.ids.length === 1 ? "" : "s"} saved as ${label}${e.postNow ? " and posted" : ""}.`,
      e.prior,
    );
    setSelected(new Set());
    setPrefill(null);
  }

  // Everything with a ready-to-accept suggestion.
  const acceptable = useMemo(() => {
    const items: CategorizationItem[] = [];
    for (const t of transactions) {
      if (t.posting_kind || !selectable(t) || !t.suggestion || !oneClick(t)) continue;
      items.push({
        id: t.id,
        kind: t.suggestion.kind,
        accountId: t.suggestion.accountId,
        unitId: t.suggestion.unitId,
        vendorId: null,
      });
    }
    return items;
  }, [transactions]);

  function acceptAll() {
    const items = acceptable;
    start(async () => {
      setGroupError(null);
      const prior = priorFor(items.map((i) => i.id));
      const result = await applyCategorizations({ items, postNow: false });
      if (result.error) {
        setGroupError(result.error);
        return;
      }
      const n = result.applied?.length ?? 0;
      announce(
        `${n} suggestion${n === 1 ? "" : "s"} accepted — saved, not posted yet.${
          result.errors && result.errors.length > 0 ? ` ${result.errors.length} couldn't be applied.` : ""
        }`,
        prior,
      );
    });
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setPrefill(null);
  }

  const selectedSum = useMemo(
    () => transactions.filter((t) => selected.has(t.id)).reduce((sum, t) => sum + Number(t.amount), 0),
    [transactions, selected],
  );
  const totalLabel = `${selectedSum < 0 ? "−" : ""}${money(Math.abs(selectedSum))}`;

  const runBulk = (postNow: boolean) =>
    start(async () => {
      setBulkError(null);
      const kind = prefill?.kind ?? "expense";
      const ids = [...selected];
      const prior = priorFor(ids);
      const result = await categorizeBankTransactionsBulk({
        transactionIds: ids,
        kind,
        accountId: prefill?.accountId ?? null,
        unitId: null,
        vendorId: null,
        postNow,
      });
      if (result.error) setBulkError(result.error);
      else {
        handleBulkApplied({
          ids,
          item: { kind, accountId: prefill?.accountId ?? null, unitId: null, vendorId: null },
          postNow,
          prior,
        });
      }
    });

  const btnPrimary =
    "rounded-md bg-ink px-2.5 py-1 text-[11px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50";
  const btnGhost =
    "rounded-md border border-line-strong px-2.5 py-1 text-[11px] text-ink hover:bg-fill disabled:opacity-50";

  return (
    <div>
      {canEdit && acceptable.length > 1 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={acceptAll}
            className="rounded-full bg-ink px-3 py-1.5 text-[12px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
          >
            {pending ? "Saving…" : `Accept all ${acceptable.length} recommendations`}
          </button>
          <span className="text-[11px] text-mute">Saved, not posted — you can undo for 10 seconds.</span>
          {groupError ? <span className="w-full text-[11px] text-bad-text">{groupError}</span> : null}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[12px] text-mute">
              {canEdit ? <th className="w-6 pb-2" /> : null}
              <SortableHeader href={dateHref} active={sort === "date_asc" || sort === "date_desc"} ascending={sort === "date_asc"}>
                Date
              </SortableHeader>
              <SortableHeader href={nameHref} active={sort === "name_asc" || sort === "name_desc"} ascending={sort === "name_asc"}>
                Description
              </SortableHeader>
              <th className="pb-2 font-medium">Category</th>
              <SortableHeader
                href={amountHref}
                active={sort === "amount_asc" || sort === "amount_desc"}
                ascending={sort === "amount_asc"}
                align="right"
              >
                Amount
              </SortableHeader>
              {canEdit ? <th className="w-[10rem] pb-2" /> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {transactions.map((t) => (
              <TransactionRow
                key={t.id}
                transaction={t}
                pickers={pickers}
                canEdit={canEdit}
                suggestion={t.suggestion}
                similar={similarByRow.get(t.id) ?? []}
                onAcceptSuggestion={(postNow) => acceptSuggestion(t, postNow)}
                onCategorized={handleCategorized}
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

      {/* Selection bar: pinned to the bottom of the screen so it's never scrolled away from the rows. */}
      {canEdit && selected.size > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 pl-[calc(var(--sidebar-width)+1rem)] pr-4 min-[900px]:pl-[calc(var(--sidebar-width)+1.5rem)] min-[900px]:pr-8">
          <div className="pointer-events-auto mx-auto max-h-[60vh] max-w-[1100px] overflow-y-auto rounded-xl">
            {prefill ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brass bg-warning-tint p-3 shadow-lg">
                <span className="text-[12px] text-ink">
                  Post {selected.size} transaction{selected.size === 1 ? "" : "s"}{" "}
                  <span className="figures text-mute">({totalLabel})</span> as{" "}
                  <span className="font-medium">{prefill.label}</span>?
                </span>
                <button type="button" disabled={pending} onClick={() => runBulk(true)} className={btnPrimary}>
                  {pending ? "Saving…" : "Save & post all"}
                </button>
                <button type="button" disabled={pending} onClick={() => runBulk(false)} className={btnGhost}>
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
                  Clear
                </button>
                {bulkError ? <span className="w-full text-[11px] text-bad-text">{bulkError}</span> : null}
              </div>
            ) : (
              <BulkForm
                transactionIds={[...selected]}
                totalLabel={totalLabel}
                pickers={pickers}
                initial={null}
                snapshot={priorFor}
                onCancel={() => setSelected(new Set())}
                onApplied={handleBulkApplied}
              />
            )}
          </div>
        </div>
      ) : null}

      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 z-40 flex max-w-[92vw] -translate-x-1/2 items-center gap-3 rounded-lg bg-ink px-4 py-2.5 text-[13px] text-paper shadow-lg"
        >
          <span>{undoError ?? toast.message}</span>
          <button
            type="button"
            disabled={undoing}
            onClick={undo}
            className="rounded-md border border-ondark-mute px-2.5 py-0.5 text-[12px] font-medium hover:bg-ink-mid disabled:opacity-50"
          >
            {undoing ? "Undoing…" : "Undo"}
          </button>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Dismiss"
            className="text-ondark-mute hover:text-paper"
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
