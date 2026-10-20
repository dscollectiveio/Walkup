"use client";

import { useState } from "react";
import { Siren, Star } from "lucide-react";
import { labelClass } from "@/components/repairs/styles";
import { btnPrimary } from "@/components/repairs/styles";
import { MILES_MAX, MILES_MIN, MILES_STEP, MIN_REVIEWS_OPTIONS, RATING_STEP, WANT_LABEL } from "@/lib/contractors/find-params";
import { JOB_WANTS, type JobWant } from "@/lib/contractors/ranking";
import type { HistoryEntry } from "@/lib/contractors/search-history";
import { PreviousSearches } from "./search-history";
import { TradeFields } from "./trade-fields";

const smallLabel = "block text-[12px] text-mute";
const selectClass = "mt-1 block min-h-[40px] w-full rounded-lg border border-line-strong bg-paper px-3 text-[16px] text-ink sm:text-[14px]";

const pill =
  "inline-flex min-h-[36px] cursor-pointer items-center rounded-full border border-line-strong bg-paper px-3.5 text-[13px] font-medium text-ink hover:bg-fill has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-paper has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brass";

/**
 * Everything about the search that can be changed, in one form: the kind of
 * work (and, for "other", the words to search for), what matters for the job,
 * and how far to look. It is a plain GET form, so the first search and every
 * re-search are the same thing, and a search is still a link. "What matters"
 * and the distance change the ranking and the Google circle; none of it hides
 * anyone from the saved list.
 */
export function SearchSettings(props: {
  ticketId: string | null;
  taskId: string | null;
  current: string | null;
  phrase?: string;
  wants: JobWant[];
  miles: number;
  minRating: number;
  minReviews: number;
  openNow: boolean;
  submitLabel: string;
  /** The search on the page now, to add to the history; null before anything has been searched. */
  searchNow?: Omit<HistoryEntry, "at"> | null;
}) {
  const [wants, setWants] = useState<JobWant[]>(props.wants);
  const [miles, setMiles] = useState(Math.max(MILES_MIN, props.miles));
  const [rating, setRating] = useState(props.minRating);
  return (
    <form method="get" action="/repairs/find" className="space-y-4">
      {props.ticketId ? <input type="hidden" name="ticket" value={props.ticketId} /> : null}
      {props.taskId ? <input type="hidden" name="task" value={props.taskId} /> : null}
      {/* Everything switched off has to be said out loud, or an urgent job would switch "emergency" back on. */}
      {wants.length === 0 ? <input type="hidden" name="want" value="none" /> : null}

      <TradeFields current={props.current} phrase={props.phrase ?? ""} />

      <div className="border-t border-line pt-4">
      <fieldset>
        <legend className={`${labelClass} px-0`}>What matters for this job</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {JOB_WANTS.map((w) => (
            <label key={w} className={pill}>
              <input
                type="checkbox"
                name="want"
                value={w}
                checked={wants.includes(w)}
                onChange={(e) => setWants((cur) => (e.target.checked ? JOB_WANTS.filter((x) => x === w || cur.includes(x)) : cur.filter((x) => x !== w)))}
                className="sr-only"
              />
              {WANT_LABEL[w]}
            </label>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-mute">These change the ranking and the reasons shown. They never hide anyone.</p>
      </fieldset>
      </div>

      {/* Narrow the results and how far to look: one line (it wraps on a narrow screen), with the button at the end. */}
      <div className="border-t border-line pt-4">
        <p className={labelClass}>Narrow your search</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-3 xl:flex-nowrap">
          <div className="min-w-[10rem] flex-1 text-center">
            <label htmlFor="find-miles" className={smallLabel}>
              <span className="sr-only">How far to look: </span>Within {miles} miles
            </label>
            <input
              id="find-miles"
              name="miles"
              type="range"
              min={MILES_MIN}
              max={MILES_MAX}
              step={MILES_STEP}
              value={miles}
              onChange={(e) => setMiles(Number(e.target.value))}
              className="mt-1 block h-10 w-full cursor-pointer accent-[var(--color-ink)]"
            />
          </div>
          <span className="hidden h-9 w-px shrink-0 self-center bg-line-strong/60 xl:block" aria-hidden="true" />
          <div className="min-w-[10rem] flex-1 text-center">
            <label htmlFor="find-rating" className={smallLabel}>
              <Star size={13} className="mr-1 inline fill-brass text-brass" aria-hidden="true" />
              {rating === 0 ? "Any rating" : `${rating} stars or more`}
            </label>
            <input
              id="find-rating"
              name="rating"
              type="range"
              min={0}
              max={5}
              step={RATING_STEP}
              value={rating}
              onChange={(e) => setRating(Number(e.target.value))}
              aria-valuetext={rating === 0 ? "Any rating" : `${rating} stars or more`}
              className="mt-1 block h-10 w-full cursor-pointer accent-[var(--color-ink)]"
            />
          </div>
          <span className="hidden h-9 w-px shrink-0 self-center bg-line-strong/60 xl:block" aria-hidden="true" />
          <div className="min-w-[10rem] flex-1 text-center">
            <label htmlFor="find-reviews" className={smallLabel}>
              Minimum reviews
            </label>
            <select id="find-reviews" name="reviews" defaultValue={String(props.minReviews)} className={`${selectClass} text-center`}>
              {MIN_REVIEWS_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? "Any number" : `${m} or more`}
                </option>
              ))}
            </select>
          </div>
          <span className="hidden h-9 w-px shrink-0 self-center bg-line-strong/60 xl:block" aria-hidden="true" />
          <div className="min-w-[10rem] flex-1 text-center">
            <p className={smallLabel}>Availability</p>
            <label
              title="Only businesses open right now or open 24 hours, or whose own site says they take emergency calls"
              className="mt-1 flex min-h-[40px] w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-bad-line bg-paper px-3.5 text-[13px] font-semibold text-bad-text hover:bg-bad-tint has-[:checked]:border-bad has-[:checked]:bg-bad has-[:checked]:text-paper has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brass"
            >
              <input type="checkbox" name="open" value="1" defaultChecked={props.openNow} className="sr-only" />
              <Siren size={16} strokeWidth={2} aria-hidden="true" />
              Emergency Services
            </label>
          </div>
          <div className="min-w-[10rem] shrink-0 text-center">
            <span className={`${smallLabel} invisible`} aria-hidden="true">
              Search
            </span>
            <button type="submit" className={`${btnPrimary} mt-1 w-full min-w-[10rem] !min-h-[40px] px-8`}>
              {props.submitLabel}
            </button>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-mute">
          The minimums and Emergency Services apply to what is found nearby. Emergency Services keeps businesses open right now or open 24 hours, or whose own site says they take emergency calls. When one is set, results with no rating, review count or hours listed are left out. The distance sets how far Google looks, 5 to 100 miles.
        </p>
      </div>
      <PreviousSearches job={props.ticketId ?? props.taskId ?? ""} current={props.searchNow ?? null} />
    </form>
  );
}
