// Announcements: the schema for the composer and the words around a post
// (owner-portal-spec 4.4). Pure. A post is plain text, rendered as text.

import { z } from "zod";

export const ANNOUNCEMENT_TITLE_MAX = 120;
export const ANNOUNCEMENT_BODY_MAX = 5000;
export const MAX_PINNED = 3;

export const announcementInput = z
  .object({
    id: z.guid().nullable(),
    title: z.string().trim().min(1, "Add a title.").max(ANNOUNCEMENT_TITLE_MAX, "Keep the title under 120 characters."),
    body: z.string().trim().min(1, "Write the message.").max(ANNOUNCEMENT_BODY_MAX, "Keep the message under 5,000 characters."),
    audience: z.enum(["all", "units"]),
    unitIds: z.array(z.guid()).max(100).default([]),
    pinned: z.boolean().default(false),
    attachmentDocumentId: z.guid().nullable().default(null),
    expiresOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date.")
      .nullable()
      .default(null),
    publish: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.audience === "units" && v.unitIds.length === 0) {
      ctx.addIssue({ code: "custom", path: ["unitIds"], message: "Choose at least one unit." });
    }
    if (v.pinned && !v.publish) {
      ctx.addIssue({ code: "custom", path: ["pinned"], message: "Only a posted announcement can be pinned." });
    }
  });
export type AnnouncementInput = z.infer<typeof announcementInput>;

export type AnnouncementStatus = "draft" | "published" | "archived";

export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  audience: "all" | "units";
  pinned: boolean;
  status: AnnouncementStatus;
  attachment_document_id: string | null;
  expires_on: string | null;
  published_at: string | null;
  edited_at: string | null;
  created_at: string;
}

/**
 * One calm line of the body for a list. Whitespace collapses, tag-like text
 * is dropped, a long body is cut at a word and ends in three dots (never the
 * ellipsis character).
 */
export function announcementPreview(body: string, max = 140): string {
  const text = body
    .replace(/<\/?[a-zA-Z][^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  let cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > max * 0.5) cut = cut.slice(0, lastSpace);
  return `${cut.replace(/[\s.,;:!?-]+$/, "")}...`;
}

/** Pinned first, then newest first. Drafts (no published_at) sort by when they were made. */
export function sortAnnouncements(rows: AnnouncementRow[]): AnnouncementRow[] {
  const when = (r: AnnouncementRow) => r.published_at ?? r.created_at;
  return [...rows].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return when(a) < when(b) ? 1 : when(a) > when(b) ? -1 : 0;
  });
}

/** The board's read receipt: counts, never names. */
export function readSummary(s: { readers_total: number; readers_read: number; no_login: number }): string {
  const main =
    s.readers_total === 0
      ? "No owner who can sign in sees this yet"
      : `Read by ${s.readers_read} of ${s.readers_total} ${s.readers_total === 1 ? "owner" : "owners"} who can sign in`;
  if (s.no_login <= 0) return main;
  return `${main} · ${s.no_login} ${s.no_login === 1 ? "owner has" : "owners have"} no login yet`;
}

export function audienceLabel(a: { audience: "all" | "units" }, unitLabels: string[]): string {
  if (a.audience === "all") return "Everyone";
  if (unitLabels.length === 0) return "Chosen units";
  if (unitLabels.length <= 2) return unitLabels.join(", ");
  return `${unitLabels.slice(0, 2).join(", ")} and ${unitLabels.length - 2} more`;
}

/** A database error from save_announcement, in the words the board should read. */
export function mapSaveError(code: string | undefined, hint: string | undefined, message: string): string {
  if (hint === "attachment_not_shared") return "Owners can't open that file yet. Share it with all owners first.";
  if (hint === "attachment_missing") return "That file isn't available any more. Pick another.";
  if (hint === "no_units") return "Choose at least one unit.";
  if (hint === "expires_past") return "The end date is in the past.";
  if (code === "42501") return "Only the board can post announcements.";
  if (code === "23514" && /three announcements/i.test(message)) {
    return "Three announcements are already pinned. Unpin one first.";
  }
  if (/restore it before editing/i.test(message)) return "Restore it before editing.";
  return "Couldn't save that. Try again.";
}

// ---------------------------------------------------------------------------
// Attachments and audience size (used by the composer, mirrored by save_announcement)
// ---------------------------------------------------------------------------

export interface AttachableDocument {
  id: string;
  title: string;
  visibility: "board_only" | "all_owners";
  restrictedToUnitId: string | null;
}

/**
 * Whether owners in this audience can already open the file. The same rule as
 * save_announcement (0054): everyone-readable files fit any audience; a file
 * pinned to one unit fits only a post to exactly that unit. The database has
 * the final word; this lets the composer say so before the board presses Post.
 */
export function attachmentReadable(
  doc: Pick<AttachableDocument, "visibility" | "restrictedToUnitId">,
  audience: "all" | "units",
  unitIds: string[],
): boolean {
  if (doc.restrictedToUnitId === null && doc.visibility === "all_owners") return true;
  return audience === "units" && unitIds.length === 1 && doc.restrictedToUnitId === unitIds[0];
}

/** How the composer should treat an attachment that owners cannot open yet. */
export function attachmentFix(
  doc: Pick<AttachableDocument, "visibility" | "restrictedToUnitId">,
  audience: "all" | "units",
  unitIds: string[],
): "none" | "share" | "unit_only" {
  if (attachmentReadable(doc, audience, unitIds)) return "none";
  // A file that belongs to one unit is never widened by an announcement.
  return doc.restrictedToUnitId === null ? "share" : "unit_only";
}

/** Distinct owners a post reaches, from each unit's current owner ids. */
export function ownersReached(
  audience: "all" | "units",
  unitIds: string[],
  ownersByUnit: Record<string, string[]>,
): number {
  const units = audience === "all" ? Object.keys(ownersByUnit) : unitIds;
  const people = new Set<string>();
  for (const u of units) for (const p of ownersByUnit[u] ?? []) people.add(p);
  return people.size;
}
