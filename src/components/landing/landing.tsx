import Link from "next/link";
import { Lockup } from "@/components/mark";

/**
 * The public home page at "/" for anyone not signed in. Signed-in people get
 * the Dashboard at the same URL (src/app/page.tsx decides).
 *
 * Every claim here has to be true of the app as it ships today: read-only
 * bank access, nothing sent automatically, no tax advice, Illinois only.
 * Prices come from Doug's pricing one-pager (Oct 2026); the comparison
 * figures are his, cited as he cites them. No testimonials until there are
 * real ones. The navy bands use the fixed brand navy (not the `ink` token,
 * which flips in dark mode) so the hero reads the same in both themes.
 */

const NAVY = "bg-[#1B2A41]";
const CONTACT = "doug.smart6@gmail.com";

const primaryBtn =
  "inline-flex min-h-[48px] items-center justify-center rounded-md bg-[#D9A441] px-6 text-[15px] font-semibold text-[#1B2A41] transition-colors hover:bg-[#E4B75B] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
const ghostBtn =
  "inline-flex min-h-[48px] items-center justify-center rounded-md border border-white/40 px-6 text-[15px] font-semibold text-white transition-colors hover:bg-white/10";

const FEATURES: { title: string; body: string; points: string[] }[] = [
  {
    title: "Bank feed that files itself",
    body: "Connect the association's bank once. Every transaction arrives with a recommended category and the reason for it.",
    points: ["One click files and posts it to the books", "Read-only — Walkup can never move money", "Undo anything"],
  },
  {
    title: "Dues, without the chasing",
    body: "Set each unit's yearly amount and schedule. Walkup tells you what's due, matches deposits to units, and drafts the reminder.",
    points: ["Different amounts per unit", "Late fees proposed, never automatic", "Owners see what they owe"],
  },
  {
    title: "Budget you can read",
    body: "One sentence says whether you're on plan. See where the money went, biggest category first.",
    points: ["Plan vs. spent by category", "Reserve savings tracked separately", "Starts from last year's numbers"],
  },
  {
    title: "Financial statements on demand",
    body: "A profit and loss for any month, quarter or year — or several side by side — straight from your posted books.",
    points: ["Download a PDF for the board meeting", "Email draft to your owners", "Year-end package for your accountant"],
  },
  {
    title: "Taxes, prepared from your books",
    body: "Walkup checks whether you qualify for Form 1120-H, fills the official IRS form from your records, and lists every deadline.",
    points: ["1120-H and contractor 1099s", "Deadlines in your own calendar", "One-click handoff to your accountant"],
  },
  {
    title: "Repairs, upkeep and contractors",
    body: "Anyone in the building can report a problem. Upkeep that comes due every year is on a schedule, not in someone's head.",
    points: ["Contractor directory with W-9s", "Insurance policy and renewal reminder", "Every document in one place"],
  },
];

const PLANS = [
  { name: "Starter", units: "2 to 6 units", month: 19, year: 190 },
  { name: "Building", units: "7 to 12 units", month: 35, year: 350, featured: true },
  { name: "Association", units: "13 to 20 units", month: 55, year: 550 },
];

const COMPARE = [
  { instead: "HOA software built for bigger buildings", typical: "$49 to $54 a month, plus $2.45 per owner ACH payment", walkup: "$19 to $55 flat" },
  { instead: "A management company", typical: "$300 to $600 a month minimum", walkup: "5 to 15% of that" },
  { instead: "A spreadsheet, Zelle and a Drive folder", typical: "Free, until the treasurer moves out", walkup: "Nothing lost when the board changes" },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "Does Walkup move or hold our money?",
    a: "No. Walkup reads your bank through Plaid with read-only access. Owners pay the association the way they do today, and you pay bills from your own bank. Walkup records it and reminds you.",
  },
  {
    q: "Does it file our taxes?",
    a: "No. Walkup prepares the figures and fills the official IRS forms from your books, with every number traced back to its transactions. The board — ideally with an accountant — reviews and files. Walkup isn't a tax adviser.",
  },
  {
    q: "We're not in Illinois. Can we use it?",
    a: "Not yet. Walkup is built for Illinois condominium associations today, including the Illinois filings. Email us and we'll tell you when your state is ready.",
  },
  {
    q: "Do owners need an account?",
    a: "Only if you want them to have one. Owners can sign in to see what they owe and how to pay, and to report a repair. They never see the association's books.",
  },
  {
    q: "What can our accountant see?",
    a: "Whatever you send them. Walkup drafts the email with the figures and the files to attach. You can also give them time-limited read access to the books.",
  },
  {
    q: "What happens to our data if we leave?",
    a: "It's yours. Export the ledger, documents and owner list any time. There's no contract.",
  },
  {
    q: "Is it secure?",
    a: "Every account uses two-step sign-in. Each association's data is walled off at the database, and every change is logged. Read the details on our Security page.",
  },
];

function SectionHeading({ eyebrow, title, intro }: { eyebrow: string; title: string; intro?: string }) {
  return (
    <div className="max-w-2xl">
      <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#D9A441]">{eyebrow}</p>
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

/** A small, clearly-labelled example of the Dashboard's first screen. Illustrative figures only. */
function ExampleDashboard() {
  const rows = [
    { name: "Form 1120-H", note: "Federal tax return", days: 184, rail: "bg-line-strong" },
    { name: "Insurance renewal", note: "Master policy", days: 52, rail: "bg-warning" },
    { name: "Assessments due from 4 units", note: "Owner fees", days: 18, rail: "bg-bad" },
  ];
  return (
    <div className="relative">
      <div className="overflow-hidden rounded-xl border border-white/15 bg-white text-[#1B2A41] shadow-2xl">
        <div className="flex items-center justify-between bg-[#1B2A41] px-4 py-2.5 text-[12px] text-white/80">
          <span className="font-semibold text-white">Dashboard</span>
          <span>2158 N. Damen</span>
        </div>
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-3 gap-2">
            {[
              ["Operating", "$18,240"],
              ["Reserve", "$41,900"],
              ["Owed to us", "$1,350"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-[#dcd8cf] px-3 py-2">
                <p className="text-[10px] text-[#62677a]">{k}</p>
                <p className="mt-0.5 text-[16px] font-semibold tabular-nums">{v}</p>
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-[#dcd8cf]">
            <p className="border-b border-[#dcd8cf] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#62677a]">Coming up</p>
            <ul className="divide-y divide-[#edeae3]">
              {rows.map((r) => (
                <li key={r.name} className="flex items-center gap-3 px-3 py-2">
                  <span className="w-8 text-right text-[15px] font-semibold tabular-nums">{r.days}</span>
                  <span aria-hidden="true" className={`h-7 w-[3px] rounded-full ${r.rail}`} />
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-medium">{r.name}</span>
                    <span className="block text-[10px] text-[#62677a]">{r.note}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg bg-[#e8f3ec] px-3 py-2 text-[12px] text-[#1f6b45]">
            You&rsquo;re on plan — $2,140 under budget with 9 months gone.
          </div>
        </div>
      </div>
      <p className="mt-2 text-center text-[11px] text-white/60">Example building, illustrative figures</p>
    </div>
  );
}

export function Landing() {
  return (
    <div className="bg-bone text-ink">
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
            <Link href="/signup" className="ml-1 hidden rounded-md bg-[#D9A441] px-3.5 py-2 font-semibold text-[#1B2A41] hover:bg-[#E4B75B] sm:inline-block">
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
              Free during early access · Illinois condominium associations
            </p>
            <h1 className="mt-5 text-[38px] font-bold leading-[1.08] tracking-tight sm:text-[48px]">
              Run your building&rsquo;s books in 15 minutes a month.
            </h1>
            <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-white/80">
              Walkup is the bookkeeping, dues and tax software for self-managed condo associations of 2 to 20 units —
              built for the volunteer treasurer, not the property manager.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup" className={primaryBtn}>
                Create your building — free
              </Link>
              <Link href="/login" className={ghostBtn}>
                Sign in
              </Link>
            </div>
            <p className="mt-4 text-[13px] text-white/60">No card needed. Read-only bank access. Cancel any time.</p>
          </div>
          <ExampleDashboard />
        </div>
      </section>

      {/* ---------------------------------------------------------------- problem */}
      <section className="mx-auto max-w-[1100px] px-6 py-20">
        <SectionHeading
          eyebrow="Why Walkup"
          title="Small buildings deserve better than a spreadsheet."
          intro="Most self-managed associations run on one volunteer's spreadsheet, a stack of Zelle notifications and a shared folder. It works until it doesn't."
        />
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {[
            ["Dues slip through the cracks", "Who paid, who's behind, and how much? The answer lives in one person's head and their bank app."],
            ["Tax season is a scramble", "Does the association qualify for the 1120-H? Which contractors need a 1099? When is it all due?"],
            ["Nothing survives a handoff", "When the treasurer sells their unit, the history leaves with them — passwords, files and all."],
          ].map(([t, b]) => (
            <div key={t} className="rounded-xl border border-line bg-paper p-6">
              <h3 className="text-[16px] font-bold text-ink">{t}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-mute">{b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------------- features */}
      <section id="features" className="border-y border-line bg-paper">
        <div className="mx-auto max-w-[1100px] px-6 py-20">
          <SectionHeading
            eyebrow="Everything in one place"
            title="Books, dues, budget, taxes and the building — all of it."
            intro="Every plan includes every feature and unlimited board seats."
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
        </div>
      </section>

      {/* ---------------------------------------------------------------- how it works */}
      <section className="mx-auto max-w-[1100px] px-6 py-20">
        <SectionHeading eyebrow="How it works" title="Set up in an afternoon. Then about 15 minutes a month." />
        <ol className="mt-10 grid gap-5 md:grid-cols-4">
          {[
            ["Create your building", "Your account, two-step sign-in, and the association's name. Walkup sets up the fiscal year, funds and chart of accounts for you."],
            ["Add units and owners", "Each unit, its owner and the rest of the board. Invite them with a link."],
            ["Connect your bank", "Read-only, through Plaid. Recent history comes in with a recommended category on every transaction."],
            ["Post, and you're running", "Set the budget and each unit's dues. From then on, Walkup tells you what needs you each month."],
          ].map(([t, b], i) => (
            <li key={t} className="rounded-xl border border-line bg-paper p-6">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1B2A41] text-[14px] font-bold text-white">{i + 1}</span>
              <h3 className="mt-4 text-[16px] font-bold text-ink">{t}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-mute">{b}</p>
            </li>
          ))}
        </ol>
        <div className="mt-8">
          <Link href="/signup" className="inline-flex min-h-[48px] items-center rounded-md bg-[#1B2A41] px-6 text-[15px] font-semibold text-white hover:bg-[#283B5A]">
            Create your building — free
          </Link>
        </div>
      </section>

      {/* ---------------------------------------------------------------- trust */}
      <section className={`${NAVY} text-white`}>
        <div className="mx-auto max-w-[1100px] px-6 py-20">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#D9A441]">Built to be trusted with money</p>
          <h2 className="mt-2 max-w-2xl text-[28px] font-bold leading-tight tracking-tight sm:text-[32px]">
            Walkup records and reminds. You stay in control.
          </h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Never moves money", "Read-only bank access. Owners pay the association directly; you pay bills from your own bank."],
              ["Never sends anything on its own", "Reminders and accountant emails open as drafts in your own email. You press send."],
              ["Two-step sign-in, always", "Every account uses an authenticator app. Each association's data is walled off and every change is logged."],
              ["Official forms, honestly labeled", "Tax figures are traced to their transactions. Rules and deadlines show their source and whether a person has checked them."],
              ["Not a tax adviser", "Walkup prepares; the board decides. We recommend an accountant review anything before it's filed."],
              ["Your data is yours", "Export the ledger, documents and owner list any time. No contract."],
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
        <SectionHeading eyebrow="Is it right for you?" title="Made for small, self-managed buildings." />
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <div className="rounded-xl border border-good-line bg-good-tint/40 p-6">
            <h3 className="text-[16px] font-bold text-ink">A great fit if you&rsquo;re</h3>
            <ul className="mt-3 space-y-2 text-[14px] text-ink">
              {[
                "An Illinois condominium association",
                "2 to 20 units, run by a volunteer board",
                "Managing your own books instead of paying a management company",
                "Tired of the spreadsheet",
              ].map((x) => (
                <li key={x} className="flex gap-2">
                  <Check />
                  <span>{x}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-line bg-paper p-6">
            <h3 className="text-[16px] font-bold text-ink">Not the right fit (yet) if you&rsquo;re</h3>
            <ul className="mt-3 space-y-2 text-[14px] text-mute">
              {[
                "Outside Illinois — tell us where, and we'll let you know",
                "A professionally managed community",
                "Looking for software that collects owner payments for you",
              ].map((x) => (
                <li key={x} className="flex gap-2">
                  <span aria-hidden="true" className="mt-[9px] h-1 w-2 shrink-0 rounded bg-mute-soft" />
                  <span>{x}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- pricing */}
      <section id="pricing" className="border-y border-line bg-paper">
        <div className="mx-auto max-w-[1100px] px-6 py-20">
          <SectionHeading
            eyebrow="Pricing"
            title="Free during early access. Then one flat price."
            intro="Pick the plan that matches your unit count. No per-owner fees, no add-ons, no sales call."
          />

          <div className="mt-8 rounded-xl border border-[#D9A441]/50 bg-[#D9A441]/10 px-5 py-4 text-[14px] text-ink">
            <strong>Early access is free.</strong> Create your building today and use everything at no cost. We&rsquo;ll
            give you plenty of notice before paid plans begin — nothing is ever charged without you choosing a plan.
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
                    Most buildings
                  </span>
                ) : null}
                <h3 className="text-[18px] font-bold text-ink">{p.name}</h3>
                <p className="text-[12px] uppercase tracking-[0.08em] text-mute">{p.units}</p>
                <p className="mt-4">
                  <span className="text-[40px] font-bold tracking-tight text-ink">${p.month}</span>
                  <span className="text-[14px] text-mute"> / month</span>
                </p>
                <p className="mt-2 border-t border-dashed border-line pt-3 text-[14px] text-ink">
                  or <strong>${p.year} / year</strong> <span className="text-mute">— 2 months free</span>
                </p>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-4 text-[14px] md:grid-cols-3">
            {[
              ["Setup help from a real person", "A Walkup team member can get your board live in one 30-minute call: owners, bank link, dues."],
              ["Pay yearly, save 2 months", "Annual plans are 10 months for the price of 12. Switch at any renewal."],
              ["Founding price", "The first 50 Chicago associations lock in $15 / $29 / $45 a month for 24 months."],
            ].map(([t, b]) => (
              <div key={t} className="rounded-xl bg-bone p-5">
                <h3 className="font-bold text-ink">{t}</h3>
                <p className="mt-1 leading-relaxed text-mute">{b}</p>
              </div>
            ))}
          </div>

          <ul className="mt-6 space-y-1 text-[13px] text-mute">
            <li>21 or more units: $55 plus $2 per unit per month above 20.</li>
            <li>Unit count changes are trued up at your next renewal, never mid-term.</li>
            <li>Not included: filing your taxes, or tax, legal and insurance advice. Walkup prepares, you decide.</li>
            <li>Prices in USD.</li>
          </ul>

          <div className="mt-12">
            <h3 className="text-[18px] font-bold text-ink">What boards pay today</h3>
            <div className="mt-4 overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[34rem] text-left text-[14px]">
                <thead className="bg-bone text-[12px] uppercase tracking-[0.08em] text-mute">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Instead of</th>
                    <th className="px-4 py-3 font-semibold">Typical cost</th>
                    <th className="px-4 py-3 font-semibold">Walkup</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {COMPARE.map((c) => (
                    <tr key={c.instead}>
                      <td className="px-4 py-3 text-ink">{c.instead}</td>
                      <td className="px-4 py-3 text-mute">{c.typical}</td>
                      <td className="px-4 py-3 font-semibold text-good-text">{c.walkup}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[12px] text-mute-soft">
              Figures from vendor pricing pages and published management fees, September 2026.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- FAQ */}
      <section id="faq" className="mx-auto max-w-[1100px] px-6 py-20">
        <SectionHeading eyebrow="Questions" title="Frequently asked" />
        <div className="mt-8 divide-y divide-line rounded-xl border border-line bg-paper">
          {FAQ.map((f) => (
            <details key={f.q} className="group px-6 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
                {f.q}
                <span aria-hidden="true" className="text-[20px] leading-none text-mute transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-mute">{f.a}</p>
            </details>
          ))}
        </div>
        <p className="mt-6 text-[14px] text-mute">
          Something else?{" "}
          <a href={`mailto:${CONTACT}?subject=${encodeURIComponent("Question about Walkup")}`} className="font-medium text-ink underline underline-offset-2">
            Email {CONTACT}
          </a>
        </p>
      </section>

      {/* ---------------------------------------------------------------- final CTA */}
      <section className={`${NAVY} text-white`}>
        <div className="mx-auto flex max-w-[1100px] flex-col items-start gap-6 px-6 py-16 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-[26px] font-bold tracking-tight sm:text-[30px]">Give your board its evenings back.</h2>
            <p className="mt-2 text-[15px] text-white/75">Free during early access. Set up in an afternoon.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/signup" className={primaryBtn}>
              Create your building — free
            </Link>
            <a href={`mailto:${CONTACT}?subject=${encodeURIComponent("Walkup — I'd like a walkthrough")}`} className={ghostBtn}>
              Ask for a walkthrough
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
              Software for self-managed condominium associations. Walkup never holds association funds and is not a
              tax adviser or a lawyer.
            </p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/login" className="hover:text-ink hover:underline">Sign in</Link>
            <Link href="/signup" className="hover:text-ink hover:underline">Create an account</Link>
            <Link href="/security" className="hover:text-ink hover:underline">Security</Link>
            <Link href="/privacy" className="hover:text-ink hover:underline">Privacy Policy</Link>
            <Link href="/policies" className="hover:text-ink hover:underline">Policies</Link>
            <a href={`mailto:${CONTACT}`} className="hover:text-ink hover:underline">Contact</a>
          </nav>
        </div>
        <p className="mt-8 text-[12px] text-mute-soft">© {new Date().getFullYear()} Walkup</p>
      </footer>
    </div>
  );
}
