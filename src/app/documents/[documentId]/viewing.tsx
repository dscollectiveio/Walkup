"use client";

import { useActionState } from "react";
import { renameDocument, retagDocument } from "../actions";
import type { DocumentCategory } from "@/lib/documents/access";
import type { PreviewKind } from "@/lib/documents/preview";

const field = "w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink";
const save = "rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50";

/**
 * The Viewing section's body: rename, refile and the summary as bullets on the
 * left, the document itself in a scrolling frame on the right. Rename and
 * refile are the board's; everyone who can open the document sees the preview.
 */
export function Viewing({
  documentId,
  title,
  categoryId,
  categories,
  canWrite,
  kind,
  bullets,
  filename,
}: {
  documentId: string;
  title: string;
  categoryId: string | null;
  categories: DocumentCategory[];
  canWrite: boolean;
  kind: PreviewKind | null;
  bullets: string[];
  filename: string;
}) {
  const [renameState, rename, renaming] = useActionState(renameDocument, null);
  const [retagState, retag, retagging] = useActionState(retagDocument, null);
  const src = `/documents/${documentId}/preview`;

  return (
    <div className="grid gap-5 lg:grid-cols-[2fr_3fr]">
      <div className="space-y-5">
        {canWrite ? (
          <>
            <form action={rename} className="space-y-1.5">
              <input type="hidden" name="document_id" value={documentId} />
              <label htmlFor="view-title" className="block text-[12px] font-medium text-ink">
                Name
              </label>
              <div className="flex gap-2">
                <input id="view-title" name="title" defaultValue={title} className={field} />
                <button type="submit" disabled={renaming} className={save}>
                  {renaming ? "Saving…" : "Save"}
                </button>
              </div>
              <p className="text-[11px] text-mute-soft">Leave it blank to go back to the original filename.</p>
              {renameState && "error" in renameState && renameState.error ? (
                <p className="text-[11px] text-bad-text">{renameState.error}</p>
              ) : renameState && "ok" in renameState ? (
                <p className="text-[11px] text-good-text">Saved.</p>
              ) : null}
            </form>

            <form action={retag} className="space-y-1.5">
              <input type="hidden" name="document_id" value={documentId} />
              <label htmlFor="view-category" className="block text-[12px] font-medium text-ink">
                Category
              </label>
              <div className="flex gap-2">
                <select id="view-category" name="category_id" defaultValue={categoryId ?? ""} className={field}>
                  <option value="">Not filed</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <button type="submit" disabled={retagging} className={save}>
                  {retagging ? "Saving…" : "Save"}
                </button>
              </div>
              <p className="text-[11px] text-mute-soft">Refiling changes where it shows up, not who can see it.</p>
              {retagState && "error" in retagState && retagState.error ? (
                <p className="text-[11px] text-bad-text">{retagState.error}</p>
              ) : retagState && "ok" in retagState ? (
                <p className="text-[11px] text-good-text">Saved.</p>
              ) : null}
            </form>
          </>
        ) : null}

        {bullets.length > 0 ? (
          <div className="border-l-[3px] border-info bg-info-tint px-4 py-3">
            <p className="text-[11px] font-medium text-info-text">Summary written by Walkup, not by a person</p>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-info-text">
              {bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-[12px] text-mute">No summary yet.</p>
        )}
      </div>

      <div className="min-w-0">
        {kind === "pdf" ? (
          <iframe src={src} title={`Preview of ${filename}`} className="h-[75vh] w-full rounded-lg border border-line bg-fill" />
        ) : kind === "image" ? (
          <div className="max-h-[75vh] overflow-auto rounded-lg border border-line bg-fill p-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- same-origin preview route, not a static asset */}
            <img src={src} alt={`Preview of ${filename}`} className="mx-auto h-auto max-w-full" />
          </div>
        ) : kind === "text" ? (
          <iframe src={src} title={`Preview of ${filename}`} className="h-[75vh] w-full rounded-lg border border-line bg-paper" />
        ) : (
          <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-line-strong bg-fill px-4 text-center text-[13px] text-mute">
            This kind of file can&rsquo;t be shown here. Use Download to open it.
          </div>
        )}
      </div>
    </div>
  );
}
