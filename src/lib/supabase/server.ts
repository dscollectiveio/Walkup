import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client for Server Components and Server Actions.
 *
 * Uses the publishable (anon) key only. There is no service-role client
 * anywhere in this codebase, deliberately: the service role bypasses RLS
 * entirely, and every policy in 0002 exists precisely so that authorization
 * does not depend on application code remembering to scope a query.
 *
 * If something genuinely needs to bypass RLS later, it should be a
 * SECURITY DEFINER function with its own authorization check — the pattern
 * post_journal_entry already uses — not a privileged client.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies. The middleware refreshes
            // the session instead, so swallowing this is correct rather than
            // merely convenient.
          }
        },
      },
    },
  );
}

/**
 * The signed-in user, verified against the auth server.
 *
 * getUser() rather than getSession(): getSession reads the cookie and trusts
 * it, so it must never gate anything. getUser revalidates the token.
 */
export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
