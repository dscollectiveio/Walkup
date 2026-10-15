"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { REVIEW_TAG_LABEL } from "@/components/repairs/quick-review";
import { StarRating } from "@/components/repairs/star-rating";
import { btnDanger, btnPrimary, btnSecondary, errorClass, inputClass, labelClass, linkClass, textareaClass } from "@/components/repairs/styles";
import { humanDate } from "@/lib/repairs/format";
import { addReview, deleteReview, updateReview, type ReviewTag } from "../vendor-actions";

export interface ReviewView {
  id: string;
  rating: number;
  tags: ReviewTag[];
  body: string | null;
  author: string;
  createdAt: string;
  edited: boolean;
  mine: boolean;
  ticket: { id: string; reference: number; title: string } | null;
  upkeep: { taskId: string; taskName: string; doneOn: string } | null;
}

const TAGS = Object.keys(REVIEW_TAG_LABEL) as ReviewTag[];

/**
 * "Reviews from the board" (repairs-spec §10.2 item 6). Stars as a radio
 * group, the four quick tags, optional text and the problem it was about.
 * Authors edit their own; only a board admin deletes (board members have no
 * deletes).
 */
export function ReviewsCard(props: {
  vendorId: string;
  reviews: ReviewView[];
  canEdit: boolean;
  isAdmin: boolean;
  tickets: { id: string; label: string }[];
  todayIso: string;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {props.reviews.length === 0 ? (
        <p className="text-[13px] text-mute">No reviews yet.</p>
      ) : (
        <ul className="space-y-4">
          {props.reviews.map((r) =>
            editing === r.id ? (
              <li key={r.id} className="rounded-lg border border-line p-4">
                <ReviewForm vendorId={props.vendorId} review={r} tickets={props.tickets} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <ReviewItem
                key={r.id}
                r={r}
                todayIso={props.todayIso}
                canEditThis={props.canEdit && r.mine}
                canDelete={props.isAdmin}
                onEdit={() => setEditing(r.id)}
              />
            ),
          )}
        </ul>
      )}
      {props.canEdit ? (
        adding ? (
          <div className="rounded-lg border border-line p-4">
            <ReviewForm vendorId={props.vendorId} review={null} tickets={props.tickets} onDone={() => setAdding(false)} />
          </div>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className={btnSecondary}>
            Add a review
          </button>
        )
      ) : null}
    </div>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${n} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={14} strokeWidth={1.6} aria-hidden="true" className={i <= n ? "fill-brass text-brass" : "text-line-strong"} />
      ))}
    </span>
  );
}

function ReviewItem(props: { r: ReviewView; todayIso: string; canEditThis: boolean; canDelete: boolean; onEdit: () => void }) {
  const router = useRouter();
  const { r } = props;
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <li className="border-l-2 border-line pl-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <Stars n={r.rating} />
        {r.tags.map((t) => (
          <span key={t} className="rounded-full bg-fill px-2 py-0.5 text-[11px] text-mute">
            {REVIEW_TAG_LABEL[t] ?? t}
          </span>
        ))}
      </div>
      {r.body ? <p className="mt-1 whitespace-pre-wrap text-ink">{r.body}</p> : null}
      <p className="mt-1 text-[12px] text-mute">
        {r.author} · {humanDate(r.createdAt.slice(0, 10), props.todayIso)}
        {r.edited ? " · edited" : ""}
        {r.ticket ? (
          <>
            {" · "}
            <Link href={`/maintenance/${r.ticket.id}`} className={linkClass}>
              #{r.ticket.reference} {r.ticket.title}
            </Link>
          </>
        ) : r.upkeep ? (
          <>
            {" · "}
            <Link href={`/repairs/upkeep/${r.upkeep.taskId}`} className={linkClass}>
              {r.upkeep.taskName}, {humanDate(r.upkeep.doneOn, props.todayIso)}
            </Link>
          </>
        ) : null}
      </p>
      {props.canEditThis || props.canDelete ? (
        <div className="mt-1 flex flex-wrap items-center gap-3">
          {props.canEditThis ? (
            <button type="button" onClick={props.onEdit} className="inline-flex min-h-[44px] items-center text-[13px] text-ink underline underline-offset-2">
              Edit
            </button>
          ) : null}
          {props.canDelete && !confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="inline-flex min-h-[44px] items-center text-[13px] text-bad-text underline underline-offset-2"
            >
              Delete
            </button>
          ) : null}
        </div>
      ) : null}
      {confirming ? (
        <div className="mt-2 space-y-2 rounded-lg border border-bad-line bg-bad-tint px-3 py-3">
          <p className="text-[13px] text-bad-text">Delete this review? This can&rsquo;t be undone.</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              className={btnDanger}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const res = await deleteReview(r.id);
                  if ("error" in res) setError(res.error);
                  else router.refresh();
                })
              }
            >
              {pending ? "Deleting…" : "Delete"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={btnSecondary}>
              Keep it
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p className={errorClass}>{error}</p> : null}
    </li>
  );
}

function ReviewForm(props: { vendorId: string; review: ReviewView | null; tickets: { id: string; label: string }[]; onDone: () => void }) {
  const router = useRouter();
  const fid = useId();
  const [rating, setRating] = useState<number | null>(props.review?.rating ?? null);
  const [tags, setTags] = useState<ReviewTag[]>(props.review?.tags ?? []);
  const [body, setBody] = useState(props.review?.body ?? "");
  const [ticketId, setTicketId] = useState(props.review?.ticket?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    if (rating === null) {
      setError("Pick a number of stars.");
      return;
    }
    setError(null);
    start(async () => {
      const input = { rating, tags, body: body.trim() || null, ticketId: ticketId || null };
      const r = props.review
        ? await updateReview(props.review.id, input)
        : await addReview({ vendorId: props.vendorId, ...input, upkeepLogId: null });
      if ("error" in r) setError(r.error);
      else {
        props.onDone();
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
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
                className={`min-h-[44px] rounded-full border px-4 text-[13px] ${on ? "border-ink bg-ink text-paper" : "border-line-strong bg-paper text-ink hover:bg-fill"}`}
              >
                {REVIEW_TAG_LABEL[t]}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div>
        <label htmlFor={`${fid}-body`} className={labelClass}>
          Anything to add (optional)
        </label>
        <textarea id={`${fid}-body`} rows={3} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} className={textareaClass} />
      </div>
      {props.tickets.length > 0 ? (
        <div>
          <label htmlFor={`${fid}-ticket`} className={labelClass}>
            Which problem (optional)
          </label>
          <select id={`${fid}-ticket`} value={ticketId} onChange={(e) => setTicketId(e.target.value)} className={inputClass}>
            <option value="">None</option>
            {props.tickets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={pending} className={btnPrimary}>
          {pending ? "Saving…" : props.review ? "Save changes" : "Save review"}
        </button>
        <button type="button" onClick={props.onDone} disabled={pending} className={btnSecondary}>
          Cancel
        </button>
      </div>
      {error ? <p className={errorClass}>{error}</p> : null}
    </div>
  );
}
