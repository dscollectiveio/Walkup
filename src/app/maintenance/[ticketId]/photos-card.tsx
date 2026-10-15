"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeTicketPhoto } from "@/app/documents/upload/actions";
import { DownloadButton } from "@/app/documents/document-row";
import { Card } from "@/components/ui";
import { UPLOAD_COPY } from "@/components/upload/upload-copy";
import { TicketPhotoPicker } from "@/components/repairs/ticket-photo-picker";
import { btnDanger, btnSecondary, errorClass } from "@/components/repairs/styles";
import type { PhotoView } from "./types";

/**
 * Photos (repairs-spec §5.3 card 5, §6): 10-minute signed URLs from
 * ticket_photos(), so each thumbnail opens full size until the page is
 * reloaded. A HEIC the browser can't draw is a file chip with Download.
 * Removing takes the photo off the problem; the document stays in the hub.
 */
export function PhotosCard(props: { ticketId: string; photos: PhotoView[]; canAdd: boolean; sharedTicket: boolean }) {
  return (
    <Card navy title="Photos">
      <div className="space-y-4">
        {props.photos.length === 0 ? (
          <p className="text-[13px] text-mute">No photos yet. Photos help a contractor quote without a visit.</p>
        ) : (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-3 lg:grid-cols-5">
            {props.photos.map((p) => (
              <Photo key={p.documentId} photo={p} ticketId={props.ticketId} />
            ))}
          </ul>
        )}
        {props.canAdd ? <TicketPhotoPicker mode="upload" ticketId={props.ticketId} sharedTicket={props.sharedTicket} label="Add photos" /> : null}
      </div>
    </Card>
  );
}

function Photo({ photo, ticketId }: { photo: PhotoView; ticketId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <li className="space-y-1">
      {photo.url ? (
        <a href={photo.url} target="_blank" rel="noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed Storage URL, not an optimisable asset */}
          <img src={photo.url} loading="lazy" alt={photo.alt} className="aspect-square w-full rounded-md border border-line object-cover" />
        </a>
      ) : (
        <div className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-md border border-line bg-fill p-2 text-center">
          <span className="rounded-full border border-line-strong px-2 py-0.5 text-[11px] text-mute">Photo</span>
          <span className="line-clamp-2 break-all text-[11px] text-mute">{photo.filename}</span>
          <DownloadButton id={photo.documentId}>Download</DownloadButton>
        </div>
      )}
      <p className="text-[11px] leading-snug text-mute">{photo.caption}</p>
      {photo.canRemove ? (
        confirming ? (
          <div className="space-y-1 rounded-md border border-line p-2">
            <p className="text-[12px] text-ink">Remove this photo from the problem? It stays in Documents.</p>
            <div className="flex flex-col gap-1">
              <button
                type="button"
                className={btnDanger}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await removeTicketPhoto({ ticketId, documentId: photo.documentId });
                    if ("error" in r) setError(r.error);
                    else router.refresh();
                  })
                }
              >
                {pending ? "Removing…" : UPLOAD_COPY.removeConfirmYes}
              </button>
              <button type="button" className={btnSecondary} onClick={() => setConfirming(false)}>
                {UPLOAD_COPY.removeConfirmNo}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="min-h-[44px] text-[12px] text-mute underline underline-offset-2 hover:text-ink">
            Remove
          </button>
        )
      ) : null}
      {error ? <p className={errorClass}>{error}</p> : null}
    </li>
  );
}
