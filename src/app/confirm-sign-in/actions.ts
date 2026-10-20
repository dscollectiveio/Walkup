"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyTotpCode } from "@/lib/security/mfa-server";
import { safeNext } from "@/lib/security/safe-next";

/** Re-checks the authenticator code. A good one makes this session's sign-in fresh for 15 minutes. */
export async function confirmSignIn(_prev: unknown, formData: FormData) {
  const supabase = await createClient();
  const bad = await verifyTotpCode(supabase, String(formData.get("code") ?? ""));
  if (bad) return { error: bad };
  redirect(safeNext(String(formData.get("next") ?? ""), "/building"));
}
