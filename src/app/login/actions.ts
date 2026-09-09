"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers, cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { PENDING_INVITE_COOKIE } from "@/lib/invite-cookie";

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

/**
 * Creates a brand-new Supabase Auth account. Deliberately does not create
 * anything in `associations`/`persons`/`role_grants` — that only happens
 * once this account is signed in, MFA-verified, and lands on /onboarding
 * (proxy.ts routes there automatically), which calls
 * create_association_and_owner(). Keeping "have a login" and "belong to a
 * building" as two separate steps is what makes the invite flow possible:
 * the same account-creation step is reused by /invite, just followed by
 * redeem_invite() instead.
 *
 * Whether this returns a session immediately depends on the Supabase
 * project's "Confirm email" setting (Authentication → Sign In / Providers),
 * not on anything here — handled either way rather than assumed.
 */
export async function signUp(_prev: unknown, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");
  // Present only when signing up from /invite/[token] — see that route.
  const inviteToken = String(formData.get("invite_token") ?? "").trim() || null;

  if (!email || !password) {
    return { error: "Email and password are both required." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (password !== confirmPassword) {
    return { error: "Those passwords don't match." };
  }

  const supabase = await createClient();

  // Only meaningful when confirm-email is on and the link actually sends the
  // browser back through here — the email template must include
  // &next={{ .RedirectTo }} for this to reach /auth/confirm at all.
  let emailRedirectTo: string | undefined;
  if (inviteToken) {
    const origin = (await headers()).get("origin");
    if (origin) emailRedirectTo = `${origin}/invite/${inviteToken}`;
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: emailRedirectTo ? { emailRedirectTo } : undefined,
  });

  if (error) return { error: error.message };

  if (inviteToken) {
    const jar = await cookies();
    jar.set(PENDING_INVITE_COOKIE, inviteToken, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24, // a day is plenty to finish confirming + MFA
    });
  }

  if (data.session) {
    // Confirm-email is off in this environment — already signed in.
    revalidatePath("/", "layout");
    redirect(inviteToken ? `/invite/${inviteToken}` : "/");
  }

  // Confirm-email is on: no session yet. /auth/confirm picks up from the
  // link in that email and hands off to proxy.ts's normal MFA/onboarding
  // routing once it does.
  return { ok: true as const, checkEmail: true as const };
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
