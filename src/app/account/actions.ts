"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { MIN_PASSWORD } from "@/lib/security/password";

export type AccountResult = { ok: true; message: string } | { error: string } | null;

/**
 * Changes the signed-in person's password from the Account page. The session
 * is already two-step verified (proxy.ts sends anyone else to the code
 * screen), which is what Supabase checks before allowing the change. Unlike
 * the reset-link flow, this stays on the page and keeps the person signed in.
 */
export async function changePassword(_prev: AccountResult, formData: FormData): Promise<AccountResult> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm_password") ?? "");
  if (password.length < MIN_PASSWORD) {
    return { error: `Use at least ${MIN_PASSWORD} characters. A few random words works well.` };
  }
  if (password !== confirm) return { error: "Those passwords don't match." };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === "same_password") return { error: "That's your current password. Choose a new one." };
    if (error.code === "insufficient_aal") return { error: "Sign in again with your two-step code, then change your password." };
    if (error.code === "weak_password") return { error: "That password is too easy to guess or has appeared in a data breach. Choose another." };
    if (error.code === "reauthentication_needed") return { error: "For safety, sign out and back in, then change your password." };
    return { error: "Couldn't change your password. Try again." };
  }
  return { ok: true, message: "Password changed. Use it the next time you sign in." };
}

/** Signs this person out everywhere except this browser: a lost phone, a shared computer. */
export async function signOutOtherDevices(): Promise<AccountResult> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) return { error: "Couldn't sign out your other devices. Try again." };
  revalidatePath("/account");
  return { ok: true, message: "Signed out everywhere else. This browser stays signed in." };
}
