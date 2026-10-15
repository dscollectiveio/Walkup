"use client";

import Link from "next/link";
import { useId, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DirectUpload } from "@/components/upload/direct-upload";
import { ImageDecodeError, imagesToPdf, photosPdfName, reencodeImage } from "@/lib/insurance/photos-pdf";
import { startInsuranceRead } from "../import-actions";
import { errorBlock, linkClass } from "./styles";

/**
 * The insurance uploader (insurance-spec §7.1.2a): Foundation's DirectUpload
 * with photo preparation in the browser. Every image is re-encoded (longest
 * side 2400 px, JPEG 0.85); two or more photos picked together become one PDF
 * when the board says they are pages of one document (the default). Files are
 * always filed as Insurance, so the reader may read them.
 */

const ACCEPT =
  "application/pdf,image/jpeg,image/png,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx";

function isImage(f: File): boolean {
  return f.type.startsWith("image/") || /\.(jpe?g|png|heic|heif)$/i.test(f.name);
}

function jpegName(name: string): string {
  const dot = name.lastIndexOf(".");
  return `${dot > 0 ? name.slice(0, dot) : name}.jpg`;
}

/** Re-encode one image; a photo the browser can't decode goes up unchanged (the server explains). */
async function reencodeOrKeep(f: File): Promise<File> {
  try {
    const blob = await reencodeImage(f);
    return new File([blob], jpegName(f.name), { type: "image/jpeg" });
  } catch {
    return f;
  }
}

export async function prepareInsuranceFiles(files: File[], asOneDocument: boolean): Promise<File[] | { error: string }> {
  const allImages = files.length >= 2 && files.every(isImage);
  if (allImages && asOneDocument) {
    try {
      const jpegs: Blob[] = [];
      for (const f of files) jpegs.push(await reencodeImage(f));
      const name = photosPdfName(files[0].name);
      const pdf = await imagesToPdf(jpegs, name);
      return [new File([pdf], name, { type: "application/pdf" })];
    } catch (e) {
      if (e instanceof ImageDecodeError) {
        return {
          error:
            "This browser couldn't open one of these photos. Take screenshots of the photos and pick those, or choose Separate documents.",
        };
      }
      return { error: "Walkup couldn't join these photos into one file. Try again, or choose Separate documents." };
    }
  }
  return Promise.all(files.map((f) => (isImage(f) ? reencodeOrKeep(f) : Promise.resolve(f))));
}

// The button text (§11.6, §11.7): pointer users get the drop zone plus a real
// "Choose files" button; phones get "Take a photo or choose a file" (the
// accept list offers the camera).
function finePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;
}

function subscribePointer(onChange: () => void) {
  const m = window.matchMedia("(pointer: fine)");
  m.addEventListener("change", onChange);
  return () => m.removeEventListener("change", onChange);
}

export interface UploadedDoc {
  documentId: string;
  filename: string;
}

/** The plain uploader: hands the stored documents to `onDocuments`. */
export function InsuranceUploader({
  onDocuments,
  multiple = true,
  label,
  help,
  disabled,
}: {
  onDocuments: (docs: UploadedDoc[]) => void;
  multiple?: boolean;
  label?: string;
  help?: string | null;
  disabled?: boolean;
}) {
  const [asOne, setAsOne] = useState(true);
  const groupId = useId();
  const fine = useSyncExternalStore(subscribePointer, finePointer, () => true);
  return (
    <DirectUpload
      purpose="document"
      categorySlug="insurance"
      categoryLabel="Insurance"
      accept={ACCEPT}
      multiple={multiple}
      maxFiles={multiple ? undefined : 1}
      label={label ?? (fine ? "Choose files" : "Take a photo or choose a file")}
      help={help === undefined ? null : help}
      disabled={disabled}
      prepareFiles={(files) => prepareInsuranceFiles(files, asOne)}
      beforeList={
        multiple ? (
          <fieldset className="text-[12px] text-mute">
            <legend className="sr-only">When you pick several photos</legend>
            <span id={groupId} className="mr-2">Several photos?</span>
            <label className="mr-3 inline-flex min-h-[44px] items-center gap-2 text-ink">
              <input type="radio" name={`${groupId}-as-one`} checked={asOne} onChange={() => setAsOne(true)} />
              These photos are pages of one document
            </label>
            <label className="inline-flex min-h-[44px] items-center gap-2 text-ink">
              <input type="radio" name={`${groupId}-as-one`} checked={!asOne} onChange={() => setAsOne(false)} />
              Separate documents
            </label>
          </fieldset>
        ) : null
      }
      onUploaded={(docs) => {
        const stored = docs
          .filter((d): d is typeof d & { documentId: string } => typeof d.documentId === "string")
          .map((d) => ({ documentId: d.documentId, filename: d.filename }));
        if (stored.length) onDocuments(stored);
      }}
    />
  );
}

/**
 * Upload, then read (§9.1, §9.3.1): one read per document. One file opens its
 * progress page; several go to the import list. With AI off nothing is read:
 * each file goes to the manual form with the file linked.
 */
export function ImportUploader({
  aiOn,
  mode = "policy",
  quoteRequestId,
  replacesPolicyId,
  manualHref,
  stayOnImport = false,
  label,
  readHref,
}: {
  aiOn: boolean;
  mode?: "policy" | "quote";
  quoteRequestId?: string | null;
  replacesPolicyId?: string | null;
  /** Where a file goes with AI off; `{id}` is replaced with the document id. */
  manualHref?: string;
  /** On /insurance/import itself: several files refresh the list instead of navigating. */
  stayOnImport?: boolean;
  label?: string;
  /** Where one file's read goes (default its progress page), e.g. `?update=` to update a saved policy (§10.7). */
  readHref?: (readId: string) => string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [manualLinks, setManualLinks] = useState<UploadedDoc[]>([]);
  const manual = (id: string) =>
    (manualHref ?? (mode === "quote" ? "/insurance/quotes/new?document={id}" : "/insurance/policies/new?document={id}")).replace(
      "{id}",
      encodeURIComponent(id),
    );

  function handle(docs: UploadedDoc[]) {
    setError(null);
    if (!aiOn) {
      if (docs.length === 1) router.push(manual(docs[0].documentId));
      else setManualLinks(docs);
      return;
    }
    start(async () => {
      const readIds: string[] = [];
      const errors: string[] = [];
      for (const d of docs) {
        const r = await startInsuranceRead({
          documentId: d.documentId,
          mode,
          ...(quoteRequestId ? { quoteRequestId } : {}),
          ...(replacesPolicyId ? { replacesPolicyId } : {}),
        });
        if ("error" in r) errors.push(`${d.filename}: ${r.error}`);
        else readIds.push(r.readId);
      }
      if (errors.length) setError(errors.join(" "));
      if (readIds.length === 1 && docs.length === 1) router.push(readHref ? readHref(readIds[0]) : `/insurance/import/${readIds[0]}`);
      else if (readIds.length > 0) {
        if (stayOnImport) router.refresh();
        else router.push("/insurance/import");
      }
    });
  }

  return (
    <div className="space-y-2">
      <InsuranceUploader onDocuments={handle} label={label} disabled={pending} />
      {pending ? (
        <p role="status" className="text-[12px] text-mute">
          Starting to read…
        </p>
      ) : null}
      {error ? <p className={errorBlock}>{error}</p> : null}
      {manualLinks.length > 0 ? (
        <ul className="space-y-1 text-[13px]">
          {manualLinks.map((d) => (
            <li key={d.documentId}>
              <Link href={manual(d.documentId)} className={linkClass}>
                Enter the details from {d.filename}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
