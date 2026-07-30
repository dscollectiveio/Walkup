import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getUser } from "@/lib/supabase/server";
import { signOut } from "./login/actions";

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
  { href: "/delinquency", label: "Who owes" },
  { href: "/tax", label: "Tax filing" },
  { href: "/ledger", label: "All transactions" },
];

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getUser();

  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">
        {user ? (
          <header className="border-b border-stone-200 bg-white">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-3 px-6 py-4">
              <Link href="/" className="text-lg font-semibold tracking-tight">
                Walkup
              </Link>
              <nav className="flex gap-6 text-sm">
                {NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="text-stone-600 transition hover:text-stone-900"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <form action={signOut} className="ml-auto flex items-center gap-3">
                <span className="text-xs text-stone-500">{user.email}</span>
                <button
                  type="submit"
                  className="rounded border border-stone-300 px-3 py-1 text-sm transition hover:bg-stone-100"
                >
                  Sign out
                </button>
              </form>
            </div>
          </header>
        ) : null}

        <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>

        <footer className="mx-auto max-w-6xl px-6 pb-12 text-xs leading-relaxed text-stone-500">
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
