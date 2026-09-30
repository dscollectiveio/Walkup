"use client";

import { useState, useTransition } from "react";
import { setQuoteRequestStatus } from "./actions";
import { UploadDeclarations } from "./upload-declarations";

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Not sent yet", cls: "border-warning-line bg-warning-tint text-warning-text" },
  sent: { label: "Sent", cls: "border-info-line bg-info-tint text-info-text" },
  quote_received: { label: "Quote received", cls: "border-good-line bg-good-tint text-good-text" },
  declined: { label: "Declined", cls: "border-line bg-fill text-mute" },
  expired: { label: "Expired", cls: "border-line bg-fill text-mute" },
  accepted: { label: "Chosen", cls: "border-good-line bg-good-tint text-good-text" },
};

export function RequestRow({
  request,
  canEdit,
}: {
  request: { id: string; partnerName: string; status: string; sentAt: string | null; mailto: string; hasQuote: boolean };
  canEdit: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const s = STATUS[request.status] ?? STATUS.draft;
  const set = (status: "sent" | "quote_received" | "declined") =>
    start(async () => {
      setError(null);
      const r = await setQuoteRequestStatus(request.id, status);
      if (r.error) setError(r.error);
    });
  const btn = "min-h-[36px] rounded-md border border-line-strong bg-paper px-3 text-[12px] font-medium text-ink hover:bg-fill disabled:opacity-50";

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[13px]">
          <span className="font-medium text-ink">{request.partnerName}</span>
          <span className={`ml-2 rounded-full border px-2 py-0.5 text-[11px] ${s.cls}`}>{s.label}</span>
          {request.sentAt ? <span className="ml-2 text-[12px] text-mute">sent {request.sentAt.slice(0, 10)}</span> : null}
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            {request.status === "draft" ? (
              <>
                <a href={request.mailto} className={btn}>
                  <span className="inline-flex h-full items-center">Open in your email app</span>
                </a>
                <button type="button" disabled={pending} onClick={() => set("sent")} className={btn}>
                  Mark as sent
                </button>
              </>
            ) : null}
            {request.status === "sent" ? (
              <>
                <button type="button" disabled={pending} onClick={() => set("quote_received")} className={btn}>
                  Mark as quote received
                </button>
                <button type="button" disabled={pending} onClick={() => set("declined")} className={btn}>
                  Mark as declined
                </button>
              </>
            ) : null}
            {request.status === "quote_received" && !request.hasQuote ? (
              <button type="button" onClick={() => setUploading((u) => !u)} className={btn}>
                Upload the quote
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {error ? <p className="mt-1 text-[12px] text-bad-text">{error}</p> : null}
      {uploading ? (
        <div className="mt-3 max-w-md">
          <UploadDeclarations mode="quote" requestId={request.id} />
        </div>
      ) : null}
    </li>
  );
}
