"use client";

import { useId, useState, useTransition } from "react";
import { addReview, type ReviewTag } from "@/app/contractors/vendor-actions";
import { StarRating } from "./star-rating";
import { btnPrimary, btnSecondary, errorClass, labelClass, textareaClass } from "./styles";

export const REVIEW_TAG_LABEL: Record<ReviewTag, string> = {
  on_time: "On time",
  left_clean: "Left it clean",
  price_matched: "Price matched the quote",
  would_hire_again: "Would hire again",
};
const TAGS = Object.keys(REVIEW_TAG_LABEL) as ReviewTag[];

/**
 * The compact review form (repairs-spec §5.5, §10.6): stars, the four quick
 * tags, optional text. Used after a close-out ("How did {name} do?") and for
 * "Turn into a review" on a reporter's visit feedback. Board only (RLS).
 */
export function QuickReview(props: {
  vendorId: string;
  vendorName: string;
  ticketId?: string | null;
  upkeepLogId?: string | null;
  initialBody?: string;
  /** Shown above the stars; defaults to "How did {name} do?". */
  heading?: string;
  onDone: (saved: boolean) => void;
  skipLabel?: string;
}) {
  const [rating, setRating] = useState<number | null>(null);
  const [tags, setTags] = useState<ReviewTag[]>([]);
  const [body, setBody] = useState(props.initialBody ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const bodyId = useId();

  function save() {
    if (rating === null) {
      setError("Pick a number of stars.");
      return;
    }
    setError(null);
    start(async () => {
      const r = await addReview({
        vendorId: props.vendorId,
        rating,
        tags,
        body: body.trim() || null,
        ticketId: props.ticketId ?? null,
        upkeepLogId: props.upkeepLogId ?? null,
      });
      if ("error" in r) setError(r.error);
      else props.onDone(true);
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-[15px] font-medium text-ink">{props.heading ?? `How did ${props.vendorName} do?`}</p>
      <StarRating value={rating} onChange={setRating} disabled={pending} />
      <fieldset>
        <legend className={labelClass}>Anything that stood out</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {TAGS.map((t) => {
            const on = tags.includes(t);
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                disabled={pending}
                onClick={() => setTags((xs) => (on ? xs.filter((x) => x !== t) : [...xs, t]))}
                className={`min-h-[44px] rounded-full border px-4 text-[13px] ${
                  on ? "border-ink bg-ink text-paper" : "border-line-strong bg-paper text-ink hover:bg-fill"
                }`}
              >
                {REVIEW_TAG_LABEL[t]}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div>
        <label htmlFor={bodyId} className={labelClass}>
          Anything to add (optional)
        </label>
        <textarea id={bodyId} rows={3} value={body} onChange={(e) => setBody(e.target.value)} disabled={pending} className={textareaClass} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={pending} className={btnPrimary}>
          {pending ? "Saving…" : "Save review"}
        </button>
        <button type="button" onClick={() => props.onDone(false)} disabled={pending} className={btnSecondary}>
          {props.skipLabel ?? "Skip"}
        </button>
      </div>
      {error ? <p className={errorClass}>{error}</p> : null}
    </div>
  );
}
