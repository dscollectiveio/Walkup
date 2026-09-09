import { redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { Lockup } from "@/components/mark";
import { CreateBuildingForm } from "./create-building-form";

export const dynamic = "force-dynamic";

/**
 * Reached only by a signed-in, MFA-verified session with no persons row
 * anywhere — proxy.ts routes here automatically. Self-redirects home if that
 * stops being true, same pattern account/mfa/page.tsx already uses for "the
 * thing this page exists to fix no longer applies."
 */
export default async function OnboardingPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("persons")
    .select("id")
    .eq("auth_user_id", user.id)
    .limit(1);
  if (existing && existing.length > 0) redirect("/");

  return (
    <div className="mx-auto max-w-sm py-16">
      <Lockup />
      <h1 className="mt-4 text-[20px] font-semibold tracking-tight text-ink">
        Set up your building
      </h1>
      <p className="mt-2 text-mute">
        You&rsquo;ll be the board admin — you can add everyone else once
        you&rsquo;re in.
      </p>

      <CreateBuildingForm />
    </div>
  );
}
