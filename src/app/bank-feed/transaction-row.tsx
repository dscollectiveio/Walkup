"use client";

import { useState, useTransition } from "react";
import {
  applyCategorizations,
  categorizeBankTransaction,
  deleteCategorizationRule,
  postBankTransaction,
  unpostBankTransaction,
  type CategorizationItem,
  type PostingKind,
  type PriorState,
} from "./actions";
import {
  CategoryPicker,
  plainName,
  type CategoryChoice,
} from "./category-picker";
import { money } from "@/components/ui";
import { shortDate, todayIso } from "@/lib/dates";
import { cleanPayeeName } from "@/lib/plaid/payee-name";

export interface TransactionRecord {
  id: string;
  posted_on: string;
  description: string;
  amount: string | number;
  pending: boolean;
  raw_category: string | null;
  /** The bank's own wording, when Plaid has sent it (0091). */
  original_description?: string | null;
  /** What the board wrote this was for (0092). */
  note?: string | null;
  posting_kind: PostingKind | null;
  account_id: string | null;
  matched_unit_id: string | null;
  vendor_id: string | null;
  journal_entry_id: string | null;
  excluded_at: string | null;
  removed_at: string | null;
  /** The saved rule that pre-filled this row during sync, if one did. */
  rule_id: string | null;
  /** The ledger cash account this row's money came from; never offered as its own transfer target. */
  source_account_id?: string | null;
  /** Which bank connection the row came from. */
  bank_connection_id?: string;
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
  /** The ledger account a credit card payment goes to (2200 Credit Card Payable), when the books have one. */
  cardPayableId?: string | null;
  /** Names of connected credit cards, for the "Credit card payment · name" choices. */
  cardNames?: string[];
}

export const KIND_LABEL: Record<PostingKind, string> = {
  expense: "Expense",
  income: "Other income",
  dues: "Dues",
  transfer: "Transfer",
  excluded: "Not for the books",
};

const PENDING_NOTE =
  "The bank hasn't settled this yet; it will post once it does";

/** The row as it stands now, so a categorization can be undone. */
export function priorOf(t: TransactionRecord): PriorState {
  return {
    id: t.id,
    posting_kind: t.posting_kind,
    account_id: t.account_id,
    matched_unit_id: t.matched_unit_id,
    vendor_id: t.vendor_id,
    excluded_at: t.excluded_at,
    rule_id: t.rule_id,
  };
}

/** For comparing two spellings of a description: case and spacing don't count as "different". */
function sameWords(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Plain-language name for where a categorization sends a transaction ("Utilities", "Dues · 2B", "Moved to Reserve Cash"). */
export function labelForCategorization(
  item: Pick<CategorizationItem, "kind" | "accountId" | "unitId">,
  pickers: Pickers,
): string {
  const find = (list: Option[], id: string | null) =>
    list.find((o) => o.id === id)?.label ?? null;
  switch (item.kind) {
    case "expense":
      return plainName(
        find(pickers.expenseAccounts, item.accountId) ?? KIND_LABEL.expense,
      );
    case "income":
      return plainName(
        find(pickers.incomeAccounts, item.accountId) ?? KIND_LABEL.income,
      );
    case "transfer": {
      if (item.accountId && item.accountId === pickers.cardPayableId)
        return "Credit card payment";
      const name = find(pickers.cashAccounts, item.accountId);
      return name ? `Moved to ${plainName(name)}` : KIND_LABEL.transfer;
    }
    case "dues": {
      const unit = find(pickers.units, item.unitId);
      return unit ? `Dues · ${unit}` : KIND_LABEL.dues;
    }
    default:
      return KIND_LABEL.excluded;
  }
}

/** What the table knows about a row's recommended category. */
export interface RowRecommendation {
  kind: PostingKind;
  accountId: string | null;
  unitId: string | null;
  label: string;
  reason: string;
  needsPick: boolean;
  /** Filed the same way every time before: the only kind of suggestion shown as ready to post. */
  trusted: boolean;
  /** history: the board filed this payee so before. keyword: a guess. duplicate: already recorded by hand. */
  source: "history" | "keyword" | "duplicate";
  /** The payee's other most-used past choices, offered at the top of the category list. */
  alternatives?: {
    kind: PostingKind;
    accountId: string | null;
    unitId: string | null;
  }[];
}

/** Fired after a human saves a categorization, so the table can show the Undo toast. */
export interface CategorizedEvent {
  item: Omit<CategorizationItem, "id">;
  /** Every row that was changed — the one edited plus any same-payee rows filed along with it. */
  ids: string[];
  postNow: boolean;
  /** How many of `ids` reached the books; a pending row only saves. */
  posted: number;
  prior: PriorState[];
  /** The server says this payee has been filed this way before: worth offering a rule on this payee key. */
  ruleSuggestion?: { pattern: string };
}

function describeTarget(t: TransactionRecord, pickers: Pickers): string | null {
  if (!t.posting_kind) return null;
  return labelForCategorization(
    {
      kind: t.posting_kind,
      accountId: t.account_id,
      unitId: t.matched_unit_id,
    },
    pickers,
  );
}

const CATEGORY_TONE: Record<PostingKind, string> = {
  expense: "border-line bg-fill text-ink",
  income: "border-good-line bg-good-tint text-good-text",
  dues: "border-good-line bg-good-tint text-good-text",
  transfer: "border-info-line bg-info-tint text-info-text",
  excluded: "border-line bg-paper text-mute",
};

/** Whole-surface buttons: the entire pill is the click target, not just the label. */
const BTN_PRIMARY =
  "inline-flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-md bg-ink px-3 py-1.5 sm:min-h-0 text-[12px] font-medium text-paper transition-colors hover:bg-ink-mid focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass disabled:opacity-50";
const BTN_OUTLINE =
  "inline-flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-md border border-line-strong bg-paper px-3 py-1.5 sm:min-h-0 text-[12px] font-medium text-ink transition-colors hover:bg-fill focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass disabled:opacity-50";
const LINK_QUIET =
  "inline-flex min-h-[44px] items-center whitespace-nowrap text-[12px] text-mute underline-offset-2 sm:min-h-0 sm:text-[11px] hover:text-ink hover:underline disabled:opacity-50";

/** From sm up the tint is painted on the cells (so the corners can round); below sm the card paints it itself. */
const ROW_READY =
  "bg-[var(--w-row-ready)] hover:bg-[var(--w-row-ready-hover)]  sm:bg-transparent sm:hover:bg-transparent sm:[&>td]:bg-[var(--w-row-ready)] sm:hover:[&>td]:bg-[var(--w-row-ready-hover)]";
const ROW_READY_SELECTED =
  "bg-[var(--w-row-ready-sel)] hover:bg-[var(--w-row-ready-sel)]  sm:bg-transparent sm:hover:bg-transparent sm:[&>td]:bg-[var(--w-row-ready-sel)] sm:hover:[&>td]:bg-[var(--w-row-ready-sel)]";
const ROW_ATTENTION =
  "bg-[var(--w-row-attn)] shadow-[inset_3px_0_0_0_var(--w-row-attn-bar)] hover:bg-[var(--w-row-attn-hover)] sm:bg-transparent sm:shadow-none sm:hover:bg-transparent sm:[&>td]:bg-[var(--w-row-attn)] sm:[&>td:first-child]:shadow-[inset_3px_0_0_0_var(--w-row-attn-bar)] sm:hover:[&>td]:bg-[var(--w-row-attn-hover)]";
/** The open row keeps its tint but not its own bar: the navy bar runs down the row and its panel. */
const ROW_READY_OPEN =
  "bg-[var(--w-row-ready)] sm:bg-transparent sm:[&>td]:bg-[var(--w-row-ready)]";
const ROW_ATTENTION_OPEN =
  "bg-[var(--w-row-attn)] sm:bg-transparent sm:[&>td]:bg-[var(--w-row-attn)]";
const ROW_ATTENTION_SELECTED =
  "bg-[var(--w-row-attn-sel)] shadow-[inset_3px_0_0_0_var(--w-row-attn-bar)] hover:bg-[var(--w-row-attn-sel)] sm:bg-transparent sm:shadow-none sm:hover:bg-transparent sm:[&>td]:bg-[var(--w-row-attn-sel)] sm:[&>td:first-child]:shadow-[inset_3px_0_0_0_var(--w-row-attn-bar)] sm:hover:[&>td]:bg-[var(--w-row-attn-sel)]";

/**
 * Below the sm breakpoint a row is a card: the <tr> becomes a wrapping flex
 * box and each cell takes an order — description and amount first, then the
 * date with its status, the category, and the actions. From sm up the same
 * elements are ordinary table cells, so there is one row to maintain.
 */
const ROW =
  "flex flex-wrap items-center gap-x-3 px-4 py-2 sm:table-row sm:px-0 sm:py-0";
const CELL = {
  lead: "order-1 sm:order-none sm:py-2.5 sm:pr-2 sm:align-middle",
  description:
    "order-2 min-w-0 flex-1 sm:order-none sm:py-2.5 sm:pr-3 sm:align-middle",
  amount:
    "order-3 sm:order-none figures whitespace-nowrap text-right sm:py-2.5 sm:align-middle",
  date: "order-4 basis-full sm:basis-auto sm:order-none figures whitespace-nowrap text-[12px] text-mute sm:py-2.5 sm:pr-3 sm:align-middle",
  category:
    "order-5 basis-full sm:basis-auto sm:order-none min-w-[14rem] py-1 sm:py-2.5 sm:pr-3 sm:align-middle",
  actions:
    "order-6 basis-full sm:basis-auto sm:order-none whitespace-nowrap pt-1 text-[11px] sm:w-[12rem] sm:py-2.5 sm:pl-3 sm:text-right sm:align-middle",
  form: "basis-full sm:basis-auto",
};

/** Clicks on a row's own controls are theirs; anywhere else on an editable row opens or closes the form. */
function onControl(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("a,button,input,select,label,summary") !== null
  );
}

function StatusPill({ t }: { t: TransactionRecord }) {
  if (t.removed_at && t.journal_entry_id) {
    return <Pill tone="bad">Retracted by bank: review</Pill>;
  }
  if (t.removed_at) return <Pill tone="mute">Retracted by bank</Pill>;
  if (t.journal_entry_id) return <Pill tone="good">Posted</Pill>;
  if (t.excluded_at) return <Pill tone="mute">Not for the books</Pill>;
  if (t.pending)
    return (
      <Pill tone="mute" title={PENDING_NOTE}>
        Pending
      </Pill>
    );
  // Anything not yet posted is simply "to sort": no status word to decode.
  return null;
}

function Pill({
  tone,
  title,
  children,
}: {
  tone: "good" | "bad" | "info" | "warning" | "mute";
  title?: string;
  children: React.ReactNode;
}) {
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
  return (
    <span
      title={title}
      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] ${cls}`}
    >
      {children}
    </span>
  );
}

/** "rule" tag on a row a saved rule pre-filled, with Remove rule beside it — always visible, so it works on a phone too. */
function RuleTag({
  ruleId,
  pattern,
  canEdit,
}: {
  ruleId: string;
  pattern: string | null;
  canEdit: boolean;
}) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const title = pattern
    ? `Filed by your rule for ‘${pattern}’`
    : "Filed by one of your rules";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        title={title}
        className="rounded-sm bg-fill px-1 py-px text-[10px] uppercase tracking-[0.05em] text-mute"
      >
        rule
      </span>
      {canEdit ? (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            start(async () => {
              setError(null);
              const result = await deleteCategorizationRule(ruleId);
              if (result.error) setError(result.error);
            })
          }
          title={
            pattern
              ? `Stop filing ‘${pattern}’ this way automatically`
              : undefined
          }
          className={LINK_QUIET}
        >
          {busy ? "Removing…" : "Remove rule"}
        </button>
      ) : null}
      {error ? (
        <span className="text-[11px] text-bad-text">{error}</span>
      ) : null}
    </span>
  );
}

const cents = (v: string | number) => Math.round(Number(v) * 100);

function CategorizeForm({
  t,
  pickers,
  similar,
  prefill,
  onDone,
  onCategorized,
}: {
  t: TransactionRecord;
  pickers: Pickers;
  /** Other un-categorized rows from the same payee, offered to be filed the same way. */
  similar: TransactionRecord[];
  /** The recommendation, so the form opens already set to it. */
  prefill?: RowRecommendation | null;
  onDone: () => void;
  onCategorized?: (event: CategorizedEvent) => void;
}) {
  const direction = Number(t.amount) > 0 ? "in" : "out";
  const initial: CategoryChoice | null = t.posting_kind
    ? {
        kind: t.posting_kind,
        accountId: t.account_id,
        unitId: t.matched_unit_id,
      }
    : prefill && !prefill.needsPick && prefill.trusted
      ? {
          kind: prefill.kind,
          accountId: prefill.accountId,
          unitId: prefill.unitId,
        }
      : null;

  const [choice, setChoice] = useState<CategoryChoice | null>(initial);
  // The one-field panel never changes who was paid or what the note says; whatever is there stays.
  // Filing the others along with this one is pre-checked only when they are for the very same amount;
  // a different amount is a different bill, so it is the person's call.
  const sameAmounts = similar.every((o) => cents(o.amount) === cents(t.amount));
  const [applyToSimilar, setApplyToSimilar] = useState(sameAmounts);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const today = todayIso();

  const submit = (postNow: boolean) => {
    if (!choice) {
      setError("Pick a category first.");
      return;
    }
    start(async () => {
      setError(null);
      const item = {
        kind: choice.kind,
        accountId: choice.accountId,
        unitId: choice.unitId,
        vendorId: t.vendor_id,
      };
      const others = applyToSimilar ? similar : [];
      const prior = [priorOf(t), ...others.map(priorOf)];

      const result = await categorizeBankTransaction({
        transactionId: t.id,
        ...item,
        postNow,
      });
      if (result.error) {
        setError(result.error);
        return;
      }

      const ids = [t.id];
      let posted = result.posted ? 1 : 0;
      if (others.length > 0) {
        const more = await applyCategorizations({
          items: others.map((o) => ({ id: o.id, ...item })),
          postNow,
        });
        if (more.error) {
          setError(`Saved this one, but the others couldn't be: ${more.error}`);
        } else {
          ids.push(...(more.applied ?? []));
          posted += more.posted ?? 0;
        }
      }
      onCategorized?.({
        item,
        ids,
        postNow,
        posted,
        prior,
        ruleSuggestion: result.ruleSuggestion,
      });
      onDone();
    });
  };

  // A suggestion that isn't trusted (a guess, or a payee filed several ways) is not preselected; it leads the list instead.
  const own =
    prefill && !prefill.needsPick && !prefill.trusted
      ? [
          {
            kind: prefill.kind,
            accountId: prefill.accountId,
            unitId: prefill.unitId,
          },
        ]
      : [];
  const suggestedChoices = [...own, ...(prefill?.alternatives ?? [])].filter(
    (c, i, all) =>
      all.findIndex(
        (o) =>
          o.kind === c.kind &&
          o.accountId === c.accountId &&
          o.unitId === c.unitId,
      ) === i,
  );
  const isExcluded = choice?.kind === "excluded";
  const fieldLabel = "block text-[12px] text-mute sm:text-[11px]";

  return (
    <div
      className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 pb-2 pl-4 pt-1"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          onDone();
        } else if (
          e.key === "Enter" &&
          !e.defaultPrevented &&
          e.target instanceof HTMLInputElement &&
          choice &&
          !t.pending &&
          !pending
        ) {
          // Enter in the field posts, as long as the category list isn't the one using Enter to pick.
          e.preventDefault();
          submit(true);
        }
      }}
    >
      {/* Cancel and Post sit bottom right, level with the last line on the left, so the panel adds no height. */}
      <div className="min-w-0 flex-1 space-y-2">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <div className="min-w-[14rem] max-w-md flex-1">
          <label className={fieldLabel}>Category</label>
          <CategoryPicker
            pickers={pickers}
            direction={direction}
            value={choice}
            onChange={setChoice}
            excludeAccountId={t.source_account_id}
            // The list opens when the person clicks the field, never by itself (focusing it would open it).
            // "Dues" or "Transfer" pre-typed when the kind is known but not the unit or account.
            defaultQuery={
              !choice && prefill?.needsPick ? KIND_LABEL[prefill.kind] : ""
            }
            suggested={suggestedChoices}
          />
        </div>
      </div>

      {similar.length > 0 ? (
        <div className="text-[12px] text-ink sm:text-[11px]">
          <label className="flex min-h-[44px] items-center gap-2 sm:min-h-0 sm:gap-1.5">
            <input
              type="checkbox"
              checked={applyToSimilar}
              onChange={(e) => setApplyToSimilar(e.target.checked)}
            />
            {similar.length === 1
              ? "Also file the other one from this payee"
              : `Also file the other ${similar.length} from this payee`}
          </label>
          <ul className="ml-6 mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-mute sm:ml-5">
            {similar.slice(0, 3).map((o) => (
              <li key={o.id}>
                {shortDate(o.posted_on, today)} ·{" "}
                {Number(o.amount) > 0 ? "+" : "−"}
                {money(Math.abs(Number(o.amount)))} ·{" "}
                <a
                  href={`#tx-${o.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    document
                      .getElementById(`tx-${o.id}`)
                      ?.scrollIntoView({ block: "center" });
                  }}
                  className="underline-offset-2 hover:text-ink hover:underline"
                >
                  View
                </a>
              </li>
            ))}
            {similar.length > 3 ? <li>and {similar.length - 3} more</li> : null}
          </ul>
          {!sameAmounts ? (
            <p className="ml-6 mt-0.5 text-warning-text sm:ml-5">
              The amounts differ, so this is left unchecked. Tick it if they are
              the same kind of bill.
            </p>
          ) : null}
        </div>
      ) : null}

      {t.pending ? (
        <p className="text-[12px] text-mute sm:text-[11px]">{PENDING_NOTE}.</p>
      ) : null}

      {error ? (
        <p className="text-[12px] text-bad-text sm:text-[11px]">{error}</p>
      ) : null}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-3">
          <button
            type="button"
            onClick={onDone}
            className="min-h-[44px] rounded-md bg-bad px-4 py-1 text-[12px] font-medium text-white hover:opacity-90 sm:min-h-0 sm:px-3"
          >
            Cancel
          </button>
          <button
            type="button"
            autoFocus={!!choice}
            disabled={pending || !choice}
            onClick={() => submit(!t.pending)}
            title={
              t.pending
                ? "Saves the category; it posts once the bank settles it"
                : "Enter"
            }
            className="min-h-[44px] rounded-md bg-ink px-4 py-1 text-[12px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50 sm:min-h-0 sm:px-3"
          >
            {pending
              ? "Saving…"
              : t.pending
                ? "Save"
                : isExcluded
                  ? "Keep out of the books"
                  : "Post"}
          </button>
      </div>
    </div>
  );
}

export function TransactionRow({
  transaction: t,
  pickers,
  canEdit,
  leadingCell,
  suggestion,
  similar = [],
  rulePattern = null,
  focused = false,
  selected = false,
  editing: editingProp,
  onEditingChange,
  onAcceptSuggestion,
  onCategorized,
}: {
  transaction: TransactionRecord;
  pickers: Pickers;
  canEdit: boolean;
  /** Extra <td> rendered before the date column — used by TransactionsTable for its bulk-select checkbox. */
  leadingCell?: React.ReactNode;
  /** The recommended category: one click files and posts it, or opens the form pre-set when a unit/account is still needed. */
  suggestion?: RowRecommendation | null;
  /** Other un-categorized rows from the same payee; the chip and the form file them along with this one. */
  similar?: TransactionRecord[];
  /** Pattern of the rule in rule_id, for the "rule" tag's title. */
  rulePattern?: string | null;
  /** Keyboard focus from the table (j/k); highlights the row. */
  focused?: boolean;
  /** Ticked for the bulk bar: its own tint, a step deeper. */
  selected?: boolean;
  /** When the table drives the form (keyboard "c" / Escape) it owns this; otherwise the row does. */
  editing?: boolean;
  onEditingChange?: (open: boolean) => void;
  onAcceptSuggestion?: (postNow: boolean) => Promise<{ error?: string }>;
  onCategorized?: (event: CategorizedEvent) => void;
}) {
  const [localEditing, setLocalEditing] = useState(false);
  const editing = editingProp ?? localEditing;
  const setEditing = onEditingChange ?? setLocalEditing;
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const amount = Number(t.amount);
  const moneyIn = amount > 0;
  const target = describeTarget(t, pickers);
  const today = todayIso();

  const run = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      setError(null);
      const result = await fn();
      if (result.error) setError(result.error);
    });

  const canEditRow = canEdit && !t.journal_entry_id && !t.removed_at;
  const faded = t.removed_at && !t.journal_entry_id;
  const columns = (leadingCell !== undefined ? 1 : 0) + 4 + (canEdit ? 1 : 0);

  const shownName = cleanPayeeName(t.description);
  const rawCandidate =
    t.original_description ||
    (shownName !== t.description ? t.description : null);
  const rawText =
    rawCandidate && sameWords(rawCandidate) !== sameWords(shownName)
      ? rawCandidate
      : null;
  // What the row shows as its category: the saved one, else a suggestion that is complete enough to post.
  const complete =
    suggestion && !suggestion.needsPick && suggestion.trusted
      ? suggestion
      : null;
  const shownCategory = t.posting_kind
    ? (target ?? KIND_LABEL[t.posting_kind])
    : complete
      ? complete.source === "duplicate"
        ? "Already recorded · not for the books"
        : complete.label
      : null;
  // A row still to sort: not posted, not kept out of the books, not retracted.
  const toSort = canEditRow && !t.excluded_at;
  // Row tint and a 3px bar (an inset shadow, so nothing shifts): green when it has a category, gold when it still needs one.
  // The keyboard row and the open row keep their own highlight.
  const rowState =
    toSort && !focused
      ? editing
        ? shownCategory
          ? ROW_READY_OPEN
          : ROW_ATTENTION_OPEN
        : shownCategory
          ? selected
            ? ROW_READY_SELECTED
            : ROW_READY
          : selected
            ? ROW_ATTENTION_SELECTED
            : ROW_ATTENTION
      : null;

  return (
    <>
      <tr
        id={`tx-${t.id}`}
        data-focused={focused || undefined}
        // Click toggles: a second click on the row collapses it.
        onClick={
          canEditRow
            ? (e) => (onControl(e.target) ? undefined : setEditing(!editing))
            : undefined
        }
        // From sm up the highlight is painted on the cells so its first and last cell can round off; below sm the row is a card and paints it itself.
        className={`${ROW} ${faded ? "opacity-60" : ""} ${
          canEditRow
            ? `cursor-pointer ${rowState ?? "hover:bg-fill/60 sm:hover:bg-transparent sm:hover:[&>td]:bg-fill/60"}`
            : ""
        } ${
          editing
            ? "shadow-[inset_3px_0_0_0_var(--color-ink)] sm:shadow-none sm:[&>td:first-child]:shadow-[inset_3px_0_0_0_var(--color-ink)]"
            : focused
              ? "bg-fill outline outline-1 -outline-offset-1 outline-brass sm:bg-transparent sm:outline-none sm:[&>td]:bg-fill sm:[&>td]:shadow-[inset_0_1px_0_0_var(--color-brass),inset_0_-1px_0_0_var(--color-brass)] sm:[&>td:first-child]:shadow-[inset_1px_0_0_0_var(--color-brass),inset_0_1px_0_0_var(--color-brass),inset_0_-1px_0_0_var(--color-brass)] sm:[&>td:last-child]:shadow-[inset_-1px_0_0_0_var(--color-brass),inset_0_1px_0_0_var(--color-brass),inset_0_-1px_0_0_var(--color-brass)]"
              : ""
        }`}
      >
        {leadingCell !== undefined ? (
          <td className={CELL.lead}>{leadingCell}</td>
        ) : null}

        <td className={CELL.date}>
          {shortDate(t.posted_on, today)}
          {/* On a phone the status sits by the date; from sm up it is in the Category column. */}
          <span className="ml-2 sm:hidden">
            <StatusPill t={t} />
          </span>
        </td>

        <td className={CELL.description}>
          <div className="text-ink">{shownName}</div>
          {/* The bank's own text, when it adds something to the name above (a cleaned-up shorthand, or Plaid's fuller wording). */}
          {!t.posting_kind && rawText ? (
            <div
              className="text-[12px] text-mute-soft sm:text-[11px]"
              title="Exactly as your bank printed it"
            >
              {rawText}
            </div>
          ) : null}
          {/* Names the highlight: it is the row the keyboard is on (j / k), not a hover or a selection. */}
          {focused && !editing ? (
            <div
              className="mt-1 hidden text-[11px] font-medium text-ink sm:block"
              title="Keyboard: Enter posts it · c categorizes · x keeps it out of the books · j / k move · Esc clears"
            >
              Keyboard selection · Enter posts · c categorizes
            </div>
          ) : null}
          {t.note ? (
            <div className="mt-0.5 text-[12px] italic text-mute sm:text-[11px]">
              Note: {t.note}
            </div>
          ) : null}
          {error ? (
            <p className="mt-1 text-[12px] text-bad-text sm:text-[11px]">
              {error}
            </p>
          ) : null}
        </td>

        <td className={CELL.category}>
          <div className="flex flex-wrap items-center gap-1.5">
            {toSort && shownCategory ? (
              <>
                {/* The suggestion is plain text; tapping it opens the picker. */}
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  title="Change the category"
                  className="min-h-[44px] text-left text-[13px] text-ink underline decoration-mute-soft decoration-dotted underline-offset-4 hover:decoration-ink sm:min-h-0"
                >
                  {shownCategory}
                </button>
                {t.pending ? (
                  <Pill tone="mute" title={PENDING_NOTE}>
                    Pending
                  </Pill>
                ) : null}
                {t.rule_id ? (
                  <RuleTag
                    ruleId={t.rule_id}
                    pattern={rulePattern}
                    canEdit={canEdit}
                  />
                ) : null}
              </>
            ) : toSort && suggestion?.needsPick ? (
              // The kind is clear but the target isn't: say so, and why, in one line.
              <div className="flex flex-col">
                <span className="text-[13px] text-ink">
                  {suggestion.kind === "dues"
                    ? "Dues · pick unit"
                    : `${KIND_LABEL[suggestion.kind]} · pick account`}
                </span>
                <span className="text-[12px] text-mute-soft sm:text-[11px]">
                  {suggestion.reason}
                </span>
              </div>
            ) : t.posting_kind ? (
              <>
                <span
                  className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${CATEGORY_TONE[t.posting_kind]}`}
                >
                  {target ?? KIND_LABEL[t.posting_kind]}
                </span>
                <span className="hidden sm:contents">
                  <StatusPill t={t} />
                </span>
                {t.rule_id ? (
                  <RuleTag
                    ruleId={t.rule_id}
                    pattern={rulePattern}
                    canEdit={canEdit}
                  />
                ) : null}
              </>
            ) : (
              <span className="hidden sm:contents">
                <StatusPill t={t} />
              </span>
            )}
          </div>
        </td>

        <td
          className={`${CELL.amount} ${moneyIn ? "text-good-text" : "text-ink"}`}
        >
          {moneyIn ? "+" : amount < 0 ? "−" : ""}
          {money(Math.abs(amount))}
        </td>

        {canEdit ? (
          <td className={CELL.actions}>
            {(
              <div className={`flex gap-2 sm:justify-end ${editing ? "invisible" : ""}`}>
                {toSort && shownCategory ? (
                  // One tap posts it. A pending row can't post yet, so it has no button: tap the category to change it.
                  !t.pending ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        run(() =>
                          t.posting_kind
                            ? postBankTransaction(t.id)
                            : onAcceptSuggestion!(true),
                        )
                      }
                      aria-label={`Post ${t.description} as ${shownCategory}`}
                      className={BTN_PRIMARY}
                    >
                      {busy
                        ? "Posting…"
                        : complete?.source === "duplicate" && !t.posting_kind
                          ? "Confirm"
                          : "Post"}
                    </button>
                  ) : null
                ) : canEditRow ? (
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className={BTN_OUTLINE}
                  >
                    {toSort ? "Categorize" : "Edit"}
                  </button>
                ) : null}
                {t.journal_entry_id ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => unpostBankTransaction(t.id))}
                    className={BTN_OUTLINE}
                  >
                    {busy ? "Undoing…" : "Undo posting"}
                  </button>
                ) : null}
              </div>
            )}
          </td>
        ) : null}
      </tr>

      {editing ? (
        <tr
          className={`${ROW} !border-t-0 bg-paper sm:bg-transparent sm:[&>td]:bg-paper sm:[&>td]:shadow-[inset_3px_0_0_0_var(--color-ink)]`}
        >
          <td colSpan={columns} className={CELL.form}>
            <CategorizeForm
              t={t}
              pickers={pickers}
              similar={similar}
              prefill={suggestion}
              onDone={() => setEditing(false)}
              onCategorized={onCategorized}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}
