"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { Search } from "lucide-react";
import { tradeLabel } from "@/lib/contractors/trades";
import { STAGE_LABEL } from "@/lib/repairs/stage";
import { PRIORITY_LABEL } from "@/lib/repairs/labels";
import { PRIORITY_TONE } from "@/lib/repairs/priority-tone";
import type { ProblemParams } from "@/lib/repairs/problems-params";
import { HEADER_BUTTON } from "@/components/ui";

/**
 * The problems filter bar (repairs-spec §5.7): a plain GET form, so every
 * filtered list is a link. Selects and checkboxes submit on change; the
 * search submits on Enter. On phones the fields sit behind a "Filters"
 * button and open stacked.
 */
/** List / Board toggle and "Report a problem", light on a navy header. */
export function ProblemViewControls({
  canReadFinancials,
  canReport,
  isBoardLayout,
  listHref,
  boardHref,
}: {
  canReadFinancials: boolean;
  canReport?: boolean;
  isBoardLayout: boolean;
  listHref: string;
  boardHref: string;
}) {
  return (
    <>
          {canReadFinancials ? (
            <nav aria-label="Layout" className="inline-flex rounded-full border border-paper/30 p-0.5">
              <Link
                href={listHref}
                aria-current={!isBoardLayout ? "page" : undefined}
                className={`inline-flex min-h-[28px] items-center rounded-full px-3.5 text-[12px] font-medium ${!isBoardLayout ? "bg-paper text-ink" : "text-paper hover:bg-paper/10"}`}
              >
                List
              </Link>
              <Link
                href={boardHref}
                aria-current={isBoardLayout ? "page" : undefined}
                className={`inline-flex min-h-[28px] items-center rounded-full px-3.5 text-[12px] font-medium ${isBoardLayout ? "bg-paper text-ink" : "text-paper hover:bg-paper/10"}`}
              >
                Board
              </Link>
            </nav>
          ) : null}
          {canReport ? (
            <Link href="/repairs/report" className={`${HEADER_BUTTON} !py-1 !text-[12px]`}>
              Report a problem
            </Link>
          ) : null}
    </>
  );
}

export function ProblemFilters(props: {
  params: ProblemParams;
  trades: string[];
  isBoard: boolean;
  canReadFinancials: boolean;
  /** Show "Report a problem" on the header, beside the List / Board toggle. */
  canReport?: boolean;
  clearHref: string | null;
  listHref: string;
  boardHref: string;
  /** Rendered inside the Problems card: just the controls, no card or header of its own. */
  embedded?: boolean;
}) {
  const p = props.params;
  const form = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [urgency, setUrgency] = useState<"" | "low" | "normal" | "urgent">(p.urgency ?? "");
  const ids = { q: useId(), status: useId(), trade: useId(), where: useId(), urgency: useId(), panel: useId() };
  const submit = () => form.current?.requestSubmit();
  const isBoardLayout = p.layout === "board";

    // Compact controls: one row on desktop, labels read aloud rather than shown.
  const field =
    "block min-h-[34px] w-full rounded-md border border-line-strong bg-paper px-2.5 text-[16px] text-ink sm:text-[13px]";

  const formClass = `${props.embedded || open ? "flex" : "hidden"} flex-wrap items-center gap-2 px-4 py-2.5 md:flex`;

  return (
    <section
      aria-labelledby={props.embedded ? undefined : `${ids.panel}-title`}
      aria-label={props.embedded ? "Search and filter problems" : undefined}
      className={props.embedded ? "" : "overflow-hidden rounded-xl border border-line bg-paper"}
    >
      <header className={`${props.embedded ? "hidden" : "flex"} flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-t-[7px] band bg-ink px-4 py-2`}>
        <h2 id={`${ids.panel}-title`} className="eyebrow text-paper">
          Search problems
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={ids.panel}
            onClick={() => setOpen((o) => !o)}
            className="inline-flex min-h-[32px] items-center rounded-md border border-paper/40 px-3 text-[13px] font-medium text-paper hover:bg-paper/10 md:hidden"
          >
            Filters{props.clearHref ? " (on)" : ""}
          </button>
          <ProblemViewControls
            canReadFinancials={props.canReadFinancials}
            canReport={props.canReport}
            isBoardLayout={isBoardLayout}
            listHref={props.listHref}
            boardHref={props.boardHref}
          />
        </div>
      </header>

      <form
        ref={form}
        id={ids.panel}
        action="/repairs"
        method="get"
        className={formClass}
      >
        <input type="hidden" name="view" value="problems" />
        {isBoardLayout ? <input type="hidden" name="layout" value="board" /> : p.layoutFromUrl ? <input type="hidden" name="layout" value="list" /> : null}
        {p.stage ? <input type="hidden" name="stage" value={p.stage} /> : null}
        {p.sort !== "priority" ? <input type="hidden" name="sort" value={p.sort} /> : null}
        {p.mine ? <input type="hidden" name="mine" value="1" /> : null}
        {p.closed ? <input type="hidden" name="closed" value="1" /> : null}

        {!isBoardLayout ? (
          <div className="min-w-[7rem] flex-[1_1_7rem]">
            <label htmlFor={ids.status} className="sr-only">
              Status
            </label>
            <select id={ids.status} name="status" defaultValue={p.status} onChange={submit} className={field}>
              <option value="all">Status: All</option>
              <option value="open">Status: Open</option>
              <option value="done">Status: Completed</option>
            </select>
          </div>
        ) : null}
        <div className="min-w-[8rem] flex-[1_1_8rem]">
          <label htmlFor={ids.trade} className="sr-only">
            Kind of work
          </label>
          <select id={ids.trade} name="trade" defaultValue={p.trades[0] ?? ""} onChange={submit} className={field}>
            <option value="">Any kind of work</option>
            {props.trades.map((t) => (
              <option key={t} value={t}>
                {tradeLabel(t)}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[7rem] flex-[1_1_7rem]">
          <label htmlFor={ids.where} className="sr-only">
            Building area
          </label>
          <select id={ids.where} name="where" defaultValue={p.where ?? ""} onChange={submit} className={field}>
            <option value="">Any building area</option>
            <option value="shared">Shared areas</option>
            <option value="units">Inside units</option>
          </select>
        </div>
        <div className="min-w-[7rem] flex-[1_1_7rem]">
          <label htmlFor={ids.urgency} className="sr-only">
            Urgency
          </label>
          <select
            id={ids.urgency}
            name="priority"
            value={urgency}
            onChange={(e) => {
              setUrgency(e.target.value as typeof urgency);
              submit();
            }}
            className={`${field} ${urgency ? `${PRIORITY_TONE[urgency].select} font-medium` : ""}`}
          >
            <option value="">Any urgency</option>
            {(["low", "normal", "urgent"] as const).map((u) => (
              <option key={u} value={u} className={`${PRIORITY_TONE[u].text} font-medium`}>
                {PRIORITY_LABEL[u]}
              </option>
            ))}
          </select>
        </div>
        <div className="relative min-w-[12rem] flex-[2_1_14rem]">
          <label htmlFor={ids.q} className="sr-only">
            Search problems
          </label>
          <Search size={15} strokeWidth={1.8} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" />
          <input id={ids.q} name="q" type="search" defaultValue={p.q} placeholder="Title, details or #number" className={`${field} pl-8`} />
        </div>
        <button type="submit" className="inline-flex min-h-[34px] items-center rounded-md bg-ink px-4 text-[13px] font-medium text-paper hover:bg-ink-mid">
          Search
        </button>
        {props.clearHref ? (
          <Link href={props.clearHref} className="inline-flex min-h-[32px] items-center px-1 text-[12px] font-medium text-ink underline underline-offset-2">
            Clear
          </Link>
        ) : null}
      </form>

      {p.stage ? (
        <p className="border-t border-line px-4 py-2 text-[12px] text-mute">
          Showing stage: <span className="font-medium text-ink">{STAGE_LABEL[p.stage]}</span>
        </p>
      ) : null}
    </section>
  );
}
