"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import { DirectUpload } from "@/components/upload/direct-upload";
import { btnDanger, btnSecondary, inputClass, labelClass } from "@/components/repairs/styles";
import { removeUnitDocument } from "@/app/owner/unit-document-actions";
import { listUnitDocuments } from "./unit-documents-actions";
import {
  BOARD_UNIT_DOCUMENT_COPY as COPY,
  UNIT_DOCUMENT_COPY,
  UNIT_DOCUMENT_KINDS,
  addedByLine,
  type UnitDocumentKind,
} from "@/lib/owner/unit-documents";
import type { UnitDocumentRow } from "@/lib/owner/unit-documents-load";

/**
 * Adding documents for a unit, as the board (migration 0079: the database already accepts any unit for the
 * board). Two uses of one control:
 *   - on a unit's card (`unitId` fixed): the kind picker, an upload and that unit's documents, with Remove;
 *   - above the unit list (`units` and no `unitId`): a unit picker, the kind picker and an upload.
 * Files go straight to Storage (DirectUpload, purpose unit_document), like the owner's card.
 */
export function UnitDocumentsPanel({
  units,
  unitId: fixedUnitId,
  showList = false,
}: {
  units: { id: string; label: string }[];
  /** Fixed unit (the unit card). Omit for a unit picker. */
  unitId?: string;
  /** Load and list the unit's documents (needs a fixed unit). */
  showList?: boolean;
}) {
  const [pickedUnit, setPickedUnit] = useState(units[0]?.id ?? "");
  const unitId = fixedUnitId ?? pickedUnit;
  const [kind, setKind] = useState<UnitDocumentKind>("ho6_certificate");
  const [docs, setDocs] = useState<UnitDocumentRow[] | null | "loading">(showList ? "loading" : null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [added, setAdded] = useState(false);

  const load = useCallback(async () => {
    const result = await listUnitDocuments(unitId);
    setDocs("error" in result ? null : result.rows);
  }, [unitId]);

  useEffect(() => {
    if (!showList || !unitId) return;
    let live = true;
    void listUnitDocuments(unitId).then((result) => {
      if (live) setDocs("error" in result ? null : result.rows);
    });
    return () => {
      live = false;
    };
  }, [showList, unitId]);

  function remove(documentId: string) {
    setError(null);
    startTransition(async () => {
      const result = await removeUnitDocument(documentId);
      if ("error" in result) setError(result.error);
      setConfirming(null);
      await load();
    });
  }

  const idPrefix = `unit-doc-${fixedUnitId ?? "any"}`;
  const unitLabel = units.find((u) => u.id === unitId)?.label ?? "";

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {fixedUnitId === undefined && units.length > 0 ? (
          <div>
            <label htmlFor={`${idPrefix}-unit`} className={labelClass}>
              {COPY.unitLabel}
            </label>
            <select
              id={`${idPrefix}-unit`}
              value={unitId}
              onChange={(e) => {
                setPickedUnit(e.target.value);
                setAdded(false);
              }}
              className={inputClass}
            >
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div>
          <label htmlFor={`${idPrefix}-kind`} className={labelClass}>
            {COPY.kindLabel}
          </label>
          <select
            id={`${idPrefix}-kind`}
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

      <DirectUpload
        key={`${unitId}:${kind}`}
        purpose="unit_document"
        unitId={unitId}
        unitKind={kind}
        label={COPY.button}
        help={`${UNIT_DOCUMENT_COPY.help} ${COPY.hint}`}
        disabled={!unitId}
        onUploaded={(done) => {
          if (done.length > 0) setAdded(true);
          if (showList) void load();
        }}
      />
      {added && !showList && unitLabel ? (
        <p role="status" className="text-[12px] text-mute">
          Added for {unitLabel}. Open that unit to see it.
        </p>
      ) : null}

      {showList ? (
        <div className="border-t border-line pt-3">
          {docs === "loading" ? (
            <p className="text-[13px] text-mute">{COPY.loading}</p>
          ) : docs === null ? (
            <p className="text-[13px] text-mute">
              {COPY.loadFailed}{" "}
              <button type="button" onClick={() => void load()} className="underline underline-offset-2">
                {COPY.tryAgain}
              </button>
            </p>
          ) : docs.length === 0 ? (
            <p className="text-[13px] text-mute">{COPY.empty}</p>
          ) : (
            <ul className="divide-y divide-line">
              {docs.map((d) => (
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
      ) : null}
    </div>
  );
}
