/** Browser-safe text for the recovery codes download (no node:crypto here, so client components may import it). */

/** The text file offered for download. */
export function codesFileText(codes: string[], when: Date = new Date()): string {
  return [
    "Walkup two-step sign-in recovery codes",
    `Created ${when.toISOString().slice(0, 10)}`,
    "",
    "Each code works once. Use one on the sign-in code page if you lose your authenticator app.",
    "Keep this file somewhere safe and private, such as a password manager.",
    "",
    ...codes,
    "",
  ].join("\n");
}
