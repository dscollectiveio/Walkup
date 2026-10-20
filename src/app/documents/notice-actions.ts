"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentAssociationId } from "@/lib/documents/access";
import { isUuid } from "@/lib/documents/upload-paths";
import { NEW_FROM_OWNERS_COPY } from "@/lib/owner/unit-documents";

/** The board clears "New from owners": the ones listed, or all of them (0079). Board only, checked in the database. */
export async function markOwnerDocumentsSeen(noticeIds?: string[]): Promise<{ ok: true } | { error: string }> {
  if (noticeIds !== undefined && (!Array.isArray(noticeIds) || noticeIds.some((id) => typeof id !== "string" || !isUuid(id)))) {
    return { error: NEW_FROM_OWNERS_COPY.markSeenFailed };
  }
  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: NEW_FROM_OWNERS_COPY.markSeenFailed };
  const { error } = await supabase.rpc("mark_owner_document_notices_seen", {
    p_association_id: associationId,
    p_notice_ids: noticeIds && noticeIds.length > 0 ? noticeIds : null,
  });
  if (error) {
    console.error("markOwnerDocumentsSeen", error.code);
    return { error: NEW_FROM_OWNERS_COPY.markSeenFailed };
  }
  revalidatePath("/documents");
  return { ok: true };
}
