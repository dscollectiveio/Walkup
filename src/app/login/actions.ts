"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function signIn(_prev: unknown, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are both required." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Deliberately not distinguishing "no such account" from "wrong password" —
    // that difference tells an attacker which emails are registered.
    return { error: "Those credentials were not accepted." };
  }

  revalidatePath("/", "layout");
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

/**
 * Whether the one-click development sign-in is available.
 *
 * Two independent conditions, both required:
 *   - the build is not production
 *   - both DEV_AUTH_* variables are present
 *
 * Neither holds on Vercel: NODE_ENV is "production" there, and the variables
 * are deliberately absent from .env.local.example so they are never copied
 * into a deployment. Either one alone would be enough; requiring both means a
 * single mistake cannot expose it.
 */
export async function devAuthAvailable(): Promise<boolean> {
  return (
    process.env.NODE_ENV !== "production" &&
    Boolean(process.env.DEV_AUTH_EMAIL && process.env.DEV_AUTH_PASSWORD)
  );
}

/**
 * Signs in as the development account.
 *
 * This is NOT an auth bypass. It performs a real password sign-in against
 * Supabase Auth and receives a real JWT, so `auth.uid()` is populated and
 * every RLS policy in 0002 applies exactly as it does for any other user.
 *
 * A true bypass — faking a session, or reading with the service role — would
 * make every page appear to work while testing nothing, because RLS is the
 * only thing standing between one owner and their neighbour's balance.
 *
 * The account is a separate identity (walkup-dev@dscollective.io), not Doug's.
 * Delete it before real financial data exists. See docs/DECISIONS.md #19.
 */
export async function devSignIn() {
  if (!(await devAuthAvailable())) {
    return { error: "Development sign-in is not available in this environment." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: process.env.DEV_AUTH_EMAIL!,
    password: process.env.DEV_AUTH_PASSWORD!,
  });

  if (error) {
    return { error: `Development sign-in failed: ${error.message}` };
  }

  revalidatePath("/", "layout");
  redirect("/");
}
