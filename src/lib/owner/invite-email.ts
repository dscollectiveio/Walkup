// The invite email a board member sends an owner they already entered
// (owner-portal-spec 5.3). Walkup does not send it (DECISIONS #22): it is a
// draft the board opens in their own mail app. Pure.

export function inviteEmailSubject(associationName: string): string {
  return `Your ${associationName} page on Walkup`;
}

export function inviteEmailBody(input: {
  fullName: string;
  associationName: string;
  inviteUrl: string;
  boardContactName: string | null;
}): string {
  const first = input.fullName.trim().split(/\s+/)[0] || "there";
  return [
    `Hi ${first},`,
    "",
    `${input.associationName} is using Walkup for dues, repairs and announcements. Use this link to sign in as yourself and see your balance, how to pay, and anything the board posts:`,
    "",
    input.inviteUrl,
    "",
    "The link works once and expires in 7 days. You'll set up two-step sign-in the first time.",
    "",
    "Thanks,",
    input.boardContactName?.trim() || "The board",
  ].join("\n");
}
