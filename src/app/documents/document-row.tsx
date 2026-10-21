"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { binDocument, getDownloadUrl, removeOwnUpload, restoreDocument, retagDocument } from "./actions";
import { ACCOUNTANT_UPLOAD_COPY } from "@/lib/documents/accountant-uploads";
import { TagChip, UnfiledChip } from "./tag-chip";
import { ReadingBar } from "./[documentId]/reading-bar";
import { readableSize, SOURCE_LABEL } from "@/lib/documents/format";
import type { DocumentCategory, DocumentRow } from "@/lib/documents/access";

/** Fetches a fresh signed URL on click rather than embedding one in the page. */
export function DownloadButton({
  id,
  children,
  className,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await getDownloadUrl(id);
            if ("error" in result) return setError(result.error);
            window.open(result.url, "_blank");
          })
        }
        className={className ?? "text-[12px] text-mute underline-offset-2 hover:underline"}
      >
        {pending ? "Opening…" : children}
      </button>
      {error ? <span className="ml-2 text-[11px] text-bad-text">{error}</span> : null}
    </>
  );
}

/** The accountant's "Remove" on a document they added in the last 30 days (0081). Asks first. */
function RemoveOwnUpload({ id, onError }: { id: string; onError: (message: string | null) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, start] = useTransition();
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-[12px] text-bad-text underline-offset-2 hover:underline"
      >
        {ACCOUNTANT_UPLOAD_COPY.remove}
      </button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-[12px] text-mute">{ACCOUNTANT_UPLOAD_COPY.removeConfirm}</span>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          start(async () => {
            onError(null);
            const r = await removeOwnUpload(id);
            if (r.error) {
              onError(r.error);
              setConfirming(false);
            }
          })
        }
        className="rounded-md border border-bad-line bg-bad-tint px-2.5 py-1 text-[11px] font-medium text-bad-text hover:bg-bad-tint/80"
      >
        {busy ? "Removing…" : ACCOUNTANT_UPLOAD_COPY.removeConfirmYes}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-[12px] text-mute underline-offset-2 hover:underline"
      >
        {ACCOUNTANT_UPLOAD_COPY.removeConfirmNo}
      </button>
    </span>
  );
}

export function DocumentListRow({
  doc,
  categories,
  canWrite,
  canRemoveOwn = false,
}: {
  doc: DocumentRow;
  categories: DocumentCategory[];
  canWrite: boolean;
  /** The accountant added this one in the last 30 days and may remove it. */
  canRemoveOwn?: boolean;
}) {
  const [retagging, setRetagging] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(retagDocument, null);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.ok) setRetagging(false);
  }

  const category = categories.find((c) => c.id === doc.category_id);
  const binned = doc.deleted_at !== null;

  const meta = [
    readableSize(doc.byte_size),
    new Date(doc.uploaded_at).toLocaleDateString(),
    SOURCE_LABEL[doc.source],
    doc.version_number > 1 ? `version ${doc.version_number}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/documents/${doc.id}`}
              className="font-medium text-ink underline-offset-2 [overflow-wrap:anywhere] hover:underline"
            >
              {doc.title}
            </Link>
            {category ? (
              <TagChip
                label={category.label}
                slug={category.slug}
                provisional={doc.tag_source === "auto" && doc.review_state === "needs_review"}
                confidence={doc.tag_confidence}
              />
            ) : (
              <UnfiledChip />
            )}
            {doc.visibility === "all_owners" && !doc.restricted_to_unit_id ? (
              <span className="text-[11px] text-mute-soft">every owner can see this</span>
            ) : null}
          </div>
          <div className="mt-1 text-[12px] text-mute">{meta}</div>
          {doc.extraction_state === "pending" || doc.extraction_state === "running" ? (
            <div className="mt-2 max-w-sm">
              <ReadingBar label={doc.extraction_state === "running" ? "Reading this file" : "Waiting to read this file"} />
            </div>
          ) : null}
        </div>

        {canWrite ? (
          <div className="flex shrink-0 items-center gap-3">
            <DownloadButton id={doc.id}>Download</DownloadButton>
            {binned ? (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    const r = await restoreDocument(doc.id);
                    if (r.error) setError(r.error);
                  })
                }
                className="text-[12px] text-mute underline-offset-2 hover:underline"
              >
                {busy ? "Restoring…" : "Restore"}
              </button>
            ) : (
              <>
                {!retagging ? (
                  <button
                    type="button"
                    onClick={() => setRetagging(true)}
                    className="text-[12px] text-mute underline-offset-2 hover:underline"
                  >
                    Refile
                  </button>
                ) : null}
                {confirming ? (
                  <span className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        start(async () => {
                          setError(null);
                          const r = await binDocument(doc.id);
                          if (r.error) setError(r.error);
                          else setConfirming(false);
                        })
                      }
                      className="rounded-md border border-bad-line bg-bad-tint px-2.5 py-1 text-[11px] font-medium text-bad-text hover:bg-bad-tint/80"
                    >
                      {busy ? "Binning…" : "Confirm"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(false)}
                      className="text-[12px] text-mute underline-offset-2 hover:underline"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    className="text-[12px] text-bad-text underline-offset-2 hover:underline"
                  >
                    Bin
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-3">
            <DownloadButton id={doc.id}>Download</DownloadButton>
            {canRemoveOwn ? <RemoveOwnUpload id={doc.id} onError={setError} /> : null}
          </div>
        )}
      </div>

      {/* Refiling moves the document between views and does nothing else — not
          its folder, not its links, not who can see it. */}
      {retagging ? (
        <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
          <input type="hidden" name="document_id" value={doc.id} />
          <label htmlFor={`cat-${doc.id}`} className="text-[11px] text-mute">
            File as
          </label>
          <select
            id={`cat-${doc.id}`}
            name="category_id"
            defaultValue={doc.category_id ?? ""}
            className="rounded-lg border border-line-strong bg-paper px-2 py-1 text-[12px] text-ink"
          >
            <option value="">Unfiled</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-ink px-3 py-1 text-[12px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => setRetagging(false)}
            className="text-[12px] text-mute underline-offset-2 hover:underline"
          >
            Cancel
          </button>
          {state?.error ? (
            <p className="w-full text-[11px] text-bad-text">{state.error}</p>
          ) : null}
        </form>
      ) : null}

      {error ? <p className="mt-1 text-[11px] text-bad-text">{error}</p> : null}
    </li>
  );
}
