import Image from "next/image";
import Link from "next/link";
import { ArrowDown, Building2, Lock, Sparkles, Download, FileCheck, FileText, HandCoins, HardHat, Eye, KeyRound, Landmark, ListChecks, MailCheck, ShieldCheck, Wrench } from "lucide-react";
import { Lockup, WalkupMark } from "@/components/mark";
import {
  ANNUAL_NOTE,
  CONTACT_EMAIL,
  DUES_PAYMENTS_ENABLED,
  FAQ,
  FOUNDING,
  PLANS,
  SITE_DESCRIPTION,
  SITE_URL,
  TESTIMONIAL,
  bookingHref,
  copyrightHolder,
  type FaqGroup,
} from "@/lib/site-config";
import { WaitlistForm } from "./waitlist-form";
import { HeroSlideshow } from "./hero-slideshow";
import { ProblemSection } from "./problem-section";
import { Reveal } from "./reveal";
import { HowItWorksTimeline } from "./how-it-works-timeline";
import { FeatureArt, type FeatureArtKind } from "./feature-art";
import { pricingWords } from "@/lib/billing/launch";

/**
 * The public home page at "/" for anyone not signed in. Signed-in people get
 * the Dashboard at the same URL (src/app/page.tsx decides).
 *
 * Copy follows "Walkup Landing Page Copy v2" (Oct 2026): every section opens
 * with a heading that answers a question or states a benefit, then one
 * sentence that makes sense on its own, so search and AI tools can quote it.
 * Always say "Walkup, software for self-managed condo associations"; never
 * vary the category name.
 *
 * Every claim here has to be true of the app as it ships today: read-only
 * bank access, nothing sent automatically, no tax advice, Illinois only.
 * Prices, contact details and the FAQ live in src/lib/site-config.ts; the
 * comparison figures are Doug's, cited as he cites them. No testimonials
 * until there are real ones. No em dashes in anything a visitor reads. The navy bands use the fixed brand navy (not the `ink` token,
 * which flips in dark mode) so the hero reads the same in both themes.
 *
 * Every "Try Walkup Free" button (the last one reads "Set Up Your Building in Minutes") goes to /signup and carries a
 * data-cta naming its section, to see which one converts.
 */

const NAVY = "bg-[#1B2A41]";
const CTA = "Try Walkup Free";
const CTA_HERO = "Try Walkup free";
const CTA_FINAL = "Set Up Your Building in Minutes";

const primaryBtn =
  "inline-flex min-h-[48px] items-center justify-center rounded-md bg-brass px-6 text-[15px] font-bold text-on-brass transition-colors hover:bg-[#E4B75B] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
const ghostBtn =
  "inline-flex min-h-[48px] items-center justify-center rounded-md border border-line-strong px-6 text-[15px] font-semibold text-ink transition-colors hover:bg-fill";
// Navy on light, cream on dark: the app's own primary button, so it never sinks into a dark section.
const navyBtn =
  "inline-flex min-h-[48px] items-center rounded-md bg-ink px-6 text-[15px] font-semibold text-paper hover:bg-ink-mid";

const FEATURE_ICONS: Record<FeatureArtKind, typeof Landmark> = {
  finance: Landmark,
  dues: HandCoins,
  tax: FileText,
  insurance: ShieldCheck,
  repairs: Wrench,
  contractor: HardHat,
};

const FEATURES: { art: FeatureArtKind; title: string; body: string }[] = [
  {
    art: "finance",
    title: "Financial Management",
    body: "Your bank feed, budget and financial statements in one place. Transactions arrive sorted, spending is tracked against the budget, and board-ready reports are one click.",
  },
  {
    art: "dues",
    title: "HOA Dues and Reminders",
    body: "Set each unit's dues once. Walkup matches deposits, shows who's behind, and prepares reminders that go out only after a board admin approves.",
  },
  {
    art: "tax",
    title: "Tax Prep Support",
    body: "Checks whether you qualify for Form 1120-H, fills the IRS form from your books, tracks contractor 1099s, and puts every deadline on your calendar.",
  },
  {
    art: "insurance",
    title: "Insurance Marketplace",
    body: "Keep every policy and renewal in one place, run a coverage check, and request quotes from agents with emails drafted for you.",
  },
  {
    art: "repairs",
    title: "Repairs Tracking",
    body: "Anyone in the building can report a problem. Follow each repair from report to done, and run yearly upkeep on a schedule.",
  },
  {
    art: "contractor",
    title: "Find a Contractor",
    body: "Search for nearby contractors for the job, keep the ones you use with their W-9s and insurance on file, and ask for a quote by email.",
  },
];

const FAQ_GROUPS: FaqGroup[] = ["For treasurers", "About Walkup", "Data and security"];

function SectionHeading({ eyebrow, title, intro }: { eyebrow: string; title: string; intro?: string }) {
  return (
    <div className="max-w-2xl">
      <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-eyebrow">{eyebrow}</p>
      <h2 className="mt-2 text-[28px] font-bold leading-tight tracking-tight text-ink sm:text-[32px]">{title}</h2>
      {intro ? <p className="mt-3 text-[16px] leading-relaxed text-mute">{intro}</p> : null}
    </div>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="mt-[3px] h-4 w-4 shrink-0 text-good-text">
      <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Search-engine structured data, generated from the same plans and FAQ the page shows. */
function StructuredData({ nonce }: { nonce?: string }) {
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: "Walkup",
        url: SITE_URL,
        logo: `${SITE_URL}/icon-512.png`,
        email: CONTACT_EMAIL,
      },
      {
        "@type": "SoftwareApplication",
        name: "Walkup",
        url: SITE_URL,
        description: SITE_DESCRIPTION,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        publisher: { "@id": `${SITE_URL}/#organization` },
        offers: PLANS.map((p) => ({
          "@type": "Offer",
          name: `${p.name} (${p.units})`,
          price: String(p.month),
          priceCurrency: "USD",
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            price: String(p.month),
            priceCurrency: "USD",
            unitText: "MONTH",
          },
        })),
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQ.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };
  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      // Static, server-built JSON; "<" escaped so nothing in it can close the tag.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}

export function Landing({ nonce }: { nonce?: string }) {
  // Early-access wording until paid plans are really live (lib/billing/launch).
  const words = pricingWords();
  return (
    <div data-theme="light" data-force-light className="landing-smooth bg-bone text-ink">
      <StructuredData nonce={nonce} />
      {/* ---------------------------------------------------------------- header */}
      <header className={`${NAVY} sticky top-0 z-40 border-b border-white/25 shadow-[0_1px_0_rgba(0,0,0,0.25)] text-white`}>
        <div className="mx-auto flex max-w-[1280px] items-center justify-between px-4 py-3 sm:px-5">
          <Link href="/" aria-label="Walkup home">
            <Lockup onDark size={34} />
          </Link>
          <nav aria-label="Site" className="flex items-center gap-1 text-[14px]">
            <a href="#features" className="hidden rounded-md px-3 py-2 text-white/80 hover:text-white sm:inline-block">Features</a>
            <a href="#pricing" className="hidden rounded-md px-3 py-2 text-white/80 hover:text-white sm:inline-block">Pricing</a>
            <a href="#faq" className="hidden rounded-md px-3 py-2 text-white/80 hover:text-white md:inline-block">FAQ</a>
            <Link href="/login" className="inline-flex min-h-[44px] items-center rounded-md px-3 font-medium text-white hover:bg-white/10">Sign in</Link>
            <Link href="/signup" data-cta="header" className="ml-1 inline-flex min-h-[40px] items-center rounded-md bg-brass px-3 py-2 font-bold text-on-brass hover:bg-[#E4B75B] sm:inline-block sm:min-h-0 sm:px-3.5">
              <span className="sm:hidden">Sign up</span>
              <span className="hidden sm:inline">{CTA_HERO}</span>
            </Link>
          </nav>
        </div>
      </header>

      {/* ---------------------------------------------------------------- hero */}
      <section id="hero" className="land-taupe relative flex min-h-[calc(100svh-4.3rem)] items-stretch overflow-hidden">
        {/* The mark, large and faint at the top right, behind the screen window. Kept clear of the text. */}
        <WalkupMark
          variant="bare"
          background="var(--w-land-taupe)"
          size={340}
          title=""
          className="pointer-events-none absolute -right-20 -top-16 hidden opacity-[0.1] lg:block"
        />
        <div className="relative mx-auto grid w-full max-w-[1280px] items-start gap-8 px-4 pb-12 pt-8 sm:px-5 grid-cols-[minmax(0,1fr)] lg:grid-cols-[1.1fr_1fr] lg:gap-10 lg:pb-16 lg:pt-12">
          <div className="lg:self-center">
            <p className="inline-flex rounded-full bg-[#1B2A41] px-3.5 py-1.5 text-[12px] font-medium text-white">
              Built for self-managed Illinois condo associations
            </p>
            <h1 className="mt-5 text-[34px] font-bold leading-[1.08] tracking-tight sm:text-[42px] xl:text-[46px]">
              Run your condo HOA in{" "}
              <span className="underline decoration-brass decoration-[5px] underline-offset-[7px]">15 minutes</span> a month.
              <span className="mt-2 block text-[0.62em] font-medium leading-snug tracking-normal text-mute">Without missing a deadline.</span>
            </h1>
            <p className="mt-5 max-w-xl text-[18px] leading-relaxed text-ink">
              Manage dues, bills, budgets, taxes, and records in one place your whole board can see.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link href="/signup" data-cta="hero" className={`${primaryBtn} w-full sm:w-auto`}>
                {CTA_HERO}
              </Link>
              <a href="#how-it-works" className={`${ghostBtn} w-full gap-2 sm:w-auto`}>
                See how it works
                <ArrowDown size={16} strokeWidth={2.2} aria-hidden="true" className="animate-bounce motion-reduce:animate-none" />
              </a>
            </div>
            <ul aria-label="What to know before you start" className="mt-5 grid max-w-xl gap-x-6 gap-y-2 text-[14px] text-mute sm:grid-cols-2">
              {[
                [Lock, "Read-only bank access"],
                [MailCheck, "Board approves every message"],
                [Sparkles, `First ${FOUNDING.associations} boards are free for life`],
                [Download, "Export anytime"],
                [Building2, "Built by a Chicago condo board president"],
              ].map(([Icon, label]) => {
                const TrustIcon = Icon as typeof Lock;
                return (
                  <li key={label as string} className="flex items-center gap-2">
                    <TrustIcon aria-hidden="true" size={16} strokeWidth={1.7} className="shrink-0" />
                    {label as string}
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="min-w-0 lg:w-full lg:max-w-[640px] lg:justify-self-end lg:self-center">
            <HeroSlideshow />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- problem */}
      <ProblemSection />

      {/* ---------------------------------------------------------------- features */}
      <Reveal id="features" tone="taupe">
        <div className="mx-auto max-w-[1280px] px-4 py-14 sm:px-5">
          <SectionHeading
            eyebrow="What Walkup does"
            title="HOA bookkeeping software that does the busywork for you"
            intro="Walkup handles the books, dues, budget, financial statements and taxes for small condo associations, in one place the whole board can see. Every plan includes every feature and unlimited board seats."
          />
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <article key={f.title} className="group flex flex-col rounded-xl border border-line bg-paper p-5">
                <FeatureArt kind={f.art} />
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[17px] font-bold text-ink">{f.title}</h3>
                  <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brass/15 text-eyebrow transition-colors duration-300 group-hover:bg-brass group-hover:text-on-brass">
                    {(() => {
                      const Icon = FEATURE_ICONS[f.art];
                      return <Icon size={18} strokeWidth={1.8} />;
                    })()}
                  </span>
                </div>
                <p className="mt-1.5 text-[14px] leading-relaxed text-mute">{f.body}</p>
              </article>
            ))}
          </div>
          <div className="mt-8 grid gap-3 border-t border-line pt-8 md:grid-cols-2" aria-label="Sample year-end output">
            <article className="rounded-xl border border-line bg-paper p-4">
              <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-eyebrow">Sample: your tax summary</p>
              <h3 className="mt-1 text-[17px] font-bold text-ink">Form 1120-H, with the numbers shown</h3>
              <dl className="mt-2 divide-y divide-line text-[15px]">
                {[
                  ["Income from members (60% test)", "94%, passes"],
                  ["Spent on the building (90% test)", "97%, passes"],
                  ["Other income, like interest", "$412"],
                  ["Tax owed", "$0"],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-3 py-1.5">
                    <dt className="text-mute">{k}</dt>
                    <dd className="font-semibold text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </article>
            <article className="rounded-xl border border-line bg-paper p-4">
              <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-eyebrow">Sample: your handoff packet</p>
              <h3 className="mt-1 text-[17px] font-bold text-ink">Everything the next board needs</h3>
              <ul className="mt-2 space-y-2 text-[15px] text-mute">
                {["Year-end financial statements", "Who owes what, by unit", "Insurance, vendors and W-9s on file", "This year's filed tax return"].map((t) => (
                  <li key={t} className="flex items-start gap-2">
                    <Check />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </article>
            <p className="text-[12px] text-mute md:col-span-2">
              Made-up numbers for illustration. Tax figures are provisional until your accountant reviews them.
            </p>
          </div>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link href="/signup" data-cta="features" className={navyBtn}>
              {CTA}
            </Link>
            <Link
              href="/features"
              data-cta="features-more"
              className="inline-flex min-h-[48px] items-center gap-2 rounded-md border border-line-strong px-6 text-[15px] font-semibold text-ink transition-colors hover:bg-fill"
            >
              See All Features
              <span aria-hidden="true">&rarr;</span>
            </Link>
          </div>
        </div>
      </Reveal>

      {/* ---------------------------------------------------------------- how it works */}
      <Reveal id="how-it-works" tone="white">
        <div className="mx-auto max-w-[1280px] px-4 py-14 sm:px-5 overflow-x-clip">
        <SectionHeading
          eyebrow="How it works"
          title="How long does it take to set up Walkup?"
          intro="About an afternoon. After that, most treasurers spend around 15 minutes a month."
        />
        <HowItWorksTimeline />
        <div aria-hidden="true" className="mt-14 h-px bg-gradient-to-r from-transparent via-line-strong/60 to-transparent" />
        <div className="mt-14 rounded-xl border border-line bg-paper p-6">
          <h3 className="text-[16px] font-bold text-ink">Your 15 minutes a month</h3>
          <ul className="mt-3 space-y-2 text-[14px] text-ink">
            {["Approve the transactions Walkup sorted", "Approve the dues reminders and the financial report email it prepared", "Send the quote requests it drafted for contractors and insurance", "Read one sentence on the budget"].map((x) => (
              <li key={x} className="flex gap-2">
                <Check />
                <span>{x}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-6 text-[15px] text-mute">
          Want a hand? A Walkup team member will set up your board with you on one 15-minute call, free.
        </p>
        <div className="mt-6">
          <Link href="/signup" data-cta="how-it-works" className={navyBtn}>
            {CTA}
          </Link>
        </div>
        </div>
      </Reveal>

      {/* ---------------------------------------------------------------- founder */}
      <Reveal tone="blue">
        <div className="mx-auto max-w-[1280px] px-4 py-14 sm:px-5">
          <div className="grid items-center gap-10 md:grid-cols-[1fr_260px] md:gap-12 lg:grid-cols-[1fr_290px]">
          <div className="max-w-2xl">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-eyebrow">Why Walkup exists</p>
            <h2 className="mt-2 text-[28px] font-bold leading-tight tracking-tight text-ink sm:text-[32px]">
              Built by a volunteer condo board president in Chicago
            </h2>
            <div className="mt-4 space-y-4 text-[17px] leading-relaxed text-mute">
              <p>
                I&rsquo;m the board president of a small self-managed condo building in Chicago. For years our association
                ran the way most do: a spreadsheet, a stack of Zelle notifications, and a shared folder only one person
                understood.
              </p>
              <p>
                Every tax season meant a scramble. Every time a neighbor fell behind, it meant an awkward conversation. And
                I kept thinking about what would happen if I sold my unit and handed all of it to someone new.
              </p>
              <p>
                The software out there was built for 200-unit communities and property managers. So I built Walkup for
                buildings like ours: small, self-run, and tired of the spreadsheet.
              </p>
            </div>
            <p className="mt-6 text-[15px] font-semibold text-ink">
              <span aria-hidden="true">&ndash; </span>Doug Smart, founder of Walkup and condo board president
            </p>
          </div>
          <figure className="mx-auto flex w-full max-w-[290px] flex-col items-center text-center md:mx-0">
            {/* Round photo with one offset circle behind it, like the timeline's rectangles. */}
            <div className="relative h-[230px] w-[230px] sm:h-[250px] sm:w-[250px]">
              <span aria-hidden="true" className="absolute inset-0 translate-x-[18px] translate-y-[16px] rounded-full bg-brass" />
              <Image
                src="/doug-smart.jpg"
                alt="Doug Smart, founder of Walkup, smiling in front of the Chicago skyline at sunset"
                width={896}
                height={1200}
                sizes="250px"
                className="relative h-full w-full rounded-full object-cover object-[50%_18%] ring-4 ring-[#1B2A41]"
              />
            </div>
            <figcaption className="mt-7">
              <span className="block text-[17px] font-bold text-ink">Doug Smart</span>
              <span className="mt-0.5 block text-[13px] leading-snug text-mute">Founder, and a condo board president in Chicago</span>
            </figcaption>
          </figure>
          </div>
          {TESTIMONIAL ? (
            <figure className="mt-12 max-w-2xl rounded-xl border border-line bg-bone p-6">
              <blockquote className="text-[17px] leading-relaxed text-ink">&ldquo;{TESTIMONIAL.quote}&rdquo;</blockquote>
              <figcaption className="mt-3 text-[14px] text-mute">
                {TESTIMONIAL.name}, {TESTIMONIAL.role}
              </figcaption>
            </figure>
          ) : null}
        </div>
      </Reveal>

      {/* ---------------------------------------------------------------- trust */}
      <Reveal tone="taupe">
        <div className="mx-auto max-w-[1280px] px-4 py-10 sm:px-5">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-eyebrow">Built to be trusted with money</p>
          <h2 className="mt-2 max-w-2xl text-[28px] font-bold leading-tight tracking-tight text-ink sm:text-[32px]">
            How does Walkup protect our association&rsquo;s money?
          </h2>
          <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-mute">
            Walkup records, reminds and prepares. Your board stays in control of every dollar and every decision.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              [
                Eye,
                "Never holds your money.",
                DUES_PAYMENTS_ENABLED
                  ? "Owner payments go straight to the association's bank. Walkup never holds funds."
                  : "Bank access is read-only through Plaid. Owners pay the association directly, and you pay bills from your own bank.",
              ],
              [MailCheck, "Never emails anyone without a board admin's approval.", "Reminders and statements go out only after a board admin approves them. Messages to contractors, agents and your accountant open as drafts in your own email app."],
              [KeyRound, "Two-step sign-in on every account.", "Each association's data is walled off from every other, and every change is logged with who made it."],
              [ListChecks, "Every number shows its work.", "Tax figures link back to the transactions behind them. Rules and deadlines show their source."],
              [FileCheck, "Prepares, never files.", "Walkup is not a tax adviser. Have an accountant review anything before it's filed."],
              [Download, "Your records stay yours.", "Download your financial statements, budget, tax forms and every document you uploaded. Ask us for anything else. No contract."],
            ].map(([Icon, t, b]) => {
              const TrustIcon = Icon as typeof Eye;
              return (
                <div key={t as string} className="rounded-xl border border-line bg-paper p-4">
                  <div className="flex items-start gap-3">
                    <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brass/15 text-eyebrow">
                      <TrustIcon size={18} strokeWidth={1.8} />
                    </span>
                    <h3 className="pt-1.5 text-[15px] font-bold leading-snug text-ink">{t as string}</h3>
                  </div>
                  <p className="mt-2 text-[13px] leading-snug text-mute">{b as string}</p>
                </div>
              );
            })}
          </div>
          <p className="mt-10 text-[14px]">
            <Link href="/security" className="font-medium text-ink underline underline-offset-4 hover:text-mute">
              Read how Walkup protects your data →
            </Link>
          </p>
        </div>
      </Reveal>

      {/* ---------------------------------------------------------------- who it's for */}
      <Reveal tone="white">
        <div className="mx-auto max-w-[1280px] px-4 py-9 sm:px-5">
        <SectionHeading
          eyebrow="Is it right for you?"
          title="Who is Walkup built for?"
          intro="Walkup is built for small, self-managed condominium associations in Illinois with 2 to 20 units and a volunteer board."
        />
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-good-line bg-good-tint/40 p-4">
            <h3 className="text-[16px] font-bold text-ink">A great fit if you are:</h3>
            <ul className="mt-2 space-y-1.5 text-[14px] text-ink">
              {[
                "An Illinois condo association of 2 to 20 units",
                "Run by volunteer owners, not a management company",
                "The treasurer, or the person who got stuck with the books",
                "Ready to retire the spreadsheet before the next handoff",
              ].map((x) => (
                <li key={x} className="flex gap-2">
                  <Check />
                  <span>{x}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-line bg-paper p-4">
            <h3 className="text-[16px] font-bold text-ink">Not the right fit yet if you are:</h3>
            <ul className="mt-2 space-y-1.5 text-[14px] text-mute">
              {[
                "Outside Illinois (join the waitlist for your state)",
                "A professionally managed community",
                ...(DUES_PAYMENTS_ENABLED ? [] : ["Looking for software that collects owner payments for you (coming soon)"]),
              ].map((x) => (
                <li key={x} className="flex gap-2">
                  <span aria-hidden="true" className="mt-[9px] h-1 w-2 shrink-0 rounded bg-mute-soft" />
                  <span>{x}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 border-t border-line pt-3">
              <WaitlistForm />
            </div>
          </div>
        </div>
        </div>
      </Reveal>

      {/* ---------------------------------------------------------------- pricing */}
      <Reveal id="pricing" tone="blue">
        <div className="mx-auto max-w-[1280px] px-4 py-14 sm:px-5">
          <SectionHeading
            eyebrow="Pricing"
            title="How much does Walkup cost?"
            intro={words.pricingIntro}
          />

          <div className="mt-8 flex items-center gap-2 rounded-xl border border-brass bg-brass/15 px-5 py-4 text-[15px] text-ink">
            <Sparkles aria-hidden="true" size={18} strokeWidth={1.7} className="shrink-0" />
            <span>
              <strong>Founding offer:</strong> the first {FOUNDING.associations} boards are free for life.
            </span>
          </div>

          <div className="mt-4 rounded-xl border border-brass/50 bg-brass/10 px-5 py-4 text-[14px] text-ink">
            <strong>{words.calloutLead}</strong> {words.calloutRest}
          </div>

          <p className="mt-10 text-[12px] font-semibold uppercase tracking-[0.12em] text-mute">{words.plansLabel}</p>
          <div className="mt-4 grid gap-5 md:grid-cols-3">
            {PLANS.map((p) => (
              <div
                key={p.name}
                className={`relative flex flex-col rounded-xl border bg-paper p-6 ${p.featured ? "border-brass shadow-lg" : "border-line"}`}
              >
                {p.featured ? (
                  <span className="absolute -top-3 left-6 rounded-full bg-brass px-3 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-on-brass">
                    Most popular
                  </span>
                ) : null}
                <h3 className="text-[18px] font-bold text-ink">{p.name}</h3>
                <p className="text-[12px] uppercase tracking-[0.08em] text-mute">{p.units}</p>
                <p className="mt-4">
                  <span className="text-[40px] font-bold tracking-tight text-ink">${p.month}</span>
                  <span className="text-[14px] text-mute"> / month</span>
                </p>
                <p className="mt-2 border-t border-dashed border-line pt-3 text-[14px] text-ink">
                  or <strong>${p.year} / year</strong>{" "}
                  <span className="text-mute">({ANNUAL_NOTE})</span>
                </p>
                <Link
                  href="/signup"
                  data-cta={`pricing-${p.name.toLowerCase()}`}
                  className={`mt-5 w-full ${p.featured ? primaryBtn : navyBtn}`}
                >
                  {CTA}
                </Link>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-4 text-[14px] md:grid-cols-2">
            {[
              [
                "Founding offer",
                `Free for life, for the first ${FOUNDING.associations} associations`,
              ],
              ["Free setup with a real person", "One 15-minute call and your board is live: owners, bank link and dues."],
            ].map(([t, b]) => (
              <div key={t} className="rounded-xl bg-bone p-5">
                <h3 className="font-bold text-ink">{t}</h3>
                <p className="mt-1 leading-relaxed text-mute">{b}</p>
              </div>
            ))}
          </div>

          <ul className="mt-6 grid w-full gap-x-8 gap-y-2 border-t border-line pt-4 text-[13px] text-mute sm:grid-cols-[1.2fr_1.6fr_0.5fr]">
            <li>Unit count changes are trued up at renewal, never mid-term.</li>
            <li>Walkup does not file taxes or give tax, legal or insurance advice.</li>
            <li className="sm:text-right">Prices in USD.</li>
          </ul>

        </div>
      </Reveal>

      {/* ---------------------------------------------------------------- FAQ */}
      <Reveal id="faq" tone="taupe">
        <div className="mx-auto max-w-[1280px] px-4 py-14 sm:px-5">
        <SectionHeading eyebrow="Questions" title="Frequently asked questions" />
        {/* Answers are in the HTML on load (details just hides them), so crawlers and AI tools can read every one. */}
        <div className="mt-8 space-y-8">
          {FAQ_GROUPS.map((group) => (
            <div key={group}>
              <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.12em] text-mute">{group}</p>
              <div className="divide-y divide-line rounded-xl border border-line bg-paper">
                {FAQ.filter((f) => f.group === group).map((f) => (
                  <details key={f.q} className="group px-6 py-4">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
                      <h3 className="text-[15px] font-semibold">{f.q}</h3>
                      <span aria-hidden="true" className="text-[20px] leading-none text-mute transition-transform group-open:rotate-45">+</span>
                    </summary>
                    <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-mute">{f.a}</p>
                    {f.links ? (
                      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px]">
                        <span className="font-semibold uppercase tracking-[0.08em] text-mute-soft">Learn more</span>
                        {f.links.map((l) =>
                          l.href.startsWith("/") ? (
                            <Link key={l.href} href={l.href} className="font-medium text-ink underline decoration-brass decoration-2 underline-offset-4 hover:text-mute">
                              {l.label} &rarr;
                            </Link>
                          ) : (
                            <a
                              key={l.href}
                              href={l.href}
                              {...(l.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                              className="font-medium text-ink underline decoration-brass decoration-2 underline-offset-4 hover:text-mute"
                            >
                              {l.label} &rarr;
                            </a>
                          ),
                        )}
                      </p>
                    ) : null}
                  </details>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-6 text-[14px] text-mute">
          Something else?{" "}
          <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Question about Walkup")}`} className="font-medium text-ink underline underline-offset-2">
            Email {CONTACT_EMAIL}
          </a>
        </p>
        </div>
      </Reveal>

      {/* ---------------------------------------------------------------- final CTA */}
      <Reveal tone="white">
        <div className="mx-auto flex max-w-[1280px] flex-col items-start gap-6 px-4 py-12 sm:px-5 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <h2 className="text-[26px] font-bold tracking-tight text-ink sm:text-[30px]">Give your board its evenings back.</h2>
            <p className="mt-2 text-[15px] text-mute">
              {words.finalLine}. The first {FOUNDING.associations} associations are free for life.
            </p>
            <p className="mt-3 text-[13px] text-mute">No card. Read-only bank access. Your records stay yours.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/signup" data-cta="final" className={primaryBtn}>
              {CTA_FINAL}
            </Link>
            <a href={bookingHref} target="_blank" rel="noopener noreferrer" className={ghostBtn}>
              Book a 15-Minute Walkthrough
            </a>
          </div>
        </div>
      </Reveal>

      {/* ---------------------------------------------------------------- footer */}
      <footer className="land-blue text-[13px]">
        <div className="mx-auto max-w-[1280px] px-4 py-8 sm:px-5">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="max-w-md">
            <Link href="/" aria-label="Walkup home">
              <Lockup onDark size={28} />
            </Link>
            <p className="mt-2 leading-relaxed text-mute">
              Walkup is software for self-managed condominium associations in Illinois. Walkup never holds association
              funds and is not a tax adviser or a lawyer.
            </p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/login" className="hover:text-ink hover:underline">Sign in</Link>
            <Link href="/signup" className="hover:text-ink hover:underline">Create an account</Link>
            <Link href="/form-1120-h" className="hover:text-ink hover:underline">Form 1120-H guide</Link>
            <Link href="/security" className="hover:text-ink hover:underline">Security</Link>
            <Link href="/privacy" className="hover:text-ink hover:underline">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-ink hover:underline">Terms of Service</Link>
            <Link href="/policies" className="hover:text-ink hover:underline">Policies</Link>
            <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-ink hover:underline">Contact</a>
          </nav>
        </div>
        <p className="mt-8 text-[12px] text-mute">© 2026 {copyrightHolder}</p>
        </div>
      </footer>
    </div>
  );
}
