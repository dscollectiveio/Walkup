"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { unlinkDocument } from "./link-actions";
import { DownloadButton } from "./document-row";
import { DirectUpload } from "@/components/upload/direct-upload";
import { isLinkableTable } from "./upload/link-targets";
import { readableSize } from "@/lib/documents/format";
import type { LinkedDocument } from "@/lib/documents/access";

/**
 * The "Documents" section every entity page gets — a receipt attached to the
 * expense it justifies, a photo attached to the ticket it documents, in the
 * same short upload-and-attach path the hub itself uses.
 *
 * The file goes straight to Storage (DirectUpload), so a large scan isn't
 * stopped by the Server Action body limit.
 *
 * Read-only when `canWrite` is false: an owner reading a unit page sees what's
 * attached (subject to the document's own visibility, decided in the hub —
 * this component doesn't re-decide it) with no upload control.
 */
export function EntityDocuments({
  targetTable,
  targetId,
  documents,
  canWrite,
}: {
  targetTable: string;
  targetId: string;
  documents: LinkedDocument[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-3">
      {documents.length === 0 ? (
        <p className="text-[13px] text-mute">Nothing attached yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {documents.map((d) => (
            <EntityDocumentRow
              key={d.linkId}
              doc={d}
              targetTable={targetTable}
              targetId={targetId}
              canWrite={canWrite}
            />
          ))}
        </ul>
      )}

      {canWrite ? (
        !open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md border border-line-strong px-3 py-1.5 text-[12px] text-ink hover:bg-fill"
          >
            Attach a document
          </button>
        ) : (
          <div className="space-y-2 rounded-lg border border-line bg-fill p-3">
            {isLinkableTable(targetTable) ? (
              <DirectUpload
                purpose="document"
                link={{ targetTable, targetId, relation: "source" }}
                multiple={false}
                maxFiles={1}
                dropZone={false}
                label="Choose a file"
                help={null}
                onBusyChange={setBusy}
                onUploaded={(docs) => {
                  // Keep the panel open when the link failed, so its row's
                  // "attach it from the Document Hub" stays readable.
                  if (docs.some((d) => !d.linkFailed)) setOpen(false);
                  router.refresh();
                }}
              />
            ) : (
              <p className="text-[11px] text-bad-text">Don&rsquo;t know how to attach a document to that.</p>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="text-[12px] text-mute underline-offset-2 hover:underline disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        )
      ) : null}
    </div>
  );
}

function EntityDocumentRow({
  doc,
  targetTable,
  targetId,
  canWrite,
}: {
  doc: LinkedDocument;
  targetTable: string;
  targetId: string;
  canWrite: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <span className="text-[13px] font-medium text-ink">{doc.title}</span>
        <span className="ml-2 text-[11px] text-mute">
          {readableSize(doc.byte_size)} · {new Date(doc.uploaded_at).toLocaleDateString()}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <DownloadButton id={doc.id}>Download</DownloadButton>
        {canWrite ? (
          confirming ? (
            <span className="flex items-center gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    const r = await unlinkDocument(doc.linkId, targetTable, targetId);
                    if (r.error) setError(r.error);
                  })
                }
                className="rounded-md border border-bad-line bg-bad-tint px-2 py-1 text-[11px] font-medium text-bad-text hover:bg-bad-tint/80"
              >
                {pending ? "Removing…" : "Confirm"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="text-[11px] text-mute underline-offset-2 hover:underline"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="text-[12px] text-mute underline-offset-2 hover:underline"
            >
              Detach
            </button>
          )
        ) : null}
      </div>
      {error ? <p className="w-full text-[11px] text-bad-text">{error}</p> : null}
    </li>
  );
}
