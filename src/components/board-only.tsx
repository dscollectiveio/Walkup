import { getViewer } from "@/lib/owner/viewer";
import { BoardOnlyView } from "@/components/board-only-view";

/**
 * The page an owner sees where the board's tools would be (owner-portal-spec
 * 2.4): it says so plainly, says what the page is, and points to the owner
 * page that serves the same need. Never an empty state that pretends nothing
 * exists. Server component; reads the cached viewer, so it costs no extra
 * query where the layout already loaded it.
 *
 * Use it in place of an empty state or Restricted, for a signed-in person who
 * is not the board or the accountant (see viewerIsOwnerOnly()).
 */
export async function BoardOnly(props: {
  what: string;
  why: string;
  alternative?: { label: string; href: string };
}) {
  const viewer = await getViewer();
  return <BoardOnlyView {...props} contact={viewer?.boardContact ?? null} />;
}

/** True for a signed-in person who is neither board nor accountant: the guard's condition. */
export async function viewerIsOwnerOnly(): Promise<boolean> {
  const viewer = await getViewer();
  return viewer !== null && !viewer.isStaff;
}
