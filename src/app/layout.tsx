import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getUser } from "@/lib/supabase/server";
import { signOut } from "./login/actions";
import { interTight, sourceSerif } from "@/lib/fonts";
import { Lockup } from "@/components/mark";
import { NavLink } from "@/components/nav-link";

export const metadata: Metadata = {
  title: "Walkup",
  description:
    "Accounting and compliance for self-managed condominium associations",
};

// Plain words, not accounting vocabulary. The user is a board member doing
// this unpaid in the evenings, not a bookkeeper. The technical terms still
// appear inside each page, next to the plain ones, because the accountant and
// the next board need them.
const NAV = [
  { href: "/", label: "Home" },
  { href: "/maintenance", label: "Problems" },
  { href: "/delinquency", label: "Who owes" },
  { href: "/bills", label: "Bills" },
  { href: "/contractors", label: "Contractors" },
  { href: "/insurance", label: "Insurance" },
  { href: "/documents", label: "Documents" },
  { href: "/budget", label: "Budget" },
  { href: "/1099", label: "1099s" },
  { href: "/tax", label: "Tax filing" },
  { href: "/ledger", label: "All transactions" },
];

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getUser();

  return (
    <html lang="en" className={`${interTight.variable} ${sourceSerif.variable}`}>
      <body className="min-h-screen bg-bone text-ink antialiased">
        {user ? (
          <header className="bg-ink">
            <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-x-8 gap-y-3 px-6 py-4">
              <Link href="/" aria-label="Walkup home">
                <Lockup dark />
              </Link>
              <nav className="flex flex-wrap gap-x-6 gap-y-2">
                {NAV.map((item) => (
                  <NavLink key={item.href} href={item.href} label={item.label} />
                ))}
              </nav>
              <form action={signOut} className="ml-auto flex items-center gap-3">
                <span className="text-[11px] text-ondark-mute">{user.email}</span>
                <button
                  type="submit"
                  className="rounded-md border border-ink-mid px-3 py-1 text-[12px] font-medium text-paper transition hover:bg-ink-mid"
                >
                  Sign out
                </button>
              </form>
            </div>
          </header>
        ) : null}

        <main className="mx-auto max-w-[1100px] px-6 py-10">{children}</main>

        <footer className="mx-auto max-w-[1100px] px-6 pb-12 text-[11px] leading-relaxed text-mute">
          <p className="max-w-3xl">
            Walkup is not a tax adviser or a lawyer. The tax numbers here are
            worked out from your own records, but nobody has checked them
            against this year&rsquo;s IRS rules. Have an accountant look before
            you file anything.
          </p>
        </footer>
      </body>
    </html>
  );
}
