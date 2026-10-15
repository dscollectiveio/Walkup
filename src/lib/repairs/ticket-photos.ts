import "server-only";
import { longDate } from "@/lib/dates";
import { signedImageUrls } from "@/lib/documents/access";
import { isHeicPhoto, photoAlt, photoCaption } from "@/components/upload/upload-copy";
import type { Supabase } from "./server";

/**
 * A ticket's photos for the ticket page (repairs-spec §6, foundation-spec
 * 6.7): rpc("ticket_photos") restates the documents rule, so it works for
 * owners too, then 10-minute signed URLs for the ones a browser can draw.
 * No proxy route, no Repairs policy on document_links.
 */

export interface TicketPhoto {
  documentId: string;
  linkId: string;
  filename: string;
  mimeType: string | null;
  uploadedAt: string;
  /** Signed for 10 minutes; null for a HEIC the browser can't draw (shown as a Download chip). */
  url: string | null;
  heic: boolean;
  caption: string;
  alt: string;
  canRemove: boolean;
}

interface Row {
  document_id: string;
  link_id: string;
  title: string | null;
  filename: string;
  mime_type: string | null;
  storage_path: string;
  uploaded_at: string;
  added_by_kind: "you" | "board" | "owner";
  added_by_name: string | null;
  can_remove: boolean;
}

export async function loadTicketPhotos(
  supabase: Supabase,
  ticketId: string,
  opts: { seesNames: boolean },
): Promise<TicketPhoto[]> {
  const { data, error } = await supabase.rpc("ticket_photos", { p_ticket_id: ticketId });
  if (error) {
    console.error("[repairs] ticket_photos", error.code ?? "-", error.message ?? "");
    return [];
  }
  const rows = (data ?? []) as Row[];
  const drawable = rows.filter((r) => !isHeicPhoto(r.mime_type));
  const urls = await signedImageUrls(supabase, drawable.map((r) => ({ document_id: r.document_id, storage_path: r.storage_path })));
  return rows.map((r, i) => {
    const dateText = longDate(r.uploaded_at);
    return {
      documentId: r.document_id,
      linkId: r.link_id,
      filename: r.filename,
      mimeType: r.mime_type,
      uploadedAt: r.uploaded_at,
      url: urls.get(r.document_id) ?? null,
      heic: isHeicPhoto(r.mime_type),
      caption: photoCaption({ addedByKind: r.added_by_kind, addedByName: r.added_by_name, viewerSeesNames: opts.seesNames, dateText }),
      alt: photoAlt({ index: i + 1, count: rows.length, title: r.title, dateText }),
      canRemove: r.can_remove === true,
    };
  });
}
