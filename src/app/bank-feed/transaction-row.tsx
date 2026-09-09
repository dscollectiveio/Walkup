"use client";

import { useState, useTransition } from "react";
import { tagBankTransaction } from "./actions";
import { money } from "@/components/ui";

export interface TransactionRecord {
  id: string;
  posted_on: string;
  description: string;
  amount: string | number;
  pending: boolean;
  raw_category: string | null;
  category_override: string | null;
  matched_unit_id: string | null;
}

function TagForm({
  transaction,
  units,
  onDone,
}: {
  transaction: TransactionRecord;
  units: { id: string; label: string }[];
  onDone: () => void;
}) {
  const [category, setCategory] = useState(transaction.category_override ?? "");
  const [unitId, setUnitId] = useState(transaction.matched_unit_id ?? "");
  const [pending, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-line-strong bg-fill p-2">
      <div>
        <label className="block text-[11px] text-mute">Category</label>
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder={transaction.raw_category ?? "e.g. Landscaping"}
          className="mt-1 rounded-lg border border-line-strong bg-paper px-2 py-1 text-[12px] text-ink"
        />
      </div>
      <div>
        <label className="block text-[11px] text-mute">Unit&rsquo;s dues</label>
        <select
          value={unitId}
          onChange={(e) => setUnitId(e.target.value)}
          className="mt-1 rounded-lg border border-line-strong bg-paper px-2 py-1 text-[12px] text-ink"
        >
          <option value="">Not a dues payment</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startSave(async () => {
            setError(null);
            const result = await tagBankTransaction(
              transaction.id,
              category.trim() || null,
              unitId || null,
            );
            if (result.error) setError(result.error);
            else onDone();
          })
        }
        className="rounded-md bg-ink px-2.5 py-1 text-[11px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={onDone}
        className="text-[11px] text-mute underline-offset-2 hover:underline"
      >
        Cancel
      </button>
      {error ? <span className="w-full text-[11px] text-bad-text">{error}</span> : null}
    </div>
  );
}

export function TransactionRow({
  transaction,
  units,
  unitLabel,
  canEdit,
}: {
  transaction: TransactionRecord;
  units: { id: string; label: string }[];
  unitLabel: string | null;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const displayCategory = transaction.category_override ?? transaction.raw_category;
  const amount = Number(transaction.amount);

  return (
    <tr>
      <td className="figures py-2 align-top text-ink">{transaction.posted_on}</td>
      <td className="py-2 align-top text-ink">
        {transaction.description}
        {displayCategory ? (
          <span className="ml-2 rounded-full bg-neutral-tint px-2 py-0.5 text-[11px] text-neutral-text">
            {displayCategory}
          </span>
        ) : null}
        {unitLabel ? (
          <span className="ml-2 rounded-full bg-good-tint px-2 py-0.5 text-[11px] text-good-text">
            {unitLabel} dues
          </span>
        ) : null}
        {transaction.pending ? (
          <span className="ml-2 text-[11px] text-mute-soft">pending</span>
        ) : null}
        {canEdit ? (
          editing ? (
            <TagForm transaction={transaction} units={units} onDone={() => setEditing(false)} />
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="ml-2 text-[11px] text-mute-soft underline-offset-2 hover:underline"
            >
              Tag
            </button>
          )
        ) : null}
      </td>
      <td className="figures py-2 text-right align-top text-ink">
        {amount < 0 ? "−" : ""}
        {money(Math.abs(amount))}
      </td>
    </tr>
  );
}
