"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { issueRecoveryCodes, verifyTotpCode } from "@/lib/security/mfa-server";

export type RecoveryResult = { error: string } | { codes: string[] } | null;

/**
 * Makes a new set of ten recovery codes, replacing the old set. Needs a code
 * from the authenticator app first, so a borrowed signed-in browser cannot
 * mint codes. The plaintext goes back to this one response and is not stored.
 */
export async function regenerateRecoveryCodes(_prev: unknown, formData: FormData): Promise<RecoveryResult> {
  const supabase = await createClient();
  const bad = await verifyTotpCode(supabase, String(formData.get("code") ?? ""));
  if (bad) return { error: bad };
  const issued = await issueRecoveryCodes(supabase);
  if ("error" in issued) return { error: issued.error };
  revalidatePath("/account");
  return { codes: issued.codes };
}
