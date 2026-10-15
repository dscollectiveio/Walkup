// Validation for the owner's own profile (owner-portal-spec 5.1). Pure.
// Name and email are the board's record and are not editable here.

import { z } from "zod";

export const PHONE_MAX = 40;
export const ADDRESS_MAX = 300;

/** Control characters except the line break an address uses. */
export function stripControls(s: string): string {
  return s.replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

export const profileInput = z.object({
  phone: z
    .string()
    .transform((v) => stripControls(v).trim())
    .pipe(
      z
        .string()
        .max(PHONE_MAX, "Use digits, spaces and + ( ) - only.")
        .regex(/^[0-9+().\-x\s]*$/i, "Use digits, spaces and + ( ) - only."),
    ),
  mailingAddress: z
    .string()
    .transform((v) => stripControls(v).trim())
    .pipe(z.string().max(ADDRESS_MAX, "Keep the address under 300 characters.")),
});

export interface ProfileFieldErrors {
  phone?: string;
  mailingAddress?: string;
}

export function parseProfile(raw: { phone: unknown; mailingAddress: unknown }):
  | { ok: true; phone: string; mailingAddress: string }
  | { ok: false; fieldErrors: ProfileFieldErrors } {
  const parsed = profileInput.safeParse({
    phone: typeof raw.phone === "string" ? raw.phone : "",
    mailingAddress: typeof raw.mailingAddress === "string" ? raw.mailingAddress : "",
  });
  if (parsed.success) return { ok: true, ...parsed.data };
  const fieldErrors: ProfileFieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (key === "phone" && !fieldErrors.phone) fieldErrors.phone = issue.message;
    if (key === "mailingAddress" && !fieldErrors.mailingAddress) fieldErrors.mailingAddress = issue.message;
  }
  return { ok: false, fieldErrors };
}
