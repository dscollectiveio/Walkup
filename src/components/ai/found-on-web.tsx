"use client";

import { useState } from "react";
import { longDate } from "@/lib/dates";

/**
 * Where web-found results came from, and that Walkup doesn't vouch for them
 * (brief decisions 1, 5; foundation-spec 10.4). Shown under every list or
 * card of businesses found by web research.
 */

const DAY_MS = 86_400_000;

/** Pure: the lines this component shows, for tests. `now` in ms. */
export function foundOnWebLines(opts: {
  sourceCount: number;
  fetchedAt: string;
  scope: "item" | "list";
  partial?: boolean;
  ratingsFromWebOnly?: boolean;
  now: number;
}): { header: string; disclaimer: string; stale: boolean; partial: string | null; ratings: string | null } {
  const n = opts.sourceCount;
  const fetched = new Date(opts.fetchedAt).getTime();
  return {
    header: `Found on the web, ${longDate(opts.fetchedAt)} · ${n} ${n === 1 ? "source" : "sources"}`,
    disclaimer:
      opts.scope === "item"
        ? "Walkup didn't check this business and doesn't endorse it. Confirm details with them."
        : "Walkup didn't check these businesses and doesn't endorse any of them. Confirm details with them.",
    stale: !Number.isNaN(fetched) && opts.now - fetched > 7 * DAY_MS,
    partial: opts.partial ? "Showing what Walkup could check before the search ran out of time. Search again for more." : null,
    ratings: opts.ratingsFromWebOnly ? "Ratings shown only where a source page states them." : null,
  };
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function FoundOnWeb(props: {
  sources: { url: string; title: string | null }[];
  fetchedAt: string;              // ISO
  scope: "item" | "list";         // one business, or a list of them
  partial?: boolean;
  ratingsFromWebOnly?: boolean;
  onSearchAgain?: () => void;     // or
  searchAgainHref?: string;
  /** The current time in ms, when the caller already has it; defaults to the time this mounted. */
  now?: number;
}) {
  const { sources, fetchedAt, scope, partial, ratingsFromWebOnly, onSearchAgain, searchAgainHref } = props;
  // The age only decides whether to suggest searching again: the time at mount is enough.
  const [mountedAt] = useState(() => Date.now());
  const now = props.now ?? mountedAt;
  const lines = foundOnWebLines({ sourceCount: sources.length, fetchedAt, scope, partial, ratingsFromWebOnly, now });

  const again = onSearchAgain ? (
    <button type="button" onClick={onSearchAgain} className="font-medium text-ink underline underline-offset-2">
      Search again
    </button>
  ) : searchAgainHref ? (
    <a href={searchAgainHref} className="font-medium text-ink underline underline-offset-2">
      Search again
    </a>
  ) : null;

  return (
    <div className="space-y-1 text-[12px] text-mute">
      <p>{lines.header}</p>
      <p>{lines.disclaimer}</p>
      {lines.stale ? (
        <p>
          Details can change.{again ? <> {again}</> : null}
        </p>
      ) : null}
      {lines.partial ? <p>{lines.partial}</p> : null}
      {lines.ratings ? <p>{lines.ratings}</p> : null}
      {sources.length > 0 ? (
        <details>
          <summary className="cursor-pointer py-1 font-medium text-ink">Sources</summary>
          <ul className="mt-1 space-y-1">
            {sources.map((s) => (
              <li key={s.url} className="break-words">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="text-ink underline underline-offset-2"
                >
                  {s.title || hostLabel(s.url)}
                </a>
                {s.title ? <span className="text-mute-soft"> {hostLabel(s.url)}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
