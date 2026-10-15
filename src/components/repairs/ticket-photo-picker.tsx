"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DirectUpload } from "@/components/upload/direct-upload";
import { tooManyFiles, UPLOAD_COPY } from "@/components/upload/upload-copy";
import { MAX_PHOTOS_PER_BATCH } from "@/lib/documents/upload-paths";
import { preparePhoto } from "@/lib/repairs/photos";
import { errorClass } from "./styles";

/**
 * Photos for a problem (repairs-spec §5.2, §6).
 *
 * "hold" (the report form): the photos are picked, checked and shrunk on the
 * phone, and kept until the problem exists; the form uploads them after
 * createTicket. "upload" (the ticket page): the foundation's DirectUpload
 * with preparePhoto as its per-file `prepare` step (foundation §17), which
 * also sets the leave-page prompt while files are in flight.
 *
 * The native file input (no `capture`) lets phones offer the camera or the
 * library. Accept is JPEG and PNG, as the foundation's photo default: asked
 * for JPEG, iOS converts HEIC itself, and preparePhoto converts any HEIC
 * that still arrives.
 */

const PHOTO_ACCEPT = "image/jpeg,image/png";

export interface HeldPhoto {
  key: string;
  /** Already prepared (shrunk JPEG, or the original when the browser can't decode it). */
  file: File;
  /** An object URL for the thumbnail, or null for a HEIC the browser can't draw. */
  preview: string | null;
}

export function TicketPhotoPicker(
  props:
    | { mode: "hold"; photos: HeldPhoto[]; onChange: (photos: HeldPhoto[]) => void; disabled?: boolean }
    | { mode: "upload"; ticketId: string; sharedTicket: boolean; label?: string },
) {
  if (props.mode === "upload") return <UploadPicker ticketId={props.ticketId} sharedTicket={props.sharedTicket} label={props.label} />;
  return <HoldPicker photos={props.photos} onChange={props.onChange} disabled={props.disabled} />;
}

function UploadPicker({ ticketId, sharedTicket, label }: { ticketId: string; sharedTicket: boolean; label?: string }) {
  const router = useRouter();
  return (
    <DirectUpload
      purpose="ticket_photo"
      ticketId={ticketId}
      sharedTicket={sharedTicket}
      accept={PHOTO_ACCEPT}
      multiple
      label={label ?? "Add photos"}
      normaliseImages={false}
      prepare={async (file) => {
        const r = await preparePhoto(file);
        return "error" in r ? r : r.file;
      }}
      onUploaded={() => router.refresh()}
    />
  );
}

function HoldPicker({ photos, onChange, disabled }: { photos: HeldPhoto[]; onChange: (p: HeldPhoto[]) => void; disabled?: boolean }) {
  const inputId = useId();
  const helpId = useId();
  const [errors, setErrors] = useState<string[]>([]);
  const [preparing, setPreparing] = useState(false);
  const latest = useRef(photos);
  useEffect(() => {
    latest.current = photos;
  }, [photos]);

  // Thumbnails are object URLs; give them back when the form goes away.
  useEffect(
    () => () => {
      for (const p of latest.current) if (p.preview) URL.revokeObjectURL(p.preview);
    },
    [],
  );

  async function pick(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    const room = MAX_PHOTOS_PER_BATCH - photos.length;
    const problems: string[] = [];
    if (files.length > room) problems.push(tooManyFiles(MAX_PHOTOS_PER_BATCH));
    setPreparing(true);
    const added: HeldPhoto[] = [];
    for (const f of files.slice(0, Math.max(0, room))) {
      const r = await preparePhoto(f);
      if ("error" in r) {
        problems.push(r.error);
        continue;
      }
      const drawable = r.mime !== "image/heic";
      added.push({
        key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${f.name}`,
        file: r.file,
        preview: drawable ? URL.createObjectURL(r.file) : null,
      });
    }
    setPreparing(false);
    setErrors(problems);
    if (added.length) onChange([...latest.current, ...added]);
  }

  function remove(key: string) {
    const p = photos.find((x) => x.key === key);
    if (p?.preview) URL.revokeObjectURL(p.preview);
    onChange(photos.filter((x) => x.key !== key));
  }

  const full = photos.length >= MAX_PHOTOS_PER_BATCH;

  return (
    <div className="space-y-3">
      <label
        htmlFor={inputId}
        aria-disabled={disabled || full || preparing}
        className={`flex min-h-[44px] w-full cursor-pointer items-center justify-center rounded-md border border-dashed border-line-strong bg-paper px-4 text-[14px] font-medium text-ink hover:bg-fill sm:w-auto ${
          disabled || full || preparing ? "pointer-events-none opacity-60" : ""
        }`}
      >
        {preparing ? "Preparing photos…" : photos.length ? "Add more photos" : "Add photos"}
        <input
          id={inputId}
          type="file"
          accept={PHOTO_ACCEPT}
          multiple
          disabled={disabled || full || preparing}
          aria-describedby={helpId}
          className="sr-only"
          onChange={(e) => {
            void pick(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      <p id={helpId} className="text-[12px] text-mute">
        {UPLOAD_COPY.photoHelp}
      </p>

      {photos.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {photos.map((p, i) => (
            <li key={p.key} className="space-y-1">
              {p.preview ? (
                // eslint-disable-next-line @next/next/no-img-element -- a local object URL, not an optimisable remote image
                <img src={p.preview} alt={`Photo ${i + 1} to add`} className="aspect-square w-full rounded-md border border-line object-cover" />
              ) : (
                <div className="flex aspect-square w-full flex-col items-center justify-center rounded-md border border-line bg-fill p-2 text-center">
                  <span className="rounded-full border border-line-strong px-2 py-0.5 text-[11px] text-mute">Photo</span>
                  <span className="mt-1 line-clamp-2 break-all text-[11px] text-mute">{p.file.name}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => remove(p.key)}
                disabled={disabled}
                className="min-h-[44px] w-full text-[12px] text-mute underline underline-offset-2 hover:text-ink"
              >
                Remove
                <span className="sr-only"> photo {i + 1}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {errors.length > 0 ? (
        <ul className="space-y-1" aria-live="polite">
          {errors.map((e) => (
            <li key={e} className={errorClass}>
              {e}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
