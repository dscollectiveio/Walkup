import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Lockup } from "@/components/mark";
import { INVALID_LINK, isValidToken } from "@/lib/email-outbox/unsubscribe";
import { UnsubscribeForm } from "./unsubscribe-form";

export const dynamic = "force-dynamic";
// A link in an email: never indexed, and the address of this page (it holds the token) is not sent on to other sites.
export const metadata = { title: "Email choices | Walkup", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-10">
      <Link href="/" aria-label="Walkup home" className="mb-6 inline-flex min-h-[44px] items-center">
        <Lockup size={30} />
      </Link>
      <div className="rounded-xl border border-line bg-paper p-5">{children}</div>
    </div>
  );
}

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let row:
    | { association_name: string; masked_email: string; dues_reminders: boolean; statements: boolean; announcements: boolean; unsubscribed_all: boolean }
    | undefined;
  let failed = false;
  if (isValidToken(token)) {
    // Reading never changes anything: mail scanners open links before a person does.
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("email_preference_for_token", { p_token: token });
    if (error) failed = true;
    else row = (Array.isArray(data) ? data[0] : data) ?? undefined;
  }

  if (failed) {
    return (
      <Frame>
        <h1 className="text-[18px] font-bold tracking-tight text-ink">Something went wrong</h1>
        <p className="mt-2 text-[14px] text-mute">We couldn&apos;t load your email choices. Reload the page, or try again in a minute.</p>
      </Frame>
    );
  }
  if (!row) {
    return (
      <Frame>
        <h1 className="text-[18px] font-bold tracking-tight text-ink">This link isn&apos;t valid</h1>
        <p className="mt-2 text-[14px] text-mute">{INVALID_LINK}</p>
      </Frame>
    );
  }

  return (
    <Frame>
      <h1 className="text-[18px] font-bold tracking-tight text-ink">Email from {row.association_name}</h1>
      <p className="mt-2 text-[14px] text-mute">
        Choose which emails {row.association_name} can send you through Walkup. This applies to {row.masked_email}.
      </p>
      <UnsubscribeForm
        token={token}
        associationName={row.association_name}
        initial={{
          dues_reminders: row.dues_reminders,
          statements: row.statements,
          announcements: row.announcements,
          stop_all: row.unsubscribed_all,
        }}
      />
    </Frame>
  );
}
