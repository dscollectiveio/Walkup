"use client";

import { useState, useTransition } from "react";
import {
  applyCategorizations,
  categorizeBankTransaction,
  postBankTransaction,
  unpostBankTransaction,
  type CategorizationItem,
  type PostingKind,
  type PriorState,
} from "./actions";
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

/** The row as it stands now, so a categorization can be undone. */
export function priorOf(t: TransactionRecord): PriorState {
  return {
    id: t.id,
    posting_kind: t.posting_kind,
    account_id: t.account_id,
    matched_unit_id: t.matched_unit_id,
    vendor_id: t.vendor_id,
    excluded_at: t.excluded_at,
  };
}

/** Plain-language name for where a categorization sends a transaction ("Utilities", "Unit 2B", …). */
export function labelForCategorization(
  item: Pick<CategorizationItem, "kind" | "accountId" | "unitId">,
  pickers: Pickers,
): string {
  const find = (list: Option[], id: string | null) => list.find((o) => o.id === id)?.label ?? null;
  switch (item.kind) {
    case "expense":
      return find(pickers.expenseAccounts, item.accountId) ?? KIND_LABEL.expense;
    case "income":
      return find(pickers.incomeAccounts, item.accountId) ?? KIND_LABEL.income;
    case "transfer":
      return find(pickers.cashAccounts, item.accountId) ?? KIND_LABEL.transfer;
    case "dues":
      return find(pickers.units, item.unitId) ?? KIND_LABEL.dues;
    default:
      return KIND_LABEL.excluded;
  }
}

/** Fired after a human saves a categorization, so the table can show the Undo toast. */
/** What the table knows about a row's recommended category. */
export interface RowRecommendation {
  kind: PostingKind;
  accountId: string | null;
  unitId: string | null;
  label: string;
  reason: string;
  needsPick: boolean;
}

export interface CategorizedEvent {
  item: Omit<CategorizationItem, "id">;
  /** Every row that was changed — the one edited plus any same-payee rows filed along with it. */
  ids: string[];
  postNow: boolean;
  prior: PriorState[];
}

function describeTarget(t: TransactionRecord, pickers: Pickers): string | null {
  if (!t.posting_kind) return null;
  return labelForCategorization(
    { kind: t.posting_kind, accountId: t.account_id, unitId: t.matched_unit_id },
    pickers,
  );
}

/** Strip the "6100 " account code so the chip reads "Utilities", not "6100 Utilities". */
function plainName(label: string): string {
  return label.replace(/^\d{3,5}\s+/, "");
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
  "inline-flex items-center justify-center whitespace-nowrap rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper transition-colors hover:bg-ink-mid focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass disabled:opacity-50";
const BTN_OUTLINE =
  "inline-flex items-center justify-center whitespace-nowrap rounded-md border border-line-strong bg-paper px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-fill focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass disabled:opacity-50";

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
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] ${cls}`}>{children}</span>;
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
  const moneyIn = Number(t.amount) > 0;
  const kinds: PostingKind[] = moneyIn
    ? ["dues", "income", "transfer", "excluded"]
    : ["expense", "transfer", "excluded"];
  const prefillKind = prefill && kinds.includes(prefill.kind) ? prefill.kind : null;

  const [kind, setKind] = useState<PostingKind>(t.posting_kind ?? prefillKind ?? kinds[0]);
  const [accountId, setAccountId] = useState(t.account_id ?? (prefillKind ? (prefill?.accountId ?? "") : ""));
  const [unitId, setUnitId] = useState(t.matched_unit_id ?? (prefillKind ? (prefill?.unitId ?? "") : ""));
  const [vendorId, setVendorId] = useState(t.vendor_id ?? "");
  const [applyToSimilar, setApplyToSimilar] = useState(true);
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
      const item = {
        kind,
        accountId: accountId || null,
        unitId: unitId || null,
        vendorId: vendorId || null,
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
      if (others.length > 0) {
        const more = await applyCategorizations({
          items: others.map((o) => ({ id: o.id, ...item })),
          postNow,
        });
        if (more.error) {
          setError(`Saved this one, but the others couldn't be: ${more.error}`);
        } else {
          ids.push(...(more.applied ?? []));
        }
      }
      onCategorized?.({ item, ids, postNow, prior });
      onDone();
    });

  const selectClass =
    "mt-1 rounded-lg border border-line-strong bg-paper px-2 py-1 text-[12px] text-ink";

  return (
    <div className="space-y-2 rounded-lg border border-line-strong bg-fill p-3">
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

      {similar.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={applyToSimilar}
              onChange={(e) => setApplyToSimilar(e.target.checked)}
            />
            Also file the {similar.length} other “{t.description.trim()}” transaction
            {similar.length === 1 ? "" : "s"} the same way
          </label>
        </div>
      ) : null}

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
  leadingCell,
  suggestion,
  similar = [],
  onAcceptSuggestion,
  onCategorized,
}: {
  transaction: TransactionRecord;
  pickers: Pickers;
  canEdit: boolean;
  /** Extra <td> rendered before the date column — used by TransactionsTable for its bulk-select checkbox. */
  leadingCell?: React.ReactNode;
  /** The recommended category: one click saves it, or opens the form pre-set when a unit/account is still needed. */
  suggestion?: RowRecommendation | null;
  /** Other un-categorized rows from the same payee; the chip and the form file them along with this one. */
  similar?: TransactionRecord[];
  onAcceptSuggestion?: (postNow: boolean) => Promise<{ error?: string }>;
  onCategorized?: (event: CategorizedEvent) => void;
}) {
  const [editing, setEditing] = useState(false);
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

  return (
    <>
      <tr className={faded ? "opacity-60" : ""}>
        {leadingCell !== undefined ? <td className="py-2.5 pr-2 align-middle">{leadingCell}</td> : null}

        <td className="figures whitespace-nowrap py-2.5 pr-3 align-middle text-[12px] text-mute">
          {shortDate(t.posted_on, today)}
        </td>

        <td className="min-w-0 py-2.5 pr-3 align-middle">
          <div className="text-ink">{t.description}</div>
          {!t.posting_kind && t.raw_category ? (
            <div className="text-[11px] text-mute-soft">bank says: {t.raw_category}</div>
          ) : null}
          {error ? <p className="mt-1 text-[11px] text-bad-text">{error}</p> : null}
        </td>

        <td className="py-2.5 pr-3 align-middle">
          <div className="flex flex-wrap items-center gap-1.5">
            {t.posting_kind ? (
              <>
                <span
                  className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${CATEGORY_TONE[t.posting_kind]}`}
                >
                  {t.posting_kind === "dues" && target ? `Dues · ${target}` : plainName(target ?? KIND_LABEL[t.posting_kind])}
                </span>
                <StatusPill t={t} />
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
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-info-line bg-paper px-2.5 py-0.5 text-[11px] font-medium text-info-text hover:bg-info-tint"
                    >
                      {suggestion.label}
                      <span className="font-normal opacity-80">· choose →</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => onAcceptSuggestion(false))}
                      aria-label={`File ${t.description} as ${suggestion.label}${
                        similar.length > 0 ? ` along with ${similar.length} more from the same payee` : ""
                      }`}
                      title={
                        similar.length > 0
                          ? `Files this and ${similar.length} more “${t.description.trim()}” the same way`
                          : "Save this category"
                      }
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-info-line bg-info-tint px-2.5 py-0.5 text-[11px] font-medium text-info-text hover:brightness-95 disabled:opacity-50"
                    >
                      <span aria-hidden="true">✓</span>
                      {busy ? "Saving…" : suggestion.label}
                      {!busy && similar.length > 0 ? (
                        <span className="font-normal opacity-80">· +{similar.length} more</span>
                      ) : null}
                    </button>
                  )}
                  {!suggestion.needsPick && !t.pending ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => onAcceptSuggestion(true))}
                      className="whitespace-nowrap text-[11px] text-mute underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
                    >
                      Accept &amp; post
                    </button>
                  ) : null}
                </div>
                <span className="text-[11px] text-mute-soft">{suggestion.reason}</span>
              </div>
            ) : (
              <StatusPill t={t} />
            )}
          </div>
        </td>

        <td
          className={`figures whitespace-nowrap py-2.5 text-right align-middle ${
            moneyIn ? "text-good-text" : "text-ink"
          }`}
        >
          {moneyIn ? "+" : amount < 0 ? "−" : ""}
          {money(Math.abs(amount))}
        </td>

        {canEdit ? (
          <td className="whitespace-nowrap py-2.5 pl-3 text-right align-middle text-[11px]">
            {!editing ? (
              <div className="flex justify-end gap-2">
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
        <tr className="!border-t-0">
          <td colSpan={columns} className="pb-3">
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
