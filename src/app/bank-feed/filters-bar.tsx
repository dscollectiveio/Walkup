"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { FilterSelect } from "./filter-select";
import {
  RANGES,
  RANGE_LABEL,
  bankFeedHref,
  type FeedParams,
  type Range,
} from "./href";

const DEBOUNCE_MS = 300;

/**
 * Search and range for the transactions list, applied as you type: the bar
 * rewrites the same query params the page reads (router.replace, no scroll),
 * so the server re-filters and the URL stays shareable. Always showing:
 * finding a payee is a core job, not an advanced one.
 */
export function FiltersBar({
  current,
  accountLabel,
  bankAccounts = [],
}: {
  current: FeedParams;
  /** The connected bank accounts (checking, savings, …) the list can be limited to. */
  bankAccounts?: { id: string; label: string }[];
  /** Plain name of the category behind ?account=, for its chip. */
  accountLabel?: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [text, setText] = useState(current.q ?? "");
  const [range, setRange] = useState<Range>(current.range);

  // Any change resets the page size: a new filter should start from the top.
  const go = (overrides: Partial<FeedParams>) =>
    startTransition(() => {
      router.replace(
        bankFeedHref({ ...current, limit: undefined, ...overrides }),
        { scroll: false },
      );
    });

  // The search is applied after a short pause in typing. Comparing hrefs
  // (strings) keeps the effect from restarting on unrelated re-renders.
  const pendingHref =
    text !== (current.q ?? "")
      ? bankFeedHref({ ...current, limit: undefined, q: text })
      : null;
  useEffect(() => {
    if (!pendingHref) return;
    const timer = setTimeout(() => {
      startTransition(() => router.replace(pendingHref, { scroll: false }));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [pendingHref, router]);

  // The search box and the range select show (and clear) their own state, so
  // the only chip is the category filter, which has no control of its own.
  const accountChip = current.account
    ? `Only ${accountLabel ?? "one category"}`
    : null;

  const input =
    "rounded-lg border border-line-strong bg-paper px-3 py-1.5 min-h-[44px] text-[16px] text-ink sm:min-h-0 sm:text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brass";

  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="Search by payee or description"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search by payee or description…"
          className={`${input} min-w-0 flex-1 basis-full sm:basis-auto sm:min-w-[12rem]`}
        />
        <FilterSelect
          label="Date range"
          value={range}
          options={RANGES.map((r) => ({ value: r, label: RANGE_LABEL[r] }))}
          onChange={(v) => {
            const next = v as Range;
            setRange(next);
            go({ range: next });
          }}
        />
        {range === "custom" ? (
          <span className="inline-flex flex-wrap items-center gap-1.5 text-[12px] text-mute">
            <input
              type="date"
              aria-label="From date"
              value={current.from ?? ""}
              max={current.to || undefined}
              onChange={(e) => go({ range: "custom", from: e.target.value || undefined })}
              className={input}
            />
            to
            <input
              type="date"
              aria-label="To date"
              value={current.to ?? ""}
              min={current.from || undefined}
              onChange={(e) => go({ range: "custom", to: e.target.value || undefined })}
              className={input}
            />
          </span>
        ) : null}
        {bankAccounts.length > 0 ? (
          <FilterSelect
            label="Bank account"
            value={current.bank ?? ""}
            options={[
              { value: "", label: "All bank accounts" },
              ...(current.bank &&
              !bankAccounts.some((a) => a.id === current.bank)
                ? [{ value: current.bank, label: "Another account" }]
                : []),
              ...bankAccounts.map((a) => ({ value: a.id, label: a.label })),
            ]}
            onChange={(v) => go({ bank: v || undefined })}
          />
        ) : null}
        {accountChip ? (
          <button
            type="button"
            onClick={() => go({ account: undefined })}
            aria-label={`Remove filter: ${accountChip}`}
            className="inline-flex min-h-[44px] items-center gap-1 rounded-full border border-line-strong bg-fill px-3 py-1 text-[12px] sm:min-h-0 sm:px-2.5 text-ink hover:bg-paper"
          >
            {accountChip}
            <X size={12} strokeWidth={1.6} aria-hidden="true" />
          </button>
        ) : null}
        {isPending || pendingHref ? (
          <span className="text-[11px] text-mute-soft">Updating…</span>
        ) : null}
      </div>
    </div>
  );
}
