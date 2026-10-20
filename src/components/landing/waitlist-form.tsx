"use client";

import { useActionState } from "react";
import { WAITLIST_STATES } from "@/lib/site-config";
import { joinWaitlist } from "./waitlist-actions";

const field =
  "min-h-[44px] rounded-md border border-line-strong bg-paper px-3 text-[14px] text-ink focus:border-[#1B2A41] focus:outline-none focus:ring-2 focus:ring-brass/40";

/** "Outside Illinois? Leave your email." A plain confirmation, nothing else happens. */
export function WaitlistForm() {
  const [state, action, pending] = useActionState(joinWaitlist, null);

  if (state && "ok" in state) {
    return (
      <p className="rounded-lg border border-good-line bg-good-tint px-3.5 py-2.5 text-[14px] text-good-text" role="status">
        Thanks. We&rsquo;ll email you when Walkup is ready in {state.stateName}.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-2">
      <p className="text-[14px] text-mute">Outside Illinois? Leave your email and we&rsquo;ll tell you when Walkup reaches your state.</p>
      <div className="flex flex-wrap gap-2">
        <label htmlFor="waitlist-email" className="sr-only">Email</label>
        <input id="waitlist-email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" className={`${field} min-w-0 flex-[2_1_12rem]`} />
        <label htmlFor="waitlist-state" className="sr-only">State</label>
        <select id="waitlist-state" name="state" required defaultValue="" className={`${field} flex-[1_1_9rem]`}>
          <option value="" disabled>
            Your state
          </option>
          {WAITLIST_STATES.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          className="min-h-[44px] rounded-md bg-ink px-4 text-[14px] font-semibold text-paper hover:bg-ink-mid disabled:opacity-60"
        >
          {pending ? "Sending…" : "Notify me"}
        </button>
      </div>
      {state?.error ? (
        <p className="text-[13px] text-bad-text" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
