import type { Metadata } from "next";
import Link from "next/link";
import { Lockup } from "@/components/mark";
import { FeaturesExplorer } from "@/components/features/features-explorer";
import { CATEGORIES } from "@/lib/features/catalog";
import { CONTACT_EMAIL, SITE_URL, copyrightHolder } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Features | Walkup",
  description:
    "Every Walkup feature for self-managed condo associations: bank feed and bookkeeping, budgets and financial statements, HOA dues and reminders, tax prep, insurance, repairs, contractors and documents.",
  alternates: { canonical: `${SITE_URL}/features` },
};

/**
 * The full features page, public. Brings its own header and footer (listed in
 * BARE_PATHS and PUBLIC_PATHS), in the same look as the home page.
 */
export default function FeaturesPage() {
  return (
    <div className="bg-bone text-ink">
      <header className="sticky top-0 z-40 border-b border-white/25 bg-[#1B2A41] text-white shadow-[0_1px_0_rgba(0,0,0,0.25)]">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between px-6 py-4">
          <Link href="/" aria-label="Walkup home">
            <Lockup onDark size={34} />
          </Link>
          <nav aria-label="Site" className="flex items-center gap-1 text-[14px]">
            <Link href="/" className="hidden rounded-md px-3 py-2 text-white/80 hover:text-white sm:inline-block">Home</Link>
            <Link href="/#pricing" className="hidden rounded-md px-3 py-2 text-white/80 hover:text-white sm:inline-block">Pricing</Link>
            <Link href="/#faq" className="hidden rounded-md px-3 py-2 text-white/80 hover:text-white md:inline-block">FAQ</Link>
            <Link href="/login" className="rounded-md px-3 py-2 font-medium text-white hover:bg-white/10">Sign in</Link>
            <Link href="/signup" data-cta="features-header" className="ml-1 hidden rounded-md bg-[#D9A441] px-3.5 py-2 font-bold text-[#1B2A41] hover:bg-[#E4B75B] sm:inline-block">
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <FeaturesExplorer categories={CATEGORIES} />

      <footer className="land-blue text-[13px]">
        <div className="mx-auto max-w-[1100px] px-6 pb-10">
          <div className="flex flex-col gap-6 border-t border-line pt-8 md:flex-row md:items-start md:justify-between">
            <p className="max-w-md leading-relaxed text-mute">
              Walkup is software for self-managed condominium associations in Illinois. Walkup never holds association funds and is
              not a tax adviser or a lawyer.
            </p>
            <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2 text-mute">
              <Link href="/" className="hover:text-ink hover:underline">Home</Link>
              <Link href="/security" className="hover:text-ink hover:underline">Security</Link>
              <Link href="/privacy" className="hover:text-ink hover:underline">Privacy Policy</Link>
              <Link href="/terms" className="hover:text-ink hover:underline">Terms of Service</Link>
              <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-ink hover:underline">Contact</a>
            </nav>
          </div>
          <p className="mt-6 text-[12px] text-mute">© 2026 {copyrightHolder}</p>
        </div>
      </footer>
    </div>
  );
}
