"use client";

import Link from "next/link";
import { useId, useRef } from "react";
import { Search } from "lucide-react";

export interface BillParams {
  show: "active" | "paused" | "archived";
  q: string;
  pay: "hand" | "autopay" | null;
  freq: "monthly" | "quarterly" | "semiannual" | "annual" | null;
  sort: "next" | "name" | "amount";
}

/**
 * The bills search and filter row, set inside the Regular bills card (as the
 * Problems and Contractors tabs have theirs). A plain GET form: selects apply as
 * soon as they change, the search on Enter or the button.
 */
export function BillFilters({ params, clearHref, counts }: { params: BillParams; clearHref: string | null; counts: { paused: number; archived: number } }) {
  const form = useRef<HTMLFormElement>(null);
  const ids = { q: useId(), show: useId(), pay: useId(), freq: useId(), sort: useId() };
  const submit = () => form.current?.requestSubmit();
  const field =
    "block min-h-[34px] w-full rounded-md border border-line-strong bg-paper px-2.5 text-[16px] text-ink sm:text-[13px]";

  return (
    <form ref={form} action="/repairs" method="get" className="flex flex-wrap items-center gap-2 px-4 py-2.5">
      <input type="hidden" name="view" value="bills" />

      <div className="min-w-[8rem] flex-[1_1_8rem]">
        <label htmlFor={ids.show} className="sr-only">
          Status
        </label>
        <select id={ids.show} name="show" defaultValue={params.show} onChange={submit} className={field}>
          <option value="active">Status: Active</option>
          <option value="paused">Status: Paused{counts.paused > 0 ? ` (${counts.paused})` : ""}</option>
          <option value="archived">Status: Archived{counts.archived > 0 ? ` (${counts.archived})` : ""}</option>
        </select>
      </div>
      <div className="min-w-[8rem] flex-[1_1_8rem]">
        <label htmlFor={ids.pay} className="sr-only">
          Who pays
        </label>
        <select id={ids.pay} name="pay" defaultValue={params.pay ?? ""} onChange={submit} className={field}>
          <option value="">Any payment</option>
          <option value="hand">You pay by hand</option>
          <option value="autopay">On autopay</option>
        </select>
      </div>
      <div className="min-w-[8rem] flex-[1_1_8rem]">
        <label htmlFor={ids.freq} className="sr-only">
          How often
        </label>
        <select id={ids.freq} name="freq" defaultValue={params.freq ?? ""} onChange={submit} className={field}>
          <option value="">Any frequency</option>
          <option value="monthly">Every month</option>
          <option value="quarterly">Every 3 months</option>
          <option value="semiannual">Twice a year</option>
          <option value="annual">Once a year</option>
        </select>
      </div>
      <div className="min-w-[8rem] flex-[1_1_8rem]">
        <label htmlFor={ids.sort} className="sr-only">
          Sort by
        </label>
        <select id={ids.sort} name="sort" defaultValue={params.sort} onChange={submit} className={field}>
          <option value="next">Sort: Next due</option>
          <option value="name">Sort: Name</option>
          <option value="amount">Sort: Amount</option>
        </select>
      </div>

      <div className="relative min-w-[12rem] flex-[2_1_14rem]">
        <label htmlFor={ids.q} className="sr-only">
          Search bills
        </label>
        <Search size={15} strokeWidth={1.8} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" />
        <input id={ids.q} name="q" type="search" defaultValue={params.q} placeholder="Bill, contractor or category" className={`${field} pl-8`} />
      </div>
      <button type="submit" className="inline-flex min-h-[34px] items-center rounded-md bg-ink px-4 text-[13px] font-medium text-paper hover:bg-ink-mid">
        Search
      </button>
      {clearHref ? (
        <Link href={clearHref} className="inline-flex min-h-[32px] items-center px-1 text-[12px] font-medium text-ink underline underline-offset-2">
          Clear
        </Link>
      ) : null}
    </form>
  );
}
