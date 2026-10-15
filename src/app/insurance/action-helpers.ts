import "server-only";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentAssociation, isBoard, type InsuranceAssociation, type Supabase } from "@/lib/insurance/queries";

/**
 * Shared plumbing for the insurance server actions (insurance-spec §8). Kept
 * out of the "use server" files, which may only export async actions.
 */

export const NO_ASSOCIATION = "No association is visible to you.";

/** revalidatePath("/insurance", "layout") and "/", plus any extra paths. */
export function revalidateInsurance(...extra: string[]): void {
  revalidatePath("/insurance", "layout");
  revalidatePath("/");
  for (const p of extra) revalidatePath(p);
}

export type ActionContext = { supabase: Supabase; association: InsuranceAssociation };

/** The caller's client and association; with `boardOnly`, refuses anyone who isn't on the board. */
export async function actionContext(boardOnly: string | false): Promise<ActionContext | { error: string }> {
  const supabase = await createClient();
  const association = await currentAssociation(supabase);
  if (!association) return { error: NO_ASSOCIATION };
  if (boardOnly && !(await isBoard(supabase, association.id))) return { error: boardOnly };
  return { supabase, association };
}

export const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Trimmed text or null, cut to `max`. */
export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t.slice(0, max);
}

export const isIsoDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
