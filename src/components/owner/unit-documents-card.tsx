"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Card } from "@/components/ui";
import { DirectUpload } from "@/components/upload/direct-upload";
import { btnDanger, btnSecondary, inputClass, labelClass } from "@/components/repairs/styles";
import { removeUnitDocument } from "@/app/owner/unit-document-actions";
import {
  UNIT_DOCUMENT_COPY,
  UNIT_DOCUMENT_KINDS,
  addedByLine,
  type UnitDocumentKind,
} from "@/lib/owner/unit-documents";
import type { UnitDocumentRow } from "@/lib/owner/unit-documents-load";

/**
 * "Your unit documents" on the owner's home: the papers the owner (or the board) added for their unit, and
 * an upload for more. The files go straight to Storage (DirectUpload, purpose unit_document).
 */
export function UnitDocumentsCard({
  units,
  docs,
}: {
  units: { id: string; label: string }[];
  /** null: the list could not be loaded. */
  docs: UnitDocumentRow[] | null;
}) {
  const router = useRouter();
  const [unitId, setUnitId] = useState(units[0]?.id ?? "");
  const [kind, setKind] = useState<UnitDocumentKind>("ho6_certificate");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const shown = (docs ?? []).filter((d) => d.unitId === unitId);

  function remove(documentId: string) {
    setError(null);
    startTransition(async () => {
      const result = await removeUnitDocument(documentId);
      if ("error" in result) setError(result.error);
      setConfirming(null);
      router.refresh();
    });
  }

  return (
    <Card navy title={UNIT_DOCUMENT_COPY.title}>
      <p className="text-[13px] leading-relaxed text-mute">{UNIT_DOCUMENT_COPY.intro}</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {units.length > 1 ? (
          <div>
            <label htmlFor="unit-doc-unit" className={labelClass}>
              {UNIT_DOCUMENT_COPY.unitLabel}
            </label>
            <select id="unit-doc-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)} className={inputClass}>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div>
          <label htmlFor="unit-doc-kind" className={labelClass}>
            {UNIT_DOCUMENT_COPY.kindLabel}
          </label>
          <select
            id="unit-doc-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as UnitDocumentKind)}
            className={inputClass}
          >
            {UNIT_DOCUMENT_KINDS.map((k) => (
              <option key={k.slug} value={k.slug}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-3">
        <DirectUpload
          key={`${unitId}:${kind}`}
          purpose="unit_document"
          unitId={unitId}
          unitKind={kind}
          label="Add a document"
          help={UNIT_DOCUMENT_COPY.help}
          onUploaded={() => router.refresh()}
        />
      </div>

      <div className="mt-4 border-t border-line pt-3">
        {docs === null ? (
          <p className="text-[13px] text-mute">We couldn&rsquo;t load your unit documents. Reload the page.</p>
        ) : shown.length === 0 ? (
          <p className="text-[13px] text-mute">{UNIT_DOCUMENT_COPY.empty}</p>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((d) => (
              <li key={d.documentId} className="py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <Link
                    href={`/documents/${d.documentId}`}
                    className="min-w-0 break-words text-[14px] text-ink underline-offset-2 hover:underline"
                  >
                    {d.title}
                  </Link>
                  {d.kind ? (
                    <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] text-mute">{d.kind}</span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-[12px] text-mute">{addedByLine(d.addedByKind, d.dateText, d.addedByName)}</p>
                {d.canRemove ? (
                  confirming === d.documentId ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="Confirm removal">
                      <span className="text-[13px] text-ink">{UNIT_DOCUMENT_COPY.removeConfirm}</span>
                      <button type="button" disabled={pending} onClick={() => remove(d.documentId)} className={btnDanger}>
                        {UNIT_DOCUMENT_COPY.removeConfirmYes}
                      </button>
                      <button type="button" disabled={pending} onClick={() => setConfirming(null)} className={btnSecondary}>
                        {UNIT_DOCUMENT_COPY.removeConfirmNo}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setConfirming(d.documentId);
                      }}
                      className="mt-1 inline-flex min-h-[44px] items-center text-[13px] font-medium text-ink underline underline-offset-2"
                    >
                      {UNIT_DOCUMENT_COPY.remove}
                    </button>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {error ? (
          <p role="alert" className="mt-2 text-[13px] text-bad-text">
            {error}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
