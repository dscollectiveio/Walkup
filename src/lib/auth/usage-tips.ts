/**
 * Things worth knowing about Walkup, for the "Did you know?" panel on the sign-in pages. Each is true of the app
 * as it ships today. No em dashes.
 *
 * Thirty tips in six sets of five. A visitor sees one set per page load, and the next load shows the next set, so
 * over a few visits they see all of them. Each set mixes topics, so no visit is all about one area.
 */

export interface UsageTip {
  title: string;
  body: string;
}

export const TIP_SET_SIZE = 5;

export const USAGE_TIPS: readonly UsageTip[] = [
  // ---- Set 1
  {
    title: "Every suggested category comes with its reason",
    body: "In Bank Feed, open a transaction to see why Walkup suggested its category. Approve it in one click, and undo it any time.",
  },
  {
    title: "Walkup never moves your money",
    body: "Bank access is read-only, and dues are recorded, not collected. The only payment Walkup takes is its own fee.",
  },
  {
    title: "Save your recovery codes",
    body: "If you ever lose your authenticator app, one of your ten recovery codes gets you back in. Make new ones any time under Account.",
  },
  {
    title: "The Dashboard warns you when the books and the bank disagree",
    body: "If your books are off from the bank balance, a short notice says by how much and how many transactions still need a category.",
  },
  {
    title: "Anyone in the building can report a problem",
    body: "Owners can report repairs from Repairs & Upkeep, so nothing depends on one person's inbox.",
  },
  // ---- Set 2
  {
    title: "Compare months, quarters or years side by side",
    body: "On Financial Statements, pick several periods at once, then download a PDF or email it to owners straight from the page.",
  },
  {
    title: "Nothing is emailed until a board admin approves it",
    body: "Reminders and statements are prepared for you to review, and go out only when a board admin presses Send. Messages to contractors open as drafts in your own mail app.",
  },
  {
    title: "Find a contractor searches near your building",
    body: "Walkup looks up nearby contractors by trade, shows ratings and reviews, and saves the ones you like to your own list.",
  },
  {
    title: "Access for outside helpers ends on its own",
    body: "Accountants, property managers, attorneys and observers get access for 90 days at a time, so someone who has moved on never keeps a key.",
  },
  {
    title: "Set a reserve target and watch it fill",
    body: "A board admin can set the reserve goal on the Dashboard. The reserve chart shows how close you are, and how much is left to go.",
  },
  // ---- Set 3
  {
    title: "Replay the tour whenever you like",
    body: "Choose Help at the top right, then Take the tour, for a quick walk around the sidebar.",
  },
  {
    title: "Upload a policy and Walkup reads it",
    body: "Drop an insurance declarations page into Insurance and the key limits and dates are filled in for you to check.",
  },
  {
    title: "Owners see their own unit, and only theirs",
    body: "Each owner signs in to their own balance, statements and documents. Other owners' payments stay private.",
  },
  {
    title: "Import your units and owners from a spreadsheet",
    body: "Skip the typing: upload a spreadsheet in Building & Owners and Walkup sets up the units and people for you to review.",
  },
  {
    title: "Contractors with expired paperwork get flagged",
    body: "When a contractor's insurance certificate or license runs out, it shows up on your Dashboard so you can ask for a current one.",
  },
  // ---- Set 4
  {
    title: "Press [ and ] to resize the sidebar",
    body: "[ shrinks the sidebar to icons for more room, and ] brings the labels back. It remembers your choice.",
  },
  {
    title: "Files you upload are searchable",
    body: "In Documents, Walkup files each upload and reads its text, so a search for a name or amount finds it.",
  },
  {
    title: "Download a unit's statement as a PDF",
    body: "From HOA Dues, open a unit's statement for any period. After a board admin approves, you can email statements to owners too.",
  },
  {
    title: "Upkeep jobs repeat on schedule",
    body: "Boiler service, gutter cleaning and other regular jobs show when they are next due, and an overdue one appears on the Dashboard.",
  },
  {
    title: "You'll hear before the master policy renews",
    body: "Walkup tracks the renewal date from your insurance summary and puts a reminder on the Dashboard ahead of it.",
  },
  // ---- Set 5
  {
    title: "The Taxes tab lists every deadline",
    body: "It links to the current official forms and shows each due date, so April isn't a surprise.",
  },
  {
    title: "See exactly who has access",
    body: "People & Access shows the board who can see what, and lets a board admin record the access review. Changes need a fresh two-step code.",
  },
  {
    title: "Two-step sign-in protects every account",
    body: "Everyone signs in with a password and a code from an authenticator app, so a stolen password alone gets nobody in.",
  },
  {
    title: "Contractors who still owe you a W-9 are listed",
    body: "Walkup flags them ahead of time, so 1099 season isn't a scramble in January.",
  },
  {
    title: "Keep emergency information in one place",
    body: "Shutoff locations and emergency contacts live in Repairs & Upkeep, so the whole board can find them when it counts.",
  },
  // ---- Set 6
  {
    title: "Post an announcement, and email it if you want",
    body: "Announcements appear for every owner on their Dashboard. Emailing one is optional, and a board admin approves it first.",
  },
  {
    title: "HOA Dues shows who owes what",
    body: "See every unit's standing at a glance, with reminders drafted for you to review before anything is sent.",
  },
  {
    title: "Attach photos to a problem",
    body: "A photo of the leak or the crack goes with the report, so the board sees what you see.",
  },
  {
    title: "Your records stay yours",
    body: "Download your details from Account at any time, and every record stays viewable and downloadable even if a plan ever lapses.",
  },
  {
    title: "Dark mode is one click away",
    body: "Switch between light and dark under Account, Appearance, whichever is easier on your eyes.",
  },
];

/** The tips of one set, in order. Sets wrap around, so any whole number picks a set. */
export function tipSet(setIndex: number, tips: readonly UsageTip[] = USAGE_TIPS): UsageTip[] {
  const sets = Math.max(1, Math.floor(tips.length / TIP_SET_SIZE));
  const n = ((Math.floor(setIndex) % sets) + sets) % sets;
  return tips.slice(n * TIP_SET_SIZE, n * TIP_SET_SIZE + TIP_SET_SIZE);
}

export const TIP_SET_COUNT = Math.floor(USAGE_TIPS.length / TIP_SET_SIZE);
