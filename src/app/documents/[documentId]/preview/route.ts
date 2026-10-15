import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/documents/upload-paths";
import { previewKind } from "@/lib/documents/preview";

/**
 * The bytes of a document for the Viewing section's frame, served from our own
 * origin so the page can show it without opening the CSP to Storage. Read
 * under the caller's session, so the documents rule decides who gets it; a
 * document they can't see is a 404. Only PDFs, PNG and JPEG photos and plain
 * text are served inline, and always with their own fixed type (never what a
 * file claims) and nosniff. Anything else is a 415 and the page offers the
 * download instead.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  if (!isUuid(documentId)) return new Response("Not found", { status: 404 });

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("documents")
    .select("storage_path, mime_type, filename")
    .eq("id", documentId)
    .limit(1);
  const doc = rows?.[0];
  if (!doc) return new Response("Not found", { status: 404 });

  const kind = previewKind(doc.mime_type as string | null);
  if (!kind) return new Response("No preview for this kind of file", { status: 415 });

  const { data: blob, error } = await supabase.storage.from("documents").download(doc.storage_path as string);
  if (error || !blob) return new Response("Not found", { status: 404 });

  const type = kind === "pdf" ? "application/pdf" : kind === "text" ? "text/plain; charset=utf-8" : (doc.mime_type as string);
  const name = encodeURIComponent(doc.filename as string);
  return new Response(await blob.arrayBuffer(), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `inline; filename*=UTF-8''${name}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
