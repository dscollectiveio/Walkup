import { Card } from "@/components/ui";
import { cancelStaleImports, importViewer, IMPORT_TITLE_PREFIX } from "@/lib/import/server";
import type { ImportKind } from "@/lib/import/kinds";
import { History, type HistoryRow } from "./history";
import { StartCards } from "./start-cards";
import { Unfinished, type UnfinishedBatch, type UnfinishedUpload } from "./unfinished";
import { BoardOnly, PageHeader } from "./ui";

export const dynamic = "force-dynamic";

export default async function ImportStartPage() {
  const { supabase, associationId, role } = await importViewer();
  if (!associationId || (role !== "board_admin" && role !== "board_member")) {
    return <BoardOnly what="Importing" why="Only a board admin can bring in spreadsheets." />;
  }
  const isAdmin = role === "board_admin";
  if (isAdmin) await cancelStaleImports(supabase, associationId);

  const { data: batches, error } = await supabase
    .from("import_batches")
    .select("id, kind, filename, status, row_count, summary, created_at, committed_at, created_by")
    .eq("association_id", associationId)
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) {
    return <p role="alert" className="text-[13px] text-bad-text">We couldn&rsquo;t load your imports. Reload the page.</p>;
  }

  const userIds = [...new Set((batches ?? []).map((b) => b.created_by).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (userIds.length) {
    const { data: people } = await supabase.from("persons").select("auth_user_id, full_name").in("auth_user_id", userIds);
    for (const p of (people ?? []) as { auth_user_id: string; full_name: string }[]) names.set(p.auth_user_id, p.full_name);
  }

  const rows = (batches ?? []) as {
    id: string; kind: ImportKind; filename: string; status: HistoryRow["status"]; row_count: number;
    summary: { created?: number } | null; created_at: string; committed_at: string | null; created_by: string | null;
  }[];
  const history: HistoryRow[] = rows
    .filter((b) => b.status === "committed" || b.status === "undone")
    .map((b) => ({
      id: b.id,
      kind: b.kind,
      filename: b.filename,
      status: b.status,
      rowCount: b.row_count,
      created: b.summary?.created ?? null,
      who: (b.created_by && names.get(b.created_by)) || "A board member",
      when: b.committed_at ?? b.created_at,
    }));
  const unfinishedBatches: UnfinishedBatch[] = rows
    .filter((b) => b.status === "uploaded" || b.status === "validated")
    .map((b) => ({ id: b.id, kind: b.kind, filename: b.filename, when: b.created_at }));

  let uploads: UnfinishedUpload[] = [];
  if (isAdmin) {
    const { data: docs } = await supabase
      .from("documents")
      .select("id, filename, uploaded_at")
      .eq("association_id", associationId)
      .like("title", `${IMPORT_TITLE_PREFIX}%`)
      .is("deleted_at", null)
      .order("uploaded_at", { ascending: false })
      .limit(20);
    uploads = ((docs ?? []) as { id: string; filename: string; uploaded_at: string }[]).map((d) => ({
      documentId: d.id,
      filename: d.filename,
      when: d.uploaded_at,
    }));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import from a spreadsheet"
        sub="Bring in your units, owners, last year's transactions and opening balances instead of typing them. Nothing is saved until you've checked it."
      />
      {isAdmin ? (
        <>
          <StartCards />
          <p className="text-[13px] text-mute">Suggested order: units and owners, contractors, opening balances, then transactions.</p>
        </>
      ) : (
        <p className="border-l-[3px] border-neutral bg-neutral-tint px-4 py-3 text-[13px] text-neutral-text">
          Importing is for board admins.
        </p>
      )}
      {isAdmin && (unfinishedBatches.length > 0 || uploads.length > 0) ? (
        <Card title="Unfinished uploads">
          <Unfinished batches={unfinishedBatches} uploads={uploads} />
        </Card>
      ) : null}
      <Card title="Past imports">
        <History rows={history} canUndo={isAdmin} />
      </Card>
    </div>
  );
}
