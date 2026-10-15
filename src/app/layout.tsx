import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import { SITE_URL } from "@/lib/site-config";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./login/actions";
import Link from "next/link";
import { Sidebar } from "@/components/sidebar/sidebar";
import { AppFrame } from "@/components/app-frame";
import { TopBar } from "@/components/sidebar/top-bar";
import { AppTour } from "@/components/tour/app-tour";
import { tourRoleFrom, type TourRole } from "@/lib/tour/steps";
import { buildingTodayIso } from "@/lib/dates";
import { boardRepairsCount, ownerRepairsCount } from "@/lib/home/repairs-badge";
import { loadRepairsSince } from "@/lib/repairs/page-data";
import { cookies, headers } from "next/headers";

// The brand typeface (Brand Logo Package, "Typography"): used for the
// wordmark and, per Doug, the whole product.
const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "900"],
  variable: "--font-outfit",
  display: "swap",
});

// Applies the saved theme (or the system preference when nothing is saved)
// before first paint, so dark mode never flashes light. Mirrors ThemeToggle.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("walkup.theme");if(t!=="dark"&&t!=="light"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){}})();`;

// The sign-up → Dashboard steps draw their own full-page frame (AuthShell),
// with no sidebar or header even once a session exists.

export const metadata: Metadata = {
  // Makes relative share-image and canonical URLs resolve to the real domain.
  // www is the canonical host: Vercel 308-redirects the bare domain to it.
  metadataBase: new URL(SITE_URL),
  title: "Walkup",
  description:
    "Accounting and compliance for self-managed condominium associations",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const jar = await cookies();
  // walkup.sidebar is the preference; the older "sidebar=collapsed" cookie still counts as the rail.
  const sidebarMode: "expanded" | "rail" =
    jar.get("walkup.sidebar")?.value === "rail" || jar.get("sidebar")?.value === "collapsed" ? "rail" : "expanded";

  // getSession(), not getUser(), deliberately — unlike src/lib/supabase/server.ts's
  // getUser() (used everywhere auth actually gates something), this layout
  // never gates access itself; proxy.ts's middleware already ran a real,
  // network-verified getUser() for this exact request moments ago and would
  // have redirected an invalid session before this layout ever rendered. A
  // second network round-trip here to re-verify what middleware just verified
  // was pure duplicated latency on every single navigation. getSession() reads
  // the already-refreshed cookie locally — no network call — which is safe
  // here specifically because middleware is the real gate, not this display.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  // Whether this page gets the frame is decided in the browser (AppFrame), not
  // here: a server redirect after sign-in renders this layout with the old path.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const showChrome = Boolean(user);

  let associationName: string | null = null;
  let userName: string | null = null;
  let uncategorizedCount = 0;
  let repairsCount = 0;
  let announcementsCount = 0;
  let ownsUnit = false;
  let stateCode: string | null = null;
  let tourRole: TourRole | null = null;

  if (showChrome && user) {
    // Lightweight queries the sidebar needs on every page: the association
    // name for the lockup, and how many bank transactions still need a
    // category (RLS hides these from owners, so their count is simply 0).
    const [{ data: associations }, { count: needsCount }, { data: me }, { data: myGrants }] = await Promise.all([
      supabase.from("associations").select("id, display_name, state_code").limit(1),
      supabase
        .from("bank_transactions")
        .select("id", { count: "exact", head: true })
        .is("posting_kind", null)
        .is("journal_entry_id", null)
        .is("excluded_at", null)
        .is("removed_at", null)
        .eq("pending", false),
      // The signed-in person's own name for the header.
      supabase.from("persons").select("id, full_name").eq("auth_user_id", user.id).limit(1),
      // The person's own active roles, to pick which first-login tour they get.
      supabase
        .from("role_grants")
        .select("role, expires_on, persons!inner(auth_user_id)")
        .eq("persons.auth_user_id", user.id)
        .is("revoked_at", null),
    ]);
    associationName = associations?.[0]?.display_name ?? null;
    stateCode = (associations?.[0]?.state_code as string | undefined) ?? null;
    userName = me?.[0]?.full_name ?? null;
    uncategorizedCount = needsCount ?? 0;
    const today = new Date().toISOString().slice(0, 10);
    tourRole = tourRoleFrom(
      (myGrants ?? []).filter((g) => !g.expires_on || g.expires_on >= today).map((g) => g.role as string),
    );
    const associationId = (associations?.[0]?.id as string | undefined) ?? null;
    if (associationId && tourRole) {
      const [counts, repairs] = await Promise.all([
        loadPortalCounts(supabase, associationId, tourRole),
        loadRepairsCount(supabase, associationId, tourRole, (me?.[0]?.id as string | undefined) ?? null, user.id),
      ]);
      announcementsCount = counts.announcements;
      ownsUnit = counts.ownsUnit;
      repairsCount = repairs;
    }
  }


  return (
    <html
      lang="en"
      data-sidebar={sidebarMode}
      className={outfit.variable}
      suppressHydrationWarning
    >
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-bone text-ink antialiased">
        <AppFrame
          signedIn={Boolean(user)}
          sidebar={
            user ? (
              <Sidebar
            associationName={associationName}
            uncategorizedCount={uncategorizedCount}
            repairsCount={repairsCount}
            announcementsCount={announcementsCount}
            ownsUnit={ownsUnit}
            role={tourRole}
            userEmail={user.email ?? ""}
            initialMode={sidebarMode}
          />
            ) : null
          }
          tour={user ? (<AppTour role={tourRole} stateCode={stateCode} autoStart={!user.user_metadata?.tour_completed_at} />) : null}
          topBar={
            user ? (
              <TopBar
              associationName={associationName}
              userName={userName}
              userEmail={user.email ?? ""}
              signOutAction={signOut}
              role={tourRole}
            />
            ) : null
          }
          footer={
            <footer className="mx-auto max-w-[1100px] px-6 pb-12 text-[11px] leading-relaxed text-mute-soft min-[900px]:px-8">
            <p className="max-w-3xl">
              Walkup is not a tax adviser or a lawyer. The tax numbers here are
              worked out from your own records, but nobody has checked them
              against this year&rsquo;s IRS rules. Have an accountant look before
              you file anything.
            </p>
            <p className="mt-3 space-x-3">
              <Link href="/security" className="underline-offset-2 hover:underline">
                Security
              </Link>
              <Link href="/privacy" className="underline-offset-2 hover:underline">
                Privacy Policy
              </Link>
              <Link href="/policies" className="underline-offset-2 hover:underline">
                More policies
              </Link>
            </p>
          </footer>
          }
        >
          {children}
        </AppFrame>
      </body>
    </html>
  );
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Two small reads for the owner-portal navigation (owner-portal-spec 7.3):
 * how many announcements this person has not opened, and, for staff only,
 * whether they also own a unit (so "My unit" appears). Neither may break the
 * page: before migration 0054 reaches a database the RPC errors, which reads
 * as nothing to show.
 */
async function loadPortalCounts(
  supabase: Supabase,
  associationId: string,
  role: TourRole,
): Promise<{ announcements: number; ownsUnit: boolean }> {
  try {
    const [unread, owned] = await Promise.all([
      supabase.rpc("announcements_unread", { p_association_id: associationId }),
      role === "owner" ? Promise.resolve(null) : supabase.rpc("owned_unit_ids", { assoc: associationId }),
    ]);
    const n = typeof unread.data === "number" && !unread.error ? unread.data : 0;
    const ownsUnit = Array.isArray(owned?.data) && owned.data.length > 0;
    return { announcements: n, ownsUnit };
  } catch (e) {
    console.error("[layout] portal counts", e instanceof Error ? e.name : "unknown");
    return { announcements: 0, ownsUnit: false };
  }
}

/**
 * The Repairs & Upkeep badge (repairs-spec §18.6). Board: urgent and
 * emergency problems, AI-suggested emergencies, new reports since the last
 * visit, overdue upkeep. Owners: updates on their own problems since they
 * last looked, plus fixes waiting for them to confirm. The accountant: 0.
 * Never allowed to break the page: any error reads as nothing to show.
 */
async function loadRepairsCount(
  supabase: Supabase,
  associationId: string,
  role: TourRole,
  myPersonId: string | null,
  userId: string,
): Promise<number> {
  try {
    if (role === "board_admin" || role === "board_member") {
      const [{ data: tickets }, { count: overdueUpkeep }, since] = await Promise.all([
        supabase
          .from("tickets")
          .select(
            "id, status, priority, emergency_kind, created_at, reported_by, ticket_board_details(triage, emergency_suggestion_dismissed_at)",
          )
          .not("status", "in", "(resolved,closed)")
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("upkeep_tasks")
          .select("id", { count: "exact", head: true })
          .eq("is_active", true)
          .lt("next_due_on", buildingTodayIso()),
        loadRepairsSince(supabase, associationId),
      ]);
      type Row = {
        id: string; status: string; priority: string; emergency_kind: string | null; created_at: string; reported_by: string | null;
        ticket_board_details:
          | { triage: { emergency?: unknown; at?: unknown } | null; emergency_suggestion_dismissed_at: string | null }
          | { triage: { emergency?: unknown; at?: unknown } | null; emergency_suggestion_dismissed_at: string | null }[]
          | null;
      };
      return boardRepairsCount({
        tickets: ((tickets ?? []) as unknown as Row[]).map((t) => {
          const d = Array.isArray(t.ticket_board_details) ? t.ticket_board_details[0] : t.ticket_board_details;
          return {
            id: t.id,
            status: t.status,
            priority: t.priority,
            emergency_kind: t.emergency_kind,
            created_at: t.created_at,
            mine: myPersonId !== null && t.reported_by === myPersonId,
            triage_emergency: typeof d?.triage?.emergency === "string" ? d.triage.emergency : null,
            triage_at: typeof d?.triage?.at === "string" ? d.triage.at : null,
            emergency_suggestion_dismissed_at: d?.emergency_suggestion_dismissed_at ?? null,
          };
        }),
        since,
        overdueUpkeep: overdueUpkeep ?? 0,
      });
    }
    if (role === "owner" && myPersonId) {
      const since = (await loadRepairsSince(supabase, associationId)) ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
      const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const [{ data: events }, { data: owned }, { data: fixed }] = await Promise.all([
        supabase
          .from("ticket_events")
          .select("ticket_id, actor_user_id, tickets!inner(reported_by, unit_id)")
          .eq("visible_to_owners", true)
          .gt("created_at", since)
          .limit(200),
        supabase.from("unit_owners").select("unit_id, effective_to").eq("person_id", myPersonId),
        supabase
          .from("tickets")
          .select("id")
          .eq("reported_by", myPersonId)
          .eq("status", "resolved")
          .gt("resolved_at", monthAgo),
      ]);
      const todayIso = buildingTodayIso();
      type EventRow = { ticket_id: string; actor_user_id: string | null; tickets: { reported_by: string | null; unit_id: string | null } | { reported_by: string | null; unit_id: string | null }[] | null };
      return ownerRepairsCount({
        events: ((events ?? []) as unknown as EventRow[])
          .filter((e) => e.actor_user_id !== userId)
          .map((e) => {
            const t = Array.isArray(e.tickets) ? e.tickets[0] : e.tickets;
            return { ticket_id: e.ticket_id, reported_by: t?.reported_by ?? null, unit_id: t?.unit_id ?? null };
          }),
        myPersonId,
        myUnitIds: new Set(
          (owned ?? []).filter((o) => !o.effective_to || (o.effective_to as string) >= todayIso).map((o) => o.unit_id as string),
        ),
        awaitingConfirmation: (fixed ?? []).map((t) => t.id as string),
      });
    }
    return 0;
  } catch (e) {
    console.error("[layout] repairs badge", e instanceof Error ? e.name : "unknown");
    return 0;
  }
}
