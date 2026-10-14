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
    title: "Budget & spending",
    body: "Plan vs. spent, biggest category first, so surprises jump out.",
  },
  duesBoard: {
    id: "dues",
    target: "dues",
    title: "HOA Dues",
    body: "Who owes what, who's paid, and reminders drafted for you to send.",
  },
  duesOwner: {
    id: "dues",
    target: "dues",
    title: "HOA Dues",
    body: "What you owe, what you've paid, and how to pay the association.",
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
    body: "Units, owners, the board and the association's details. Invite the rest of the board from here.",
  },
  repairsBoard: {
    id: "repairs",
    target: "repairs",
    title: "Repairs & Upkeep",
    body: "Problems anyone in the building reports, plus yearly upkeep on a schedule.",
  },
  repairsOwner: {
    id: "repairs",
    target: "repairs",
    title: "Repairs & Upkeep",
    body: "Something broken? Report it here and the board will take it from there.",
  },
  documents: {
    id: "documents",
    target: "documents",
    title: "Document Hub",
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

export function tourStepsFor(role: TourRole): TourStep[] {
  const s = STEPS;
  switch (role) {
    case "board_admin":
    case "board_member":
      return [
        WELCOME,
        s.dashboard,
        s.bankFeed,
        s.statements,
        s.budget,
        s.duesBoard,
        s.taxes,
        s.building,
        s.repairsBoard,
        s.documents,
        role === "board_admin" ? FINISH_ADMIN : FINISH,
      ];
    case "accountant":
      return [WELCOME, s.statements, s.budget, s.taxes, s.documents, FINISH];
    case "owner":
      return [WELCOME, s.dashboard, s.duesOwner, s.repairsOwner, FINISH];
  }
}

/** The person's highest role, for picking a tour. Null when they have none. */
export function tourRoleFrom(roles: string[]): TourRole | null {
  for (const r of ["board_admin", "board_member", "accountant", "owner"] as const) {
    if (roles.includes(r)) return r;
  }
  return null;
}
