"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closeOutTicket, recentExpensesForTicket } from "@/app/maintenance/actions";
import { Card } from "@/components/ui";
import { btnPrimary, btnSecondary, errorClass, inputClass, labelClass } from "@/components/repairs/styles";
import { humanDate, moneyText } from "@/lib/repairs/format";
import { toCents } from "@/lib/tax/form1120h";
import type { TicketStatus } from "@/lib/repairs/labels";

/**
 * Money (repairs-spec §5.3 card 9), board and accountant. "Link a payment"
 * re-saves the close-out with the chosen expense, so it's offered once the
 * problem is fixed; before that, Mark fixed links the payment.
 */
export function MoneyCard(props: {
  ticketId: string;
  status: TicketStatus;
  canWrite: boolean;
  todayIso: string;
  estimatedCost: string | null;
  actualCost: string | null;
  expenseId: string | null;
  expense: { paidOn: string; amount: string; memo: string | null } | null;
  capitalizationThreshold: string | null;
}) {
  const router = useRouter();
  const id = useId();
  const [picking, setPicking] = useState(false);
  const [options, setOptions] = useState<{ id: string; paid_on: string; amount: string; memo: string | null; vendor_name: string | null }[] | null>(null);
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const today = props.todayIso;
  const done = props.status === "resolved" || props.status === "closed";
  const overThreshold =
    props.actualCost && props.capitalizationThreshold && toCents(props.actualCost) >= toCents(props.capitalizationThreshold);

  function openPicker() {
    setPicking(true);
    if (options) return;
    start(async () => {
      const r = await recentExpensesForTicket(props.ticketId);
      if ("error" in r) setError(r.error);
      else setOptions(r.expenses);
    });
  }

  return (
    <Card title="Money">
      <dl className="space-y-2 text-[14px]">
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-mute">Estimate</dt>
          <dd className="figures text-ink">{props.estimatedCost ? moneyText(props.estimatedCost) : "Not set"}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-mute">Final cost</dt>
          <dd className="figures text-ink">{props.actualCost ? moneyText(props.actualCost) : "Not recorded"}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-mute">Payment in the books</dt>
          <dd className="text-ink">
            {props.expense
              ? `${humanDate(props.expense.paidOn, today)} ${moneyText(props.expense.amount)}${props.expense.memo ? ` ${props.expense.memo}` : ""}`
              : "Not linked"}
          </dd>
        </div>
      </dl>
      {overThreshold ? (
        <p className="mt-3 border-l-[3px] border-info bg-info-tint px-3 py-2 text-[13px] text-info-text">
          This is over your {moneyText(props.capitalizationThreshold)} threshold for improvements. Ask your accountant whether it&rsquo;s a repair or an improvement for the books.
        </p>
      ) : null}
      {props.canWrite && done ? (
        picking ? (
          <div className="mt-3 space-y-2">
            <label htmlFor={id} className={labelClass}>
              Payment in the books
            </label>
            <select id={id} value={choice} onChange={(e) => setChoice(e.target.value)} className={inputClass} disabled={!options}>
              <option value="">{options ? "Not paid yet" : "Loading payments…"}</option>
              {(options ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {humanDate(x.paid_on, today)} · {moneyText(x.amount)} · {x.memo ?? x.vendor_name ?? "Payment"}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={btnPrimary}
                disabled={pending || !options}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    const r = await closeOutTicket(props.ticketId, {
                      status: props.status as "resolved" | "closed",
                      actual_cost: props.actualCost ?? "",
                      expense_id: choice || null,
                      resolution_note: null,
                      log_upkeep: false,
                    });
                    if ("error" in r) setError(r.error);
                    else {
                      setPicking(false);
                      router.refresh();
                    }
                  })
                }
              >
                {pending ? "Saving…" : "Save"}
              </button>
              <button type="button" className={btnSecondary} onClick={() => setPicking(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className={`mt-3 ${btnSecondary}`} onClick={openPicker}>
            {props.expenseId ? "Change the payment" : "Link a payment"}
          </button>
        )
      ) : null}
      {error ? <p className={`mt-2 ${errorClass}`}>{error}</p> : null}
    </Card>
  );
}
