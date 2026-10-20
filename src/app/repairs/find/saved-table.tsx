"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Pill, type PillTone } from "@/components/repairs/pills";
import { btnLink } from "@/components/repairs/styles";
import { AssignButton } from "./assign-button";
import { ContactLinks } from "./contact-links";
import { SavedSelect } from "./find-context";

export interface SavedRow {
  vendorId: string;
  name: string;
  status: "preferred" | "okay";
  why: { key: string; text: string; tone: PillTone }[];
  phone: string | null;
  email: string | null;
  website: string | null;
  ratesText: string | null;
  /** The best rating on record: the board's own average, else Google's. */
  rating: number | null;
  jobs: number;
  /** Your board's own reviews (average and how many) and Google's rating (and how many). Either may be missing. */
  boardReviews: { average: number; count: number } | null;
  googleReviews: { rating: number; count: number } | null;
}

/** Fixed columns, desktop only: select, contractor, reviews, contact, rates, actions. Below that each row stacks. */
const COLUMNS = "xl:grid xl:grid-cols-[2.75rem_minmax(0,1fr)_10rem_15rem_12rem_11rem] xl:items-center xl:gap-x-3";
// With no problem to pick a contractor for there is no checkbox column, so the table is centered in its card.
const COLUMNS_NO_PICK = "xl:grid xl:grid-cols-[minmax(0,1fr)_10rem_15rem_12rem_11rem] xl:items-center xl:gap-x-3";
// The reasons that add something beyond the status pill and the Board Reviews column, at most two of them.
const SKIP_WHY = new Set(["preferred", "trade", "board_reviews", "would_hire_again", "rating", "distance"]);
/** Right-hand offsets of the rules between the columns (running width to the right plus half a 0.75rem gap). */
const LINES = ["xl:right-[11.375rem]", "xl:right-[24.125rem]", "xl:right-[39.875rem]", "xl:right-[50.625rem]"];

const field = "block min-h-[34px] w-full rounded-md border border-line-strong bg-paper px-2.5 text-[16px] text-ink sm:text-[13px]";
const pill =
  "inline-flex min-h-[32px] cursor-pointer items-center rounded-full border border-line-strong bg-paper px-3 text-[12px] font-medium text-ink hover:bg-fill has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-paper has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brass";

/** Five stars, filled gold to the rating: 4.5 fills four and a half. The number is always written beside it. */
function Stars({ rating }: { rating: number }) {
  const pct = Math.max(0, Math.min(5, rating)) * 20;
  return (
    <span className="relative inline-block text-[13px] leading-none tracking-[1px]" role="img" aria-label={`${rating.toFixed(1)} out of 5 stars`}>
      <span className="text-line-strong">★★★★★</span>
      <span className="absolute inset-y-0 left-0 overflow-hidden whitespace-nowrap text-brass" style={{ width: `${pct}%` }}>
        ★★★★★
      </span>
    </span>
  );
}

function ReviewLine({ label, rating, count }: { label: string; rating: number; count: number }) {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-mute xl:justify-center">
      <Stars rating={rating} />
      <span className="figures text-ink">{rating.toFixed(1)}</span>
      <span>
        ({count.toLocaleString("en-US")}) {label}
      </span>
    </p>
  );
}

type Sort = "best" | "name" | "rating" | "used";

/**
 * "Your contractors who do this" as a table, with a sort and a few filters
 * that work on the list already on the page (no new search). The order they
 * arrive in is the ranking for this job, which "Best match" keeps.
 */
export function SavedTable({
  rows,
  forTicket,
  assign,
}: {
  rows: SavedRow[];
  forTicket: boolean;
  assign: { ticketId: string; reference: number; assignedVendorId: string | null } | null;
}) {
  const [sort, setSort] = useState<Sort>("best");
  const [status, setStatus] = useState<"" | "preferred" | "okay">("");
  const [hasPhone, setHasPhone] = useState(false);
  const [hasEmail, setHasEmail] = useState(false);

  const shown = useMemo(() => {
    const list = rows
      .filter((r) => !status || r.status === status)
      .filter((r) => !hasPhone || r.phone)
      .filter((r) => !hasEmail || r.email);
    if (sort === "name") return [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "rating") return [...list].sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    if (sort === "used") return [...list].sort((a, b) => b.jobs - a.jobs);
    return list;
  }, [rows, status, hasPhone, hasEmail, sort]);
  const filtered = status !== "" || hasPhone || hasEmail || sort !== "best";

  return (
    <div>
      <div className="-mx-5 -mt-4 mb-3 flex flex-wrap items-center gap-2 border-b-2 border-line-strong bg-fill/40 px-5 py-2.5">
        <div className="min-w-[8rem] flex-[1_1_9rem]">
          <label htmlFor="saved-sort" className="sr-only">
            Sort by
          </label>
          <select id="saved-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={field}>
            <option value="best">Sort: Best match</option>
            <option value="name">Sort: Name</option>
            <option value="rating">Sort: Highest rated</option>
            <option value="used">Sort: Most used</option>
          </select>
        </div>
        <div className="min-w-[8rem] flex-[1_1_9rem]">
          <label htmlFor="saved-status" className="sr-only">
            Rating
          </label>
          <select id="saved-status" value={status} onChange={(e) => setStatus(e.target.value as "" | "preferred" | "okay")} className={field}>
            <option value="">Any rating</option>
            <option value="preferred">Preferred</option>
            <option value="okay">Okay</option>
          </select>
        </div>
        <label className={pill}>
          <input type="checkbox" checked={hasPhone} onChange={(e) => setHasPhone(e.target.checked)} className="sr-only" />
          Has a phone number
        </label>
        <label className={pill}>
          <input type="checkbox" checked={hasEmail} onChange={(e) => setHasEmail(e.target.checked)} className="sr-only" />
          Has an email
        </label>
        {filtered ? (
          <button
            type="button"
            onClick={() => {
              setSort("best");
              setStatus("");
              setHasPhone(false);
              setHasEmail(false);
            }}
            className="inline-flex min-h-[32px] items-center px-1 text-[12px] font-medium text-ink underline underline-offset-2"
          >
            Clear
          </button>
        ) : null}
        <span className="ml-auto text-[12px] text-mute">
          {shown.length} of {rows.length}
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="py-2 text-[13px] text-mute">None of them match those filters.</p>
      ) : (
        <div className="relative isolate">
          {LINES.map((c) => (
            <span key={c} aria-hidden="true" className={`pointer-events-none absolute inset-y-0 -z-10 hidden w-px bg-line xl:block ${c}`} />
          ))}
          <div aria-hidden="true" className={`${forTicket ? COLUMNS : COLUMNS_NO_PICK} mb-1 border-b border-line pb-2 text-[11px] font-bold uppercase tracking-wide text-ink`}>
            {forTicket ? <span /> : null}
            <span className="text-center">Contractor</span>
            <span className="text-center">Board Reviews</span>
            <span className="text-center">Contact</span>
            <span className="text-center">Rates you were quoted</span>
            <span className="text-center">Actions</span>
          </div>
          {/* Every other contractor gets a faint blue band, edge to edge. */}
          <ul className="divide-y divide-line [&>li:nth-child(even)]:bg-ink/[0.045]">
            {shown.map((c) => (
              <li key={c.vendorId} className={`-mx-5 flex flex-col gap-2 px-5 py-3 ${forTicket ? COLUMNS : COLUMNS_NO_PICK}`}>
                {forTicket ? <SavedSelect vendorId={c.vendorId} name={c.name} /> : null}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 xl:justify-center">
                    <Link href={`/contractors/${c.vendorId}`} className="text-[15px] font-medium text-ink underline-offset-2 hover:underline">
                      {c.name}
                    </Link>
                    <Pill tone={c.status === "preferred" ? "good" : "outline"}>{c.status === "preferred" ? "Preferred" : "Okay"}</Pill>
                    {c.why.filter((w) => !SKIP_WHY.has(w.key)).slice(0, 2).map((w) => (
                      <Pill key={w.key} tone={w.tone}>
                        {w.text}
                      </Pill>
                    ))}
                  </div>
                </div>
                <div className="space-y-0.5">
                  {c.boardReviews ? <ReviewLine label="your board" rating={c.boardReviews.average} count={c.boardReviews.count} /> : null}
                  {c.googleReviews ? <ReviewLine label="Google" rating={c.googleReviews.rating} count={c.googleReviews.count} /> : null}
                  {!c.boardReviews && !c.googleReviews ? <p className="text-[12px] text-mute-soft xl:text-center">No reviews yet</p> : null}
                </div>
                <ContactLinks phone={c.phone} email={c.email} website={c.website} />
                <p className="text-[12px] text-mute xl:text-center">{c.ratesText ?? "No rates recorded"}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 xl:flex-col xl:justify-center">
                  {assign ? (
                    <AssignButton ticketId={assign.ticketId} reference={assign.reference} vendorId={c.vendorId} assigned={assign.assignedVendorId === c.vendorId} />
                  ) : null}
                  <Link href={`/contractors/${c.vendorId}`} className={btnLink}>
                    View profile
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
