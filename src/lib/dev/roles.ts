// The development role accounts behind the "Sign in as" list on /login (localhost only).
//
// Each role is a real Supabase account with one real role grant, so a signed-in page is exactly what a person
// with that access sees: every row-level-security policy applies, nothing is faked. The board admin is the
// original dev account (DEV_AUTH_*); the other six are seeded into the DEV database only by
// scripts/dev/role-accounts-sql.mjs. Their passwords are derived from DEV_AUTH_PASSWORD, so nothing new
// needs storing.

import { createHmac } from "node:crypto";
import { ROLE_HINT, ROLE_LABEL, type AppRole } from "@/lib/access/outside-roles";

export const DEV_ROLES = [
  "board_admin",
  "board_member",
  "accountant",
  "property_manager",
  "attorney",
  "observer",
  "owner",
] as const satisfies readonly AppRole[];

export type DevRole = (typeof DEV_ROLES)[number];

export function isDevRole(value: unknown): value is DevRole {
  return typeof value === "string" && (DEV_ROLES as readonly string[]).includes(value);
}

export interface DevRoleOption {
  role: DevRole;
  label: string;
  hint: string;
}

/** What the login page lists. Safe to send to the browser: no emails, no secrets. */
export const DEV_ROLE_OPTIONS: DevRoleOption[] = DEV_ROLES.map((role) => ({
  role,
  label: ROLE_LABEL[role],
  hint: ROLE_HINT[role],
}));

export interface DevAccount {
  role: DevRole;
  email: string;
  password: string;
  /** Only the original dev account has a TOTP secret in the environment; the rest are enrolled on first use. */
  totpSecret: string | null;
}

/** Same derivation as scripts/dev/role-accounts-sql.mjs, which seeds the matching password hash. */
export function derivedPassword(basePassword: string, role: DevRole): string {
  return createHmac("sha256", basePassword).update(`walkup-dev-role:${role}`).digest("hex").slice(0, 32);
}

export function devEmailFor(role: DevRole): string {
  return `walkup-dev+${role.replace("_", "-")}@dscollective.io`;
}

/** The account for a role, or null when the DEV_AUTH_* variables are missing. */
export function devAccount(role: DevRole): DevAccount | null {
  const { DEV_AUTH_EMAIL: email, DEV_AUTH_PASSWORD: password, DEV_AUTH_TOTP_SECRET: totp } = process.env;
  if (!email || !password) return null;
  if (role === "board_admin") return { role, email, password, totpSecret: totp ?? null };
  return { role, email: devEmailFor(role), password: derivedPassword(password, role), totpSecret: null };
}
