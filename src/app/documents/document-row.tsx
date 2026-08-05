"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { binDocument, getDownloadUrl, restoreDocument, retagDocument } from "./actions";
import { TagChip, UnfiledChip } from "./tag-chip";
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

export function DocumentListRow({
  doc,
  categories,
  canWrite,
}: {
  doc: DocumentRow;
  categories: DocumentCategory[];
  canWrite: boolean;
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
              className="font-medium text-ink underline-offset-2 hover:underline"
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
          <DownloadButton id={doc.id}>Download</DownloadButton>
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
