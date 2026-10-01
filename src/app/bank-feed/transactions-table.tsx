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

/** A suggestion can be accepted in one click only when it already names its target. */
function oneClick(t: SuggestedTransaction): { label: string } | null {
  const s = t.suggestion;
  if (!s) return null;
  return s.accountId || s.kind === "excluded" ? { label: s.label } : null;
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

  const [toast, setToast] = useState<{ message: string; prior: PriorState[] } | null>(null);
  const [undoing, startUndo] = useTransition();
  const [undoError, setUndoError] = useState<string | null>(null);
  const [similar, setSimilar] = useState<{
    description: string;
    label: string;
    item: Omit<CategorizationItem, "id">;
    ids: string[];
  } | null>(null);
  const [acceptAllOpen, setAcceptAllOpen] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);

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
      else {
        setToast(null);
        setSimilar(null);
      }
    });
  }

  /** After one row is categorized, offer the same for other un-categorized rows from the same payee. */
  function offerSimilar(source: TransactionRecord, item: Omit<CategorizationItem, "id">, label: string) {
    const key = normalizeDescription(source.description);
    if (!isMatchableDescription(key)) {
      setSimilar(null);
      return;
    }
    const direction = Math.sign(Number(source.amount));
    const matches = transactions.filter(
      (o) =>
        o.id !== source.id &&
        !o.posting_kind &&
        selectable(o) &&
        Math.sign(Number(o.amount)) === direction &&
        normalizeDescription(o.description) === key,
    );
    setSimilar(
      matches.length > 0
        ? { description: source.description.trim(), label, item, ids: matches.map((m) => m.id) }
        : null,
    );
  }

  async function acceptSuggestion(t: SuggestedTransaction, postNow: boolean): Promise<{ error?: string }> {
    const s = t.suggestion;
    if (!s || (!s.accountId && s.kind !== "excluded")) return { error: "This suggestion needs a choice first." };
    const item = { kind: s.kind, accountId: s.accountId, unitId: null, vendorId: null };
    const prior = [priorOf(t)];
    const result = await applyCategorizations({ items: [{ id: t.id, ...item }], postNow });
    if (result.error) return { error: result.error };
    if (result.errors && result.errors.length > 0) return { error: result.errors[0] };
    announce(`Categorized as ${s.label}${postNow ? " and posted" : ""}.`, prior);
    offerSimilar(t, item, s.label);
    return {};
  }

  function handleCategorized(e: CategorizedEvent) {
    const source = transactions.find((t) => t.id === e.item.id);
    const { id: _id, ...item } = e.item;
    void _id;
    const label = labelForCategorization(e.item, pickers);
    announce(`Saved as ${label}${e.postNow ? " and posted" : ""}.`, [e.prior]);
    if (source) offerSimilar(source, item, label);
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

  // Everything with a ready-to-accept suggestion, grouped by where it would go.
  const acceptable = useMemo(() => {
    const byLabel = new Map<string, { label: string; items: CategorizationItem[] }>();
    for (const t of transactions) {
      if (t.posting_kind || !selectable(t) || !t.suggestion) continue;
      if (!oneClick(t)) continue;
      const g = byLabel.get(t.suggestion.label) ?? { label: t.suggestion.label, items: [] };
      g.items.push({
        id: t.id,
        kind: t.suggestion.kind,
        accountId: t.suggestion.accountId,
        unitId: null,
        vendorId: null,
      });
      byLabel.set(t.suggestion.label, g);
    }
    const groups = [...byLabel.values()].sort((a, b) => b.items.length - a.items.length);
    return { groups, total: groups.reduce((n, g) => n + g.items.length, 0) };
  }, [transactions]);

  function acceptAll() {
    const items = acceptable.groups.flatMap((g) => g.items);
    start(async () => {
      setGroupError(null);
      const prior = priorFor(items.map((i) => i.id));
      const result = await applyCategorizations({ items, postNow: false });
      if (result.error) {
        setGroupError(result.error);
        return;
      }
      setAcceptAllOpen(false);
      const n = result.applied?.length ?? 0;
      announce(
        `${n} suggestion${n === 1 ? "" : "s"} accepted — saved, not posted yet.${
          result.errors && result.errors.length > 0 ? ` ${result.errors.length} couldn't be applied.` : ""
        }`,
        prior,
      );
    });
  }

  function applySimilar() {
    if (!similar) return;
    const current = similar;
    start(async () => {
      setGroupError(null);
      const prior = priorFor(current.ids);
      const result = await applyCategorizations({
        items: current.ids.map((id) => ({ id, ...current.item })),
        postNow: false,
      });
      if (result.error) {
        setGroupError(result.error);
        return;
      }
      setSimilar(null);
      const n = result.applied?.length ?? 0;
      announce(`${n} more saved as ${current.label}.`, prior);
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

  function selectGroup(group: { ids: string[]; kind: PostingKind; accountId: string | null; label: string }) {
    setSelected(new Set(group.ids));
    setPrefill({ kind: group.kind, accountId: group.accountId, label: group.label });
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
      {canEdit && (suggestionGroups.length > 0 || acceptable.total > 0) ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {acceptable.total > 0 ? (
            <button
              type="button"
              onClick={() => setAcceptAllOpen((o) => !o)}
              aria-expanded={acceptAllOpen}
              className="rounded-full bg-ink px-3 py-1.5 text-[12px] font-medium text-paper hover:bg-ink-mid"
            >
              Accept all {acceptable.total} suggestion{acceptable.total === 1 ? "" : "s"}
            </button>
          ) : null}
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

      {canEdit && acceptAllOpen && acceptable.total > 0 ? (
        <div className="mb-4 rounded-lg border border-line-strong bg-fill p-3">
          <p className="text-[12px] font-medium text-ink">
            Save these {acceptable.total} suggestions? They won&rsquo;t be posted to the books yet — you can review
            first, and Undo is available afterwards.
          </p>
          <ul className="mt-2 grid gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2">
            {acceptable.groups.map((g) => (
              <li key={g.label} className="flex justify-between gap-3">
                <span className="text-ink">{g.label}</span>
                <span className="figures text-mute">{g.items.length}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" disabled={pending} onClick={acceptAll} className={btnPrimary}>
              {pending ? "Saving…" : `Save ${acceptable.total}`}
            </button>
            <button type="button" onClick={() => setAcceptAllOpen(false)} className="text-[11px] text-mute underline-offset-2 hover:underline">
              Cancel
            </button>
            {groupError ? <span className="w-full text-[11px] text-bad-text">{groupError}</span> : null}
          </div>
        </div>
      ) : null}

      {canEdit && similar ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-info-text/30 bg-info-tint p-3">
          <span className="text-[12px] text-info-text">
            {similar.ids.length} other transaction{similar.ids.length === 1 ? "" : "s"} {similar.ids.length === 1 ? "says" : "say"} “{similar.description}” — save{" "}
            {similar.ids.length === 1 ? "it" : "them"} as <span className="font-medium">{similar.label}</span> too?
          </span>
          <button type="button" disabled={pending} onClick={applySimilar} className={btnPrimary}>
            {pending ? "Saving…" : `Yes, save ${similar.ids.length}`}
          </button>
          <button type="button" onClick={() => setSimilar(null)} className="text-[11px] text-info-text underline-offset-2 hover:underline">
            No thanks
          </button>
          {groupError && !acceptAllOpen ? <span className="w-full text-[11px] text-bad-text">{groupError}</span> : null}
        </div>
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
                suggestion={oneClick(t)}
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
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 pl-[4.5rem] pr-4 min-[900px]:pl-[calc(232px+1.5rem)] min-[900px]:pr-8">
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
