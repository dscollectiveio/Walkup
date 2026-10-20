import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { sortAnnouncements, type AnnouncementRow } from "@/lib/owner/announcements";
import { AnnouncementLines } from "./announcement-lines";

/** How many notices the Dashboard banner lists before "View all". */
export const ANNOUNCEMENTS_ON_HOME = 3;

/**
 * The board's newest notices as a highlighted gold banner that hangs from the
 * bottom of the top bar on the Dashboard: pinned first, then newest, a few at
 * most. Each line opens as a pop-out (announcement-lines.tsx). The negative margins cancel <main>'s padding (app-frame.tsx) so it
 * sits flush against the bar. Board members get a Post link. When nothing is
 * posted there is no banner at all.
 */
export function AnnouncementsStrip({
  rows,
  unread,
  todayIso,
  canPost,
}: {
  rows: AnnouncementRow[];
  unread: Set<string>;
  todayIso: string;
  canPost: boolean;
}) {
  const sorted = sortAnnouncements(rows);
  const visible = sorted.slice(0, ANNOUNCEMENTS_ON_HOME);
  const unreadCount = sorted.filter((r) => unread.has(r.id)).length;
  const hang = "-mx-6 -mt-8 mb-10 rounded-b-xl min-[900px]:-mx-8";

  // Nothing posted, no banner, for anyone.
  if (visible.length === 0) return null;

  return (
    <section
      aria-labelledby="home-announcements-title"
      className={`${hang} overflow-hidden border-x border-b-[3px] border-x-warning-line border-b-brass bg-warning-tint`}
    >
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 px-6 pb-1 pt-2 min-[900px]:px-8">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brass text-on-brass">
            <CircleAlert size={13} strokeWidth={2.4} aria-hidden="true" />
          </span>
          <h2 id="home-announcements-title" className="eyebrow text-warning-text">
            Announcements
          </h2>
          {unreadCount > 0 ? (
            <span className="rounded-full bg-brass px-2 py-0.5 text-[11px] font-semibold text-on-brass">{unreadCount} new</span>
          ) : null}
        </div>
        <div className="flex items-center gap-4 text-[13px] font-medium">
          {canPost ? (
            <Link href="/announcements/new" className="text-warning-text underline-offset-2 hover:underline">
              Post
            </Link>
          ) : null}
          <Link href="/announcements" className="text-warning-text underline-offset-2 hover:underline">
            View all{sorted.length > visible.length ? ` (${sorted.length})` : ""}
          </Link>
        </div>
      </header>
      <AnnouncementLines rows={visible} unreadIds={[...unread]} todayIso={todayIso} />
    </section>
  );
}
