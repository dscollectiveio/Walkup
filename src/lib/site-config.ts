/**
 * The marketing site's facts, in one place. The landing page, its metadata,
 * the structured data for search engines, the footer, policy pages and error
 * messages all read from here, so a change is made once.
 *
 * Values marked TODO(doug) are placeholders until Doug supplies the real
 * thing. Where a placeholder would show up on the live site as nonsense,
 * the page falls back to something true instead (see the helpers below).
 */

export const SITE_URL = "https://www.walkuphoa.com";

// Mail to walkuphoa.com is forwarded by ImprovMX (set up Oct 2026) to Doug's inbox.
// The catch-all (*) means any address works; these are the ones the app uses,
// each for one purpose so mail can be sorted and, later, split between people.
/** General questions: the landing page, footer, privacy and the public listing. */
export const CONTACT_EMAIL = "hello@walkuphoa.com";
/** Help with an account or a problem using Walkup. */
export const SUPPORT_EMAIL = "support@walkuphoa.com";
/** Pricing, fit, walkthrough requests and associations over 20 units. */
export const SALES_EMAIL = "sales@walkuphoa.com";
/** Vulnerability reports (security.txt and the Security page). */
export const SECURITY_EMAIL = "security@walkuphoa.com";

/** The booking page for the 15-minute walkthrough. */
export const BOOKING_URL = "https://calendly.com/dscollective/walkup-app-walkthrough";

/** The legal entity that operates Walkup: the footer copyright, the Terms and the Privacy Policy. */
export const LEGAL_ENTITY = "DS Collective LLC";

/**
 * DS Collective LLC's postal address. Every email Walkup sends on behalf of an
 * association carries it in the footer (CAN-SPAM, DECISIONS #36), so sending
 * refuses to start while this is a placeholder. Do not invent one.
 */
// TODO(doug): DS Collective LLC's real postal address.
export const LEGAL_ADDRESS = "TODO(doug): DS Collective LLC postal address";

// TODO(doug): a real quote from a real board member. Null renders nothing; never write a placeholder quote.
export const TESTIMONIAL: { quote: string; name: string; role: string } | null = null;

/**
 * Whether owner dues payments run through Walkup. False today: Walkup reads
 * the bank and never touches money. Flip only when online owner payments ship.
 */
export const DUES_PAYMENTS_ENABLED = false;

/** security.txt must be renewed before this date (RFC 9116). Bump it each year. */
export const SECURITY_TXT_EXPIRES = "2027-10-14T00:00:00.000Z";

const isPlaceholder = (v: string) => v.startsWith("TODO");

/** True once LEGAL_ADDRESS is a real address. Outbound email stays "not set up" until then. */
export const legalAddressIsSet = !isPlaceholder(LEGAL_ADDRESS);

/** Where "Book a walkthrough" goes: the booking page once set, an email until then. */
export const bookingHref = isPlaceholder(BOOKING_URL)
  ? `mailto:${SALES_EMAIL}?subject=${encodeURIComponent("Walkup walkthrough")}`
  : BOOKING_URL;

/** The copyright holder in the footer: the legal entity once set, the product name until then. */
export const copyrightHolder = isPlaceholder(LEGAL_ENTITY) ? "Walkup" : LEGAL_ENTITY;

/** Who runs Walkup, as the Terms name it: the legal entity once set, the founder until then. */
export const operatorName = isPlaceholder(LEGAL_ENTITY) ? "Walkup, operated by Doug Smart" : `${LEGAL_ENTITY}, which operates Walkup`;

// ---- Pricing (Doug's pricing one-pager, Oct 2026) ------------------------------

export const PLANS: { name: string; units: string; month: number; year: number; featured?: boolean }[] = [
  { name: "Starter", units: "2 to 6 units", month: 19, year: 190 },
  { name: "Building", units: "7 to 12 units", month: 35, year: 350, featured: true },
  { name: "Association", units: "13 to 20 units", month: 55, year: 550 },
];

/** Annual plans: two months free (each `year` above is 10 × `month`). */
export const ANNUAL_NOTE = "2 months free";

export const FOUNDING = { associations: 50, region: "Illinois", prices: [15, 29, 45], months: 24 } as const;

// ---- FAQ: the page and the FAQPage structured data both render this -------------
// Written the way treasurers search. Each answer stands alone so search and AI
// tools can quote it whole. The Form 1120-H answers are worth an accountant's read.

export type FaqGroup = "For treasurers" | "About Walkup" | "Data and security";

export const FAQ: { group: FaqGroup; q: string; a: string }[] = [
  {
    group: "For treasurers",
    q: "What should a small self-managed condo association look for in software?",
    a: "Look for software built for small, volunteer-run buildings rather than large managed communities. Walkup is built for Illinois condo associations of 2 to 20 units and covers bookkeeping, dues, budgets, financial statements and Form 1120-H prep for a flat $19 to $55 a month.",
  },
  {
    group: "For treasurers",
    q: "How do I keep track of HOA dues without a spreadsheet?",
    a: "Connect the association's bank account to software that matches each deposit to a unit. Walkup does this automatically, shows who's paid and who's behind, and prepares reminders for a board admin to approve and send.",
  },
  {
    group: "For treasurers",
    q: "What does an HOA treasurer need to do each month?",
    a: "Record income and expenses, confirm who paid dues, follow up on late payments, and compare spending to the budget. With Walkup, that routine takes about 15 minutes.",
  },
  {
    group: "For treasurers",
    q: "Does a condo association have to file a tax return?",
    a: "Yes. Most condo associations file a federal return every year, usually Form 1120-H or Form 1120, even if they owe little or no tax. Walkup prepares the figures from your books so your board or accountant can file.",
  },
  {
    group: "For treasurers",
    q: "What is Form 1120-H?",
    a: "Form 1120-H is a simplified federal tax return for homeowners and condo associations. Qualifying associations pay tax only on non-dues income, such as interest, and do not pay tax on member dues. It is due on the 15th day of the fourth month after the association's tax year ends.",
  },
  {
    group: "For treasurers",
    q: "Does our association qualify for Form 1120-H?",
    a: "Generally, at least 60% of gross income must come from owner dues and assessments, and at least 90% of spending must go to the building and common areas. Walkup runs these checks from your books all year, so you know before tax season. Confirm the final decision with your accountant.",
  },
  {
    group: "For treasurers",
    q: "How do we hand off the books when the treasurer changes?",
    a: "Keep everything in a shared system instead of one person's files. In Walkup, the full history, documents and budget stay with the association, and the new treasurer gets their own login in minutes.",
  },
  {
    group: "About Walkup",
    q: "Does Walkup move or hold our money?",
    a: DUES_PAYMENTS_ENABLED
      ? "No. Owner payments go straight to the association's bank account, and Walkup never holds funds. Walkup reads your bank through Plaid with read-only access, and you pay bills from your own bank."
      : "No. Walkup reads your bank through Plaid with read-only access. Owners pay the association the way they do today, and Walkup records and matches the payments.",
  },
  {
    group: "About Walkup",
    q: "Does Walkup file our taxes?",
    a: "No. Walkup fills the official IRS forms from your books, with every number traced to its transactions. Your board, ideally with an accountant, reviews and files.",
  },
  {
    group: "About Walkup",
    q: "Do owners need an account?",
    a: "Only if you want them to have one. Owners can sign in to see what they owe and report a repair. They never see the association's books.",
  },
  {
    group: "About Walkup",
    q: "Can our accountant use Walkup?",
    a: "Yes. Walkup drafts an email with the year-end figures and files attached, and you can give your accountant time-limited, read-only access.",
  },
  {
    group: "About Walkup",
    q: "We have more than 20 units. Can we use Walkup?",
    a: `Walkup is built for 2 to 20 units today. Email ${SALES_EMAIL} and we'll talk through whether it fits.`,
  },
  {
    group: "Data and security",
    q: "Is Walkup secure?",
    a: "Every account uses two-step sign-in. Each association's data is walled off at the database level, and every change is logged.",
  },
  {
    group: "Data and security",
    q: "What happens to our data if we leave?",
    a: "It's yours. Download your financial statements, budget, tax forms and documents any time, and email us for a copy of the rest. There's no contract.",
  },
];

// ---- Metadata --------------------------------------------------------------------
// The title carries the search keyword; the share title carries the hook,
// because link previews are read by people, not crawlers.

export const SITE_TITLE = "Walkup: Software for Self-Managed Condo Associations in Illinois";
export const SITE_DESCRIPTION =
  "Bookkeeping, dues, budgets and Form 1120-H prep for Illinois condo associations of 2 to 20 units. Built for volunteer treasurers. Free during early access.";
export const SHARE_TITLE = "Run your building's books in 15 minutes a month";
export const SHARE_DESCRIPTION =
  "Walkup is software for self-managed Illinois condo associations. Dues, books, budget and taxes in one place. Free during early access.";
export const SITE_TAGLINE = "Run your building's books in 15 minutes a month.";

/** US states and DC for the "notify me" waitlist. Illinois is left out: it's live. */
export const WAITLIST_STATES: { code: string; name: string }[] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"],
  ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"],
  ["HI", "Hawaii"], ["ID", "Idaho"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"],
  ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"],
  ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"],
  ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"],
  ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"],
  ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"],
  ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"],
  ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
].map(([code, name]) => ({ code, name }));
