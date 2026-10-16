import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui";
import { ThemeToggle } from "@/components/sidebar/theme-toggle";
import { ViewerUnavailable } from "@/components/owner/viewer-unavailable";
import { getViewer, type ViewerRole } from "@/lib/owner/viewer";
import { longDate } from "@/lib/dates";
import { SUPPORT_EMAIL } from "@/lib/site-config";
import { signOut } from "@/app/login/actions";
import { btnSecondary } from "@/components/repairs/styles";
import { ProfileForm } from "@/app/owner/profile/profile-form";
import { EmailPreferencesSlot } from "@/app/owner/profile/email-preferences-slot";
import { getBilling } from "@/lib/billing/entitlement";
import { billingCopy } from "@/lib/billing/copy";
import { ChangePasswordForm, SignOutOthersButton } from "./account-forms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your account" };

const ROLE_WORDS: Record<ViewerRole, string> = {
  board_admin: "Board admin",
  board_member: "Board member",
  accountant: "Accountant",
  owner: "Owner",
};

const linkClass = "font-medium text-ink underline underline-offset-2 hover:text-ink-mid";

/**
 * Everything about the signed-in person's own account, for every role: who
 * they are to the association, how to reach them, password and two-step
 * sign-in, the association's plan, email, appearance and their data.
 */
export default async function AccountPage() {
  const viewer = await getViewer();
  if (!viewer) return <ViewerUnavailable />;
  const supabase = await createClient();

  const [personRes, claimsRes, factorsRes] = await Promise.all([
    supabase.from("persons").select("phone, mailing_address").eq("id", viewer.personId).limit(1),
    supabase.auth.getClaims(),
    supabase.auth.mfa.listFactors(),
  ]);
  const person = personRes.data?.[0] as { phone: string | null; mailing_address: string | null } | undefined;
  const email = claimsRes.data?.claims?.email ?? "";
  const totp = factorsRes.data?.all.find((f) => f.factor_type === "totp" && f.status === "verified") ?? null;
  const roles = viewer.roles.length > 0 ? viewer.roles.map((r) => ROLE_WORDS[r]).join(", ") : "No active role";
  // Board members see the building's real plan status (billing_status answers
  // only to the board); everyone else sees who manages it.
  const billing = viewer.isBoard ? await getBilling(viewer.associationId) : null;
  const billingWords = billing ? billingCopy(billing.facts, billing.entitlement) : null;
  const nameHelp = viewer.isBoard
    ? <>To change your name or email, edit yourself under <Link href="/building" className={linkClass}>Building Info</Link>.</>
    : <>To change your name or email, ask {viewer.boardContact.name ?? "the board"}.</>;

  return (
    <div className="mx-auto w-full max-w-[760px] space-y-6">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Your account</h1>
        <p className="mt-1 text-mute">Your details, sign-in, plan and preferences.</p>
      </div>

      <Card navy title="Profile">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="text-[11px] font-medium uppercase tracking-wide text-mute">Name</dt>
            <dd className="mt-0.5 break-words text-[15px] text-ink">{viewer.fullName || "Not on file"}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium uppercase tracking-wide text-mute">Email</dt>
            <dd className="mt-0.5 break-all text-[15px] text-ink">{email || "Not on file"}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium uppercase tracking-wide text-mute">Association</dt>
            <dd className="mt-0.5 break-words text-[15px] text-ink">{viewer.associationName}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium uppercase tracking-wide text-mute">Your role</dt>
            <dd className="mt-0.5 text-[15px] text-ink">{roles}</dd>
          </div>
        </dl>
        <p className="mt-3 text-[12px] text-mute">{nameHelp}</p>
      </Card>

      <Card navy title="How to reach you" hint="The board uses this for building matters. Only the board sees it.">
        <ProfileForm phone={person?.phone ?? ""} mailingAddress={person?.mailing_address ?? ""} />
      </Card>

      <Card navy title="Sign-in and security">
        <div className="space-y-6">
          <section aria-labelledby="pw-title">
            <h3 id="pw-title" className="text-[14px] font-semibold text-ink">Password</h3>
            <p className="mb-3 mt-0.5 text-[13px] text-mute">Change it any time. You stay signed in here.</p>
            <ChangePasswordForm />
          </section>
          <section aria-labelledby="mfa-title" className="border-t border-line pt-5">
            <h3 id="mfa-title" className="text-[14px] font-semibold text-ink">Two-step sign-in</h3>
            <p className="mt-0.5 text-[13px] text-ink">
              {totp ? (
                <>
                  On, with an authenticator app, since {longDate(totp.created_at.slice(0, 10))}.
                </>
              ) : (
                "On."
              )}
            </p>
            <p className="mt-1 text-[12px] text-mute">
              Every Walkup account uses it, so it can&rsquo;t be turned off. Got a new phone? Email{" "}
              <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Move my two-step sign-in to a new phone")}`} className={linkClass}>
                {SUPPORT_EMAIL}
              </a>{" "}
              and we&rsquo;ll help you move it.
            </p>
          </section>
          <section aria-labelledby="sessions-title" className="border-t border-line pt-5">
            <h3 id="sessions-title" className="text-[14px] font-semibold text-ink">Signed-in devices</h3>
            <p className="mb-3 mt-0.5 text-[13px] text-mute">
              Lost a phone or used a shared computer? Sign out everywhere except this browser.
            </p>
            <div className="flex flex-wrap items-start gap-3">
              <SignOutOthersButton />
              <form action={signOut}>
                <button type="submit" className={btnSecondary}>
                  Sign out
                </button>
              </form>
            </div>
          </section>
        </div>
      </Card>

      <Card navy title="Plan and billing">
        {billing ? (
          <>
            <p className="text-[15px] font-semibold text-ink">{billingWords!.label}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-mute">
              {billingWords!.headline === billingWords!.label ? null : <>{billingWords!.headline} </>}
              {billingWords!.detail}
              {billing.entitlement.status === "not_enabled" ? (
                <>
                  {" "}See the planned prices on the{" "}
                  <Link href="/#pricing" className={linkClass}>
                    pricing page
                  </Link>
                  .
                </>
              ) : null}
            </p>
            {viewer.isBoardAdmin ? (
              <p className="mt-3">
                <Link href="/billing" className={linkClass}>
                  {billing.entitlement.status === "not_enabled" ? "See billing" : "Manage Walkup's plan"}
                </Link>
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-[13px] leading-relaxed text-mute">
            {viewer.associationName}&rsquo;s plan is managed by its board admin. You never pay for Walkup yourself.
          </p>
        )}
      </Card>

      <EmailPreferencesSlot />

      <Card navy title="Appearance">
        <div className="flex items-center justify-between gap-4">
          <p className="text-[13px] text-ink">Light or dark. Your choice is saved on this device.</p>
          <ThemeToggle />
        </div>
      </Card>

      <Card navy title="Your data">
        <p className="text-[13px] leading-relaxed text-ink">
          Your name, email, phone and mailing address are kept while you have access to {viewer.associationName}.{" "}
          {viewer.canReadFinancials ? (
            <>
              The association&rsquo;s records are always yours to take: download{" "}
              <Link href="/financial-statements" className={linkClass}>
                financial statements
              </Link>{" "}
              and{" "}
              <Link href="/documents" className={linkClass}>
                documents
              </Link>{" "}
              any time.{" "}
            </>
          ) : null}
          To close your account or have your details removed, email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Close my Walkup account")}`} className={linkClass}>
            {SUPPORT_EMAIL}
          </a>
          . See the{" "}
          <Link href="/privacy" className={linkClass}>
            Privacy Policy
          </Link>
          .
        </p>
      </Card>
    </div>
  );
}
