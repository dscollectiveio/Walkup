import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ViewerUnavailable } from "@/components/owner/viewer-unavailable";
import { getViewer } from "@/lib/owner/viewer";
import { loadOwnedUnits, loadSummary } from "@/lib/owner/load";
import { buildingTodayIso } from "@/lib/dates";
import { getBilling } from "@/lib/billing/entitlement";
import { billingNotice } from "@/lib/billing/copy";
import { SUPPORT_EMAIL } from "@/lib/site-config";
import { AccountTabs, tabFor, visibleTabs, type AccountTab } from "./account-tabs";
import { ProfileTab } from "./sections/profile-tab";
import { UnitsTab } from "./sections/units-tab";
import { SecurityTab } from "./sections/security-tab";
import { BillingTab } from "./sections/billing-tab";
import { NotificationsTab } from "./sections/notifications-tab";
import { PrivacyTab } from "./sections/privacy-tab";
import { Pill, ROLE_WORDS, initialsOf } from "./sections/shared";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your account" };

/**
 * Your account, for every role (reached from the profile circle at the top
 * right): who you are here and what you can do, your units, sign-in and
 * security, Walkup's plan (board only), notifications, and your data. Each tab
 * is its own URL and loads only what it shows.
 */
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ tab?: string; checkout?: string }> }) {
  const sp = await searchParams;
  const viewer = await getViewer();
  if (!viewer) return <ViewerUnavailable />;
  const supabase = await createClient();

  const [claimsRes, ownedUnits, billing] = await Promise.all([
    supabase.auth.getClaims(),
    loadOwnedUnits(supabase, viewer),
    viewer.isBoard ? getBilling(viewer.associationId) : Promise.resolve(null),
  ]);
  const email = typeof claimsRes.data?.claims?.email === "string" ? claimsRes.data.claims.email : "";
  const tabs = visibleTabs({ ownsUnits: ownedUnits.length > 0, isBoard: viewer.isBoard });
  const tab = tabFor(sp.tab, tabs);
  const notice = billing ? billingNotice(billing.facts, billing.entitlement) : null;
  const flags: Partial<Record<AccountTab, string>> = notice ? { billing: "needs attention" } : {};

  return (
    <div className="mx-auto w-full max-w-[860px] space-y-6">
      <header className="flex flex-wrap items-center gap-4">
        <span
          aria-hidden
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-brass text-[22px] font-bold text-on-brass ring-4 ring-brass/20"
        >
          {initialsOf(viewer.fullName, email)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-bold tracking-tight text-ink">{viewer.fullName || "Your account"}</h1>
          <p className="break-all text-[13px] text-mute">
            {email}
            {email ? " · " : ""}
            {viewer.associationName}
          </p>
          {viewer.roles.length > 0 ? (
            <p className="mt-2 flex flex-wrap gap-1.5">
              {viewer.roles.map((r) => (
                <Pill key={r} tone={r === "owner" ? "neutral" : "brand"}>
                  {ROLE_WORDS[r].name}
                </Pill>
              ))}
            </p>
          ) : null}
        </div>
        <a
          href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Help with my Walkup account")}`}
          className="text-[13px] font-medium text-ink underline decoration-line-strong underline-offset-4 transition-colors duration-300 hover:decoration-ink"
        >
          Get help
        </a>
      </header>

      <AccountTabs active={tab} tabs={tabs} flags={flags} />

      <div className="space-y-6">{await renderTab(tab)}</div>
    </div>
  );

  async function renderTab(t: AccountTab) {
    switch (t) {
      case "units": {
        const today = buildingTodayIso();
        const summaries = await Promise.all(ownedUnits.map((u) => loadSummary(supabase, u.id, today)));
        return <UnitsTab units={ownedUnits} summaries={summaries} todayIso={today} />;
      }
      case "security": {
        const [factorsRes, userRes, recoveryRes] = await Promise.all([
          supabase.auth.mfa.listFactors(),
          supabase.auth.getUser(),
          supabase.rpc("mfa_recovery_status"),
        ]);
        const rec = (recoveryRes.data ?? {}) as { total?: number; remaining?: number };
        const totp = factorsRes.data?.all.find((f) => f.factor_type === "totp" && f.status === "verified") ?? null;
        return <SecurityTab totpSince={totp?.created_at ?? null} lastSignIn={userRes.data.user?.last_sign_in_at ?? null} recovery={{ remaining: Number(rec.remaining ?? 0), total: Number(rec.total ?? 0) }} />;
      }
      case "billing":
        return <BillingTab viewer={viewer!} view={billing} checkout={sp.checkout} />;
      case "notifications":
        return <NotificationsTab />;
      case "privacy":
        return <PrivacyTab viewer={viewer!} />;
      default: {
        // Your own phone and address, from person_contact_details (0082): you may always read your own row.
        const { data } = await supabase.from("person_contact_details").select("phone, mailing_address").eq("person_id", viewer!.personId).limit(1);
        const person = data?.[0] as { phone: string | null; mailing_address: string | null } | undefined;
        return <ProfileTab viewer={viewer!} email={email} phone={person?.phone ?? ""} mailingAddress={person?.mailing_address ?? ""} />;
      }
    }
  }
}
