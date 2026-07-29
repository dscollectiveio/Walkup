import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { DEV_USERS, getCurrentUser } from "@/lib/session";
import { switchDevUser } from "./actions";

export const metadata: Metadata = {
  title: "Walkup",
  description:
    "Accounting and compliance for self-managed condominium associations",
};

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/delinquency", label: "Delinquency" },
  { href: "/ledger", label: "Ledger" },
  { href: "/tax", label: "Form 1120-H" },
];

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();

  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">
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

            {/* Development identity switcher. Not an auth system — it trusts a
                cookie. It exists so the RLS policies can be exercised through
                the UI. See src/lib/session.ts. */}
            <form action={switchDevUser} className="ml-auto flex items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-stone-400">
                Viewing as
              </span>
              <select
                name="userId"
                // key forces a remount when the identity changes; without it
                // React keeps the uncontrolled DOM value and the dropdown
                // shows the previous user after switching.
                key={user.id}
                defaultValue={user.id}
                className="rounded border border-stone-300 bg-white px-2 py-1 text-sm"
              >
                {DEV_USERS.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} — {u.role}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded bg-stone-900 px-3 py-1 text-sm text-white transition hover:bg-stone-700"
              >
                Switch
              </button>
            </form>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>

        <footer className="mx-auto max-w-6xl px-6 pb-12 text-xs leading-relaxed text-stone-500">
          <p className="max-w-3xl">
            Walkup does not provide tax or legal advice. Every figure here is
            provisional and has not been reviewed by a CPA against current-year
            IRS instructions. Do not file anything on the basis of what you see
            here without professional review.
          </p>
        </footer>
      </body>
    </html>
  );
}
