"use client";

import { useState, useTransition } from "react";
import { categorizeAsExpense } from "./actions";

/** One interaction: pick a category and the transaction is categorized and posted. */
export function CategorizeMenu({
  transactionId,
  description,
  categories,
}: {
  transactionId: string;
  description: string;
  categories: { id: string; name: string }[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <label className="sr-only" htmlFor={`cat-${transactionId}`}>
        Category for {description}
      </label>
      <select
        id={`cat-${transactionId}`}
        defaultValue=""
        disabled={pending}
        onChange={(e) => {
          const accountId = e.target.value;
          if (!accountId) return;
          start(async () => {
            setError(null);
            const r = await categorizeAsExpense(transactionId, accountId);
            if (r.error) {
              setError(r.error);
              e.target.value = "";
            }
          });
        }}
        className="min-h-[36px] rounded-md border border-line-strong bg-paper px-2 py-1 text-[12px] font-medium text-ink disabled:opacity-50"
      >
        <option value="">{pending ? "Saving…" : "Categorize…"}</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {error ? <span className="max-w-[14rem] text-right text-[11px] text-bad-text">{error}</span> : null}
    </span>
  );
}
