import "server-only";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * The one way documents are read.
 *
 * This module does not *decide* access — RLS does, and duplicating those
 * predicates in TypeScript would create a second source of truth that drifts
 * (DECISIONS #18). What it guarantees is narrower and still worth having:
 * every read goes through the same query shape, and a signed URL can only be
 * minted after the row behind it came back from the database. Storage is never
 * addressed directly from a caller-supplied path, so there is no code path
 * where a file is reachable without the row check that gates it.
 *
 * The rule for anything added later: if it reaches a document, it goes here.
 */

export const DOCUMENT_FIELDS = [
  "id",
  "title",
  "filename",
  "mime_type",
  "byte_size",
  "uploaded_at",
  "uploaded_by",
  "checksum",
  "category_id",
  "tag_source",
  "tag_confidence",
  "review_state",
  "labels",
  "folder_id",
  "visibility",
  "restricted_to_unit_id",
  "source",
  "extraction_state",
  "extraction",
  "version_group_id",
  "version_number",
  "is_current_version",
  "deleted_at",
].join(", ");

export interface DocumentRow {
  id: string;
  title: string;
  filename: string;
  mime_type: string | null;
  byte_size: number | null;
  uploaded_at: string;
  uploaded_by: string | null;
  checksum: string | null;
  category_id: string | null;
  tag_source: "auto" | "manual" | null;
  tag_confidence: number | null;
  review_state: "ok" | "needs_review";
  labels: string[];
  folder_id: string | null;
  visibility: "board_only" | "all_owners";
  restricted_to_unit_id: string | null;
  source: string;
  extraction_state: "pending" | "running" | "done" | "failed" | "skipped";
  extraction: Record<string, unknown> | null;
  version_group_id: string;
  version_number: number;
  is_current_version: boolean;
  deleted_at: string | null;
}

export interface DocumentCategory {
  id: string;
  slug: string;
  label: string;
  default_visibility: "board_only" | "all_owners";
  sort_order: number;
  is_system: boolean;
}

export interface DocumentFilters {
  /** Category id, or "unfiled" for documents with no category yet. */
  category?: string;
  /** Free-text across title, filename and extracted text. */
  q?: string;
  reviewState?: "needs_review";
  /** The trash. Off by default — binned documents are not "documents". */
  binned?: boolean;
}

/** Association the caller can see. Single-association UI, per DECISIONS #11. */
export async function currentAssociationId(supabase: Supabase): Promise<string | null> {
  const { data } = await supabase.from("associations").select("id").limit(1);
  return data?.[0]?.id ?? null;
}

export async function listCategories(supabase: Supabase): Promise<DocumentCategory[]> {
  const { data } = await supabase
    .from("document_categories")
    .select("id, slug, label, default_visibility, sort_order, is_system")
    .order("sort_order");
  return (data ?? []) as DocumentCategory[];
}

/**
 * Returns null — not an empty array — when the caller may see nothing at all,
 * so a page can say "not visible to you" rather than rendering a confident
 * empty list. A false zero is worse than a blank (DECISIONS #17).
 */
export async function listDocuments(
  supabase: Supabase,
  filters: DocumentFilters = {},
): Promise<DocumentRow[] | null> {
  let query = supabase
    .from("documents")
    .select(DOCUMENT_FIELDS)
    .eq("is_current_version", true)
    .order("uploaded_at", { ascending: false });

  query = filters.binned
    ? query.not("deleted_at", "is", null)
    : query.is("deleted_at", null);

  if (filters.category === "unfiled") query = query.is("category_id", null);
  else if (filters.category) query = query.eq("category_id", filters.category);

  if (filters.reviewState) query = query.eq("review_state", filters.reviewState);

  if (filters.q?.trim()) {
    // Searching the extracted text is the point — a filename-only search is
    // what every shared folder already does badly.
    const term = `%${filters.q.trim().replace(/[%_]/g, (m) => `\\${m}`)}%`;
    query = query.or(
      `title.ilike.${term},filename.ilike.${term},extracted_text.ilike.${term}`,
    );
  }

  const { data, error } = await query;
  if (error) return null;
  return (data ?? []) as unknown as DocumentRow[];
}

/** One document, or null if RLS hides it (or it does not exist — same answer). */
export async function getDocument(
  supabase: Supabase,
  id: string,
): Promise<DocumentRow | null> {
  const { data } = await supabase
    .from("documents")
    .select(DOCUMENT_FIELDS)
    .eq("id", id)
    .limit(1);
  return (data?.[0] as unknown as DocumentRow) ?? null;
}

/** Every version in a document's history, newest first. */
export async function listVersions(
  supabase: Supabase,
  versionGroupId: string,
): Promise<DocumentRow[]> {
  const { data } = await supabase
    .from("documents")
    .select(DOCUMENT_FIELDS)
    .eq("version_group_id", versionGroupId)
    .order("version_number", { ascending: false });
  return (data ?? []) as unknown as DocumentRow[];
}

/**
 * A short-lived URL for one document's file.
 *
 * The row is fetched first and the path comes from it, never from the caller.
 * The bucket is private and its read policy asks whether a visible `documents`
 * row points at the object, so even a leaked path is worthless — but not
 * handing one out in the first place is the cheaper guarantee.
 */
export async function signedUrlFor(
  supabase: Supabase,
  id: string,
): Promise<{ url: string; filename: string } | { error: string }> {
  const { data: rows } = await supabase
    .from("documents")
    .select("storage_path, filename")
    .eq("id", id)
    .limit(1);

  const doc = rows?.[0];
  if (!doc) return { error: "That document isn't visible to you." };

  const { data, error } = await supabase.storage
    .from("documents")
    .createSignedUrl(doc.storage_path, 60);

  if (error) return { error: error.message };
  return { url: data.signedUrl, filename: doc.filename };
}
