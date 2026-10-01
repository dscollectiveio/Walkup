import type { Metadata } from "next";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./login/actions";
import Link from "next/link";
import { Sidebar } from "@/components/sidebar/sidebar";

export const metadata: Metadata = {
  title: "Walkup",
  description:
    "Accounting and compliance for self-managed condominium associations",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();

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

  let associationName: string | null = null;
  let uncategorizedCount = 0;

  if (user) {
    // Lightweight queries the sidebar needs on every page: the association
    // name for the lockup, and how many bank transactions still need a
    // category (RLS hides these from owners, so their count is simply 0).
    const [{ data: associations }, { count: needsCount }] = await Promise.all([
      supabase.from("associations").select("display_name").limit(1),
      supabase
        .from("bank_transactions")
        .select("id", { count: "exact", head: true })
        .is("posting_kind", null)
        .is("journal_entry_id", null)
        .is("excluded_at", null)
        .is("removed_at", null)
        .eq("pending", false),
    ]);
    associationName = associations?.[0]?.display_name ?? null;
    uncategorizedCount = needsCount ?? 0;
  }

  return (
    <html lang="en">
      <body className="min-h-screen bg-bone text-ink antialiased">
        {user ? (
          <Sidebar
            associationName={associationName}
            uncategorizedCount={uncategorizedCount}
            userEmail={user.email ?? ""}
            signOutAction={signOut}
          />
        ) : null}

        <div className={user ? "min-h-screen min-[900px]:pl-[232px] pl-14" : "min-h-screen"}>
          <main className="mx-auto max-w-[1100px] px-6 py-8 min-[900px]:px-8">
            {children}
          </main>

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
        </div>
      </body>
    </html>
  );
}
