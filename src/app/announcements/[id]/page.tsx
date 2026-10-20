import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui";
import { Pill } from "@/components/repairs/pills";
import { btnSecondary } from "@/components/repairs/styles";
import { buildingTodayIso, longDate } from "@/lib/dates";
import { readableSize } from "@/lib/documents/format";
import { isUuid } from "@/lib/repairs/server";
import { audienceLabel, readSummary, type AnnouncementRow } from "@/lib/owner/announcements";
import { ViewerUnavailable } from "@/components/owner/viewer-unavailable";
import { getViewer } from "@/lib/owner/viewer";
import { MarkRead } from "./mark-read";

export const dynamic = "force-dynamic";

/** One announcement, as plain text (owner-portal-spec 6.5). Visibility is RLS: no row means not for you, or it ended. */
export default async function AnnouncementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  if (!viewer) return <ViewerUnavailable />;
  const supabase = await createClient();
  const today = buildingTodayIso();

  const { data } = isUuid(id)
    ? await supabase
        .from("announcements")
        .select("id, title, body, audience, pinned, status, attachment_document_id, expires_on, published_at, edited_at, created_at")
        .eq("id", id)
        .limit(1)
    : { data: null };
  const row = (data?.[0] ?? null) as unknown as AnnouncementRow | null;
  if (!row) {
    return (
      <div className="mx-auto w-full max-w-[640px] space-y-4">
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Announcement</h1>
        <p className="text-[14px] leading-relaxed text-ink">
          This announcement isn&rsquo;t available. It may have ended, or it may be for other units.
        </p>
        <p>
          <Link href="/announcements" className={btnSecondary}>
            Back to announcements
          </Link>
        </p>
      </div>
    );
  }

  const [docRes, unitsRes, statsRes] = await Promise.all([
    row.attachment_document_id
      ? supabase.from("documents").select("id, title, filename, byte_size").eq("id", row.attachment_document_id).limit(1)
      : Promise.resolve({ data: [] }),
    viewer.isBoard && row.audience === "units"
      ? supabase.from("announcement_units").select("unit_id, units(label)").eq("announcement_id", row.id)
      : Promise.resolve({ data: [] }),
    viewer.isBoard && row.status !== "draft"
      ? supabase.rpc("announcement_reader_stats", { p_association_id: viewer.associationId })
      : Promise.resolve({ data: [] }),
  ]);
  const doc = (docRes.data?.[0] ?? null) as { id: string; title: string | null; filename: string; byte_size: number | null } | null;
  const labels = ((unitsRes.data ?? []) as unknown as { units: { label: string } | { label: string }[] | null }[])
    .map((u) => (Array.isArray(u.units) ? u.units[0]?.label : u.units?.label))
    .filter((l): l is string => Boolean(l));
  const stat = ((statsRes.data ?? []) as { announcement_id: string; readers_total: number; readers_read: number; no_login: number }[]).find(
    (s) => s.announcement_id === row.id,
  );
  const audience = viewer.isBoard ? audienceLabel(row, labels) : row.audience === "all" ? "Everyone" : "Chosen units";
  const ended = row.status === "published" && row.expires_on !== null && row.expires_on < today;

  return (
    <div className="mx-auto w-full max-w-[760px] space-y-6">
      {row.status === "published" ? <MarkRead id={row.id} /> : null}
      <div>
        <Link href="/announcements" className="inline-flex min-h-[44px] items-center text-[13px] text-mute hover:underline">
          &larr; All announcements
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 break-words text-[20px] font-bold tracking-tight text-ink">{row.title}</h1>
          {row.pinned ? <Pill tone="info">Pinned</Pill> : null}
          {row.status === "draft" ? <Pill tone="outline">Draft</Pill> : null}
          {row.status === "archived" ? <Pill tone="outline">Archived</Pill> : null}
          {ended ? <Pill tone="outline">Ended</Pill> : null}
        </div>
        <p className="mt-1 text-[13px] text-mute">
          {row.published_at ? `${longDate(row.published_at)} · ` : ""}
          {audience}
          {row.edited_at ? " · Edited" : ""}
        </p>
        {viewer.isBoard ? (
          <p className="mt-1 text-[13px] text-mute">{stat ? readSummary(stat) : row.status === "draft" ? "Not posted yet." : readSummary({ readers_total: 0, readers_read: 0, no_login: 0 })}</p>
        ) : null}
      </div>

      <Card navy title="Message">
        <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">{row.body}</div>
      </Card>

      {doc ? (
        <Card navy title="Attached file">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="break-words text-[14px] font-medium text-ink">{doc.title || doc.filename}</p>
              {doc.byte_size ? <p className="text-[12px] text-mute">{readableSize(doc.byte_size)}</p> : null}
            </div>
            <Link href={`/documents/${doc.id}`} className={btnSecondary}>
              Open
            </Link>
          </div>
        </Card>
      ) : null}

      {viewer.isBoard && row.status !== "archived" ? (
        <p>
          <Link href={`/announcements/${row.id}/edit`} className={btnSecondary}>
            Edit
          </Link>
        </p>
      ) : null}
    </div>
  );
}
