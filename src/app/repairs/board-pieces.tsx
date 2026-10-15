"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closeFixedTickets, closeOutTicket } from "@/app/maintenance/actions";
import { btnPrimary, btnSecondary, errorClass } from "@/components/repairs/styles";

/**
 * Small client islands for the pipeline board and Today (repairs-spec
 * §15): a column that folds on phones, "Close it" on a fixed card, and
 * Today's "Close all".
 */

export function BoardColumn(props: { label: string; count: number; desktop: "lg" | "xl"; children: React.ReactNode }) {
  const [open, setOpen] = useState(props.count > 0);
  const id = useId();
  const hide = props.desktop === "lg" ? "lg:hidden" : "xl:hidden";
  const show = props.desktop === "lg" ? "lg:block" : "xl:block";
  return (
    <section aria-labelledby={`${id}-h`} className="min-w-0 rounded-xl border border-line bg-fill/40 p-2">
      <h3 id={`${id}-h`} className={`hidden px-1 py-1 text-[12px] font-medium text-mute ${show}`}>
        {props.label} <span className="text-mute-soft">({props.count})</span>
      </h3>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={`flex min-h-[44px] w-full items-center justify-between px-2 text-left text-[13px] font-medium text-ink ${hide}`}
      >
        <span>
          {props.label} <span className="text-mute">({props.count})</span>
        </span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      <div id={id} className={`${open ? "block" : "hidden"} ${show}`}>
        {props.children}
      </div>
    </section>
  );
}

export function CloseItButton({ ticketId, actualCost, expenseId }: { ticketId: string; actualCost: string | null; expenseId: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button
        type="button"
        className={`${btnSecondary} w-full`}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await closeOutTicket(ticketId, {
              status: "closed",
              actual_cost: actualCost ?? "",
              expense_id: expenseId,
              resolution_note: null,
              log_upkeep: false,
            });
            if ("error" in r) setError(r.error);
            else router.refresh();
          })
        }
      >
        {pending ? "Saving…" : "Close it"}
      </button>
      {error ? <p className={errorClass}>{error}</p> : null}
    </>
  );
}

export function CloseAllButton({ ids }: { ids: string[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-1">
      <button
        type="button"
        className={btnPrimary}
        disabled={pending || ids.length === 0}
        onClick={() =>
          start(async () => {
            const r = await closeFixedTickets(ids);
            if ("error" in r) setMsg({ text: r.error, bad: true });
            else {
              setMsg({ text: `Closed ${r.closed}.`, bad: false });
              router.refresh();
            }
          })
        }
      >
        {pending ? "Closing…" : `Close all ${ids.length}`}
      </button>
      {msg ? (
        <p role="status" className={msg.bad ? errorClass : "text-[13px] text-good-text"}>
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
