"use client";

import { useActionState, useState } from "react";
import { recordAccessReview } from "./actions";
import { ACCESS_REVIEW_INTERVAL_DAYS } from "@/lib/home/reminders";

export interface AccessReviewRecord {
  id: string;
  reviewedAt: string;
  reviewerName: string | null;
  notes: string | null;
  grantCount: number;
  revokedCount: number;
}

export function AccessReviewCard({
  reviews,
  activeGrantCount,
  daysSince,
}: {
  reviews: AccessReviewRecord[];
  activeGrantCount: number;
  /** Days since the most recent review, computed on the server; null = never. */
  daysSince: number | null;
}) {
  const [state, action, pending] = useActionState(recordAccessReview, null);
  const [open, setOpen] = useState(false);

  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.ok) setOpen(false);
  }

  const last = reviews[0] ?? null;
  const overdue = daysSince === null || daysSince > ACCESS_REVIEW_INTERVAL_DAYS;

  return (
    <div className="space-y-4">
      <div
        className={`rounded-lg border px-3 py-2 text-[13px] ${
          overdue
            ? "border-warning bg-warning-tint text-warning-text"
            : "border-good-line bg-good-tint text-good-text"
        }`}
      >
        {last === null
          ? "No access review has been recorded yet."
          : overdue
            ? `Last reviewed ${daysSince} days ago — a review is due every ${ACCESS_REVIEW_INTERVAL_DAYS} days.`
            : `Last reviewed ${daysSince === 0 ? "today" : `${daysSince} days ago`}. Next one due in ${
                ACCESS_REVIEW_INTERVAL_DAYS - (daysSince ?? 0)
              } days.`}
      </div>

      <p className="text-[13px] leading-relaxed text-mute">
        Look over everyone in People above who has access ({activeGrantCount} active{" "}
        {activeGrantCount === 1 ? "grant" : "grants"}) and remove anything that shouldn&rsquo;t be
        there. Recording the review also revokes access that has lapsed on its own — expired
        accountant grants and owners whose sale has closed — and keeps a snapshot of who had
        access that day.
      </p>

      {state?.ok && typeof state.revoked === "number" && state.revoked > 0 ? (
        <p className="text-[12px] text-mute">
          Review recorded. {state.revoked} lapsed {state.revoked === 1 ? "grant was" : "grants were"}{" "}
          revoked.
        </p>
      ) : null}

      {open ? (
        <form action={action} className="space-y-3 rounded-xl border border-line bg-paper p-4">
          <div>
            <label htmlFor="review_notes" className="block text-[12px] font-medium text-ink">
              Notes
              <span className="ml-1 font-normal text-mute-soft">optional — what you changed, if anything</span>
            </label>
            <textarea
              id="review_notes"
              name="notes"
              rows={2}
              className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
            />
          </div>
          {state?.error ? <p className="text-[12px] text-bad-text">{state.error}</p> : null}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
            >
              {pending ? "Recording…" : "I've reviewed everyone's access"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-line-strong px-4 py-2 text-[13px] text-ink hover:bg-fill"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid"
        >
          Record an access review
        </button>
      )}

      {reviews.length > 0 ? (
        <div className="border-t border-line pt-3">
          <h3 className="text-[12px] font-medium text-mute">Review history</h3>
          <ul className="mt-2 divide-y divide-line text-[12px]">
            {reviews.map((r) => (
              <li key={r.id} className="py-2">
                <span className="text-ink">{new Date(r.reviewedAt).toLocaleDateString()}</span>
                <span className="ml-2 text-mute">
                  {r.reviewerName ?? "Unknown"} · {r.grantCount} active{" "}
                  {r.grantCount === 1 ? "grant" : "grants"}
                  {r.revokedCount > 0 ? ` · ${r.revokedCount} lapsed revoked` : ""}
                </span>
                {r.notes ? <div className="mt-0.5 text-mute-soft">{r.notes}</div> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
