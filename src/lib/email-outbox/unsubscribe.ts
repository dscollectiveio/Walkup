/**
 * What the unsubscribe page does with a person's choices, as pure functions
 * (money spec 5.4). The page shows three kinds of email as switches that are
 * on while the person gets them, and a fourth switch that stops everything.
 */
export interface Choices {
  dues_reminders: boolean;
  statements: boolean;
  announcements: boolean;
  stop_all: boolean;
}

export type Scope = "all" | "dues_reminders" | "statements" | "announcements";

export const SCOPE_WORDS: Record<Exclude<Scope, "all">, string> = {
  dues_reminders: "dues reminders and late fee notices",
  statements: "statements",
  announcements: "announcements",
};

export const NOTE_ACCOUNT_EMAILS = "You'll still get account emails (sign-in links) and anything the board sends from its own email.";
export const INVALID_LINK = "This link isn't valid. It may have been copied wrongly. Open the latest email and use the link at the bottom.";

export function isValidToken(token: unknown): token is string {
  return typeof token === "string" && /^[0-9a-f]{96}$/.test(token);
}

function words(list: string[]): string {
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

export function unsubscribeResult(
  current: Choices,
  wanted: Choices,
  associationName: string,
): { changes: { scope: Scope; subscribe: boolean }[]; message: string } {
  const changes: { scope: Scope; subscribe: boolean }[] = [];

  if (wanted.stop_all !== current.stop_all) {
    changes.push({ scope: "all", subscribe: !wanted.stop_all });
    const message = wanted.stop_all
      ? `You're unsubscribed from all email from ${associationName} through Walkup.`
      : "Saved. You'll get the kinds of email you have switched on.";
    return { changes, message };
  }

  const off: string[] = [];
  for (const scope of ["dues_reminders", "statements", "announcements"] as const) {
    if (wanted[scope] !== current[scope]) {
      changes.push({ scope, subscribe: wanted[scope] });
      if (!wanted[scope]) off.push(SCOPE_WORDS[scope]);
    }
  }
  if (changes.length === 0) return { changes, message: "Saved." };
  if (off.length === 0) return { changes, message: "Saved." };
  return { changes, message: `You're unsubscribed from ${words(off)}. You won't get those from ${associationName} through Walkup.` };
}
