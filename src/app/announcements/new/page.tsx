import Link from "next/link";
import { BoardOnly } from "@/components/board-only";

import { buildingTodayIso } from "@/lib/dates";
import { ViewerUnavailable } from "@/components/owner/viewer-unavailable";
import { getViewer } from "@/lib/owner/viewer";
import { loadComposerData } from "../composer-data";
import { Composer } from "../composer";

export const dynamic = "force-dynamic";

export default async function NewAnnouncementPage() {
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
  const data = await loadComposerData(viewer, buildingTodayIso(), null);
  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6">
      <div>
        <Link href="/announcements" className="inline-flex min-h-[44px] items-center text-[13px] text-mute hover:underline">
          &larr; Announcements
        </Link>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">New announcement</h1>
        <p className="mt-1 text-mute">Owners see this on their home page. No comments, no replies.</p>
      </div>
      <Composer initial={null} units={data.units} ownersByUnit={data.ownersByUnit} documents={data.documents} />
    </div>
  );
}
