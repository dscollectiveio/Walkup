"use client";
import { createBrowserClient } from "@supabase/ssr";

/** Browser client. Publishable key only — safe to ship, RLS does the work. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
