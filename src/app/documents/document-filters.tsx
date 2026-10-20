"use client";

import Link from "next/link";
import { useId, useRef } from "react";
import { Search } from "lucide-react";

export interface DocumentFilterOptions {
  category: string;
  view: string;
  sort: string;
  q: string;
  categories: { id: string; label: string; count: number }[];
  total: number;
  reviewCount: number;
  unfiledCount: number;
  /** Only the board can see the bin. */
  binnedCount: number | null;
  clearHref: string | null;
}

export const SORT_OPTIONS = [
  { value: "newest", label: "Sort: Newest first" },
  { value: "oldest", label: "Sort: Oldest first" },
  { value: "title", label: "Sort: Title A to Z" },
] as const;

/**
 * The documents search, filter and sort bar. Same shape as the problems bar: a plain GET form, so every
 * filtered list is a link; selects submit on change, the search on Enter or the button.
 */
export function DocumentFilters(o: DocumentFilterOptions) {
  const form = useRef<HTMLFormElement>(null);
  const ids = { q: useId(), category: useId(), status: useId(), sort: useId() };
  const submit = () => form.current?.requestSubmit();
  const field = "block min-h-[34px] w-full rounded-md border border-line-strong bg-paper px-2.5 text-[16px] text-ink sm:text-[13px]";
  // One value for the category select: a view (review/binned) is its own status, a category is its own filter.
  const status = o.view === "review" || o.view === "binned" ? o.view : "all";

  return (
    <form ref={form} action="/documents" method="get" className="flex flex-wrap items-center gap-2 px-4 py-2.5" aria-label="Search, filter and sort documents">
      <div className="min-w-[7rem] flex-[1_1_8rem]">
        <label htmlFor={ids.status} className="sr-only">
          Status
        </label>
        <select id={ids.status} name="view" defaultValue={status === "all" ? "" : status} onChange={submit} className={field}>
          <option value="">Status: All</option>
          {o.reviewCount > 0 || status === "review" ? <option value="review">{`Status: Needs review (${o.reviewCount})`}</option> : null}
          {o.binnedCount !== null && (o.binnedCount > 0 || status === "binned") ? <option value="binned">{`Status: Binned (${o.binnedCount})`}</option> : null}
        </select>
      </div>
      <div className="min-w-[8rem] flex-[1_1_9rem]">
        <label htmlFor={ids.category} className="sr-only">
          Category
        </label>
        <select id={ids.category} name="category" defaultValue={o.category} onChange={submit} className={field}>
          <option value="">{`Any category (${o.total})`}</option>
          {o.unfiledCount > 0 ? <option value="unfiled">{`Unfiled (${o.unfiledCount})`}</option> : null}
          {o.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {`${c.label} (${c.count})`}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-[8rem] flex-[1_1_8rem]">
        <label htmlFor={ids.sort} className="sr-only">
          Sort
        </label>
        <select id={ids.sort} name="sort" defaultValue={o.sort} onChange={submit} className={field}>
          {SORT_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="relative min-w-[12rem] flex-[2_1_14rem]">
        <label htmlFor={ids.q} className="sr-only">
          Search documents
        </label>
        <Search size={15} strokeWidth={1.8} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" />
        <input id={ids.q} name="q" type="search" defaultValue={o.q} placeholder="Title, filename or words inside the file" className={`${field} pl-8`} />
      </div>
      <button type="submit" className="inline-flex min-h-[34px] items-center rounded-md bg-ink px-4 text-[13px] font-medium text-paper hover:bg-ink-mid">
        Search
      </button>
      {o.clearHref ? (
        <Link href={o.clearHref} className="inline-flex min-h-[32px] items-center px-1 text-[12px] font-medium text-ink underline underline-offset-2">
          Clear
        </Link>
      ) : null}
    </form>
  );
}
