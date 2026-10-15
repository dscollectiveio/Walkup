import "server-only";
import { createClient } from "@/lib/supabase/server";
import { currentAssociationId } from "@/lib/documents/access";
import { IMPORT_LIMITS } from "./limits";
import { isImportKind, type ImportKind } from "./kinds";
import { parseImportFile } from "./parse-file";
import type { ParsedFile } from "./types";

/**
 * Shared pieces for the import server actions and pages. Server-only.
 * Every call runs with the signed-in person's session; RLS and the import_*
 * functions are the gate, and these helpers only give a plain answer first.
 */

export type Supabase = Awaited<ReturnType<typeof createClient>>;

export const NOT_ADMIN = "Only a board admin can import.";
export const IMPORT_TITLE_PREFIX = "Import: ";

export type BoardContext =
  | { ok: true; supabase: Supabase; associationId: string }
  | { ok: false; error: string };

export async function boardAdminContext(): Promise<BoardContext> {
  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { ok: false, error: "No association is visible to you." };
  const { data } = await supabase.rpc("has_role_in", { assoc: associationId, roles: ["board_admin"] });
  if (data !== true) return { ok: false, error: NOT_ADMIN };
  return { ok: true, supabase, associationId };
}

export type ViewerRole = "board_admin" | "board_member" | "other" | "none";

export async function importViewer(): Promise<{ supabase: Supabase; associationId: string | null; role: ViewerRole }> {
  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { supabase, associationId: null, role: "none" };
  const { data: admin } = await supabase.rpc("has_role_in", { assoc: associationId, roles: ["board_admin"] });
  if (admin === true) return { supabase, associationId, role: "board_admin" };
  const { data: board } = await supabase.rpc("is_board", { assoc: associationId });
  return { supabase, associationId, role: board === true ? "board_member" : "other" };
}

export interface UploadedDocument {
  id: string;
  filename: string;
  title: string | null;
  storagePath: string;
  uploadedAt: string;
  bytes: Uint8Array;
}

/** The uploaded file's row and bytes, read with the caller's session. Null when it is not theirs to read. */
export async function loadUploadedFile(supabase: Supabase, documentId: string): Promise<UploadedDocument | null> {
  const { data } = await supabase
    .from("documents")
    .select("id, filename, title, storage_path, uploaded_at, deleted_at")
    .eq("id", documentId)
    .limit(1);
  const doc = data?.[0] as
    | { id: string; filename: string; title: string | null; storage_path: string; uploaded_at: string; deleted_at: string | null }
    | undefined;
  if (!doc || doc.deleted_at) return null;
  const { data: blob, error } = await supabase.storage.from("documents").download(doc.storage_path);
  if (error || !blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { id: doc.id, filename: doc.filename, title: doc.title, storagePath: doc.storage_path, uploadedAt: doc.uploaded_at, bytes };
}

export type LoadedParse =
  | { ok: true; doc: UploadedDocument; file: ParsedFile }
  | { ok: false; error: string };

export async function loadAndParse(supabase: Supabase, documentId: string, kind: ImportKind): Promise<LoadedParse> {
  const doc = await loadUploadedFile(supabase, documentId);
  if (!doc) return { ok: false, error: "We couldn't find that upload. Upload the file again." };
  const parsed = await parseImportFile(doc.bytes, doc.filename, { kindHint: kind });
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, doc, file: parsed.file };
}

/** Only an upload this wizard made (and titled) is ever removed by the wizard. */
export function isImportUpload(doc: { title: string | null }): boolean {
  return (doc.title ?? "").startsWith(IMPORT_TITLE_PREFIX);
}

export async function purgeImportUpload(supabase: Supabase, documentId: string): Promise<boolean> {
  const { data } = await supabase.from("documents").select("title").eq("id", documentId).limit(1);
  const row = data?.[0] as { title: string | null } | undefined;
  if (!row || !isImportUpload(row)) return false;
  const { data: deleted, error } = await supabase.from("documents").delete().eq("id", documentId).select("storage_path");
  if (error || !deleted?.length) return false;
  const path = (deleted[0] as { storage_path: string | null }).storage_path;
  if (path) await supabase.storage.from("documents").remove([path]);
  return true;
}

/** Batches left open for more than 14 days are cancelled the next time a board admin opens the start page. */
export async function cancelStaleImports(supabase: Supabase, associationId: string): Promise<number> {
  const cutoff = new Date(Date.now() - IMPORT_LIMITS.staleAfterDays * 86_400_000).toISOString();
  const { data } = await supabase
    .from("import_batches")
    .select("id")
    .eq("association_id", associationId)
    .in("status", ["uploaded", "validated"])
    .lt("created_at", cutoff);
  let n = 0;
  for (const b of (data ?? []) as { id: string }[]) {
    const { error } = await supabase.rpc("import_cancel", { p_batch_id: b.id });
    if (!error) n += 1;
  }
  return n;
}

export function kindOrNull(value: unknown): ImportKind | null {
  return isImportKind(value) ? value : null;
}
