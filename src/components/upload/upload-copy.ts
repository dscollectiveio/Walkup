/**
 * Every sentence the direct-upload path shows (foundation-spec 6.9), in one
 * pure module so the server actions, the browser pipeline and DirectUpload
 * say the same thing, and so the row text can be unit-tested without a DOM.
 *
 * Neither "use client" nor "server-only": both sides import it. No em dashes
 * in anything here.
 */
import { readableSize } from "@/lib/documents/format";

export type UploadPurpose = "document" | "ticket_photo" | "unit_document";

export const SLOW_UPLOAD_SECONDS = 15;

export const UPLOAD_COPY = {
  photoHelp: "JPEG, PNG or iPhone photos, up to 15 MB each, 6 at a time.",
  sharedAreaNote: "Everyone in your building can see photos on shared-area problems.",
  groupNote: "Taking photos of a paper policy? Pick all the pages at once.",
  dropZone: "Drop files here, or",
  notBoard: "Only the board and the accountant can add documents.",
  cantAddUnitDocument: "You can't add documents for this unit.",
  unitDocumentLimit: "This unit already has 100 uploaded documents. Remove one first.",
  unitDocumentDaily: "You've added 20 documents today. Try again tomorrow.",
  noAssociation: "No association is visible to you.",
  cantAddPhotos: "You can't add photos to this problem.",
  problemClosed: "This problem is closed. Report a new one if it's back.",
  photoLimit: "This problem already has 20 photos.",
  unregisteredCap:
    "You've started a lot of photo uploads today that didn't finish. Try again tomorrow, or ask your board to add the photo.",
  couldNotStart: "Couldn't start the upload. Try again.",
  pathMismatch: "That upload doesn't belong here.",
  unknownCategory: "That category doesn't exist.",
  slowUpload: "Still uploading. Keep this page open.",
  removeConfirm: "Remove this photo from the problem?",
  removeConfirmYes: "Remove",
  removeConfirmNo: "Keep it",
  removeRefused: "You can't remove this photo.",
  removeFailed: "Couldn't remove the photo. Try again.",
  tryAgain: "Try again",
} as const;

/** The help line under the button. A category's default visibility changes who will see the files. */
export function documentHelp(category: { label: string; defaultVisibility: string } | null): string {
  const base = "PDFs, photos, Word, Excel and text files, up to 25 MB each.";
  if (category?.defaultVisibility === "all_owners") {
    return `${base} Filed as ${category.label}, so every owner can see them.`;
  }
  return `${base} Only your board can see them unless you share them.`;
}

export function defaultHelp(purpose: UploadPurpose): string {
  return purpose === "ticket_photo" ? UPLOAD_COPY.photoHelp : documentHelp(null);
}

export function tooManyFiles(n: number): string {
  return `Choose up to ${n} files at a time.`;
}

export function tooBig(purpose: UploadPurpose, name: string): string {
  return purpose === "ticket_photo"
    ? `${name} is larger than 15 MB. Try a smaller photo.`
    : `${name} is larger than 25 MB. Try a smaller scan, or split it.`;
}

/**
 * The wrong-type message. For documents, verifyFile's own reason is reused
 * when it says something more specific (a zip archive); the generic "can't
 * store" reason gets the exact 6.9 wording.
 */
/** A shared-area photo whose location and device data could not be removed on this device (REVIEW-2 #18). */
export function photoNeedsJpeg(name: string): string {
  return `${name} couldn't be prepared on this device, so it wasn't uploaded. Save it as a JPEG, or use Safari on an iPhone, and try again.`;
}

export function wrongType(purpose: UploadPurpose, name: string, reason?: string): string {
  if (purpose === "ticket_photo") {
    return `${name} isn't a photo Walkup can store. JPEG, PNG and iPhone photos work.`;
  }
  if (reason && !reason.startsWith("isn't a file type")) return `${name} ${reason}`;
  return `${name} isn't a file type Walkup can store. PDFs, photos, Word, Excel and text files work.`;
}

export function contentsMismatch(name: string): string {
  return `${name}'s contents don't match its file type, so it wasn't added.`;
}

export function networkError(name: string): string {
  return `${name} didn't finish uploading. Check your connection and try again.`;
}

export function notFinished(name: string): string {
  return `${name} didn't finish uploading. Try again.`;
}

export function couldNotSave(name: string): string {
  return `${name} couldn't be saved. Try again.`;
}

/** Report-time partial failure (Repairs' report form). */
export function reportPartialFailure(failed: number): string {
  return failed === 1
    ? "Your problem was reported. 1 photo didn't upload."
    : `Your problem was reported. ${failed} photos didn't upload.`;
}

export type RowState =
  | { state: "queued" }
  | { state: "preparing" }
  | { state: "checking" }
  | { state: "uploading"; bytes: number }
  | { state: "saving" }
  | { state: "added"; linkFailed?: boolean }
  | {
      state: "duplicate";
      purpose: UploadPurpose;
      onThisProblem?: boolean;
      alreadyStored?: boolean;
      narrowerAudience?: boolean;
    }
  | { state: "failed"; error: string };

/** The state text for one file's row. Stable across renders (it sits in a live region). */
export function rowText(row: RowState): string {
  switch (row.state) {
    case "queued":
      return "Waiting…";
    case "preparing":
      return "Preparing…";
    case "checking":
      return "Checking…";
    case "uploading":
      return `Uploading ${readableSize(row.bytes) || "0 B"}…`;
    case "saving":
      return "Saving…";
    case "added":
      return row.linkFailed
        ? "Added, but it couldn't be attached here. Attach it from Documents."
        : "Added";
    case "duplicate":
      if (row.purpose === "document") return "Already in your documents, so nothing new was added.";
      if (row.purpose === "unit_document") {
        return row.alreadyStored
          ? "Walkup already has this exact file, so it wasn't added again."
          : "Already added for your unit, so nothing new was added.";
      }
      if (row.onThisProblem) return "This photo is already on this problem.";
      if (row.narrowerAudience) return "This photo is already on another problem with a smaller audience.";
      return "Walkup already has this exact photo, so it wasn't added again. If it belongs on this problem, ask your board to attach it.";
    case "failed":
      return row.error;
  }
}

/** True while a row still has work in flight (drives aria-busy and the leave-page prompt). */
export function rowActive(row: RowState): boolean {
  return (
    row.state === "preparing" ||
    row.state === "checking" ||
    row.state === "uploading" ||
    row.state === "saving"
  );
}

/** Photo captions (6.7). `dateText` is already a human date ("October 14, 2026"). */
export function photoCaption(p: {
  viewerSeesNames: boolean;
  addedByKind: "you" | "board" | "owner" | string;
  addedByName: string | null;
  dateText: string;
}): string {
  if (p.viewerSeesNames) return `Added by ${p.addedByName ?? "a former member"}, ${p.dateText}`;
  const who =
    p.addedByKind === "you" ? "you" : p.addedByKind === "board" ? "the board" : "an owner";
  return `Added by ${who}, ${p.dateText}`;
}

/** Alt text for photo i (1-based) of n (6.7). */
export function photoAlt(p: { index: number; count: number; title: string | null; dateText: string }): string {
  const title = p.title?.trim();
  return title
    ? `${title}, photo ${p.index} of ${p.count}`
    : `Photo ${p.index} of ${p.count}, added ${p.dateText}`;
}

/** HEIC can't be drawn by most browsers, so it renders as a file chip with a Download link. */
export function isHeicPhoto(mime: string | null | undefined): boolean {
  const m = (mime ?? "").toLowerCase();
  return m === "image/heic" || m === "image/heif";
}
