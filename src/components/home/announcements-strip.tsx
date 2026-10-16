import Link from "next/link";
import { Megaphone, Pin } from "lucide-react";
import { shortDate } from "@/lib/dates";
import { announcementPreview, sortAnnouncements, type AnnouncementRow } from "@/lib/owner/announcements";

/** How many notices the Dashboard shows before "View all". */
export const ANNOUNCEMENTS_ON_HOME = 3;

/**
 * The newest board notices at the top of the Dashboard: pinned first, then
 * newest, a few at most. Board members get a Post link; when nothing is
 * posted, the board sees one quiet line and everyone else sees nothing.
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
  const visible = sortAnnouncements(rows).slice(0, ANNOUNCEMENTS_ON_HOME);

  if (visible.length === 0) {
    if (!canPost) return null;
    return (
      <section
        aria-labelledby="home-announcements-title"
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-paper px-5 py-3"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <Megaphone size={16} strokeWidth={1.8} aria-hidden="true" className="shrink-0 text-mute" />
          <h2 id="home-announcements-title" className="text-[13px] text-mute">
            No announcements posted yet.
          </h2>
        </div>
        <Link href="/announcements/new" className="text-[13px] font-medium text-ink underline-offset-2 hover:underline">
          Post one
        </Link>
      </section>
    );
  }

  return (
    <section aria-labelledby="home-announcements-title" className="rounded-xl border border-line bg-paper">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line px-5 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Megaphone size={16} strokeWidth={1.8} aria-hidden="true" className="shrink-0 text-mute" />
          <h2 id="home-announcements-title" className="eyebrow text-mute">
            Announcements
          </h2>
        </div>
        <div className="flex items-center gap-4 text-[13px] font-medium">
          {canPost ? (
            <Link href="/announcements/new" className="text-ink underline-offset-2 hover:underline">
              Post
            </Link>
          ) : null}
          <Link href="/announcements" className="text-ink underline-offset-2 hover:underline">
            View all
          </Link>
        </div>
      </header>
      <ul className="divide-y divide-line">
        {visible.map((r) => {
          const when = r.published_at ?? r.created_at;
          const isUnread = unread.has(r.id);
          return (
            <li key={r.id}>
              <Link
                href={`/announcements/${r.id}`}
                className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-fill focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brass"
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
                        className="mr-1.5 inline-block align-[-1px] text-mute"
                      />
                    ) : null}
                    {r.title}
                    {isUnread ? <span className="sr-only"> (unread)</span> : null}
                  </p>
                  <p className="mt-0.5 truncate text-[13px] text-mute">{announcementPreview(r.body, 120)}</p>
                </div>
                <span className="shrink-0 pt-0.5 text-[12px] text-mute">{shortDate(when.slice(0, 10), todayIso)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
