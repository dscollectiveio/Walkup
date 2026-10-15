import Link from "next/link";
import { BoardOnly } from "@/components/board-only";

import { buildingTodayIso } from "@/lib/dates";
import { isUuid } from "@/lib/repairs/server";
import { ViewerUnavailable } from "@/components/owner/viewer-unavailable";
import { getViewer } from "@/lib/owner/viewer";
import { loadComposerData } from "../../composer-data";
import { Composer } from "../../composer";

export const dynamic = "force-dynamic";

export default async function EditAnnouncementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  if (!viewer) return <ViewerUnavailable />;
  if (!viewer.isBoard) {
    return (
      <BoardOnly
        what="Posting announcements"
        why="Only the board posts to owners."
        alternative={{ label: "Back to announcements", href: "/announcements" }}
      />
    );
  }
  const data = isUuid(id) ? await loadComposerData(viewer, buildingTodayIso(), id) : null;
  if (!data || !data.found || !data.initial) {
    return (
      <div className="mx-auto w-full max-w-[640px] space-y-4">
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Edit announcement</h1>
        <p className="text-[14px] text-ink">
          {data?.archived ? "Restore this announcement before editing it." : "This announcement isn't available."}
        </p>
        <Link href="/announcements" className="inline-flex min-h-[44px] items-center text-[13px] underline underline-offset-2">
          Back to announcements
        </Link>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6">
      <div>
        <Link href="/announcements" className="inline-flex min-h-[44px] items-center text-[13px] text-mute hover:underline">
          &larr; Announcements
        </Link>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Edit announcement</h1>
        {data.initial.status === "published" ? (
          <p className="mt-1 text-mute">This is already posted. Owners will see it marked Edited.</p>
        ) : (
          <p className="mt-1 text-mute">This is a draft. Owners can&rsquo;t see it yet.</p>
        )}
      </div>
      <Composer initial={data.initial} units={data.units} ownersByUnit={data.ownersByUnit} documents={data.documents} />
    </div>
  );
}
