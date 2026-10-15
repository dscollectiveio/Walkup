"use client";

import { useState, useSyncExternalStore } from "react";
import { getDownloadUrl } from "@/app/documents/actions";
import { longDate } from "@/lib/insurance/format";

/**
 * Where a value came from (§9.3.4, §9.4): "From {file}, page 2" with the page
 * snippet always inline (so the value can be checked without opening the
 * PDF), and a link that opens the file at that page. iOS Safari ignores
 * `#page=`, so on touch devices the link says which page to look at.
 */

export type ProvenanceSource = "extracted" | "confirmed" | "manual" | "quote" | "previous_policy" | "agent_confirmed";

export interface ProvenanceInfo {
  source: ProvenanceSource;
  page?: number | null;
  snippet?: string | null;
  confirmedOn?: string | null;
  /** agent_confirmed: the attached answer, if any. */
  attachmentId?: string | null;
}

function coarsePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

function subscribeCoarse(onChange: () => void) {
  const m = window.matchMedia("(pointer: coarse)");
  m.addEventListener("change", onChange);
  return () => m.removeEventListener("change", onChange);
}

/** A button that mints a short-lived URL and opens the file (at a page when given). */
export function OpenFileButton({
  documentId,
  page,
  label,
  className = "text-ink underline underline-offset-2",
}: {
  documentId: string;
  page?: number | null;
  label?: string;
  className?: string;
}) {
  const coarse = useSyncExternalStore(subscribeCoarse, coarsePointer, () => false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const text = label ?? (page ? (coarse ? `Open the file (look at page ${page})` : `Open page ${page}`) : "Open the file");
  return (
    <>
      <button
        type="button"
        disabled={busy}
        className={`${className} min-h-[32px] disabled:opacity-60`}
        onClick={async () => {
          setError(null);
          // Opened before the await so pop-up blockers treat it as the click's window.
          const win = window.open("", "_blank");
          setBusy(true);
          try {
            const r = await getDownloadUrl(documentId);
            if ("error" in r) {
              win?.close();
              setError("Walkup couldn't open the file. Try again.");
              return;
            }
            const url = page ? `${r.url}#page=${page}` : r.url;
            if (win) {
              win.opener = null;
              win.location.href = url;
            } else window.location.href = url;
          } finally {
            setBusy(false);
          }
        }}
      >
        {text}
      </button>
      {error ? <span className="ml-2 text-bad-text">{error}</span> : null}
    </>
  );
}

/** The provenance line under a field (form) or a key-figure tile (detail page). */
export function Provenance({
  info,
  documentId,
  documentName,
  variant = "form",
}: {
  info: ProvenanceInfo | null;
  documentId: string | null;
  documentName?: string | null;
  variant?: "form" | "tile";
}) {
  if (!info) return null;
  const page = info.page ?? null;
  let line: React.ReactNode = null;
  switch (info.source) {
    case "extracted":
      line =
        variant === "tile"
          ? page ? `Page ${page} of your declarations` : "Read from your declarations"
          : `From ${documentName ?? "the file"}${page ? `, page ${page}` : ""}`;
      break;
    case "confirmed":
      line = page ? `You confirmed this from page ${page}` : "You confirmed this";
      break;
    case "manual":
      line = "Entered by you";
      break;
    case "quote":
      line = "From the quote";
      break;
    case "previous_policy":
      line = "From last term's policy";
      break;
    case "agent_confirmed":
      line = info.confirmedOn ? `Confirmed by your agent on ${longDate(info.confirmedOn)}` : "Confirmed by your agent";
      break;
  }
  const showPage = (info.source === "extracted" || info.source === "confirmed") && documentId;
  return (
    <div className="mt-1 space-y-0.5 text-[11px] text-mute">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span>{line}</span>
        {showPage ? <OpenFileButton documentId={documentId} page={page} /> : null}
        {info.source === "agent_confirmed" && info.attachmentId ? (
          <OpenFileButton documentId={info.attachmentId} label="See their answer" />
        ) : null}
      </div>
      {variant === "form" && info.snippet && page ? (
        <div className="text-mute-soft">
          Page {page}: &ldquo;{info.snippet}&rdquo;
        </div>
      ) : null}
    </div>
  );
}
