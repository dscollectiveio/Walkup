import Link from "next/link";
import { Lockup } from "@/components/mark";
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
 * Every "Create your building, free" button goes to /signup and carries a
 * data-cta naming its section, to see which one converts.
 */

const NAVY = "bg-[#1B2A41]";
const CTA = "Create your building, free";

const primaryBtn =
  "inline-flex min-h-[48px] items-center justify-center rounded-md bg-[#D9A441] px-6 text-[15px] font-semibold text-[#1B2A41] transition-colors hover:bg-[#E4B75B] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
const ghostBtn =
  "inline-flex min-h-[48px] items-center justify-center rounded-md border border-white/40 px-6 text-[15px] font-semibold text-white transition-colors hover:bg-white/10";
// Navy on light, cream on dark: the app's own primary button, so it never sinks into a dark section.
const navyBtn =
  "inline-flex min-h-[48px] items-center rounded-md bg-ink px-6 text-[15px] font-semibold text-paper hover:bg-ink-mid";

const FEATURES: { title: string; body: string; points: string[] }[] = [
  {
    title: "Your books, kept for you",
    body: "Connect the association's bank once through Plaid. Every transaction arrives sorted, with a suggested category and the reason for it.",
    points: ["Approve a month of transactions in minutes", "Read-only: Walkup can never move money", "Undo anything, any time"],
  },
  {
    title: "Know who paid, without asking",
    body: "Set each unit's dues once. Walkup matches deposits to units, shows who's behind, and drafts a friendly reminder for you to send.",
    points: ["Different amounts for different units", "Late fees suggested, never charged on their own", "Owners can see exactly what they owe"],
  },
  {
    title: "A budget anyone on the board can read",
    body: "One sentence tells you if you're on plan. Spending is ranked biggest first, so surprises jump out.",
    points: ["Budget vs. actual by category", "Reserve savings tracked separately", "Next year's budget starts from this year's numbers"],
  },
  {
    title: "Board-ready financial statements in one click",
    body: "Profit and loss for any month, quarter or year, straight from your books. Bring a PDF to the meeting instead of a spreadsheet.",
    points: ["Side-by-side periods", "Owner update email, drafted for you", "Year-end package for your accountant"],
  },
  {
    title: "Form 1120-H, prepared from your books",
    body: "Walkup checks whether your association qualifies for Form 1120-H, fills the official IRS form from your records, and puts every deadline on your calendar.",
    points: ["Every figure traced to its transactions", "Contractor 1099 list from your payments", "One-click handoff to your accountant"],
  },
  {
    title: "Repairs, upkeep and the paper trail",
    body: "Anyone in the building can report a problem. Yearly upkeep runs on a schedule, not someone's memory, and every document lives in one place.",
    points: ["Contractor directory with W-9s on file", "Insurance policy and renewal reminders", "Searchable document library"],
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
  return (
    <div className="bg-bone text-ink">
      <StructuredData nonce={nonce} />
      {/* ---------------------------------------------------------------- header */}
      <header className={`${NAVY} text-white`}>
        <div className="mx-auto flex max-w-[1100px] items-center justify-between px-6 py-4">
          <Link href="/" aria-label="Walkup home">
            <Lockup onDark size={34} />
          </Link>
          <nav aria-label="Site" className="flex items-center gap-1 text-[14px]">
            <a href="#features" className="hidden rounded-md px-3 py-2 text-white/80 hover:text-white sm:inline-block">Features</a>
            <a href="#pricing" className="hidden rounded-md px-3 py-2 text-white/80 hover:text-white sm:inline-block">Pricing</a>
            <a href="#faq" className="hidden rounded-md px-3 py-2 text-white/80 hover:text-white md:inline-block">FAQ</a>
            <Link href="/login" className="rounded-md px-3 py-2 font-medium text-white hover:bg-white/10">Sign in</Link>
            <Link href="/signup" data-cta="header" className="ml-1 hidden rounded-md bg-[#D9A441] px-3.5 py-2 font-semibold text-[#1B2A41] hover:bg-[#E4B75B] sm:inline-block">
              Get started
            </Link>
          </nav>
        </div>
      </header>

      {/* ---------------------------------------------------------------- hero */}
      <section className={`${NAVY} text-white`}>
        <div className="mx-auto grid max-w-[1100px] items-center gap-12 px-6 pb-20 pt-12 lg:grid-cols-[1.1fr_1fr] lg:pt-16">
          <div>
            <p className="inline-flex rounded-full border border-white/25 px-3 py-1 text-[12px] font-medium text-white/85">
              Software for self-managed condo associations in Illinois
            </p>
            <h1 className="mt-5 text-[38px] font-bold leading-[1.08] tracking-tight sm:text-[48px]">
              Run your building&rsquo;s books in 15 minutes a month.
            </h1>
            <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-white/80">
              Walkup is bookkeeping, dues and tax software for self-managed condo associations of 2 to 20 units.
              It&rsquo;s built for the volunteer treasurer who has a day job, not the property manager who does this full time.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup" data-cta="hero" className={primaryBtn}>
                {CTA}
              </Link>
              <a href="#how-it-works" className={ghostBtn}>
                See how it works
              </a>
            </div>
            <p className="mt-4 text-[13px] text-white/60">
              Free during early access. No card. Read-only bank access. Leave any time with your data.
            </p>
          </div>
          <HeroSlideshow />
        </div>
      </section>

      {/* ---------------------------------------------------------------- problem */}
      <section className="mx-auto max-w-[1100px] px-6 py-20">
        <SectionHeading
          eyebrow="The volunteer treasurer's problem"
          title="Why do small condo boards struggle to keep the books?"
          intro="Most self-managed condo associations run on one volunteer's spreadsheet, a trail of Zelle alerts and a shared folder nobody else can find. It works until someone misses a payment, a tax deadline, or moves out."
        />
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {[
            ["Dues slip, and so do neighbors.", "Who paid this quarter? Who's two months behind? When the answer lives in one person's bank app, chasing a neighbor gets awkward fast, and the reserve fund pays for it."],
            ["Tax season turns into a scramble.", "Does the association qualify for Form 1120-H? Which contractors need a 1099? When is it due? Most volunteer treasurers find out in April, the hard way."],
            ["Everything leaves when the treasurer does.", "When the treasurer sells their unit, the history goes with them: logins, receipts, the budget and the reasons behind it. The next volunteer starts from zero."],
          ].map(([t, b]) => (
            <div key={t} className="rounded-xl border border-line bg-paper p-6">
              <h3 className="text-[16px] font-bold text-ink">{t}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-mute">{b}</p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-[17px] font-semibold text-ink">Walkup fixes all three, without hiring a management company.</p>
      </section>

      {/* ---------------------------------------------------------------- features */}
      <section id="features" className="border-y border-line bg-paper">
        <div className="mx-auto max-w-[1100px] px-6 py-20">
          <SectionHeading
            eyebrow="What Walkup does"
            title="HOA bookkeeping software that does the busywork for you"
            intro="Walkup handles the books, dues, budget, financial statements and taxes for small condo associations, in one place the whole board can see. Every plan includes every feature and unlimited board seats."
          />
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <article key={f.title} className="flex flex-col rounded-xl border border-line bg-bone/60 p-6">
                <h3 className="text-[17px] font-bold text-ink">{f.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-mute">{f.body}</p>
                <ul className="mt-4 space-y-2 text-[13px] text-ink">
                  {f.points.map((p) => (
                    <li key={p} className="flex gap-2">
                      <Check />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          <div className="mt-10">
            <Link href="/signup" data-cta="features" className={navyBtn}>
              {CTA}
            </Link>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- how it works */}
      <section id="how-it-works" className="mx-auto max-w-[1100px] scroll-mt-4 px-6 py-20">
        <SectionHeading
          eyebrow="How it works"
          title="How long does it take to set up Walkup?"
          intro="About an afternoon. After that, most treasurers spend around 15 minutes a month."
        />
        <ol className="mt-10 grid gap-5 md:grid-cols-4">
          {[
            ["Create your building", "Name the association and turn on two-step sign-in. Walkup sets up your fiscal year, funds and chart of accounts for you."],
            ["Add units and owners", "Enter each unit and its owner, then invite the rest of the board with a link."],
            ["Connect your bank", "Read-only, through Plaid. Recent transactions arrive already sorted."],
            ["Set dues and the budget", "Start from last year's numbers. From here, Walkup tells you what needs you each month."],
          ].map(([t, b], i) => (
            <li key={t} className="rounded-xl border border-line bg-paper p-6">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-[14px] font-bold text-paper">{i + 1}</span>
              <h3 className="mt-4 text-[16px] font-bold text-ink">{t}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-mute">{b}</p>
            </li>
          ))}
        </ol>
        <div className="mt-8 rounded-xl border border-line bg-paper p-6">
          <h3 className="text-[16px] font-bold text-ink">Your 15 minutes a month</h3>
          <ul className="mt-3 space-y-2 text-[14px] text-ink">
            {["Approve the transactions Walkup sorted", "Send the dues reminders it drafted", "Read one sentence on the budget"].map((x) => (
              <li key={x} className="flex gap-2">
                <Check />
                <span>{x}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-6 text-[15px] text-mute">
          Want a hand? A Walkup team member will set up your board with you on one 30-minute call, free.
        </p>
        <div className="mt-6">
          <Link href="/signup" data-cta="how-it-works" className={navyBtn}>
            {CTA}
          </Link>
        </div>
      </section>

      {/* ---------------------------------------------------------------- founder */}
      <section className="border-t border-line bg-paper">
        <div className="mx-auto max-w-[1100px] px-6 py-20">
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
            <p className="mt-6 text-[15px] font-semibold text-ink">Doug Smart, founder of Walkup and condo board president</p>
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
      </section>

      {/* ---------------------------------------------------------------- trust */}
      <section className={`${NAVY} text-white`}>
        <div className="mx-auto max-w-[1100px] px-6 py-20">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#D9A441]">Built to be trusted with money</p>
          <h2 className="mt-2 max-w-2xl text-[28px] font-bold leading-tight tracking-tight sm:text-[32px]">
            How does Walkup protect our association&rsquo;s money?
          </h2>
          <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-white/80">
            Walkup records, reminds and prepares. Your board stays in control of every dollar and every decision.
          </p>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              [
                "Never holds your money.",
                DUES_PAYMENTS_ENABLED
                  ? "Owner payments go straight to the association's bank. Walkup never holds funds."
                  : "Bank access is read-only through Plaid. Owners pay the association directly, and you pay bills from your own bank.",
              ],
              ["Never emails anyone without a board admin's approval.", "Reminders and statements go out only after a board admin approves them. Messages to contractors, agents and your accountant open as drafts in your own email app."],
              ["Two-step sign-in on every account.", "Each association's data is walled off from every other, and every change is logged with who made it."],
              ["Every number shows its work.", "Tax figures link back to the transactions behind them. Rules and deadlines show their source."],
              ["Prepares, never files.", "Walkup is not a tax adviser. Have an accountant review anything before it's filed."],
              ["Your records stay yours.", "Download your financial statements, budget, tax forms and every document you uploaded. Ask us for anything else. No contract."],
            ].map(([t, b]) => (
              <div key={t}>
                <h3 className="text-[16px] font-bold">{t}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-white/75">{b}</p>
              </div>
            ))}
          </div>
          <p className="mt-10 text-[14px]">
            <Link href="/security" className="font-medium text-white underline underline-offset-4 hover:text-[#EBC878]">
              Read how Walkup protects your data →
            </Link>
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------------- who it's for */}
      <section className="mx-auto max-w-[1100px] px-6 py-20">
        <SectionHeading
          eyebrow="Is it right for you?"
          title="Who is Walkup built for?"
          intro="Walkup is built for small, self-managed condominium associations in Illinois with 2 to 20 units and a volunteer board."
        />
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <div className="rounded-xl border border-good-line bg-good-tint/40 p-6">
            <h3 className="text-[16px] font-bold text-ink">A great fit if you are:</h3>
            <ul className="mt-3 space-y-2 text-[14px] text-ink">
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
          <div className="rounded-xl border border-line bg-paper p-6">
            <h3 className="text-[16px] font-bold text-ink">Not the right fit yet if you are:</h3>
            <ul className="mt-3 space-y-2 text-[14px] text-mute">
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
            <div className="mt-5 border-t border-line pt-5">
              <WaitlistForm />
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- pricing */}
      <section id="pricing" className="border-y border-line bg-paper">
        <div className="mx-auto max-w-[1100px] px-6 py-20">
          <SectionHeading
            eyebrow="Pricing"
            title="How much does Walkup cost?"
            intro="Walkup is free during early access. After that, it's one flat monthly price based on your unit count, with every feature included and no per-owner fees."
          />

          <div className="mt-8 rounded-xl border border-[#D9A441]/50 bg-[#D9A441]/10 px-5 py-4 text-[14px] text-ink">
            <strong>Start free today.</strong> We&rsquo;ll give you plenty of notice before paid plans begin, and nothing is
            ever charged unless you choose a plan.
          </div>

          <p className="mt-10 text-[12px] font-semibold uppercase tracking-[0.12em] text-mute">After early access</p>
          <div className="mt-4 grid gap-5 md:grid-cols-3">
            {PLANS.map((p) => (
              <div
                key={p.name}
                className={`relative rounded-xl border bg-paper p-6 ${p.featured ? "border-[#D9A441] shadow-lg" : "border-line"}`}
              >
                {p.featured ? (
                  <span className="absolute -top-3 left-6 rounded-full bg-[#D9A441] px-3 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#1B2A41]">
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
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-4 text-[14px] md:grid-cols-2">
            {[
              [
                "Founding offer",
                `The first ${FOUNDING.associations} ${FOUNDING.region} associations lock in ${FOUNDING.prices.map((n) => `$${n}`).join(", ")} a month for ${FOUNDING.months} months. Join now to claim a founding spot.`,
              ],
              ["Free setup with a real person", "One 30-minute call and your board is live: owners, bank link and dues."],
            ].map(([t, b]) => (
              <div key={t} className="rounded-xl bg-bone p-5">
                <h3 className="font-bold text-ink">{t}</h3>
                <p className="mt-1 leading-relaxed text-mute">{b}</p>
              </div>
            ))}
          </div>

          <ul className="mt-6 space-y-1 text-[13px] text-mute">
            <li>Unit count changes are trued up at renewal, never mid-term.</li>
            <li>Walkup does not file taxes or give tax, legal or insurance advice.</li>
            <li>Prices in USD.</li>
          </ul>

        </div>
      </section>

      {/* ---------------------------------------------------------------- FAQ */}
      <section id="faq" className="mx-auto max-w-[1100px] px-6 py-20">
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
      </section>

      {/* ---------------------------------------------------------------- final CTA */}
      <section className={`${NAVY} text-white`}>
        <div className="mx-auto flex max-w-[1100px] flex-col items-start gap-6 px-6 py-16 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <h2 className="text-[26px] font-bold tracking-tight sm:text-[30px]">Give your board its evenings back.</h2>
            <p className="mt-2 text-[15px] text-white/75">
              Set up in an afternoon, then about 15 minutes a month. Free during early access, with founding prices for
              the first {FOUNDING.associations} {FOUNDING.region} associations.
            </p>
            <p className="mt-3 text-[13px] text-white/60">No card. Read-only bank access. Your records stay yours.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/signup" data-cta="final" className={primaryBtn}>
              {CTA}
            </Link>
            <a href={bookingHref} target="_blank" rel="noopener noreferrer" className={ghostBtn}>
              Book a 15-minute walkthrough
            </a>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- footer */}
      <footer className="mx-auto max-w-[1100px] px-6 py-10 text-[13px] text-mute">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="max-w-md">
            <Link href="/" aria-label="Walkup home">
              <Lockup size={28} />
            </Link>
            <p className="mt-2 leading-relaxed">
              Walkup is software for self-managed condominium associations in Illinois. Walkup never holds association
              funds and is not a tax adviser or a lawyer.
            </p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/login" className="hover:text-ink hover:underline">Sign in</Link>
            <Link href="/signup" className="hover:text-ink hover:underline">Create an account</Link>
            <Link href="/security" className="hover:text-ink hover:underline">Security</Link>
            <Link href="/privacy" className="hover:text-ink hover:underline">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-ink hover:underline">Terms of Service</Link>
            <Link href="/policies" className="hover:text-ink hover:underline">Policies</Link>
            <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-ink hover:underline">Contact</a>
          </nav>
        </div>
        <p className="mt-8 text-[12px] text-mute">© 2026 {copyrightHolder}</p>
      </footer>
    </div>
  );
}
