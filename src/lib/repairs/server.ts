import "server-only";
import type { createClient } from "@/lib/supabase/server";

/**
 * What every Repairs server action shares (repairs-spec §5.1): the caller's
 * one association (DECISIONS #11, never an id from the client), the role
 * checks, and one mapping from Postgres error codes to sentences a board
 * member can act on. Raw database messages are logged, never shown, except a
 * 22023 raised by our own RPCs, whose message is written for people.
 */

export type Supabase = Awaited<ReturnType<typeof createClient>>;
export type Ok<T = object> = { ok: true } & T;
export type Err = { error: string };

export const SOMETHING_WRONG = "Something went wrong saving that. Try again.";
export const NO_ASSOCIATION = "No association is visible to you.";

interface PgError { code?: string; message?: string; hint?: string | null }

/** The association visible to the caller (DECISIONS #11), or null. */
export async function currentAssociationId(supabase: Supabase): Promise<string | null> {
  const { data } = await supabase.from("associations").select("id").order("created_at").order("id").limit(1);
  return (data?.[0]?.id as string | undefined) ?? null;
}

export async function isBoard(supabase: Supabase, associationId: string): Promise<boolean> {
  const { data } = await supabase.rpc("is_board", { assoc: associationId });
  return data === true;
}

export async function isBoardAdmin(supabase: Supabase, associationId: string): Promise<boolean> {
  const { data } = await supabase.rpc("has_role_in", { assoc: associationId, roles: ["board_admin"] });
  return data === true;
}

export async function canReadFinancials(supabase: Supabase, associationId: string): Promise<boolean> {
  const { data } = await supabase.rpc("can_read_financials", { assoc: associationId });
  return data === true;
}

/** The caller's persons.id in this association, or null. */
export async function currentPersonId(supabase: Supabase, associationId: string): Promise<string | null> {
  const { data } = await supabase.rpc("current_person_id", { assoc: associationId });
  return typeof data === "string" ? data : null;
}

/** "there is no problem #12 in this building" -> "There is no problem #12 in this building." */
export function sentence(message: string | null | undefined): string {
  const m = String(message ?? "").trim();
  if (!m) return SOMETHING_WRONG;
  const first = m[0].toUpperCase() + m.slice(1);
  return /[.!?]$/.test(first) ? first : `${first}.`;
}

/**
 * Postgres error -> what the person reads. 42501 is the action's permission
 * sentence, 23505 its own duplicate sentence (or the generic one), 22023 the
 * RPC's message capitalised, anything else the generic sentence with the raw
 * message logged server-side.
 */
export function dbError(
  error: PgError,
  opts: { denied: string; duplicate?: string; context: string },
): string {
  if (error.code === "42501") return opts.denied;
  if (error.code === "23505" && opts.duplicate) return opts.duplicate;
  if (error.code === "22023") return sentence(error.message);
  console.error(`[repairs] ${opts.context}`, error.code ?? "-", error.message ?? "");
  return SOMETHING_WRONG;
}

/** A thrown zod error's first message, for actions that validate with the 4.2 schemas. */
export function firstIssue(e: unknown, fallback = "Check the form and try again."): string {
  const issues = (e as { issues?: { message?: string }[] } | null)?.issues;
  return issues?.[0]?.message || fallback;
}

/** Trimmed text or null. */
export function textOrNull(v: string | null | undefined): string | null {
  const t = typeof v === "string" ? v.trim() : "";
  return t ? t : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}
