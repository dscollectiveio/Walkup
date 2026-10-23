"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/owner/viewer";
import { canShareWithOwners } from "@/lib/owner/shareable-documents";
import { announcementInput, mapSaveError, type AnnouncementInput } from "@/lib/owner/announcements";
import { isUuid } from "@/lib/repairs/server";

type Fail = { error: string };
type FieldErrors = Partial<Record<keyof AnnouncementInput, string>>;

function revalidateAll(id?: string) {
  revalidatePath("/announcements");
  revalidatePath("/owner");
  if (id) revalidatePath(`/announcements/${id}`);
}

/** Save a draft or post (RPC `save_announcement`). The database re-checks everything the form checks. */
export async function saveAnnouncement(
  input: AnnouncementInput,
): Promise<{ ok: true; id: string } | (Fail & { fieldErrors?: FieldErrors })> {
  const viewer = await getViewer();
  if (!viewer) return { error: "Please sign in again." };
  if (!viewer.isBoard) return { error: "Only the board can post announcements." };

  const parsed = announcementInput.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: FieldErrors = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof AnnouncementInput | undefined;
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { error: parsed.error.issues[0]?.message ?? "Check the form.", fieldErrors };
  }
  const v = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_announcement", {
    p_association_id: viewer.associationId,
    p_id: v.id,
    p_title: v.title,
    p_body: v.body,
    p_audience: v.audience,
    p_unit_ids: v.audience === "units" ? v.unitIds : [],
    p_pinned: v.pinned,
    p_attachment_document_id: v.attachmentDocumentId,
    p_expires_on: v.expiresOn,
    p_publish: v.publish,
    p_importance: v.importance,
  });
  if (error) return { error: mapSaveError(error.code, error.hint, error.message) };
  const id = data as string;
  revalidateAll(id);
  return { ok: true, id };
}

async function boardRpc(
  fn: "set_announcement_status" | "set_announcement_pinned" | "delete_announcement_draft",
  args: Record<string, unknown>,
  id: string,
  fallback: string,
): Promise<{ ok: true } | Fail> {
  const viewer = await getViewer();
  if (!viewer) return { error: "Please sign in again." };
  if (!isUuid(id)) return { error: fallback };
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) {
    const mapped = mapSaveError(error.code, error.hint, error.message);
    return { error: mapped === "Couldn't save that. Try again." ? fallback : mapped };
  }
  revalidateAll(id);
  return { ok: true };
}

export async function setAnnouncementStatus(id: string, status: "archived" | "published") {
  if (status !== "archived" && status !== "published") return { error: "Couldn't change that. Try again." } as Fail;
  return boardRpc("set_announcement_status", { p_announcement_id: id, p_status: status }, id, "Couldn't change that. Try again.");
}

export async function setAnnouncementPinned(id: string, pinned: boolean) {
  return boardRpc("set_announcement_pinned", { p_announcement_id: id, p_pinned: pinned === true }, id, "Couldn't change that. Try again.");
}

export async function deleteAnnouncementDraft(id: string) {
  return boardRpc("delete_announcement_draft", { p_announcement_id: id }, id, "Couldn't delete that draft. Try again.");
}

/** Always ok: a read receipt is not worth an error on the page. */
export async function markAnnouncementRead(id: string): Promise<{ ok: true }> {
  try {
    if (isUuid(id)) {
      const supabase = await createClient();
      await supabase.rpc("mark_announcement_read", { p_announcement_id: id });
      revalidatePath("/owner");
    }
  } catch {
    // Swallowed on purpose.
  }
  return { ok: true };
}

/**
 * Board only: make a file readable by every owner so it can be attached.
 * Allows only the governing, minutes and financial-statement categories, and
 * never a file that belongs to one unit (REVIEW-2 #17).
 */
export async function shareDocumentWithOwners(documentId: string): Promise<{ ok: true } | Fail> {
  const viewer = await getViewer();
  if (!viewer) return { error: "Please sign in again." };
  if (!viewer.isBoard || !isUuid(documentId)) return { error: "You can't change that file." };

  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("id, restricted_to_unit_id, document_categories(slug)")
    .eq("id", documentId)
    .eq("association_id", viewer.associationId)
    .is("deleted_at", null)
    .limit(1);
  const row = doc?.[0] as unknown as
    | { id: string; restricted_to_unit_id: string | null; document_categories: { slug: string } | { slug: string }[] | null }
    | undefined;
  if (!row) return { error: "You can't change that file." };
  const cat = Array.isArray(row.document_categories) ? row.document_categories[0] : row.document_categories;
  if (!canShareWithOwners(cat?.slug, row.restricted_to_unit_id)) {
    return { error: "Only governing documents, meeting minutes, financial statements and files added here can be shared from here. Pick another file." };
  }

  const { data, error } = await supabase
    .from("documents")
    .update({ visibility: "all_owners", restricted_to_unit_id: null })
    .eq("id", documentId)
    .eq("association_id", viewer.associationId)
    .select("id");
  if (error || !data || data.length === 0) return { error: "You can't change that file." };
  revalidatePath("/documents");
  return { ok: true };
}
