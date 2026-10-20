"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { addEntry, historyLabel, parseHistory, type HistoryEntry } from "@/lib/contractors/search-history";

const KEY = "walkup:find-history";
const EVENT = "walkup:find-history-changed";

function read(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/**
 * "Previous searches": a dropdown of the searches this person has run, kept in their own browser
 * (nothing is sent anywhere). Picking one runs it again. The search on the page now is added to the
 * list as it opens; the list shows only searches for the same problem or job. Storage being
 * unavailable just means there is no history.
 */
export function PreviousSearches({ job, current }: { job: string; current: Omit<HistoryEntry, "at"> | null }) {
  const router = useRouter();
  const raw = useSyncExternalStore(
    (notify) => {
      window.addEventListener(EVENT, notify);
      window.addEventListener("storage", notify);
      return () => {
        window.removeEventListener(EVENT, notify);
        window.removeEventListener("storage", notify);
      };
    },
    read,
    () => null,
  );
  const entries = useMemo(() => parseHistory(raw).filter((e) => e.job === job), [raw, job]);

  // Remember the search on the page, once per distinct search.
  const href = current?.href ?? null;
  useEffect(() => {
    if (!current) return;
    try {
      const next = addEntry(parseHistory(read()), { ...current, at: new Date().toISOString() });
      window.localStorage.setItem(KEY, JSON.stringify(next));
      window.dispatchEvent(new Event(EVENT));
    } catch {
      /* storage unavailable: no history */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href]);

  function clear() {
    try {
      const rest = parseHistory(read()).filter((e) => e.job !== job);
      window.localStorage.setItem(KEY, JSON.stringify(rest));
      window.dispatchEvent(new Event(EVENT));
    } catch {
      /* nothing to clear */
    }
  }

  return (
    <div className="border-t border-line pt-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-mute">Previous searches</p>
      {entries.length === 0 ? (
        <p className="mt-1 text-[13px] text-mute">Your searches will be listed here so you can run one again.</p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <div className="min-w-[16rem] flex-1">
            <label htmlFor="find-history" className="sr-only">
              Run a previous search again
            </label>
            <select
              id="find-history"
              value=""
              onChange={(e) => {
                if (e.target.value) router.push(e.target.value);
              }}
              className="block min-h-[40px] w-full rounded-lg border border-line-strong bg-paper px-3 text-[16px] text-ink sm:text-[14px]"
            >
              <option value="">History: {entries.length} previous {entries.length === 1 ? "search" : "searches"}. Choose one to run it again.</option>
              {entries.map((e) => (
                <option key={e.href} value={e.href}>
                  {historyLabel(e)}
                </option>
              ))}
            </select>
          </div>
          <button type="button" onClick={clear} className="text-[12px] font-medium text-ink underline underline-offset-2 hover:text-ink-mid">
            Clear history
          </button>
        </div>
      )}
    </div>
  );
}
