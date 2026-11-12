"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { saveBudgetLine } from "./actions";

export function BudgetRow({
  associationId,
  fiscalYearId,
  fundId,
  accountId,
  name,
  budgeted,
  actual,
  variance,
  canEdit,
  canSeeActuals,
  hint = null,
}: {
  associationId: string;
  fiscalYearId: string;
  fundId: string;
  accountId: string;
  name: string;
  budgeted: number | null;
  actual: number;
  variance: number | null;
  canEdit: boolean;
  canSeeActuals: boolean;
  /** A short related figure under the name, such as the insurance premiums in force. */
  hint?: { text: string; href: string } | null;
}) {
  const [state, action, pending] = useActionState(saveBudgetLine, null);
  // Whole dollars only: the box keeps the digits and shows them as $12,345 while you type.
  const current = budgeted !== null ? String(Math.round(budgeted)) : "";
  const [value, setValue] = useState(current);
  // "Set" only matters once the box differs from what is saved.
  const changed = value !== current;
  const shown = value === "" ? "" : `$${Number(value).toLocaleString("en-US")}`;

  const money = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

  return (
    <tr>
      <td className="py-2 text-ink">
        {name}
        {hint ? (
          <Link href={hint.href} className="mt-0.5 block text-[12px] text-mute underline-offset-2 hover:underline sm:text-[11px]">
            {hint.text}
          </Link>
        ) : null}
      </td>
      <td className="py-2 text-right">
        {canEdit ? (
          <>
            <form action={action} className="inline-flex items-center gap-2">
              <input type="hidden" name="association_id" value={associationId} />
              <input type="hidden" name="fiscal_year_id" value={fiscalYearId} />
              <input type="hidden" name="account_id" value={accountId} />
              <input type="hidden" name="fund_id" value={fundId} />
              <input type="hidden" name="amount" value={value} />
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                aria-label={`Budget for the year, ${name}`}
                value={shown}
                onChange={(e) => setValue(e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, ""))}
                placeholder="$0"
                className="figures min-h-[44px] w-28 rounded-lg border border-line-strong px-2 py-1 text-right text-[16px] text-ink sm:min-h-0 sm:w-24 sm:text-[13px]"
              />
              <button
                type="submit"
                disabled={pending || !changed}
                className="min-h-[44px] min-w-[44px] rounded-md bg-ink px-2.5 py-1 text-[12px] font-medium text-paper hover:bg-ink-mid disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-ink sm:min-h-0 sm:min-w-0 sm:text-[11px]"
              >
                {pending ? "…" : "Set"}
              </button>
            </form>
            {state?.error ? (
              <div className="mt-1 text-[12px] text-bad-text sm:text-[11px]">{state.error}</div>
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
            ) : variance === null ? null : (
              <span className={variance > 0 ? "font-medium text-warning-text" : "text-good-text"}>
                {money(Math.abs(variance))} {variance > 0 ? "over" : "under"}
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
