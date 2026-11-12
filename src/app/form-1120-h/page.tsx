import Link from "next/link";
import { Lockup } from "@/components/mark";
import { SITE_URL } from "@/lib/site-config";

export const metadata = {
  title: "Form 1120-H for Condo Associations: The 60% and 90% Tests | Walkup",
  description:
    "A plain-English guide to Form 1120-H for small condo associations: who can file, how the 60% income test and 90% expenditure test work, and what counts as taxable income.",
  alternates: { canonical: `${SITE_URL}/form-1120-h` },
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-[15px] font-bold text-ink">{title}</h2>
      <div className="mt-2 space-y-3 text-[13px] leading-relaxed text-mute">{children}</div>
    </section>
  );
}

/**
 * Public explainer for people searching "Form 1120-H". Deliberately states no
 * tax rates or dollar thresholds - those live in `tax_parameters`, and a
 * marketing page must not become a second, stale copy of them.
 *
 * Listed in PUBLIC_PATHS (src/lib/supabase/proxy.ts) and the sitemap.
 */
export default function Form1120HPage() {
  return (
    <div className="mx-auto max-w-2xl py-16">
      <Link href="/">
        <Lockup />
      </Link>

      <h1 className="mt-8 text-[20px] font-bold tracking-tight text-ink">
        Form 1120-H for condo associations
      </h1>
      <p className="mt-1 text-[13px] text-mute">
        A plain-English guide for volunteer board members. This is general information, not tax advice, and Walkup&apos;s
        tax logic has not yet been reviewed by a CPA.
      </p>

      <Section title="What Form 1120-H is">
        <p>
          Form 1120-H is the federal income tax return a condominium association can choose to file instead of the
          regular corporate return. It lets the association exclude the money it collects from owners for running the
          building, and pay tax only on other income, such as interest on reserves.
        </p>
        <p>
          The choice is made each year by filing the form. Your association may do better on the regular return in some
          years, so it is worth comparing the two with a tax professional.
        </p>
      </Section>

      <Section title="The 60% income test">
        <p>
          At least 60% of the association&apos;s gross income for the year must come from owner assessments and other
          membership dues. Walkup measures this from actual cash received, not from what was billed.
        </p>
      </Section>

      <Section title="The 90% expenditure test">
        <p>
          At least 90% of what the association spends must go to maintaining and managing the property. Larger capital
          purchases count toward this whether you expense them or capitalize them.
        </p>
      </Section>

      <Section title="What counts as taxable income">
        <p>
          Income that does not come from owners&apos; assessments is generally taxable. Typical examples are interest
          earned on reserve accounts, laundry or vending income, rent from common areas, and fees from non-members. A
          small specific deduction applies before the tax rate is applied.
        </p>
      </Section>

      <Section title="How Walkup helps">
        <p>
          Walkup tracks every deposit and payment in a proper double-entry ledger, runs both tests from the cash
          movements, and shows you the figures behind each result, not just pass or fail. At year end you get the numbers
          for the return and a clean record for the next board.
        </p>
        <p>
          <Link href="/signup" className="font-semibold text-ink underline">
            Create an account
          </Link>{" "}
          or see <Link href="/features" className="font-semibold text-ink underline">what Walkup does</Link>.
        </p>
      </Section>
    </div>
  );
}
