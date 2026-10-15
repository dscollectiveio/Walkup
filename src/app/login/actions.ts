"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers, cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { PENDING_INVITE_COOKIE } from "@/lib/invite-cookie";
import { SUPPORT_EMAIL } from "@/lib/site-config";
import { MIN_PASSWORD } from "@/lib/security/password";

export async function signIn(_prev: unknown, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are both required." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Supabase only says "not confirmed" once the password was right, so
    // this doesn't reveal which emails are registered. Everything else stays
    // one message: "no such account" vs "wrong password" would.
    if (error.code === "email_not_confirmed") {
      return {
        error: "Your email isn't confirmed yet. Open the link we sent you, or send a new one.",
        unconfirmedEmail: email,
      };
    }
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
  const privacyConsent = formData.get("privacy_consent") === "on";

  if (!email || !password) {
    return { error: "Email and password are both required." };
  }
  if (!privacyConsent) {
    return { error: "You need to agree to the Terms of Service and Privacy Policy to create an account." };
  }
  if (password.length < MIN_PASSWORD) {
    return { error: `Password must be at least ${MIN_PASSWORD} characters. A few random words works well.` };
  }
  if (password.toLowerCase().includes(email.split("@")[0].toLowerCase()) && email.split("@")[0].length >= 4) {
    return { error: "Don't use your email address in your password." };
  }
  if (password !== confirmPassword) {
    return { error: "Those passwords don't match." };
  }

  const supabase = await createClient();

  // Only meaningful when confirm-email is on and the link actually sends the
  // browser back through here — the email template must include
  // &next={{ .RedirectTo }} for this to reach /auth/confirm at all.
  // The link goes through Supabase's verify step and back to /auth/confirm,
  // which turns it into a session (PKCE code) and carries on to `next`.
  const emailRedirectTo = await confirmUrl(inviteToken ? `/invite/${encodeURIComponent(inviteToken)}` : "/");

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: emailRedirectTo ? { emailRedirectTo } : undefined,
  });

  if (error) {
    // Answer exactly as for a new address, so this form can't be used to find
    // out which emails already have an account. (With "Confirm email" on,
    // Supabase itself does this; this covers the setting being off.)
    if (error.code === "user_already_exists" || /already registered/i.test(error.message ?? "")) {
      return { ok: true as const, checkEmail: true as const, email };
    }
    return { error: describeAuthError(error) };
  }

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
    redirect(inviteToken ? `/invite/${encodeURIComponent(inviteToken)}` : "/");
  }

  // Confirm-email is on: no session yet. /auth/confirm picks up from the
  // link in that email and hands off to proxy.ts's normal MFA/onboarding
  // routing once it does.
  return { ok: true as const, checkEmail: true as const, email };
}

/** Where an emailed link should land: this site's /auth/confirm, then `next`. */
async function confirmUrl(next: string): Promise<string | undefined> {
  const h = await headers();
  const origin = h.get("origin") ?? (h.get("host") ? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}` : null);
  return origin ? `${origin}/auth/confirm?next=${encodeURIComponent(next)}` : undefined;
}

/** "Didn't get it?" on the check-your-email screen and the sign-in page. */
export async function resendConfirmation(email: string) {
  const address = email.trim();
  if (!address) return { error: "Enter your email first." };
  const supabase = await createClient();
  const emailRedirectTo = await confirmUrl("/");
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: address,
    options: emailRedirectTo ? { emailRedirectTo } : undefined,
  });
  if (error) return { error: describeAuthError(error) };
  return { ok: true as const };
}

/**
 * "Forgot your password?" Always answers the same way, whether or not the
 * address has an account, so this can't be used to find out who's signed up.
 */
export async function requestPasswordReset(_prev: unknown, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter the email you signed up with." };
  const supabase = await createClient();
  const redirectTo = await confirmUrl("/reset-password");
  const { error } = await supabase.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
  // Rate limits and send failures are the only errors worth showing; anything
  // else answers the same either way so this can't reveal who has an account.
  if (error && (error.status === 429 || (error.status ?? 0) >= 500)) return { error: describeAuthError(error) };
  return { ok: true as const, email };
}

/** Sets a new password for the signed-in account (after a reset link, or any time). */
export async function updatePassword(_prev: unknown, formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm_password") ?? "");
  if (password.length < MIN_PASSWORD) return { error: `Password must be at least ${MIN_PASSWORD} characters. A few random words works well.` };
  if (password !== confirm) return { error: "Those passwords don't match." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return {
      error:
        error.code === "same_password"
          ? "That's your current password. Choose a new one."
          : error.code === "insufficient_aal"
            ? "Enter your two-step code first, then set your new password."
            : error.message,
    };
  }
  revalidatePath("/", "layout");
  redirect("/");
}

/**
 * Turns an auth error into words a person can act on. Supabase passes some
 * failures through as an empty or JSON-ish message (a rejected SMTP login
 * arrives as "{}" with status 500), which is useless on screen — so we name
 * the likely cause and keep the technical code at the end for support.
 */
function describeAuthError(error: { message?: string; status?: number; code?: string; name?: string }): string {
  const raw = (error.message ?? "").trim();
  const meaningless = raw === "" || raw === "{}" || raw.startsWith("{");
  const code = error.code ?? error.name ?? "unknown";
  const ref = `(${error.status ?? "?"} ${code})`;

  if (error.code === "over_email_send_rate_limit" || error.status === 429) {
    return "Too many sign-up emails were requested just now. Wait a few minutes and try again.";
  }
  if (error.code === "email_address_invalid" || error.code === "validate_failed") {
    return "That email address doesn't look valid. Check it for typos and try again.";
  }
  if (error.code === "weak_password") {
    return "That password is too easy to guess. Use at least 8 characters, ideally a mix of words, numbers and symbols.";
  }
  if (error.code === "signup_disabled") {
    return `New sign-ups are switched off right now. Email ${SUPPORT_EMAIL} and we'll get you set up.`;
  }
  if (meaningless || (error.status ?? 0) >= 500) {
    return `We couldn't send your confirmation email, so the account wasn't created. This is a problem on our side, not yours. Try again in a few minutes, and if it keeps happening email ${SUPPORT_EMAIL} ${ref}.`;
  }
  return `${raw} ${ref}`;
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
