"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checksum, verifyFile } from "@/lib/documents/file-type";
import { currentAssociationId } from "@/lib/documents/access";
import { runExtraction } from "@/lib/documents/pipeline";

const MAX_BYTES = 25 * 1024 * 1024;

// Kept in step with the check constraint added in 0020
// (document_links_target_table_known) — a target this doesn't list would be
// accepted here and rejected at the database, which is a worse place to find
// out. No `meetings` entry: there is no meetings table. No due-date entry:
// due dates are computed at render time (0017), never stored, so nothing to
// point a link at.
const LINKABLE_TABLES = [
  "units",
  "persons",
  "vendors",
  "journal_entries",
  "expenses",
  "assessment_charges",
  "payments",
  "insurance_policies",
  "tickets",
  "recurring_bills",
  "fiscal_years",
] as const;

type LinkableTable = (typeof LINKABLE_TABLES)[number];

function revalidateLinked(targetTable: string, targetId: string) {
  revalidatePath("/documents");
  if (targetTable === "units") revalidatePath(`/units/${targetId}`);
  if (targetTable === "tickets") revalidatePath(`/maintenance/${targetId}`);
}

/**
 * Upload straight onto an entity's own page — the short path the hub was
 * missing. A receipt attached to the expense it justifies, or a photo
 * attached to the ticket it documents, in one action instead of upload-then-
 * hunt-for-it-in-the-hub-then-link.
 *
 * Deliberately its own action rather than a generalized version of
 * `uploadDocuments`: that one serves the hub's multi-file, pick-a-category
 * flow, this one serves "attach this one file to the thing I'm already
 * looking at" — same upload mechanics, different shape of caller.
 */
export async function uploadAndLinkDocument(_prev: unknown, formData: FormData) {
  const file = formData.get("file");
  const targetTable = String(formData.get("target_table") ?? "");
  const targetId = String(formData.get("target_id") ?? "");
  const relation = String(formData.get("relation") ?? "").trim() || "source";

  if (!LINKABLE_TABLES.includes(targetTable as LinkableTable)) {
    return { error: "Don't know how to attach a document to that." };
  }
  if (!targetId) return { error: "Missing what to attach this to." };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file first." };
  if (file.size > MAX_BYTES) return { error: "That file is larger than 25 MB." };

  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const verdict = verifyFile(file.type, bytes);
  if (!verdict.ok) return { error: `${file.name} ${verdict.reason}` };

  const digest = await checksum(bytes);
  const { data: existing } = await supabase
    .from("documents")
    .select("id")
    .eq("checksum", digest)
    .is("deleted_at", null)
    .limit(1);

  let documentId = existing?.[0]?.id as string | undefined;

  if (!documentId) {
    const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-120);
    const path = `${associationId}/${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(path, file, { contentType: verdict.mime });
    if (uploadError) return { error: uploadError.message };

    const { data: doc, error: rowError } = await supabase
      .from("documents")
      .insert({
        association_id: associationId,
        storage_path: path,
        filename: file.name,
        mime_type: verdict.mime,
        byte_size: file.size,
        checksum: digest,
      })
      .select("id")
      .single();

    if (rowError || !doc) {
      await supabase.storage.from("documents").remove([path]);
      return { error: rowError?.message ?? "Could not save the document record." };
    }
    documentId = doc.id;
  }

  const { error: linkError } = await supabase.from("document_links").insert({
    association_id: associationId,
    document_id: documentId,
    target_table: targetTable,
    target_id: targetId,
    relation,
  });
  // A duplicate link (same document, same target, same relation) is not an
  // error — the document is already attached, which is what was asked for.
  if (linkError && linkError.code !== "23505") return { error: linkError.message };

  if (!documentId) return { error: "Could not resolve the document to attach." };
  const attachedId = documentId;
  after(async () => {
    const bg = await createClient();
    try {
      await runExtraction(bg, attachedId);
    } catch {
      // recorded on the row; nothing else to do with it here
    }
    revalidatePath("/documents");
  });

  revalidateLinked(targetTable, targetId);
  return { ok: true as const };
}

/** Attach a document that's already in the hub, without re-uploading it. */
export async function linkExistingDocument(_prev: unknown, formData: FormData) {
  const documentId = String(formData.get("document_id") ?? "");
  const targetTable = String(formData.get("target_table") ?? "");
  const targetId = String(formData.get("target_id") ?? "");
  const relation = String(formData.get("relation") ?? "").trim() || "source";

  if (!documentId) return { error: "Choose a document." };
  if (!LINKABLE_TABLES.includes(targetTable as LinkableTable)) {
    return { error: "Don't know how to attach a document to that." };
  }
  if (!targetId) return { error: "Missing what to attach this to." };

  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };

  const { error } = await supabase.from("document_links").insert({
    association_id: associationId,
    document_id: documentId,
    target_table: targetTable,
    target_id: targetId,
    relation,
  });
  if (error && error.code !== "23505") return { error: error.message };

  revalidateLinked(targetTable, targetId);
  return { ok: true as const };
}

/**
 * Remove the link, not the document. The file might justify something else
 * too — unlinking one relationship shouldn't touch the document itself or its
 * other links.
 */
export async function unlinkDocument(
  linkId: string,
  targetTable: string,
  targetId: string,
): Promise<{ ok?: true; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("document_links")
    .delete()
    .eq("id", linkId)
    .select("id");

  if (error) return { error: error.message };
  if (!data?.length) return { error: "Only the board can detach a document." };

  revalidateLinked(targetTable, targetId);
  return { ok: true };
}
