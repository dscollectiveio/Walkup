import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui";
import { SUPPORT_EMAIL } from "@/lib/site-config";
import { loadOwnedUnits } from "@/lib/owner/load";
import { ViewerUnavailable } from "@/components/owner/viewer-unavailable";
import { getViewer } from "@/lib/owner/viewer";
import { EmailPreferencesSlot } from "./email-preferences-slot";
import { ProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

/** Your profile: name and email are read-only (the board's record); phone and mailing address are yours (owner-portal-spec 6.8). */
export default async function OwnerProfilePage() {
  const viewer = await getViewer();
  if (!viewer) return <ViewerUnavailable />;
  const supabase = await createClient();

  const [personRes, sessionRes, units] = await Promise.all([
    supabase.from("persons").select("phone, mailing_address").eq("id", viewer.personId).limit(1),
    supabase.auth.getSession(),
    loadOwnedUnits(supabase, viewer),
  ]);
  const person = personRes.data?.[0] as { phone: string | null; mailing_address: string | null } | undefined;
  const email = sessionRes.data.session?.user.email ?? "";

  return (
    <div className="mx-auto w-full max-w-[640px] space-y-6">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Your profile</h1>
        <p className="mt-1 text-mute">The board uses this to reach you.</p>
      </div>

      <Card title="Your name and email">
        <dl className="divide-y divide-line">
          <div className="py-2">
            <dt className="text-[11px] text-mute">Name</dt>
            <dd className="break-words text-[15px] text-ink">{viewer.fullName || "Not on file"}</dd>
          </div>
          <div className="py-2">
            <dt className="text-[11px] text-mute">Email</dt>
            <dd className="break-all text-[15px] text-ink">{email || "Not on file"}</dd>
          </div>
        </dl>
        <p className="mt-2 text-[12px] text-mute">To change your name or email, ask {viewer.boardContact.name ?? "the board"}.</p>
      </Card>

      <Card title="How to reach you">
        <ProfileForm phone={person?.phone ?? ""} mailingAddress={person?.mailing_address ?? ""} />
      </Card>

      {units.length > 0 ? (
        <Card title="Your units">
          <ul className="divide-y divide-line">
            {units.map((u) => (
              <li key={u.id}>
                <Link href={`/owner/statement/${u.id}`} className="flex min-h-[48px] items-center justify-between text-[14px] text-ink">
                  <span className="font-medium">{u.label}</span>
                  <span className="text-[13px] text-mute underline underline-offset-2">Statement</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <EmailPreferencesSlot />

      <Card title="Your data">
        <p className="text-[13px] leading-relaxed text-ink">
          Your name, email, phone and mailing address are kept while you own a unit or have access. To have them removed, ask the board, or write to{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-2">
            {SUPPORT_EMAIL}
          </a>
          . See the{" "}
          <Link href="/privacy" className="underline underline-offset-2">
            Privacy Policy
          </Link>
          .
        </p>
      </Card>
    </div>
  );
}
