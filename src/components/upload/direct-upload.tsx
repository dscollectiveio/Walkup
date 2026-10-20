"use client";

import Link from "next/link";
import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { btnPrimary } from "@/components/repairs/styles";
import { readableSize } from "@/lib/documents/format";
import { MAX_DOCUMENTS_PER_BATCH, MAX_PHOTOS_PER_BATCH } from "@/lib/documents/upload-paths";
import type { LinkableTable } from "@/app/documents/upload/link-targets";
import { uploadFile, type UploadOutcome, type UploadStage } from "./upload-file";
import {
  SLOW_UPLOAD_SECONDS,
  UPLOAD_COPY,
  defaultHelp,
  rowActive,
  rowText,
  tooManyFiles,
  type RowState,
} from "./upload-copy";

/**
 * Pick or drop files; each goes straight from the browser to Storage and is
 * then registered (foundation-spec 6.5). One file at a time, so a phone on
 * cellular isn't splitting its bandwidth and each document gets its own
 * background read. Starts on selection: there is no submit button.
 */
export interface DirectUploadProps {
  purpose: "document" | "ticket_photo" | "unit_document";
  categorySlug?: string;
  /** Shown per row: "Filing as Insurance". */
  categoryLabel?: string;
  /** Required for ticket_photo. */
  ticketId?: string;
  /** Required for unit_document: the unit the files are for. */
  unitId?: string;
  /** Required for unit_document: one of UNIT_DOCUMENT_KINDS. */
  unitKind?: string;
  /** ticket_photo on a shared-area problem: shows the audience note. */
  sharedTicket?: boolean;
  link?: { targetTable: LinkableTable; targetId: string; relation?: string };
  read?: boolean;
  /** Default true for ticket_photo, false for document. HEIC is converted where possible either way. */
  normaliseImages?: boolean;
  /** Several photos are pages of one document (Insurance scans): shows the group note. */
  groupAsOne?: boolean;
  accept?: string;
  multiple?: boolean;
  /** Default 10 documents / 6 photos. Checked after prepareFiles. */
  maxFiles?: number;
  label?: string;
  /** Default per purpose (6.9); null hides it. */
  help?: string | null;
  /** Default true for documents, false for photos. Only shown on devices with a fine pointer. */
  dropZone?: boolean;
  /** A larger drop area with its text, button and help centered (the Documents page). */
  centered?: boolean;
  disabled?: boolean;
  /** Runs once on the picked or dropped list, before the count check (Insurance joins photos into one PDF). */
  prepareFiles?: (files: File[]) => Promise<File[] | { error: string }>;
  /** Runs per file, first thing in its pipeline. */
  prepare?: (file: File) => Promise<File | { error: string }>;
  /** Rendered between the button and the file list. */
  beforeList?: ReactNode;
  /** Told when uploads start and stop, so a host can lock its own controls (the hub's category select). */
  onBusyChange?: (busy: boolean) => void;
  onUploaded: (
    docs: {
      documentId: string | null;
      filename: string;
      duplicateOf?: string;
      alreadyStored?: boolean;
      /** Stored, but the requested link couldn't be made (the row tells them). */
      linkFailed?: boolean;
    }[],
    meta: { failed: number },
  ) => void;
}

const DOCUMENT_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.heic,.heif,.docx,.xlsx,.txt,.csv,application/pdf,image/*";
// No HEIC here on purpose: asked for JPEG, iOS converts camera photos itself
// (foundation-spec 17).
const PHOTO_ACCEPT = "image/jpeg,image/png";

interface Row {
  key: string;
  file: File;
  name: string;
  size: number;
  /** The category when the file was picked; the host may change it afterwards. */
  categoryLabel?: string;
  status: RowState;
  /** When the current upload stage started, for the elapsed counter. */
  uploadingSince: number | null;
  outcome: UploadOutcome | null;
}

function finePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;
}

function subscribePointer(onChange: () => void) {
  const m = window.matchMedia("(pointer: fine)");
  m.addEventListener("change", onChange);
  return () => m.removeEventListener("change", onChange);
}

function statusFor(stage: UploadStage, size: number): RowState {
  return stage === "uploading" ? { state: "uploading", bytes: size } : { state: stage };
}

function successOf(o: UploadOutcome) {
  if (o.state === "added") {
    return { documentId: o.documentId, filename: o.filename, ...(o.linkFailed ? { linkFailed: true } : {}) };
  }
  if (o.state === "duplicate") {
    return {
      documentId: o.documentId,
      filename: o.filename,
      ...(o.documentId ? { duplicateOf: o.documentId } : {}),
      ...(o.alreadyStored ? { alreadyStored: true } : {}),
    };
  }
  return null;
}

export function DirectUpload(props: DirectUploadProps) {
  const {
    purpose,
    categorySlug,
    categoryLabel,
    ticketId,
    unitId,
    unitKind,
    sharedTicket,
    link,
    read,
    normaliseImages,
    groupAsOne,
    multiple = true,
    disabled,
    prepareFiles,
    prepare,
    beforeList,
    onBusyChange,
    onUploaded,
  } = props;
  const isPhoto = purpose === "ticket_photo";
  const accept = props.accept ?? (isPhoto ? PHOTO_ACCEPT : DOCUMENT_ACCEPT);
  const maxFiles = props.maxFiles ?? (isPhoto ? MAX_PHOTOS_PER_BATCH : MAX_DOCUMENTS_PER_BATCH);
  const label = props.label ?? (isPhoto ? "Add photos" : "Add documents");
  const help = props.help === undefined ? defaultHelp(purpose) : props.help;
  const wantsDropZone = props.dropZone ?? !isPhoto;

  const inputId = useId();
  const helpId = useId();
  const [rows, setRows] = useState<Row[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const fine = useSyncExternalStore(subscribePointer, finePointer, () => false);

  const busy = running || rows.some((r) => rowActive(r.status));
  const anyUploading = rows.some((r) => r.status.state === "uploading");

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  // Elapsed seconds while something is uploading.
  useEffect(() => {
    if (!anyUploading) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [anyUploading]);

  // Ask before leaving mid-upload. Browsers show their own text.
  useEffect(() => {
    if (!busy) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [busy]);

  const patch = (key: string, next: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...next } : r)));

  async function runOne(row: Row): Promise<UploadOutcome> {
    const outcome = await uploadFile(
      row.file,
      { purpose, categorySlug, ticketId, unitId, unitKind, link, read, normaliseImages, prepare },
      (stage, bytes) =>
        patch(row.key, {
          status: statusFor(stage, bytes ?? row.size),
          uploadingSince: stage === "uploading" ? Date.now() : null,
        }),
    );
    let status: RowState;
    if (outcome.state === "added") status = { state: "added", linkFailed: outcome.linkFailed };
    else if (outcome.state === "duplicate") {
      status = {
        state: "duplicate",
        purpose,
        onThisProblem: outcome.onThisProblem,
        alreadyStored: outcome.alreadyStored,
        narrowerAudience: outcome.narrowerAudience,
      };
    } else status = { state: "failed", error: outcome.error };
    patch(row.key, { status, outcome, uploadingSince: null });
    return outcome;
  }

  async function runAll(batch: Row[]) {
    setRunning(true);
    const successes: ReturnType<typeof successOf>[] = [];
    let failed = 0;
    try {
      for (const row of batch) {
        const outcome = await runOne(row);
        const ok = successOf(outcome);
        if (ok) successes.push(ok);
        else failed++;
      }
    } finally {
      setRunning(false);
    }
    onUploaded(
      successes.filter((s): s is NonNullable<typeof s> => s !== null),
      { failed },
    );
  }

  async function start(picked: File[]) {
    if (picked.length === 0 || busy || disabled) return;
    setListError(null);

    let files = picked;
    if (prepareFiles) {
      setRunning(true);
      try {
        const prepared = await prepareFiles(picked);
        if (!Array.isArray(prepared)) {
          setListError(prepared.error);
          return;
        }
        files = prepared;
      } catch {
        setListError(UPLOAD_COPY.couldNotStart);
        return;
      } finally {
        setRunning(false);
      }
    }

    if (files.length > maxFiles) {
      setListError(tooManyFiles(maxFiles));
      return;
    }
    if (files.length === 0) return;

    const stamp = Date.now();
    const batch: Row[] = files.map((file, i) => ({
      key: `${stamp}-${i}-${file.name}`,
      file,
      name: file.name,
      size: file.size,
      categoryLabel,
      status: { state: "queued" },
      uploadingSince: null,
      outcome: null,
    }));
    setRows(batch);
    await runAll(batch);
  }

  async function retry(row: Row) {
    if (busy) return;
    patch(row.key, { status: { state: "queued" }, outcome: null });
    await runAll([{ ...row, status: { state: "queued" }, outcome: null }]);
  }

  const button = (
    <label
      htmlFor={inputId}
      className={`${btnPrimary} w-full cursor-pointer has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink sm:w-auto ${
        busy || disabled ? "pointer-events-none opacity-50" : ""
      }`}
    >
      {label}
      <input
        id={inputId}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={busy || disabled}
        aria-describedby={help ? helpId : undefined}
        className="sr-only"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          // Clear so picking the same file again still fires onChange.
          e.target.value = "";
          void start(picked);
        }}
      />
    </label>
  );

  return (
    <div aria-busy={busy} className="space-y-2">
      <style href="walkup-direct-upload" precedence="default">
        {`@keyframes walkup-upload-bar { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }`}
      </style>

      {isPhoto && sharedTicket ? (
        <p className="text-[12px] text-mute">{UPLOAD_COPY.sharedAreaNote}</p>
      ) : null}
      {groupAsOne ? <p className="text-[12px] text-mute">{UPLOAD_COPY.groupNote}</p> : null}

      {wantsDropZone && fine ? (
        <div
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const dropped = Array.from(e.dataTransfer.files ?? []);
            void start(multiple ? dropped : dropped.slice(0, 1));
          }}
          className={`flex rounded-lg border border-dashed border-line-strong text-[13px] text-mute ${
            props.centered ? "flex-col items-center justify-center gap-4 px-6 py-12 text-center text-[14px]" : "flex-wrap items-center gap-3 px-4 py-4"
          } ${dragging ? "bg-fill" : ""}`}
        >
          <span>{UPLOAD_COPY.dropZone}</span>
          {button}
        </div>
      ) : props.centered ? (
        <div className="flex justify-center">{button}</div>
      ) : (
        button
      )}

      {help ? (
        <p id={helpId} className={`text-[12px] text-mute ${props.centered ? "text-center" : ""}`}>
          {help}
        </p>
      ) : null}

      {beforeList}

      <div aria-live="polite">
        {listError ? (
          <p className="border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">
            {listError}
          </p>
        ) : null}
        {rows.length ? (
          <ul className="mt-1 space-y-2">
            {rows.map((r) => (
              <UploadRow
                key={r.key}
                row={r}
                now={now}
                showOpenLink={purpose === "document"}
                disabled={busy}
                onRetry={() => void retry(r)}
              />
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function UploadRow({
  row,
  now,
  showOpenLink,
  disabled,
  onRetry,
}: {
  row: Row;
  now: number;
  showOpenLink: boolean;
  disabled: boolean;
  onRetry: () => void;
}) {
  const s = row.status;
  const elapsed =
    s.state === "uploading" && row.uploadingSince
      ? Math.max(0, Math.floor((now - row.uploadingSince) / 1000))
      : 0;
  const tone =
    s.state === "failed"
      ? "text-bad-text"
      : s.state === "added" && !s.linkFailed
        ? "text-good-text"
        : "text-mute";
  const duplicateId =
    s.state === "duplicate" && row.outcome?.state === "duplicate" ? row.outcome.documentId : null;

  return (
    <li className="text-[12px]">
      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 truncate font-medium text-ink">{row.name}</span>
          <span className="shrink-0 text-mute">{readableSize(row.size)}</span>
        </div>
        {row.categoryLabel ? <span className="text-mute">Filing as {row.categoryLabel}</span> : null}
        <span className={tone}>
          {rowText(s)}
          {s.state === "uploading" ? <span aria-hidden="true"> {elapsed} s</span> : null}
          {duplicateId && showOpenLink ? (
            <>
              {" "}
              <Link
                href={`/documents/${duplicateId}`}
                className="text-ink underline underline-offset-2"
              >
                Open it
              </Link>
            </>
          ) : null}
        </span>
        {s.state === "failed" ? (
          <button
            type="button"
            onClick={onRetry}
            disabled={disabled}
            aria-label={`${UPLOAD_COPY.tryAgain}: ${row.name}`}
            className="min-h-[44px] self-start rounded-md border border-line-strong px-3 py-1 text-[12px] text-ink hover:bg-fill disabled:opacity-50 sm:min-h-0"
          >
            {UPLOAD_COPY.tryAgain}
          </button>
        ) : null}
      </div>
      {s.state === "uploading" ? (
        <>
          <div className="mt-1 h-1 overflow-hidden rounded bg-fill">
            <div className="h-1 w-1/3 rounded bg-ink-mid motion-safe:[animation:walkup-upload-bar_1.2s_ease-in-out_infinite]" />
          </div>
          {elapsed >= SLOW_UPLOAD_SECONDS ? (
            <p className="mt-1 text-mute">{UPLOAD_COPY.slowUpload}</p>
          ) : null}
        </>
      ) : null}
    </li>
  );
}
