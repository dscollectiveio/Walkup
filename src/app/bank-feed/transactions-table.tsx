"use client";

import Link from "next/link";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
import {
  CategoryPicker,
  type CategoryChoice,
  type Direction,
} from "./category-picker";
import type { Sort } from "./href";
import { PREVIEW_ABOVE, PostPreview, type PreviewRow } from "./post-preview";
import {
  isMatchableDescription,
  normalizeDescription,
} from "@/lib/plaid/similar";

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
 * took the category and `posted` of them were posted. "Posted to Utilities",
 * "3 saved to Dues · 2B", "Marked not for the books", "2 posted to Utilities
 * · 1 couldn't be posted yet" (a pending sibling, say).
 */
function outcome(o: {
  n: number;
  label: string;
  kind: PostingKind;
  postNow: boolean;
  posted: number;
}): string {
  const one = o.n === 1;
  const saved = one ? `Saved to ${o.label}` : `${o.n} saved to ${o.label}`;
  if (!o.postNow) return saved;
  const left = o.n - o.posted;
  const notYet =
    left === 0
      ? ""
      : ` · ${left === o.n && one ? "it" : left} couldn't be posted yet`;
  if (o.posted === 0) return `${saved}${notYet}`;
  const done =
    o.kind === "excluded"
      ? one
        ? "Marked not for the books"
        : `${o.posted} marked not for the books`
      : one
        ? `Posted to ${o.label}`
        : `${o.posted} posted to ${o.label}`;
  return `${done}${notYet}`;
}

interface BulkApplied {
  ids: string[];
  item: Omit<CategorizationItem, "id">;
  postNow: boolean;
  posted: number;
  prior: PriorState[];
}

/** What a row would be filed as if posted now: the category it has, else its suggestion when that is complete. */
function planOf(t: SuggestedTransaction): {
  kind: PostingKind;
  accountId: string | null;
  unitId: string | null;
} | null {
  if (t.posting_kind)
    return {
      kind: t.posting_kind,
      accountId: t.account_id,
      unitId: t.matched_unit_id,
    };
  if (oneClick(t)) {
    return {
      kind: t.suggestion.kind,
      accountId: t.suggestion.accountId,
      unitId: t.suggestion.unitId,
    };
  }
  return null;
}

/**
 * The selection bar, one line. By default it posts each row under the category it already has
 * or is suggested (rows differ: a card payment, a ride and a refund are not one category).
 * Filing the whole selection as one category is offered only when the money all went the
 * same way and at least one row has a suggestion, and the person picks it deliberately.
 */
function BulkForm({
  rows,
  direction,
  excludeAccountId,
  pickers,
  snapshot,
  confirmPost,
  onApplied,
  onPostSuggested,
  onCancel,
}: {
  rows: SuggestedTransaction[];
  direction: Direction;
  /** Set when every selected row came from the same account. */
  excludeAccountId?: string | null;
  pickers: Pickers;
  snapshot: (ids: string[]) => PriorState[];
  /** Runs `post` straight away, or after a look when there are many rows. */
  confirmPost: (ids: string[], post: () => void) => void;
  onApplied: (e: BulkApplied) => void;
  /** Posts these rows, each under its own category. */
  onPostSuggested: (
    rows: SuggestedTransaction[],
  ) => Promise<{ error?: string }>;
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState<CategoryChoice | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const transactionIds = rows.map((t) => t.id);
  const withPlan = rows.filter((t) => planOf(t) !== null);
  const mixed = direction === "any";
  // Any selection can be filed under one category you pick, suggestions or not; only money going both ways cannot.
  const canChoose = !mixed;
  const n = rows.length;
  // "Post as suggested" only when every selected row has something to post.
  const allPlanned = withPlan.length === n;
  const choiceLabel = choice ? labelForCategorization(choice, pickers) : "";

  const postSuggested = () =>
    confirmPost(
      withPlan.map((t) => t.id),
      () =>
        start(async () => {
          setError(null);
          const r = await onPostSuggested(withPlan);
          if (r.error) setError(r.error);
        }),
    );

  const postAsChoice = () => {
    if (!choice) return;
    confirmPost(transactionIds, () =>
      start(async () => {
        setError(null);
        const item = {
          kind: choice.kind,
          accountId: choice.accountId,
          unitId: choice.unitId,
          vendorId: null,
        };
        const prior = snapshot(transactionIds);
        const result = await categorizeBankTransactionsBulk({
          transactionIds,
          ...item,
          postNow: true,
        });
        if (result.error) setError(result.error);
        else
          onApplied({
            ids: result.applied ?? transactionIds,
            item,
            postNow: true,
            posted: result.posted ?? 0,
            prior,
          });
      }),
    );
  };

  // Offer a category only when the selected rows share one: the same suggestion or earlier filing
  // across every row (or, for one row, its own). Rows with nothing in common get no suggestion.
  const keyOf = (c: { kind: PostingKind; accountId: string | null; unitId: string | null }) =>
    `${c.kind}|${c.accountId ?? ""}|${c.unitId ?? ""}`;
  const candidates = (t: SuggestedTransaction) => {
    const own = planOf(t);
    const s = t.suggestion;
    const list = [
      ...(own ? [own] : []),
      ...(s && !s.needsPick ? [{ kind: s.kind, accountId: s.accountId, unitId: s.unitId }] : []),
      ...(s?.alternatives ?? []),
    ];
    return list.filter((c, i) => list.findIndex((o) => keyOf(o) === keyOf(c)) === i);
  };
  const shared = rows.length
    ? candidates(rows[0]).filter((c) =>
        rows.every((r) => candidates(r).some((o) => keyOf(o) === keyOf(c))),
      )
    : [];
  const note =
    mixed
      ? "These are different kinds of transactions. Categorize them one at a time."
      : null;
  // No category picked and not every row has a suggestion: Post stays off until one is.

  return (
    <div className="band flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-ink px-3 py-2 text-paper shadow-lg">
      <span className="whitespace-nowrap text-[13px] font-medium text-paper">
        {n} selected
      </span>
      <span
        aria-hidden="true"
        className="hidden h-5 w-px bg-ondark-mute/50 sm:block"
      />
      {canChoose ? (
        <CategoryPicker
          pickers={pickers}
          direction={direction}
          value={choice}
          onChange={setChoice}
          excludeAccountId={excludeAccountId}
          placeholder="Choose a category"
          label="Choose one category for all"
          suggested={shared}
          suggestedLabel={n === 1 ? "Suggested" : "Suggested for all selected"}
          dropUp
        />
      ) : (
        <button
          type="button"
          disabled
          title={note ?? undefined}
          className="min-h-[44px] min-w-[14rem] rounded-lg border border-line-strong bg-paper px-2.5 py-1.5 text-left text-[16px] text-mute-soft opacity-60 sm:min-h-0 sm:text-[12px]"
        >
          Choose a category ▾
        </button>
      )}
      <div className="ml-auto flex items-center gap-3">
      <button
        type="button"
        onClick={onCancel}
        className="min-h-[44px] px-1 text-[12px] text-white underline underline-offset-2 hover:opacity-80 sm:min-h-0"
      >
        Clear
      </button>
      <button
        type="button"
        disabled={pending || (choice ? false : !allPlanned)}
        onClick={choice ? postAsChoice : postSuggested}
        title={
          choice
            ? undefined
            : allPlanned
              ? "Posts each row under its own suggested category"
              : "Pick a category, or select only rows that have a suggestion"
        }
        className="min-h-[44px] whitespace-nowrap rounded-md bg-brass px-3 py-1 text-[12px] font-semibold text-ink hover:opacity-90 disabled:opacity-50 sm:min-h-0"
      >
        {pending
          ? "Posting…"
          : choice
            ? choice.kind === "excluded"
              ? `Keep ${n} out of the books`
              : `Post ${n} as ${choiceLabel}`
            : `Post ${n} as suggested`}
      </button>
      </div>
      {note ? (
        <p className="basis-full text-[12px] text-ondark-mute sm:text-[11px]">
          {note}
        </p>
      ) : null}
      {!note && !choice && !allPlanned ? (
        <p className="basis-full text-[12px] text-ondark-mute sm:text-[11px]">
          {withPlan.length === 0
            ? "No suggestion yet. Pick a category to post."
            : `${n - withPlan.length} of ${n} ${n - withPlan.length === 1 ? "has" : "have"} no suggestion. Pick a category to post them all.`}
        </p>
      ) : null}
      {error ? (
        <p className="basis-full text-[12px] font-medium text-paper sm:text-[11px]">
          {error}
        </p>
      ) : null}
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
    <th
      aria-sort={active ? (ascending ? "ascending" : "descending") : undefined}
      className={align === "right" ? "text-right" : ""}
    >
      <Link
        href={href}
        className={`group inline-flex items-center gap-1 hover:text-ink focus-visible:text-ink ${active ? "text-ink" : ""}`}
      >
        {children}
        {/* The active column always shows its direction; the others hint at sortability on hover or focus. */}
        {ascending && active ? (
          <ChevronUp size={12} strokeWidth={1.8} aria-hidden="true" />
        ) : (
          <ChevronDown
            size={12}
            strokeWidth={1.8}
            aria-hidden="true"
            className={
              active
                ? ""
                : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
            }
          />
        )}
      </Link>
    </th>
  );
}

/** A recommendation can be applied in one click only when it already names its target. */
function oneClick(
  t: SuggestedTransaction,
): t is SuggestedTransaction & { suggestion: RowRecommendation } {
  return !!t.suggestion && !t.suggestion.needsPick && t.suggestion.trusted;
}

const UNDO_MS = 10000;
/** A toast that also asks about a rule stays a little longer. */
const UNDO_WITH_RULE_MS = 20000;

interface Toast {
  message: string;
  prior: PriorState[];
  /** "Always file ‘pattern’ as label?" — label is the one the toast already used for the item. */
  rule?: {
    pattern: string;
    label: string;
    item: Omit<CategorizationItem, "id">;
  };
}

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
  return (
    isTyping(target) || tag === "BUTTON" || tag === "A" || tag === "SUMMARY"
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
  const [pending, start] = useTransition();

  const [toast, setToast] = useState<Toast | null>(null);
  const [undoing, startUndo] = useTransition();
  const [undoError, setUndoError] = useState<string | null>(null);

  /** A bulk post of many rows waiting for a look: what to post, and how. */
  const [confirm, setConfirm] = useState<{
    rows: PreviewRow[];
    run: () => void;
  } | null>(null);

  // Keyboard: which row j/k has landed on, and which row's form is open.
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const [editingId, setEditingIdRaw] = useState<string | null>(null);
  // One mode at a time: opening a row's panel clears the bulk selection (see toggle for the other way round).
  const setEditingId = (id: string | null) => {
    setEditingIdRaw(id);
    if (id) setSelected(new Set());
  };

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(
      () => setToast(null),
      toast.rule ? UNDO_WITH_RULE_MS : UNDO_MS,
    );
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
    rowsFor(ids).map((t) => ({
      id: t.id,
      description: t.description,
      amount: t.amount,
      typicalCents: t.typicalCents,
    }));

  function announce(
    message: string,
    prior: PriorState[],
    rule?: Toast["rule"],
  ) {
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
      else
        setToast({
          message: `New ‘${pattern}’ rows will be filed as ${label}`,
          prior: [],
        });
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
      for (const t of g)
        byRow.set(
          t.id,
          g.filter((o) => o.id !== t.id),
        );
    }
    return byRow;
  }, [transactions]);

  async function acceptSuggestion(
    t: SuggestedTransaction,
    postNow: boolean,
  ): Promise<{ error?: string }> {
    const s = t.suggestion;
    if (!s || s.needsPick || !s.trusted)
      return { error: "This recommendation needs a choice first." };
    const item = {
      kind: s.kind,
      accountId: s.accountId,
      unitId: s.unitId,
      vendorId: null,
    };
    // One tap files this row and nothing else. Other rows from the same payee are offered
    // in the edit panel, where the person can see them first.
    const rows = [t];
    const prior = rows.map(priorOf);
    const result = await applyCategorizations({
      items: rows.map((r) => ({ id: r.id, ...item })),
      postNow,
    });
    if (result.error) return { error: result.error };
    if (
      result.errors &&
      result.errors.length > 0 &&
      (result.applied?.length ?? 0) === 0
    ) {
      return { error: result.errors[0] };
    }
    const n = result.applied?.length ?? 0;
    announce(
      outcome({
        n,
        label: s.label,
        kind: s.kind,
        postNow,
        posted: result.posted ?? 0,
      }),
      prior,
    );
    return {};
  }

  /** Enter on a row that already has a category: post it, with Undo. */
  async function postRow(t: SuggestedTransaction): Promise<{ error?: string }> {
    if (!t.posting_kind) return { error: "Categorize this transaction first." };
    const result = await postBankTransaction(t.id);
    if (result.error) return result;
    const item = {
      kind: t.posting_kind,
      accountId: t.account_id,
      unitId: t.matched_unit_id,
    };
    const label = labelForCategorization(item, pickers);
    announce(
      outcome({ n: 1, label, kind: t.posting_kind, postNow: true, posted: 1 }),
      [priorOf(t)],
    );
    return {};
  }

  /** "x": keep this row out of the books. Posting an excluded row only stamps excluded_at; pending rows just save. */
  async function excludeRow(
    t: SuggestedTransaction,
  ): Promise<{ error?: string }> {
    const item = {
      kind: "excluded" as const,
      accountId: null,
      unitId: null,
      vendorId: null,
    };
    const postNow = !t.pending;
    const result = await applyCategorizations({
      items: [{ id: t.id, ...item }],
      postNow,
    });
    if (result.error) return { error: result.error };
    announce(
      outcome({
        n: 1,
        label: "Not for the books",
        kind: "excluded",
        postNow,
        posted: result.posted ?? 0,
      }),
      [priorOf(t)],
    );
    return {};
  }

  function handleCategorized(e: CategorizedEvent) {
    const label = labelForCategorization(e.item, pickers);
    announce(
      outcome({
        n: e.ids.length,
        label,
        kind: e.item.kind,
        postNow: e.postNow,
        posted: e.posted,
      }),
      e.prior,
      e.ruleSuggestion
        ? { ...e.ruleSuggestion, label, item: e.item }
        : undefined,
    );
    // Sorting a long queue: the next row waiting for a category opens by itself, with the
    // cursor already in its category field. Rows filed along with this one are skipped.
    const filed = new Set(e.ids);
    const from = transactions.findIndex((t) => filed.has(t.id));
    const next = transactions
      .slice(from + 1)
      .find((t) => !filed.has(t.id) && !t.posting_kind && selectable(t));
    if (from >= 0 && next) setEditingId(next.id);
  }

  function handleBulkApplied(e: BulkApplied) {
    const label = labelForCategorization(e.item, pickers);
    announce(
      outcome({
        n: e.ids.length,
        label,
        kind: e.item.kind,
        postNow: e.postNow,
        posted: e.posted,
      }),
      e.prior,
    );
    setSelected(new Set());
  }

  // Select all: every row on screen that can still be filed. Checked when all are, dashed when some are.
  const selectableIds = useMemo(
    () => transactions.filter(selectable).map((t) => t.id),
    [transactions],
  );
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const someSelected = selectableIds.some((id) => selected.has(id));
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current)
      selectAllRef.current.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);
  function toggleAll() {
    if (!allSelected) setEditingIdRaw(null);
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  }

  /** Each row under its own category (the one it has, or its suggestion), posted now. */
  async function postSuggested(
    rows: SuggestedTransaction[],
  ): Promise<{ error?: string }> {
    const items: CategorizationItem[] = [];
    for (const t of rows) {
      const plan = planOf(t);
      if (plan) items.push({ id: t.id, ...plan, vendorId: t.vendor_id });
    }
    const prior = priorFor(items.map((i) => i.id));
    const result = await applyCategorizations({ items, postNow: true });
    if (result.error) return { error: result.error };
    const failed = result.errors?.length ?? 0;
    announce(
      `${result.posted ?? 0} posted${failed > 0 ? ` · ${failed} couldn't be posted` : ""}`,
      prior,
    );
    setSelected(new Set());
    return {};
  }

  function toggle(id: string) {
    setEditingIdRaw(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedRows = useMemo(
    () => transactions.filter((t) => selected.has(t.id)),
    [transactions, selected],
  );
  const sources = new Set(selectedRows.map((t) => t.source_account_id ?? null));
  const commonSource = sources.size === 1 ? ([...sources][0] ?? null) : null;
  const selectedDirection: Direction = selectedRows.every(
    (t) => Number(t.amount) > 0,
  )
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
        setFocusIdx((i) =>
          i === null
            ? delta > 0
              ? 0
              : n - 1
            : Math.max(0, Math.min(n - 1, i + delta)),
        );
      };
      // j and k start keyboard mode. The arrow keys join in only once a row is selected, so
      // pressing ↓ to scroll the page never grabs the first row.
      if (e.key === "j" || (e.key === "ArrowDown" && focusIdx !== null))
        return move(1);
      if (e.key === "k" || (e.key === "ArrowUp" && focusIdx !== null))
        return move(-1);
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
    if (t)
      document
        .getElementById(`tx-${t.id}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [focusIdx, transactions]);

  return (
    <div>
      {/* The column headers (and their sort links) are hidden on a phone, so the same three sorts live here. */}
      <nav
        aria-label="Sort transactions"
        className="mb-2 flex flex-wrap items-center gap-x-1 text-[12px] text-mute sm:hidden"
      >
        <span>Sort by</span>
        {[
          {
            label: "Date",
            href: dateHref,
            on: sort === "date_asc" || sort === "date_desc",
            asc: sort === "date_asc",
          },
          {
            label: "Description",
            href: nameHref,
            on: sort === "name_asc" || sort === "name_desc",
            asc: sort === "name_asc",
          },
          {
            label: "Amount",
            href: amountHref,
            on: sort === "amount_asc" || sort === "amount_desc",
            asc: sort === "amount_asc",
          },
        ].map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className={`inline-flex min-h-[44px] items-center px-2 underline-offset-2 hover:underline ${s.on ? "font-medium text-ink" : ""}`}
          >
            {s.label}
            {s.on ? <span className="ml-0.5">{s.asc ? "▲" : "▼"}</span> : null}
          </Link>
        ))}
      </nav>

      {/* From sm up the wrapper reaches the card's full 20px padding, so the header and rows run edge to edge, and the first and last cells take 20px back, so content stays level with the search field and filters. It is not a scroll box there (the rows are cards below sm), so the header can stick. */}
      <div className="-mx-4 overflow-x-auto sm:-mx-5 sm:overflow-visible">
        <table className="w-full text-[13px] sm:[&_tr>:first-child]:pl-5 sm:[&_tr>:last-child]:pr-5">
          {/* Rows are cards on a phone (see transaction-row.tsx), so the header only applies from sm up. */}
          <thead className="hidden sm:table-header-group">
            <tr className="text-left text-[12px] text-[var(--w-head-text)] [&>th]:sticky [&>th]:top-14 [&>th]:z-10 [&>th]:h-10 [&>th]:bg-[var(--w-head-bg)] [&>th]:py-0 [&>th]:align-middle [&>th]:font-medium [&>th]:shadow-[inset_0_-1px_0_0_var(--w-head-line)]">
              {canEdit ? (
                <th className="w-10">
                  {selectableIds.length > 0 ? (
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label={`Select all ${selectableIds.length} transactions shown`}
                      title="Select all shown"
                    />
                  ) : null}
                </th>
              ) : null}
              <SortableHeader
                href={dateHref}
                active={sort === "date_asc" || sort === "date_desc"}
                ascending={sort === "date_asc"}
              >
                Date
              </SortableHeader>
              <SortableHeader
                href={nameHref}
                active={sort === "name_asc" || sort === "name_desc"}
                ascending={sort === "name_asc"}
              >
                Description
              </SortableHeader>
              <th className="min-w-[14rem]">Category</th>
              <SortableHeader
                href={amountHref}
                active={sort === "amount_asc" || sort === "amount_desc"}
                ascending={sort === "amount_asc"}
                align="right"
              >
                Amount
              </SortableHeader>
              {canEdit ? <th className="w-[12rem]" /> : null}
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
                selected={selected.has(t.id)}
                editing={editingId === t.id}
                onEditingChange={(open) => setEditingId(open ? t.id : null)}
                onAcceptSuggestion={(postNow) => acceptSuggestion(t, postNow)}
                onCategorized={handleCategorized}
                leadingCell={
                  canEdit ? (
                    selectable(t) ? (
                      <label className="-m-3 flex h-11 w-11 items-center justify-center sm:m-0 sm:inline sm:h-auto sm:w-auto">
                        <input
                          type="checkbox"
                          checked={selected.has(t.id)}
                          onChange={() => toggle(t.id)}
                          aria-label={`Select ${t.description}`}
                          className="h-5 w-5 sm:h-auto sm:w-auto"
                        />
                      </label>
                    ) : null
                  ) : undefined
                }
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Selection bar: one line, inside the card, riding the bottom of the screen while the list is in view. */}
      {canEdit && selected.size > 0 && !confirm ? (
        <div className="sticky bottom-3 z-30 mt-3">
          <BulkForm
            rows={selectedRows}
            direction={selectedDirection}
            excludeAccountId={commonSource}
            pickers={pickers}
            snapshot={priorFor}
            confirmPost={confirmPost}
            onCancel={() => setSelected(new Set())}
            onApplied={handleBulkApplied}
            onPostSuggested={postSuggested}
          />
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
              className="min-h-[44px] rounded-md border border-ondark-mute px-3 py-0.5 text-[12px] font-medium hover:bg-ink-mid disabled:opacity-50 sm:min-h-0 sm:px-2.5"
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
                className="min-h-[44px] rounded-md border border-ondark-mute px-3 py-0.5 font-medium hover:bg-ink-mid disabled:opacity-50 sm:min-h-0 sm:px-2"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() =>
                  setToast({ message: toast.message, prior: toast.prior })
                }
                className="min-h-[44px] px-2 text-ondark-mute underline-offset-2 hover:text-paper hover:underline sm:min-h-0 sm:px-0"
              >
                No
              </button>
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Dismiss"
            className="min-h-[44px] min-w-[44px] text-ondark-mute hover:text-paper sm:min-h-0 sm:min-w-0"
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
