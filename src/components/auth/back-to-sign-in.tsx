import { ArrowLeft } from "lucide-react";
import { signOut } from "@/app/login/actions";

/**
 * "Back to sign in" for the two-step screens. The person is signed in with
 * their password but hasn't finished the second step, and /login would send
 * them straight back here while that half-session exists, so this ends it
 * first and then lands on the sign-in page.
 */
export function BackToSignIn() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-3 text-[14px] font-medium text-mute hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass"
      >
        <ArrowLeft size={15} strokeWidth={1.8} aria-hidden="true" />
        Back to sign in
      </button>
    </form>
  );
}
