import Link from "next/link";
import { Megaphone, Pin } from "lucide-react";
import { shortDate } from "@/lib/dates";
import { announcementPreview, sortAnnouncements, type AnnouncementRow } from "@/lib/owner/announcements";

/** How many notices the Dashboard banner lists before "View all". */
export const ANNOUNCEMENTS_ON_HOME = 3;

/**
 * The board's newest notices as a highlighted gold banner that hangs from the
 * bottom of the top bar on the Dashboard: pinned first, then newest, a few at
 * most. The negative margins cancel <main>'s padding (app-frame.tsx) so it
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
  const hang = "-mx-6 -mt-8 mb-2 rounded-b-xl min-[900px]:-mx-8";

  // Nothing posted, no banner, for anyone.
  if (visible.length === 0) return null;

  return (
    <section
      aria-labelledby="home-announcements-title"
      className={`${hang} overflow-hidden border-x border-b-[3px] border-x-warning-line border-b-brass bg-warning-tint`}
    >
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-6 pb-1 pt-3 min-[900px]:px-8">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brass text-on-brass">
            <Megaphone size={14} strokeWidth={2} aria-hidden="true" />
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
      <ul className="pb-2">
        {visible.map((r) => {
          const when = r.published_at ?? r.created_at;
          const isUnread = unread.has(r.id);
          return (
            <li key={r.id}>
              <Link
                href={`/announcements/${r.id}`}
                className="flex items-start gap-3 px-6 py-2 transition-colors hover:bg-brass/10 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brass min-[900px]:px-8"
              >
                <span
                  aria-hidden="true"
                  className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${isUnread ? "bg-brass" : "bg-transparent"}`}
                />
                <div className="min-w-0 flex-1">
                  <p className={`break-words text-[14px] text-ink ${isUnread ? "font-semibold" : "font-medium"}`}>
                    {r.pinned ? (
                      <Pin
                        size={12}
                        strokeWidth={2}
                        aria-label="Pinned"
                        className="mr-1.5 inline-block align-[-1px] text-warning-text"
                      />
                    ) : null}
                    {r.title}
                    {isUnread ? <span className="sr-only"> (unread)</span> : null}
                  </p>
                  <p className="mt-0.5 truncate text-[13px] text-mute">{announcementPreview(r.body, 120)}</p>
                </div>
                <span className="shrink-0 pt-0.5 text-[12px] text-warning-text">{shortDate(when.slice(0, 10), todayIso)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
