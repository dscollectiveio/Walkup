import { createClient, getUser } from "@/lib/supabase/server";
import { Lockup } from "@/components/mark";
import { InviteSignupForm } from "./invite-signup-form";
import { RedeemInviteForm } from "./redeem-invite-form";

export const dynamic = "force-dynamic";

/**
 * Three states, depending on who's looking:
 *  - no session yet: sign up (the invite token rides along, see signUp() in
 *    login/actions.ts and the PENDING_INVITE_COOKIE it sets).
 *  - signed in, MFA-verified, no persons row anywhere: redeem this invite.
 *  - signed in and already belongs to a building: nothing to do here — the
 *    one-account-one-association rule (DECISIONS #11's posture, carried
 *    forward in 0027) means this invite isn't for this account.
 *
 * Deliberately does not preview which building/role the invite is for before
 * redemption — invites_select requires is_board(), which a recipient isn't
 * yet, so only the redeem_invite() RPC itself can actually read the row.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const user = await getUser();

  if (!user) {
    return (
      <div className="mx-auto max-w-sm py-16">
        <Lockup />
        <h1 className="mt-4 text-[20px] font-semibold tracking-tight text-ink">
          You&rsquo;ve been invited
        </h1>
        <p className="mt-2 text-mute">
          Create an account to join — it only takes a minute.
        </p>
        <InviteSignupForm token={token} />
      </div>
    );
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("persons")
    .select("id")
    .eq("auth_user_id", user.id)
    .limit(1);

  if (existing && existing.length > 0) {
    return (
      <div className="mx-auto max-w-sm py-16">
        <Lockup />
        <h1 className="mt-4 text-[20px] font-semibold tracking-tight text-ink">
          This account already belongs to a building
        </h1>
        <p className="mt-2 text-mute">
          Walkup only supports one building per login right now. Sign in with
          a different account to accept this invite, or ask whoever sent it
          to add you to your existing building instead.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm py-16">
      <Lockup />
      <h1 className="mt-4 text-[20px] font-semibold tracking-tight text-ink">
        Join this building
      </h1>
      <p className="mt-2 text-mute">One more step — confirm your name.</p>
      <RedeemInviteForm token={token} />
    </div>
  );
}
