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
import { CategoryPicker, plainName, type CategoryChoice } from "./category-picker";
import { money } from "@/components/ui";
import { shortDate, todayIso } from "@/lib/dates";

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
  /** The saved rule that pre-filled this row during sync, if one did. */
  rule_id: string | null;
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

export const KIND_LABEL: Record<PostingKind, string> = {
  expense: "Expense",
  income: "Other income",
  dues: "Dues",
  transfer: "Transfer",
  excluded: "Not for the books",
};

const PENDING_NOTE = "The bank hasn't settled this yet; it will post once it does";

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

/** Plain-language name for where a categorization sends a transaction ("Utilities", "Dues · 2B", "Transfer · Reserve Cash"). */
export function labelForCategorization(
  item: Pick<CategorizationItem, "kind" | "accountId" | "unitId">,
  pickers: Pickers,
): string {
  const find = (list: Option[], id: string | null) => list.find((o) => o.id === id)?.label ?? null;
  switch (item.kind) {
    case "expense":
      return plainName(find(pickers.expenseAccounts, item.accountId) ?? KIND_LABEL.expense);
    case "income":
      return plainName(find(pickers.incomeAccounts, item.accountId) ?? KIND_LABEL.income);
    case "transfer": {
      const name = find(pickers.cashAccounts, item.accountId);
      return name ? `Transfer · ${plainName(name)}` : KIND_LABEL.transfer;
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
  /** history: the board filed this payee so before. keyword: a guess. duplicate: already recorded by hand. */
  source: "history" | "keyword" | "duplicate";
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
    { kind: t.posting_kind, accountId: t.account_id, unitId: t.matched_unit_id },
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

/** How sure the chip looks: filled for the board's own history, outlined for a guess, warning for a likely duplicate. */
const CHIP_TONE: Record<RowRecommendation["source"], string> = {
  history: "border-info-line bg-info-tint text-info-text hover:brightness-95",
  keyword: "border-info-line bg-paper text-info-text hover:bg-info-tint",
  duplicate: "border-warning-line bg-warning-tint text-warning-text hover:brightness-95",
};

/** Whole-surface buttons: the entire pill is the click target, not just the label. */
const BTN_PRIMARY =
  "inline-flex items-center justify-center whitespace-nowrap rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper transition-colors hover:bg-ink-mid focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass disabled:opacity-50";
const BTN_OUTLINE =
  "inline-flex items-center justify-center whitespace-nowrap rounded-md border border-line-strong bg-paper px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-fill focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass disabled:opacity-50";
const LINK_QUIET =
  "whitespace-nowrap text-[11px] text-mute underline-offset-2 hover:text-ink hover:underline disabled:opacity-50";

/**
 * Below the sm breakpoint a row is a card: the <tr> becomes a wrapping flex
 * box and each cell takes an order — description and amount first, then the
 * date with its status, the category, and the actions. From sm up the same
 * elements are ordinary table cells, so there is one row to maintain.
 */
const ROW = "flex flex-wrap items-center gap-x-3 py-2 sm:table-row sm:py-0";
const CELL = {
  lead: "order-1 sm:order-none sm:py-2.5 sm:pr-2 sm:align-middle",
  description: "order-2 min-w-0 flex-1 sm:order-none sm:py-2.5 sm:pr-3 sm:align-middle",
  amount: "order-3 sm:order-none figures whitespace-nowrap text-right sm:py-2.5 sm:align-middle",
  date: "order-4 basis-full sm:basis-auto sm:order-none figures whitespace-nowrap text-[12px] text-mute sm:py-2.5 sm:pr-3 sm:align-middle",
  category: "order-5 basis-full sm:basis-auto sm:order-none min-w-[14rem] py-1 sm:py-2.5 sm:pr-3 sm:align-middle",
  actions:
    "order-6 basis-full sm:basis-auto sm:order-none whitespace-nowrap pt-1 text-[11px] sm:w-[11rem] sm:py-2.5 sm:pl-3 sm:text-right sm:align-middle",
  form: "basis-full sm:basis-auto pb-3",
};

/** Clicks on a row's own controls are theirs; anywhere else on an editable row opens or closes the form. */
function onControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("a,button,input,select,label,summary") !== null;
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
  if (t.posting_kind) return <Pill tone="info">Ready to post</Pill>;
  return <Pill tone="warning">Needs category</Pill>;
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
    <span title={title} className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] ${cls}`}>
      {children}
    </span>
  );
}

/** "rule" tag on a row a saved rule pre-filled, with Remove rule beside it — always visible, so it works on a phone too. */
function RuleTag({ ruleId, pattern, canEdit }: { ruleId: string; pattern: string | null; canEdit: boolean }) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const title = pattern ? `Filed by your rule for ‘${pattern}’` : "Filed by one of your rules";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span title={title} className="rounded-sm bg-fill px-1 py-px text-[10px] uppercase tracking-[0.05em] text-mute">
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
          title={pattern ? `Stop filing ‘${pattern}’ this way automatically` : undefined}
          className={LINK_QUIET}
        >
          {busy ? "Removing…" : "Remove rule"}
        </button>
      ) : null}
      {error ? <span className="text-[11px] text-bad-text">{error}</span> : null}
    </span>
  );
}

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
    ? { kind: t.posting_kind, accountId: t.account_id, unitId: t.matched_unit_id }
    : prefill && !prefill.needsPick
      ? { kind: prefill.kind, accountId: prefill.accountId, unitId: prefill.unitId }
      : null;

  const [choice, setChoice] = useState<CategoryChoice | null>(initial);
  const [vendorId, setVendorId] = useState(t.vendor_id ?? "");
  const [applyToSimilar, setApplyToSimilar] = useState(true);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
        vendorId: choice.kind === "expense" && vendorId ? vendorId : null,
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
      onCategorized?.({ item, ids, postNow, posted, prior, ruleSuggestion: result.ruleSuggestion });
      onDone();
    });
  };

  const isExcluded = choice?.kind === "excluded";

  return (
    <div className="space-y-2 rounded-lg border border-line-strong bg-fill p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11px] text-mute">This is</label>
          <CategoryPicker
            pickers={pickers}
            direction={direction}
            value={choice}
            onChange={setChoice}
            autoFocus
            defaultOpen={!choice}
            // "Dues" or "Transfer" pre-typed when the kind is known but not the unit or account.
            defaultQuery={!choice && prefill?.needsPick ? KIND_LABEL[prefill.kind] : ""}
          />
        </div>

        {choice?.kind === "expense" && pickers.vendors.length > 0 ? (
          <div>
            <label className="block text-[11px] text-mute">
              Vendor <span className="text-mute-soft">(optional, for 1099s)</span>
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

      {similar.length > 0 ? (
        <label className="flex items-center gap-1.5 text-[11px] text-ink">
          <input type="checkbox" checked={applyToSimilar} onChange={(e) => setApplyToSimilar(e.target.checked)} />
          Also file the {similar.length} other “{t.description.trim()}” transaction
          {similar.length === 1 ? "" : "s"} the same way
        </label>
      ) : null}

      {t.pending ? <p className="text-[11px] text-mute">{PENDING_NOTE}.</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending || t.pending || !choice}
          onClick={() => submit(true)}
          title={t.pending ? PENDING_NOTE : undefined}
          className="rounded-md bg-ink px-2.5 py-1 text-[11px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
        >
          {pending ? "Saving…" : isExcluded ? "Keep out of the books" : "Save & post"}
        </button>
        <button
          type="button"
          disabled={pending || !choice}
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
  leadingCell,
  suggestion,
  similar = [],
  rulePattern = null,
  focused = false,
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

  const canPost = canEdit && !t.journal_entry_id && !t.pending && !t.removed_at && !!t.posting_kind && !t.excluded_at;
  const canEditRow = canEdit && !t.journal_entry_id && !t.removed_at;
  const faded = t.removed_at && !t.journal_entry_id;
  const columns = (leadingCell !== undefined ? 1 : 0) + 4 + (canEdit ? 1 : 0);

  // A duplicate is one deposit matching one hand-recorded payment, so its chip
  // files this row alone; every other chip takes the same-payee rows with it.
  const alongWith = suggestion?.source === "duplicate" ? [] : similar;
  const chipTitle = (() => {
    if (!suggestion) return undefined;
    if (suggestion.source === "duplicate") return "Keeps this out of the books so the dues aren't counted twice";
    if (t.pending) return "Saves the category; it posts once the bank settles it";
    const alsoOthers = alongWith.length > 0 ? ` and ${alongWith.length} more “${t.description.trim()}”` : "";
    return `Files this${alsoOthers} as ${suggestion.label} and posts it to the books`;
  })();
  const chipText =
    suggestion?.source === "duplicate" ? "Already recorded · not for the books" : (suggestion?.label ?? "");

  return (
    <>
      <tr
        id={`tx-${t.id}`}
        data-focused={focused || undefined}
        // Opens only: a second tap on a phone must not throw away a half-made pick. Cancel or Escape closes.
        onClick={canEditRow && !editing ? (e) => (onControl(e.target) ? undefined : setEditing(true)) : undefined}
        className={`${ROW} ${faded ? "opacity-60" : ""} ${canEditRow ? "cursor-pointer hover:bg-fill/60" : ""} ${
          focused ? "bg-fill outline outline-1 -outline-offset-1 outline-brass" : ""
        }`}
      >
        {leadingCell !== undefined ? <td className={CELL.lead}>{leadingCell}</td> : null}

        <td className={CELL.date}>
          {shortDate(t.posted_on, today)}
          {/* On a phone the status sits by the date; from sm up it is in the Category column. */}
          <span className="ml-2 sm:hidden">
            <StatusPill t={t} />
          </span>
        </td>

        <td className={CELL.description}>
          <div className="text-ink">{t.description}</div>
          {!t.posting_kind && t.raw_category ? (
            <div className="text-[11px] text-mute-soft">bank says: {t.raw_category}</div>
          ) : null}
          {error ? <p className="mt-1 text-[11px] text-bad-text">{error}</p> : null}
        </td>

        <td className={CELL.category}>
          <div className="flex flex-wrap items-center gap-1.5">
            {t.posting_kind ? (
              <>
                <span
                  className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${CATEGORY_TONE[t.posting_kind]}`}
                >
                  {target ?? KIND_LABEL[t.posting_kind]}
                </span>
                <span className="hidden sm:contents">
                  <StatusPill t={t} />
                </span>
                {t.rule_id ? <RuleTag ruleId={t.rule_id} pattern={rulePattern} canEdit={canEdit} /> : null}
              </>
            ) : canEdit && suggestion && onAcceptSuggestion ? (
              <div className="flex flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-medium uppercase tracking-[0.07em] text-mute-soft">
                    Recommended
                  </span>
                  {suggestion.needsPick ? (
                    <button
                      type="button"
                      onClick={() => setEditing(true)}
                      title="Opens the form with this already chosen"
                      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${CHIP_TONE[suggestion.source]}`}
                    >
                      {suggestion.label}
                      <span className="font-normal opacity-80">· choose →</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => onAcceptSuggestion(!t.pending))}
                      aria-label={`${t.pending ? "File" : "Post"} ${t.description} as ${suggestion.label}${
                        alongWith.length > 0 ? ` along with ${alongWith.length} more from the same payee` : ""
                      }`}
                      title={chipTitle}
                      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium disabled:opacity-50 ${CHIP_TONE[suggestion.source]}`}
                    >
                      <span aria-hidden="true">✓</span>
                      {busy ? (t.pending ? "Saving…" : "Posting…") : chipText}
                      {!busy && alongWith.length > 0 ? (
                        <span className="font-normal opacity-80">· +{alongWith.length} more</span>
                      ) : null}
                    </button>
                  )}
                  {!suggestion.needsPick && !t.pending ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => onAcceptSuggestion(false))}
                      title="Saves the category without posting it yet"
                      className={LINK_QUIET}
                    >
                      Save for later
                    </button>
                  ) : null}
                </div>
                <span className="text-[11px] text-mute-soft">
                  {t.pending && !suggestion.needsPick ? "Pending at the bank: posts once it settles" : suggestion.reason}
                </span>
              </div>
            ) : (
              <span className="hidden sm:contents">
                <StatusPill t={t} />
              </span>
            )}
          </div>
        </td>

        <td className={`${CELL.amount} ${moneyIn ? "text-good-text" : "text-ink"}`}>
          {moneyIn ? "+" : amount < 0 ? "−" : ""}
          {money(Math.abs(amount))}
        </td>

        {canEdit ? (
          <td className={CELL.actions}>
            {!editing ? (
              <div className="flex gap-2 sm:justify-end">
                {canEditRow ? (
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className={t.posting_kind ? BTN_OUTLINE : BTN_PRIMARY}
                  >
                    {t.posting_kind ? "Edit" : "Categorize"}
                  </button>
                ) : null}
                {canPost ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => postBankTransaction(t.id))}
                    className={BTN_PRIMARY}
                  >
                    {busy ? "Posting…" : "Post"}
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
            ) : (
              <span className="text-mute">Editing…</span>
            )}
          </td>
        ) : null}
      </tr>

      {editing ? (
        <tr className={`${ROW} !border-t-0`}>
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
