import Link from "next/link";
import { Pin } from "lucide-react";
import { Card } from "@/components/ui";
import { announcementPreview, sortAnnouncements, type AnnouncementRow } from "@/lib/owner/announcements";

/** How many announcements the Dashboard card lists before "View all". */
const SHOWN = 3;

/** The board's newest announcements as a small Dashboard card: pinned first, then newest. */
export function AnnouncementsCard({
  rows,
  unread,
  canPost,
}: {
  rows: AnnouncementRow[];
  unread: Set<string>;
  canPost: boolean;
}) {
  const sorted = sortAnnouncements(rows);
  const visible = sorted.slice(0, SHOWN);
  if (visible.length === 0 && !canPost) return null;

  return (
    <Card
      title="Announcements"
      action={
        canPost ? (
          <Link href="/announcements/new" className="text-[13px] font-medium text-ink underline-offset-2 hover:underline">
            Post one
          </Link>
        ) : null
      }
    >
      {visible.length === 0 ? (
        <p className="text-[13px] text-mute">Nothing posted yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {visible.map((r) => (
            <li key={r.id} className="flex items-start gap-2">
              {unread.has(r.id) ? (
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brass" aria-label="New" />
              ) : (
                <span className="mt-1.5 h-2 w-2 shrink-0" aria-hidden="true" />
              )}
              <Link href="/announcements" className="min-w-0 text-[13px] text-ink hover:underline">
                <span className="flex items-center gap-1 font-medium">
                  {r.pinned ? <Pin size={12} aria-label="Pinned" /> : null}
                  <span className="truncate">{r.title}</span>
                </span>
                <span className="block truncate text-mute">{announcementPreview(r.body, 90)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {sorted.length > 0 ? (
        <Link href="/announcements" className="mt-3 inline-block text-[13px] font-medium text-ink underline-offset-2 hover:underline">
          View all{sorted.length > visible.length ? ` (${sorted.length})` : ""}
        </Link>
      ) : null}
    </Card>
  );
}
