import { Card } from "@/components/ui";
import { longDate } from "@/lib/dates";
import { SUPPORT_EMAIL } from "@/lib/site-config";
import { signOut } from "@/app/login/actions";
import { btnSecondary } from "@/components/repairs/styles";
import { ChangePasswordForm, SignOutOthersButton } from "../account-forms";
import { Pill, linkClass } from "./shared";

/**
 * Sign-in and security: password, two-step sign-in (always on for every
 * Walkup account), when this account last signed in, and signing out of
 * other devices.
 */
export function SecurityTab({
  totpSince,
  lastSignIn,
}: {
  totpSince: string | null;
  lastSignIn: string | null;
}) {
  return (
    <>
      <Card navy title="Your sign-in at a glance">
        <ul className="grid gap-3 sm:grid-cols-3">
          <li className="rounded-lg border border-line p-3">
            <p className="text-[12px] text-mute">Password</p>
            <p className="mt-1">
              <Pill tone="good">Set</Pill>
            </p>
          </li>
          <li className="rounded-lg border border-line p-3">
            <p className="text-[12px] text-mute">Two-step sign-in</p>
            <p className="mt-1">
              <Pill tone="good">On</Pill>
            </p>
          </li>
          <li className="rounded-lg border border-line p-3">
            <p className="text-[12px] text-mute">Last signed in</p>
            <p className="mt-1 text-[14px] font-medium text-ink">{lastSignIn ? longDate(lastSignIn.slice(0, 10)) : "Today"}</p>
          </li>
        </ul>
      </Card>

      <Card navy title="Password" hint="Change it any time. You stay signed in here.">
        <ChangePasswordForm />
      </Card>

      <Card navy title="Two-step sign-in">
        <p className="text-[14px] text-ink">
          {totpSince ? <>On, with an authenticator app, since {longDate(totpSince.slice(0, 10))}.</> : "On."}
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-mute">
          Every Walkup account uses it, because Walkup holds an association&rsquo;s books and owners&rsquo; details. It
          can&rsquo;t be turned off. Got a new phone? Email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Move my two-step sign-in to a new phone")}`} className={linkClass}>
            {SUPPORT_EMAIL}
          </a>{" "}
          and we&rsquo;ll help you move it.
        </p>
      </Card>

      <Card navy title="Signed-in devices" hint="Lost a phone or used a shared computer? Sign out everywhere except this browser.">
        <div className="flex flex-wrap items-start gap-3">
          <SignOutOthersButton />
          <form action={signOut}>
            <button type="submit" className={btnSecondary}>
              Sign out here
            </button>
          </form>
        </div>
      </Card>
    </>
  );
}
