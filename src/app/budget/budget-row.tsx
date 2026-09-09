"use client";

import { useActionState, useState } from "react";
import { saveBudgetLine } from "./actions";

export function BudgetRow({
  associationId,
  fiscalYearId,
  fundId,
  accountId,
  code,
  name,
  budgeted,
  actual,
  variance,
  canEdit,
  canSeeActuals,
}: {
  associationId: string;
  fiscalYearId: string;
  fundId: string;
  accountId: string;
  code: string;
  name: string;
  budgeted: number | null;
  actual: number;
  variance: number | null;
  canEdit: boolean;
  canSeeActuals: boolean;
}) {
  const [state, action, pending] = useActionState(saveBudgetLine, null);
  const [value, setValue] = useState(budgeted !== null ? String(budgeted) : "");

  const money = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  return (
    <tr>
      <td className="figures py-2 font-mono text-[11px] text-mute-soft">{code}</td>
      <td className="py-2 text-ink">{name}</td>
      <td className="py-2 text-right">
        {canEdit ? (
          <>
            <form action={action} className="inline-flex items-center gap-2">
              <input type="hidden" name="association_id" value={associationId} />
              <input type="hidden" name="fiscal_year_id" value={fiscalYearId} />
              <input type="hidden" name="account_id" value={accountId} />
              <input type="hidden" name="fund_id" value={fundId} />
              <input
                name="amount"
                type="number"
                min="0"
                step="0.01"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0.00"
                className="figures w-24 rounded-lg border border-line-strong px-2 py-1 text-right text-[13px] text-ink"
              />
              <button
                type="submit"
                disabled={pending}
                className="rounded-md border border-line-strong px-2 py-1 text-[11px] text-mute hover:bg-fill disabled:opacity-50"
              >
                {pending ? "…" : "Set"}
              </button>
            </form>
            {state?.error ? (
              <div className="mt-1 text-[11px] text-bad-text">{state.error}</div>
            ) : null}
          </>
        ) : (
          <span className="figures text-ink">
            {budgeted !== null ? money(budgeted) : (
              <span className="text-[11px] text-mute-soft">no budget set</span>
            )}
          </span>
        )}
      </td>
      {canSeeActuals ? (
        <>
          <td className="figures py-2 text-right text-mute">{money(actual)}</td>
          <td className="figures py-2 text-right">
            {budgeted === null ? (
              <span className="text-[11px] text-mute-soft">no budget set</span>
            ) : (
              <span className={variance !== null && variance > 0 ? "font-medium text-warning-text" : "text-good-text"}>
                {variance !== null ? money(variance) : ""}
              </span>
            )}
          </td>
        </>
      ) : (
        <td className="py-2 text-right text-[11px] text-mute-soft" colSpan={2}>
          Board and accountant only
        </td>
      )}
    </tr>
  );
}
