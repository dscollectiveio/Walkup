"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { RANGE_LABEL, bankFeedHref, type FeedParams, type Range } from "./href";

const DEBOUNCE_MS = 300;

/**
 * Search and range for the transactions list, applied as you type: the bar
 * rewrites the same query params the page reads (router.replace, no scroll),
 * so the server re-filters and the URL stays shareable. Opens on its own when
 * a filter becomes active; collapsed, its summary names what is on.
 */
export function FiltersBar({
  current,
  accountLabel,
}: {
  current: FeedParams;
  /** Plain name of the category behind ?account=, for its chip. */
  accountLabel?: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [text, setText] = useState(current.q ?? "");
  const [range, setRange] = useState<Range>(current.range);

  const active = Boolean(current.q) || current.range !== "all" || Boolean(current.account);
  const [open, setOpen] = useState(active);
  // Something became active from outside the bar (a link, a chip): show it.
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (active) setOpen(true);
  }

  // Any change resets the page size: a new filter should start from the top.
  const go = (overrides: Partial<FeedParams>) =>
    startTransition(() => {
      router.replace(bankFeedHref({ ...current, limit: undefined, ...overrides }), { scroll: false });
    });

  // The search is applied after a short pause in typing. Comparing hrefs
  // (strings) keeps the effect from restarting on unrelated re-renders.
  const pendingHref = text !== (current.q ?? "") ? bankFeedHref({ ...current, limit: undefined, q: text }) : null;
  useEffect(() => {
    if (!pendingHref) return;
    const timer = setTimeout(() => {
      startTransition(() => router.replace(pendingHref, { scroll: false }));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [pendingHref, router]);

  // The search box and the range select show (and clear) their own state, so
  // the only chip is the category filter, which has no control of its own.
  // Collapsed, the summary names what is on instead.
  const accountChip = current.account ? `Only ${accountLabel ?? "one category"}` : null;
  const onParts = [
    current.range !== "all" ? RANGE_LABEL[current.range] : null,
    current.q ? `‘${current.q}’` : null,
    accountChip,
  ].filter((p): p is string => p !== null);

  const input =
    "rounded-lg border border-line-strong bg-paper px-3 py-1.5 text-[13px] text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brass";

  return (
    <details className="min-w-0 flex-1" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer select-none text-[12px] text-mute hover:text-ink">
        Filter &amp; search{active ? (open ? " · on" : ` · ${onParts.join(" · ")}`) : ""}
      </summary>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="Search descriptions"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search descriptions…"
          className={`${input} min-w-[12rem] flex-1`}
        />
        <select
          aria-label="Range"
          value={range}
          onChange={(e) => {
            const next = e.target.value as Range;
            setRange(next);
            go({ range: next });
          }}
          className={input}
        >
          {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
            <option key={r} value={r}>
              {RANGE_LABEL[r]}
            </option>
          ))}
        </select>
        {accountChip ? (
          <button
            type="button"
            onClick={() => go({ account: undefined })}
            aria-label={`Remove filter: ${accountChip}`}
            className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-fill px-2.5 py-1 text-[12px] text-ink hover:bg-paper"
          >
            {accountChip}
            <X size={12} strokeWidth={1.6} aria-hidden="true" />
          </button>
        ) : null}
        {isPending || pendingHref ? <span className="text-[11px] text-mute-soft">Updating…</span> : null}
      </div>
    </details>
  );
}
