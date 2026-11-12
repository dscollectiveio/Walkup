import Link from "next/link";
import { Banknote, Bell, FileCheck, FileText, HandCoins, KeyRound, MessageCircle, Mail, ShieldCheck, Wrench } from "lucide-react";
import { Reveal } from "./reveal";

/**
 * "The volunteer board's problem": six pains, each with the Walkup answer as plain gold text, then a signup CTA.
 * Server-rendered, so every word is readable with JavaScript off.
 *
 * Every fix line is something the product does today (dues status and approved reminders, the upkeep schedule and
 * contractor records, the documents page and owner sharing, policies and renewal dates, Form 1120-H prep and the
 * deadline calendar, a ledger and audit log that stay with the association). No em dashes.
 */

const CARDS: {
  label: string;
  Icon: typeof HandCoins;
  title: string;
  body: string;
  fix: string;
}[] = [
  {
    label: "Dues",
    Icon: HandCoins,
    title: "Dues slip, and so do neighbors.",
    body: "Who's paid? Who's two months behind? When the answer lives in one person's bank app, chasing a neighbor gets awkward fast.",
    fix: "Walkup shows every unit's status at a glance and drafts reminders for the board to approve.",
  },
  {
    label: "Maintenance",
    Icon: Wrench,
    title: "Repairs live in text threads.",
    body: "A leak gets reported in a group chat, the quote sits in someone's email, and the gutter cleaning only happens if somebody remembers.",
    fix: "Walkup keeps one maintenance log, with recurring tasks and contractor records.",
  },
  {
    label: "Records",
    Icon: FileCheck,
    title: "An owner asks for the records. Now there's a deadline.",
    // TODO: confirm owner records request response deadline under the Illinois Condominium Property Act (765 ILCS 605/19) before adding a specific number to this copy.
    body: "The declaration, minutes, budgets, and policies are spread across five inboxes, and Illinois law gives owners the right to see them.",
    fix: "Walkup keeps every association document in one place, ready to share.",
  },
  {
    label: "Insurance",
    Icon: ShieldCheck,
    title: "Insurance renews before anyone looks.",
    body: "The master policy auto-renews at a higher price. Nobody remembers what it covers, or what owners need in their HO-6, until there's a claim.",
    fix: "Walkup tracks your policies, renewal dates, and coverage notes in one place.",
  },
  {
    label: "Taxes",
    Icon: FileText,
    title: "Tax season turns into a scramble.",
    body: "Does the association qualify for Form 1120-H? Which contractors need a 1099? Most volunteer treasurers find out in April, the hard way.",
    fix: "Walkup prepares Form 1120-H from your books and keeps every deadline on the calendar.",
  },
  {
    label: "Handoff",
    Icon: KeyRound,
    title: "Everything leaves when the treasurer does.",
    body: "When the treasurer sells their unit, the logins, receipts, budget, and the reasons behind it all go too. The next volunteer starts from zero.",
    fix: "Walkup keeps the full history with the building, not one person.",
  },
];

/** The "before" picture: the scattered alerts a volunteer treasurer lives with, one per app. Decoration only. */
const CHIPS: { app: string; when: string; text: string; Icon: typeof Bell; tile: string; indent: string }[] = [
  { app: "Zelle", when: "now", text: "$475 received from Unit 3", Icon: Banknote, tile: "bg-[#6d4fb3]", indent: "ml-0" },
  { app: "Group chat", when: "4 new", text: "Water in the garage again?", Icon: MessageCircle, tile: "bg-[#3f8f6b]", indent: "ml-8" },
  { app: "Email", when: "Mon", text: "Master policy premium up 18%", Icon: Mail, tile: "bg-[#c0693f]", indent: "ml-3" },
  { app: "Reminder", when: "Apr 15", text: "Form 1120-H due", Icon: Bell, tile: "bg-[#5b6b8c]", indent: "ml-11" },
];

export function ProblemSection() {
  return (
    <Reveal tone="blue">
      <div className="mx-auto max-w-[1280px] px-4 py-7 sm:px-5">
        <div className="grid gap-8 md:grid-cols-12 md:items-center">
          <div className="md:col-span-7">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-eyebrow">The volunteer board&rsquo;s problem</p>
            <h2 className="mt-2 text-[26px] font-bold leading-tight tracking-tight text-ink sm:text-[30px]">
              Why is running a small condo association so hard?
            </h2>
            <p className="mt-2 text-[15px] leading-relaxed text-mute">
              Most self-managed condo associations run on one volunteer&rsquo;s spreadsheet, Zelle alerts and a shared folder nobody else can find. It
              works until someone misses a deadline or moves out.
            </p>
          </div>
          <div aria-hidden="true" className="hidden flex-col gap-1.5 md:col-span-5 md:flex">
            {CHIPS.map(({ app, when, text, Icon, tile, indent }) => (
              <div
                key={text}
                className={`${indent} flex w-full max-w-[280px] items-center gap-2.5 rounded-lg border border-white/15 bg-white/[0.07] px-2.5 py-1.5 shadow-md shadow-black/20`}
              >
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white ${tile}`}>
                  <Icon size={15} strokeWidth={1.9} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2 text-[10px] font-semibold uppercase tracking-wide text-[#b4bfd6]">
                    {app}
                    <span className="font-normal normal-case tracking-normal text-[#8b97b0]">{when}</span>
                  </span>
                  <span className="block truncate text-[12px] font-medium text-[#dfe5f2]">{text}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {CARDS.map(({ label, Icon, title, body, fix }) => (
            <div key={title} className="flex flex-col rounded-xl border border-white/25 bg-white/10 p-4">
              <p className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[#e0b866]/40 bg-[#e0b866]/10 px-2.5 py-0.5 text-[12px] font-medium text-[#e0b866]">
                <Icon aria-hidden="true" size={14} strokeWidth={1.8} />
                {label}
              </p>
              <h3 className="mt-2 text-[16px] font-bold leading-snug text-ink">{title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-snug text-mute">{body}</p>
              <div className="mt-auto pt-3">
                <p className="border-t border-white/20 pt-2.5 text-[13px] font-semibold leading-snug text-[#e0b866]">{fix}</p>
                {label === "Taxes" && (
                  <p className="mt-1.5 text-[12px] leading-snug text-mute">Draft figures, for your accountant to review.</p>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[16px] font-semibold text-ink">Walkup puts all of it in one place the whole board can see, without hiring a management company.</p>
          <Link
            href="/signup"
            data-cta="problem"
            className="inline-flex min-h-[48px] w-full shrink-0 items-center justify-center rounded-md bg-brass px-6 text-[15px] font-bold text-on-brass transition-colors hover:bg-[#E4B75B] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:w-auto"
          >
            Try Walkup Free
          </Link>
        </div>
      </div>
    </Reveal>
  );
}
