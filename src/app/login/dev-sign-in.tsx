"use client";

import { useActionState } from "react";
import { devSignIn } from "./actions";

/**
 * Development-only shortcut. Rendered only when the server has confirmed
 * NODE_ENV is not production AND the DEV_AUTH_* variables are present, so this
 * component never reaches a deployed build.
 *
 * It performs a real Supabase password sign-in — the resulting session is an
 * ordinary JWT and every RLS policy applies to it. Nothing here weakens
 * authorization; it only removes the typing.
 */
export function DevSignIn() {
  const [state, action, pending] = useActionState(
    async () => await devSignIn(),
    null,
  );

  return (
    <div className="mt-8 rounded-xl border border-dashed border-warning-line bg-warning-tint p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-warning-text">
        Development only
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-warning-text">
        Signs in as <code>walkup-dev@dscollective.io</code> — a real account
        with a real token, so row-level security applies normally. Delete it
        before any real financial data exists.
      </p>

      {state?.error ? (
        <p className="mt-2 text-[11px] font-medium text-bad-text">{state.error}</p>
      ) : null}

      <form action={action}>
        <button
          type="submit"
          disabled={pending}
          className="mt-3 w-full rounded-md border border-warning-line bg-paper px-3 py-2 text-[13px] font-medium text-warning-text transition hover:bg-warning-tint disabled:opacity-50"
        >
          {pending ? "Signing in…" : "Sign in as dev user"}
        </button>
      </form>
    </div>
  );
}
