import type { ViewerRole } from "@/lib/owner/viewer";

export const linkClass = "font-medium text-ink underline underline-offset-2 hover:text-ink-mid";
export const dtClass = "text-[11px] font-medium uppercase tracking-wide text-mute";
export const ddClass = "mt-0.5 break-words text-[15px] text-ink";

export const ROLE_WORDS: Record<ViewerRole, { name: string; what: string }> = {
  board_admin: {
    name: "Board admin",
    what: "Everything a board member can do, plus the admin steps: giving and removing roles, connecting and posting the bank feed, approving emails to owners, and managing Walkup's plan.",
  },
  board_member: {
    name: "Board member",
    what: "Sees and works on the books, dues, taxes, insurance, repairs and documents, and can invite owners. A board admin approves the bigger steps.",
  },
  accountant: {
    name: "Accountant",
    what: "Read-only access to the books, statements, budget, taxes and board documents, to prepare filings. Can't change records.",
  },
  property_manager: {
    name: "Property manager",
    what: "Works the repairs and upkeep for the whole building, and can see units and owners with their contact details, the maintenance and vendor documents, and each unit's dues standing. Can't change the books, the bank feed, roles or email. Access ends on its own after 90 days unless a board admin renews it.",
  },
  attorney: {
    name: "Attorney",
    what: "Read-only access to the legal notices, contracts and correspondence a board admin has shared with you, and to the collections standing and owner contact details for the units shared with you. Access ends on its own after 90 days unless a board admin renews it.",
  },
  observer: {
    name: "Observer",
    what: "Sees what an owner sees (announcements, the budget plan, the insurance summary and shared documents) plus the association's finances summary. Read-only. Access ends on its own after 90 days unless a board admin renews it.",
  },
  owner: {
    name: "Owner",
    what: "Your unit's dues and statement, building announcements and shared documents, and reporting repairs.",
  },
};

/** First letters of the first and last words, or of the email when there is no name. */
export function initialsOf(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (email.trim()[0] ?? "?").toUpperCase();
}

/** A small rounded label, e.g. a role or a status. */
export function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "good" | "attention" | "bad" | "neutral" | "brand" }) {
  const cls =
    tone === "good"
      ? "bg-good-tint text-good-text"
      : tone === "bad"
        ? "bg-bad-tint text-bad-text"
        : tone === "attention"
          ? "bg-warning-tint text-warning-text"
          : tone === "brand"
            ? "bg-ink text-paper"
            : "bg-fill text-mute";
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${cls}`}>{children}</span>;
}
