/**
 * The first-login tour: what each stop says, in order, for each kind of
 * person. Pure data so it can be tested; the spotlight itself is
 * src/components/tour/app-tour.tsx.
 *
 * A `target` is a `data-tour` key on the page (the sidebar items carry one,
 * see `tourId` in src/components/sidebar/config.tsx); `null` is a centered
 * card. Every stop only points at pages that role can open. No em dashes.
 */

export type TourRole = "board_admin" | "board_member" | "accountant" | "owner";

export interface TourStep {
  id: string;
  target: string | null;
  title: string;
  body: string;
}

const WELCOME: TourStep = {
  id: "welcome",
  target: null,
  title: "Welcome to Walkup",
  body: "Here's a one-minute look around. You can replay it any time from Help, at the top right.",
};

const STEPS: Record<string, TourStep> = {
  dashboard: {
    id: "dashboard",
    target: "dashboard",
    title: "Dashboard",
    body: "Your home base: balances, what's coming up, and anything that needs you.",
  },
  bankFeed: {
    id: "bank-feed",
    target: "bank-feed",
    title: "Bank Feed & Transactions",
    body: "Every bank transaction lands here with a suggested category. Approve them and your books are up to date.",
  },
  statements: {
    id: "financial-statements",
    target: "financial-statements",
    title: "Financial Statements",
    body: "Profit and loss for any month, quarter or year. Download a PDF for the board meeting or email it to owners.",
  },
  budget: {
    id: "budget",
    target: "budget",
    title: "Budget & Spending",
    body: "Plan vs. spent, biggest category first, so surprises jump out.",
  },
  duesBoard: {
    id: "dues",
    target: "dues",
    title: "HOA Dues",
    body: "Who owes what, reminders you review and send, and statements for every owner.",
  },
  ownerHome: {
    id: "dashboard",
    target: "dashboard",
    title: "Home",
    body: "What you owe, what the board posted, and your repairs, all in one place.",
  },
  ownerStatement: {
    id: "owner-statement",
    target: "owner-statement",
    title: "Statement",
    body: "Every charge and payment for your unit, with a running balance. Download it when you need it.",
  },
  ownerPay: {
    id: "dues",
    target: "dues",
    title: "How to pay",
    body: "Where to send your dues, and a way to tell the board you've paid.",
  },
  announcements: {
    id: "announcements",
    target: "announcements",
    title: "Announcements",
    body: "Notices from the board show up here, with a dot until you've read them.",
  },
  ownerBuilding: {
    id: "owner-building",
    target: "owner-building",
    title: "Your building",
    body: "Who to contact, and the shut-offs and numbers to know in an emergency.",
  },
  account: {
    id: "account",
    target: "account",
    title: "Your account",
    body: "The circle at the top right opens your profile, password and sign-in settings. If you own a unit, your own statement is here too, separate from the board's books.",
  },
  accountBoard: {
    id: "account",
    target: "account",
    title: "Your account",
    body: "The circle at the top right opens your profile and password. Your own unit, if you own one, and Walkup's billing are here too.",
  },
  taxes: {
    id: "taxes",
    target: "taxes",
    title: "Taxes",
    body: "Form 1120-H and contractor 1099s prepared from the books, with every deadline listed.",
  },
  building: {
    id: "building",
    target: "building",
    title: "Building Info",
    body: "Units, owners, the board and the association's details. Import them from a spreadsheet, or invite the rest of the board from here.",
  },
  repairsBoard: {
    id: "repairs",
    target: "repairs",
    title: "Repairs & Upkeep",
    body: "Problems people report, quotes from contractors, the upkeep calendar and your contractors' paperwork. Today shows what needs you.",
  },
  repairsOwner: {
    id: "repairs",
    target: "repairs",
    title: "Repairs & Upkeep",
    body: "Something broken? Report it here with a photo. Walkup doesn't alert the board, so call them if it can't wait. You'll see who's fixing it and when they're coming.",
  },
  findContractor: {
    id: "find-contractor",
    target: "find-contractor",
    title: "Find a Contractor",
    body: "Search for a plumber, electrician or any trade near the building, with ratings and the reasons each one ranks where it does.",
  },
  insuranceBoard: {
    id: "insurance",
    target: "insurance",
    title: "Insurance",
    body: "Your policies and what they cover. Walkup checks them against Illinois law and your building's facts, and drafts emails to your agent.",
  },
  insuranceAccountant: {
    id: "insurance",
    target: "insurance",
    title: "Insurance",
    body: "The association's policies and premiums, read-only.",
  },
  insuranceOwner: {
    id: "insurance",
    target: "insurance",
    title: "Insurance",
    body: "What the building's master policy covers, and what it leaves to your own condo policy.",
  },
  documents: {
    id: "documents",
    target: "documents",
    title: "Documents",
    body: "Every document in one place: the declaration, insurance, statements and receipts.",
  },
};

const FINISH_ADMIN: TourStep = {
  id: "finish",
  target: null,
  title: "You're ready",
  body: "Start with the setup checklist on your Dashboard. Each step ticks itself off as you finish it.",
};

const FINISH: TourStep = {
  id: "finish",
  target: null,
  title: "That's the tour",
  body: "Need it again? It's under Help, at the top right.",
};

/**
 * The board's insurance stop names Illinois law only for an Illinois
 * association (the coverage check's statute rules run only there).
 */
function insuranceBoardFor(stateCode: string | null | undefined): TourStep {
  const step = STEPS.insuranceBoard;
  if (!stateCode || stateCode === "IL") return step;
  return { ...step, body: step.body.replace("against Illinois law and", "against") };
}

export function tourStepsFor(role: TourRole, opts: { stateCode?: string | null } = {}): TourStep[] {
  const s = STEPS;
  switch (role) {
    case "board_admin":
    case "board_member":
      return [
        WELCOME,
        s.dashboard,
        s.announcements,
        s.bankFeed,
        s.statements,
        s.budget,
        s.duesBoard,
        s.taxes,
        insuranceBoardFor(opts.stateCode),
        s.building,
        s.repairsBoard,
        s.findContractor,
        s.documents,
        s.accountBoard,
        role === "board_admin" ? FINISH_ADMIN : FINISH,
      ];
    case "accountant":
      return [WELCOME, s.statements, s.budget, s.taxes, s.insuranceAccountant, s.documents, s.account, FINISH];
    case "owner":
      return [
        WELCOME,
        s.ownerHome,
        s.ownerStatement,
        s.ownerPay,
        s.announcements,
        s.repairsOwner,
        s.insuranceOwner,
        s.ownerBuilding,
        s.account,
        FINISH,
      ];
  }
}

/** The person's highest role, for picking a tour. Null when they have none. */
export function tourRoleFrom(roles: string[]): TourRole | null {
  for (const r of ["board_admin", "board_member", "accountant", "owner"] as const) {
    if (roles.includes(r)) return r;
  }
  return null;
}
