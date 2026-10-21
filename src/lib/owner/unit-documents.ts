/**
 * Owner unit documents (migration 0079): the kinds an owner can pick, the 30 day removal window, and the
 * sentences the owner page and the board's strip show. Pure, so it can be unit-tested without a DOM, and
 * imported by both server and client code. No em dashes in any copy here.
 */

export const UNIT_DOCUMENT_KINDS = [
  { slug: "ho6_certificate", label: "HO6 insurance certificate" },
  { slug: "lease", label: "Lease" },
  { slug: "proof_of_ownership", label: "Proof of ownership" },
  { slug: "other", label: "Other" },
] as const;

export type UnitDocumentKind = (typeof UNIT_DOCUMENT_KINDS)[number]["slug"];

/** The category every one of these is filed under. */
export const UNIT_DOCUMENT_CATEGORY = "unit_owner_upload";

/** An owner can remove their own upload for this many days (SQL remove_unit_document). */
export const UNIT_DOCUMENT_REMOVE_DAYS = 30;

export function isUnitDocumentKind(value: unknown): value is UnitDocumentKind {
  return typeof value === "string" && UNIT_DOCUMENT_KINDS.some((k) => k.slug === value);
}

/** The label stored in documents.labels for a kind slug, or null for anything unknown. */
export function unitDocumentKindLabel(slug: string): string | null {
  return UNIT_DOCUMENT_KINDS.find((k) => k.slug === slug)?.label ?? null;
}

/** Whole days left in the removal window, 0 once it has passed. */
export function removalDaysLeft(uploadedAtIso: string, nowMs: number): number {
  const uploaded = Date.parse(uploadedAtIso);
  if (Number.isNaN(uploaded)) return 0;
  const left = UNIT_DOCUMENT_REMOVE_DAYS * 86_400_000 - (nowMs - uploaded);
  return left <= 0 ? 0 : Math.ceil(left / 86_400_000);
}

export type AddedByKind = "you" | "board" | "owner";

/** "Added by you, Oct 3" and so on. `dateText` is already a human date. */
export function addedByLine(kind: string, dateText: string, name?: string | null): string {
  if (name) return `Added by ${name}, ${dateText}`;
  const who = kind === "you" ? "you" : kind === "board" ? "the board" : "another owner of this unit";
  return `Added by ${who}, ${dateText}`;
}

export const UNIT_DOCUMENT_COPY = {
  title: "Your unit documents",
  intro: "Add papers about your unit, like your HO6 insurance certificate or lease. The board and the other owners of your unit can see them. Other owners and the accountant cannot.",
  help: "PDFs, photos, Word, Excel and text files, up to 25 MB each.",
  kindLabel: "What is it?",
  unitLabel: "Which unit?",
  empty: "Nothing added for your unit yet.",
  remove: "Remove",
  removeConfirm: "Remove this document? The board can still restore it.",
  removeConfirmYes: "Remove",
  removeConfirmNo: "Keep it",
  removeFailed: "Couldn't remove the document. Try again.",
  removeWindowClosed: "You can only remove a document within 30 days of adding it. Ask the board to remove it.",
  removeRefused: "You can't remove this document.",
  uploadBlocked: "You can't add documents for this unit.",
} as const;

export const NEW_FROM_OWNERS_COPY = {
  title: "New from owners",
  hint: "Owners added these for their units. Only the board and each unit's owners can open them.",
  markSeen: "Mark all as seen",
  markSeenFailed: "Couldn't update the list. Try again.",
} as const;

export interface OwnerDocumentNoticeLike {
  unitLabel: string;
  uploadedByName: string | null;
  kind: string | null;
  title: string;
}

/** One line for the board's strip: "Ada Okonkwo added a document for Unit 1: Lease". */
export function noticeLine(n: OwnerDocumentNoticeLike): string {
  const who = n.uploadedByName?.trim() || "An owner";
  const kind = n.kind?.trim();
  return `${who} added a document for ${n.unitLabel}${kind ? `: ${kind}` : ""}`;
}

/** The board's side of unit documents: Building & Owners, for any unit (0079 already lets the board add for any unit). */
export const BOARD_UNIT_DOCUMENT_COPY = {
  addTitle: "Add a unit document",
  sectionTitle: "Documents for this unit",
  hint: "Only the board and the owners of that unit can see it. Other owners and the accountant cannot.",
  unitLabel: "Which unit?",
  kindLabel: "What is it?",
  button: "Add a document",
  empty: "Nothing added for this unit yet.",
  loading: "Loading documents…",
  loadFailed: "Couldn't load this unit's documents. Try again.",
  tryAgain: "Try again",
} as const;
