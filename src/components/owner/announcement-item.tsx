import Link from "next/link";
import { Pill } from "@/components/repairs/pills";
import { announcementPreview, type AnnouncementRow } from "@/lib/owner/announcements";
import { ImportancePill } from "./importance-pill";
import { longDate, shortDate } from "@/lib/dates";

/**
 * One announcement in a list (owner-portal-spec 6.1, 6.4): title as the link,
 * date, a Pinned pill, a "New" dot with a text alternative, a two-line preview.
 * Server-safe. The body is only ever rendered as text.
 */
export function AnnouncementItem({
  row,
  unread,
  todayIso,
  compact = false,
  extra,
  band = false,
  actions,
}: {
  row: AnnouncementRow;
  unread: boolean;
  todayIso: string;
  compact?: boolean;
  /** The board's audience and read receipt, under the preview. */
  extra?: React.ReactNode;
  /** The Announcements page: the title sits in a navy bar with white text, like the other cards, and the card is the caller's. */
  band?: boolean;
  /** Under the body, inside the card (the board's buttons). Only used with `band`. */
  actions?: React.ReactNode;
}) {
  const when = row.published_at ? (compact ? shortDate(row.published_at, todayIso) : longDate(row.published_at)) : null;
  if (band) {
    return (
      <>
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 band bg-ink px-5 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            {unread ? <span role="img" aria-label="Not read yet" className="inline-block h-2 w-2 shrink-0 rounded-full bg-brass" /> : null}
            <Link href={`/announcements/${row.id}`} className="min-w-0 break-words text-[15px] font-semibold text-paper underline-offset-2 hover:underline">
              {row.title}
              {unread ? <span className="sr-only">, not read</span> : null}
            </Link>
          </div>
          {when ? (
            <span className="shrink-0 text-[12px] text-ondark-mute">
              {when}
              {row.edited_at ? " · Edited" : ""}
            </span>
          ) : null}
        </header>
        <div className="px-5 pb-4 pt-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 empty:hidden">
            <ImportancePill importance={row.importance} />
            {row.pinned ? <Pill tone="info">Pinned</Pill> : null}
            {row.status === "draft" ? <Pill tone="outline">Draft</Pill> : null}
            {row.status === "archived" ? <Pill tone="outline">Archived</Pill> : null}
            {row.attachment_document_id ? <Pill tone="outline">Has a file</Pill> : null}
          </div>
          <p className="mt-1.5 line-clamp-2 break-words text-[13px] text-ink">{announcementPreview(row.body)}</p>
          {extra ? <div className="mt-2">{extra}</div> : null}
          {actions ? <div className="mt-3">{actions}</div> : null}
        </div>
      </>
    );
  }
  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {unread ? <span role="img" aria-label="Not read yet" className="inline-block h-2 w-2 shrink-0 rounded-full bg-info" /> : null}
        <Link href={`/announcements/${row.id}`} className="text-[15px] font-medium text-ink underline-offset-2 hover:underline">
          {row.title}
          {unread ? <span className="sr-only">, not read</span> : null}
        </Link>
        <ImportancePill importance={row.importance} />
        {row.pinned ? <Pill tone="info">Pinned</Pill> : null}
        {row.status === "draft" ? <Pill tone="outline">Draft</Pill> : null}
        {row.status === "archived" ? <Pill tone="outline">Archived</Pill> : null}
        {row.attachment_document_id ? <Pill tone="outline">Has a file</Pill> : null}
      </div>
      <p className="mt-0.5 text-[12px] text-mute">
        {when}
        {row.edited_at ? `${when ? " · " : ""}Edited` : ""}
      </p>
      <p className="mt-1 line-clamp-2 break-words text-[13px] text-ink">{announcementPreview(row.body)}</p>
      {extra ? <div className="mt-2">{extra}</div> : null}
    </div>
  );
}
