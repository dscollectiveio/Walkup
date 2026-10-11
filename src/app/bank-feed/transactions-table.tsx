"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  applyCategorizations,
  categorizeBankTransactionsBulk,
  postBankTransaction,
  revertCategorizations,
  saveCategorizationRule,
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
  type RowRecommendation,
  type TransactionRecord,
} from "./transaction-row";
import { CategoryPicker, type CategoryChoice, type Direction } from "./category-picker";
import type { Sort } from "./href";
import { PREVIEW_ABOVE, PostPreview, inOutLabel, type PreviewRow } from "./post-preview";
import { money } from "@/components/ui";
import { isMatchableDescription, normalizeDescription } from "@/lib/plaid/similar";

export interface SuggestedTransaction extends TransactionRecord {
  /** Server-computed recommendation (src/lib/plaid/recommend.ts) — never written anywhere until a human clicks it. */
  suggestion: RowRecommendation | null;
  /** What this payee usually costs, in cents, from the board's own history; null for a first-time payee. */
  typicalCents: number | null;
  /** Pattern of the rule in rule_id, when the sync filed this row by a rule. */
  rulePattern: string | null;
}

function selectable(t: TransactionRecord): boolean {
  return !t.journal_entry_id && !t.removed_at;
}

/**
 * Plain words for the toast, honest about what reached the books: `n` rows
 * took the category and `posted` of them were posted. "Posted as Utilities",
 * "3 saved as Dues · 2B", "Marked not for the books", "2 posted as Utilities
 * · 1 couldn't be posted yet" (a pending sibling, say).
 */
function outcome(o: { n: number; label: string; kind: PostingKind; postNow: boolean; posted: number }): string {
  const one = o.n === 1;
  const saved = one ? `Saved as ${o.label}` : `${o.n} saved as ${o.label}`;
  if (!o.postNow) return saved;
  const left = o.n - o.posted;
  const notYet = left === 0 ? "" : ` · ${left === o.n && one ? "it" : left} couldn't be posted yet`;
  if (o.posted === 0) return `${saved}${notYet}`;
  const done =
    o.kind === "excluded"
      ? one
        ? "Marked not for the books"
        : `${o.posted} marked not for the books`
      : one
        ? `Posted as ${o.label}`
        : `${o.posted} posted as ${o.label}`;
  return `${done}${notYet}`;
}

interface BulkApplied {
  ids: string[];
  item: Omit<CategorizationItem, "id">;
  postNow: boolean;
  posted: number;
  prior: PriorState[];
}

function BulkForm({
  transactionIds,
  totalLabel,
  direction,
  pickers,
  snapshot,
  confirmPost,
  onApplied,
  onCancel,
}: {
  transactionIds: string[];
  totalLabel: string;
  direction: Direction;
  pickers: Pickers;
  snapshot: (ids: string[]) => PriorState[];
  /** Runs `post` straight away, or after a look when there are many rows. */
  confirmPost: (ids: string[], post: () => void) => void;
  onApplied: (e: BulkApplied) => void;
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState<CategoryChoice | null>(null);
  const [vendorId, setVendorId] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (postNow: boolean) =>
    start(async () => {
      if (!choice) return;
      setError(null);
      const item = {
        kind: choice.kind,
        accountId: choice.accountId,
        unitId: choice.unitId,
        vendorId: choice.kind === "expense" && vendorId ? vendorId : null,
      };
      const prior = snapshot(transactionIds);
      const result = await categorizeBankTransactionsBulk({ transactionIds, ...item, postNow });
      if (result.error) setError(result.error);
      else onApplied({ ids: result.applied ?? transactionIds, item, postNow, posted: result.posted ?? 0, prior });
    });

  const submit = (postNow: boolean) => {
    if (!choice) {
      setError("Pick a category first.");
      return;
    }
    if (postNow) confirmPost(transactionIds, () => run(true));
    else run(false);
  };

  return (
    <div className="space-y-2 rounded-xl border border-brass bg-warning-tint p-3 shadow-lg">
      <div className="text-[12px] font-medium text-ink">
        {transactionIds.length} transaction{transactionIds.length === 1 ? "" : "s"} selected
        <span className="figures ml-2 font-normal text-mute">{totalLabel}</span>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11px] text-mute">File them all as</label>
          <CategoryPicker pickers={pickers} direction={direction} value={choice} onChange={setChoice} autoFocus />
        </div>
        {choice?.kind === "expense" && pickers.vendors.length > 0 ? (
          <div>
            <label className="block text-[11px] text-mute">
              Vendor <span className="text-mute-soft">(optional)</span>
            </label>
            <select
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              className="mt-1 rounded-lg border border-line-strong bg-paper px-2 py-1.5 text-[12px] text-ink"
            >
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
          disabled={pending || !choice}
          onClick={() => submit(true)}
          className="rounded-md bg-ink px-2.5 py-1 text-[11px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
        >
          {pending ? "Saving…" : choice?.kind === "excluded" ? "Keep all out of the books" : "Save & post all"}
        </button>
        <button
          type="button"
          disabled={pending || !choice}
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

/** A recommendation can be applied in one click only when it already names its target. */
function oneClick(t: SuggestedTransaction): t is SuggestedTransaction & { suggestion: RowRecommendation } {
  return !!t.suggestion && !t.suggestion.needsPick;
}

const UNDO_MS = 10000;
/** A toast that also asks about a rule stays a little longer. */
const UNDO_WITH_RULE_MS = 20000;

interface Toast {
  message: string;
  prior: PriorState[];
  /** "Always file ‘pattern’ as label?" — label is the one the toast already used for the item. */
  rule?: { pattern: string; label: string; item: Omit<CategorizationItem, "id"> };
}

const LINK_QUIET = "text-[11px] text-mute underline-offset-2 hover:text-ink hover:underline disabled:opacity-50";

/** True when a key press came from somewhere that is already using the keyboard. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
}

/** Buttons and links act on Enter themselves; the table must not act too. */
function isInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return isTyping(target) || tag === "BUTTON" || tag === "A" || tag === "SUMMARY";
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
  const [pending, start] = useTransition();
  const [groupError, setGroupError] = useState<string | null>(null);

  const [toast, setToast] = useState<Toast | null>(null);
  const [undoing, startUndo] = useTransition();
  const [undoError, setUndoError] = useState<string | null>(null);

  /** A bulk post of many rows waiting for a look: what to post, and how. */
  const [confirm, setConfirm] = useState<{ rows: PreviewRow[]; run: () => void } | null>(null);

  // Keyboard: which row j/k has landed on, and which row's form is open.
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.rule ? UNDO_WITH_RULE_MS : UNDO_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const priorFor = (ids: string[]): PriorState[] => {
    const wanted = new Set(ids);
    return transactions.filter((t) => wanted.has(t.id)).map(priorOf);
  };
  const rowsFor = (ids: string[]): SuggestedTransaction[] => {
    const wanted = new Set(ids);
    return transactions.filter((t) => wanted.has(t.id));
  };
  const previewFor = (ids: string[]): PreviewRow[] =>
    rowsFor(ids).map((t) => ({ id: t.id, description: t.description, amount: t.amount, typicalCents: t.typicalCents }));

  function announce(message: string, prior: PriorState[], rule?: Toast["rule"]) {
    setUndoError(null);
    setToast({ message, prior, rule });
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

  /** Yes to "Always file X as Y?". The toast then says only that; Undo would not undo the rule, so it goes (Rules · N has Remove). */
  function saveRule() {
    if (!toast?.rule) return;
    const { pattern, label, item } = toast.rule;
    startUndo(async () => {
      const result = await saveCategorizationRule({ pattern, ...item });
      if (result.error) setUndoError(result.error);
      else setToast({ message: `New ‘${pattern}’ rows will be filed as ${label}`, prior: [] });
    });
  }

  /** Posts more than PREVIEW_ABOVE rows only after a look at what that means. */
  function confirmPost(ids: string[], run: () => void) {
    if (ids.length > PREVIEW_ABOVE) setConfirm({ rows: previewFor(ids), run });
    else run();
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
    // A duplicate is one deposit matching one hand-recorded payment: this row
    // only. Anything else takes the same-payee rows with it.
    const rows = s.source === "duplicate" ? [t] : [t, ...(similarByRow.get(t.id) ?? [])];
    const prior = rows.map(priorOf);
    const result = await applyCategorizations({ items: rows.map((r) => ({ id: r.id, ...item })), postNow });
    if (result.error) return { error: result.error };
    if (result.errors && result.errors.length > 0 && (result.applied?.length ?? 0) === 0) {
      return { error: result.errors[0] };
    }
    const n = result.applied?.length ?? 0;
    announce(outcome({ n, label: s.label, kind: s.kind, postNow, posted: result.posted ?? 0 }), prior);
    return {};
  }

  /** Enter on a row that already has a category: post it, with Undo. */
  async function postRow(t: SuggestedTransaction): Promise<{ error?: string }> {
    if (!t.posting_kind) return { error: "Categorize this transaction first." };
    const result = await postBankTransaction(t.id);
    if (result.error) return result;
    const item = { kind: t.posting_kind, accountId: t.account_id, unitId: t.matched_unit_id };
    const label = labelForCategorization(item, pickers);
    announce(outcome({ n: 1, label, kind: t.posting_kind, postNow: true, posted: 1 }), [priorOf(t)]);
    return {};
  }

  /** "x": keep this row out of the books. Posting an excluded row only stamps excluded_at; pending rows just save. */
  async function excludeRow(t: SuggestedTransaction): Promise<{ error?: string }> {
    const item = { kind: "excluded" as const, accountId: null, unitId: null, vendorId: null };
    const postNow = !t.pending;
    const result = await applyCategorizations({ items: [{ id: t.id, ...item }], postNow });
    if (result.error) return { error: result.error };
    announce(
      outcome({ n: 1, label: "Not for the books", kind: "excluded", postNow, posted: result.posted ?? 0 }),
      [priorOf(t)],
    );
    return {};
  }

  function handleCategorized(e: CategorizedEvent) {
    const label = labelForCategorization(e.item, pickers);
    announce(
      outcome({ n: e.ids.length, label, kind: e.item.kind, postNow: e.postNow, posted: e.posted }),
      e.prior,
      e.ruleSuggestion ? { ...e.ruleSuggestion, label, item: e.item } : undefined,
    );
  }

  function handleBulkApplied(e: BulkApplied) {
    const label = labelForCategorization(e.item, pickers);
    announce(outcome({ n: e.ids.length, label, kind: e.item.kind, postNow: e.postNow, posted: e.posted }), e.prior);
    setSelected(new Set());
  }

  // Everything with a one-click recommendation that can post now (settled),
  // split into what the board's own history backs and what is only a guess.
  const { postable, guesses } = useMemo(() => {
    const postable: SuggestedTransaction[] = [];
    const guesses: SuggestedTransaction[] = [];
    for (const t of transactions) {
      if (t.posting_kind || !selectable(t) || t.pending || !oneClick(t)) continue;
      (t.suggestion.source === "keyword" ? guesses : postable).push(t);
    }
    return { postable, guesses };
  }, [transactions]);

  function acceptAll(rows: SuggestedTransaction[]) {
    const items: CategorizationItem[] = rows.map((t) => ({
      id: t.id,
      kind: t.suggestion!.kind,
      accountId: t.suggestion!.accountId,
      unitId: t.suggestion!.unitId,
      vendorId: null,
    }));
    const post = () =>
      start(async () => {
        setGroupError(null);
        setConfirm(null);
        const prior = priorFor(items.map((i) => i.id));
        const result = await applyCategorizations({ items, postNow: true });
        if (result.error) {
          setGroupError(result.error);
          return;
        }
        const applied = new Set(result.applied ?? []);
        const moved = rows.filter((t) => applied.has(t.id) && t.suggestion?.kind !== "excluded");
        const sums = inOutLabel(moved);
        const failed = result.errors?.length ?? 0;
        announce(
          `${result.posted ?? 0} posted${sums ? ` · ${sums}` : ""}${failed > 0 ? ` · ${failed} couldn't be posted` : ""}`,
          prior,
        );
      });
    confirmPost(
      items.map((i) => i.id),
      post,
    );
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedRows = useMemo(() => transactions.filter((t) => selected.has(t.id)), [transactions, selected]);
  const selectedSum = selectedRows.reduce((sum, t) => sum + Number(t.amount), 0);
  const totalLabel = `${selectedSum < 0 ? "−" : ""}${money(Math.abs(selectedSum))}`;
  const selectedDirection: Direction = selectedRows.every((t) => Number(t.amount) > 0)
    ? "in"
    : selectedRows.every((t) => Number(t.amount) < 0)
      ? "out"
      : "any";

  // Keyboard for the backlog: j/k or arrows move, Enter accepts, c categorizes,
  // x marks not for the books, Escape closes. Never while typing in a field.
  useEffect(() => {
    if (!canEdit) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "Escape") {
        if (confirm) setConfirm(null);
        else if (editingId) setEditingId(null);
        else if (isTyping(e.target)) return;
        else setFocusIdx(null);
        return;
      }
      if (confirm || isTyping(e.target)) return;
      const n = transactions.length;
      if (n === 0) return;
      const move = (delta: number) => {
        e.preventDefault();
        setFocusIdx((i) => (i === null ? (delta > 0 ? 0 : n - 1) : Math.max(0, Math.min(n - 1, i + delta))));
      };
      if (e.key === "j" || e.key === "ArrowDown") return move(1);
      if (e.key === "k" || e.key === "ArrowUp") return move(-1);
      if (focusIdx === null || editingId) return;
      const t = transactions[focusIdx];
      if (!t || !selectable(t)) return;
      const report = (p: Promise<{ error?: string }>) =>
        start(async () => {
          const r = await p;
          if (r.error) announce(r.error, []);
        });
      if (e.key === "Enter") {
        if (isInteractive(e.target)) return;
        e.preventDefault();
        if (t.posting_kind && !t.pending && !t.excluded_at) report(postRow(t));
        else if (oneClick(t)) report(acceptSuggestion(t, !t.pending));
        else setEditingId(t.id);
      } else if (e.key === "c") {
        e.preventDefault();
        setEditingId(t.id);
      } else if (e.key === "x") {
        e.preventDefault();
        report(excludeRow(t));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (focusIdx === null) return;
    const t = transactions[focusIdx];
    if (t) document.getElementById(`tx-${t.id}`)?.scrollIntoView({ block: "nearest" });
  }, [focusIdx, transactions]);

  const mainAccept = postable.length > 0 ? postable : guesses;
  const showAcceptAll = canEdit && postable.length + guesses.length > 1;

  return (
    <div>
      {showAcceptAll ? (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <button
            type="button"
            disabled={pending}
            onClick={() => acceptAll(mainAccept)}
            className="rounded-full bg-ink px-3 py-1.5 text-[12px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
          >
            {pending
              ? "Posting…"
              : postable.length > 0
                ? `Post all ${postable.length} recommended`
                : `Post the ${guesses.length} guesses`}
          </button>
          {postable.length > 0 && guesses.length > 0 ? (
            <button type="button" disabled={pending} onClick={() => acceptAll([...postable, ...guesses])} className={LINK_QUIET}>
              also the {guesses.length} guess{guesses.length === 1 ? "" : "es"}
            </button>
          ) : null}
          <span className="text-[11px] text-mute">undo for 10 seconds</span>
          {groupError ? <span className="w-full text-[11px] text-bad-text">{groupError}</span> : null}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          {/* Rows are cards on a phone (see transaction-row.tsx), so the header only applies from sm up. */}
          <thead className="hidden sm:table-header-group">
            <tr className="border-b border-line text-left text-[12px] text-mute">
              {canEdit ? <th className="w-6 pb-2" /> : null}
              <SortableHeader href={dateHref} active={sort === "date_asc" || sort === "date_desc"} ascending={sort === "date_asc"}>
                Date
              </SortableHeader>
              <SortableHeader href={nameHref} active={sort === "name_asc" || sort === "name_desc"} ascending={sort === "name_asc"}>
                Description
              </SortableHeader>
              <th className="min-w-[14rem] pb-2 font-medium">Category</th>
              <SortableHeader
                href={amountHref}
                active={sort === "amount_asc" || sort === "amount_desc"}
                ascending={sort === "amount_asc"}
                align="right"
              >
                Amount
              </SortableHeader>
              {canEdit ? <th className="w-[11rem] pb-2" /> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {transactions.map((t, i) => (
              <TransactionRow
                key={t.id}
                transaction={t}
                pickers={pickers}
                canEdit={canEdit}
                suggestion={t.suggestion}
                similar={similarByRow.get(t.id) ?? []}
                rulePattern={t.rulePattern}
                focused={focusIdx === i}
                editing={editingId === t.id}
                onEditingChange={(open) => setEditingId(open ? t.id : null)}
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
      {canEdit && selected.size > 0 && !confirm ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 pl-[calc(var(--sidebar-width)+1rem)] pr-4 min-[900px]:pl-[calc(var(--sidebar-width)+1.5rem)] min-[900px]:pr-8">
          <div className="pointer-events-auto mx-auto max-h-[60vh] max-w-[1100px] overflow-y-auto rounded-xl">
            <BulkForm
              transactionIds={[...selected]}
              totalLabel={totalLabel}
              direction={selectedDirection}
              pickers={pickers}
              snapshot={priorFor}
              confirmPost={confirmPost}
              onCancel={() => setSelected(new Set())}
              onApplied={handleBulkApplied}
            />
          </div>
        </div>
      ) : null}

      {confirm ? (
        <PostPreview
          rows={confirm.rows}
          busy={pending}
          onPost={() => {
            const { run } = confirm;
            setConfirm(null);
            run();
          }}
          onCancel={() => setConfirm(null)}
        />
      ) : null}

      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 z-40 flex max-w-[92vw] -translate-x-1/2 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-ink px-4 py-2.5 text-[13px] text-paper shadow-lg"
        >
          <span>{undoError ?? toast.message}</span>
          {toast.prior.length > 0 ? (
            <button
              type="button"
              disabled={undoing}
              onClick={undo}
              className="rounded-md border border-ondark-mute px-2.5 py-0.5 text-[12px] font-medium hover:bg-ink-mid disabled:opacity-50"
            >
              {undoing ? "Undoing…" : "Undo"}
            </button>
          ) : null}
          {toast.rule ? (
            <span className="flex items-center gap-2 text-[12px]">
              <span className="text-ondark-mute">
                Always file ‘{toast.rule.pattern}’ as {toast.rule.label}?
              </span>
              <button
                type="button"
                disabled={undoing}
                onClick={saveRule}
                className="rounded-md border border-ondark-mute px-2 py-0.5 font-medium hover:bg-ink-mid disabled:opacity-50"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setToast({ message: toast.message, prior: toast.prior })}
                className="text-ondark-mute underline-offset-2 hover:text-paper hover:underline"
              >
                No
              </button>
            </span>
          ) : null}
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
