import "server-only";
import { cookies } from "next/headers";

/**
 * Development identity.
 *
 * There is no Supabase Auth in the local stack (docs/DECISIONS.md #15), so the
 * current user comes from a cookie set by the switcher in the header. This
 * file is the seam: when a real Supabase project exists, getCurrentUserId()
 * reads the session instead and nothing else in the app changes.
 *
 * This is emphatically not an auth system. It trusts a cookie. It exists so
 * the RLS policies can be exercised through the UI, and it must not survive
 * contact with a real deployment.
 */

export const DEV_USERS = [
  {
    id: "dddd0000-0000-0000-0000-00000000000c",
    name: "Cy Ferreira",
    role: "board_admin + owner, Unit 3",
  },
  {
    id: "dddd0000-0000-0000-0000-00000000000a",
    name: "Ada Okonkwo",
    role: "owner, Unit 1",
  },
  {
    id: "dddd0000-0000-0000-0000-00000000000b",
    name: "Bo Lindqvist",
    role: "owner, Unit 2 — delinquent",
  },
  {
    id: "dddd0000-0000-0000-0000-00000000000d",
    name: "Nia Bergström",
    role: "accountant, grant expires 2026-12-31",
  },
] as const;

export const DEV_USER_COOKIE = "walkup_dev_user";

export async function getCurrentUserId(): Promise<string> {
  const store = await cookies();
  const fromCookie = store.get(DEV_USER_COOKIE)?.value;
  if (fromCookie && DEV_USERS.some((u) => u.id === fromCookie)) {
    return fromCookie;
  }
  return DEV_USERS[0].id;
}

export async function getCurrentUser() {
  const id = await getCurrentUserId();
  return DEV_USERS.find((u) => u.id === id) ?? DEV_USERS[0];
}
