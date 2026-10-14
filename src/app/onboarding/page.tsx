import { redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { AuthShell } from "@/components/auth/auth-shell";
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
    <AuthShell
      step={2}
      title="Set up your building"
      subtitle="You'll be the board admin — you can add units, owners and the rest of the board once you're in."
      aside={{
        heading: "Last step — then you're in.",
        body: "Walkup sets up your fiscal year, operating and reserve funds, and a chart of accounts for you. Your Dashboard will walk you through the rest, one step at a time.",
      }}
    >
      <CreateBuildingForm />
    </AuthShell>
  );
}
