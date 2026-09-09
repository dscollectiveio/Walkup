import type { Metadata } from "next";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./login/actions";
import { interTight, sourceSerif } from "@/lib/fonts";
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
  let problemCount = 0;

  if (user) {
    // Two lightweight queries the sidebar needs on every page: the
    // association name for the lockup, and a live count of open problems for
    // the Problems badge. Same "open" definition contractors/page.tsx uses.
    const [{ data: associations }, { count }] = await Promise.all([
      supabase.from("associations").select("display_name").limit(1),
      supabase
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .not("status", "in", '("resolved","closed")'),
    ]);
    associationName = associations?.[0]?.display_name ?? null;
    problemCount = count ?? 0;
  }

  return (
    <html lang="en" className={`${interTight.variable} ${sourceSerif.variable}`}>
      <body className="min-h-screen bg-bone text-ink antialiased">
        {user ? (
          <Sidebar
            associationName={associationName}
            problemCount={problemCount}
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
          </footer>
        </div>
      </body>
    </html>
  );
}
