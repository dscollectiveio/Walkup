"use client";

import { useActionState } from "react";
import { devSignInAs } from "./actions";
import { DEV_ROLE_OPTIONS } from "@/lib/dev/roles";

/**
 * Development-only shortcut. Rendered only when the server has confirmed
 * NODE_ENV is not production AND the DEV_AUTH_* variables are present, so this
 * component never reaches a deployed build.
 *
 * Each button performs a real Supabase password sign-in as a separate account
 * that holds only that role, then answers the two-step check. The resulting
 * session is an ordinary JWT and every RLS policy applies, so what opens is
 * the true view for that access level. Nothing here weakens authorization; it
 * only removes the typing.
 */
export function DevSignIn() {
  const [state, action, pending] = useActionState(
    async (_prev: { error?: string; role?: string } | null, formData: FormData) => {
      const role = String(formData.get("role") ?? "");
      return { ...(await devSignInAs(role)), role };
    },
    null,
  );

  return (
    <div className="mt-8 rounded-xl border border-dashed border-warning-line bg-warning-tint p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-warning-text">
        Development only
      </p>
      <p className="mt-1 text-[12px] sm:text-[11px] leading-relaxed text-warning-text">
        See the app as each role. Every button signs in as a real account that holds only that role, so
        row-level security applies and you see exactly what that person sees.
      </p>

      {state?.error ? (
        <p role="alert" className="mt-2 text-[12px] sm:text-[11px] font-medium text-bad-text">{state.error}</p>
      ) : null}

      <form action={action} className="mt-3 grid gap-2">
        {DEV_ROLE_OPTIONS.map((o) => (
          <button
            key={o.role}
            type="submit"
            name="role"
            value={o.role}
            disabled={pending}
            className="w-full rounded-md border border-warning-line bg-paper px-3 py-2 max-sm:min-h-[44px] text-left transition hover:bg-warning-tint disabled:opacity-50"
          >
            <span className="block text-[13px] font-medium text-warning-text">
              {pending && state?.role === o.role ? "Signing in…" : `Sign in as ${o.label.toLowerCase()}`}
            </span>
            <span className="block text-[11px] text-warning-text opacity-80">{o.hint}</span>
          </button>
        ))}
      </form>
    </div>
  );
}
