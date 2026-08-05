"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { confirmDocumentTag, retagDocument } from "./actions";
import { TagChip, UnfiledChip } from "./tag-chip";
import { readableSize } from "@/lib/documents/format";
import type { DocumentCategory, DocumentRow } from "@/lib/documents/access";

/**
 * One waiting document, with everything needed to settle it in a single pass:
 * what was guessed, how sure it was, what was read out of the file, and the
 * two possible answers — yes, or no and here's the right one.
 *
 * Confirming is one click. Correcting is one dropdown. Neither requires
 * opening the document, because the point of a review queue is to clear it.
 */

const FIELD_LABELS: Record<string, string> = {
  documentDate: "Dated",
  effectiveDate: "Starts",
  expirationDate: "Ends",
  amount: "Amount",
  counterpartyName: "Other party",
  accountOrPolicyNumber: "Reference",
  taxYear: "Tax year",
  unitReference: "Unit",
};

function extractedFields(extraction: Record<string, unknown> | null) {
  if (!extraction) return [];
  return Object.entries(FIELD_LABELS)
    .map(([key, label]) => [label, extraction[key]] as const)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([label, value]) => `${label}: ${String(value)}`);
}

export function ReviewRow({
  doc,
  categories,
}: {
  doc: DocumentRow;
  categories: DocumentCategory[];
}) {
  const [correcting, setCorrecting] = useState(false);
  const [state, action, pending] = useActionState(retagDocument, null);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [prev, setPrev] = useState(state);
  if (state !== prev) {
    setPrev(state);
    if (state?.ok) setCorrecting(false);
  }

  const category = categories.find((c) => c.id === doc.category_id);
  const summary =
    doc.extraction && typeof doc.extraction === "object"
      ? ((doc.extraction as { summary?: string }).summary ?? null)
      : null;
  const fields = extractedFields(doc.extraction);

  return (
    <li className="py-4">
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
                provisional
                confidence={doc.tag_confidence}
              />
            ) : (
              <UnfiledChip />
            )}
          </div>
          <div className="mt-1 text-[12px] text-mute">
            {[readableSize(doc.byte_size), new Date(doc.uploaded_at).toLocaleDateString()]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>

        {!correcting ? (
          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const r = await confirmDocumentTag(doc.id);
                  if (r.error) setError(r.error);
                })
              }
              className="rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
            >
              {busy ? "Confirming…" : "That's right"}
            </button>
            <button
              type="button"
              onClick={() => setCorrecting(true)}
              className="text-[12px] text-mute underline-offset-2 hover:underline"
            >
              File it differently
            </button>
          </div>
        ) : null}
      </div>

      {/* What was read out of the file, so the decision doesn't need the file. */}
      {summary ? (
        <p className="mt-2 max-w-[70ch] text-[13px] leading-relaxed text-mute">{summary}</p>
      ) : null}
      {fields.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-mute-soft">
          {fields.map((f) => (
            <span key={f}>{f}</span>
          ))}
        </div>
      ) : null}

      {correcting ? (
        <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
          <input type="hidden" name="document_id" value={doc.id} />
          <label htmlFor={`review-cat-${doc.id}`} className="text-[11px] text-mute">
            File as
          </label>
          <select
            id={`review-cat-${doc.id}`}
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
            onClick={() => setCorrecting(false)}
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
