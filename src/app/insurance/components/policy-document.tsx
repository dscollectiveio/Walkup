"use client";

import { useRef } from "react";
import { X } from "lucide-react";
import { DownloadButton } from "@/app/documents/document-row";
import type { PreviewKind } from "@/lib/documents/preview";
import { btnGhost } from "./styles";

/**
 * A policy's document with the two things you want from it: Preview opens it in a pop-out right on the page, and
 * Download saves the file. The pop-out shows PDFs, photos and text through the same same-origin preview route the
 * Documents page uses (read under your own login, so it shows only what you may see). A file type that can't be
 * shown has Download only.
 */
export function PolicyDocument({
  documentId,
  heading,
  filename,
  kind,
}: {
  documentId: string;
  /** What the pop-out is called, e.g. "Acme master policy". */
  heading: string;
  filename: string;
  kind: PreviewKind | null;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const src = `/documents/${documentId}/preview`;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {kind ? (
          <button type="button" className={btnGhost} onClick={() => dialogRef.current?.showModal()}>
            Preview
          </button>
        ) : null}
        <DownloadButton id={documentId} className={btnGhost}>
          Download
        </DownloadButton>
      </div>
      {kind ? (
        <dialog
          ref={dialogRef}
          aria-label={`${heading}, preview`}
          onClick={(e) => {
            // A click on the dimmed backdrop (the dialog element itself) closes it.
            if (e.target === dialogRef.current) dialogRef.current?.close();
          }}
          className="m-auto h-[90vh] w-[min(960px,94vw)] overflow-hidden rounded-xl border border-line bg-paper p-0 text-ink shadow-2xl backdrop:bg-black/50"
        >
          <div className="flex h-full flex-col">
            <header className="flex shrink-0 items-center justify-between gap-3 band bg-ink px-5 py-3">
              <h2 className="min-w-0 truncate text-[15px] font-semibold text-paper">{heading}</h2>
              <div className="flex shrink-0 items-center gap-3">
                <DownloadButton id={documentId} className="text-[12px] text-ondark-mute underline-offset-2 hover:text-paper hover:underline">
                  Download
                </DownloadButton>
                <button
                  type="button"
                  onClick={() => dialogRef.current?.close()}
                  aria-label="Close the preview"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-ondark-mute hover:bg-paper/10 hover:text-paper"
                >
                  <X size={16} strokeWidth={1.8} aria-hidden="true" />
                </button>
              </div>
            </header>
            <div className="min-h-0 flex-1 bg-fill p-2">
              {kind === "image" ? (
                <div className="h-full overflow-auto rounded-lg border border-line bg-paper p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- same-origin preview route, not a static asset */}
                  <img src={src} alt={`Preview of ${filename}`} className="mx-auto h-auto max-w-full" />
                </div>
              ) : (
                <iframe src={src} title={`Preview of ${filename}`} className="h-full w-full rounded-lg border border-line bg-paper" />
              )}
            </div>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
