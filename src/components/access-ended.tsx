import { Card } from "@/components/ui";
import { btnPrimary } from "@/components/repairs/styles";

/** Shown instead of the page when a signed-in person has no active role (an accountant whose access ended, say). */
export function AccessEnded({ signOutAction, boardContact }: { signOutAction: () => Promise<void>; boardContact?: string | null }) {
  return (
    <div className="mx-auto max-w-xl py-10">
      <Card navy title="Your access has ended">
        <p className="text-[14px] text-ink">
          You&rsquo;re signed in, but you no longer have an active role in this building. A board admin can bring it back.
        </p>
        {boardContact ? <p className="mt-2 text-[13px] text-mute">Ask: {boardContact}</p> : null}
        <form action={signOutAction} className="mt-4">
          <button type="submit" className={btnPrimary}>
            Sign out
          </button>
        </form>
      </Card>
    </div>
  );
}
