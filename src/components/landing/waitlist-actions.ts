"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { WAITLIST_STATES } from "@/lib/site-config";

const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;

/**
 * "Notify me" on the landing page, for visitors outside Illinois. Writes
 * through join_state_waitlist() (0049) as the signed-out visitor. The IP is
 * never stored: only a SHA-256 of it and today's date, so the function can
 * slow down repeat sign-ups from one place.
 */
export async function joinWaitlist(_prev: unknown, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const state = String(formData.get("state") ?? "").trim().toUpperCase();
  const stateName = WAITLIST_STATES.find((s) => s.code === state)?.name;

  if (!EMAIL.test(email) || email.length > 254) return { error: "Enter a valid email address." };
  if (!stateName) return { error: "Choose your state." };

  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "";
  const ipHash = ip ? createHash("sha256").update(`${ip}|${new Date().toISOString().slice(0, 10)}`).digest("hex") : null;

  const supabase = await createClient();
  const { error } = await supabase.rpc("join_state_waitlist", { p_email: email, p_state: state, p_ip_hash: ipHash });
  if (error) {
    if (error.hint === "rate_limited") return { error: "Lots of sign-ups just now. Please try again in an hour." };
    if (error.code === "23514") return { error: error.message.charAt(0).toUpperCase() + error.message.slice(1) + "." };
    return { error: "That didn't go through. Please try again in a minute." };
  }
  return { ok: true as const, stateName };
}
