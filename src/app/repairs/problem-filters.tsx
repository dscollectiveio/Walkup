"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { tradeLabel } from "@/lib/contractors/trades";
import { STAGE_LABEL } from "@/lib/repairs/stage";
import type { ProblemParams } from "@/lib/repairs/problems-params";
import { choiceRow, inputClass, labelClass } from "@/components/repairs/styles";

/**
 * The problems filter bar (repairs-spec §5.7): a plain GET form, so every
 * filtered list is a link. Selects and checkboxes submit on change; the
 * search submits on Enter. On phones the fields sit behind a "Filters"
 * button and open stacked.
 */
export function ProblemFilters(props: {
  params: ProblemParams;
  trades: string[];
  isBoard: boolean;
  canReadFinancials: boolean;
  clearHref: string | null;
  listHref: string;
  boardHref: string;
}) {
  const p = props.params;
  const form = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const ids = { q: useId(), status: useId(), trade: useId(), where: useId(), sort: useId(), panel: useId() };
  const submit = () => form.current?.requestSubmit();
  const isBoardLayout = p.layout === "board";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={ids.panel}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex min-h-[44px] items-center rounded-md border border-line-strong bg-paper px-4 text-[13px] font-medium text-ink md:hidden"
        >
          Filters{props.clearHref ? " (on)" : ""}
        </button>
        {props.canReadFinancials ? (
          <nav aria-label="Layout" className="inline-flex rounded-full border border-line bg-paper p-0.5">
            <Link
              href={props.listHref}
              aria-current={!isBoardLayout ? "page" : undefined}
              className={`inline-flex min-h-[40px] items-center rounded-full px-4 text-[13px] font-medium ${!isBoardLayout ? "bg-ink text-paper" : "text-mute hover:text-ink"}`}
            >
              List
            </Link>
            <Link
              href={props.boardHref}
              aria-current={isBoardLayout ? "page" : undefined}
              className={`inline-flex min-h-[40px] items-center rounded-full px-4 text-[13px] font-medium ${isBoardLayout ? "bg-ink text-paper" : "text-mute hover:text-ink"}`}
            >
              Board
            </Link>
          </nav>
        ) : null}
      </div>

      <form
        ref={form}
        id={ids.panel}
        action="/repairs"
        method="get"
        className={`${open ? "grid" : "hidden"} gap-3 rounded-xl border border-line bg-paper p-4 md:grid md:grid-cols-[minmax(12rem,2fr)_repeat(4,minmax(8rem,1fr))] md:items-end`}
      >
        <input type="hidden" name="view" value="problems" />
        {isBoardLayout ? <input type="hidden" name="layout" value="board" /> : p.layoutFromUrl ? <input type="hidden" name="layout" value="list" /> : null}
        {p.stage ? <input type="hidden" name="stage" value={p.stage} /> : null}
        {p.closed ? <input type="hidden" name="closed" value="1" /> : null}

        <div>
          <label htmlFor={ids.q} className={labelClass}>
            Search problems
          </label>
          <input id={ids.q} name="q" type="search" defaultValue={p.q} placeholder="Title, details or #number" className={inputClass} />
        </div>
        {!isBoardLayout ? (
          <div>
            <label htmlFor={ids.status} className={labelClass}>
              Status
            </label>
            <select id={ids.status} name="status" defaultValue={p.status} onChange={submit} className={inputClass}>
              <option value="open">Open</option>
              <option value="done">Done</option>
              <option value="all">All</option>
            </select>
          </div>
        ) : null}
        <div>
          <label htmlFor={ids.trade} className={labelClass}>
            Kind of work
          </label>
          <select id={ids.trade} name="trade" defaultValue={p.trades[0] ?? ""} onChange={submit} className={inputClass}>
            <option value="">Any</option>
            {props.trades.map((t) => (
              <option key={t} value={t}>
                {tradeLabel(t)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={ids.where} className={labelClass}>
            Where
          </label>
          <select id={ids.where} name="where" defaultValue={p.where ?? ""} onChange={submit} className={inputClass}>
            <option value="">Anywhere</option>
            <option value="shared">Shared areas</option>
            <option value="units">Inside units</option>
          </select>
        </div>
        {!isBoardLayout ? (
          <div>
            <label htmlFor={ids.sort} className={labelClass}>
              Sort
            </label>
            <select id={ids.sort} name="sort" defaultValue={p.sort} onChange={submit} className={inputClass}>
              <option value="priority">Most urgent first</option>
              <option value="newest">Newest</option>
              <option value="updated">Recently updated</option>
              {props.isBoard ? <option value="due">Target date</option> : null}
            </select>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2 md:col-span-full">
          <label className={choiceRow}>
            <input type="checkbox" name="priority" value="urgent" defaultChecked={p.urgentOnly} onChange={submit} className="h-5 w-5" />
            Urgent only
          </label>
          <label className={choiceRow}>
            <input type="checkbox" name="mine" value="1" defaultChecked={p.mine} onChange={submit} className="h-5 w-5" />
            {props.isBoard ? "Following" : "I reported"}
          </label>
          <button type="submit" className="inline-flex min-h-[44px] items-center rounded-md bg-ink px-4 text-[13px] font-medium text-paper">
            Apply
          </button>
          {props.clearHref ? (
            <Link href={props.clearHref} className="inline-flex min-h-[44px] items-center px-2 text-[13px] text-ink underline underline-offset-2">
              Clear filters
            </Link>
          ) : null}
        </div>
      </form>

      {p.stage ? (
        <p className="text-[13px] text-mute">
          Showing stage: <span className="font-medium text-ink">{STAGE_LABEL[p.stage]}</span>
        </p>
      ) : null}
    </div>
  );
}
