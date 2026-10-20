"use client";

import Link from "next/link";
import { useId, useRef } from "react";
import { Search } from "lucide-react";
import { CONTRACTOR_SORTS, SORT_LABEL, type DirectoryParams } from "@/lib/contractors/directory";

/**
 * The contractors search and filter row, set inside the Your contractors card
 * (as the Problems tab's is). A plain GET form, so every
 * result is a link. Selects and the archived pill apply as soon as they
 * change; the search applies on Enter or the button.
 */
export function ContractorFilters({
  params,
  mainTrades,
  moreTrades,
  archivedCount,
  clearHref,
}: {
  params: DirectoryParams;
  mainTrades: { slug: string; label: string }[];
  moreTrades: { slug: string; label: string }[];
  archivedCount: number;
  /** Set when any filter or the sort is not the default. */
  clearHref: string | null;
}) {
  const form = useRef<HTMLFormElement>(null);
  const ids = { q: useId(), trade: useId(), status: useId(), sort: useId() };
  const submit = () => form.current?.requestSubmit();
  const field =
    "block min-h-[34px] w-full rounded-md border border-line-strong bg-paper px-2.5 text-[16px] text-ink sm:text-[13px]";

  return (
    <div>
      <form ref={form} action="/repairs" method="get" className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <input type="hidden" name="view" value="contractors" />

        <div className="min-w-[9rem] flex-[1_1_10rem]">
          <label htmlFor={ids.trade} className="sr-only">
            Kind of work
          </label>
          <select id={ids.trade} name="trade" defaultValue={params.trades[0] ?? ""} onChange={submit} className={field}>
            <option value="">Any kind of work</option>
            {mainTrades.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.label}
              </option>
            ))}
            {moreTrades.length > 0 ? (
              <optgroup label="Other kinds of work">
                {moreTrades.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </div>
        <div className="min-w-[8rem] flex-[1_1_8rem]">
          <label htmlFor={ids.status} className="sr-only">
            Rating
          </label>
          <select id={ids.status} name="status" defaultValue={params.status ?? ""} onChange={submit} className={field}>
            <option value="">Any rating</option>
            <option value="preferred">Preferred</option>
            <option value="okay">Okay</option>
            <option value="do_not_use">Do not use</option>
          </select>
        </div>
        <div className="min-w-[9rem] flex-[1_1_9rem]">
          <label htmlFor={ids.sort} className="sr-only">
            Sort by
          </label>
          <select id={ids.sort} name="sort" defaultValue={params.sort} onChange={submit} className={field}>
            {CONTRACTOR_SORTS.map((s) => (
              <option key={s} value={s}>
                Sort: {SORT_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <label className="inline-flex min-h-[32px] cursor-pointer items-center gap-2 rounded-full border border-line-strong bg-paper px-3 text-[12px] font-medium text-ink hover:bg-fill has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-paper has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brass">
          <input type="checkbox" name="archived" value="1" defaultChecked={params.archived} onChange={submit} className="sr-only" />
          Show archived{archivedCount > 0 && !params.archived ? ` (${archivedCount})` : ""}
        </label>

        <div className="relative min-w-[12rem] flex-[2_1_14rem]">
          <label htmlFor={ids.q} className="sr-only">
            Search contractors
          </label>
          <Search size={15} strokeWidth={1.8} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" />
          <input id={ids.q} name="q" type="search" defaultValue={params.q} placeholder="Name, contact or kind of work" className={`${field} pl-8`} />
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
    </div>
  );
}
