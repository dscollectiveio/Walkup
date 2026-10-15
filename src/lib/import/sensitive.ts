/**
 * Columns that look like a tax ID or an account number are never offered for
 * mapping, never staged, never shown in samples and never sent anywhere
 * (import-spec 5.2, 13.2). Pure.
 */

const SENSITIVE = /\b(ssn|social( security)?|tin|ein|itin|tax ?id|taxpayer|routing|account (number|no)|acct|bank account|card|cvv|password|pin)\b/i;

export function isSensitiveHeader(header: string): boolean {
  return SENSITIVE.test(header.replace(/[_\-.#]+/g, " "));
}
