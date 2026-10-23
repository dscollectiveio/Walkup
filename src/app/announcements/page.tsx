import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty } from "@/components/ui";
import { AnnouncementItem } from "@/components/owner/announcement-item";
import { btnPrimary } from "@/components/repairs/styles";
import { buildingTodayIso, longDate } from "@/lib/dates";
import {
  audienceLabel,
  readSummary,
  sortAnnouncements,
  type AnnouncementRow,
  type AnnouncementStatus,
} from "@/lib/owner/announcements";
import { loadAnnouncements } from "@/lib/owner/load";
import { ViewerUnavailable } from "@/components/owner/viewer-unavailable";
import { getViewer } from "@/lib/owner/viewer";
import { BoardRowActions } from "./board-row";

export const dynamic = "force-dynamic";

const COLUMNS =
  "id, title, body, audience, pinned, importance, status, attachment_document_id, expires_on, published_at, edited_at, created_at";
const TABS: { key: "posted" | "drafts" | "archived"; label: string; status: AnnouncementStatus }[] = [
  { key: "posted", label: "Posted", status: "published" },
  { key: "drafts", label: "Drafts", status: "draft" },
  { key: "archived", label: "Archived", status: "archived" },
];
const EMPTY_TAB: Record<string, string> = {
  posted: "Nothing posted yet. Post a notice and owners see it on their home page.",
  drafts: "No drafts.",
  archived: "Nothing archived.",
};

/** Notices from the board. Owners read; the board also composes, pins, archives and sees counts (owner-portal-spec 6.4). */
export default async function AnnouncementsPage({ searchParams }: { searchParams: Promise<{ tab?: string; notice?: string }> }) {
  const sp = await searchParams;
  const viewer = await getViewer();
  if (!viewer) return <ViewerUnavailable />;
  const supabase = await createClient();
  const today = buildingTodayIso();

  if (!viewer.isBoard) {
    const result = await loadAnnouncements(supabase, today, 100);
    return (
      <div className="mx-auto w-full max-w-[760px] space-y-6">
        <div>
          <h1 className="text-[20px] font-bold tracking-tight text-ink">Announcements</h1>
          <p className="mt-1 text-mute">Notices from the board.</p>
        </div>
        {result === null ? (
          <p className="text-[14px] text-mute">We couldn&rsquo;t load announcements. Reload the page.</p>
        ) : result.rows.length === 0 ? (
          <Card navy title="Announcements">
            <Empty>Nothing posted yet. When the board posts something, it shows up here.</Empty>
          </Card>
        ) : (
          <div className="space-y-3">
            {sortAnnouncements(result.rows).map((r) => (
              <section key={r.id} className="overflow-hidden rounded-xl border border-line bg-paper">
                <AnnouncementItem row={r} unread={result.unread.has(r.id)} todayIso={today} band />
              </section>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Board view.
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const { data, error } = await supabase
    .from("announcements")
    .select(COLUMNS)
    .eq("status", tab.status)
    .order("pinned", { ascending: false })
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = sortAnnouncements((data ?? []) as unknown as AnnouncementRow[]);
  const ids = rows.map((r) => r.id);

  const [unitsRes, auRes, statsRes] = await Promise.all([
    supabase.from("units").select("id, label"),
    ids.length ? supabase.from("announcement_units").select("announcement_id, unit_id").in("announcement_id", ids) : Promise.resolve({ data: [] }),
    tab.status === "draft"
      ? Promise.resolve({ data: [] })
      : supabase.rpc("announcement_reader_stats", { p_association_id: viewer.associationId }),
  ]);
  const unitLabel = new Map((unitsRes.data ?? []).map((u) => [u.id as string, u.label as string]));
  const labelsFor = new Map<string, string[]>();
  for (const au of (auRes.data ?? []) as { announcement_id: string; unit_id: string }[]) {
    const list = labelsFor.get(au.announcement_id) ?? [];
    list.push(unitLabel.get(au.unit_id) ?? "A unit");
    labelsFor.set(au.announcement_id, list);
  }
  const stats = new Map(
    ((statsRes.data ?? []) as { announcement_id: string; readers_total: number; readers_read: number; no_login: number }[]).map((s) => [s.announcement_id, s]),
  );

  return (
    <div className="mx-auto w-full max-w-[900px] space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[20px] font-bold tracking-tight text-ink">Announcements</h1>
          <p className="mt-1 text-mute">Post to everyone, or to chosen units.</p>
        </div>
        <Link href="/announcements/new" className={`${btnPrimary} w-full sm:w-auto`}>
          New announcement
        </Link>
      </div>

      {sp.notice === "posted" || sp.notice === "draft" ? (
        <p role="status" className="border-l-[3px] border-good bg-good-tint px-4 py-2 text-[14px] text-good-text">
          {sp.notice === "posted" ? "Posted." : "Draft saved."}
        </p>
      ) : null}

      <nav aria-label="Announcement lists" className="inline-flex max-w-full gap-1 overflow-x-auto rounded-full border border-line bg-paper p-1 shadow-sm">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/announcements?tab=${t.key}`}
            aria-current={t.key === tab.key ? "page" : undefined}
            className={`inline-flex min-h-[44px] items-center rounded-full px-5 text-[13px] font-medium transition-colors ${
              t.key === tab.key ? "bg-ink text-paper" : "text-ink hover:bg-fill"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {error ? (
        <p className="text-[14px] text-mute">We couldn&rsquo;t load announcements. Reload the page.</p>
      ) : rows.length === 0 ? (
        <Card navy title={tab.label}>
          <Empty>{EMPTY_TAB[tab.key]}</Empty>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const s = stats.get(r.id);
            const ended = r.expires_on !== null && r.expires_on < today && r.status === "published";
            return (
              <section key={r.id} className="overflow-hidden rounded-xl border border-line bg-paper">
                <AnnouncementItem
                  row={r}
                  unread={false}
                  todayIso={today}
                  band
                  actions={<BoardRowActions id={r.id} status={r.status} pinned={r.pinned} />}
                  extra={
                    <p className="text-[12px] text-mute">
                      {audienceLabel(r, labelsFor.get(r.id) ?? [])}
                      {ended ? " · Ended" : r.expires_on && r.status === "published" ? ` · Shows through ${longDate(r.expires_on)}` : ""}
                      {s ? ` · ${readSummary(s)}` : r.status !== "draft" ? ` · ${readSummary({ readers_total: 0, readers_read: 0, no_login: 0 })}` : ""}
                    </p>
                  }
                />
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
